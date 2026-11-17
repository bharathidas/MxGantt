import { ALL_DAYS, makeCalendar } from "../calendar";
import {
    addDependency,
    applyLag,
    autoSchedule,
    formatDependency,
    parseDependencies,
    removeDependency,
    requirement,
    Span,
    violates
} from "../deps";
import { snapToCalendar } from "../drag";
import { linkEnds, linkPath } from "../geometry";
import { buildLinks, criticalTasks, Task, withDependencies } from "../tasks";

// October 2026: the 5th is a Monday.
const at = (day: number, hour = 0): Date => new Date(2026, 9, day, hour);
const span = (from: number, to: number): Span => ({ start: at(from), end: at(to) });
const weekdays = makeCalendar("1-5", "");

function task(id: string, from: number, to: number, deps = "", extra: Partial<Task> = {}): Task {
    return withDependencies(
        {
            id,
            name: `Task ${id}`,
            start: at(from),
            end: at(to),
            milestone: false,
            key: id,
            deps: [],
            editable: true,
            ...extra
        },
        deps
    );
}

describe("dependency text", () => {
    it("parses types and lags in the usual notations", () => {
        const parsed = parseDependencies("3, 5SS; 7ff+2d, 9 SF -1 d, 4FS+3h, 8SS+1w");
        expect(parsed.map(({ key, type, lag }) => ({ key, type, lag }))).toEqual([
            { key: "3", type: "FS", lag: undefined },
            { key: "5", type: "SS", lag: undefined },
            { key: "7", type: "FF", lag: { amount: 2, unit: "d" } },
            { key: "9", type: "SF", lag: { amount: -1, unit: "d" } },
            { key: "4", type: "FS", lag: { amount: 3, unit: "h" } },
            { key: "8", type: "SS", lag: { amount: 1, unit: "w" } }
        ]);
    });

    it("still reads 1.0 style lists", () => {
        expect(parseDependencies("3, 5;7  8").map(entry => entry.key)).toEqual(["3", "5", "7", "8"]);
        expect(parseDependencies("")).toEqual([]);
        expect(parseDependencies(undefined)).toEqual([]);
    });

    it("formats, adds and removes entries keeping the others as written", () => {
        expect(formatDependency({ key: "3", type: "FS" })).toBe("3");
        expect(formatDependency({ key: "3", type: "FS", lag: { amount: 2, unit: "d" } })).toBe("3FS+2d");
        expect(formatDependency({ key: "5", type: "SS", lag: { amount: -1, unit: "w" } })).toBe("5SS-1w");
        expect(addDependency("", { key: "4", type: "FS" })).toBe("4");
        expect(addDependency("3, 5SS+1d", { key: "4", type: "FF" })).toBe("3, 5SS+1d, 4FF");
        expect(addDependency("3, 5SS+1d", { key: "5", type: "FS" })).toBe("3, 5");
        expect(removeDependency("3, 5SS+1d, 7", "5")).toBe("3, 7");
        expect(removeDependency("3", "3")).toBe("");
    });
});

describe("link types", () => {
    it("states what each type asks of the successor, with lags", () => {
        const predecessor = span(5, 8);
        expect(requirement("FS", undefined, predecessor)).toEqual({ start: at(8) });
        expect(requirement("SS", { amount: 1, unit: "d" }, predecessor)).toEqual({ start: at(6) });
        expect(requirement("FF", undefined, predecessor)).toEqual({ end: at(8) });
        expect(requirement("SF", { amount: 2, unit: "h" }, predecessor)).toEqual({ end: at(5, 2) });
        // Two working days after Thursday's end skip the weekend.
        expect(applyLag(at(9), { amount: 2, unit: "d" }, weekdays)).toEqual(at(13));
        expect(applyLag(at(5), { amount: 1, unit: "w" }, weekdays)).toEqual(at(10));
        expect(applyLag(at(5), { amount: 1, unit: "w" }, ALL_DAYS)).toEqual(at(12));
    });

    it("detects conflicts per type", () => {
        const p = span(5, 8);
        expect(violates("FS", undefined, p, span(7, 9))).toBe(true);
        expect(violates("FS", undefined, p, span(8, 9))).toBe(false);
        expect(violates("SS", undefined, p, span(5, 6))).toBe(false);
        expect(violates("SS", { amount: 1, unit: "d" }, p, span(5, 6))).toBe(true);
        expect(violates("FF", undefined, p, span(3, 7))).toBe(true);
        expect(violates("FF", undefined, p, span(3, 8))).toBe(false);
        expect(violates("SF", undefined, p, span(1, 4))).toBe(true);
        expect(violates("SF", undefined, p, span(1, 5))).toBe(false);
    });

    it("builds typed links and prefers an exact key over reading a type into it", () => {
        const tasks = [
            task("1", 5, 8),
            task("2", 6, 9, "1SS"),
            task("3", 5, 7, "1FF"),
            task("A-1", 5, 6),
            task("4", 7, 9, "A-1")
        ];
        const links = buildLinks(tasks);
        expect(links).toEqual([
            { from: "1", to: "2", conflict: false, type: "SS" },
            { from: "1", to: "3", conflict: true, type: "FF" },
            { from: "A-1", to: "4", conflict: false }
        ]);
    });

    it("has no weekend conflict when a successor starts on the next working day", () => {
        const tasks = [task("1", 5, 10), task("2", 12, 14, "1FS+1d")];
        expect(buildLinks(tasks, weekdays)[0].conflict).toBe(true);
        const later = [task("1", 5, 10), task("2", 13, 14, "1FS+1d")];
        expect(buildLinks(later, weekdays)[0].conflict).toBe(false);
    });

    it("draws each type from and to the right ends", () => {
        expect(linkEnds("FS")).toEqual({ from: "end", to: "start" });
        expect(linkEnds("SS")).toEqual({ from: "start", to: "start" });
        expect(linkEnds("FF")).toEqual({ from: "end", to: "end" });
        expect(linkEnds("SF")).toEqual({ from: "start", to: "end" });
        expect(linkPath({ x: 100, y: 10 }, { x: 150, y: 50 }, 36, "SS")).toBe("M 100 10 H 92 V 50 H 150");
        expect(linkPath({ x: 100, y: 10 }, { x: 80, y: 50 }, 36, "FF")).toBe("M 100 10 H 108 V 50 H 80");
        expect(linkPath({ x: 100, y: 10 }, { x: 60, y: 50 }, 36, "SF")).toBe("M 100 10 H 92 V 50 H 60");
        expect(linkPath({ x: 100, y: 10 }, { x: 120, y: 50 }, 36, "SF")).toBe("M 100 10 H 92 V 28 H 128 V 50 H 120");
    });
});

describe("critical path with types and a calendar", () => {
    it("treats a weekend between two tasks as no slack", () => {
        // 1 runs Monday to Friday, 2 the next Monday to Wednesday, 3 is short with slack.
        const tasks = [task("1", 5, 10), task("2", 12, 15, "1"), task("3", 5, 6), task("4", 15, 16, "2, 3")];
        expect([...criticalTasks(tasks, buildLinks(tasks, weekdays), undefined, weekdays)].sort()).toEqual([
            "1",
            "2",
            "4"
        ]);
        // Without the calendar the weekend is two days of slack.
        expect([...criticalTasks(tasks, buildLinks(tasks))].sort()).toEqual(["2", "4"]);
    });

    it("stays fast on 5,000 tasks spread over years with a calendar", () => {
        const many: Task[] = [];
        for (let i = 0; i < 5000; i++) {
            const from = Math.floor(i / 3) * 2;
            many.push(task(String(i), from, from + 3 + (i % 5), i % 3 === 0 && i > 0 ? String(i - 2) : ""));
        }
        const started = Date.now();
        criticalTasks(many, buildLinks(many, weekdays), undefined, weekdays);
        expect(Date.now() - started).toBeLessThan(1500);
    });

    it("follows start-to-start and finish-to-finish links", () => {
        const tasks = [task("1", 5, 9), task("2", 6, 12, "1SS+1d"), task("3", 8, 12, "2FF")];
        expect([...criticalTasks(tasks, buildLinks(tasks))].sort()).toEqual(["1", "2", "3"]);
    });
});

describe("auto-scheduling", () => {
    const tasks = [task("1", 5, 7), task("2", 7, 9, "1"), task("3", 9, 10, "2FS+1d"), task("4", 5, 12, "1SS")];
    const spans = new Map(tasks.map(t => [t.id, { start: t.start!, end: t.end! }]));
    const links = buildLinks(tasks);

    it("pushes successors (and theirs) respecting types and lags", () => {
        const pushed = autoSchedule(spans, links, new Map([["1", span(6, 8)]]));
        expect(pushed.get("2")).toEqual(span(8, 10));
        expect(pushed.get("3")).toEqual(span(11, 12));
        expect(pushed.get("4")).toEqual(span(6, 13));
    });

    it("leaves successors that are still fine alone and never pulls them earlier", () => {
        expect(autoSchedule(spans, links, new Map([["1", span(4, 6)]])).size).toBe(0);
    });

    it("counts working days and starts pushed tasks on a working day", () => {
        const pushed = autoSchedule(spans, links, new Map([["1", span(8, 10)]]), weekdays);
        // 1 now ends Friday night; 2 (two working days) moves to Monday and Tuesday.
        expect(pushed.get("2")).toEqual(span(12, 14));
        // 3 waits one working day after 2: Thursday.
        expect(pushed.get("3")).toEqual(span(15, 16));
    });

    it("skips locked tasks and stops in a cycle", () => {
        const pushed = autoSchedule(spans, links, new Map([["1", span(6, 8)]]), ALL_DAYS, new Set(["2"]));
        expect(pushed.has("2")).toBe(false);
        expect(pushed.has("3")).toBe(false);
        const cyclic = [task("1", 5, 7, "2"), task("2", 7, 9, "1")];
        const cycleSpans = new Map(cyclic.map(t => [t.id, { start: t.start!, end: t.end! }]));
        const result = autoSchedule(cycleSpans, buildLinks(cyclic), new Map([["1", span(6, 8)]]));
        expect(result.get("2")).toEqual(span(8, 10));
    });

    it("pushes finish-to-finish successors by their end", () => {
        const ff = [task("1", 5, 7), task("2", 5, 7, "1FF")];
        const ffSpans = new Map(ff.map(t => [t.id, { start: t.start!, end: t.end! }]));
        expect(autoSchedule(ffSpans, buildLinks(ff), new Map([["1", span(5, 9)]])).get("2")).toEqual(span(7, 9));
    });
});

describe("snapping to working days", () => {
    const week = { start: at(5), end: at(7) };

    it("moves onto the next working day in the direction of travel, keeping working length", () => {
        // A Friday task dragged a day right lands on Saturday: it rolls to Monday.
        expect(snapToCalendar("move", { start: at(9), end: at(10) }, { start: at(10), end: at(11) }, weekdays)).toEqual(
            {
                start: at(12),
                end: at(13)
            }
        );
        // Thursday-Friday moved to Friday keeps two working days: Friday and Monday.
        expect(snapToCalendar("move", { start: at(8), end: at(10) }, { start: at(9), end: at(11) }, weekdays)).toEqual({
            start: at(9),
            end: at(13)
        });
        // Monday-Tuesday dragged a day left lands on Sunday: it rolls back to Friday and spans the weekend.
        expect(snapToCalendar("move", week, { start: at(4), end: at(6) }, weekdays)).toEqual({
            start: at(2),
            end: at(6)
        });
    });

    it("keeps an end off non-working days", () => {
        expect(snapToCalendar("end", { start: at(8), end: at(10) }, { start: at(8), end: at(11) }, weekdays)).toEqual({
            start: at(8),
            end: at(13)
        });
        expect(snapToCalendar("end", { start: at(8), end: at(13) }, { start: at(8), end: at(12) }, weekdays)).toEqual({
            start: at(8),
            end: at(10)
        });
    });

    it("changes nothing without a calendar", () => {
        const next = { start: at(4), end: at(6) };
        expect(snapToCalendar("move", week, next, ALL_DAYS)).toBe(next);
    });
});
