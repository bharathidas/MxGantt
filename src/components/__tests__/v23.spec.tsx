import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { formatBaselines, parseBaselines } from "../../utils/baselines";
import { ALL_DAYS } from "../../utils/calendar";
import { buildMspdi } from "../../utils/planExport";
import { parseAssignments, ResourceInfo } from "../../utils/resources";
import { parseSegments } from "../../utils/segments";
import { Task, withDependencies } from "../../utils/tasks";
import { DEFAULT_TEXTS } from "../../utils/texts";
import { GanttChart, GanttChartProps, TaskChange } from "../GanttChart";
import { Panel } from "../Panel";

const day = (d: number): Date => new Date(2026, 9, d);

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
        progress: 0,
        ...extra
    };
}

const resources = new Map<string, ResourceInfo>([
    ["Ann", { name: "Ann", maxUnits: 100, rate: 50 }],
    ["Bob", { name: "Bob", maxUnits: 100, rate: 80 }]
]);

const TASKS: Task[] = [
    task("a", 5, 7, {
        assignments: parseAssignments("Ann"),
        assignmentsText: "Ann",
        progress: 0,
        project: "Alpha",
        baselines: parseBaselines(
            formatBaselines([
                { name: "Approved", start: day(5), finish: day(7), saved: day(1) },
                { name: "Re-plan", start: day(6), finish: day(9), saved: day(2) }
            ])
        )
    }),
    task("b", 5, 7, {
        assignments: parseAssignments("Ann"),
        assignmentsText: "Ann",
        project: "Alpha",
        constraint: { type: "SNET", date: day(6) }
    }),
    withDependencies(
        task("c", 7, 12, {
            assignments: parseAssignments("Bob:50"),
            assignmentsText: "Bob:50",
            project: "Beta",
            fixedCost: 100,
            segments: parseSegments("0-1, 2-5"),
            segmentsText: "0-1, 2-5"
        }),
        "a"
    )
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
        gridWidth: 400,
        showGrid: true,
        showToolbar: true,
        showToday: false,
        showWeekends: false,
        showLinks: true,
        criticalMode: "off",
        allowExport: false,
        exportFileName: "gantt",
        hasProgress: true,
        theme: "light",
        onChange: jest.fn(),
        calendar: ALL_DAYS,
        snapWorkingDays: false,
        autoSchedule: "none",
        allowUndo: true,
        inlineEdit: true,
        canEditName: false,
        hasDependencies: true,
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
        showFilter: false,
        exportCsv: false,
        printDetails: false,
        exportTitle: "",
        animate: false,
        statusDate: day(8),
        motion: "off",
        hasAssignments: true,
        resources,
        showResources: true,
        resourceLeveling: true,
        hoursPerDay: 8,
        hasCost: true,
        showEarnedValue: true,
        costColumns: true,
        hasBaselines: true,
        hasSegments: true,
        hasConstraints: true,
        scheduleButton: true,
        showPortfolio: true,
        ...extra
    };
}

const bar = (id: string): HTMLElement => document.querySelector(`[data-row-id="${id}"].mxgantt-bar`) as HTMLElement;
const lastChanges = (onChange: jest.Mock): TaskChange[] => onChange.mock.calls[onChange.mock.calls.length - 1][0];

beforeEach(() => {
    jest.useFakeTimers();
    window.matchMedia = jest.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined
    }));
});

afterEach(() => {
    jest.useRealTimers();
});

describe("2.3 resources and levelling", () => {
    it("shows resource usage with over-allocation on the panel, the bars and the legend", () => {
        render(<GanttChart {...props()} />);
        const panel = screen.getByRole("region", { name: "Resource usage" });
        expect(within(panel).getByRole("button", { name: /Ann/ })).toBeTruthy();
        expect(panel.querySelector(".mxgantt-resource-row.is-over")).toBeTruthy();
        expect(panel.textContent).toContain("busiest day 200% of 100%");
        expect(bar("a").classList.contains("is-overallocated")).toBe(true);
        expect(bar("c").classList.contains("is-overallocated")).toBe(false);
        expect(document.querySelector(".mxgantt-legend")?.textContent).toContain("Over-allocated (2)");
        fireEvent.focus(bar("a"));
        expect(document.querySelector(".mxgantt-tooltip")?.textContent).toContain("Over-allocates Ann on 2 days");
    });

    it("highlights a resource's tasks", () => {
        render(<GanttChart {...props()} />);
        fireEvent.click(screen.getByRole("button", { name: /^Ann/ }));
        expect(document.querySelector(".mxgantt-canvas")?.classList.contains("has-chain")).toBe(true);
        expect(bar("a").classList.contains("is-chain")).toBe(true);
        expect(bar("c").classList.contains("is-chain")).toBe(false);
    });

    it("previews levelling and applies it as one change", () => {
        const onChange = jest.fn();
        render(<GanttChart {...props({ onChange })} />);
        fireEvent.click(screen.getByRole("button", { name: "Level resources" }));
        const region = screen.getByRole("region", { name: "Proposed changes" });
        expect(region.textContent).toContain("Levelling delays 1 tasks");
        expect(bar("b").classList.contains("is-pushed")).toBe(true);
        expect(onChange).not.toHaveBeenCalled();
        fireEvent.click(within(region).getByRole("button", { name: "Apply" }));
        expect(onChange).toHaveBeenCalledTimes(1);
        const changes = lastChanges(onChange);
        expect(changes.map(change => change.id)).toEqual(["b"]);
        expect(changes[0].next).toEqual({ start: day(7), end: day(9) });
        expect(screen.queryByRole("region", { name: "Proposed changes" })).toBeNull();
        // One undo step.
        fireEvent.click(screen.getByRole("button", { name: /Undo/ }));
        expect(lastChanges(onChange)[0].next).toEqual({ start: day(5), end: day(7) });
    });

    it("cancels a proposal without writing", () => {
        const onChange = jest.fn();
        render(<GanttChart {...props({ onChange })} />);
        fireEvent.click(screen.getByRole("button", { name: "Level resources" }));
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        expect(onChange).not.toHaveBeenCalled();
        expect(bar("b").classList.contains("is-pushed")).toBe(false);
    });

    it("edits assignments in the Resources column with validation", () => {
        const onChange = jest.fn();
        render(<GanttChart {...props({ onChange })} />);
        const cell = document.querySelector(
            '[aria-rowindex="3"] .mxgantt-cell-assignments, .mxgantt-cell-assignments'
        ) as HTMLElement;
        expect(cell).toBeTruthy();
        const rows = Array.from(document.querySelectorAll(".mxgantt-list-row"));
        const rowA = rows.find(row => row.textContent?.includes("Task a")) as HTMLElement;
        fireEvent.doubleClick(rowA.querySelector(".mxgantt-cell-assignments") as HTMLElement);
        const input = rowA.querySelector("input") as HTMLInputElement;
        fireEvent.change(input, { target: { value: "Ann:x" } });
        fireEvent.keyDown(input, { key: "Enter" });
        expect(screen.getByRole("alert").textContent).toContain("Name:50");
        fireEvent.change(input, { target: { value: "Ann:50,  Bob" } });
        fireEvent.keyDown(input, { key: "Enter" });
        expect(lastChanges(onChange)[0].next).toEqual({ assignments: "Ann:50, Bob" });
    });
});

describe("2.3 constraints and Schedule plan", () => {
    it("shows the constraint indicator, flags a broken one and explains it", () => {
        render(<GanttChart {...props()} />);
        const label = document.querySelectorAll(".mxgantt-constraint");
        expect(label).toHaveLength(1);
        expect(label[0].classList.contains("is-broken")).toBe(true);
        fireEvent.focus(bar("b"));
        const tip = document.querySelector(".mxgantt-tooltip")?.textContent ?? "";
        expect(tip).toContain("Start no earlier than");
        expect(tip).toContain("Breaks its constraint by 1 days");
        expect(bar("b").getAttribute("aria-label")).toContain("Constraint: Start no earlier than");
    });

    it("schedules the plan with constraints and links", () => {
        const onChange = jest.fn();
        render(<GanttChart {...props({ onChange })} />);
        fireEvent.click(screen.getByRole("button", { name: "Schedule plan" }));
        fireEvent.click(screen.getByRole("button", { name: "Apply" }));
        const changes = lastChanges(onChange);
        expect(changes.find(change => change.id === "b")?.next).toEqual({ start: day(6), end: day(8) });
    });
});

describe("2.3 split tasks", () => {
    it("draws the segments with a gap and describes them", () => {
        render(<GanttChart {...props()} />);
        const pieces = bar("c").querySelectorAll(".mxgantt-split-piece");
        expect(pieces).toHaveLength(2);
        expect(bar("c").classList.contains("is-split")).toBe(true);
        expect(pieces[1].getAttribute("data-mode")).toBe("segment");
        expect(bar("c").getAttribute("aria-label")).toContain("2 segments, 4 d of work");
    });

    it("splits and joins from the task menu, and moves the last segment with Alt + arrow", () => {
        const onChange = jest.fn();
        render(<GanttChart {...props({ onChange })} />);
        fireEvent.contextMenu(bar("a"));
        fireEvent.click(screen.getByRole("menuitem", { name: "Split task" }));
        expect(lastChanges(onChange)[0].next).toEqual({ end: day(8), segments: "0-1, 2-3" });
        fireEvent.contextMenu(bar("c"));
        fireEvent.click(screen.getByRole("menuitem", { name: "Join segments" }));
        expect(lastChanges(onChange)[0].next).toEqual({ end: day(11), segments: "" });
        fireEvent.keyDown(bar("c"), { key: "ArrowRight", altKey: true });
        expect(lastChanges(onChange)[0].next).toEqual({ end: day(13), segments: "0-1, 3-6" });
    });

    it("drags a segment later", () => {
        const onChange = jest.fn();
        render(<GanttChart {...props({ onChange })} />);
        const piece = bar("c").querySelectorAll(".mxgantt-split-piece")[1] as HTMLElement;
        // jsdom has no PointerEvent; mouse events with the pointer event names reach React the same way.
        fireEvent(piece, new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 100 }));
        fireEvent(bar("c"), new MouseEvent("pointermove", { bubbles: true, clientX: 180 }));
        fireEvent(bar("c"), new MouseEvent("pointerup", { bubbles: true, clientX: 180 }));
        const change = lastChanges(onChange)[0];
        expect(change.next.segments).toBe("0-1, 4-7");
        expect(change.next.end).toEqual(day(14));
    });
});

describe("2.3 baselines", () => {
    it("shows, compares, saves and deletes named baselines", () => {
        const onChange = jest.fn();
        render(<GanttChart {...props({ onChange })} />);
        fireEvent.click(screen.getByRole("button", { name: "Baselines" }));
        const panel = screen.getByRole("region", { name: "Baselines" });
        const show = within(panel).getByRole("combobox", { name: "Show baseline" }) as HTMLSelectElement;
        // The latest saved baseline is shown by default.
        expect(show.value).toBe("Re-plan");
        expect(document.querySelectorAll(".mxgantt-baseline:not(.mxgantt-baseline2)")).toHaveLength(1);
        fireEvent.change(show, { target: { value: "Approved" } });
        fireEvent.change(within(panel).getByRole("combobox", { name: "Compare with" }), {
            target: { value: "Re-plan" }
        });
        expect(panel.textContent).toContain("Approved compared with Re-plan");
        expect(panel.querySelector("tbody")?.textContent).toContain("+2");
        expect(document.querySelectorAll(".mxgantt-baseline2")).toHaveLength(1);
        expect(document.querySelector(".mxgantt-legend")?.textContent).toContain("Compared baseline: Re-plan");
        fireEvent.change(within(panel).getByRole("textbox", { name: "Baseline name" }), { target: { value: "Q4" } });
        fireEvent.click(within(panel).getByRole("button", { name: "Save current plan as baseline" }));
        const saved = lastChanges(onChange);
        expect(saved).toHaveLength(3);
        expect(parseBaselines(saved[0].next.baselines).map(entry => entry.name)).toEqual(["Approved", "Re-plan", "Q4"]);
        expect(saved[2].next.baselines).toContain('"cost":');
        // The data source has not delivered Q4 yet (onChange is a mock), so the latest baseline, Re-plan, is shown.
        expect(show.value).toBe("Re-plan");
        fireEvent.click(within(panel).getByRole("button", { name: "Delete baseline" }));
        fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete baseline" }));
        expect(parseBaselines(lastChanges(onChange)[0].next.baselines).map(entry => entry.name)).toEqual(["Approved"]);
    });

    it("keeps the 2.0 attribute baseline when no named baseline is configured", () => {
        const plain = [task("x", 5, 9, { baselineStart: day(5), baselineEnd: day(8) })];
        render(<GanttChart {...props({ tasks: plain, hasBaselines: false, hasBaseline: true })} />);
        expect(document.querySelectorAll(".mxgantt-baseline")).toHaveLength(1);
        expect(screen.queryByRole("button", { name: "Baselines" })).toBeNull();
    });
});

describe("2.3 cost, earned value and portfolio", () => {
    it("shows the EVM tiles, the S-curve with a table, and cost columns", () => {
        render(<GanttChart {...props()} />);
        const panel = screen.getByRole("region", { name: "Earned value" });
        expect(panel.querySelectorAll(".mxgantt-ev-tile")).toHaveLength(11);
        expect(panel.textContent).toContain("Estimate at completion (EAC)");
        const chart = panel.querySelector("svg[role=img]") as SVGElement;
        expect(chart.querySelector("title")?.textContent).toBe("S-curve");
        expect(chart.querySelectorAll(".mxgantt-scurve-line")).toHaveLength(4);
        fireEvent.keyDown(chart, { key: "ArrowRight" });
        expect(panel.querySelector(".mxgantt-scurve-tip")?.textContent).toContain("Planned value");
        fireEvent.click(within(panel).getByRole("button", { name: "Show the numbers" }));
        expect(panel.querySelector(".mxgantt-scurve-table table")).toBeTruthy();
        const heads = Array.from(document.querySelectorAll("[role=columnheader]")).map(head => head.textContent);
        expect(heads).toEqual(expect.arrayContaining(["Cost", "EV", "CPI", "SPI"]));
        expect(heads).not.toContain("BAC");
        fireEvent.focus(bar("c"));
        expect(document.querySelector(".mxgantt-tooltip")?.textContent).toContain("Cost");
    });

    it("lays out projects with a portfolio health table", () => {
        render(<GanttChart {...props()} />);
        const projectRows = document.querySelectorAll(".mxgantt-list-project");
        expect(projectRows).toHaveLength(2);
        const table = screen.getByRole("region", { name: "Portfolio" });
        expect(table.querySelectorAll("tbody tr")).toHaveLength(2);
        expect(table.textContent).toMatch(/On track|At risk|Off track/);
        expect(document.querySelector(".mxgantt-link.is-cross")).toBeTruthy();
        // Collapse Alpha, then jump to it from the table: it opens and gets focus.
        fireEvent.click(document.querySelector(".mxgantt-list-project .mxgantt-toggle") as HTMLElement);
        fireEvent.click(within(table).getByRole("button", { name: "Alpha" }));
        expect(document.activeElement?.getAttribute("data-row-id")).toBe("project:Alpha");
    });
});

describe("2.3 import, saving and errors", () => {
    it("reads an MS Project file, previews it and hands it over", async () => {
        const onImport = jest.fn();
        render(<GanttChart {...props({ onImport })} />);
        const xml = buildMspdi(TASKS, { name: "From Project" });
        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        const file = new File([xml], "plan.xml", { type: "application/xml" });
        Object.defineProperty(file, "text", { value: () => Promise.resolve(xml) });
        await act(async () => {
            fireEvent.change(input, { target: { files: [file] } });
            await Promise.resolve();
            await Promise.resolve();
        });
        const dialog = screen.getByRole("dialog", { name: "Import from MS Project" });
        expect(dialog.textContent).toContain("From Project: 3 tasks");
        fireEvent.click(within(dialog).getByRole("button", { name: "Import" }));
        expect(onImport).toHaveBeenCalledWith(expect.objectContaining({ name: "From Project" }));
    });

    it("explains a file that is not Project XML", async () => {
        render(<GanttChart {...props({ onImport: jest.fn() })} />);
        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        const file = new File(["<html/>"], "x.xml");
        Object.defineProperty(file, "text", { value: () => Promise.resolve("<html/>") });
        await act(async () => {
            fireEvent.change(input, { target: { files: [file] } });
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(screen.getByRole("alert").textContent).toContain("could not be read");
    });

    it("shows saving and failed saves with retry", () => {
        const onRetry = jest.fn();
        const { rerender } = render(
            <GanttChart {...props({ saveState: { saving: true, failed: 0, onRetry, onDismiss: jest.fn() } })} />
        );
        expect(screen.getByText("Saving…")).toBeTruthy();
        rerender(<GanttChart {...props({ saveState: { saving: false, failed: 2, onRetry, onDismiss: jest.fn() } })} />);
        const alert = screen.getByRole("alert");
        expect(alert.textContent).toContain("2 changes could not be saved");
        fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
        expect(onRetry).toHaveBeenCalled();
    });

    it("keeps a failing panel from taking the chart down", () => {
        const Boom = (): never => {
            throw new Error("boom");
        };
        const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
        render(
            <Panel texts={DEFAULT_TEXTS} title="Test">
                <Boom />
            </Panel>
        );
        expect(screen.getByRole("alert").textContent).toBe("This panel could not be shown.");
        fireEvent.click(screen.getByRole("button", { name: "Hide Test" }));
        expect(screen.getByRole("button", { name: "Show Test" }).getAttribute("aria-expanded")).toBe("false");
        spy.mockRestore();
    });

    it("renders right to left without moving the time axis", () => {
        render(
            <div dir="rtl">
                <GanttChart {...props()} />
            </div>
        );
        expect(bar("a")).toBeTruthy();
        expect(document.querySelectorAll(".mxgantt-bar-task").length).toBeGreaterThan(0);
    });
});
