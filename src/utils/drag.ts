import { isWorkingDay, rollToWorkingDay, WorkCalendar } from "./calendar";
import { placeAt } from "./deps";
import { addDays, addUnits, DAY, HOUR, Snap, startOfDay } from "./time";
import { clampProgress } from "./tasks";

export type DragMode = "move" | "start" | "end" | "progress";

export interface Schedule {
    start: Date;
    end: Date;
    progress?: number;
}

/** How many whole snap units a horizontal drag of `deltaPx` covers. */
export function unitsFor(deltaPx: number, pxPerDay: number, snap: Snap): number {
    const unitPx = snap === "hour" ? (pxPerDay * HOUR) / DAY : pxPerDay;
    const units = deltaPx / unitPx;
    // Math.round(-0.4) is -0, which would still count as a change when compared with Object.is.
    return Math.round(units) || 0;
}

/**
 * The schedule after a drag. Moving shifts both dates by the same calendar steps so the duration
 * stays exactly the same; resizing never lets the end pass the start (that would be a milestone the
 * user did not ask for, so a one-unit minimum is kept unless the task already was one).
 */
export function applyDrag(
    mode: DragMode,
    original: Schedule,
    deltaPx: number,
    pxPerDay: number,
    snap: Snap,
    barWidthPx = 0
): Schedule {
    if (mode === "progress") {
        const base = original.progress ?? 0;
        const next = barWidthPx > 0 ? base + (deltaPx / barWidthPx) * 100 : base;
        return { ...original, progress: clampProgress(next) };
    }
    const units = unitsFor(deltaPx, pxPerDay, snap);
    return shift(mode, original, units, snap);
}

export function shift(mode: Exclude<DragMode, "progress">, original: Schedule, units: number, snap: Snap): Schedule {
    const { start, end } = original;
    const wasPoint = start.getTime() === end.getTime();
    if (mode === "move") {
        return { ...original, start: addUnits(start, units, snap), end: addUnits(end, units, snap) };
    }
    if (mode === "start") {
        let next = addUnits(start, units, snap);
        const latest = wasPoint ? end : addUnits(end, -1, snap);
        if (next > latest) {
            next = latest;
        }
        return { ...original, start: next };
    }
    let next = addUnits(end, units, snap);
    const earliest = wasPoint ? start : addUnits(start, 1, snap);
    if (next < earliest) {
        next = earliest;
    }
    return { ...original, end: next };
}

export function sameSchedule(a: Schedule, b: Schedule): boolean {
    return a.start.getTime() === b.start.getTime() && a.end.getTime() === b.end.getTime() && a.progress === b.progress;
}

export interface KeyEdit {
    mode: Exclude<DragMode, "progress">;
    units: number;
}

/**
 * The keyboard alternative to dragging: arrows move by one snap unit, Page Up / Page Down by a
 * week, and Shift changes the end instead of moving the whole task.
 */
export function keyEdit(key: string, shiftKey: boolean, snap: Snap): KeyEdit | undefined {
    const week = snap === "hour" ? 7 * 24 : 7;
    const units: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, PageUp: -week, PageDown: week };
    if (!(key in units)) {
        return undefined;
    }
    return { mode: shiftKey ? "end" : "move", units: units[key] };
}

/** The day a span's end belongs to: an end at midnight closes the day before. */
function lastCoveredDay(end: Date): Date {
    const day = startOfDay(end);
    return day.getTime() === end.getTime() ? addDays(day, -1) : day;
}

/**
 * With a working calendar and day snapping, a dragged or nudged task never starts or ends on a
 * non-working day: a move rolls on to the next working day in the direction of travel and keeps
 * the task's working duration, and a resized end skips days nobody works.
 */
export function snapToCalendar(mode: DragMode, original: Schedule, next: Schedule, calendar: WorkCalendar): Schedule {
    if (!calendar.active || mode === "progress") {
        return next;
    }
    if (mode === "move") {
        if (next.start.getTime() === original.start.getTime()) {
            return next;
        }
        const direction = next.start > original.start ? 1 : -1;
        const start = rollToWorkingDay(calendar, next.start, direction);
        return { ...next, ...placeAt(original, start, calendar) };
    }
    if (mode === "start") {
        if (next.start.getTime() === original.start.getTime()) {
            return next;
        }
        const start = rollToWorkingDay(calendar, next.start, next.start > original.start ? 1 : -1);
        return start < next.end ? { ...next, start } : next;
    }
    if (next.end.getTime() === original.end.getTime() || next.end.getTime() === next.start.getTime()) {
        return next;
    }
    const direction = next.end > original.end ? 1 : -1;
    let end = next.end;
    for (let guard = 0; guard < 366 && !isWorkingDay(calendar, lastCoveredDay(end)); guard++) {
        end = addDays(end, direction);
    }
    return end > next.start && isWorkingDay(calendar, lastCoveredDay(end)) ? { ...next, end } : next;
}
