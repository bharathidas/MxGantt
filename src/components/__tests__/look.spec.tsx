import { render } from "@testing-library/react";

import { ALL_DAYS } from "../../utils/calendar";
import { STANDARD_LOOK, TimelineLook } from "../../utils/look";
import { Task } from "../../utils/tasks";
import { DEFAULT_TEXTS } from "../../utils/texts";
import { scaleCells, makeFormatters, timelineRange } from "../../utils/time";
import { GanttChart, GanttChartProps } from "../GanttChart";

const month = (y: number, m: number): Date => new Date(y, m - 1, 1);

function project(id: string, extra: Partial<Task> = {}): Task {
    return {
        id,
        key: id,
        name: `Project ${id}`,
        start: month(2024, 1),
        end: month(2027, 5),
        progress: 45,
        milestone: false,
        deps: [],
        editable: false,
        ...extra
    };
}

const TASKS: Task[] = [
    project("a", {
        group: "Grid technologies",
        code: "01.01",
        subtitle: "Lukas Becker · PM400",
        baselineStart: month(2024, 1),
        baselineEnd: month(2026, 11),
        deadline: month(2026, 11),
        state: 1,
        color: "#e5242b"
    }),
    project("b", { group: "Grid technologies", code: "01.02", subtitle: "Sophie Wagner · PM400" })
];

const LOOK: TimelineLook = {
    portfolio: true,
    twoLine: true,
    barLabel: "finishProgress",
    dateFormat: "MM.yyyy",
    baselineOutline: true,
    deadlineDiamond: true,
    todayLabel: true,
    barLegend: true,
    states: [
        { value: "ontrack", color: "#451f6b", caption: "" },
        { value: "short", color: "#e5242b", caption: "Bar red: capacity need will not be met" }
    ]
};

function props(extra: Partial<GanttChartProps> = {}): GanttChartProps {
    return {
        tasks: TASKS,
        loading: false,
        texts: {
            ...DEFAULT_TEXTS,
            legendProgress: "Progress (actual %)",
            legendRemaining: "Remaining to forecast",
            legendBaseline: "I-App baseline",
            legendDeadline: "Business need"
        },
        initialZoom: "year",
        snap: "day",
        rowHeight: 64,
        height: 500,
        gridWidth: 420,
        showGrid: true,
        showToolbar: true,
        showToday: true,
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
        allowUndo: false,
        inlineEdit: false,
        canEditName: false,
        hasDependencies: false,
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
        animate: false,
        motion: "off",
        hasDeadline: true,
        look: LOOK,
        ...extra
    };
}

describe("year zoom (1.3)", () => {
    it("spans whole years and labels each year", () => {
        const scale = timelineRange(month(2024, 3), month(2029, 10), month(2026, 11), "year");
        expect(scale.start).toEqual(new Date(2023, 0, 1));
        expect(scale.end).toEqual(new Date(2031, 0, 1));
        const cells = scaleCells("year", scale, makeFormatters("en-US"));
        expect(cells.bottom.map(cell => cell.label)).toEqual([
            "2023",
            "2024",
            "2025",
            "2026",
            "2027",
            "2028",
            "2029",
            "2030"
        ]);
        expect(cells.top.map(cell => cell.label)).toEqual(["2020–2029", "2030–2039"]);
    });

    it("has a Year button in the toolbar", () => {
        const { container } = render(<GanttChart {...props()} />);
        const year = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Year");
        expect(year).toBeDefined();
        expect(year!.getAttribute("aria-pressed")).toBe("true");
    });
});

describe("portfolio look (1.3)", () => {
    it("shows the code before the name and the second line under it", () => {
        const { container } = render(<GanttChart {...props()} />);
        const first = container.querySelector(".mxgantt-list-row:not(.mxgantt-list-group) .mxgantt-name-block")!;
        expect(first.querySelector(".mxgantt-code")!.textContent).toBe("01.01");
        expect(first.querySelector(".mxgantt-name")!.textContent).toBe("Project a");
        expect(first.querySelector(".mxgantt-subtitle")!.textContent).toBe("Lukas Becker · PM400");
        expect(container.querySelector(".mxgantt")!.className).toContain("mxgantt--portfolio");
        expect(container.querySelector(".mxgantt")!.className).toContain("mxgantt--two-line");
    });

    it("labels bars with the finish month and the progress", () => {
        const { container } = render(<GanttChart {...props()} />);
        const labels = Array.from(container.querySelectorAll(".mxgantt-bar-label")).map(label => label.textContent);
        expect(labels).toContain("05.2027 · 45 %");
        expect(labels.join("|")).not.toContain("Project a");
    });

    it("draws the baseline as a frame and the deadline as a diamond past which the label starts", () => {
        const { container } = render(<GanttChart {...props()} />);
        const frame = container.querySelector<HTMLElement>(".mxgantt-baseline.is-outline")!;
        expect(frame).not.toBeNull();
        const diamond = container.querySelector<HTMLElement>(".mxgantt-deadline.is-diamond")!;
        expect(diamond).not.toBeNull();
        const bar = container.querySelector<HTMLElement>(".mxgantt-bar-task")!;
        const label = container.querySelector<HTMLElement>(".mxgantt-bar-label")!;
        const barEnd = parseFloat(bar.style.left) + parseFloat(bar.style.width);
        expect(parseFloat(label.style.left)).toBeGreaterThan(barEnd);
        // Slim bars in tall rows.
        expect(parseFloat(bar.style.height)).toBeLessThanOrEqual(20);
        // The diamond replaces the missed-deadline outline.
        expect(bar.className).not.toContain("is-missed");
    });

    it("colours the bar by status and explains it in the legend", () => {
        const { container } = render(<GanttChart {...props()} />);
        const bar = container.querySelector<HTMLElement>(".mxgantt-bar-task")!;
        expect(bar.style.getPropertyValue("--mxgantt-task-color")).toBe("#e5242b");
        const legend = Array.from(container.querySelectorAll(".mxgantt-legend li")).map(item => item.textContent);
        expect(legend).toEqual([
            "Progress (actual %)",
            "Remaining to forecast",
            "I-App baseline",
            "Business need",
            "Bar red: capacity need will not be met"
        ]);
        expect(container.querySelector(".mxgantt-legend-deadline.is-diamond")).not.toBeNull();
        expect(container.querySelector(".mxgantt-legend-baseline.is-outline")).not.toBeNull();
    });

    it("labels the today line", () => {
        const { container } = render(<GanttChart {...props()} />);
        expect(container.querySelector(".mxgantt-today-flag.is-labelled .mxgantt-today-label")!.textContent).toBe(
            DEFAULT_TEXTS.todayLine
        );
        expect(container.querySelector(".mxgantt-today.is-dashed")).not.toBeNull();
    });

    it("keeps the standard look when nothing is set", () => {
        const { container } = render(
            <GanttChart {...props({ look: undefined, tasks: [project("c")], hasDeadline: false })} />
        );
        expect(container.querySelector(".mxgantt")!.className).not.toContain("mxgantt--portfolio");
        expect(container.querySelector(".mxgantt-bar-label")!.textContent).toContain("Project c");
        expect(container.querySelector(".mxgantt-legend")).toBeNull();
        expect(container.querySelector(".mxgantt-today-label")).toBeNull();
        expect(STANDARD_LOOK.barLabel).toBe("name");
    });

    it("leaves the label out when Bar label is None, and uses the custom text when Custom", () => {
        const none = render(<GanttChart {...props({ look: { ...LOOK, barLabel: "none" } })} />);
        expect(none.container.querySelector(".mxgantt-bar-label")).toBeNull();
        none.unmount();
        const custom = render(
            <GanttChart
                {...props({
                    look: { ...LOOK, barLabel: "custom" },
                    tasks: [project("d", { barText: "Go-live Q2" })]
                })}
            />
        );
        expect(custom.container.querySelector(".mxgantt-bar-label")!.textContent).toBe("Go-live Q2");
    });
});
