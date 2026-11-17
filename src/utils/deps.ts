import {
    addWorkingTime,
    ALL_DAYS,
    moveLike,
    rollToWorkingDay,
    WorkCalendar,
    workingDaysBetween,
    workingDaysPerWeek
} from "./calendar";
import { HOUR } from "./time";

/**
 * Dependency types and lags, written in the Depends on attribute the way planning tools do:
 * "3" (finish to start), "5SS", "7FF+2d", "9SF-1d", "4FS+3h" or "6 SS +1w", separated by commas.
 */

export type DepType = "FS" | "SS" | "FF" | "SF";
export const DEP_TYPES: DepType[] = ["FS", "SS", "FF", "SF"];

export interface Lag {
    /** Negative for a lead. */
    amount: number;
    /** d: working days (calendar days without a working calendar), w: weeks, h: elapsed hours. */
    unit: "d" | "w" | "h";
}

export interface Dependency {
    /** The text as written, so a key that itself looks like "A-1" or "3FS" can still be matched. */
    raw: string;
    key: string;
    type: DepType;
    lag?: Lag;
}

const TYPED = /^(\S+?)\s*(FS|SS|FF|SF)?\s*(?:([+-])\s*(\d+(?:[.,]\d+)?)\s*(d|h|w|days?|hours?|weeks?)?)?$/i;

function parseToken(raw: string): Dependency | undefined {
    const match = TYPED.exec(raw);
    if (!match) {
        return undefined;
    }
    const [, key, type, sign, amount, unit] = match;
    const dependency: Dependency = { raw, key, type: (type?.toUpperCase() as DepType | undefined) ?? "FS" };
    if (sign && amount) {
        const value = Number(amount.replace(",", ".")) * (sign === "-" ? -1 : 1);
        const letter = (unit ?? "d").charAt(0).toLowerCase() as Lag["unit"];
        if (value !== 0) {
            dependency.lag = { amount: value, unit: letter };
        }
    }
    return dependency;
}

/** Every dependency in the text; plain space-separated keys ("3 5") still work as they did in 1.0. */
export function parseDependencies(text: string | undefined): Dependency[] {
    if (!text) {
        return [];
    }
    const result: Dependency[] = [];
    text.split(/[,;]+/)
        .map(part => part.trim())
        .filter(part => part.length > 0)
        .forEach(part => {
            const whole = parseToken(part);
            if (whole) {
                result.push(whole);
                return;
            }
            part.split(/\s+/).forEach(word => {
                const single = parseToken(word);
                if (single) {
                    result.push(single);
                }
            });
        });
    return result;
}

export function formatLag(lag: Lag | undefined): string {
    if (!lag || lag.amount === 0) {
        return "";
    }
    const amount = Math.abs(lag.amount);
    return `${lag.amount < 0 ? "-" : "+"}${amount}${lag.unit}`;
}

/** The short form: "3" for a plain finish-to-start link, otherwise "3SS", "3FS+2d" and so on. */
export function formatDependency(dependency: Pick<Dependency, "key" | "type" | "lag">): string {
    const lag = formatLag(dependency.lag);
    const type = dependency.type === "FS" && !lag ? "" : dependency.type;
    return `${dependency.key}${type}${lag}`;
}

/** Adds (or replaces) the dependency on `key` in a Depends on text, keeping the other entries as written. */
export function addDependency(text: string | undefined, dependency: Pick<Dependency, "key" | "type" | "lag">): string {
    const kept = parseDependencies(text)
        .filter(entry => entry.key !== dependency.key && entry.raw !== dependency.key)
        .map(entry => entry.raw);
    return [...kept, formatDependency(dependency)].join(", ");
}

/** Removes the dependency on `key` from a Depends on text. */
export function removeDependency(text: string | undefined, key: string): string {
    return parseDependencies(text)
        .filter(entry => entry.key !== key && entry.raw !== key)
        .map(entry => entry.raw)
        .join(", ");
}

/** A date moved by a lag: days and weeks follow the working calendar, hours are elapsed time. */
export function applyLag(date: Date, lag: Lag | undefined, calendar: WorkCalendar = ALL_DAYS, sign: 1 | -1 = 1): Date {
    if (!lag || lag.amount === 0) {
        return date;
    }
    const amount = lag.amount * sign;
    if (lag.unit === "h") {
        return new Date(date.getTime() + amount * HOUR);
    }
    const days = lag.unit === "w" ? amount * workingDaysPerWeek(calendar) : amount;
    return addWorkingTime(calendar, date, days);
}

export interface Span {
    start: Date;
    end: Date;
}

/**
 * What a link asks of its successor: the earliest start (FS, SS) or the earliest end (FF, SF).
 */
export function requirement(
    type: DepType,
    lag: Lag | undefined,
    predecessor: Span,
    calendar: WorkCalendar = ALL_DAYS
): { start?: Date; end?: Date } {
    switch (type) {
        case "SS":
            return { start: applyLag(predecessor.start, lag, calendar) };
        case "FF":
            return { end: applyLag(predecessor.end, lag, calendar) };
        case "SF":
            return { end: applyLag(predecessor.start, lag, calendar) };
        default:
            return { start: applyLag(predecessor.end, lag, calendar) };
    }
}

/** A minute's slack, so rounding in the data never shows up as a conflict. */
const SLACK = 60000;

/** Whether the successor breaks the link: it starts (FS, SS) or ends (FF, SF) too early. */
export function violates(
    type: DepType,
    lag: Lag | undefined,
    predecessor: Span,
    successor: Span,
    calendar: WorkCalendar = ALL_DAYS
): boolean {
    const need = requirement(type, lag, predecessor, calendar);
    if (need.start) {
        return successor.start.getTime() < need.start.getTime() - SLACK;
    }
    return !!need.end && successor.end.getTime() < need.end.getTime() - SLACK;
}

/** A span moved so it starts at `start`, keeping its working duration. */
export function placeAt(span: Span, start: Date, calendar: WorkCalendar): Span {
    if (!calendar.active) {
        return { start, end: moveLike(span.end, span.start, start) };
    }
    const duration = workingDaysBetween(calendar, span.start, span.end);
    return { start, end: addWorkingTime(calendar, start, duration) };
}

/** A span moved so it ends at `end`, keeping its working duration. */
export function placeEndingAt(span: Span, end: Date, calendar: WorkCalendar): Span {
    if (!calendar.active) {
        return { start: moveLike(span.start, span.end, end), end };
    }
    const duration = workingDaysBetween(calendar, span.start, span.end);
    return { start: addWorkingTime(calendar, end, -duration), end };
}

export interface ScheduleLink {
    from: string;
    to: string;
    type?: DepType;
    lag?: Lag;
}

/**
 * Auto-scheduling: after the tasks in `changed` have moved, pushes their successors (and theirs)
 * later wherever a link is now broken, keeping each pushed task's working duration and starting it
 * on a working day. Tasks are only ever pushed later, never pulled earlier; tasks in `locked` and
 * the changed tasks themselves are not touched, and a dependency cycle stops after a bounded number
 * of steps. Returns the new spans of the pushed tasks only.
 */
export function autoSchedule(
    spans: ReadonlyMap<string, Span>,
    links: ScheduleLink[],
    changed: ReadonlyMap<string, Span>,
    calendar: WorkCalendar = ALL_DAYS,
    locked: ReadonlySet<string> = new Set(),
    /**
     * 2.3: a task's own say about where it may go (its constraint): returns the span to use, or
     * undefined when the task must not move at all.
     */
    adjust?: (id: string, span: Span) => Span | undefined
): Map<string, Span> {
    const outgoing = new Map<string, ScheduleLink[]>();
    links.forEach(link => {
        const list = outgoing.get(link.from) ?? [];
        list.push(link);
        outgoing.set(link.from, list);
    });
    const current = new Map(spans);
    changed.forEach((span, id) => current.set(id, span));
    const pushed = new Map<string, Span>();
    const queue = [...changed.keys()];
    let budget = (spans.size + 1) * 8 + links.length * 2;
    while (queue.length > 0 && budget-- > 0) {
        const id = queue.shift()!;
        const predecessor = current.get(id);
        if (!predecessor) {
            continue;
        }
        (outgoing.get(id) ?? []).forEach(link => {
            const successor = current.get(link.to);
            if (!successor || changed.has(link.to) || locked.has(link.to) || link.to === id) {
                return;
            }
            const type = link.type ?? "FS";
            if (!violates(type, link.lag, predecessor, successor, calendar)) {
                return;
            }
            const need = requirement(type, link.lag, predecessor, calendar);
            let next: Span;
            if (need.start) {
                next = placeAt(successor, rollToWorkingDay(calendar, need.start, 1), calendar);
            } else {
                next = placeEndingAt(successor, need.end!, calendar);
                if (calendar.active) {
                    // A start that lands on a weekend moves to the next working day, as a user would.
                    const start = rollToWorkingDay(calendar, next.start, 1);
                    if (start.getTime() !== next.start.getTime()) {
                        next = placeAt(next, start, calendar);
                    }
                }
            }
            if (adjust) {
                const adjusted = adjust(link.to, next);
                if (!adjusted) {
                    return;
                }
                next = adjusted;
            }
            current.set(link.to, next);
            pushed.set(link.to, next);
            queue.push(link.to);
        });
    }
    return pushed;
}
