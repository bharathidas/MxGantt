import { ALL_DAYS, makeCalendar } from "../calendar";
import { csvCell, csvDate, toCsv } from "../csv";
import { filterTasks, NO_FILTER } from "../filter";
import { EMPTY_HISTORY, record, redo, undo } from "../history";
import { groupId, isLate, Task, variance } from "../tasks";
import { loadView, saveView, storageKey } from "../storage";
import { wbsNumbers } from "../wbs";
import { splitAssignees, workload } from "../workload";

// October 2026: the 5th is a Monday.
const at = (day: number, hour = 0): Date => new Date(2026, 9, day, hour);

function task(id: string, from: number, to: number, extra: Partial<Task> = {}): Task {
    return {
        id,
        name: `Task ${id}`,
        start: at(from),
        end: at(to),
        milestone: false,
        deps: [],
        editable: true,
        ...extra
    };
}

describe("WBS numbers", () => {
    it("numbers groups and loose tasks in order, and tasks inside groups", () => {
        const numbers = wbsNumbers([
            task("a", 5, 6, { group: "Design" }),
            task("b", 5, 6),
            task("c", 5, 6, { group: "Design" }),
            task("d", 5, 6, { group: "Build" })
        ]);
        expect(numbers.get(groupId("Design"))).toBe("1");
        expect(numbers.get("a")).toBe("1.1");
        expect(numbers.get("c")).toBe("1.2");
        expect(numbers.get("b")).toBe("2");
        expect(numbers.get(groupId("Build"))).toBe("3");
        expect(numbers.get("d")).toBe("3.1");
    });
});

describe("undo and redo", () => {
    const move = {
        label: "A",
        changes: [{ id: "1", before: { start: at(5) }, after: { start: at(6) } }]
    };

    it("undoes by writing the before values and redoes the after values", () => {
        let state = record(EMPTY_HISTORY, move);
        const undone = undo(state);
        expect(undone.apply!.changes[0].after).toEqual({ start: at(5) });
        state = undone.state;
        expect(state.past).toHaveLength(0);
        const redone = redo(state);
        expect(redone.apply!.changes[0].after).toEqual({ start: at(6) });
        expect(redone.state.past).toHaveLength(1);
        expect(undo(EMPTY_HISTORY).apply).toBeUndefined();
        expect(redo(EMPTY_HISTORY).apply).toBeUndefined();
    });

    it("keeps batches together, drops no-op changes and clears redo on a new edit", () => {
        const batch = {
            label: "B",
            changes: [
                { id: "1", before: { start: at(5) }, after: { start: at(7) } },
                { id: "2", before: { start: at(8), end: at(9) }, after: { start: at(9), end: at(10) } },
                { id: "3", before: { name: "x" }, after: { name: "x" } }
            ]
        };
        let state = record(EMPTY_HISTORY, batch);
        expect(state.past[0].changes).toHaveLength(2);
        state = undo(state).state;
        state = record(state, move);
        expect(state.future).toHaveLength(0);
        expect(record(state, { label: "none", changes: [] })).toBe(state);
    });

    it("keeps at most the limit", () => {
        let state = EMPTY_HISTORY;
        for (let i = 0; i < 5; i++) {
            state = record(
                state,
                { label: String(i), changes: [{ id: "1", before: { progress: i }, after: { progress: i + 1 } }] },
                3
            );
        }
        expect(state.past.map(batch => batch.label)).toEqual(["2", "3", "4"]);
    });
});

describe("workload", () => {
    const weekdays = makeCalendar("1-5", "");

    it("splits assignee lists", () => {
        expect(splitAssignees("Anna, Ben; Anna")).toEqual(["Anna", "Ben"]);
        expect(splitAssignees(undefined)).toEqual([]);
    });

    it("counts tasks per person per day and flags over-allocation", () => {
        const tasks = [
            task("1", 5, 8, { assignee: "Anna" }),
            task("2", 7, 10, { assignee: "Anna, Ben" }),
            task("3", 6, 6, { assignee: "Anna", milestone: true }),
            task("4", 5, 6)
        ];
        const loads = workload(tasks, at(5), at(12), "day", weekdays, 1, "Unassigned");
        const anna = loads.find(load => load.name === "Anna")!;
        expect(anna.buckets.map(bucket => bucket.peak)).toEqual([1, 1, 2, 1, 1, 0, 0]);
        expect(anna.overDays).toBe(1);
        expect(anna.peak).toBe(2);
        expect(loads.map(load => load.name)).toEqual(["Anna", "Ben", "Unassigned"]);
        const weekly = workload(tasks, at(5), at(19), "week", weekdays, 1);
        expect(weekly[0].buckets.map(bucket => bucket.peak)).toEqual([2, 0]);
        expect(weekly[0].buckets[0].over).toBe(1);
    });

    it("does not load weekends or the day an end falls on at midnight", () => {
        const loads = workload([task("1", 9, 13, { assignee: "Ann" })], at(5), at(19), "day", weekdays, 1);
        expect(loads[0].buckets.map(bucket => bucket.peak).slice(0, 9)).toEqual([0, 0, 0, 0, 1, 0, 0, 1, 0]);
        const plain = workload([task("1", 9, 13, { assignee: "Ann" })], at(5), at(19), "day", ALL_DAYS, 1);
        expect(plain[0].buckets.map(bucket => bucket.peak).slice(0, 9)).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 0]);
    });

    it("handles 5,000 tasks quickly", () => {
        const many: Task[] = [];
        for (let i = 0; i < 5000; i++) {
            many.push(task(String(i), 1 + (i % 200), 4 + (i % 200), { assignee: `P${i % 40}` }));
        }
        const started = Date.now();
        const loads = workload(many, at(1), at(260), "week", weekdays, 3);
        expect(loads).toHaveLength(40);
        expect(Date.now() - started).toBeLessThan(1000);
    });
});

describe("baselines, late tasks and filters", () => {
    const now = at(12);
    const tasks = [
        task("1", 5, 8, { progress: 50, name: "Design review", assignee: "Anna" }),
        task("2", 8, 14, { progress: 0, baselineStart: at(8), baselineEnd: at(13), assignee: "Ben" }),
        task("3", 12, 20, { progress: 10, baselineStart: at(12), baselineEnd: at(21), columns: ["Blocked"] }),
        task("4", 5, 8, { progress: 100 })
    ];

    it("measures variance against the baseline end in working days", () => {
        expect(variance(tasks[1])).toBe(1);
        expect(variance(tasks[2])).toBe(-1);
        expect(variance(tasks[0])).toBeUndefined();
        const weekdays = makeCalendar("1-5", "");
        expect(variance({ ...tasks[1], end: at(19) }, weekdays)).toBe(4);
    });

    it("calls unfinished overdue work and work behind its baseline late", () => {
        expect(isLate(tasks[0], now)).toBe(true);
        expect(isLate(tasks[1], now)).toBe(true);
        expect(isLate(tasks[2], now)).toBe(false);
        expect(isLate(tasks[3], now)).toBe(false);
    });

    it("filters by words, late, critical and assignee", () => {
        const context = { critical: new Set(["2", "3"]), now, me: "anna" };
        const ids = (filter: Partial<typeof NO_FILTER>): string[] =>
            filterTasks(tasks, { ...NO_FILTER, ...filter }, context).map(t => t.id);
        expect(ids({})).toEqual(["1", "2", "3", "4"]);
        expect(ids({ text: "review design" })).toEqual(["1"]);
        expect(ids({ text: "blocked" })).toEqual(["3"]);
        expect(ids({ late: true })).toEqual(["1", "2"]);
        expect(ids({ critical: true, late: true })).toEqual(["2"]);
        expect(ids({ mine: true })).toEqual(["1"]);
        expect(filterTasks(tasks, { ...NO_FILTER, mine: true }, { ...context, me: "" })).toEqual([]);
    });
});

describe("CSV", () => {
    it("quotes what needs quoting and defuses formulas", () => {
        expect(csvCell("plain")).toBe("plain");
        expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
        expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
        expect(csvCell("-2")).toBe("-2");
        expect(csvCell("-x")).toBe("'-x");
        expect(csvCell(12.5)).toBe("12.5");
        expect(csvCell(undefined)).toBe("");
    });

    it("writes a BOM, a header and CRLF lines", () => {
        expect(toCsv(["A", "B"], [["1", "x y"]])).toBe("\uFEFFA,B\r\n1,x y\r\n");
        expect(csvDate(at(5, 9), false)).toBe("2026-10-05");
        expect(csvDate(at(5, 9), true)).toBe("2026-10-05 09:00");
    });
});

describe("remembered view", () => {
    it("saves and loads, and survives broken or blocked storage", () => {
        const key = storageKey("gantt1", "42");
        expect(key).toBe("mxgantt:42:gantt1");
        saveView(key, { collapsed: ["group:A"], hidden: ["start"], widths: { end: 120 } });
        expect(loadView(key)).toEqual({ collapsed: ["group:A"], hidden: ["start"], widths: { end: 120 } });
        window.localStorage.setItem(key, "{not json");
        expect(loadView(key)).toEqual({});
        const getItem = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new Error("blocked");
        });
        expect(loadView(key)).toEqual({});
        getItem.mockRestore();
    });
});
