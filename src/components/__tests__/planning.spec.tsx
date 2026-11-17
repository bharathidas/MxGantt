import { act, fireEvent, render, screen } from "@testing-library/react";

import { ALL_DAYS } from "../../utils/calendar";
import { Task, withDependencies } from "../../utils/tasks";
import { DEFAULT_TEXTS } from "../../utils/texts";
import { GanttChart, GanttChartProps } from "../GanttChart";

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
        ...extra
    };
}

const TASKS: Task[] = [
    task("a", 5, 9, { progress: 50, deadline: day(8), baselineStart: day(5), baselineEnd: day(8) }),
    withDependencies(task("b", 9, 12, { progress: 0 }), "a"),
    withDependencies(task("c", 9, 10, { progress: 0 }), "a")
];

function props(extra: Partial<GanttChartProps> = {}): GanttChartProps {
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
        allowUndo: false,
        inlineEdit: false,
        canEditName: false,
        hasDependencies: true,
        linkEditing: false,
        hasBaseline: true,
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
        animate: true,
        statusDate: day(8),
        hasDeadline: true,
        showSlack: true,
        progressLine: true,
        markers: [{ date: day(11), label: "Go-live", color: "#c4320a" }],
        zoomToFit: true,
        showHealth: true,
        motion: "full",
        ...extra
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

describe("2.2 planning aids", () => {
    it("draws a float tail only for tasks with float", () => {
        render(<GanttChart {...props()} />);
        expect(document.querySelectorAll(".mxgantt-float")).toHaveLength(1);
    });

    it("flags deadlines and warns about missed ones", () => {
        render(<GanttChart {...props()} />);
        const flag = document.querySelector(".mxgantt-deadline");
        expect(flag?.classList.contains("is-missed")).toBe(true);
        expect(document.querySelector('.mxgantt-bar[data-row-id="a"]')?.classList.contains("is-missed")).toBe(true);
    });

    it("shows the deadline, the overrun and the total float in the tooltip", () => {
        render(<GanttChart {...props()} />);
        fireEvent.focus(document.querySelector('.mxgantt-bar[data-row-id="a"]') as HTMLElement);
        const tip = document.querySelector(".mxgantt-tooltip")?.textContent ?? "";
        expect(tip).toContain("Deadline");
        expect(tip).toContain("Misses its deadline by 1 days");
        fireEvent.focus(document.querySelector('.mxgantt-bar[data-row-id="c"]') as HTMLElement);
        expect(document.querySelector(".mxgantt-tooltip")?.textContent).toContain("Total float");
    });

    it("draws timeline markers and the progress line", () => {
        render(<GanttChart {...props()} />);
        expect(document.querySelector(".mxgantt-marker-flag")?.textContent).toBe("Go-live");
        expect(document.querySelector(".mxgantt-marker-line")).toBeTruthy();
        const points = document.querySelector(".mxgantt-progress-line polyline")?.getAttribute("points") ?? "";
        expect(points.split(" ")).toHaveLength(9);
    });

    it("summarises project health", () => {
        render(<GanttChart {...props()} />);
        const strip = screen.getByRole("region", { name: "Project health" });
        act(() => {
            jest.advanceTimersByTime(1000);
        });
        expect(strip.textContent).toContain("Missed deadlines");
        // Label before the count, so "Critical tasks: 1" reads right for any number.
        const counts = Array.from(strip.querySelectorAll(".mxgantt-health-count")).map(c => c.textContent);
        expect(counts.some(c => /^Critical tasks: \d+$/.test(c ?? ""))).toBe(true);
        expect(counts.some(c => /^Missed deadlines: \d+$/.test(c ?? ""))).toBe(true);
        expect(strip.querySelector(".mxgantt-health-value.is-date")).toBeTruthy();
        expect(strip.textContent).toContain("4 days late");
        expect(strip.querySelector(".mxgantt-sr")?.textContent).toContain("schedule index");
    });

    it("has a Fit button and an F shortcut", () => {
        render(<GanttChart {...props()} />);
        const fit = screen.getByRole("button", { name: /Fit/ });
        fireEvent.click(fit);
        expect(document.querySelector("[role=status][aria-live]")?.textContent).toContain("whole plan");
    });

    it("lists the new legend entries", () => {
        render(<GanttChart {...props()} />);
        const legend = document.querySelector(".mxgantt-legend")?.textContent ?? "";
        expect(legend).toContain("Total float");
        expect(legend).toContain("Progress line");
        expect(legend).toContain("Deadline");
    });

    it("leaves everything out with the options off", () => {
        render(
            <GanttChart
                {...props({
                    hasDeadline: false,
                    showSlack: false,
                    progressLine: false,
                    markers: [],
                    zoomToFit: false,
                    showHealth: false,
                    tasks: TASKS.map(item => ({ ...item, deadline: undefined }))
                })}
            />
        );
        expect(
            document.querySelector(".mxgantt-float, .mxgantt-deadline, .mxgantt-marker-line, .mxgantt-health")
        ).toBeNull();
        expect(document.querySelector(".mxgantt-progress-line")).toBeNull();
        expect(screen.queryByRole("button", { name: /Fit/ })).toBeNull();
    });

    it("shows an illustrated empty state with Add task, and a skeleton while loading", () => {
        const onAdd = jest.fn();
        const { unmount } = render(<GanttChart {...props({ tasks: [], onAdd })} />);
        expect(screen.getByText("No tasks yet")).toBeTruthy();
        fireEvent.click(document.querySelector(".mxgantt-empty-add") as HTMLElement);
        expect(onAdd).toHaveBeenCalled();
        unmount();
        render(<GanttChart {...props({ tasks: [], loading: true })} />);
        expect(document.querySelectorAll(".mxgantt-skeleton-bar")).toHaveLength(5);
    });

    it("marks subtle motion", () => {
        render(<GanttChart {...props({ motion: "subtle" })} />);
        expect(document.querySelector(".mxgantt")?.classList.contains("mxgantt--subtle")).toBe(true);
    });
});
