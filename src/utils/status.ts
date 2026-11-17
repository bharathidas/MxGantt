import { ALL_DAYS, WorkCalendar, workingDaysBetween } from "./calendar";
import { isMilestone, Link, Task } from "./tasks";

/**
 * Status date tracking: how far along a task should be at the status date if work went at an even
 * pace over its working days, and whether its progress is behind that. Plus the dependency chain
 * of a task, which the chart highlights on hover.
 */

/**
 * The share of the task's working time that lies before the status date, 0 to 100. Milestones are
 * due (100) once the status date reaches them. Undefined for tasks without dates.
 */
export function expectedProgress(task: Task, statusDate: Date, calendar: WorkCalendar = ALL_DAYS): number | undefined {
    if (!task.start || !task.end) {
        return undefined;
    }
    const at = statusDate.getTime();
    if (isMilestone(task)) {
        return at >= task.start.getTime() ? 100 : 0;
    }
    if (at <= task.start.getTime()) {
        return 0;
    }
    if (at >= task.end.getTime()) {
        return 100;
    }
    const total = workingDaysBetween(calendar, task.start, task.end);
    if (total <= 0) {
        return 100;
    }
    const done = workingDaysBetween(calendar, task.start, statusDate);
    return Math.max(0, Math.min(100, (done / total) * 100));
}

/**
 * Behind schedule: the task has a progress value and it is more than half a percentage point
 * below what is expected at the status date. Without a progress attribute nothing is behind.
 */
export function isBehind(task: Task, statusDate: Date, calendar: WorkCalendar = ALL_DAYS): boolean {
    if (task.progress === undefined || task.progress >= 100) {
        return false;
    }
    const expected = expectedProgress(task, statusDate, calendar);
    return expected !== undefined && expected - task.progress > 0.5;
}

export function behindTasks(tasks: Task[], statusDate: Date, calendar: WorkCalendar = ALL_DAYS): Set<string> {
    const behind = new Set<string>();
    tasks.forEach(task => {
        if (isBehind(task, statusDate, calendar)) {
            behind.add(task.id);
        }
    });
    return behind;
}

export interface Chain {
    tasks: Set<string>;
    /** Links as "from>to". */
    links: Set<string>;
}

export function linkKey(link: Pick<Link, "from" | "to">): string {
    return `${link.from}>${link.to}`;
}

/** Everything the task depends on (all the way up) and everything that depends on it (all the way down). */
export function dependencyChain(links: Array<Pick<Link, "from" | "to">>, id: string): Chain {
    const outgoing = new Map<string, Array<Pick<Link, "from" | "to">>>();
    const incoming = new Map<string, Array<Pick<Link, "from" | "to">>>();
    links.forEach(link => {
        outgoing.set(link.from, [...(outgoing.get(link.from) ?? []), link]);
        incoming.set(link.to, [...(incoming.get(link.to) ?? []), link]);
    });
    const chain: Chain = { tasks: new Set([id]), links: new Set() };
    const walk = (map: typeof outgoing, next: (link: Pick<Link, "from" | "to">) => string): void => {
        const seen = new Set([id]);
        const queue = [id];
        while (queue.length > 0) {
            const current = queue.shift()!;
            (map.get(current) ?? []).forEach(link => {
                chain.links.add(linkKey(link));
                const other = next(link);
                chain.tasks.add(other);
                if (!seen.has(other)) {
                    seen.add(other);
                    queue.push(other);
                }
            });
        }
    };
    walk(outgoing, link => link.to);
    walk(incoming, link => link.from);
    return chain;
}
