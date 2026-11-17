import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { ALL_DAYS } from "../../utils/calendar";
import { FieldDef, parseValues } from "../../utils/fields";
import { Task } from "../../utils/tasks";
import { DEFAULT_TEXTS } from "../../utils/texts";
import { CustomFieldsSetup, GanttChart, GanttChartProps, TaskChange } from "../GanttChart";

const day = (d: number): Date => new Date(2026, 9, d);

const FIELDS: FieldDef[] = [
    {
        key: "risk",
        name: "Risk",
        type: "select",
        options: [
            { id: "low", label: "Low", color: "#15803d" },
            { id: "high", label: "High", color: "#d92d20" }
        ],
        onBar: true
    },
    { key: "budget", name: "Budget", type: "number", format: "currency", currency: "EUR", decimals: 0 },
    { key: "approved", name: "Approved", type: "checkbox" },
    { key: "left", name: "Left", type: "formula", formula: "[budget] * (100 - [_progress]) / 100" }
];

function task(id: string, values: string, extra: Partial<Task> = {}): Task {
    return {
        id,
        key: id,
        name: `Task ${id}`,
        start: day(5),
        end: day(9),
        milestone: false,
        deps: [],
        editable: true,
        progress: 50,
        fieldsText: values,
        fieldValues: parseValues(values),
        ...extra
    };
}

const TASKS = [task("a", '{"risk":"high","budget":1000}'), task("b", '{"approved":true}')];

function setup(extra: Partial<CustomFieldsSetup> = {}): CustomFieldsSetup {
    return {
        fields: FIELDS,
        canManage: true,
        canEditValues: true,
        maxFields: 30,
        showHint: true,
        onFieldsChange: jest.fn(),
        ...extra
    };
}

function props(extra: Partial<GanttChartProps> = {}): GanttChartProps {
    return {
        tasks: TASKS,
        loading: false,
        texts: DEFAULT_TEXTS,
        initialZoom: "day",
        snap: "day",
        rowHeight: 36,
        height: 400,
        gridWidth: 900,
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
        columnChooser: false,
        columnResize: false,
        extraColumns: [],
        showWorkload: false,
        workloadCapacity: 1,
        showFilter: true,
        exportCsv: false,
        printDetails: false,
        exportTitle: "",
        animate: false,
        motion: "off",
        customFields: setup(),
        ...extra
    };
}

const lastChanges = (onChange: jest.Mock): TaskChange[] => onChange.mock.calls[onChange.mock.calls.length - 1][0];
const cell = (row: string, column: string): HTMLElement => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>(".mxgantt-list-row"));
    const target = rows.find(r => r.textContent?.includes(`Task ${row}`))!;
    const index = Array.from(document.querySelectorAll(".mxgantt-list-headrow [role=columnheader]")).findIndex(
        header => header.textContent === column
    );
    return target.querySelectorAll<HTMLElement>("[role=cell], [role=rowheader]")[index];
};

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

describe("custom fields in the task list", () => {
    it("shows a column per field with chips, money, checkboxes and formulas", () => {
        render(<GanttChart {...props()} />);
        const headers = Array.from(document.querySelectorAll(".mxgantt-list-headrow [role=columnheader]")).map(
            h => h.textContent
        );
        expect(headers).toEqual(expect.arrayContaining(["Risk", "Budget", "Approved", "Left"]));
        expect(cell("a", "Risk").textContent).toBe("High");
        expect(cell("a", "Budget").textContent).toBe("€1,000");
        expect(cell("a", "Left").textContent).toBe("500");
        expect(within(cell("b", "Approved")).getByRole("checkbox").getAttribute("aria-checked")).toBe("true");
        // Risk is shown on the bars.
        expect(document.querySelector(".mxgantt-bar-fields")?.textContent).toContain("High");
    });

    it("toggles a checkbox with one click and writes the values JSON", () => {
        const onChange = jest.fn();
        render(<GanttChart {...props({ onChange })} />);
        fireEvent.click(within(cell("a", "Approved")).getByRole("checkbox"));
        const [change] = lastChanges(onChange);
        expect(change.id).toBe("a");
        expect(JSON.parse(change.next.fields!)).toEqual({ risk: "high", budget: 1000, approved: true });
        expect(change.previous.fields).toBe('{"risk":"high","budget":1000}');
    });

    it("edits a number with the keyboard and a select from its list", () => {
        const onChange = jest.fn();
        render(<GanttChart {...props({ onChange })} />);
        fireEvent.doubleClick(cell("b", "Budget"));
        const input = cell("b", "Budget").querySelector("input")!;
        fireEvent.change(input, { target: { value: "lots" } });
        fireEvent.keyDown(input, { key: "Enter" });
        expect(screen.getByRole("alert").textContent).toBe(DEFAULT_TEXTS.invalidFieldNumber);
        fireEvent.change(input, { target: { value: "2,500" } });
        fireEvent.keyDown(input, { key: "Enter" });
        expect(JSON.parse(lastChanges(onChange)[0].next.fields!)).toEqual({ approved: true, budget: 2500 });

        fireEvent.doubleClick(cell("b", "Risk"));
        const search = within(cell("b", "Risk")).getByRole("combobox");
        fireEvent.keyDown(search, { key: "ArrowDown" });
        fireEvent.keyDown(search, { key: "Enter" });
        expect(JSON.parse(lastChanges(onChange)[0].next.fields!).risk).toBe("high");
    });

    it("leaves values read-only on locked tasks and when values cannot be written", () => {
        const onChange = jest.fn();
        const { unmount } = render(
            <GanttChart {...props({ onChange, tasks: [task("a", "", { editable: false }), TASKS[1]] })} />
        );
        fireEvent.doubleClick(cell("a", "Budget"));
        expect(cell("a", "Budget").querySelector("input")).toBeNull();
        unmount();
        render(<GanttChart {...props({ onChange, customFields: setup({ canEditValues: false }) })} />);
        expect(within(cell("b", "Approved")).queryByRole("button")).toBeNull();
    });

    it("adds a field from the + in the header", () => {
        const onFieldsChange = jest.fn();
        render(<GanttChart {...props({ customFields: setup({ fields: [], onFieldsChange }) })} />);
        // The first-time hint is shown while there are no fields.
        expect(screen.getByText(DEFAULT_TEXTS.hintTitle)).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: DEFAULT_TEXTS.addField }));
        const dialog = screen.getByRole("dialog", { name: DEFAULT_TEXTS.addFieldTitle });
        fireEvent.change(within(dialog).getByLabelText(DEFAULT_TEXTS.fieldName), { target: { value: "Priority" } });
        fireEvent.click(within(dialog).getByRole("radio", { name: DEFAULT_TEXTS.typeSelect }));
        const choices = within(dialog).getAllByPlaceholderText(DEFAULT_TEXTS.optionPlaceholder);
        expect(choices).toHaveLength(3);
        ["P1", "P2", "P3"].forEach((label, index) => fireEvent.change(choices[index], { target: { value: label } }));
        fireEvent.click(within(dialog).getByRole("button", { name: DEFAULT_TEXTS.createField }));
        const [fields] = onFieldsChange.mock.calls[0];
        expect(fields).toHaveLength(1);
        expect(fields[0]).toMatchObject({ key: "priority", name: "Priority", type: "select" });
        expect(fields[0].options.map((o: { label: string }) => o.label)).toEqual(["P1", "P2", "P3"]);
    });

    it("refuses an empty or duplicate name", () => {
        const onFieldsChange = jest.fn();
        render(<GanttChart {...props({ customFields: setup({ onFieldsChange }) })} />);
        fireEvent.click(screen.getByRole("button", { name: DEFAULT_TEXTS.addField }));
        const dialog = screen.getByRole("dialog");
        fireEvent.click(within(dialog).getByRole("button", { name: DEFAULT_TEXTS.createField }));
        expect(within(dialog).getByRole("alert").textContent).toBe(DEFAULT_TEXTS.nameRequired);
        fireEvent.change(within(dialog).getByLabelText(DEFAULT_TEXTS.fieldName), { target: { value: "budget" } });
        fireEvent.click(within(dialog).getByRole("button", { name: DEFAULT_TEXTS.createField }));
        expect(within(dialog).getByRole("alert").textContent).toBe("There is already a column called budget");
        expect(onFieldsChange).not.toHaveBeenCalled();
    });

    it("changes a field's type with a conversion preview and converts the values", () => {
        const onFieldsChange = jest.fn();
        const onChange = jest.fn();
        render(<GanttChart {...props({ onChange, customFields: setup({ onFieldsChange }) })} />);
        fireEvent.click(screen.getByRole("button", { name: "Options for Risk" }));
        fireEvent.click(screen.getByRole("menuitem", { name: DEFAULT_TEXTS.editField }));
        act(() => {
            jest.runOnlyPendingTimers();
        });
        const dialog = screen.getByRole("dialog", { name: DEFAULT_TEXTS.editFieldTitle });
        fireEvent.click(within(dialog).getByRole("radio", { name: DEFAULT_TEXTS.typeText }));
        expect(within(dialog).getByRole("status").textContent).toContain("converts 1 values; 0 cannot");
        fireEvent.click(within(dialog).getByRole("button", { name: DEFAULT_TEXTS.saveField }));
        expect(onFieldsChange.mock.calls[0][0][0]).toMatchObject({ key: "risk", type: "text" });
        expect(JSON.parse(lastChanges(onChange)[0].next.fields!).risk).toBe("High");
    });

    it("deletes a field after confirmation and hides one from the header menu", () => {
        const onFieldsChange = jest.fn();
        render(<GanttChart {...props({ customFields: setup({ onFieldsChange }) })} />);
        fireEvent.click(screen.getByRole("button", { name: "Options for Budget" }));
        fireEvent.click(screen.getByRole("menuitem", { name: DEFAULT_TEXTS.deleteField }));
        const confirm = screen.getByRole("alertdialog");
        fireEvent.click(within(confirm).getByRole("button", { name: DEFAULT_TEXTS.deleteField }));
        expect(onFieldsChange.mock.calls[0][0].map((f: FieldDef) => f.key)).toEqual(["risk", "approved", "left"]);

        fireEvent.click(screen.getByRole("button", { name: "Options for Approved" }));
        fireEvent.click(screen.getByRole("menuitem", { name: DEFAULT_TEXTS.hideColumn }));
        const headers = Array.from(document.querySelectorAll(".mxgantt-list-headrow [role=columnheader]")).map(
            h => h.textContent
        );
        expect(headers).not.toContain("Approved");
    });

    it("lets users without the right only fill in values", () => {
        render(<GanttChart {...props({ customFields: setup({ canManage: false }) })} />);
        expect(screen.queryByRole("button", { name: DEFAULT_TEXTS.addField })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Options for Risk" }));
        expect(screen.queryByRole("menuitem", { name: DEFAULT_TEXTS.deleteField })).toBeNull();
        expect(screen.getByRole("menuitem", { name: DEFAULT_TEXTS.hideColumn })).toBeTruthy();
    });

    it("chooses, reorders and resets columns in the Columns panel", () => {
        render(<GanttChart {...props()} />);
        fireEvent.click(screen.getByRole("button", { name: DEFAULT_TEXTS.columns }));
        const panel = screen.getByRole("dialog", { name: DEFAULT_TEXTS.columnsTitle });
        const order = (): string[] =>
            Array.from(document.querySelectorAll(".mxgantt-list-headrow [role=columnheader]"))
                .map(h => h.textContent ?? "")
                .filter(Boolean);
        fireEvent.click(within(panel).getByRole("checkbox", { name: "Duration" }));
        expect(order()).not.toContain("Duration");
        const risk = within(panel).getByRole("checkbox", { name: "Risk" });
        // Alt + Up moves Risk up step by step until it sits right after Task.
        for (let i = 0; i < 4; i++) {
            fireEvent.keyDown(within(panel).getByRole("checkbox", { name: "Risk" }), { key: "ArrowUp", altKey: true });
        }
        expect(risk).toBeTruthy();
        expect(order().slice(0, 2)).toEqual(["Task", "Risk"]);
        fireEvent.change(within(panel).getByRole("searchbox"), { target: { value: "bud" } });
        expect(within(panel).getAllByRole("checkbox")).toHaveLength(1);
        fireEvent.click(within(panel).getByRole("button", { name: DEFAULT_TEXTS.columnsReset }));
        expect(order()).toContain("Duration");
        expect(order()[1]).toBe("Start");
    });

    it("filters and searches by field values", () => {
        render(<GanttChart {...props()} />);
        const select = screen.getByRole("combobox", { name: DEFAULT_TEXTS.fieldFilter }) as HTMLSelectElement;
        fireEvent.change(select, { target: { value: "approved=true" } });
        expect(document.querySelectorAll(".mxgantt-list-row")).toHaveLength(1);
        fireEvent.change(select, { target: { value: "" } });
        fireEvent.change(screen.getByRole("searchbox", { name: DEFAULT_TEXTS.search }), { target: { value: "high" } });
        const rows = Array.from(document.querySelectorAll(".mxgantt-list-row")).map(r => r.textContent);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toContain("Task a");
    });
});
