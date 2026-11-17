import { filterTasks, NO_FILTER } from "../filter";
import { finishProgressLabel, formatPattern, labelText, matchState, STANDARD_LOOK } from "../look";
import { Task } from "../tasks";

const STATES = [
    { value: "ontrack", color: "#451f6b", caption: "" },
    { value: "short", color: "#e5242b", caption: "Capacity need will not be met" },
    { value: "true", color: "orange", caption: "" }
];

describe("matchState", () => {
    it("matches an enumeration key, its caption, a text and a boolean, ignoring case", () => {
        expect(matchState(STATES, "Short")).toBe(1);
        expect(matchState(STATES, "X1", "OnTrack")).toBe(0);
        expect(matchState(STATES, true)).toBe(2);
        expect(matchState(STATES, " SHORT ")).toBe(1);
    });

    it("returns undefined for no value, an unknown value or no states", () => {
        expect(matchState(STATES, undefined)).toBeUndefined();
        expect(matchState(STATES, "late")).toBeUndefined();
        expect(matchState([], "short")).toBeUndefined();
    });
});

describe("formatPattern", () => {
    const date = new Date(2027, 4, 9);
    const fallback = (): string => "fallback";

    it("formats the tokens and copies the rest", () => {
        expect(formatPattern(date, "MM.yyyy", fallback)).toBe("05.2027");
        expect(formatPattern(date, "dd/MM/yy", fallback)).toBe("09/05/27");
        expect(formatPattern(date, "d.M.yyyy", fallback)).toBe("9.5.2027");
        expect(formatPattern(date, "MMM yyyy", fallback, "en-US")).toBe("May 2027");
        expect(formatPattern(date, "MMMM", fallback, "en-US")).toBe("May");
    });

    it("uses the fallback for an empty pattern", () => {
        expect(formatPattern(date, " ", fallback)).toBe("fallback");
    });
});

describe("bar label text", () => {
    const task: Task = {
        id: "1",
        name: "Riverside",
        start: new Date(2024, 0, 1),
        end: new Date(2027, 4, 1),
        progress: 45,
        milestone: false,
        deps: [],
        editable: false,
        barText: "Custom text"
    };

    it("joins finish and progress, leaving out what is missing", () => {
        const date = (d: Date): string => formatPattern(d, "MM.yyyy", String);
        expect(finishProgressLabel(task.end, 45, date)).toBe("05.2027 · 45 %");
        expect(finishProgressLabel(task.end, undefined, date)).toBe("05.2027");
        expect(finishProgressLabel(undefined, 0, date)).toBe("0 %");
    });

    it("follows the Bar label setting", () => {
        expect(labelText(STANDARD_LOOK, String)).toBeUndefined();
        expect(labelText({ ...STANDARD_LOOK, barLabel: "none" }, String)!(task)).toBe("");
        expect(labelText({ ...STANDARD_LOOK, barLabel: "custom" }, String)!(task)).toBe("Custom text");
        expect(labelText({ ...STANDARD_LOOK, barLabel: "finishProgress", dateFormat: "MM.yyyy" }, String)!(task)).toBe(
            "05.2027 · 45 %"
        );
        // A milestone has no progress to show.
        expect(
            labelText({ ...STANDARD_LOOK, barLabel: "finishProgress", dateFormat: "yyyy" }, String)!({
                ...task,
                milestone: true,
                end: task.start
            })
        ).toBe("2024");
    });

    it("searches the code and the second line", () => {
        const tasks: Task[] = [
            { ...task, code: "01.01", subtitle: "Lukas Becker · PM400" },
            { ...task, id: "2", name: "Northport", code: "01.02", subtitle: "Sophie Wagner · PM400" }
        ];
        expect(
            filterTasks(tasks, { ...NO_FILTER, text: "01.02" }, { critical: new Set(), now: new Date() })
        ).toHaveLength(1);
        expect(
            filterTasks(tasks, { ...NO_FILTER, text: "becker" }, { critical: new Set(), now: new Date() })
        ).toHaveLength(1);
    });
});
