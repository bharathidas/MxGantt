/**
 * Configured task list columns (1.2): the developer lists the columns after Task name in Studio Pro
 * (built-in ones such as Start or Done, and attribute columns), and the chart shows them in that
 * order. Task name always comes first; a WBS number column sits right before it.
 *
 * Everything in here is plain data and functions, so it is tested without React or Mendix.
 */

/** A cell value as the widget keeps it: numbers as numbers (Big becomes a number), empty as null. */
export type CellRaw = string | number | boolean | Date | null;

export interface CellValue {
    /** The text as Mendix formats it; undefined after a local edit, until the data source catches up. */
    text?: string;
    raw?: CellRaw;
    /** The Dynamic cell class worked out for this task. */
    cls?: string;
}

export type LayoutType =
    | "attribute"
    | "wbs"
    | "start"
    | "end"
    | "duration"
    | "progress"
    | "assignee"
    | "assignments"
    | "predecessors"
    | "baselineStart"
    | "baselineEnd"
    | "variance"
    | "cost";

export type CostMeasure = "cost" | "bac" | "pv" | "ev" | "ac" | "cv" | "sv" | "cpi" | "spi" | "eac" | "etc" | "vac";

export type CellFormat = "auto" | "number" | "currency" | "percent" | "date" | "dateTime";
export type TotalKind = "none" | "sum" | "average" | "min" | "max" | "count";
export type ValueType = "string" | "number" | "boolean" | "date" | "enum";
export type Align = "left" | "center" | "right";

export interface CellOption {
    value: string;
    label: string;
}

export interface LayoutColumn {
    /** The column key: the built-in key ("start", "ev"), or "a" plus the position for attribute columns. */
    key: string;
    type: LayoutType;
    /** Caption override; the built-in name is used when empty. */
    title?: string;
    tooltip?: string;
    /** Starting width; undefined uses the column's own width. */
    width?: number;
    minWidth: number;
    fill: boolean;
    /** Undefined: numbers on the right, the rest on the left. */
    align?: Align;
    wrap: boolean;
    visible: boolean;
    hideable: boolean;
    sortable: boolean;
    /** Attribute columns only, and only when the value can be written. */
    editable: boolean;
    /** Attribute columns: what kind of value the attribute holds. */
    valueType?: ValueType;
    /** Integer and Long: edits must be whole numbers. */
    integer?: boolean;
    format: CellFormat;
    decimals: number;
    total: TotalKind;
    /** Enumeration and Boolean values to choose from when editing. */
    options?: CellOption[];
    /** Formats a raw value for this column (used after edits and for totals). */
    formatRaw?: (raw: CellRaw | undefined) => string;
}

/** The TaskValues key under which the value of a configured attribute column travels. */
export function cellKey(columnKey: string): `cell:${string}` {
    return `cell:${columnKey}`;
}

export function isCellKey(key: string): key is `cell:${string}` {
    return key.startsWith("cell:");
}

export function columnOfCellKey(key: string): string {
    return key.slice(5);
}

export function layoutKey(type: LayoutType, index: number, measure?: CostMeasure): string {
    if (type === "attribute") {
        return `a${index}`;
    }
    return type === "cost" ? measure ?? "cost" : type;
}

/**
 * Keeps only the first column of each built-in kind (Studio Pro reports the duplicates), so keys
 * stay unique.
 */
export function uniqueLayout<T extends { key: string }>(columns: T[]): T[] {
    const seen = new Set<string>();
    return columns.filter(column => {
        if (seen.has(column.key)) {
            return false;
        }
        seen.add(column.key);
        return true;
    });
}

/** Task name first, with the WBS number (when shown) right before it; the rest keeps its order. */
export function pinLeading<T extends { key: string }>(columns: T[]): T[] {
    const wbs = columns.find(column => column.key === "wbs");
    const name = columns.find(column => column.key === "name");
    if (!name) {
        return columns;
    }
    const lead = wbs ? [wbs, name] : [name];
    const rest = columns.filter(column => column !== wbs && column !== name);
    const result = [...lead, ...rest];
    return result.every((column, index) => column === columns[index]) ? columns : result;
}

/** Turns what the data source hands over (Big, Date, boolean, string) into a CellRaw. */
export function toRaw(value: unknown): CellRaw {
    if (value === undefined || value === null || value === "") {
        return null;
    }
    if (value instanceof Date || typeof value === "boolean" || typeof value === "number") {
        return value;
    }
    if (typeof value === "string") {
        return value;
    }
    // Big and anything else with a numeric toString.
    const number = Number(String(value));
    return Number.isFinite(number) ? number : String(value);
}

export function sameRawValue(a: CellRaw | undefined, b: CellRaw | undefined): boolean {
    const empty = (value: CellRaw | undefined): boolean => value === undefined || value === null || value === "";
    if (empty(a) && empty(b)) {
        return true;
    }
    if (a instanceof Date && b instanceof Date) {
        return a.getTime() === b.getTime();
    }
    return a === b;
}

export interface FormatContext {
    locale?: string;
    /** ISO 4217 code for Currency; plain numbers without one. */
    currency?: string;
    yes: string;
    no: string;
}

function numberFormat(locale: string | undefined, options: Intl.NumberFormatOptions): Intl.NumberFormat {
    try {
        return new Intl.NumberFormat(locale, options);
    } catch {
        return new Intl.NumberFormat(undefined, { maximumFractionDigits: options.maximumFractionDigits });
    }
}

function dateFormat(locale: string | undefined, withTime: boolean): Intl.DateTimeFormat {
    const options: Intl.DateTimeFormatOptions = withTime
        ? { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
        : { day: "numeric", month: "short", year: "numeric" };
    try {
        return new Intl.DateTimeFormat(locale, options);
    } catch {
        return new Intl.DateTimeFormat(undefined, options);
    }
}

export function clampDecimals(decimals: number | null | undefined): number {
    return Math.max(0, Math.min(6, Math.round(decimals ?? 0)));
}

/**
 * A formatter for one column. The Mendix formatter, when given, is used for Automatic, so edited
 * values and totals look like the ones the data source sends.
 */
export function makeCellFormatter(
    format: CellFormat,
    decimals: number,
    context: FormatContext,
    options?: CellOption[],
    mendix?: (raw: Exclude<CellRaw, null>) => string | undefined
): (raw: CellRaw | undefined) => string {
    const digits = clampDecimals(decimals);
    const plain = numberFormat(context.locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    const auto = numberFormat(context.locale, { maximumFractionDigits: 6 });
    const code = context.currency?.trim().toUpperCase();
    const money =
        code && code.length === 3
            ? numberFormat(context.locale, {
                  style: "currency",
                  currency: code,
                  minimumFractionDigits: digits,
                  maximumFractionDigits: digits
              })
            : plain;
    const day = dateFormat(context.locale, false);
    const moment = dateFormat(context.locale, true);
    const labels = new Map((options ?? []).map(option => [option.value, option.label]));
    return raw => {
        if (raw === undefined || raw === null || raw === "") {
            return "";
        }
        if (typeof raw === "number") {
            switch (format) {
                case "number":
                    return plain.format(raw);
                case "currency":
                    return money.format(raw);
                case "percent":
                    return `${plain.format(raw)}%`;
                default:
                    break;
            }
        }
        if (raw instanceof Date) {
            if (format === "date") {
                return day.format(raw);
            }
            if (format === "dateTime") {
                return moment.format(raw);
            }
        }
        if (mendix) {
            try {
                const text = mendix(raw);
                if (text !== undefined) {
                    return text;
                }
            } catch {
                // Fall through to the plain formats below.
            }
        }
        if (typeof raw === "boolean") {
            return raw ? context.yes : context.no;
        }
        if (typeof raw === "number") {
            return auto.format(raw);
        }
        if (raw instanceof Date) {
            return moment.format(raw);
        }
        return labels.get(raw) ?? raw;
    };
}

/** Numbers on the right, everything else on the left. */
export function defaultAlign(valueType: ValueType | undefined): Align {
    return valueType === "number" ? "right" : "left";
}

// ---------------------------------------------------------------- sorting

export type SortDir = "asc" | "desc";

export interface SortState {
    key: string;
    dir: SortDir;
}

/** asc, then desc, then off. */
export function nextSort(current: SortState | undefined, key: string): SortState | undefined {
    if (!current || current.key !== key) {
        return { key, dir: "asc" };
    }
    return current.dir === "asc" ? { key, dir: "desc" } : undefined;
}

const collator = (() => {
    try {
        return new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    } catch {
        return undefined;
    }
})();

/** Compares two values of one column; empty values are handled by the caller. */
export function compareRaw(a: Exclude<CellRaw, null>, b: Exclude<CellRaw, null>): number {
    if (a instanceof Date && b instanceof Date) {
        return a.getTime() - b.getTime();
    }
    if (typeof a === "number" && typeof b === "number") {
        return a - b;
    }
    if (typeof a === "boolean" && typeof b === "boolean") {
        return a === b ? 0 : a ? 1 : -1;
    }
    const x = String(a);
    const y = String(b);
    return collator ? collator.compare(x, y) : x < y ? -1 : x > y ? 1 : 0;
}

/**
 * The items sorted by a value; empty values stay at the end in both directions, and equal values
 * keep their order (the data source order), so sorting twice does not shuffle anything.
 */
export function sortByValue<T>(items: T[], valueOf: (item: T) => CellRaw | undefined, dir: SortDir): T[] {
    const keyed = items.map((item, index) => ({ item, index, value: valueOf(item) }));
    const empty = (value: CellRaw | undefined): boolean => value === undefined || value === null || value === "";
    keyed.sort((x, y) => {
        const ex = empty(x.value);
        const ey = empty(y.value);
        if (ex || ey) {
            return ex === ey ? x.index - y.index : ex ? 1 : -1;
        }
        const order = compareRaw(x.value as Exclude<CellRaw, null>, y.value as Exclude<CellRaw, null>);
        return order === 0 ? x.index - y.index : dir === "asc" ? order : -order;
    });
    return keyed.map(entry => entry.item);
}

// ---------------------------------------------------------------- group totals

/** The total of the values of a group's tasks; undefined when there is nothing to total. */
export function aggregate(values: Array<CellRaw | undefined>, total: TotalKind): number | undefined {
    if (total === "none") {
        return undefined;
    }
    const present = values.filter(value => value !== undefined && value !== null && value !== "");
    if (total === "count") {
        return present.length;
    }
    const numbers = present.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    if (numbers.length === 0) {
        return undefined;
    }
    switch (total) {
        case "sum":
            return numbers.reduce((sum, value) => sum + value, 0);
        case "average":
            return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
        case "min":
            return Math.min(...numbers);
        case "max":
            return Math.max(...numbers);
        default:
            return undefined;
    }
}

// ---------------------------------------------------------------- editing

function pad(value: number): string {
    return String(value).padStart(2, "0");
}

/** The value an editor starts with: what an input of that kind expects. */
export function encodeCell(raw: CellRaw | undefined, valueType: ValueType | undefined, withTime: boolean): string {
    if (raw === undefined || raw === null) {
        return "";
    }
    if (raw instanceof Date) {
        const day = `${raw.getFullYear()}-${pad(raw.getMonth() + 1)}-${pad(raw.getDate())}`;
        return withTime && valueType === "date" ? `${day}T${pad(raw.getHours())}:${pad(raw.getMinutes())}` : day;
    }
    return String(raw);
}

export type ParsedCell = { ok: true; value: CellRaw } | { ok: false; error: "number" | "whole" | "date" | "choice" };

/** Reads what the user typed or picked; dates keep the time of day of the old value when only a day is given. */
export function parseCell(
    text: string,
    column: Pick<LayoutColumn, "valueType" | "integer" | "options">,
    previous?: CellRaw
): ParsedCell {
    const value = text.trim();
    switch (column.valueType) {
        case "number": {
            if (!value) {
                return { ok: true, value: null };
            }
            const number = Number(value.replace(/\s/g, "").replace(",", "."));
            if (!Number.isFinite(number)) {
                return { ok: false, error: "number" };
            }
            if (column.integer && !Number.isInteger(number)) {
                return { ok: false, error: "whole" };
            }
            return { ok: true, value: number };
        }
        case "date": {
            if (!value) {
                return { ok: true, value: null };
            }
            const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value);
            if (!match) {
                return { ok: false, error: "date" };
            }
            const [, y, m, d, hh, mm] = match;
            const keep = previous instanceof Date ? previous : undefined;
            const date = new Date(
                Number(y),
                Number(m) - 1,
                Number(d),
                hh !== undefined ? Number(hh) : keep?.getHours() ?? 0,
                mm !== undefined ? Number(mm) : keep?.getMinutes() ?? 0
            );
            return Number.isNaN(date.getTime()) || date.getDate() !== Number(d)
                ? { ok: false, error: "date" }
                : { ok: true, value: date };
        }
        case "boolean":
            if (value === "true" || value === "false") {
                return { ok: true, value: value === "true" };
            }
            return { ok: false, error: "choice" };
        case "enum":
            if (!value) {
                return { ok: true, value: null };
            }
            return column.options && !column.options.some(option => option.value === value)
                ? { ok: false, error: "choice" }
                : { ok: true, value };
        default:
            return { ok: true, value: text };
    }
}
