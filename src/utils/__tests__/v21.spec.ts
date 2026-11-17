import { makeCalendar } from "../calendar";
import {
    buildMspdi,
    holidayRanges,
    mspdiDuration,
    mspdiLag,
    planSheet,
    PlanSheetTitles,
    projectFinish,
    projectStart
} from "../planExport";
import { applyScenario, mergeScenario, scenarioChanges, scenarioSummary } from "../scenario";
import { behindTasks, dependencyChain, expectedProgress, isBehind } from "../status";
import { buildLinks, Task, withDependencies } from "../tasks";
import { buildXlsx, columnName, excelSerial, sheetXml, styleIndex } from "../xlsx";
import { crc32, fromUtf8, unzipStore, utf8, zipStore } from "../zip";

const day = (d: number, h = 0): Date => new Date(2026, 9, d, h); // October 2026; the 5th is a Monday

function task(id: string, start: Date | undefined, end: Date | undefined, extra: Partial<Task> = {}): Task {
    const base: Task = { id, name: `Task ${id}`, start, end, milestone: false, deps: [], editable: true, ...extra };
    return extra.depsText !== undefined ? withDependencies(base, extra.depsText) : base;
}

const TITLES: PlanSheetTitles = {
    sheet: "Plan",
    wbs: "WBS",
    key: "Key",
    task: "Task",
    group: "Group",
    start: "Start",
    end: "End",
    duration: "Duration (days)",
    progress: "Done",
    predecessors: "Predecessors",
    assignee: "Assigned to",
    baselineStart: "Baseline start",
    baselineEnd: "Baseline end",
    variance: "Variance (days)"
};

describe("zip writer", () => {
    it("computes the standard CRC-32", () => {
        expect(crc32(utf8("123456789"))).toBe(0xcbf43926);
    });

    it("encodes and decodes UTF-8, including characters outside the basic plane", () => {
        const text = "Prüfung – 日本 🚀";
        expect(fromUtf8(utf8(text))).toBe(text);
        expect(utf8("é")).toEqual(Uint8Array.from([0xc3, 0xa9]));
    });

    it("stores entries that read back unchanged, with a valid end record", () => {
        const zip = zipStore([
            { name: "a.txt", data: "hello" },
            { name: "dir/ü.xml", data: "<x/>" }
        ]);
        const files = unzipStore(zip);
        expect([...files.keys()]).toEqual(["a.txt", "dir/ü.xml"]);
        expect(fromUtf8(files.get("a.txt")!)).toBe("hello");
        const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
        const end = zip.length - 22;
        expect(view.getUint32(end, true)).toBe(0x06054b50);
        expect(view.getUint16(end + 10, true)).toBe(2);
        // The central directory starts where the end record says it does.
        expect(view.getUint32(view.getUint32(end + 16, true), true)).toBe(0x02014b50);
    });
});

describe("xlsx writer", () => {
    it("names columns and converts dates to Excel serials", () => {
        expect(columnName(0)).toBe("A");
        expect(columnName(25)).toBe("Z");
        expect(columnName(26)).toBe("AA");
        expect(excelSerial(new Date(2026, 0, 1))).toBe(46023);
        expect(excelSerial(new Date(2026, 0, 1, 12))).toBe(46023.5);
    });

    it("writes a frozen, filtered header and typed cells", () => {
        const xml = sheetXml({
            name: "Plan",
            columns: [
                { title: "Task", kind: "text", width: 30 },
                { title: "Start", kind: "date", width: 12 },
                { title: "Done", kind: "percent", width: 8 },
                { title: "Days", kind: "number", width: 8 }
            ],
            rows: [
                { values: ["Design & <build>", new Date(2026, 0, 1), 0.5, 3], bold: true },
                { values: ["Sub", undefined, undefined, -1.5], level: 1, indent: 1 }
            ]
        });
        expect(xml).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
        expect(xml).toContain('<autoFilter ref="A1:D3"/>');
        expect(xml).toContain("Design &amp; &lt;build&gt;");
        expect(xml).toContain(`<c r="B2" s="${styleIndex("date", true, false)}"><v>46023</v></c>`);
        expect(xml).toContain(`<c r="C2" s="${styleIndex("percent", true, false)}"><v>0.5</v></c>`);
        expect(xml).toContain('<row r="3" outlineLevel="1">');
        expect(xml).toContain(`<c r="A3" s="${styleIndex("text", false, true)}" t="inlineStr">`);
        expect(xml).toContain("<v>-1.5</v>");
        expect(xml).not.toContain('r="B3"');
    });

    it("packs a complete workbook", () => {
        const files = unzipStore(
            buildXlsx({ name: "Plan: Q4/2026", columns: [{ title: "A", kind: "text", width: 10 }], rows: [] })
        );
        expect([...files.keys()].sort()).toEqual([
            "[Content_Types].xml",
            "_rels/.rels",
            "xl/_rels/workbook.xml.rels",
            "xl/styles.xml",
            "xl/workbook.xml",
            "xl/worksheets/sheet1.xml"
        ]);
        const workbook = fromUtf8(files.get("xl/workbook.xml")!);
        // Characters Excel refuses in sheet names are replaced.
        expect(workbook).toContain('<sheet name="Plan  Q4 2026"');
        const styles = fromUtf8(files.get("xl/styles.xml")!);
        expect(styles).toContain('<cellXfs count="22">');
    });
});

describe("Excel plan sheet", () => {
    const calendar = makeCalendar("1-5", "");
    const tasks = [
        task("a", day(5), day(7), { group: "Design", key: "1", progress: 50, assignee: "Ann" }),
        task("b", day(9), day(13), {
            group: "Design",
            key: "2",
            progress: 0,
            depsText: "1FS+1d",
            baselineStart: day(8),
            baselineEnd: day(12)
        }),
        task("c", day(14), day(14), { key: "3", milestone: true })
    ];

    it("puts groups in bold summary rows with their tasks outlined under them", () => {
        const sheet = planSheet(tasks, {
            calendar,
            hasProgress: true,
            hasDependencies: true,
            hasBaseline: true,
            hasAssignee: true,
            titles: TITLES
        });
        expect(sheet.columns.map(column => column.title)).toEqual([
            "WBS",
            "Key",
            "Task",
            "Group",
            "Start",
            "End",
            "Duration (days)",
            "Done",
            "Predecessors",
            "Assigned to",
            "Baseline start",
            "Baseline end",
            "Variance (days)"
        ]);
        expect(sheet.rows).toHaveLength(4);
        const [group, a, b, c] = sheet.rows;
        expect(group).toMatchObject({ bold: true, level: 0 });
        expect(group.values.slice(0, 3)).toEqual(["1", "", "Design"]);
        expect(a).toMatchObject({ bold: false, level: 1, indent: 1 });
        expect(a.values[0]).toBe("1.1");
        expect(a.values[4]).toEqual(day(5));
        // Monday 00:00 to Wednesday 00:00 is two working days; progress is a fraction for the % format.
        expect(a.values[6]).toBe(2);
        expect(a.values[7]).toBe(0.5);
        expect(a.values[9]).toBe("Ann");
        // Friday 9th to Tuesday 13th over a weekend: two working days; a day late against the baseline.
        expect(b.values[6]).toBe(2);
        expect(b.values[8]).toBe("1FS+1d");
        expect(b.values[12]).toBe(1);
        expect(c).toMatchObject({ level: 0 });
        expect(c.values[0]).toBe("2");
    });

    it("leaves out columns for features that are not configured", () => {
        const sheet = planSheet([task("x", day(5), day(6))], {
            hasProgress: false,
            hasDependencies: false,
            hasBaseline: false,
            hasAssignee: false,
            titles: TITLES
        });
        expect(sheet.columns.map(column => column.title)).toEqual(["WBS", "Task", "Start", "End", "Duration (days)"]);
    });
});

describe("MS Project XML", () => {
    const calendar = makeCalendar("1-5", "2026-12-24..2026-12-26, 2026-12-31");

    it("converts lags to tenths of working minutes in the right unit", () => {
        expect(mspdiLag({ amount: 2, unit: "d" }, calendar)).toEqual({ value: 9600, format: 7 });
        expect(mspdiLag({ amount: -1, unit: "d" }, calendar)).toEqual({ value: -4800, format: 7 });
        expect(mspdiLag({ amount: 1, unit: "w" }, calendar)).toEqual({ value: 24000, format: 9 });
        expect(mspdiLag({ amount: 4, unit: "h" }, calendar)).toEqual({ value: 2400, format: 6 });
        expect(mspdiLag(undefined, calendar)).toEqual({ value: 0, format: 7 });
        expect(mspdiDuration(2.5)).toBe("PT20H0M0S");
    });

    it("maps midnight dates to Project's working hours", () => {
        expect(projectStart(day(5))).toEqual(day(5, 8));
        expect(projectStart(day(5, 10))).toEqual(day(5, 10));
        // Wednesday 00:00 ends on Tuesday at 17:00, Monday 00:00 on the Friday before.
        expect(projectFinish(day(7), day(5), calendar)).toEqual(day(6, 17));
        expect(projectFinish(day(12), day(8), calendar)).toEqual(day(9, 17));
        expect(projectFinish(day(5), day(5), calendar)).toEqual(day(5, 8));
    });

    it("joins consecutive holidays into ranges", () => {
        expect(holidayRanges(calendar.holidays)).toEqual([
            { from: "2026-12-24", to: "2026-12-26" },
            { from: "2026-12-31", to: "2026-12-31" }
        ]);
    });

    it("writes tasks, outline levels, typed links with lags, baselines and resources", () => {
        const tasks = [
            task("a", day(5), day(7), { key: "1", group: "Build", progress: 100, assignee: "Ann, Bob" }),
            task("b", day(7), day(9), { key: "2", group: "Build", depsText: "1", assignee: "Bob" }),
            task("c", day(9), day(13), { key: "3", depsText: "1SS+2d, 2FF-1d" }),
            task("d", day(13), day(14), {
                key: "4",
                depsText: "3SF+4h, 1FS+1w",
                baselineStart: day(12),
                baselineEnd: day(13)
            }),
            task("e", day(16), day(16), { key: "5", milestone: true, depsText: "4" })
        ];
        const xml = buildMspdi(tasks, { name: "Q4 & launch", calendar, now: day(1) });
        expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')).toBe(true);
        expect(xml).toContain('<Project xmlns="http://schemas.microsoft.com/project">');
        expect(xml).toContain("<Name>Q4 &amp; launch</Name>");
        // Saturday and Sunday off, Monday working, holidays as exceptions.
        expect(xml).toContain("<WeekDay><DayType>1</DayType><DayWorking>0</DayWorking></WeekDay>");
        expect(xml).toContain("<WeekDay><DayType>2</DayType><DayWorking>1</DayWorking><WorkingTimes>");
        expect(xml).toContain("<FromDate>2026-12-24T00:00:00</FromDate><ToDate>2026-12-26T23:59:00</ToDate>");

        const blocks = xml.match(/<Task>.*?<\/Task>/g)!;
        // Project summary, the group, its two tasks, then three loose tasks.
        expect(blocks).toHaveLength(7);
        const byName = (name: string): string => blocks.find(block => block.includes(`<Name>${name}</Name>`))!;
        expect(byName("Build")).toContain("<OutlineLevel>1</OutlineLevel>");
        expect(byName("Build")).toContain("<Summary>1</Summary>");
        expect(byName("Task a")).toContain("<OutlineNumber>1.1</OutlineNumber><OutlineLevel>2</OutlineLevel>");
        expect(byName("Task a")).toContain("<Start>2026-10-05T08:00:00</Start><Finish>2026-10-06T17:00:00</Finish>");
        expect(byName("Task a")).toContain("<Duration>PT16H0M0S</Duration>");
        expect(byName("Task a")).toContain("<PercentComplete>100</PercentComplete>");
        expect(byName("Task a")).toContain("<ConstraintType>4</ConstraintType>");
        expect(byName("Task c")).toContain("<OutlineLevel>1</OutlineLevel>");

        const uid = (name: string): string => /<UID>(\d+)<\/UID>/.exec(byName(name))![1];
        const link = (from: string, type: number, lag: number, format: number): string =>
            `<PredecessorLink><PredecessorUID>${uid(from)}</PredecessorUID><Type>${type}</Type>` +
            `<CrossProject>0</CrossProject><LinkLag>${lag}</LinkLag><LagFormat>${format}</LagFormat></PredecessorLink>`;
        expect(byName("Task b")).toContain(link("Task a", 1, 0, 7));
        expect(byName("Task c")).toContain(link("Task a", 3, 9600, 7));
        expect(byName("Task c")).toContain(link("Task b", 0, -4800, 7));
        expect(byName("Task d")).toContain(link("Task c", 2, 2400, 6));
        expect(byName("Task d")).toContain(link("Task a", 1, 24000, 9));
        expect(byName("Task d")).toContain(
            "<Baseline><Number>0</Number><Start>2026-10-12T08:00:00</Start><Finish>2026-10-12T17:00:00</Finish>"
        );
        expect(byName("Task e")).toContain("<Milestone>1</Milestone>");
        expect(byName("Task e")).toContain("<Duration>PT0H0M0S</Duration>");

        expect(xml).toContain("<Resource><UID>1</UID><ID>1</ID><Name>Ann</Name>");
        expect(xml).toContain("<Resource><UID>2</UID><ID>2</ID><Name>Bob</Name>");
        const assignments = xml.match(/<Assignment>.*?<\/Assignment>/g)!;
        expect(assignments).toHaveLength(3);
        expect(assignments[2]).toContain(`<TaskUID>${uid("Task b")}</TaskUID><ResourceUID>2</ResourceUID>`);
    });

    it("uses the links it is given, such as only the visible ones", () => {
        const tasks = [task("a", day(5), day(6), { key: "1" }), task("b", day(6), day(7), { depsText: "1" })];
        expect(buildMspdi(tasks, { name: "p", links: buildLinks(tasks) })).toContain("<PredecessorLink>");
        expect(buildMspdi(tasks, { name: "p", links: [] })).not.toContain("<PredecessorLink>");
    });
});

describe("what-if scenarios", () => {
    const base = [
        task("a", day(5), day(7), { progress: 20 }),
        task("b", day(7), day(9)),
        task("c", day(9), day(12), { nameValue: "C" })
    ];

    it("merges later values over earlier ones and applies them to a copy", () => {
        let scenario = mergeScenario(new Map(), [{ id: "a", next: { start: day(6), end: day(8) } }]);
        scenario = mergeScenario(scenario, [
            { id: "a", next: { end: day(9) } },
            { id: "b", next: { progress: 50 } }
        ]);
        expect(scenario.get("a")).toEqual({ start: day(6), end: day(9) });
        const planned = applyScenario(base, scenario);
        expect(planned[0].end).toEqual(day(9));
        expect(planned[1].progress).toBe(50);
        expect(planned[2]).toBe(base[2]);
        // The saved tasks are never touched.
        expect(base[0].end).toEqual(day(7));
        expect(applyScenario(base, new Map())).toBe(base);
    });

    it("applies only what differs from the saved tasks, with the saved values as previous", () => {
        const scenario = mergeScenario(new Map(), [
            { id: "a", next: { start: day(6), end: day(7) } },
            { id: "b", next: { start: day(7), end: day(9) } },
            { id: "c", next: { name: "Renamed", deps: "1" } },
            { id: "gone", next: { start: day(1) } }
        ]);
        expect(scenarioChanges(base, scenario)).toEqual([
            { id: "a", next: { start: day(6) }, previous: { start: day(5) } },
            { id: "c", next: { name: "Renamed", deps: "1" }, previous: { name: "C", deps: "" } }
        ]);
        expect(scenarioChanges(base, undefined)).toEqual([]);
    });

    it("summarises the new end date and how many tasks moved", () => {
        const scenario = mergeScenario(new Map(), [
            { id: "b", next: { start: day(8), end: day(10) } },
            { id: "c", next: { start: day(10), end: day(15) } },
            { id: "a", next: { progress: 80 } }
        ]);
        expect(scenarioSummary(base, scenario)).toEqual({
            currentEnd: day(12),
            plannedEnd: day(15),
            moved: 2,
            changed: 3
        });
    });
});

describe("status date and behind schedule", () => {
    const calendar = makeCalendar("1-5", "");

    it("expects progress in proportion to the working time before the status date", () => {
        // Monday to Saturday 00:00: five working days; Wednesday 00:00 is two in.
        const t = task("a", day(5), day(10), { progress: 30 });
        expect(expectedProgress(t, day(7), calendar)).toBeCloseTo(40);
        expect(expectedProgress(t, day(4), calendar)).toBe(0);
        expect(expectedProgress(t, day(12), calendar)).toBe(100);
        // Over the weekend nothing more is expected.
        expect(expectedProgress(t, day(10, 12), calendar)).toBe(100);
        expect(isBehind(t, day(7), calendar)).toBe(true);
        expect(isBehind({ ...t, progress: 40 }, day(7), calendar)).toBe(false);
        expect(isBehind({ ...t, progress: 100 }, day(12), calendar)).toBe(false);
    });

    it("treats milestones as due on their date and ignores tasks without progress", () => {
        const milestone = task("m", day(8), day(8), { milestone: true, progress: 0 });
        expect(isBehind(milestone, day(7))).toBe(false);
        expect(isBehind(milestone, day(8))).toBe(true);
        expect(isBehind(task("x", day(1), day(3)), day(9))).toBe(false);
        expect(isBehind(task("y", undefined, undefined, { progress: 0 }), day(9))).toBe(false);
        const set = behindTasks([milestone, task("z", day(1), day(3), { progress: 100 })], day(9));
        expect([...set]).toEqual(["m"]);
    });
});

describe("dependency chain", () => {
    it("follows predecessors up and successors down, not sideways", () => {
        const links = [
            { from: "a", to: "b" },
            { from: "b", to: "c" },
            { from: "x", to: "c" },
            { from: "c", to: "d" },
            { from: "a", to: "y" }
        ];
        const chain = dependencyChain(links, "b");
        expect([...chain.tasks].sort()).toEqual(["a", "b", "c", "d"]);
        expect([...chain.links].sort()).toEqual(["a>b", "b>c", "c>d"]);
        // A cycle does not loop for ever.
        const cycle = dependencyChain(
            [
                { from: "p", to: "q" },
                { from: "q", to: "p" }
            ],
            "p"
        );
        expect([...cycle.tasks].sort()).toEqual(["p", "q"]);
    });
});

describe("generated files are well-formed XML", () => {
    const wellFormed = (xml: string): boolean =>
        new DOMParser().parseFromString(xml, "application/xml").getElementsByTagName("parsererror").length === 0;

    it("for every part of the workbook and for the MS Project file", () => {
        const tasks = [
            task("a", day(5), day(7), { key: "1", group: "G <1>", progress: 40, assignee: "Ann & Co" }),
            task("b", day(7), day(9), { key: "2", depsText: "1SS+2d", baselineStart: day(6), baselineEnd: day(8) })
        ];
        const sheet = planSheet(tasks, {
            hasProgress: true,
            hasDependencies: true,
            hasBaseline: true,
            hasAssignee: true,
            titles: TITLES
        });
        const files = unzipStore(buildXlsx(sheet));
        files.forEach((data, name) => expect([name, wellFormed(fromUtf8(data))]).toEqual([name, true]));
        expect(wellFormed(buildMspdi(tasks, { name: "Plan \u0001 <x>" }))).toBe(true);
    });
});
