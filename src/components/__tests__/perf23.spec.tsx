import { act, fireEvent, render } from "@testing-library/react";

import { makeCalendar } from "../../utils/calendar";
import { schedulePlan } from "../../utils/constraints";
import { projectEarnedValue, sCurve } from "../../utils/cost";
import { autoSchedule } from "../../utils/deps";
import { levelResources } from "../../utils/leveling";
import { importMspdi } from "../../utils/mspdiImport";
import { buildMspdi } from "../../utils/planExport";
import { projectSummaries } from "../../utils/portfolio";
import { parseAssignments, ResourceInfo, resourceUsage } from "../../utils/resources";
import { buildLinks, buildRows, criticalTasks, Task, withDependencies } from "../../utils/tasks";
import { DEFAULT_TEXTS } from "../../utils/texts";
import { GanttChart, GanttChartProps } from "../GanttChart";

/**
 * 2.3 performance budget on a 5,000-task plan over two years with a working calendar, 50
 * resources, links, projects, segments and costs. Budgets are generous for a loaded CI machine;
 * the measured numbers are printed (PERF lines) and recorded in the CHANGELOG.
 */

// Coverage instrumentation and a busy machine slow everything down; the budgets below are the real limits.
jest.setTimeout(120000);

const N = 5000;
const calendar = makeCalendar("1-5", "2026-12-24..2026-12-26, 2027-01-01");
const base = new Date(2026, 9, 5);
const at = (days: number): Date => new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);

function plan(): Task[] {
    const tasks: Task[] = [];
    for (let i = 0; i < N; i++) {
        const start = Math.floor(i / 7) + (i % 5);
        const length = 1 + (i % 6);
        const task: Task = {
            id: `t${i}`,
            key: String(i),
            name: `Task ${i}`,
            start: at(start),
            end: at(start + length),
            progress: (i * 7) % 101,
            milestone: false,
            deps: [],
            editable: true,
            group: `Phase ${Math.floor(i / 100)}`,
            project: `Project ${Math.floor(i / 1000)}`,
            assignments: parseAssignments(`R${Math.floor(i / 2) % 50}:${50 + (i % 3) * 25}`),
            fixedCost: i % 10 === 0 ? 1000 : undefined,
            baselineStart: at(start),
            baselineEnd: at(start + length - 1 + (i % 2))
        };
        tasks.push(i > 0 && i % 3 === 0 ? withDependencies(task, String(i - 3)) : task);
    }
    return tasks;
}

const resources = new Map<string, ResourceInfo>();
for (let r = 0; r < 50; r++) {
    resources.set(`R${r}`, { name: `R${r}`, maxUnits: 100, rate: 40 + r });
}

const results: Record<string, number> = {};
function time<T>(label: string, run: () => T): T {
    const started = performance.now();
    const value = run();
    results[label] = Math.round(performance.now() - started);
    return value;
}

afterAll(() => {
    // One line per measurement, picked up for the CHANGELOG.
    Object.entries(results).forEach(([label, ms]) => console.log(`PERF ${label}: ${ms} ms`));
});

describe("2.3 performance budget (5,000 tasks)", () => {
    const tasks = plan();
    const links = buildLinks(tasks, calendar);

    it("links, critical path and push scheduling", () => {
        time("buildLinks + criticalTasks", () => criticalTasks(tasks, links, undefined, calendar));
        const spans = new Map(tasks.map(task => [task.id, { start: task.start!, end: task.end! }]));
        const pushed = time("autoSchedule (move the first task 30 days)", () =>
            autoSchedule(spans, links, new Map([["t0", { start: at(30), end: at(31) }]]), calendar)
        );
        expect(pushed.size).toBeGreaterThan(100);
        expect(results["buildLinks + criticalTasks"]).toBeLessThan(4000);
        expect(results["autoSchedule (move the first task 30 days)"]).toBeLessThan(4000);
    });

    it("resource usage and levelling", () => {
        const usage = time("resourceUsage (2 years, 50 resources)", () =>
            resourceUsage(tasks, at(-7), at(800), "day", calendar, resources)
        );
        expect(usage.resources).toHaveLength(50);
        // Started work is never levelled, so level the plan as if nothing had started yet.
        const fresh = tasks.map(task => ({ ...task, progress: 0 }));
        const result = time("levelResources", () => levelResources(fresh, links, { calendar, resources }));
        expect(result.moved.size).toBeGreaterThan(0);
        expect(results["resourceUsage (2 years, 50 resources)"]).toBeLessThan(2000);
        expect(results.levelResources).toBeLessThan(20000);
    });

    it("schedule plan, earned value, S-curve and portfolio", () => {
        const planTasks = tasks.map(task => ({ id: task.id, start: task.start!, end: task.end! }));
        time("schedulePlan", () => schedulePlan(planTasks, links, calendar));
        const settings = { calendar, resources, hoursPerDay: 8 };
        const baselineOf = (task: Task): { start: Date; finish: Date } | undefined =>
            task.baselineStart && task.baselineEnd
                ? { start: task.baselineStart, finish: task.baselineEnd }
                : undefined;
        const ev = time("projectEarnedValue", () => projectEarnedValue(tasks, at(200), settings, baselineOf));
        expect(ev.bac).toBeGreaterThan(0);
        const curve = time("sCurve", () => sCurve(tasks, at(200), settings, baselineOf));
        expect(curve!.dates.length).toBeGreaterThan(50);
        time("projectSummaries", () => projectSummaries(tasks, { statusDate: at(200), calendar, links }));
        time("buildRows (portfolio)", () => buildRows(tasks, new Set()));
        expect(results.schedulePlan).toBeLessThan(4000);
        expect(results.projectEarnedValue + results.sCurve).toBeLessThan(6000);
    });

    it("MS Project export and import", () => {
        const xml = time("buildMspdi", () => buildMspdi(tasks, { name: "Big", calendar, resources, links }));
        const imported = time("importMspdi", () => importMspdi(xml));
        expect(imported.stats.tasks).toBe(N);
        // jsdom's DOMParser is far slower than a browser's; the harness measures the real import in Chrome.
        expect(results.buildMspdi + results.importMspdi).toBeLessThan(40000);
    });

    it("renders, scrolls and re-renders the chart", async () => {
        const props: GanttChartProps = {
            tasks,
            loading: false,
            texts: DEFAULT_TEXTS,
            initialZoom: "week",
            snap: "day",
            rowHeight: 36,
            height: 600,
            gridWidth: 400,
            showGrid: true,
            showToolbar: true,
            showToday: true,
            showWeekends: true,
            showLinks: true,
            criticalMode: "on",
            allowExport: false,
            exportFileName: "gantt",
            hasProgress: true,
            theme: "light",
            onChange: jest.fn(),
            calendar,
            snapWorkingDays: false,
            autoSchedule: "on",
            allowUndo: true,
            inlineEdit: false,
            canEditName: false,
            hasDependencies: true,
            linkEditing: false,
            hasBaseline: true,
            hasAssignee: false,
            showWbs: true,
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
            hasAssignments: true,
            resources,
            showResources: true,
            resourceLeveling: true,
            hasCost: true,
            showEarnedValue: true,
            costColumns: true,
            showPortfolio: true,
            hasConstraints: true,
            hasSegments: true
        };
        const view = time("first render (all 2.3 panels on)", () => render(<GanttChart {...props} />));
        const chart = view.container.querySelector(".mxgantt-chart") as HTMLElement;
        expect(view.container.querySelectorAll(".mxgantt-bar").length).toBeLessThan(200);
        // Each scroll is rendered in the next animation frame: measure scroll + frame + render.
        const scrollStart = performance.now();
        for (let i = 1; i <= 20; i++) {
            chart.scrollTop = i * 3000;
            fireEvent.scroll(chart);
            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 20));
            });
        }
        results["scroll 20 times (incl. 20 x 20 ms waits)"] = Math.round(performance.now() - scrollStart);
        time("re-render with a changed task", () =>
            view.rerender(
                <GanttChart {...props} tasks={tasks.map((task, i) => (i === 10 ? { ...task, progress: 3 } : task))} />
            )
        );
        expect(results["first render (all 2.3 panels on)"]).toBeLessThan(30000);
        expect(results["re-render with a changed task"]).toBeLessThan(30000);
        view.unmount();
    });
});
