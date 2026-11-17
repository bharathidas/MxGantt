import {
    ATTRIBUTE_BASELINE,
    baselineNames,
    baselineOf,
    compareBaselines,
    deleteBaseline,
    formatBaselines,
    MAX_BASELINES,
    parseBaselines,
    saveBaseline,
    withBaseline
} from "../baselines";
import { ALL_DAYS, makeCalendar } from "../calendar";
import { constrainSpan, constraintConflict, makeConstraint, parseConstraintType, schedulePlan } from "../constraints";
import { projectEarnedValue, sCurve, taskCost, taskEarnedValue, WorkClock } from "../cost";
import { autoSchedule } from "../deps";
import { levelResources } from "../leveling";
import { importLag, importMspdi, ImportError } from "../mspdiImport";
import { buildMspdi } from "../planExport";
import { projectSummaries, rate } from "../portfolio";
import { assignmentsOf, formatAssignments, invalidAssignments, parseAssignments, resourceUsage } from "../resources";
import { applyValues, scenarioChanges, taskValues } from "../scenario";
import {
    fitSegments,
    formatSegments,
    joinSegments,
    moveSegment,
    parseSegments,
    rebaseSegments,
    segmentSpans,
    splitAt,
    workDays
} from "../segments";
import { buildLinks, buildRows, isPortfolio, rowIndexOf, Task, withDependencies } from "../tasks";
import { wbsNumbers } from "../wbs";
import { pickCandidate, resetAttributeNames, writeTasks } from "../write";

const day = (d: number, h = 0): Date => new Date(2026, 9, d, h);
const weekdays = makeCalendar("1-5", "");

function task(id: string, from: number, to: number, extra: Partial<Task> = {}): Task {
    return {
        id,
        key: id,
        name: `Task ${id}`,
        start: day(from),
        end: day(to),
        milestone: false,
        deps: [],
        editable: true,
        ...extra
    };
}

describe("split task segments", () => {
    it("parses text and JSON, sorts and merges, and ignores a single segment", () => {
        expect(parseSegments("0-2, 4-7")).toEqual([
            { start: 0, end: 2 },
            { start: 4, end: 7 }
        ]);
        expect(parseSegments("[[4,7],[0,2]]")).toEqual([
            { start: 0, end: 2 },
            { start: 4, end: 7 }
        ]);
        expect(parseSegments('[{"start":0,"end":1},{"s":3,"e":5}]')).toHaveLength(2);
        expect(parseSegments("0-2, 2-5")).toBeUndefined();
        expect(parseSegments("0-5")).toBeUndefined();
        expect(parseSegments("")).toBeUndefined();
        expect(parseSegments("garbage")).toBeUndefined();
        expect(parseSegments("[broken")).toBeUndefined();
        expect(
            formatSegments([
                { start: 0, end: 1.5 },
                { start: 3, end: 5 }
            ])
        ).toBe("0-1.5, 3-5");
        expect(formatSegments(undefined)).toBe("");
    });

    it("places segments on the calendar and counts only the work", () => {
        // Mon 5 Oct to Mon 12 Oct 00:00 is five working days; work 0-2 and 3-5 leaves a one-day gap.
        const split = task("s", 5, 12, { segments: parseSegments("0-2, 3-5") });
        const pieces = segmentSpans(split, weekdays);
        expect(pieces).toHaveLength(2);
        expect(pieces[0]).toEqual({ start: day(5), end: day(7) });
        expect(pieces[1].start).toEqual(day(8));
        expect(pieces[1].end).toEqual(day(12));
        expect(workDays(split, weekdays)).toBe(4);
        expect(workDays(task("t", 5, 12), weekdays)).toBe(5);
        expect(segmentSpans(task("t", 5, 12))).toEqual([{ start: day(5), end: day(12) }]);
    });

    it("fits the last segment to the task end", () => {
        expect(
            fitSegments(
                [
                    { start: 0, end: 2 },
                    { start: 4, end: 9 }
                ],
                6
            )
        ).toEqual([
            { start: 0, end: 2 },
            { start: 4, end: 6 }
        ]);
        expect(
            fitSegments(
                [
                    { start: 0, end: 2 },
                    { start: 4, end: 9 }
                ],
                3
            )
        ).toBeUndefined();
    });

    it("splits, moves, joins and rebases segments", () => {
        const split = splitAt(undefined, 4, 2, 1)!;
        expect(split.segments).toEqual([
            { start: 0, end: 2 },
            { start: 3, end: 5 }
        ]);
        expect(split.total).toBe(5);
        expect(splitAt(split.segments, 5, 2.5, 1)).toBeUndefined();
        const later = moveSegment(split.segments, 1, 2);
        expect(later.segments).toEqual([
            { start: 0, end: 2 },
            { start: 5, end: 7 }
        ]);
        expect(later.total).toBe(7);
        // Moving back past the previous segment closes the gap and joins them.
        const closed = moveSegment(split.segments, 1, -5);
        expect(closed.segments).toBeUndefined();
        expect(closed.total).toBe(4);
        expect(joinSegments(split.segments, 5)).toBe(4);
        const rebased = rebaseSegments(
            { start: day(5), end: day(10), segments: split.segments },
            { start: day(6), end: day(10) },
            ALL_DAYS
        );
        expect(rebased).toEqual([
            { start: 0, end: 1 },
            { start: 2, end: 4 }
        ]);
    });
});

describe("assignments and resource usage", () => {
    it("parses the unit forms and formats them back", () => {
        expect(parseAssignments("Ann:50, Bob, Cy [25%]; Dee (75%), Eve 40%")).toEqual([
            { resource: "Ann", units: 50 },
            { resource: "Bob", units: 100 },
            { resource: "Cy", units: 25 },
            { resource: "Dee", units: 75 },
            { resource: "Eve", units: 40 }
        ]);
        expect(parseAssignments("Ann:50, Ann:30")).toEqual([{ resource: "Ann", units: 80 }]);
        expect(formatAssignments(parseAssignments("Ann:50, Bob"))).toBe("Ann:50, Bob");
        expect(invalidAssignments("Ann:x, Bob, Cy:20000")).toEqual(["Ann:x", "Cy:20000"]);
        expect(assignmentsOf({ assignee: "Ann, Bob" })).toEqual([
            { resource: "Ann", units: 100 },
            { resource: "Bob", units: 100 }
        ]);
    });

    it("adds up units per day, flags over-allocation and the tasks causing it", () => {
        const tasks = [
            task("a", 5, 8, { assignments: parseAssignments("Ann:60") }),
            task("b", 6, 9, { assignments: parseAssignments("Ann:60, Bob") }),
            task("m", 7, 7, { assignments: parseAssignments("Ann") })
        ];
        const resources = new Map([["Bob", { name: "Bob", maxUnits: 200, rate: 0 }]]);
        const usage = resourceUsage(tasks, day(5), day(12), "day", ALL_DAYS, resources);
        const ann = usage.resources.find(entry => entry.name === "Ann")!;
        expect(ann.peak).toBe(120);
        expect(ann.overDays).toBe(2);
        expect(ann.utilisation).toBe(120);
        const bob = usage.resources.find(entry => entry.name === "Bob")!;
        expect(bob.overDays).toBe(0);
        expect(bob.maxUnits).toBe(200);
        expect(usage.overallocated.get("a")).toEqual([{ resource: "Ann", days: 2 }]);
        expect(usage.overallocated.get("b")).toEqual([{ resource: "Ann", days: 2 }]);
        expect(usage.overallocated.has("m")).toBe(false);
        const weekly = resourceUsage(tasks, day(5), day(19), "week", ALL_DAYS, resources);
        expect(weekly.resources[0].buckets[0].peak).toBe(120);
    });

    it("only loads the working segments of a split task", () => {
        const split = task("s", 5, 10, { assignments: parseAssignments("Ann"), segments: parseSegments("0-1, 3-5") });
        const other = task("o", 6, 8, { assignments: parseAssignments("Ann") });
        const usage = resourceUsage([split, other], day(5), day(12), "day", ALL_DAYS);
        expect(usage.resources[0].overDays).toBe(0);
    });
});

describe("resource levelling", () => {
    it("delays the task with float, keeps the critical one, and pushes successors", () => {
        // a (critical chain a -> c) and b (float) both need Ann full time on 5-6 Oct.
        const a = task("a", 5, 7, { assignments: parseAssignments("Ann") });
        const b = task("b", 5, 7, { assignments: parseAssignments("Ann") });
        const c = withDependencies(task("c", 7, 12, { assignments: parseAssignments("Bob") }), "a");
        const d = withDependencies(task("d", 7, 8), "b");
        const tasks = [b, a, c, d];
        const result = levelResources(tasks, buildLinks(tasks), {});
        expect(result.moved.has("a")).toBe(false);
        expect(result.moved.get("b")).toEqual({ start: day(7), end: day(9) });
        expect(result.moved.get("d")).toEqual({ start: day(9), end: day(10) });
        expect(result.unresolved).toEqual([]);
        expect(result.delays.find(delay => delay.id === "b")?.beyondFloat).toBe(false);
        expect(result.finishAfter).toEqual(day(12));
    });

    it("honours priority, started work, read-only tasks and do-not-level", () => {
        const low = task("low", 5, 7, { assignments: parseAssignments("Ann"), priority: 100 });
        const high = task("high", 5, 7, { assignments: parseAssignments("Ann"), priority: 900 });
        const result = levelResources([low, high], [], {});
        expect(result.moved.has("high")).toBe(false);
        expect(result.moved.has("low")).toBe(true);
        const started = task("started", 5, 7, { assignments: parseAssignments("Ann"), progress: 10, priority: 0 });
        const fresh = task("fresh", 5, 7, { assignments: parseAssignments("Ann"), priority: 999 });
        expect(levelResources([started, fresh], []).moved.has("started")).toBe(false);
        const locked = task("locked", 5, 7, { assignments: parseAssignments("Ann") });
        const other = task("other", 5, 7, { assignments: parseAssignments("Ann") });
        expect(levelResources([other, locked], [], { locked: new Set(["locked"]) }).moved.has("locked")).toBe(false);
        const pinned = task("pinned", 5, 7, { assignments: parseAssignments("Ann"), priority: 1000 });
        const mover = task("mover", 5, 7, { assignments: parseAssignments("Ann"), priority: 1000 });
        const both = levelResources([pinned, mover], []);
        expect(both.moved.size).toBe(0);
        expect(both.unresolved.length).toBeGreaterThan(0);
    });

    it("respects a working calendar and the resource's maximum", () => {
        // Fri 9 Oct: two one-day tasks for a resource that can do both at once.
        const one = task("one", 9, 10, { assignments: parseAssignments("Team") });
        const two = task("two", 9, 10, { assignments: parseAssignments("Team") });
        const team = new Map([["Team", { name: "Team", maxUnits: 200, rate: 0 }]]);
        expect(levelResources([one, two], [], { calendar: weekdays, resources: team }).moved.size).toBe(0);
        const moved = levelResources([one, two], [], { calendar: weekdays }).moved;
        // The second task goes to Monday, not the weekend.
        expect([...moved.values()][0]).toEqual({ start: day(12), end: day(13) });
    });

    it("reports work that needs more than the maximum on its own", () => {
        const big = task("big", 5, 7, { assignments: parseAssignments("Ann:150") });
        expect(levelResources([big], []).unresolved).toEqual(["big"]);
    });
});

describe("constraints", () => {
    it("reads every naming", () => {
        expect(parseConstraintType("SNET")).toBe("SNET");
        expect(parseConstraintType("Start_no_earlier_than")).toBe("SNET");
        expect(parseConstraintType("Must finish on")).toBe("MFO");
        expect(parseConstraintType("1")).toBe("ALAP");
        expect(parseConstraintType("7")).toBe("FNLT");
        expect(parseConstraintType("whenever")).toBeUndefined();
        expect(makeConstraint("SNET", undefined)).toBeUndefined();
        expect(makeConstraint("ALAP", undefined)).toEqual({ type: "ALAP" });
    });

    it("detects conflicts in working days", () => {
        const span = { start: day(5), end: day(9) };
        expect(constraintConflict(span, { type: "SNET", date: day(6) }, weekdays)).toEqual({ kind: "early", days: 1 });
        expect(constraintConflict(span, { type: "FNLT", date: day(8) }, weekdays)).toEqual({ kind: "late", days: 1 });
        expect(constraintConflict(span, { type: "MSO", date: day(5) })).toBeUndefined();
        expect(constraintConflict(span, { type: "MFO", date: day(12) })?.kind).toBe("early");
        expect(constraintConflict(span, { type: "ASAP" })).toBeUndefined();
    });

    it("pushes, pins and leaves upper bounds to the conflict check", () => {
        const span = { start: day(5), end: day(7) };
        expect(constrainSpan(span, { type: "SNET", date: day(6) }, ALL_DAYS)).toEqual({ start: day(6), end: day(8) });
        expect(constrainSpan(span, { type: "FNET", date: day(9) }, ALL_DAYS)).toEqual({ start: day(7), end: day(9) });
        expect(constrainSpan(span, { type: "MSO", date: day(2) }, ALL_DAYS)).toEqual({ start: day(2), end: day(4) });
        expect(constrainSpan(span, { type: "SNLT", date: day(1) }, ALL_DAYS)).toBe(span);
    });

    it("auto-scheduling does not move fixed tasks and respects no-earlier-than dates", () => {
        const spans = new Map([
            ["a", { start: day(5), end: day(7) }],
            ["b", { start: day(7), end: day(8) }],
            ["c", { start: day(7), end: day(8) }]
        ]);
        const links = [
            { from: "a", to: "b" },
            { from: "a", to: "c" }
        ];
        const constraints: Record<string, { type: "MSO" | "SNET"; date: Date }> = {
            b: { type: "MSO", date: day(7) },
            c: { type: "SNET", date: day(12) }
        };
        const pushed = autoSchedule(
            spans,
            links,
            new Map([["a", { start: day(6), end: day(8) }]]),
            ALL_DAYS,
            new Set(),
            (id, span) => (constraints[id]?.type === "MSO" ? undefined : constrainSpan(span, constraints[id], ALL_DAYS))
        );
        expect(pushed.has("b")).toBe(false);
        expect(pushed.get("c")).toEqual({ start: day(12), end: day(13) });
    });

    it("Schedule plan runs the forward pass with constraints and places ALAP tasks late", () => {
        const plan = [
            { id: "a", start: day(5), end: day(7) },
            { id: "b", start: day(12), end: day(13) },
            { id: "c", start: day(5), end: day(6), constraint: { type: "SNET" as const, date: day(14) } },
            { id: "d", start: day(5), end: day(6), constraint: { type: "ALAP" as const } },
            { id: "e", start: day(9), end: day(10), constraint: { type: "SNET" as const, date: day(9) } },
            { id: "f", start: day(5), end: day(6), fixed: true },
            { id: "g", start: day(5), end: day(6), constraint: { type: "SNLT" as const, date: day(6) } }
        ];
        const links = [
            { from: "a", to: "b" },
            { from: "d", to: "e" },
            { from: "a", to: "f" },
            { from: "a", to: "g" }
        ];
        const result = schedulePlan(plan, links, ALL_DAYS);
        // b pulled in to right after a, c pushed to its date.
        expect(result.moved.get("b")).toEqual({ start: day(7), end: day(8) });
        expect(result.moved.get("c")).toEqual({ start: day(14), end: day(15) });
        // d as late as its successor e allows.
        expect(result.moved.get("d")).toEqual({ start: day(8), end: day(9) });
        expect(result.moved.has("f")).toBe(false);
        expect(result.moved.get("g")).toEqual({ start: day(7), end: day(8) });
        expect(result.conflicts).toEqual(["g"]);
        expect(result.cyclic).toEqual([]);
        const cycle = schedulePlan(
            [
                { id: "x", start: day(5), end: day(6) },
                { id: "y", start: day(5), end: day(6) }
            ],
            [
                { from: "x", to: "y" },
                { from: "y", to: "x" }
            ]
        );
        expect(cycle.cyclic.sort()).toEqual(["x", "y"]);
        expect(cycle.moved.size).toBe(0);
    });
});

describe("named baselines", () => {
    const one = day(1, 9);
    it("round-trips JSON, keeps at most ten and skips malformed entries", () => {
        let entries = saveBaseline([], "Approved", { start: day(5), finish: day(9), cost: 100 }, one)!;
        entries = saveBaseline(entries, "Re-plan", { start: day(6), finish: day(10) }, one)!;
        const text = formatBaselines(entries);
        expect(parseBaselines(text)).toEqual(entries);
        expect(
            parseBaselines('{"Old":{"start":"2026-10-05T00:00:00.000Z","finish":"2026-10-06T00:00:00.000Z"}}')
        ).toHaveLength(1);
        expect(parseBaselines('[{"name":"x"},{"start":"nope"},5,null]')).toEqual([]);
        expect(parseBaselines("{broken")).toEqual([]);
        let many = entries;
        for (let i = 0; i < 20 && many.length < MAX_BASELINES; i++) {
            many = saveBaseline(many, `B${i}`, { start: day(5), finish: day(9) }, one)!;
        }
        expect(many).toHaveLength(MAX_BASELINES);
        expect(saveBaseline(many, "Eleventh", { start: day(5), finish: day(9) }, one)).toBeUndefined();
        expect(saveBaseline(many, "Approved", { start: day(7), finish: day(9) }, one)).toHaveLength(MAX_BASELINES);
        expect(deleteBaseline(entries, "Approved").map(entry => entry.name)).toEqual(["Re-plan"]);
    });

    it("shows a chosen baseline, falls back to the attributes, and compares two", () => {
        const a = task("a", 5, 9, {
            attrBaselineStart: day(5),
            attrBaselineEnd: day(8),
            baselineStart: day(5),
            baselineEnd: day(8),
            baselines: [
                { name: "First", start: day(5), finish: day(9), saved: day(1) },
                { name: "Second", start: day(6), finish: day(12), saved: day(2), cost: 50 }
            ]
        });
        const b = task("b", 9, 10, { baselines: [{ name: "Second", start: day(9), finish: day(10), saved: day(2) }] });
        expect(baselineNames([b, a])).toEqual(["First", "Second"]);
        expect(withBaseline(a, "Second").baselineEnd).toEqual(day(12));
        expect(withBaseline(a, ATTRIBUTE_BASELINE).baselineEnd).toEqual(day(8));
        expect(withBaseline(a, "").baselineStart).toBeUndefined();
        expect(baselineOf(b, "First")).toBeUndefined();
        const comparison = compareBaselines([a, b], "First", "Second", ALL_DAYS);
        expect(comparison.rows).toHaveLength(2);
        expect(comparison.rows[0]).toMatchObject({ startDays: 1, finishDays: 3 });
        expect(comparison.changed).toBe(1);
        expect(comparison.onlyB).toBe(1);
        expect(comparison.finishDays).toBe(3);
    });
});

describe("cost and earned value", () => {
    const resources = new Map([
        ["Ann", { name: "Ann", maxUnits: 100, rate: 50 }],
        ["Bob", { name: "Bob", maxUnits: 100, rate: 100 }]
    ]);
    const settings = { resources, hoursPerDay: 8, calendar: ALL_DAYS };

    it("costs work by units, rate and hours plus fixed cost, only for working segments", () => {
        const plain = task("a", 5, 9, { assignments: parseAssignments("Ann:50, Bob"), fixedCost: 100 });
        // 4 days x 8 h x (0.5 x 50 + 1 x 100) + 100
        expect(taskCost(plain, settings)).toBe(4100);
        const split = { ...plain, segments: parseSegments("0-1, 2-4") };
        expect(taskCost(split, settings)).toBe(3100);
        expect(taskCost(task("m", 5, 5, { assignments: parseAssignments("Ann"), fixedCost: 7 }), settings)).toBe(7);
    });

    it("computes the EVM figures against the baseline", () => {
        const t = task("a", 5, 15, {
            assignments: parseAssignments("Ann"),
            progress: 40,
            baselineStart: day(5),
            baselineEnd: day(13)
        });
        const { value } = taskEarnedValue(t, day(9), settings, { start: day(5), finish: day(13) });
        // BAC = 8 days x 400; PV = half way; EV = 40%; AC estimated from the current cost (10 days x 400 x 40%).
        expect(value.bac).toBe(3200);
        expect(value.pv).toBe(1600);
        expect(value.ev).toBe(1280);
        expect(value.ac).toBe(1600);
        expect(value.cv).toBe(-320);
        expect(value.sv).toBe(-320);
        expect(value.cpi).toBe(0.8);
        expect(value.spi).toBe(0.8);
        expect(value.eac).toBe(4000);
        expect(value.etc).toBe(2400);
        expect(value.vac).toBe(-800);
        const withActual = taskEarnedValue({ ...t, actualCost: 1280 }, day(9), settings, {
            start: day(5),
            finish: day(13),
            cost: 3000
        });
        expect(withActual.value.bac).toBe(3000);
        expect(withActual.value.cpi).toBe(0.94);
    });

    it("sums the project and builds an S-curve that ends on EV and AC", () => {
        const tasks = [
            task("a", 5, 9, { assignments: parseAssignments("Ann"), progress: 100 }),
            task("b", 9, 13, { assignments: parseAssignments("Bob"), progress: 25 }),
            task("c", 13, 15, { fixedCost: 500, progress: 0 })
        ];
        const status = day(11);
        const ev = projectEarnedValue(tasks, status, settings, () => undefined);
        expect(ev.bac).toBe(1600 + 3200 + 500);
        expect(ev.ev).toBe(1600 + 800);
        expect(ev.costs.get("b")).toBe(3200);
        const curve = sCurve(tasks, status, settings, () => undefined)!;
        const at = curve.dates.findIndex(date => date.getTime() === status.getTime());
        expect(at).toBeGreaterThan(0);
        expect(curve.ev[at]).toBeCloseTo(ev.ev, 1);
        expect(curve.ac[at]).toBeCloseTo(ev.ac, 1);
        expect(curve.ev[at + 1]).toBeUndefined();
        expect(curve.pv[curve.pv.length - 1]).toBeCloseTo(ev.bac, 1);
        for (let i = 1; i < curve.pv.length; i++) {
            expect(curve.pv[i]).toBeGreaterThanOrEqual(curve.pv[i - 1]);
        }
    });

    it("counts working time with the prefix clock like the calendar does", () => {
        const clock = new WorkClock(weekdays, day(1), day(30));
        expect(clock.between(day(9), day(13))).toBe(2);
        expect(clock.between(day(5, 12), day(6))).toBe(0.5);
        expect(sCurve([], day(5), settings, () => undefined)).toBeUndefined();
    });
});

describe("portfolio", () => {
    const tasks: Task[] = [
        task("a1", 5, 9, { project: "Alpha", group: "Build", key: "1", progress: 100 }),
        withDependencies(task("a2", 9, 12, { project: "Alpha", group: "Build", key: "2", progress: 0 }), "1"),
        task("b1", 5, 8, { project: "Beta", key: "1", progress: 50 }),
        withDependencies(task("b2", 12, 14, { project: "Beta", key: "2", progress: 0 }), "1, X"),
        task("x", 5, 6, { key: "X" })
    ];

    it("lays out projects with their groups and keeps loose tasks", () => {
        expect(isPortfolio(tasks)).toBe(true);
        const rows = buildRows(tasks, new Set());
        expect(rows.map(row => row.id)).toEqual([
            "project:Alpha",
            "group:Alpha::Build",
            "a1",
            "a2",
            "project:Beta",
            "b1",
            "b2",
            "x"
        ]);
        const project = rows[0];
        expect(project.kind === "group" && project.project && project.level === 0 && project.count === 2).toBe(true);
        const collapsed = buildRows(tasks, new Set(["project:Alpha"]));
        expect(collapsed.map(row => row.id)).toEqual(["project:Alpha", "project:Beta", "b1", "b2", "x"]);
        const index = rowIndexOf(collapsed, new Map(tasks.map(t => [t.id, t])));
        expect(index.get("a2")).toBe(0);
        const groupCollapsed = buildRows(tasks, new Set(["group:Alpha::Build"]));
        expect(rowIndexOf(groupCollapsed, new Map(tasks.map(t => [t.id, t]))).get("a1")).toBe(1);
        // Plans without projects are laid out exactly as before.
        const flat = buildRows(
            tasks.map(t => ({ ...t, project: undefined })),
            new Set()
        );
        expect(flat.some(row => row.kind === "group" && "level" in row)).toBe(false);
    });

    it("numbers the WBS per project", () => {
        const wbs = wbsNumbers(tasks);
        expect(wbs.get("project:Alpha")).toBe("1");
        expect(wbs.get("group:Alpha::Build")).toBe("1.1");
        expect(wbs.get("a2")).toBe("1.1.2");
        expect(wbs.get("b2")).toBe("2.2");
        expect(wbs.get("x")).toBe("3");
    });

    it("resolves keys inside the project first and marks cross-project links", () => {
        const links = buildLinks(tasks);
        expect(links.find(link => link.to === "a2")).toMatchObject({ from: "a1" });
        expect(links.find(link => link.to === "b2" && link.from === "b1")?.cross).toBeUndefined();
        expect(links.find(link => link.to === "b2" && link.from === "x")?.cross).toBe(true);
    });

    it("summarises each project's health", () => {
        const summaries = projectSummaries(tasks, {
            statusDate: day(10),
            links: buildLinks(tasks),
            overallocated: new Set(["b1"])
        });
        const alpha = summaries.find(entry => entry.name === "Alpha")!;
        const beta = summaries.find(entry => entry.name === "Beta")!;
        expect(alpha.tasks).toBe(2);
        expect(alpha.finish).toEqual(day(12));
        expect(beta.crossLinks).toBe(1);
        expect(beta.overallocated).toBe(1);
        expect(beta.rating).not.toBe("good");
        expect(rate({ name: "x", tasks: 1, critical: 0, behind: 0, missed: 0, overallocated: 0, crossLinks: 0 })).toBe(
            "good"
        );
        expect(rate({ name: "x", tasks: 1, critical: 0, behind: 0, missed: 1, overallocated: 0, crossLinks: 0 })).toBe(
            "bad"
        );
        expect(
            rate({ name: "x", tasks: 1, critical: 0, behind: 0, missed: 0, overallocated: 0, crossLinks: 0, spi: 0.9 })
        ).toBe("warning");
    });
});

describe("MS Project import and round trip", () => {
    const calendar = makeCalendar("1-5", "2026-12-24..2026-12-26");
    const resources = new Map([
        ["Ann", { name: "Ann", maxUnits: 100, rate: 60 }],
        ["Team", { name: "Team", maxUnits: 300, rate: 40 }]
    ]);
    const plan: Task[] = [
        task("1", 5, 7, {
            name: "Design & <spec>",
            group: "Plan",
            progress: 100,
            assignments: parseAssignments("Ann:50"),
            priority: 700,
            fixedCost: 250.5,
            attrBaselineStart: day(5),
            attrBaselineEnd: day(7),
            baselineStart: day(5),
            baselineEnd: day(7),
            baselines: [
                { name: "Approved", start: day(5), finish: day(8), cost: 1000, saved: day(1) },
                { name: "Re-plan", start: day(6), finish: day(9), saved: day(2) }
            ]
        }),
        withDependencies(
            task("2", 7, 12, {
                group: "Plan",
                assignments: parseAssignments("Ann, Team:150"),
                constraint: { type: "SNET", date: day(7) },
                deadline: day(14)
            }),
            "1FS+1d"
        ),
        withDependencies(task("3", 12, 14, { constraint: { type: "MFO", date: day(14) } }), "2SS+4h, 1FF-1d"),
        withDependencies(task("4", 14, 14, { milestone: true, constraint: { type: "ALAP" } }), "3+1w")
    ].map(t => withDependencies(t, t.depsText));

    it("exports constraints, units, rates, costs, priorities and every baseline", () => {
        const xml = buildMspdi(plan, { name: "Round trip", calendar, resources, now: day(1) });
        expect(xml).toContain("<MaxUnits>3.00</MaxUnits><StandardRate>40</StandardRate>");
        expect(xml).toContain("<Units>1.5</Units>");
        expect(xml).toContain("<Units>0.5</Units>");
        expect(xml).toContain("<Priority>700</Priority>");
        expect(xml).toContain("<FixedCost>25050</FixedCost>");
        expect(xml).toContain("<ConstraintType>3</ConstraintType>");
        expect(xml).toContain("<ConstraintType>1</ConstraintType>");
        expect(xml).toContain("<Baseline><Number>2</Number>");
        expect(xml).toContain("<Cost>100000</Cost>");
    });

    it("reads back what it wrote", () => {
        const xml = buildMspdi(plan, { name: "Round trip", calendar, resources, now: day(1) });
        const imported = importMspdi(xml);
        expect(imported.name).toBe("Round trip");
        expect(imported.calendar.workingDays).toBe("1-5");
        expect(imported.calendar.holidays).toBe("2026-12-24..2026-12-26");
        const work = imported.tasks.filter(entry => !entry.summary);
        expect(work.map(entry => entry.name)).toEqual(["Design & <spec>", "Task 2", "Task 3", "Task 4"]);
        expect(imported.tasks.find(entry => entry.summary)?.name).toBe("Plan");
        const [t1, t2, t3, t4] = work;
        expect(t1.group).toBe("Plan");
        expect(t1.outlineLevel).toBe(2);
        expect(new Date(t1.start!)).toEqual(day(5));
        expect(new Date(t1.end!)).toEqual(day(7));
        expect(t1.progress).toBe(100);
        expect(t1.priority).toBe(700);
        expect(t1.fixedCost).toBe(250.5);
        expect(t1.assignments).toBe("Ann:50");
        expect(new Date(t1.baselineEnd!)).toEqual(day(7));
        const baselines = parseBaselines(t1.baselines);
        expect(baselines.map(entry => entry.name)).toEqual(["Baseline", "Baseline 1", "Baseline 2"]);
        expect(baselines[1]).toMatchObject({ start: day(5), finish: day(8), cost: 1000 });
        expect(t2.assignments).toBe("Ann, Team:150");
        expect(t2.constraintType).toBe("SNET");
        expect(new Date(t2.constraintDate!)).toEqual(day(7));
        expect(new Date(t2.deadline!)).toEqual(day(14));
        expect(t2.dependsOn).toBe(`${t1.uid}FS+1d`);
        expect(t3.dependsOn).toBe(`${t2.uid}SS+4h, ${t1.uid}FF-1d`);
        expect(t3.constraintType).toBe("MFO");
        expect(new Date(t3.constraintDate!)).toEqual(day(14));
        expect(t4.milestone).toBe(true);
        expect(t4.constraintType).toBe("ALAP");
        expect(t4.dependsOn).toBe(`${t3.uid}FS+1w`);
        expect(imported.resources.map(entry => [entry.name, entry.maxUnits, entry.rate])).toEqual([
            ["Ann", 100, 60],
            ["Team", 300, 40]
        ]);
        expect(imported.assignments).toHaveLength(3);
        expect(imported.stats).toMatchObject({
            tasks: 4,
            summaries: 1,
            links: 4,
            resources: 2,
            assignments: 3,
            baselines: 3
        });
        expect(JSON.parse(JSON.stringify(imported))).toEqual(imported);
    });

    it("exports and re-imports a portfolio with projects", () => {
        const tasks = [task("a", 5, 7, { project: "Alpha", group: "Build" }), task("b", 7, 9, { project: "Beta" })];
        const imported = importMspdi(buildMspdi(tasks, { name: "Portfolio", now: day(1) }));
        const work = imported.tasks.filter(entry => !entry.summary);
        expect(work[0]).toMatchObject({ project: "Alpha", group: "Build", outlineLevel: 3 });
        expect(work[1]).toMatchObject({ project: "Beta" });
        expect(work[1].group).toBeUndefined();
    });

    it("reads MS Project 2007+ exceptions, lag formats and refuses what is not Project XML", () => {
        const xml =
            '<?xml version="1.0"?><Project xmlns="http://schemas.microsoft.com/project"><Name>p</Name><CalendarUID>3</CalendarUID>' +
            "<Calendars><Calendar><UID>3</UID><Name>Std</Name><WeekDays>" +
            "<WeekDay><DayType>1</DayType><DayWorking>0</DayWorking></WeekDay>" +
            "<WeekDay><DayType>7</DayType><DayWorking>1</DayWorking></WeekDay>" +
            "</WeekDays><Exceptions><Exception><TimePeriod><FromDate>2026-12-25T00:00:00</FromDate><ToDate>2026-12-25T23:59:00</ToDate></TimePeriod><DayWorking>0</DayWorking></Exception></Exceptions></Calendar></Calendars>" +
            "<Tasks><Task><UID>1</UID><Name>A</Name><OutlineLevel>1</OutlineLevel><Start>2026-10-05T08:00:00</Start><Finish>2026-10-06T12:00:00</Finish></Task>" +
            "<Task><UID>2</UID><Name>B</Name><OutlineLevel>1</OutlineLevel><Start>2026-10-07T08:00:00</Start><Finish>2026-10-07T17:00:00</Finish>" +
            "<PredecessorLink><PredecessorUID>1</PredecessorUID><Type>1</Type><LinkLag>4800</LinkLag><LagFormat>8</LagFormat></PredecessorLink></Task></Tasks></Project>";
        const imported = importMspdi(xml);
        expect(imported.calendar.workingDays).toBe("1-6");
        expect(imported.calendar.holidays).toBe("2026-12-25");
        expect(new Date(imported.tasks[0].end!)).toEqual(day(6, 12));
        expect(new Date(imported.tasks[1].end!)).toEqual(day(8));
        expect(imported.tasks[1].dependsOn).toBe("1FS+1d");
        expect(importLag(2400, 6, 480, 2400)).toEqual({ amount: 4, unit: "h" });
        expect(importLag(24000, 41, 480, 2400)).toEqual({ amount: 1, unit: "w" });
        expect(importLag(100, 19, 480, 2400)).toBeUndefined();
        expect(() => importMspdi("<html></html>")).toThrow(ImportError);
        expect(() => importMspdi("<Project><unclosed></Project>")).toThrow(ImportError);
        expect(() => importMspdi('<!DOCTYPE x [<!ENTITY e "x">]><Project/>')).toThrow(ImportError);
    });
});

describe("2.3 values in scenarios, undo and writes", () => {
    it("applies and diffs the new text fields", () => {
        const base = task("a", 5, 9, { assignmentsText: "Ann", assignments: parseAssignments("Ann") });
        const next = applyValues(base, { assignments: "Ann:50", segments: "0-1, 2-4", baselines: "[]" });
        expect(next.assignments).toEqual([{ resource: "Ann", units: 50 }]);
        expect(next.segments).toHaveLength(2);
        expect(taskValues(next, ["assignments", "segments"])).toEqual({ assignments: "Ann:50", segments: "0-1, 2-4" });
        const changes = scenarioChanges([base], new Map([["a", { assignments: "Ann:50" }]]));
        expect(changes).toEqual([{ id: "a", next: { assignments: "Ann:50" }, previous: { assignments: "Ann" } }]);
    });

    it("lets the name decide first for text fields that are all empty", () => {
        expect(pickCandidate(["DependsOn", "Baselines", "Segments"], /baseline/i, true)).toBe("Baselines");
        expect(pickCandidate(["DependsOn", "Baselines"], /baseline/i)).toBe("DependsOn");
    });

    it("rolls the objects back when the commit fails", async () => {
        resetAttributeNames();
        const values: Record<string, unknown> = { Start: day(5).getTime() };
        const object = {
            getGuid: () => "a",
            get: (name: string) => values[name],
            set: (name: string, value: unknown) => {
                values[name] = value;
            },
            getAttributes: () => ["Start"],
            getAttributeType: () => "DateTime"
        };
        const errors: string[] = [];
        (window as unknown as { mx: unknown }).mx = {
            data: {
                get: ({ callback }: { callback: (objects: unknown[]) => void }) => callback([object]),
                commit: ({ error }: { error: (e: Error) => void }) => error(new Error("offline"))
            },
            ui: { error: (text: string) => errors.push(text) }
        };
        const item = { id: "a" } as never;
        const attribute = { id: "start", get: () => ({ value: day(5) }) };
        const ok = await writeTasks([{ item, fields: [{ attribute, kind: "date", value: day(8), name: "Start" }] }], {
            items: [item],
            commit: true
        });
        expect(ok).toBe(false);
        expect(values.Start).toBe(day(5).getTime());
        expect(errors[0]).toMatch(/offline/);
        delete (window as unknown as { mx?: unknown }).mx;
    });
});
