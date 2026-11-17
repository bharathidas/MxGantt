import type { CellRaw } from "./layout";

/**
 * Undo and redo. Every edit the user makes is recorded as one batch of field changes (a drag that
 * pushes five successors is one batch), and undoing writes the "before" values back.
 */

export interface TaskValues {
    start?: Date;
    end?: Date;
    progress?: number;
    name?: string;
    /** The Depends on text. */
    deps?: string;
    /** 2.3: the Assignments text, the split segments and the named baselines (JSON). */
    assignments?: string;
    segments?: string;
    baselines?: string;
    /** 1.1: the custom field values of the task (JSON). */
    fields?: string;
    /** 1.2: the value of a configured attribute column, under cell: plus the column key. */
    [cell: `cell:${string}`]: CellRaw | undefined;
}

export interface Change {
    id: string;
    before: TaskValues;
    after: TaskValues;
}

export interface Batch {
    /** What the batch did, for announcements, such as the task name. */
    label: string;
    changes: Change[];
}

export interface HistoryState {
    past: Batch[];
    future: Batch[];
}

export const EMPTY_HISTORY: HistoryState = { past: [], future: [] };

export const HISTORY_LIMIT = 100;

function sameValue(a: unknown, b: unknown): boolean {
    if (a instanceof Date && b instanceof Date) {
        return a.getTime() === b.getTime();
    }
    return a === b;
}

/** Whether a change changes anything. */
export function isEffective(change: Change): boolean {
    return (Object.keys(change.after) as Array<keyof TaskValues>).some(
        key => !sameValue(change.before[key], change.after[key])
    );
}

/** Records a new batch; a new edit throws away what could be redone. */
export function record(state: HistoryState, batch: Batch, limit = HISTORY_LIMIT): HistoryState {
    const changes = batch.changes.filter(isEffective);
    if (changes.length === 0) {
        return state;
    }
    const past = [...state.past, { ...batch, changes }];
    return { past: past.length > limit ? past.slice(past.length - limit) : past, future: [] };
}

/** The batch with before and after swapped, which is what undoing it writes. */
export function invert(batch: Batch): Batch {
    return {
        label: batch.label,
        changes: batch.changes.map(change => ({ id: change.id, before: change.after, after: change.before }))
    };
}

/** The changes to write to undo the last batch, and the history after it. */
export function undo(state: HistoryState): { state: HistoryState; apply?: Batch } {
    const last = state.past[state.past.length - 1];
    if (!last) {
        return { state };
    }
    return {
        state: { past: state.past.slice(0, -1), future: [last, ...state.future] },
        apply: invert(last)
    };
}

/** The changes to write to redo the last undone batch, and the history after it. */
export function redo(state: HistoryState): { state: HistoryState; apply?: Batch } {
    const next = state.future[0];
    if (!next) {
        return { state };
    }
    return { state: { past: [...state.past, next], future: state.future.slice(1) }, apply: next };
}
