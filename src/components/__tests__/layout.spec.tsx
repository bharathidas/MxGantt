import { act, fireEvent, render, screen } from "@testing-library/react";

import { ALL_DAYS } from "../../utils/calendar";
import { LayoutColumn, makeCellFormatter } from "../../utils/layout";
import { Task } from "../../utils/tasks";
import { DEFAULT_TEXTS } from "../../utils/texts";
import { GanttChart, GanttChartProps, TaskChange } from "../GanttChart";

const day = (d: number): Date => new Date(2026, 9, d);
const context = { locale: "en-US", yes: "Yes", no: "No" };

function task(id: string, start: number, extra: Partial<Task> = {}): Task {
    return {
        id,
        key: id,
        name: `Task ${id}`,
        start: day(start),
        end: day(start + 2),
        milestone: false,
        deps: [],
        editable: true,
        progress: 50,
        ...extra
    };
}

const TASKS: Task[] = [
    task("a", 5, {
        group: "Design",
        cells: {
            a1: { raw: 1000, text: "1,000", cls: "is-over" },
            a3: { raw: "open", text: "Open" },
            a4: { raw: "A long note that wraps", text: "A long note that wraps" }
        }
    }),
    task("b", 3, { group: "Design", cells: { a1: { raw: 500, text: "500" }, a3: { raw: "done", text: "Done" } } }),
    task("c", 7, { cells: { a1: { raw: null, text: "" } } })
];

const OPTIONS = [
    { value: "open", label: "Open" },
    { value: "done", label: "Done" }
];

function column(extra: Partial<LayoutColumn> & Pick<LayoutColumn, "key" | "type">): LayoutColumn {
    return {
        minWidth: 40,
        fill: false,
        wrap: false,
        visible: true,
        hideable: true,
        sortable: false,
        editable: false,
        format: "auto",
        decimals: 0,
        total: "none",
        ...extra
    };
}

const LAYOUT: LayoutColumn[] = [
    column({ key: "start", type: "start", sortable: true }),
    column({
        key: "a1",
        type: "attribute",
        title: "Budget",
        tooltip: "Approved budget",
        valueType: "number",
        integer: true,
        editable: true,
        sortable: true,
        total: "sum",
        format: "number",
        formatRaw: makeCellFormatter("number", 0, context)
    }),
    column({ key: "wbs", type: "wbs" }),
    column({
        key: "a3",
        type: "attribute",
        title: "Status",
        valueType: "enum",
        editable: true,
        options: OPTIONS,
        hideable: false,
        formatRaw: makeCellFormatter("auto", 0, context, OPTIONS)
    }),
    column({ key: "a4", type: "attribute", title: "Notes", valueType: "string", wrap: true }),
    column({ key: "duration", type: "duration", visible: false })
];

function props(extra: Partial<GanttChartProps> = {}): GanttChartProps {
    return {
        tasks: TASKS,
        loading: false,
        texts: DEFAULT_TEXTS,
        initialZoom: "day",
        snap: "day",
        rowHeight: 36,
        height: 400,
        gridWidth: 1000,
        showGrid: true,
        showToolbar: true,
        showToday: false,
        showWeekends: false,
        showLinks: false,
        criticalMode: "none",
        allowExport: false,
        exportFileName: "gantt",
        hasProgress: true,
        theme: "light",
        locale: "en-US",
        onChange: jest.fn(),
        calendar: ALL_DAYS,
        snapWorkingDays: false,
        autoSchedule: "none",
        allowUndo: true,
        inlineEdit: false,
        canEditName: false,
        hasDependencies: false,
        linkEditing: false,
        hasBaseline: false,
        hasAssignee: false,
        showWbs: false,
        showVariance: false,
        columnChooser: true,
        columnResize: false,
        extraColumns: [],
        showWorkload: false,
        workloadCapacity: 1,
        showFilter: false,
        exportCsv: false,
        printDetails: false,
        exportTitle: "",
        animate: false,
        motion: "off",
        layout: LAYOUT,
        ...extra
    };
}

const headers = (): string[] =>
    Array.from(document.querySelectorAll(".mxgantt-list-headrow [role=columnheader]")).map(
        header => header.textContent ?? ""
    );
const header = (title: string): HTMLElement =>
    Array.from(document.querySelectorAll<HTMLElement>(".mxgantt-list-headrow [role=columnheader]")).find(
        entry => entry.textContent === title
    )!;
const rowNames = (): string[] =>
    Array.from(document.querySelectorAll(".mxgantt-list-row .mxgantt-name")).map(name => name.textContent ?? "");
const row = (text: string): HTMLElement =>
    Array.from(document.querySelectorAll<HTMLElement>(".mxgantt-list-row")).find(entry =>
        entry.querySelector(".mxgantt-name")?.textContent?.startsWith(text)
    )!;
const cell = (rowText: string, title: string): HTMLElement =>
    row(rowText).querySelectorAll<HTMLElement>("[role=cell], [role=rowheader]")[headers().indexOf(title)];
const lastChanges = (onChange: jest.Mock): TaskChange[] => onChange.mock.calls[onChange.mock.calls.length - 1][0];

beforeEach(() => {
    jest.useFakeTimers();
    window.localStorage.clear();
    window.matchMedia = jest.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined
    }));
});
afterEach(() => {
    jest.useRealTimers();
});

describe("configured columns (1.2)", () => {
    it("shows Task name first, WBS before it and the rest in the configured order", () => {
        render(<GanttChart {...props()} />);
        expect(headers()).toEqual(["WBS", "Task", "Start", "Budget", "Status", "Notes"]);
    });

    it("leaves out the classic columns and the columns hidden at first", () => {
        render(<GanttChart {...props()} />);
        expect(headers()).not.toContain("End");
        expect(headers()).not.toContain("Duration");
    });

    it("keeps the classic columns while there is no layout", () => {
        render(<GanttChart {...props({ layout: undefined })} />);
        expect(headers()).toEqual(["Task", "Start", "End", "Duration", "Done"]);
    });

    it("shows the header tooltip, the cell class and wrapped text", () => {
        render(<GanttChart {...props()} />);
        expect(header("Budget").title).toBe("Approved budget");
        expect(cell("Task a", "Budget").classList.contains("is-over")).toBe(true);
        expect(cell("Task a", "Notes").classList.contains("is-wrap")).toBe(true);
    });

    it("totals the Budget of each group", () => {
        render(<GanttChart {...props()} />);
        expect(cell("Design", "Budget").textContent).toBe("1,500");
        expect(cell("Design", "Status").textContent).toBe("");
    });

    it("sorts ascending, then descending, then back to the original order, within groups", () => {
        render(<GanttChart {...props()} />);
        expect(rowNames()).toEqual(["Design", "Task a", "Task b", "Task c"]);
        const button = header("Start").querySelector("button")!;
        expect(header("Start").getAttribute("aria-sort")).toBe("none");
        fireEvent.click(button);
        expect(header("Start").getAttribute("aria-sort")).toBe("ascending");
        expect(rowNames()).toEqual(["Design", "Task b", "Task a", "Task c"]);
        fireEvent.click(button);
        expect(header("Start").getAttribute("aria-sort")).toBe("descending");
        expect(rowNames()).toEqual(["Task c", "Design", "Task a", "Task b"]);
        fireEvent.click(button);
        expect(header("Start").getAttribute("aria-sort")).toBe("none");
        expect(rowNames()).toEqual(["Design", "Task a", "Task b", "Task c"]);
    });

    it("puts tasks without a value last", () => {
        render(<GanttChart {...props()} />);
        fireEvent.click(header("Budget").querySelector("button")!);
        expect(rowNames()).toEqual(["Design", "Task b", "Task a", "Task c"]);
        fireEvent.click(header("Budget").querySelector("button")!);
        expect(rowNames()).toEqual(["Design", "Task a", "Task b", "Task c"]);
    });

    it("does not offer sorting on columns that are not sortable", () => {
        render(<GanttChart {...props()} />);
        expect(header("Status").querySelector("button.mxgantt-head-sort")).toBeNull();
        expect(header("Status").hasAttribute("aria-sort")).toBe(false);
        expect(header("Task").querySelector("button.mxgantt-head-sort")).toBeNull();
    });

    it("sorts by task name when that is allowed", () => {
        render(<GanttChart {...props({ nameSortable: true })} />);
        fireEvent.click(header("Task").querySelector("button")!);
        fireEvent.click(header("Task").querySelector("button")!);
        expect(rowNames()).toEqual(["Task c", "Design", "Task b", "Task a"]);
    });

    it("writes an edited attribute value as a cell value, with undo", () => {
        const onChange = jest.fn();
        render(<GanttChart {...props({ onChange })} />);
        fireEvent.doubleClick(cell("Task a", "Budget"));
        const input = cell("Task a", "Budget").querySelector("input")!;
        expect(input.type).toBe("number");
        expect(input.value).toBe("1000");
        expect(input.min).toBe("");
        fireEvent.change(input, { target: { value: "-20" } });
        fireEvent.keyDown(input, { key: "Enter" });
        expect(lastChanges(onChange)).toEqual([{ id: "a", next: { "cell:a1": -20 }, previous: { "cell:a1": 1000 } }]);
        act(() => {
            fireEvent.keyDown(document.querySelector(".mxgantt")!, { key: "z", ctrlKey: true });
        });
        expect(lastChanges(onChange)).toEqual([{ id: "a", next: { "cell:a1": 1000 }, previous: { "cell:a1": -20 } }]);
    });

    it("refuses a decimal number in a whole-number attribute", () => {
        const onChange = jest.fn();
        render(<GanttChart {...props({ onChange })} />);
        fireEvent.doubleClick(cell("Task b", "Budget"));
        const input = cell("Task b", "Budget").querySelector("input")!;
        fireEvent.change(input, { target: { value: "1.5" } });
        fireEvent.keyDown(input, { key: "Enter" });
        expect(screen.getByRole("alert").textContent).toBe(DEFAULT_TEXTS.invalidWholeNumber);
        expect(onChange).not.toHaveBeenCalled();
    });

    it("edits an enumeration with a list of its values", () => {
        const onChange = jest.fn();
        render(<GanttChart {...props({ onChange })} />);
        fireEvent.doubleClick(cell("Task a", "Status"));
        const select = cell("Task a", "Status").querySelector("select")!;
        expect(Array.from(select.options).map(option => option.textContent)).toEqual(["Open", "Done"]);
        fireEvent.change(select, { target: { value: "done" } });
        expect(lastChanges(onChange)).toEqual([
            { id: "a", next: { "cell:a3": "done" }, previous: { "cell:a3": "open" } }
        ]);
    });

    it("does not edit tasks that are read-only, or columns that are not editable", () => {
        const onChange = jest.fn();
        const tasks = TASKS.map(entry => (entry.id === "a" ? { ...entry, editable: false } : entry));
        render(<GanttChart {...props({ onChange, tasks })} />);
        fireEvent.doubleClick(cell("Task a", "Budget"));
        expect(cell("Task a", "Budget").querySelector("input")).toBeNull();
        fireEvent.doubleClick(cell("Task b", "Notes"));
        expect(cell("Task b", "Notes").querySelector("input")).toBeNull();
    });

    it("runs On task click for a plain cell but not for an editable one", () => {
        const onClick = jest.fn();
        render(<GanttChart {...props({ onClick })} />);
        fireEvent.click(cell("Task a", "Budget"));
        expect(onClick).not.toHaveBeenCalled();
        fireEvent.click(cell("Task a", "Notes"));
        expect(onClick).toHaveBeenCalledWith("a");
    });

    it("lets a dynamic cell class decide the colour", () => {
        render(<GanttChart {...props()} />);
        expect(cell("Task a", "Budget").classList.contains("has-class")).toBe(true);
        expect(cell("Task b", "Budget").classList.contains("has-class")).toBe(false);
    });

    it("keeps Users can hide = No columns out of the hide menu", () => {
        render(<GanttChart {...props()} />);
        const menuOf = (title: string): HTMLButtonElement | null =>
            header(title).querySelector<HTMLButtonElement>(".mxgantt-head-menu");
        expect(menuOf("Status")).toBeNull();
        expect(menuOf("Budget")).not.toBeNull();
    });

    it("lets Fill free space columns share the free width with Task name", () => {
        const layout = LAYOUT.map(entry => (entry.key === "a4" ? { ...entry, fill: true } : entry));
        render(<GanttChart {...props({ layout, gridWidth: 1200 })} />);
        const width = (title: string): number => parseFloat(header(title).style.width);
        expect(width("Notes")).toBeGreaterThan(100);
        expect(Math.abs(width("Notes") - width("Task"))).toBeLessThanOrEqual(1);
    });

    it("remembers the sort with Remember view", () => {
        const { unmount } = render(<GanttChart {...props({ viewKey: "layout-test" })} />);
        fireEvent.click(header("Start").querySelector("button")!);
        unmount();
        render(<GanttChart {...props({ viewKey: "layout-test" })} />);
        expect(header("Start").getAttribute("aria-sort")).toBe("ascending");
    });
});
