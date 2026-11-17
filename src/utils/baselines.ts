import { ALL_DAYS, WorkCalendar, workingDaysBetween } from "./calendar";
import { Task } from "./tasks";

/**
 * 2.3 named baselines: up to ten snapshots of the plan, kept per task as JSON in one String
 * attribute, so no domain model change is needed for more of them:
 *
 *   [{"name":"Approved plan","start":"2026-10-01T00:00:00.000Z","finish":"2026-10-09T00:00:00.000Z",
 *     "cost":1200,"saved":"2026-10-01T09:12:00.000Z"}]
 *
 * The widget saves, shows and compares them; the 2.0 Baseline start / end attributes keep working as
 * the baseline called "Baseline".
 */

export interface BaselineEntry {
    name: string;
    start: Date;
    finish: Date;
    /** The cost at the time of saving, when costs are configured. */
    cost?: number;
    saved?: Date;
}

export const MAX_BASELINES = 10;
/** The selection that means the Baseline start and Baseline end attributes. */
export const ATTRIBUTE_BASELINE = "\u0000attributes";

function toDate(value: unknown): Date | undefined {
    if (typeof value !== "string" && typeof value !== "number") {
        return undefined;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

/** The baselines stored on a task; anything malformed is skipped, never thrown. */
export function parseBaselines(text: string | undefined): BaselineEntry[] {
    if (!text || !text.trim()) {
        return [];
    }
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return [];
    }
    const list: unknown[] = Array.isArray(value)
        ? value
        : value && typeof value === "object"
        ? Object.entries(value as Record<string, unknown>).map(([name, entry]) =>
              entry && typeof entry === "object" ? { name, ...(entry as object) } : undefined
          )
        : [];
    const result: BaselineEntry[] = [];
    list.forEach(raw => {
        if (!raw || typeof raw !== "object") {
            return;
        }
        const record = raw as Record<string, unknown>;
        const name = typeof record.name === "string" ? record.name.trim() : "";
        const start = toDate(record.start ?? record.s);
        const finish = toDate(record.finish ?? record.end ?? record.f ?? record.e);
        if (!name || !start || !finish || result.some(entry => entry.name === name)) {
            return;
        }
        const entry: BaselineEntry = {
            name,
            start: finish < start ? finish : start,
            finish: finish < start ? start : finish
        };
        const cost = typeof record.cost === "number" ? record.cost : Number(record.cost);
        if (record.cost !== undefined && record.cost !== null && Number.isFinite(cost)) {
            entry.cost = cost;
        }
        const saved = toDate(record.saved);
        if (saved) {
            entry.saved = saved;
        }
        result.push(entry);
    });
    return result.slice(0, MAX_BASELINES);
}

export function formatBaselines(entries: BaselineEntry[]): string {
    if (entries.length === 0) {
        return "";
    }
    return JSON.stringify(
        entries.slice(0, MAX_BASELINES).map(entry => {
            const out: Record<string, unknown> = {
                name: entry.name,
                start: entry.start.toISOString(),
                finish: entry.finish.toISOString()
            };
            if (entry.cost !== undefined) {
                out.cost = Math.round(entry.cost * 100) / 100;
            }
            if (entry.saved) {
                out.saved = entry.saved.toISOString();
            }
            return out;
        })
    );
}

/** Every baseline name in the plan, in the order they were first saved. */
export function baselineNames(tasks: Task[]): string[] {
    const seen = new Map<string, number>();
    tasks.forEach(task => {
        (task.baselines ?? []).forEach(entry => {
            const saved = entry.saved?.getTime() ?? Number.MAX_SAFE_INTEGER;
            const known = seen.get(entry.name);
            if (known === undefined || saved < known) {
                seen.set(entry.name, saved);
            }
        });
    });
    return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([name]) => name);
}

/** The baseline of a task by selection: a name, the attribute baseline, or nothing. */
export function baselineOf(
    task: Task,
    selection: string | undefined
): { start: Date; finish: Date; cost?: number } | undefined {
    if (!selection) {
        return undefined;
    }
    if (selection === ATTRIBUTE_BASELINE) {
        return task.attrBaselineStart && task.attrBaselineEnd
            ? { start: task.attrBaselineStart, finish: task.attrBaselineEnd }
            : undefined;
    }
    const entry = task.baselines?.find(candidate => candidate.name === selection);
    return entry ? { start: entry.start, finish: entry.finish, cost: entry.cost } : undefined;
}

/** The task with Baseline start / end taken from the selected baseline. */
export function withBaseline(task: Task, selection: string | undefined): Task {
    if (selection === ATTRIBUTE_BASELINE) {
        if (task.baselineStart === task.attrBaselineStart && task.baselineEnd === task.attrBaselineEnd) {
            return task;
        }
        return { ...task, baselineStart: task.attrBaselineStart, baselineEnd: task.attrBaselineEnd };
    }
    const base = baselineOf(task, selection);
    if (!base && !task.baselineStart && !task.baselineEnd) {
        return task;
    }
    return { ...task, baselineStart: base?.start, baselineEnd: base?.finish };
}

/**
 * The task's baselines with `name` set to the task's current dates (and cost): replaced when it
 * exists, added at the end otherwise. Undefined when the plan already has ten others.
 */
export function saveBaseline(
    entries: BaselineEntry[],
    name: string,
    span: { start: Date; finish: Date; cost?: number },
    saved: Date
): BaselineEntry[] | undefined {
    const index = entries.findIndex(entry => entry.name === name);
    const entry: BaselineEntry = { name, start: span.start, finish: span.finish, saved };
    if (span.cost !== undefined) {
        entry.cost = span.cost;
    }
    if (index >= 0) {
        return entries.map((existing, i) => (i === index ? entry : existing));
    }
    if (entries.length >= MAX_BASELINES) {
        return undefined;
    }
    return [...entries, entry];
}

export function deleteBaseline(entries: BaselineEntry[], name: string): BaselineEntry[] {
    return entries.filter(entry => entry.name !== name);
}

export interface BaselineDiff {
    id: string;
    name: string;
    a?: { start: Date; finish: Date; cost?: number };
    b?: { start: Date; finish: Date; cost?: number };
    /** B minus A in (working) days; positive when B is later. */
    startDays?: number;
    finishDays?: number;
    costDelta?: number;
}

export interface BaselineComparison {
    rows: BaselineDiff[];
    finishA?: Date;
    finishB?: Date;
    /** B's last finish minus A's in (working) days. */
    finishDays?: number;
    changed: number;
    onlyA: number;
    onlyB: number;
}

/** Compares two baselines task by task. */
export function compareBaselines(
    tasks: Task[],
    a: string,
    b: string,
    calendar: WorkCalendar = ALL_DAYS
): BaselineComparison {
    const days = (from: Date, to: Date): number => Math.round(workingDaysBetween(calendar, from, to) * 10) / 10;
    const rows: BaselineDiff[] = [];
    let finishA: Date | undefined;
    let finishB: Date | undefined;
    let changed = 0;
    let onlyA = 0;
    let onlyB = 0;
    tasks.forEach(task => {
        const left = baselineOf(task, a);
        const right = baselineOf(task, b);
        if (!left && !right) {
            return;
        }
        const row: BaselineDiff = { id: task.id, name: task.name, a: left, b: right };
        if (left && (!finishA || left.finish > finishA)) {
            finishA = left.finish;
        }
        if (right && (!finishB || right.finish > finishB)) {
            finishB = right.finish;
        }
        if (left && right) {
            row.startDays = days(left.start, right.start);
            row.finishDays = days(left.finish, right.finish);
            if (left.cost !== undefined && right.cost !== undefined) {
                row.costDelta = Math.round((right.cost - left.cost) * 100) / 100;
            }
            if (row.startDays !== 0 || row.finishDays !== 0 || (row.costDelta ?? 0) !== 0) {
                changed++;
            }
        } else if (left) {
            onlyA++;
        } else {
            onlyB++;
        }
        rows.push(row);
    });
    return {
        rows,
        finishA,
        finishB,
        finishDays: finishA && finishB ? days(finishA, finishB) : undefined,
        changed,
        onlyA,
        onlyB
    };
}
