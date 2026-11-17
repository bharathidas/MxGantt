import {
    buildLinks,
    buildRows,
    criticalTasks,
    groupId,
    isMilestone,
    normaliseDates,
    parseKeys,
    rowIndexOf,
    Task,
    taskBounds
} from "../tasks";

const day = (n: number): Date => new Date(2026, 9, 1 + n);

function task(id: string, from: number, to: number, extra: Partial<Task> = {}): Task {
    return {
        id,
        name: `Task ${id}`,
        start: day(from),
        end: day(to),
        milestone: false,
        key: id,
        deps: [],
        editable: true,
        ...extra
    };
}

describe("keys and dates", () => {
    it("parses dependency lists written in any reasonable way", () => {
        expect(parseKeys("3, 5;7  8")).toEqual(["3", "5", "7", "8"]);
        expect(parseKeys("")).toEqual([]);
        expect(parseKeys(undefined)).toEqual([]);
        expect(parseKeys(" ,, ")).toEqual([]);
    });

    it("fills in and orders dates", () => {
        expect(normaliseDates(day(2), undefined)).toEqual({ start: day(2), end: day(2) });
        expect(normaliseDates(day(5), day(2))).toEqual({ start: day(2), end: day(5) });
        expect(normaliseDates(undefined, undefined)).toEqual({ start: undefined, end: undefined });
    });

    it("treats flagged and zero-length tasks as milestones", () => {
        expect(isMilestone(task("a", 2, 2))).toBe(true);
        expect(isMilestone(task("a", 2, 4, { milestone: true }))).toBe(true);
        expect(isMilestone(task("a", 2, 4))).toBe(false);
    });
});

describe("rows", () => {
    const tasks = [
        task("1", 0, 3, { group: "Design", progress: 100 }),
        task("2", 5, 6),
        task("3", 3, 9, { group: "Design", progress: 50 }),
        task("4", 9, 12, { group: "Build", progress: 0 })
    ];

    it("gathers a group's tasks under a summary row where the group first appears", () => {
        const rows = buildRows(tasks, new Set());
        expect(rows.map(row => row.id)).toEqual([groupId("Design"), "1", "3", "2", groupId("Build"), "4"]);
        const design = rows[0];
        expect(design.kind).toBe("group");
        if (design.kind === "group") {
            expect(design.start).toEqual(day(0));
            expect(design.end).toEqual(day(9));
            expect(design.count).toBe(2);
            // Weighted by duration: 3 days at 100% and 6 days at 50%.
            expect(design.progress).toBe(67);
        }
    });

    it("hides collapsed groups' tasks and maps them to the group row", () => {
        const rows = buildRows(tasks, new Set([groupId("Design")]));
        expect(rows.map(row => row.id)).toEqual([groupId("Design"), "2", groupId("Build"), "4"]);
        const index = rowIndexOf(rows, new Map(tasks.map(t => [t.id, t])));
        expect(index.get("1")).toBe(0);
        expect(index.get("3")).toBe(0);
        expect(index.get("4")).toBe(3);
    });

    it("computes the bounds over all tasks", () => {
        expect(taskBounds(tasks)).toEqual({ min: day(0), max: day(12) });
        expect(taskBounds([])).toEqual({ min: undefined, max: undefined });
    });
});

describe("links", () => {
    it("links by key, flags conflicts and ignores unknown or self references", () => {
        const tasks = [
            task("1", 0, 3),
            task("2", 3, 5, { deps: ["1"] }),
            task("3", 4, 6, { deps: ["2", "99", "3", "2"] })
        ];
        const links = buildLinks(tasks);
        expect(links).toEqual([
            { from: "1", to: "2", conflict: false },
            { from: "2", to: "3", conflict: true }
        ]);
    });
});

describe("critical path", () => {
    it("follows the chain that decides the end date", () => {
        // 1 -> 2 -> 4 is the long chain; 3 has slack before 4.
        const tasks = [
            task("1", 0, 4),
            task("2", 4, 10, { deps: ["1"] }),
            task("3", 4, 6, { deps: ["1"] }),
            task("4", 10, 12, { deps: ["2", "3"] })
        ];
        const critical = criticalTasks(tasks, buildLinks(tasks));
        expect([...critical].sort()).toEqual(["1", "2", "4"]);
    });

    it("is empty without links and ignores cycles", () => {
        const plain = [task("1", 0, 4), task("2", 4, 6)];
        expect(criticalTasks(plain, buildLinks(plain)).size).toBe(0);

        const cyclic = [
            task("1", 0, 2, { deps: ["2"] }),
            task("2", 2, 4, { deps: ["1"] }),
            task("3", 4, 6, { deps: ["2"] })
        ];
        const critical = criticalTasks(cyclic, buildLinks(cyclic));
        expect(critical.has("1")).toBe(false);
        expect(critical.has("2")).toBe(false);
    });
});
