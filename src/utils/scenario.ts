import { TaskValues } from "./history";
import { parseAssignments } from "./resources";
import { parseBaselines } from "./baselines";
import { parseSegments } from "./segments";
import { parseValues } from "./fields";
import { columnOfCellKey, isCellKey } from "./layout";
import { Task, withDependencies } from "./tasks";

/**
 * What-if scenarios: while a scenario is open, every change the user makes (drags, resizes,
 * auto-scheduled pushes, edits in the task list) is kept here, on top of the saved tasks, instead
 * of being written to the objects. Applying the scenario hands the differences to the normal write
 * path in one batch; discarding it simply forgets them.
 */

export type ScenarioMap = ReadonlyMap<string, TaskValues>;

/** One task's new values and what they were, the shape the widget writes. */
export interface ValueChange {
    id: string;
    next: TaskValues;
    previous: TaskValues;
}

export const VALUE_KEYS: Array<keyof TaskValues> = [
    "start",
    "end",
    "progress",
    "name",
    "deps",
    "assignments",
    "segments",
    "baselines",
    "fields"
];

function same(a: unknown, b: unknown): boolean {
    if (a instanceof Date && b instanceof Date) {
        return a.getTime() === b.getTime();
    }
    return a === b;
}

/** The task's current values for the given fields, as they are written back. */
export function taskValues(task: Task, keys: Array<keyof TaskValues> = VALUE_KEYS): TaskValues {
    const all: TaskValues = {
        start: task.start,
        end: task.end,
        progress: task.progress,
        name: task.nameValue ?? task.name,
        deps: task.depsText ?? "",
        assignments: task.assignmentsText ?? "",
        segments: task.segmentsText ?? "",
        baselines: task.baselinesText ?? "",
        fields: task.fieldsText ?? ""
    };
    const picked: TaskValues = {};
    keys.forEach(key => {
        // 1.2: configured attribute columns travel as cell:<column key>.
        (picked as Record<string, unknown>)[key] = isCellKey(key)
            ? task.cells?.[columnOfCellKey(key)]?.raw ?? null
            : all[key];
    });
    return picked;
}

/** The task as it looks with the values applied. */
export function applyValues(task: Task, values: TaskValues): Task {
    let next: Task = { ...task };
    if (values.start) {
        next.start = values.start;
    }
    if (values.end) {
        next.end = values.end;
    }
    if (values.progress !== undefined) {
        next.progress = values.progress;
    }
    if (values.name !== undefined) {
        next.name = values.name;
        next.nameValue = values.name;
    }
    if (values.deps !== undefined) {
        next = withDependencies(next, values.deps);
    }
    if (values.assignments !== undefined) {
        next.assignmentsText = values.assignments;
        next.assignments = parseAssignments(values.assignments);
    }
    if (values.segments !== undefined) {
        next.segmentsText = values.segments;
        next.segments = parseSegments(values.segments);
    }
    if (values.baselines !== undefined) {
        next.baselinesText = values.baselines;
        next.baselines = parseBaselines(values.baselines);
    }
    if (values.fields !== undefined) {
        next.fieldsText = values.fields;
        next.fieldValues = parseValues(values.fields);
    }
    Object.keys(values).forEach(key => {
        if (!isCellKey(key)) {
            return;
        }
        const value = values[key];
        if (value === undefined) {
            return;
        }
        const column = columnOfCellKey(key);
        // The text is worked out again from the value until the data source sends its own.
        next.cells = { ...next.cells, [column]: { cls: next.cells?.[column]?.cls, raw: value } };
    });
    return next;
}

/** The tasks with the scenario's values on top; the same array when the scenario is empty. */
export function applyScenario(tasks: Task[], scenario: ScenarioMap | undefined): Task[] {
    if (!scenario || scenario.size === 0) {
        return tasks;
    }
    return tasks.map(task => {
        const values = scenario.get(task.id);
        return values ? applyValues(task, values) : task;
    });
}

/** Adds a batch of changes to the scenario; later values of a field replace earlier ones. */
export function mergeScenario(
    scenario: ScenarioMap,
    entries: Array<{ id: string; next: TaskValues }>
): Map<string, TaskValues> {
    const merged = new Map(scenario);
    entries.forEach(entry => merged.set(entry.id, { ...merged.get(entry.id), ...entry.next }));
    return merged;
}

/**
 * What applying the scenario writes: per task, only the fields that differ from the saved task,
 * with the saved values as `previous` (for undo). Tasks that are gone or end up unchanged are left out.
 */
export function scenarioChanges(base: Task[], scenario: ScenarioMap | undefined): ValueChange[] {
    if (!scenario || scenario.size === 0) {
        return [];
    }
    const changes: ValueChange[] = [];
    base.forEach(task => {
        const values = scenario.get(task.id);
        if (!values) {
            return;
        }
        const saved = taskValues(task, [...VALUE_KEYS, ...Object.keys(values).filter(isCellKey)]);
        const next: TaskValues = {};
        const previous: TaskValues = {};
        (Object.keys(values) as Array<keyof TaskValues>).forEach(key => {
            const value = values[key];
            if (value === undefined || same(value, saved[key])) {
                return;
            }
            (next as Record<string, unknown>)[key] = value;
            (previous as Record<string, unknown>)[key] = saved[key];
        });
        if (Object.keys(next).length > 0) {
            changes.push({ id: task.id, next, previous });
        }
    });
    return changes;
}

export interface ScenarioSummary {
    /** The plan's end date as saved, and with the scenario. */
    currentEnd?: Date;
    plannedEnd?: Date;
    /** Tasks whose start or end the scenario changes. */
    moved: number;
    /** Tasks the scenario changes in any way, which applying it writes. */
    changed: number;
}

function latestEnd(tasks: Task[]): Date | undefined {
    let end: Date | undefined;
    tasks.forEach(task => {
        if (task.end && (!end || task.end > end)) {
            end = task.end;
        }
    });
    return end;
}

export function scenarioSummary(base: Task[], scenario: ScenarioMap | undefined): ScenarioSummary {
    const changes = scenarioChanges(base, scenario);
    return {
        currentEnd: latestEnd(base),
        plannedEnd: latestEnd(applyScenario(base, scenario)),
        moved: changes.filter(change => change.next.start !== undefined || change.next.end !== undefined).length,
        changed: changes.length
    };
}
