/**
 * 1.3 portfolio timeline helpers: status colours, the bar label and its date pattern.
 */

import { isMilestone, Task } from "./tasks";

export interface BarState {
    /** Lower-cased value it matches. */
    value: string;
    color: string;
    /** Legend text; empty leaves the state out of the legend. */
    caption: string;
}

export type BarLabelMode = "name" | "finishProgress" | "custom" | "none";

/** The 1.3 display options, passed down as one object. */
export interface TimelineLook {
    /** Slim bars, capital group headings without summary bars, quieter labels. */
    portfolio: boolean;
    /** Rows have a second line (code + name above, subtitle below). */
    twoLine: boolean;
    barLabel: BarLabelMode;
    /** Date pattern for the finish-and-progress label. */
    dateFormat: string;
    baselineOutline: boolean;
    deadlineDiamond: boolean;
    todayLabel: boolean;
    barLegend: boolean;
    states: BarState[];
}

export const STANDARD_LOOK: TimelineLook = {
    portfolio: false,
    twoLine: false,
    barLabel: "name",
    dateFormat: "",
    baselineOutline: false,
    deadlineDiamond: false,
    todayLabel: false,
    barLegend: false,
    states: []
};

/**
 * The index of the state a Status value matches, or undefined. An enumeration matches on its key
 * or its caption, a boolean on "true" / "false", a string on its text; never case-sensitive.
 */
export function matchState(
    states: readonly BarState[],
    value: string | boolean | undefined,
    caption?: string
): number | undefined {
    if (value === undefined || value === null || states.length === 0) {
        return undefined;
    }
    const keys = [String(value).trim().toLowerCase(), (caption ?? "").trim().toLowerCase()].filter(Boolean);
    const index = states.findIndex(state => keys.includes(state.value));
    return index < 0 ? undefined : index;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/**
 * Formats a date with a small pattern: yyyy, yy, MMMM, MMM, MM, M, dd, d. Anything else is copied
 * as it is, so MM.yyyy gives 05.2027 and MMM yyyy gives May 2027. Empty uses `fallback`.
 */
export function formatPattern(date: Date, pattern: string, fallback: (date: Date) => string, locale?: string): string {
    if (!pattern.trim()) {
        return fallback(date);
    }
    const month = (style: "short" | "long"): string => {
        try {
            return new Intl.DateTimeFormat(locale, { month: style }).format(date);
        } catch {
            return new Intl.DateTimeFormat(undefined, { month: style }).format(date);
        }
    };
    const tokens: Array<[string, () => string]> = [
        ["yyyy", () => String(date.getFullYear())],
        ["yy", () => pad(date.getFullYear() % 100)],
        ["MMMM", () => month("long")],
        ["MMM", () => month("short")],
        ["MM", () => pad(date.getMonth() + 1)],
        ["M", () => String(date.getMonth() + 1)],
        ["dd", () => pad(date.getDate())],
        ["d", () => String(date.getDate())]
    ];
    const tokenAt = (at: number): [string, () => string] | undefined =>
        tokens.find(([token]) => pattern.startsWith(token, at));
    let out = "";
    let i = 0;
    while (i < pattern.length) {
        const hit = tokenAt(i);
        if (hit) {
            out += hit[1]();
            i += hit[0].length;
        } else {
            out += pattern[i];
            i++;
        }
    }
    return out;
}

/** The finish-and-progress label: "05.2027 · 45 %", or just one of the two when the other is missing. */
export function finishProgressLabel(
    end: Date | undefined,
    progress: number | undefined,
    date: (d: Date) => string
): string {
    return [end ? date(end) : "", progress === undefined ? "" : `${progress} %`].filter(Boolean).join(" · ");
}

/** The text after each bar for the configured Bar label; undefined keeps the name and progress. */
export function labelText(
    look: TimelineLook,
    fallbackDate: (date: Date) => string,
    locale?: string
): ((task: Task) => string) | undefined {
    switch (look.barLabel) {
        case "finishProgress":
            return task =>
                finishProgressLabel(task.end, isMilestone(task) ? undefined : task.progress, date =>
                    formatPattern(date, look.dateFormat, fallbackDate, locale)
                );
        case "custom":
            return task => task.barText ?? "";
        case "none":
            return () => "";
        default:
            return undefined;
    }
}
