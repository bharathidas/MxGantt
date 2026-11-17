import { makeCalendar } from "../calendar";
import {
    deadlineOverrun,
    fitZoom,
    missesDeadline,
    motionLevel,
    progressLinePoints,
    progressPoint,
    projectHealth,
    sortMarkers,
    spiTone,
    totalFloat
} from "../plan";
import { buildLinks, criticalTasks, Task, withDependencies } from "../tasks";

// 2026-10-05 is a Monday.
const day = (n: number): Date => new Date(2026, 9, 5 + n);

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

describe("motion level", () => {
    it("combines the setting, Animations and reduced motion", () => {
        expect(motionLevel("full", true, false)).toBe("full");
        expect(motionLevel("subtle", true, false)).toBe("subtle");
        expect(motionLevel(undefined, true, false)).toBe("full");
        expect(motionLevel("full", false, false)).toBe("off");
        expect(motionLevel("subtle", true, true)).toBe("off");
    });
});

describe("total float", () => {
    // a (0-2) -> b (2-4) -> d (4-8); c (2-3) also feeds d, so c has a day of float.
    const tasks = [
        task("a", 0, 2),
        withDependencies(task("b", 2, 4), "a"),
        withDependencies(task("c", 2, 3), "a"),
        withDependencies(task("d", 4, 8), "b, c"),
        task("e", 0, 1)
    ];
    const links = buildLinks(tasks);

    it("is zero on the critical path and positive elsewhere", () => {
        const float = totalFloat(tasks, links);
        expect(float.get("a")?.days).toBe(0);
        expect(float.get("b")?.days).toBe(0);
        expect(float.get("d")?.days).toBe(0);
        expect(float.get("c")?.days).toBe(1);
        expect(float.get("c")?.latestFinish).toEqual(day(4));
        // An unlinked task may slip until the end of the plan.
        expect(float.get("e")?.days).toBe(7);
    });

    it("agrees with the critical path", () => {
        const critical = criticalTasks(tasks, links);
        const float = totalFloat(tasks, links);
        [...critical].forEach(id => expect(float.get(id)?.days).toBe(0));
        expect(critical.has("c")).toBe(false);
    });

    it("counts working days with a calendar", () => {
        const weekdays = makeCalendar("1-5", "");
        // f ends at the start of Friday 9 Oct and g at the start of Wednesday 14 Oct: Fri, Mon and Tue are float.
        const plan = [task("f", 0, 4), task("g", 0, 9)];
        const float = totalFloat(plan, buildLinks(plan, weekdays), weekdays);
        expect(float.get("f")?.days).toBe(3);
    });
});

describe("deadlines", () => {
    it("reports the overrun in days", () => {
        expect(deadlineOverrun({ end: day(5), deadline: day(3) })).toBe(2);
        expect(deadlineOverrun({ end: day(3), deadline: day(3) })).toBe(0);
        expect(deadlineOverrun({ end: day(3) })).toBeUndefined();
        expect(missesDeadline({ end: day(5), deadline: day(3) })).toBe(true);
        expect(missesDeadline({ end: day(2), deadline: day(3) })).toBe(false);
    });

    it("counts working days with a calendar", () => {
        const weekdays = makeCalendar("1-5", "");
        // Deadline Friday, finish Tuesday: Friday, Monday = 2 working days late.
        expect(deadlineOverrun({ end: day(8), deadline: day(4) }, weekdays)).toBe(2);
    });
});

describe("progress line", () => {
    const status = day(5);

    it("points at the progress reached for started tasks", () => {
        expect(progressPoint(task("a", 0, 10, { progress: 30 }), status)).toEqual(day(3));
        expect(progressPoint(task("a", 0, 10, { progress: 70 }), status)).toEqual(day(7));
    });

    it("stays on the status date for tasks that have not started yet", () => {
        expect(progressPoint(task("a", 6, 10, { progress: 0 }), status)).toEqual(status);
        expect(progressPoint(task("a", 6, 10, { progress: 20 }), status)).toEqual(
            new Date(day(6).getTime() + 0.2 * 4 * 86400000)
        );
        expect(progressPoint(task("a", 0, 10), status)).toBeUndefined();
    });

    it("keeps finished work and milestones on the status date", () => {
        expect(progressPoint(task("m", 3, 3, { progress: 100 }), status)).toEqual(status);
        expect(progressPoint(task("a", 0, 3, { progress: 100 }), status)).toEqual(status);
        expect(progressPoint(task("m", 3, 3, { progress: 0 }), status)).toEqual(status);
    });

    it("builds a zig-zag through the rows", () => {
        const toX = (date: Date): number => (date.getTime() - day(0).getTime()) / 86400000;
        const points = progressLinePoints(
            [
                { index: 0, task: task("a", 0, 10, { progress: 30 }) },
                { index: 1 },
                { index: 2, task: task("b", 0, 10, { progress: 80 }) }
            ],
            status,
            20,
            toX
        );
        expect(points).toEqual([
            [5, 1],
            [3, 10],
            [5, 19],
            [5, 41],
            [8, 50],
            [5, 59]
        ]);
    });
});

describe("project health", () => {
    const status = day(5);

    it("weighs progress by duration and compares it with the plan", () => {
        const tasks = [task("a", 0, 10, { progress: 50 }), task("b", 0, 10, { progress: 30 })];
        const health = projectHealth(tasks, status, new Set());
        expect(health.actual).toBe(40);
        expect(health.planned).toBe(50);
        expect(health.spi).toBe(0.8);
        expect(health.behind).toBe(1);
        expect(spiTone(health.spi)).toBe("bad");
    });

    it("compares the forecast finish with the baseline and counts deadlines and critical tasks", () => {
        const tasks = [
            task("a", 0, 12, { baselineStart: day(0), baselineEnd: day(10), deadline: day(11) }),
            task("b", 0, 4, { deadline: day(6) })
        ];
        const health = projectHealth(tasks, status, new Set(["a", "zz"]));
        expect(health.finishVariance).toBe(2);
        expect(health.missedDeadlines).toBe(1);
        expect(health.critical).toBe(1);
        expect(health.actual).toBeUndefined();
        expect(health.spi).toBeUndefined();
        expect(health.tasks).toBe(2);
    });

    it("has no SPI before anything was planned", () => {
        const health = projectHealth([task("a", 6, 10, { progress: 10 })], status, new Set());
        expect(health.planned).toBe(0);
        expect(health.spi).toBeUndefined();
        expect(spiTone(1)).toBe("good");
        expect(spiTone(0.9)).toBe("warning");
    });
});

describe("zoom to fit and markers", () => {
    it("picks the most detailed zoom that fits", () => {
        expect(fitZoom(day(0), day(10), 800)).toBe("day");
        expect(fitZoom(day(0), day(40), 800)).toBe("week");
        expect(fitZoom(day(0), day(150), 800)).toBe("month");
        expect(fitZoom(day(0), day(400), 800)).toBe("quarter");
        expect(fitZoom(day(0), day(1500), 800)).toBe("year");
        expect(fitZoom(day(0), day(9000), 800)).toBe("year");
    });

    it("keeps dated markers in date order", () => {
        const markers = sortMarkers([
            { date: day(5), label: "Go-live" },
            { label: "No date" },
            { date: day(1), label: "Freeze", color: "#f00" }
        ]);
        expect(markers.map(marker => marker.label)).toEqual(["Freeze", "Go-live"]);
    });
});
