import { addWorkingTime, ALL_DAYS, WorkCalendar, workingDaysBetween } from "./calendar";

/**
 * 2.3 split tasks: a task whose work is done in segments with gaps between them, the way MS Project
 * splits a task. The segments are stored relative to the task's start, in working days (calendar
 * days without a working calendar), so moving the task moves its segments with it and Start / End
 * stay the truth: the last segment always ends at the task's end.
 *
 * Stored text: "0-2, 4-7" (work from day 0 to 2 and from day 4 to the end). JSON written by other
 * tools, [[0,2],[4,7]] or [{"start":0,"end":2}], is read as well.
 */

export interface Segment {
    /** Offsets from the task start in working days; start < end. */
    start: number;
    end: number;
}

export interface DateSpan {
    start: Date;
    end: Date;
}

const EPS = 1e-6;
/** A gap shorter than about a quarter of an hour is no gap. */
const MIN_GAP = 0.01;
const MAX_SEGMENTS = 50;

function round(value: number): number {
    return Math.round(value * 1000) / 1000;
}

/** Sorted, merged where they touch or overlap, without empty or negative pieces. */
export function normaliseSegments(segments: Segment[]): Segment[] {
    const sorted = segments
        .filter(
            segment =>
                Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end - segment.start > EPS
        )
        .map(segment => ({ start: Math.max(0, round(segment.start)), end: round(segment.end) }))
        .filter(segment => segment.end > segment.start)
        .sort((a, b) => a.start - b.start);
    const merged: Segment[] = [];
    sorted.forEach(segment => {
        const last = merged[merged.length - 1];
        if (last && segment.start <= last.end + MIN_GAP) {
            last.end = Math.max(last.end, segment.end);
        } else {
            merged.push({ ...segment });
        }
    });
    return merged.slice(0, MAX_SEGMENTS);
}

function fromJson(text: string): Segment[] | undefined {
    try {
        const value = JSON.parse(text) as unknown;
        if (!Array.isArray(value)) {
            return undefined;
        }
        return value
            .map(entry => {
                if (Array.isArray(entry) && entry.length >= 2) {
                    return { start: Number(entry[0]), end: Number(entry[1]) };
                }
                if (entry && typeof entry === "object") {
                    const record = entry as Record<string, unknown>;
                    return { start: Number(record.start ?? record.s), end: Number(record.end ?? record.e) };
                }
                return { start: NaN, end: NaN };
            })
            .filter(segment => Number.isFinite(segment.start) && Number.isFinite(segment.end));
    } catch {
        return undefined;
    }
}

/**
 * The segments in a stored text; undefined when the task is not split (empty text, or a single
 * segment after cleaning up), so callers can treat it as an ordinary bar.
 */
export function parseSegments(text: string | undefined): Segment[] | undefined {
    const trimmed = text?.trim();
    if (!trimmed) {
        return undefined;
    }
    let raw: Segment[] | undefined;
    if (trimmed.startsWith("[")) {
        raw = fromJson(trimmed);
    } else {
        raw = trimmed
            .split(/[,;\n]+/)
            .map(part => part.trim())
            .filter(Boolean)
            .map(part => {
                const match = /^(-?\d+(?:[.,]\d+)?)\s*(?:-|\.\.|–)\s*(-?\d+(?:[.,]\d+)?)$/.exec(part);
                return match
                    ? { start: Number(match[1].replace(",", ".")), end: Number(match[2].replace(",", ".")) }
                    : { start: NaN, end: NaN };
            });
    }
    if (!raw) {
        return undefined;
    }
    const segments = normaliseSegments(raw);
    return segments.length > 1 ? segments : undefined;
}

function number(value: number): string {
    return String(round(value));
}

export function formatSegments(segments: Segment[] | undefined): string {
    if (!segments || segments.length < 2) {
        return "";
    }
    return segments.map(segment => `${number(segment.start)}-${number(segment.end)}`).join(", ");
}

/** Total length of the task in working days (gaps included). */
export function spanDays(span: DateSpan, calendar: WorkCalendar = ALL_DAYS): number {
    return Math.max(0, workingDaysBetween(calendar, span.start, span.end));
}

/**
 * The segments fitted to the task: the last one ends at the task's end, pieces that start at or
 * after the end are dropped. Undefined when that leaves fewer than two.
 */
export function fitSegments(segments: Segment[] | undefined, total: number): Segment[] | undefined {
    if (!segments || segments.length < 2 || total <= 0) {
        return undefined;
    }
    const kept = segments.filter(segment => segment.start < total - EPS).map(segment => ({ ...segment }));
    if (kept.length === 0) {
        return undefined;
    }
    kept[kept.length - 1].end = round(total);
    const result = normaliseSegments(kept);
    return result.length > 1 ? result : undefined;
}

/** The working pieces of a task as dates: one piece for a task that is not split. */
export function segmentSpans(
    task: { start?: Date; end?: Date; segments?: Segment[] },
    calendar: WorkCalendar = ALL_DAYS
): DateSpan[] {
    if (!task.start || !task.end) {
        return [];
    }
    const total = spanDays({ start: task.start, end: task.end }, calendar);
    const fitted = fitSegments(task.segments, total);
    if (!fitted) {
        return [{ start: task.start, end: task.end }];
    }
    return fitted.map((segment, index) => ({
        start: addWorkingTime(calendar, task.start!, segment.start),
        end: index === fitted.length - 1 ? task.end! : addWorkingTime(calendar, task.start!, segment.end)
    }));
}

/** Working days of actual work: the span minus the gaps. */
export function workDays(
    task: { start?: Date; end?: Date; segments?: Segment[]; milestone?: boolean },
    calendar: WorkCalendar = ALL_DAYS
): number {
    if (!task.start || !task.end || task.milestone) {
        return 0;
    }
    const total = spanDays({ start: task.start, end: task.end }, calendar);
    const fitted = fitSegments(task.segments, total);
    if (!fitted) {
        return total;
    }
    return round(fitted.reduce((sum, segment) => sum + segment.end - segment.start, 0));
}

/**
 * Splits the task at `at` working days after its start with a gap of `gap` working days: the work
 * after the split point (and every later segment) moves later. Returns the new segments and the new
 * total length (the task's end moves out by the gap).
 */
export function splitAt(
    segments: Segment[] | undefined,
    total: number,
    at: number,
    gap = 1
): { segments: Segment[]; total: number } | undefined {
    const current = fitSegments(segments, total) ?? [{ start: 0, end: total }];
    const inside = current.findIndex(segment => at > segment.start + EPS && at < segment.end - EPS);
    if (inside < 0 || gap <= 0) {
        return undefined;
    }
    const next: Segment[] = [];
    current.forEach((segment, index) => {
        if (index < inside) {
            next.push(segment);
        } else if (index === inside) {
            next.push({ start: segment.start, end: at });
            next.push({ start: at + gap, end: segment.end + gap });
        } else {
            next.push({ start: segment.start + gap, end: segment.end + gap });
        }
    });
    return { segments: normaliseSegments(next), total: round(total + gap) };
}

/**
 * Moves segment `index` and every later one by `delta` working days. A segment cannot move before
 * the end of the one before it; when the gap closes the two merge. Index 0 moves the whole task and
 * is handled as an ordinary move by the caller. Returns the new segments (undefined when the task
 * is no longer split) and the new total length.
 */
export function moveSegment(
    segments: Segment[],
    index: number,
    delta: number
): { segments: Segment[] | undefined; total: number } {
    if (index <= 0 || index >= segments.length) {
        const total = segments.length > 0 ? segments[segments.length - 1].end : 0;
        return { segments: segments.length > 1 ? segments : undefined, total };
    }
    const gapBefore = segments[index].start - segments[index - 1].end;
    const shift = Math.max(-gapBefore, delta);
    const next = segments.map((segment, i) =>
        i >= index ? { start: segment.start + shift, end: segment.end + shift } : { ...segment }
    );
    const normalised = normaliseSegments(next);
    const total = normalised.length > 0 ? normalised[normalised.length - 1].end : 0;
    return { segments: normalised.length > 1 ? normalised : undefined, total };
}

/** Removes the gaps: one segment as long as the work was. */
export function joinSegments(segments: Segment[] | undefined, total: number): number {
    const fitted = fitSegments(segments, total);
    if (!fitted) {
        return total;
    }
    return round(fitted.reduce((sum, segment) => sum + segment.end - segment.start, 0));
}

/**
 * Keeps the segments where they are in time when the task's start or end is dragged: offsets are
 * recomputed from the new start and clipped to the new span. Used for resizes; a move keeps the
 * offsets as they are.
 */
export function rebaseSegments(
    task: { start: Date; end: Date; segments?: Segment[] },
    next: DateSpan,
    calendar: WorkCalendar = ALL_DAYS
): Segment[] | undefined {
    const pieces = segmentSpans(task, calendar);
    if (pieces.length < 2) {
        return undefined;
    }
    const total = spanDays(next, calendar);
    const offset = (date: Date): number => workingDaysBetween(calendar, next.start, date);
    const shifted = pieces.map((piece, index) => ({
        start: Math.max(0, offset(piece.start)),
        end: index === pieces.length - 1 ? total : Math.min(total, offset(piece.end))
    }));
    return fitSegments(normaliseSegments(shifted), total);
}

/** Which segment a working-day offset falls in, or -1 for a gap or outside. */
export function segmentAt(segments: Segment[], offset: number): number {
    return segments.findIndex(segment => offset >= segment.start - EPS && offset <= segment.end + EPS);
}
