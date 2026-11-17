/**
 * Date and scale arithmetic for the timeline.
 *
 * Positions are linear in milliseconds (x = ms since the range start * pixels per ms), while
 * steps are calendar steps (add a day = same local time tomorrow). Mixing the two on purpose keeps
 * a task at 09:00 at 09:00 after being moved across a daylight saving change, and because the
 * header cells use the same linear mapping, bars and grid lines always line up.
 */

export type Zoom = "day" | "week" | "month" | "quarter" | "year";
export type Snap = "day" | "hour";

export const HOUR = 3600000;
export const DAY = 24 * HOUR;
export const ZOOMS: Zoom[] = ["day", "week", "month", "quarter", "year"];

/** Pixels one day takes at each zoom level. Hour snapping needs a wider day to be draggable. */
export function pxPerDay(zoom: Zoom, snap: Snap = "day"): number {
    switch (zoom) {
        case "day":
            return snap === "hour" ? 72 : 40;
        case "week":
            return 18;
        case "month":
            return 4.5;
        case "quarter":
            return 1.6;
        default:
            // About 130 pixels a year: a multi-year portfolio fits on one screen.
            return 0.36;
    }
}

export interface TimeScale {
    start: Date;
    end: Date;
    pxPerDay: number;
}

export function dateToX(date: Date, scale: TimeScale): number {
    return ((date.getTime() - scale.start.getTime()) / DAY) * scale.pxPerDay;
}

export function xToDate(x: number, scale: TimeScale): Date {
    return new Date(scale.start.getTime() + (x / scale.pxPerDay) * DAY);
}

export function scaleWidth(scale: TimeScale): number {
    return Math.max(0, dateToX(scale.end, scale));
}

export function startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
    const next = new Date(date.getTime());
    next.setDate(next.getDate() + days);
    return next;
}

export function addMonths(date: Date, months: number): Date {
    return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

/** Monday of the date's week: ISO weeks, which is what most planning tools show. */
export function startOfWeek(date: Date): Date {
    const day = startOfDay(date);
    return addDays(day, -((day.getDay() + 6) % 7));
}

export function startOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function startOfQuarter(date: Date): Date {
    return new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1);
}

/** Moves a date by whole snap units, keeping its time of day for day steps. */
export function addUnits(date: Date, units: number, snap: Snap): Date {
    return snap === "hour" ? new Date(date.getTime() + units * HOUR) : addDays(date, units);
}

/** Duration in days, to the nearest hour, so a daylight saving night does not show as 0.96 days. */
export function durationDays(start: Date, end: Date): number {
    return Math.round((end.getTime() - start.getTime()) / HOUR) / 24;
}

/** The ISO 8601 week number: the week that holds the year's first Thursday is week 1. */
export function isoWeek(date: Date): number {
    const thursday = addDays(startOfDay(date), 3 - ((date.getDay() + 6) % 7));
    const january = new Date(thursday.getFullYear(), 0, 1);
    return 1 + Math.floor(Math.round((thursday.getTime() - january.getTime()) / DAY) / 7);
}

/**
 * The span the chart covers: the tasks plus some air, and today so the today line is always
 * reachable, aligned to the scale's boundaries so the header starts with a whole cell.
 */
export function timelineRange(
    min: Date | undefined,
    max: Date | undefined,
    today: Date,
    zoom: Zoom,
    snap: Snap = "day"
): TimeScale {
    const first = min && min < today ? min : today;
    const last = max && max > today ? max : today;
    let start: Date;
    let end: Date;
    switch (zoom) {
        case "day":
            start = startOfWeek(addDays(first, -3));
            end = addDays(startOfWeek(addDays(last, 10)), 7);
            break;
        case "week":
            start = startOfWeek(addDays(first, -7));
            end = addDays(startOfWeek(addDays(last, 21)), 7);
            break;
        case "month":
            start = startOfMonth(addDays(first, -15));
            end = addMonths(last, 3);
            break;
        case "quarter":
            start = addMonths(startOfQuarter(first), -3);
            end = addMonths(startOfQuarter(last), 6);
            break;
        default:
            // Whole years, with about half a year of air on each side.
            start = new Date(addMonths(first, -6).getFullYear(), 0, 1);
            end = new Date(addMonths(last, 6).getFullYear() + 1, 0, 1);
    }
    return { start, end, pxPerDay: pxPerDay(zoom, snap) };
}

export interface ScaleCell {
    key: string;
    x: number;
    width: number;
    label: string;
    title: string;
    weekend?: boolean;
}

export interface Formatters {
    month: (date: Date) => string;
    monthYear: (date: Date) => string;
    dayMonth: (date: Date) => string;
    weekday: (date: Date) => string;
    full: (date: Date) => string;
    date: (date: Date) => string;
    dateTime: (date: Date) => string;
}

export function makeFormatters(locale?: string): Formatters {
    const make = (options: Intl.DateTimeFormatOptions): ((date: Date) => string) => {
        let format: Intl.DateTimeFormat;
        try {
            format = new Intl.DateTimeFormat(locale, options);
        } catch {
            // An unknown locale code from the app should not take the chart down.
            format = new Intl.DateTimeFormat(undefined, options);
        }
        return date => format.format(date);
    };
    return {
        month: make({ month: "short" }),
        monthYear: make({ month: "long", year: "numeric" }),
        dayMonth: make({ day: "numeric", month: "short" }),
        weekday: make({ weekday: "narrow" }),
        full: make({ weekday: "long", day: "numeric", month: "long", year: "numeric" }),
        date: make({ day: "numeric", month: "short", year: "numeric" }),
        dateTime: make({ day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    };
}

function cellsBetween(
    scale: TimeScale,
    first: Date,
    next: (date: Date) => Date,
    describe: (date: Date) => Pick<ScaleCell, "label" | "title" | "weekend">
): ScaleCell[] {
    const cells: ScaleCell[] = [];
    let current = first;
    // A hard cap keeps a misconfigured range from freezing the page.
    for (let guard = 0; current < scale.end && guard < 20000; guard++) {
        const following = next(current);
        const x = Math.max(0, dateToX(current, scale));
        const right = Math.min(scaleWidth(scale), dateToX(following, scale));
        if (right > x) {
            cells.push({ key: String(current.getTime()), x, width: right - x, ...describe(current) });
        }
        current = following;
    }
    return cells;
}

/** The two header rows: a coarse one (months or years) above a fine one (days, weeks, months, quarters). */
export function scaleCells(
    zoom: Zoom,
    scale: TimeScale,
    formats: Formatters
): { top: ScaleCell[]; bottom: ScaleCell[] } {
    const year = (date: Date): Pick<ScaleCell, "label" | "title"> => ({
        label: String(date.getFullYear()),
        title: String(date.getFullYear())
    });
    const month = (date: Date): Pick<ScaleCell, "label" | "title"> => ({
        label: formats.monthYear(date),
        title: formats.monthYear(date)
    });
    const nextMonth = (date: Date): Date => addMonths(date, 1);
    const nextYear = (date: Date): Date => new Date(date.getFullYear() + 1, 0, 1);
    const firstYear = new Date(scale.start.getFullYear(), 0, 1);

    switch (zoom) {
        case "day":
            return {
                top: cellsBetween(scale, startOfMonth(scale.start), nextMonth, month),
                bottom: cellsBetween(
                    scale,
                    startOfDay(scale.start),
                    date => addDays(date, 1),
                    date => ({
                        label: `${formats.weekday(date)} ${date.getDate()}`,
                        title: formats.full(date),
                        weekend: date.getDay() === 0 || date.getDay() === 6
                    })
                )
            };
        case "week":
            return {
                top: cellsBetween(scale, startOfMonth(scale.start), nextMonth, month),
                bottom: cellsBetween(
                    scale,
                    startOfWeek(scale.start),
                    date => addDays(date, 7),
                    date => ({ label: formats.dayMonth(date), title: `W${isoWeek(date)} · ${formats.full(date)}` })
                )
            };
        case "month":
            return {
                top: cellsBetween(scale, firstYear, nextYear, year),
                bottom: cellsBetween(scale, startOfMonth(scale.start), nextMonth, date => ({
                    label: formats.month(date),
                    title: formats.monthYear(date)
                }))
            };
        case "year": {
            // Decades above, years below: the years are what people read at this zoom.
            const decade = (date: Date): Pick<ScaleCell, "label" | "title"> => {
                const from = date.getFullYear() - (date.getFullYear() % 10);
                return { label: `${from}–${from + 9}`, title: `${from}–${from + 9}` };
            };
            const firstDecade = new Date(scale.start.getFullYear() - (scale.start.getFullYear() % 10), 0, 1);
            return {
                top: cellsBetween(scale, firstDecade, date => new Date(date.getFullYear() + 10, 0, 1), decade),
                bottom: cellsBetween(scale, firstYear, nextYear, year)
            };
        }
        default:
            return {
                top: cellsBetween(scale, firstYear, nextYear, year),
                bottom: cellsBetween(
                    scale,
                    startOfQuarter(scale.start),
                    date => addMonths(date, 3),
                    date => ({
                        label: `Q${Math.floor(date.getMonth() / 3) + 1}`,
                        title: `Q${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear()}`
                    })
                )
            };
    }
}

/** Saturday-to-Monday spans inside [fromX, toX], for shading. */
export function weekendSpans(scale: TimeScale, fromX = 0, toX = Infinity): Array<{ x: number; width: number }> {
    const spans: Array<{ x: number; width: number }> = [];
    const from = xToDate(Math.max(0, fromX - 2 * scale.pxPerDay), scale);
    let saturday = addDays(startOfWeek(from), 5);
    for (let guard = 0; saturday < scale.end && guard < 5000; guard++) {
        const x = dateToX(saturday, scale);
        if (x > toX) {
            break;
        }
        const width = dateToX(addDays(saturday, 2), scale) - x;
        if (x + width > fromX) {
            spans.push({ x, width });
        }
        saturday = addDays(saturday, 7);
    }
    return spans;
}
