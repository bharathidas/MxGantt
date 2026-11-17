import { ALL_DAYS, WorkCalendar } from "./calendar";
import { splitAssignees } from "./workload";
import { isLate, Task } from "./tasks";

export interface TaskFilter {
    /** Free text matched against the name, group, assignee, WBS number and extra columns. */
    text: string;
    critical: boolean;
    late: boolean;
    mine: boolean;
    /** 1.1: a custom field filter, "key=value"; empty for none. */
    field?: string;
}

export const NO_FILTER: TaskFilter = { text: "", critical: false, late: false, mine: false, field: "" };

export function isFiltering(filter: TaskFilter): boolean {
    return filter.text.trim() !== "" || filter.critical || filter.late || filter.mine || !!filter.field;
}

export interface FilterContext {
    critical: ReadonlySet<string>;
    now: Date;
    /** The current user's name as it appears in the assignee attribute. */
    me?: string;
    wbs?: ReadonlyMap<string, string>;
    calendar?: WorkCalendar;
    /** 1.1: the custom field texts of a task, searched too. */
    fieldText?: (task: Task) => string;
    /** 1.1: whether a task passes the custom field filter. */
    fieldMatch?: (task: Task, filter: string) => boolean;
}

/** The text a task is searched by. */
export function searchText(task: Task, wbs?: ReadonlyMap<string, string>, extra?: string): string {
    return [
        task.name,
        task.code,
        task.subtitle,
        task.group,
        task.project,
        task.assignee,
        task.assignmentsText,
        task.key,
        wbs?.get(task.id),
        ...(task.columns ?? []),
        extra
    ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
}

/**
 * The tasks that pass the filter. Every word of the search text has to appear somewhere; the
 * toggles combine with AND.
 */
export function filterTasks(tasks: Task[], filter: TaskFilter, context: FilterContext): Task[] {
    if (!isFiltering(filter)) {
        return tasks;
    }
    const words = filter.text.toLowerCase().split(/\s+/).filter(Boolean);
    const me = context.me?.trim().toLowerCase();
    const calendar = context.calendar ?? ALL_DAYS;
    return tasks.filter(task => {
        if (filter.critical && !context.critical.has(task.id)) {
            return false;
        }
        if (filter.late && !isLate(task, context.now, calendar)) {
            return false;
        }
        if (filter.mine && (!me || !splitAssignees(task.assignee).some(name => name.toLowerCase() === me))) {
            return false;
        }
        if (filter.field && context.fieldMatch && !context.fieldMatch(task, filter.field)) {
            return false;
        }
        if (words.length > 0) {
            const haystack = searchText(task, context.wbs, context.fieldText?.(task));
            return words.every(word => haystack.includes(word));
        }
        return true;
    });
}
