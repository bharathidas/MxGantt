import { act, fireEvent, render, screen } from "@testing-library/react";

import { ALL_DAYS } from "../../utils/calendar";
import { Task } from "../../utils/tasks";
import { DEFAULT_TEXTS } from "../../utils/texts";
import { GanttChart, GanttChartProps, TaskChange } from "../GanttChart";

const day = (d: number): Date => new Date(2026, 9, d);

const TASKS: Task[] = [
    { id: "a", name: "Alpha", start: day(5), end: day(7), milestone: false, deps: [], editable: true, progress: 10 },
    { id: "b", name: "Beta", start: day(8), end: day(9), milestone: false, deps: [], editable: true, progress: 0 }
];

function props(onChange: (changes: TaskChange[]) => void): GanttChartProps {
    return {
        tasks: TASKS,
        loading: false,
        texts: DEFAULT_TEXTS,
        initialZoom: "week",
        snap: "day",
        rowHeight: 36,
        height: 400,
        gridWidth: 400,
        showGrid: true,
        showToolbar: true,
        showToday: true,
        showWeekends: true,
        showLinks: false,
        criticalMode: "none",
        allowExport: false,
        exportFileName: "gantt",
        hasProgress: true,
        theme: "light",
        onChange,
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
        showFilter: false,
        exportCsv: false,
        printDetails: false,
        exportTitle: "",
        scenarioMode: true,
        animate: true
    };
}

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

function bar(id: string): HTMLElement {
    return document.querySelector<HTMLElement>(`.mxgantt-bar[data-row-id="${id}"]`)!;
}

function nudge(id: string): void {
    fireEvent.keyDown(bar(id), { key: "ArrowRight" });
    // Key presses are saved after a short pause.
    act(() => {
        jest.advanceTimersByTime(1000);
    });
}

describe("what-if scenario mode", () => {
    it("keeps changes in the widget until Apply writes them in one batch", () => {
        const onChange = jest.fn();
        render(<GanttChart {...props(onChange)} />);
        fireEvent.click(screen.getByRole("button", { name: /Plan a scenario/ }));
        expect(screen.getByRole("region", { name: "Scenario" })).toBeTruthy();

        nudge("a");
        expect(onChange).not.toHaveBeenCalled();
        expect(bar("a").classList.contains("is-scenario")).toBe(true);
        expect(bar("a").getAttribute("aria-label")).toContain("Changed in this scenario");
        expect(screen.getByRole("region", { name: "Scenario" }).textContent).toContain("1 tasks moved");

        fireEvent.click(screen.getByRole("button", { name: "Apply" }));
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange.mock.calls[0][0]).toEqual([
            {
                id: "a",
                next: { start: day(6), end: day(8) },
                previous: { start: day(5), end: day(7) }
            }
        ]);
        expect(screen.queryByRole("region", { name: "Scenario" })).toBeNull();
    });

    it("writes nothing when the scenario is discarded", () => {
        const onChange = jest.fn();
        render(<GanttChart {...props(onChange)} />);
        fireEvent.click(screen.getByRole("button", { name: /Plan a scenario/ }));
        nudge("a");
        fireEvent.click(screen.getByRole("button", { name: "Discard" }));
        expect(onChange).not.toHaveBeenCalled();
        expect(bar("a").classList.contains("is-scenario")).toBe(false);
    });

    it("asks before the toggle throws changes away", () => {
        const onChange = jest.fn();
        render(<GanttChart {...props(onChange)} />);
        const toggle = screen.getByRole("button", { name: /Plan a scenario/ });
        fireEvent.click(toggle);
        nudge("a");
        fireEvent.click(toggle);
        expect(screen.getByRole("alertdialog")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        expect(screen.getByRole("region", { name: "Scenario" })).toBeTruthy();
    });

    it("writes straight away outside a scenario", () => {
        const onChange = jest.fn();
        render(<GanttChart {...props(onChange)} />);
        nudge("a");
        expect(onChange).toHaveBeenCalledTimes(1);
    });
});
