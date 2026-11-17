import {
    aggregate,
    cellKey,
    encodeCell,
    layoutKey,
    makeCellFormatter,
    nextSort,
    parseCell,
    pinLeading,
    sameRawValue,
    sortByValue,
    toRaw,
    uniqueLayout
} from "../layout";
import { applyValues, scenarioChanges, taskValues } from "../scenario";
import { Task } from "../tasks";

const context = { locale: "en-US", yes: "Yes", no: "No" };

describe("layout: keys and order (1.2)", () => {
    it("keys built-in columns by kind, cost by measure and attributes by position", () => {
        expect(layoutKey("start", 3)).toBe("start");
        expect(layoutKey("cost", 4, "ev")).toBe("ev");
        expect(layoutKey("attribute", 2)).toBe("a2");
    });
    it("keeps the first of duplicated built-in columns", () => {
        expect(uniqueLayout([{ key: "start" }, { key: "a1" }, { key: "start" }]).map(c => c.key)).toEqual([
            "start",
            "a1"
        ]);
    });
    it("puts Task name first and WBS right before it, whatever order the user chose", () => {
        const order = (keys: string[]): string[] => pinLeading(keys.map(key => ({ key }))).map(c => c.key);
        expect(order(["start", "name", "end"])).toEqual(["name", "start", "end"]);
        expect(order(["start", "wbs", "end", "name"])).toEqual(["wbs", "name", "start", "end"]);
        expect(order(["name", "start"])).toEqual(["name", "start"]);
    });
    it("returns the same array when nothing moves", () => {
        const columns = [{ key: "name" }, { key: "start" }];
        expect(pinLeading(columns)).toBe(columns);
    });
});

describe("layout: values and formats", () => {
    it("normalises data source values", () => {
        expect(toRaw(undefined)).toBeNull();
        expect(toRaw("")).toBeNull();
        expect(toRaw({ toString: () => "12.5" })).toBe(12.5);
        expect(toRaw(true)).toBe(true);
        const date = new Date(2026, 0, 2);
        expect(toRaw(date)).toBe(date);
        expect(toRaw("Open")).toBe("Open");
    });
    it("treats empty values as equal and compares dates by time", () => {
        expect(sameRawValue(null, undefined)).toBe(true);
        expect(sameRawValue("", null)).toBe(true);
        expect(sameRawValue(new Date(5), new Date(5))).toBe(true);
        expect(sameRawValue(1, 2)).toBe(false);
    });
    it("formats numbers, currency, percent and dates", () => {
        expect(makeCellFormatter("number", 2, context)(1234.5)).toBe("1,234.50");
        expect(makeCellFormatter("currency", 0, { ...context, currency: "eur" })(1200)).toBe("€1,200");
        expect(makeCellFormatter("percent", 0, context)(45)).toBe("45%");
        expect(makeCellFormatter("date", 0, context)(new Date(2026, 2, 4, 15, 30))).toBe("Mar 4, 2026");
        expect(makeCellFormatter("auto", 0, context)(null)).toBe("");
    });
    it("uses the Mendix formatter for Automatic and falls back when it throws", () => {
        expect(makeCellFormatter("auto", 0, context, undefined, () => "from Mendix")(new Date())).toBe("from Mendix");
        const broken = makeCellFormatter("auto", 0, context, undefined, () => {
            throw new Error("no");
        });
        expect(broken(true)).toBe("Yes");
        expect(broken(2.5)).toBe("2.5");
    });
    it("shows enumeration captions", () => {
        const format = makeCellFormatter("auto", 0, context, [{ value: "in_progress", label: "In progress" }]);
        expect(format("in_progress")).toBe("In progress");
        expect(format("unknown")).toBe("unknown");
    });
});

describe("layout: sorting", () => {
    it("goes ascending, descending, then off, and starts over for another column", () => {
        const first = nextSort(undefined, "start");
        expect(first).toEqual({ key: "start", dir: "asc" });
        const second = nextSort(first, "start");
        expect(second).toEqual({ key: "start", dir: "desc" });
        expect(nextSort(second, "start")).toBeUndefined();
        expect(nextSort(second, "end")).toEqual({ key: "end", dir: "asc" });
    });
    it("keeps empty values last in both directions and equal values in their order", () => {
        const items = [
            { id: "a", v: 3 },
            { id: "b", v: null },
            { id: "c", v: 1 },
            { id: "d", v: 3 }
        ];
        const ids = (dir: "asc" | "desc"): string[] => sortByValue(items, item => item.v, dir).map(item => item.id);
        expect(ids("asc")).toEqual(["c", "a", "d", "b"]);
        expect(ids("desc")).toEqual(["a", "d", "c", "b"]);
    });
    it("sorts text naturally and dates by time", () => {
        const wbs = ["1.10", "1.2", "1.1"].map(v => ({ v }));
        expect(sortByValue(wbs, item => item.v, "asc").map(item => item.v)).toEqual(["1.1", "1.2", "1.10"]);
        const dates = [new Date(2026, 5, 1), new Date(2026, 0, 1)].map(v => ({ v }));
        expect(sortByValue(dates, item => item.v, "asc")[0].v.getMonth()).toBe(0);
    });
});

describe("layout: group totals", () => {
    const values = [10, null, 30, undefined, "x"];
    it("sums, averages and finds the extremes of the numbers", () => {
        expect(aggregate(values, "sum")).toBe(40);
        expect(aggregate(values, "average")).toBe(20);
        expect(aggregate(values, "min")).toBe(10);
        expect(aggregate(values, "max")).toBe(30);
    });
    it("counts the tasks that have a value", () => {
        expect(aggregate(values, "count")).toBe(3);
    });
    it("gives nothing for None or without numbers", () => {
        expect(aggregate(values, "none")).toBeUndefined();
        expect(aggregate(["a"], "sum")).toBeUndefined();
    });
});

describe("layout: editing", () => {
    it("encodes values for the editors", () => {
        expect(encodeCell(new Date(2026, 2, 4, 9, 5), "date", true)).toBe("2026-03-04T09:05");
        expect(encodeCell(new Date(2026, 2, 4, 9, 5), "date", false)).toBe("2026-03-04");
        expect(encodeCell(true, "boolean", false)).toBe("true");
        expect(encodeCell(null, "number", false)).toBe("");
    });
    it("reads numbers, whole numbers and empty values", () => {
        expect(parseCell("12,5", { valueType: "number" })).toEqual({ ok: true, value: 12.5 });
        expect(parseCell("-3", { valueType: "number", integer: true })).toEqual({ ok: true, value: -3 });
        expect(parseCell("1.5", { valueType: "number", integer: true })).toEqual({ ok: false, error: "whole" });
        expect(parseCell("abc", { valueType: "number" })).toEqual({ ok: false, error: "number" });
        expect(parseCell("", { valueType: "number" })).toEqual({ ok: true, value: null });
    });
    it("reads dates and keeps the old time of day for a date-only edit", () => {
        const parsed = parseCell("2026-04-01", { valueType: "date" }, new Date(2026, 0, 1, 14, 30));
        expect(parsed.ok && (parsed.value as Date).getHours()).toBe(14);
        expect(parseCell("2026-02-30", { valueType: "date" })).toEqual({ ok: false, error: "date" });
        const timed = parseCell("2026-04-01T08:15", { valueType: "date" });
        expect(timed.ok && (timed.value as Date).getMinutes()).toBe(15);
    });
    it("only accepts the listed choices", () => {
        const options = [{ value: "open", label: "Open" }];
        expect(parseCell("open", { valueType: "enum", options })).toEqual({ ok: true, value: "open" });
        expect(parseCell("closed", { valueType: "enum", options })).toEqual({ ok: false, error: "choice" });
        expect(parseCell("false", { valueType: "boolean" })).toEqual({ ok: true, value: false });
    });
});

describe("layout: cell values in undo and scenarios", () => {
    const task: Task = {
        id: "t1",
        name: "Build",
        milestone: false,
        deps: [],
        editable: true,
        cells: { a0: { raw: 100, text: "100", cls: "warn" } }
    };
    it("reads a cell value as a task value", () => {
        expect(taskValues(task, [cellKey("a0"), cellKey("a9")])).toEqual({ "cell:a0": 100, "cell:a9": null });
    });
    it("applies a value and forgets the old text but keeps the cell class", () => {
        const next = applyValues(task, { [cellKey("a0")]: 250 });
        expect(next.cells?.a0).toEqual({ raw: 250, cls: "warn" });
        expect(task.cells?.a0.raw).toBe(100);
    });
    it("writes only changed cells when a scenario is applied", () => {
        const scenario = new Map([["t1", { [cellKey("a0")]: 250 }]]);
        expect(scenarioChanges([task], scenario)).toEqual([
            { id: "t1", next: { "cell:a0": 250 }, previous: { "cell:a0": 100 } }
        ]);
        expect(scenarioChanges([task], new Map([["t1", { [cellKey("a0")]: 100 }]]))).toEqual([]);
    });
});
