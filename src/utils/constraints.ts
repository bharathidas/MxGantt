import { ALL_DAYS, rollToWorkingDay, WorkCalendar, workingDaysBetween } from "./calendar";
import { applyLag, DepType, Lag, placeAt, placeEndingAt, requirement, Span } from "./deps";

/**
 * 2.3 constraints, the eight MS Project knows: As soon / late as possible, Start / Finish no
 * earlier / later than, and Must start / finish on. They are read from a String or Enumeration
 * attribute (key or caption, long or short names, or MS Project's numbers 0-7) plus a date.
 *
 * The scheduler honours them alongside the links and the working calendar: auto-scheduling pushes
 * no task before its "no earlier than" date and never moves a "must" task, and Schedule plan runs
 * the full forward pass (as soon as possible) with a backward pass for "as late as possible".
 * Constraints that cannot be met are reported as conflicts, never silently broken.
 */

export type ConstraintType = "ASAP" | "ALAP" | "SNET" | "SNLT" | "FNET" | "FNLT" | "MSO" | "MFO";

export const CONSTRAINT_TYPES: ConstraintType[] = ["ASAP", "ALAP", "SNET", "SNLT", "FNET", "FNLT", "MSO", "MFO"];

export interface Constraint {
    type: ConstraintType;
    date?: Date;
}

/** MS Project's numbering (MSPDI ConstraintType). */
export const MSPDI_CONSTRAINT: Record<ConstraintType, number> = {
    ASAP: 0,
    ALAP: 1,
    MSO: 2,
    MFO: 3,
    SNET: 4,
    SNLT: 5,
    FNET: 6,
    FNLT: 7
};

const NAMES: Record<string, ConstraintType> = {
    asap: "ASAP",
    assoonaspossible: "ASAP",
    alap: "ALAP",
    aslateaspossible: "ALAP",
    snet: "SNET",
    startnoearlierthan: "SNET",
    snlt: "SNLT",
    startnolaterthan: "SNLT",
    fnet: "FNET",
    finishnoearlierthan: "FNET",
    fnlt: "FNLT",
    finishnolaterthan: "FNLT",
    mso: "MSO",
    muststarton: "MSO",
    mfo: "MFO",
    mustfinishon: "MFO"
};

/** A constraint type from what an attribute holds: "SNET", "Start_no_earlier_than", "Start no earlier than" or "4". */
export function parseConstraintType(value: string | undefined | null): ConstraintType | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    const text = String(value).trim();
    if (!text) {
        return undefined;
    }
    if (/^\d$/.test(text)) {
        const number = Number(text);
        return (Object.keys(MSPDI_CONSTRAINT) as ConstraintType[]).find(type => MSPDI_CONSTRAINT[type] === number);
    }
    const key = text.toLowerCase().replace(/[^a-z]/g, "");
    return NAMES[key];
}

export function needsDate(type: ConstraintType): boolean {
    return type !== "ASAP" && type !== "ALAP";
}

/** A constraint from a type and a date; types that need a date are dropped without one. */
export function makeConstraint(type: ConstraintType | undefined, date: Date | undefined): Constraint | undefined {
    if (!type) {
        return undefined;
    }
    if (needsDate(type)) {
        return date && !Number.isNaN(date.getTime()) ? { type, date } : undefined;
    }
    return { type };
}

export function isFixed(constraint: Constraint | undefined): boolean {
    return constraint?.type === "MSO" || constraint?.type === "MFO";
}

/** Constraints with a meaning beyond the default "as soon as possible". */
export function isConstrained(constraint: Constraint | undefined): boolean {
    return !!constraint && constraint.type !== "ASAP";
}

const SLACK = 60000;

export interface ConstraintConflict {
    /** early: before a "no earlier than" or "must" date; late: after a "no later than" or "must" date. */
    kind: "early" | "late";
    /** How far off, in (working) days. */
    days: number;
}

/** Whether the task breaks its constraint, and by how much. */
export function constraintConflict(
    span: { start?: Date; end?: Date },
    constraint: Constraint | undefined,
    calendar: WorkCalendar = ALL_DAYS
): ConstraintConflict | undefined {
    if (!constraint?.date || !span.start || !span.end) {
        return undefined;
    }
    const date = constraint.date.getTime();
    const start = span.start.getTime();
    const end = span.end.getTime();
    const days = (a: number, b: number): number =>
        Math.round(Math.abs(workingDaysBetween(calendar, new Date(Math.min(a, b)), new Date(Math.max(a, b)))) * 10) /
        10;
    switch (constraint.type) {
        case "SNET":
            return start < date - SLACK ? { kind: "early", days: days(start, date) } : undefined;
        case "FNET":
            return end < date - SLACK ? { kind: "early", days: days(end, date) } : undefined;
        case "SNLT":
            return start > date + SLACK ? { kind: "late", days: days(date, start) } : undefined;
        case "FNLT":
            return end > date + SLACK ? { kind: "late", days: days(date, end) } : undefined;
        case "MSO":
            return Math.abs(start - date) > SLACK
                ? { kind: start < date ? "early" : "late", days: days(start, date) }
                : undefined;
        case "MFO":
            return Math.abs(end - date) > SLACK
                ? { kind: end < date ? "early" : "late", days: days(end, date) }
                : undefined;
        default:
            return undefined;
    }
}

/**
 * A span after its constraint has had its say in push scheduling: a "no earlier than" date pushes
 * it later, a "must" date pins it; "no later than" cannot be met by pushing and is left to the
 * conflict check.
 */
export function constrainSpan(span: Span, constraint: Constraint | undefined, calendar: WorkCalendar): Span {
    if (!constraint?.date) {
        return span;
    }
    const date = constraint.date;
    switch (constraint.type) {
        case "SNET":
            return span.start.getTime() < date.getTime() ? placeAt(span, date, calendar) : span;
        case "FNET":
            return span.end.getTime() < date.getTime() ? placeEndingAt(span, date, calendar) : span;
        case "MSO":
            return placeAt(span, date, calendar);
        case "MFO":
            return placeEndingAt(span, date, calendar);
        default:
            return span;
    }
}

// ---------------------------------------------------------------- full scheduling pass

export interface PlanTask {
    id: string;
    start: Date;
    end: Date;
    constraint?: Constraint;
    /** Not moved by the scheduler: read-only tasks and work that has started (its start is a fact). */
    fixed?: boolean;
}

export interface PlanLink {
    from: string;
    to: string;
    type?: DepType;
    lag?: Lag;
}

export interface PlanResult {
    /** New spans of the tasks the pass moves. */
    moved: Map<string, Span>;
    /** Tasks whose constraint the links make impossible, after scheduling. */
    conflicts: string[];
    /** Tasks in a dependency cycle, left where they were. */
    cyclic: string[];
}

/** The earliest start a link allows the successor (with its working duration). */
function earliestFrom(
    type: DepType,
    lag: Lag | undefined,
    predecessor: Span,
    successor: Span,
    calendar: WorkCalendar
): Date {
    const need = requirement(type, lag, predecessor, calendar);
    if (need.start) {
        return rollToWorkingDay(calendar, need.start, 1);
    }
    return rollToWorkingDay(calendar, placeEndingAt(successor, need.end!, calendar).start, 1);
}

/**
 * Schedule plan: a forward pass in dependency order that puts every task with predecessors as early
 * as its links, lags, the calendar and its constraint allow (pulling tasks in as well as pushing
 * them out, the way MS Project's automatic scheduling does), keeps tasks without predecessors where
 * they are (their date is the plan's anchor) unless a constraint says otherwise, and then places
 * "as late as possible" tasks as late as their successors allow. Fixed tasks never move. Durations
 * are kept in working days, so split tasks keep their segments.
 */
export function schedulePlan(tasks: PlanTask[], links: PlanLink[], calendar: WorkCalendar = ALL_DAYS): PlanResult {
    const byId = new Map(tasks.map(task => [task.id, task]));
    const usable = links.filter(link => byId.has(link.from) && byId.has(link.to) && link.from !== link.to);
    const incoming = new Map<string, PlanLink[]>();
    const outgoing = new Map<string, PlanLink[]>();
    const pending = new Map<string, number>();
    tasks.forEach(task => {
        incoming.set(task.id, []);
        outgoing.set(task.id, []);
        pending.set(task.id, 0);
    });
    usable.forEach(link => {
        incoming.get(link.to)!.push(link);
        outgoing.get(link.from)!.push(link);
        pending.set(link.to, pending.get(link.to)! + 1);
    });
    const order = tasks.filter(task => pending.get(task.id) === 0).map(task => task.id);
    for (const id of order) {
        outgoing.get(id)!.forEach(link => {
            const left = pending.get(link.to)! - 1;
            pending.set(link.to, left);
            if (left === 0) {
                order.push(link.to);
            }
        });
    }
    const placed = new Set(order);
    const cyclic = tasks.filter(task => !placed.has(task.id)).map(task => task.id);

    const spans = new Map<string, Span>();
    tasks.forEach(task => spans.set(task.id, { start: task.start, end: task.end }));

    // Forward pass.
    order.forEach(id => {
        const task = byId.get(id)!;
        const original: Span = { start: task.start, end: task.end };
        if (task.fixed) {
            return;
        }
        const preds = incoming.get(id)!;
        let next = original;
        if (preds.length > 0) {
            let earliest: number | undefined;
            preds.forEach(link => {
                const from = spans.get(link.from)!;
                const start = earliestFrom(link.type ?? "FS", link.lag, from, original, calendar).getTime();
                earliest = earliest === undefined ? start : Math.max(earliest, start);
            });
            next = placeAt(original, new Date(earliest!), calendar);
        }
        const constraint = task.constraint;
        if (constraint?.date) {
            if (constraint.type === "MSO") {
                next = placeAt(next, constraint.date, calendar);
            } else if (constraint.type === "MFO") {
                next = placeEndingAt(next, constraint.date, calendar);
            } else {
                next = constrainSpan(next, constraint, calendar);
            }
        }
        spans.set(id, next);
    });

    // Backward pass for "as late as possible": as late as the successors (as now placed) allow.
    let projectEnd = -Infinity;
    spans.forEach(span => {
        projectEnd = Math.max(projectEnd, span.end.getTime());
    });
    [...order].reverse().forEach(id => {
        const task = byId.get(id)!;
        if (task.fixed || task.constraint?.type !== "ALAP") {
            return;
        }
        const current = spans.get(id)!;
        let latestFinish = projectEnd;
        outgoing.get(id)!.forEach(link => {
            const successor = spans.get(link.to)!;
            const type = link.type ?? "FS";
            // Undo the lag from the successor's anchor, then turn a bound on the start into one on the finish.
            const anchor = type === "FS" || type === "SS" ? successor.start : successor.end;
            const bound = applyLag(anchor, link.lag, calendar, -1);
            const finish =
                type === "SS" || type === "SF" ? placeAt(current, bound, calendar).end.getTime() : bound.getTime();
            latestFinish = Math.min(latestFinish, finish);
        });
        if (latestFinish > current.end.getTime()) {
            let next = placeEndingAt(current, new Date(latestFinish), calendar);
            const start = rollToWorkingDay(calendar, next.start, -1);
            if (start.getTime() !== next.start.getTime()) {
                next = placeAt(next, start, calendar);
            }
            if (next.end.getTime() <= latestFinish + SLACK && next.start.getTime() >= current.start.getTime()) {
                spans.set(id, next);
            }
        }
    });

    const moved = new Map<string, Span>();
    const conflicts: string[] = [];
    tasks.forEach(task => {
        const span = spans.get(task.id)!;
        if (
            Math.abs(span.start.getTime() - task.start.getTime()) > SLACK ||
            Math.abs(span.end.getTime() - task.end.getTime()) > SLACK
        ) {
            moved.set(task.id, span);
        }
        if (constraintConflict(span, task.constraint, calendar)) {
            conflicts.push(task.id);
        }
    });
    return { moved, conflicts, cyclic };
}
