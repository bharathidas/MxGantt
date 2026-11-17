/**
 * Per-user view settings (collapsed groups, hidden columns, column widths) kept in localStorage.
 * Storage can be missing, full or blocked (private windows, strict policies), so every access is
 * wrapped and failure simply means the chart opens with its defaults.
 */

export interface ViewState {
    collapsed?: string[];
    hidden?: string[];
    widths?: Record<string, number>;
    /** 2.3: the view was saved by 2.3 or later, so columns new in 2.3 have been seen. */
    v23?: boolean;
    /** 2.3: the baseline shown and the one compared with. */
    baseline?: string;
    compare?: string;
    /** 1.1: the column order the user chose, by column key. */
    order?: string[];
    /** 1.2: the sort the user chose, and the configured columns known when the view was saved. */
    sort?: { key: string; dir: "asc" | "desc" };
    known?: string[];
}

export function storageKey(widget: string, user: string | undefined): string {
    return `mxgantt:${user || "anonymous"}:${widget || "gantt"}`;
}

export function loadView(key: string): ViewState {
    try {
        const text = window.localStorage.getItem(key);
        if (!text) {
            return {};
        }
        const value = JSON.parse(text) as unknown;
        if (!value || typeof value !== "object") {
            return {};
        }
        const state = value as ViewState;
        const strings = (list: unknown): string[] | undefined =>
            Array.isArray(list) ? list.filter((entry): entry is string => typeof entry === "string") : undefined;
        const widths: Record<string, number> = {};
        if (state.widths && typeof state.widths === "object") {
            Object.entries(state.widths).forEach(([name, width]) => {
                if (typeof width === "number" && Number.isFinite(width)) {
                    widths[name] = width;
                }
            });
        }
        return {
            collapsed: strings(state.collapsed),
            hidden: strings(state.hidden),
            widths,
            ...(state.v23 === true ? { v23: true } : {}),
            ...(typeof state.baseline === "string" ? { baseline: state.baseline } : {}),
            ...(typeof state.compare === "string" ? { compare: state.compare } : {}),
            ...(strings(state.order)?.length ? { order: strings(state.order) } : {}),
            // 1.2
            ...(state.sort &&
            typeof state.sort === "object" &&
            typeof state.sort.key === "string" &&
            (state.sort.dir === "asc" || state.sort.dir === "desc")
                ? { sort: { key: state.sort.key, dir: state.sort.dir } }
                : {}),
            ...(strings(state.known) ? { known: strings(state.known) } : {})
        };
    } catch {
        return {};
    }
}

export function saveView(key: string, state: ViewState): void {
    try {
        window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
        // Storage is full or blocked; the view simply is not remembered.
    }
}
