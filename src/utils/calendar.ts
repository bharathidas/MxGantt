import { addDays, DAY, durationDays, HOUR, startOfDay } from "./time";

/**
 * Working calendar arithmetic: which days count, and how far a date moves when a number of
 * working days is added to it.
 *
 * Everything works on local calendar days (midnight to midnight in the browser's time zone) and
 * steps with addDays, so a daylight saving night or a UTC offset such as +05:30 never shifts a
 * date by an hour or onto the wrong day. Holidays are plain yyyy-mm-dd strings compared against
 * the local date, never parsed as UTC.
 */

export interface WorkCalendar {
    /** Indexed by Date.getDay(): 0 is Sunday, 6 is Saturday. */
    working: boolean[];
    /** Local dates as yyyy-mm-dd. */
    holidays: ReadonlySet<string>;
    /** False when every day counts and there are no holidays, so plain calendar arithmetic applies. */
    active: boolean;
}

export const ALL_DAYS: WorkCalendar = {
    working: [true, true, true, true, true, true, true],
    holidays: new Set(),
    active: false
};

/** A cap on day-by-day loops so a calendar without any working day cannot hang the page. */
const MAX_DAYS = 40000;

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** ISO weekday (1 Monday ... 7 Sunday, 0 also Sunday) or a day name, to a Date.getDay() index. */
function dayIndex(token: string): number | undefined {
    const text = token.trim().toLowerCase();
    if (/^\d$/.test(text)) {
        const iso = Number(text);
        return iso > 7 ? undefined : iso % 7;
    }
    const index = DAY_NAMES.indexOf(text.slice(0, 3));
    return index >= 0 && text.length >= 3 ? index : undefined;
}

/**
 * "1-5" (Monday to Friday), "1,2,3,4,6", "Mon-Thu, Sat" or "7-1" (Sunday and Monday) to a list of
 * working flags indexed by Date.getDay(). Undefined when the text is empty or names no day, so the
 * caller can fall back to every day.
 */
export function parseWorkingDays(text: string | undefined): boolean[] | undefined {
    if (!text || !text.trim()) {
        return undefined;
    }
    const working = [false, false, false, false, false, false, false];
    let any = false;
    text.split(/[,;\s]+/)
        .filter(part => part.length > 0)
        .forEach(part => {
            const range = part.split("-");
            if (range.length === 2) {
                const from = dayIndex(range[0]);
                const to = dayIndex(range[1]);
                if (from === undefined || to === undefined) {
                    return;
                }
                // Walk forward through the week from the first to the last day (Monday first).
                const isoFrom = from === 0 ? 7 : from;
                let isoTo = to === 0 ? 7 : to;
                if (isoTo < isoFrom) {
                    isoTo += 7;
                }
                for (let iso = isoFrom; iso <= isoTo; iso++) {
                    working[iso % 7] = true;
                    any = true;
                }
                return;
            }
            const day = dayIndex(part);
            if (day !== undefined) {
                working[day] = true;
                any = true;
            }
        });
    return any ? working : undefined;
}

/** The local date as yyyy-mm-dd. */
export function dayKey(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
}

/** A yyyy-mm-dd string as local midnight, or undefined when it is not a real date. */
export function parseIsoDate(text: string): Date | undefined {
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text.trim());
    if (!match) {
        return undefined;
    }
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : undefined;
}

/**
 * Holidays as yyyy-mm-dd dates separated by commas, semicolons, spaces or new lines. A range is
 * written 2026-12-24..2026-12-31. Anything that is not a valid date is ignored.
 */
export function parseHolidays(text: string | undefined): Set<string> {
    const holidays = new Set<string>();
    if (!text) {
        return holidays;
    }
    text.split(/[,;\s]+/)
        .filter(part => part.length > 0)
        .forEach(part => {
            const [fromText, toText] = part.split("..");
            const from = parseIsoDate(fromText);
            if (!from) {
                return;
            }
            const to = toText !== undefined ? parseIsoDate(toText) : from;
            if (!to || to < from) {
                return;
            }
            let day = from;
            for (let guard = 0; day <= to && guard < 1000; guard++) {
                holidays.add(dayKey(day));
                day = addDays(day, 1);
            }
        });
    return holidays;
}

export function makeCalendar(workingDays: string | undefined, holidays: string | undefined): WorkCalendar {
    const days = parseWorkingDays(workingDays);
    const off = parseHolidays(holidays);
    const working = days ?? ALL_DAYS.working;
    const active = off.size > 0 || working.some(flag => !flag);
    return active ? { working, holidays: off, active } : ALL_DAYS;
}

export function isWorkingDay(calendar: WorkCalendar, date: Date): boolean {
    if (!calendar.active) {
        return true;
    }
    return calendar.working[date.getDay()] && !calendar.holidays.has(dayKey(date));
}

/** The number of working weekdays, used for lags written in weeks. */
export function workingDaysPerWeek(calendar: WorkCalendar): number {
    return calendar.active ? Math.max(1, calendar.working.filter(Boolean).length) : 7;
}

/** The date itself on a working day, otherwise the same time on the nearest working day in the given direction. */
export function rollToWorkingDay(calendar: WorkCalendar, date: Date, direction: 1 | -1): Date {
    if (!calendar.active) {
        return date;
    }
    let current = date;
    for (let guard = 0; guard < MAX_DAYS && !isWorkingDay(calendar, current); guard++) {
        current = addDays(current, direction);
    }
    return isWorkingDay(calendar, current) ? current : date;
}

/**
 * Working time between two dates, in days: each working day the span touches counts for the part
 * of it that is covered, so Monday 00:00 to Wednesday 00:00 is 2 and Friday 00:00 to Tuesday 00:00
 * over a weekend is 3. Rounded to the hour. Negative when end is before start.
 *
 * With `stopAbove`, counting stops as soon as the total passes it, for callers that only need to
 * know whether a span is longer than that (the critical path asks this of spans that can be years).
 */
export function workingDaysBetween(calendar: WorkCalendar, start: Date, end: Date, stopAbove = Infinity): number {
    if (!calendar.active) {
        return durationDays(start, end);
    }
    if (end < start) {
        return -workingDaysBetween(calendar, end, start, stopAbove);
    }
    let total = 0;
    let cursor = start;
    for (let guard = 0; cursor < end && guard < MAX_DAYS; guard++) {
        const dayStart = startOfDay(cursor);
        const next = addDays(dayStart, 1);
        const segmentEnd = next < end ? next : end;
        if (isWorkingDay(calendar, dayStart)) {
            total += (segmentEnd.getTime() - cursor.getTime()) / (next.getTime() - dayStart.getTime());
            if (total > stopAbove) {
                break;
            }
        }
        cursor = segmentEnd;
    }
    return Math.round(total * 24) / 24;
}

/**
 * Adds working time to a date. Whole days keep the time of day; an end that falls at midnight
 * after the last working day stays there (Thursday 00:00 plus 2 days is Saturday 00:00, the end
 * of Friday), so ends never jump over a weekend they do not need. Negative amounts go back.
 * Without an active calendar this is plain calendar arithmetic that keeps the wall-clock time.
 */
export function addWorkingTime(calendar: WorkCalendar, date: Date, days: number): Date {
    if (days === 0) {
        return date;
    }
    if (!calendar.active) {
        const whole = Math.trunc(days);
        const moved = addDays(date, whole);
        return new Date(moved.getTime() + Math.round((days - whole) * DAY));
    }
    let remaining = Math.abs(days);
    let cursor = date;
    for (let guard = 0; guard < MAX_DAYS; guard++) {
        if (days > 0) {
            const dayStart = startOfDay(cursor);
            const next = addDays(dayStart, 1);
            const length = next.getTime() - dayStart.getTime();
            if (isWorkingDay(calendar, dayStart)) {
                const available = (next.getTime() - cursor.getTime()) / length;
                if (remaining <= available + 1e-9) {
                    return new Date(Math.round(cursor.getTime() + remaining * length));
                }
                remaining -= available;
            }
            cursor = next;
        } else {
            // Going back from midnight uses up the previous day.
            let dayStart = startOfDay(cursor);
            if (dayStart.getTime() === cursor.getTime()) {
                dayStart = addDays(dayStart, -1);
            }
            const dayEnd = addDays(dayStart, 1);
            const length = dayEnd.getTime() - dayStart.getTime();
            if (isWorkingDay(calendar, dayStart)) {
                const available = (cursor.getTime() - dayStart.getTime()) / length;
                if (remaining <= available + 1e-9) {
                    return new Date(Math.round(cursor.getTime() - remaining * length));
                }
                remaining -= available;
            }
            cursor = dayStart;
        }
    }
    return cursor;
}

/**
 * Moves `date` by the same calendar distance as `from` moved to `to`: whole days with addDays plus
 * the change in time of day, so wall-clock times survive a daylight saving change.
 */
export function moveLike(date: Date, from: Date, to: Date): Date {
    const days = Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY);
    const timeShift = to.getTime() - startOfDay(to).getTime() - (from.getTime() - startOfDay(from).getTime());
    return new Date(addDays(date, days).getTime() + timeShift);
}

/** Spans of non-working days inside [fromX, toX] of the timeline, for shading. */
export function nonWorkingDays(calendar: WorkCalendar, from: Date, to: Date): Array<{ start: Date; end: Date }> {
    const spans: Array<{ start: Date; end: Date }> = [];
    if (!calendar.active) {
        return spans;
    }
    let day = startOfDay(from);
    let open: { start: Date; end: Date } | undefined;
    for (let guard = 0; day < to && guard < MAX_DAYS; guard++) {
        const next = addDays(day, 1);
        if (!isWorkingDay(calendar, day)) {
            if (open) {
                open.end = next;
            } else {
                open = { start: day, end: next };
                spans.push(open);
            }
        } else {
            open = undefined;
        }
        day = next;
    }
    return spans;
}

/** Hours in a span, for tasks shorter than a day. */
export function hoursBetween(start: Date, end: Date): number {
    return Math.round((end.getTime() - start.getTime()) / 60000) / (HOUR / 60000);
}
