import { ALL_DAYS, isWorkingDay, rollToWorkingDay, WorkCalendar, workingDaysBetween } from "./calendar";
import { constrainSpan, isFixed } from "./constraints";
import { placeAt, placeEndingAt, requirement, Span } from "./deps";
import { WorkClock } from "./cost";
import { assignmentsOf, dayNumber, ResourceInfo, resourceInfo } from "./resources";
import { segmentSpans } from "./segments";
import { backwardPass, Link, linkType, Task } from "./tasks";
import { addDays, startOfDay } from "./time";

/**
 * 2.3 resource levelling: delays tasks until no resource works more than its maximum units on any
 * working day, the way MS Project's Level Resources does by default (delay only, never split or
 * shorten work, never move work that has started).
 *
 * It is a serial schedule generation scheme with a minimum-float rule: tasks are placed one by one
 * in dependency order; among the tasks whose predecessors are placed, the one with the highest
 * priority goes first, then the one with the least total float, then the earliest. Each task gets
 * the earliest start (not before its current start) at which its links, constraint and the
 * resources allow it. So tasks with float are delayed before critical ones, and a task that has
 * to move pushes its successors along. Priority 1000 (like MS Project), read-only tasks, started
 * tasks and "must start / finish on" constraints are never moved.
 */

export interface LevelOptions {
    calendar?: WorkCalendar;
    resources?: ReadonlyMap<string, ResourceInfo>;
    /** Tasks that must stay where they are (read-only ones). */
    locked?: ReadonlySet<string>;
    /** How many working days a task may be delayed at most before levelling gives up on it. */
    horizon?: number;
}

export interface LevelDelay {
    id: string;
    /** Working days the task moves. */
    days: number;
    /** It moves further than its total float, so the plan's end moves. */
    beyondFloat: boolean;
}

export interface LevelResult {
    moved: Map<string, Span>;
    delays: LevelDelay[];
    /** Tasks still over-allocated afterwards: one assignment above the maximum on its own, or nowhere to go. */
    unresolved: string[];
    finishBefore?: Date;
    finishAfter?: Date;
}

const DEFAULT_PRIORITY = 500;
const DO_NOT_LEVEL = 1000;
const SLACK = 60000;

interface Item {
    task: Task;
    index: number;
    priority: number;
    float: number;
    fixed: boolean;
}

/** Order of placement: fixed tasks first, then higher priority, less float, earlier start. */
function before(a: Item, b: Item): boolean {
    if (a.fixed !== b.fixed) {
        return a.fixed;
    }
    if (a.priority !== b.priority) {
        return a.priority > b.priority;
    }
    if (a.float !== b.float) {
        return a.float < b.float;
    }
    const start = a.task.start!.getTime() - b.task.start!.getTime();
    return start !== 0 ? start < 0 : a.index < b.index;
}

class Heap {
    private items: Item[] = [];

    get size(): number {
        return this.items.length;
    }

    push(item: Item): void {
        const items = this.items;
        items.push(item);
        let i = items.length - 1;
        while (i > 0) {
            const parent = Math.floor((i - 1) / 2);
            if (!before(items[i], items[parent])) {
                break;
            }
            [items[i], items[parent]] = [items[parent], items[i]];
            i = parent;
        }
    }

    pop(): Item | undefined {
        const items = this.items;
        const top = items[0];
        const last = items.pop();
        if (items.length > 0 && last) {
            items[0] = last;
            let i = 0;
            for (;;) {
                const left = i * 2 + 1;
                const right = left + 1;
                let best = i;
                if (left < items.length && before(items[left], items[best])) {
                    best = left;
                }
                if (right < items.length && before(items[right], items[best])) {
                    best = right;
                }
                if (best === i) {
                    break;
                }
                [items[i], items[best]] = [items[best], items[i]];
                i = best;
            }
        }
        return top;
    }
}

export function levelResources(tasks: Task[], links: Link[], options: LevelOptions = {}): LevelResult {
    const calendar = options.calendar ?? ALL_DAYS;
    const horizon = options.horizon ?? 730;
    const dated = tasks.filter(task => task.start && task.end);
    const result: LevelResult = { moved: new Map(), delays: [], unresolved: [] };
    if (dated.length === 0) {
        return result;
    }
    const byId = new Map(dated.map(task => [task.id, task]));
    const usable = links.filter(link => byId.has(link.from) && byId.has(link.to) && link.from !== link.to);
    // Total float in working days, looked up on a prefix table: a backward pass over years of plan
    // would otherwise count day by day for every task.
    const pass = backwardPass(dated, usable, calendar);
    const floats = new Map<string, number>();
    if (pass.latestFinish.size > 0) {
        let from = Infinity;
        let to = -Infinity;
        dated.forEach(task => {
            from = Math.min(from, task.start!.getTime());
            to = Math.max(to, task.end!.getTime());
        });
        const clock = calendar.active ? new WorkClock(calendar, new Date(from), new Date(to)) : undefined;
        pass.latestFinish.forEach((latest, id) => {
            const end = byId.get(id)!.end!;
            const days = clock
                ? clock.between(end, new Date(latest))
                : Math.max(0, (latest - end.getTime()) / 86400000);
            floats.set(id, Math.round(days * 10) / 10);
        });
    }

    const incoming = new Map<string, Link[]>();
    const outgoing = new Map<string, Link[]>();
    const pending = new Map<string, number>();
    dated.forEach(task => {
        incoming.set(task.id, []);
        outgoing.set(task.id, []);
        pending.set(task.id, 0);
    });
    usable.forEach(link => {
        incoming.get(link.to)!.push(link);
        outgoing.get(link.from)!.push(link);
        pending.set(link.to, pending.get(link.to)! + 1);
    });

    let base = dated[0].start!;
    let finishBefore = -Infinity;
    dated.forEach(task => {
        if (task.start! < base) {
            base = task.start!;
        }
        finishBefore = Math.max(finishBefore, task.end!.getTime());
    });
    base = startOfDay(base);

    const items = new Map<string, Item>();
    dated.forEach((task, index) => {
        const priority = task.priority ?? DEFAULT_PRIORITY;
        items.set(task.id, {
            task,
            index,
            priority,
            float: floats.get(task.id) ?? Number.MAX_SAFE_INTEGER,
            fixed:
                !!options.locked?.has(task.id) ||
                priority >= DO_NOT_LEVEL ||
                (task.progress ?? 0) > 0 ||
                isFixed(task.constraint)
        });
    });

    // Units booked per resource and day number.
    const usage = new Map<string, Map<number, number>>();
    const bookedOn = (resource: string): Map<number, number> => {
        let map = usage.get(resource);
        if (!map) {
            map = new Map();
            usage.set(resource, map);
        }
        return map;
    };
    const workingDays = (task: Task, span: Span): number[] => {
        const days: number[] = [];
        segmentSpans({ start: span.start, end: span.end, segments: task.segments }, calendar).forEach(piece => {
            let day = startOfDay(piece.start);
            for (let guard = 0; day.getTime() < piece.end.getTime() && guard < 5000; guard++) {
                if (isWorkingDay(calendar, day)) {
                    days.push(dayNumber(day, base));
                }
                day = addDays(day, 1);
            }
        });
        return days;
    };
    const unresolved = new Set<string>();
    /** Whether the task fits at `span`; marks it unresolved when one of its assignments exceeds a maximum on its own. */
    const fits = (task: Task, span: Span): boolean => {
        const assignments = assignmentsOf(task).filter(entry => entry.units > 0);
        if (assignments.length === 0) {
            return true;
        }
        const days = workingDays(task, span);
        for (const assignment of assignments) {
            const max = resourceInfo(assignment.resource, options.resources).maxUnits;
            const booked = usage.get(assignment.resource);
            for (const day of days) {
                const used = booked?.get(day) ?? 0;
                if (used > 1e-9 && used + assignment.units > max + 1e-6) {
                    return false;
                }
            }
        }
        return true;
    };
    const book = (task: Task, span: Span): void => {
        const assignments = assignmentsOf(task).filter(entry => entry.units > 0);
        if (assignments.length === 0) {
            return;
        }
        const days = workingDays(task, span);
        assignments.forEach(assignment => {
            const max = resourceInfo(assignment.resource, options.resources).maxUnits;
            const booked = bookedOn(assignment.resource);
            days.forEach(day => {
                const next = (booked.get(day) ?? 0) + assignment.units;
                booked.set(day, next);
                if (next > max + 1e-6) {
                    unresolved.add(task.id);
                }
            });
        });
    };

    const placed = new Map<string, Span>();
    const heap = new Heap();
    dated.forEach(task => {
        if (pending.get(task.id) === 0) {
            heap.push(items.get(task.id)!);
        }
    });
    const place = (item: Item): void => {
        const task = item.task;
        const original: Span = { start: task.start!, end: task.end! };
        let span = original;
        if (!item.fixed) {
            // Links from predecessors that levelling moved.
            let earliest = original.start.getTime();
            incoming.get(task.id)!.forEach(link => {
                const from = placed.get(link.from);
                const was = byId.get(link.from)!;
                if (!from || from.start.getTime() === was.start!.getTime()) {
                    return;
                }
                const need = requirement(linkType(link), link.lag, from, calendar);
                const start = need.start
                    ? rollToWorkingDay(calendar, need.start, 1)
                    : rollToWorkingDay(calendar, placeEndingAt(original, need.end!, calendar).start, 1);
                earliest = Math.max(earliest, start.getTime());
            });
            span =
                earliest > original.start.getTime() + SLACK
                    ? placeAt(original, new Date(earliest), calendar)
                    : original;
            span = constrainSpan(span, task.constraint, calendar);
            const first = span;
            let limit: number | undefined;
            if (task.constraint?.date && task.constraint.type === "SNLT") {
                limit = task.constraint.date.getTime();
            } else if (task.constraint?.date && task.constraint.type === "FNLT") {
                limit = placeEndingAt(original, task.constraint.date, calendar).start.getTime();
            }
            let found = false;
            for (let tries = 0; tries <= horizon; tries++) {
                if (limit !== undefined && span.start.getTime() > limit + SLACK) {
                    break;
                }
                if (fits(task, span)) {
                    found = true;
                    break;
                }
                span = placeAt(span, rollToWorkingDay(calendar, addDays(span.start, 1), 1), calendar);
            }
            if (!found) {
                span = first;
                unresolved.add(task.id);
            }
        }
        book(task, span);
        placed.set(task.id, span);
        outgoing.get(task.id)!.forEach(link => {
            const left = pending.get(link.to)! - 1;
            pending.set(link.to, left);
            if (left === 0) {
                heap.push(items.get(link.to)!);
            }
        });
    };
    while (heap.size > 0) {
        place(heap.pop()!);
    }
    // Tasks in a dependency cycle are never ready: they stay where they are.
    dated.forEach(task => {
        if (!placed.has(task.id)) {
            book(task, { start: task.start!, end: task.end! });
            placed.set(task.id, { start: task.start!, end: task.end! });
        }
    });

    let finishAfter = -Infinity;
    placed.forEach((span, id) => {
        finishAfter = Math.max(finishAfter, span.end.getTime());
        const task = byId.get(id)!;
        if (Math.abs(span.start.getTime() - task.start!.getTime()) > SLACK) {
            result.moved.set(id, span);
            const days = Math.round(workingDaysBetween(calendar, task.start!, span.start) * 10) / 10;
            const float = items.get(id)!.float;
            result.delays.push({ id, days, beyondFloat: days > float + 0.05 });
        }
    });
    result.unresolved = [...unresolved];
    result.finishBefore = new Date(finishBefore);
    result.finishAfter = new Date(finishAfter);
    return result;
}
