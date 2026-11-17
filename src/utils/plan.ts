import { ALL_DAYS, WorkCalendar, workingDaysBetween } from "./calendar";
import { expectedProgress, isBehind } from "./status";
import { backwardPass, isMilestone, Link, Task } from "./tasks";
import { pxPerDay, Snap, Zoom, ZOOMS } from "./time";

/**
 * 2.2 planning aids: total float, deadlines, the progress line, project health (earned value
 * style), zoom to fit and the motion level. Pure functions, tested in __tests__/plan.spec.ts.
 */

const DAY = 24 * 3600000;

// ---------------------------------------------------------------- motion

export type MotionSetting = "full" | "subtle" | "off";

export function motionLevel(setting: MotionSetting | undefined, animate: boolean, reduced: boolean): MotionSetting {
    if (!animate || reduced) {
        return "off";
    }
    return setting === "subtle" || setting === "off" ? setting : "full";
}

// ---------------------------------------------------------------- total float

export interface Float {
    /** Latest finish that does not move the end of the plan. */
    latestFinish: Date;
    /** Total float in (working) days, never negative. */
    days: number;
}

/**
 * Total float of every dated task outside a dependency cycle: how far it can slip without moving
 * the end of the plan. Counted in working days with an active calendar, else in elapsed days.
 */
export function totalFloat(tasks: Task[], links: Link[], calendar: WorkCalendar = ALL_DAYS): Map<string, Float> {
    const { dated, latestFinish } = backwardPass(tasks, links, calendar);
    const result = new Map<string, Float>();
    latestFinish.forEach((latest, id) => {
        const end = dated.get(id)!.end!;
        const raw = latest - end.getTime();
        const days =
            raw <= 0
                ? 0
                : calendar.active
                ? workingDaysBetween(calendar, end, new Date(latest))
                : Math.round((raw / DAY) * 10) / 10;
        result.set(id, { latestFinish: new Date(Math.max(latest, end.getTime())), days: Math.max(0, days) });
    });
    return result;
}

// ---------------------------------------------------------------- deadlines

/** Days the task finishes after its deadline (positive), 0 when on time, undefined without both dates. */
export function deadlineOverrun(
    task: Pick<Task, "end" | "deadline">,
    calendar: WorkCalendar = ALL_DAYS
): number | undefined {
    if (!task.end || !task.deadline) {
        return undefined;
    }
    if (task.end.getTime() <= task.deadline.getTime()) {
        return 0;
    }
    const days = calendar.active
        ? workingDaysBetween(calendar, task.deadline, task.end)
        : (task.end.getTime() - task.deadline.getTime()) / DAY;
    return Math.max(0, Math.round(days * 10) / 10);
}

export function missesDeadline(task: Pick<Task, "end" | "deadline">): boolean {
    return !!task.end && !!task.deadline && task.end.getTime() > task.deadline.getTime();
}

// ---------------------------------------------------------------- progress line

/**
 * Where the progress line touches a task: the point of the bar its progress has reached (elapsed
 * time, as drawn), for tasks that should have started by the status date or have progress;
 * otherwise the status date itself. Undefined for tasks without dates or progress, and milestones
 * follow the status date unless done.
 */
export function progressPoint(task: Task, statusDate: Date): Date | undefined {
    if (!task.start || !task.end || task.progress === undefined) {
        return undefined;
    }
    // Finished work has no peak: the line stays on the status date.
    if (task.progress >= 100 || isMilestone(task)) {
        return statusDate;
    }
    const started = task.start.getTime() <= statusDate.getTime() || task.progress > 0;
    if (!started) {
        return statusDate;
    }
    const at = task.start.getTime() + ((task.end.getTime() - task.start.getTime()) * task.progress) / 100;
    return new Date(at);
}

/** Polyline points (x, y) of the progress line through the given rows, top to bottom. */
export function progressLinePoints(
    rows: Array<{ index: number; task?: Task }>,
    statusDate: Date,
    rowHeight: number,
    toX: (date: Date) => number
): Array<[number, number]> {
    const statusX = toX(statusDate);
    const points: Array<[number, number]> = [];
    rows.forEach(({ index, task }) => {
        const top = index * rowHeight;
        const middle = top + rowHeight / 2;
        const point = task ? progressPoint(task, statusDate) : undefined;
        if (!point) {
            return;
        }
        points.push([statusX, top + 1]);
        points.push([Math.round(toX(point) * 10) / 10, middle]);
        points.push([statusX, top + rowHeight - 1]);
    });
    return points;
}

// ---------------------------------------------------------------- project health

export interface Health {
    /** Duration-weighted actual and planned (at the status date) percent complete; undefined without progress. */
    actual?: number;
    planned?: number;
    /** Schedule performance index: earned / planned value; undefined when nothing was planned yet. */
    spi?: number;
    finish?: Date;
    baselineFinish?: Date;
    /** Forecast finish minus baseline finish in (working) days, positive when late. */
    finishVariance?: number;
    behind: number;
    critical: number;
    missedDeadlines: number;
    tasks: number;
}

export function projectHealth(
    tasks: Task[],
    statusDate: Date,
    critical: ReadonlySet<string>,
    calendar: WorkCalendar = ALL_DAYS
): Health {
    let weight = 0;
    let earned = 0;
    let planned = 0;
    let hasProgress = false;
    let finish: number | undefined;
    let baselineFinish: number | undefined;
    let behind = 0;
    let missed = 0;
    let dated = 0;
    tasks.forEach(task => {
        if (!task.start || !task.end) {
            return;
        }
        dated += 1;
        finish = Math.max(finish ?? -Infinity, task.end.getTime());
        if (task.baselineEnd) {
            baselineFinish = Math.max(baselineFinish ?? -Infinity, task.baselineEnd.getTime());
        }
        if (missesDeadline(task)) {
            missed += 1;
        }
        if (task.progress === undefined) {
            return;
        }
        hasProgress = true;
        // Milestones weigh like a short task so they count without dominating.
        const length = Math.max(0.5, isMilestone(task) ? 0.5 : workingDaysBetween(calendar, task.start, task.end));
        weight += length;
        earned += (length * task.progress) / 100;
        planned += (length * (expectedProgress(task, statusDate, calendar) ?? 0)) / 100;
        if (isBehind(task, statusDate, calendar)) {
            behind += 1;
        }
    });
    const round1 = (value: number): number => Math.round(value * 10) / 10;
    const health: Health = {
        behind,
        critical: [...critical].filter(id => tasks.some(task => task.id === id)).length,
        missedDeadlines: missed,
        tasks: dated,
        finish: finish === undefined ? undefined : new Date(finish),
        baselineFinish: baselineFinish === undefined ? undefined : new Date(baselineFinish)
    };
    if (hasProgress && weight > 0) {
        health.actual = round1((earned / weight) * 100);
        health.planned = round1((planned / weight) * 100);
        health.spi = planned > 0 ? Math.round((earned / planned) * 100) / 100 : undefined;
    }
    if (health.finish && health.baselineFinish) {
        const late = health.finish.getTime() >= health.baselineFinish.getTime();
        const days = calendar.active
            ? workingDaysBetween(
                  calendar,
                  late ? health.baselineFinish : health.finish,
                  late ? health.finish : health.baselineFinish
              )
            : Math.abs(health.finish.getTime() - health.baselineFinish.getTime()) / DAY;
        health.finishVariance = round1(late ? days : -days);
    }
    return health;
}

/** Tone of the SPI tile: good at 0.95 and above, warning from 0.85, else bad. */
export function spiTone(spi: number | undefined): "good" | "warning" | "bad" | "none" {
    if (spi === undefined) {
        return "none";
    }
    return spi >= 0.95 ? "good" : spi >= 0.85 ? "warning" : "bad";
}

// ---------------------------------------------------------------- zoom to fit

/** The most detailed zoom at which the span fits in `width` pixels (year when nothing fits). */
export function fitZoom(start: Date, end: Date, width: number, snap: Snap = "day"): Zoom {
    const days = Math.max(1, (end.getTime() - start.getTime()) / DAY);
    for (const zoom of ZOOMS) {
        if (days * pxPerDay(zoom, snap) <= width) {
            return zoom;
        }
    }
    return ZOOMS[ZOOMS.length - 1];
}

// ---------------------------------------------------------------- markers

export interface Marker {
    date: Date;
    label: string;
    color?: string;
}

/** Markers with a date, in date order. */
export function sortMarkers(markers: Array<{ date?: Date; label: string; color?: string }>): Marker[] {
    return markers
        .filter((marker): marker is Marker => !!marker.date && !Number.isNaN(marker.date.getTime()))
        .sort((a, b) => a.date.getTime() - b.date.getTime());
}
