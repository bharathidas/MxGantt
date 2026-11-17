/**
 * Custom fields: task-list columns that end users add in the running app (1.1).
 *
 * Two String attributes hold everything, so no domain model change is needed per field:
 *   - the field definitions, a JSON array on the object around the widget (usually the project);
 *   - each task's values, a JSON object { fieldKey: value } on the task.
 * A field's key never changes after it is created (renaming only changes its name), so values
 * survive renames, and a deleted field's values come back when a field with the same key is added.
 *
 * Everything here is plain data in, plain data out, so it is unit tested without React or Mendix.
 */

export type FieldType =
    | "text"
    | "number"
    | "date"
    | "select"
    | "multi"
    | "checkbox"
    | "person"
    | "url"
    | "rating"
    | "formula";

export type NumberFormat = "plain" | "currency" | "percent";
export type FieldAlign = "left" | "center" | "right";

export interface FieldOption {
    id: string;
    label: string;
    /** A CSS colour; one of OPTION_COLORS by default. */
    color: string;
}

export interface FieldDef {
    /** Stable identifier used in the task values; letters, digits and underscores. */
    key: string;
    /** The column header users see. */
    name: string;
    type: FieldType;
    /** Select and multi-select choices, in order. */
    options?: FieldOption[];
    /** Starting width in pixels. */
    width?: number;
    align?: FieldAlign;
    /** Number and formula: plain, currency or percent. */
    format?: NumberFormat;
    /** Number and formula: digits after the decimal point (0-6). */
    decimals?: number;
    /** ISO 4217 code for currency numbers, such as EUR. */
    currency?: string;
    /** Rating: the highest score (3-10). */
    max?: number;
    /** Formula: stored with references as [key], see toStoredFormula. */
    formula?: string;
    /** Show the value next to the bar on the timeline. */
    onBar?: boolean;
    /** Show the value in the bar tooltip (on unless false). */
    inTooltip?: boolean;
    /** Optional help text shown in the column header tooltip. */
    description?: string;
}

/** A stored value: text, number, ISO date text, option id(s) or a checkbox state. */
export type FieldValue = string | number | boolean | string[];
export type FieldValues = Record<string, FieldValue>;

export const MAX_FIELDS = 100;
export const MAX_OPTIONS = 50;
export const MAX_NAME = 60;
export const MAX_TEXT = 2000;

/** Built-in values a formula can use, next to the other fields. */
export const BUILTIN_REFS: Record<string, string> = { _duration: "Duration", _progress: "Done", _cost: "Cost" };

/** Strong hues that keep 3:1 against both the light and the dark surface; chips tint them. */
export const OPTION_COLORS = [
    "#3565d6",
    "#0e9384",
    "#15803d",
    "#ca8504",
    "#e04f16",
    "#d92d20",
    "#dd2590",
    "#7a5af8",
    "#0891b2",
    "#667085"
];

export interface FieldTypeInfo {
    type: FieldType;
    /** Icon name in FieldIcon. */
    icon: string;
    align: FieldAlign;
    width: number;
    /** Values are typed in a text box (others use a picker). */
    typed: boolean;
}

export const FIELD_TYPES: FieldTypeInfo[] = [
    { type: "text", icon: "text", align: "left", width: 140, typed: true },
    { type: "number", icon: "number", align: "right", width: 100, typed: true },
    { type: "date", icon: "date", align: "left", width: 104, typed: true },
    { type: "select", icon: "select", align: "left", width: 110, typed: false },
    { type: "multi", icon: "multi", align: "left", width: 150, typed: false },
    { type: "checkbox", icon: "checkbox", align: "center", width: 84, typed: false },
    { type: "person", icon: "person", align: "left", width: 130, typed: true },
    { type: "url", icon: "url", align: "left", width: 140, typed: true },
    { type: "rating", icon: "rating", align: "left", width: 104, typed: false },
    { type: "formula", icon: "formula", align: "right", width: 100, typed: false }
];

export function typeInfo(type: FieldType): FieldTypeInfo {
    return FIELD_TYPES.find(info => info.type === type) ?? FIELD_TYPES[0];
}

export function isFieldType(value: unknown): value is FieldType {
    return typeof value === "string" && FIELD_TYPES.some(info => info.type === value);
}

export function hasOptions(type: FieldType): boolean {
    return type === "select" || type === "multi";
}

export function isNumeric(type: FieldType): boolean {
    return type === "number" || type === "rating" || type === "formula";
}

// ---------------------------------------------------------------- keys

/** A key made from the name: lower case letters, digits and underscores, unique among `taken`. */
export function newFieldKey(name: string, taken: Iterable<string>): string {
    const used = new Set(taken);
    let slug = name
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 32);
    if (!slug || /^[0-9]/.test(slug)) {
        slug = `f_${slug}`.replace(/_+$/, "") || "field";
    }
    if (slug in BUILTIN_REFS) {
        slug = `f${slug}`;
    }
    let key = slug;
    for (let n = 2; used.has(key); n++) {
        key = `${slug}_${n}`;
    }
    return key;
}

function validKey(key: unknown): key is string {
    return typeof key === "string" && /^[A-Za-z0-9_]{1,40}$/.test(key);
}

let optionCounter = 0;
/** A short option id, unique enough within one field. */
export function newOptionId(taken: Iterable<string> = []): string {
    const used = new Set(taken);
    let id = "";
    do {
        optionCounter = (optionCounter + 1) % 1679616;
        id = `o${Date.now().toString(36).slice(-4)}${optionCounter.toString(36)}`;
    } while (used.has(id));
    return id;
}

// ---------------------------------------------------------------- definitions JSON

function cleanText(value: unknown, max: number): string {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanOptions(value: unknown): FieldOption[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const seen = new Set<string>();
    const options: FieldOption[] = [];
    value.slice(0, MAX_OPTIONS).forEach((entry, index) => {
        // A plain string list is accepted too: ["Low", "Medium", "High"].
        const raw = typeof entry === "string" ? { label: entry } : (entry as Partial<FieldOption> | null);
        if (!raw || typeof raw !== "object") {
            return;
        }
        const label = cleanText(raw.label, MAX_NAME);
        if (!label) {
            return;
        }
        let id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim().slice(0, 40) : label;
        while (seen.has(id)) {
            id = `${id}_`;
        }
        seen.add(id);
        const color = typeof raw.color === "string" && raw.color.trim() ? raw.color.trim() : OPTION_COLORS[index % 10];
        options.push({ id, label, color });
    });
    return options;
}

/** One definition from untrusted JSON, or undefined when it is unusable. */
export function cleanField(raw: unknown): FieldDef | undefined {
    if (!raw || typeof raw !== "object") {
        return undefined;
    }
    const entry = raw as Record<string, unknown>;
    const name = cleanText(entry.name ?? entry.caption ?? entry.title, MAX_NAME);
    const type: FieldType = isFieldType(entry.type) ? entry.type : "text";
    const key = validKey(entry.key) ? entry.key : name ? newFieldKey(name, []) : "";
    if (!key || !name) {
        return undefined;
    }
    const field: FieldDef = { key, name, type };
    if (hasOptions(type)) {
        field.options = cleanOptions(entry.options);
    }
    const width = Number(entry.width);
    if (Number.isFinite(width) && width > 0) {
        field.width = Math.round(Math.max(40, Math.min(800, width)));
    }
    if (entry.align === "left" || entry.align === "center" || entry.align === "right") {
        field.align = entry.align;
    }
    if (type === "number" || type === "formula") {
        if (entry.format === "currency" || entry.format === "percent" || entry.format === "plain") {
            field.format = entry.format;
        }
        const decimals = Number(entry.decimals);
        if (Number.isFinite(decimals)) {
            field.decimals = Math.max(0, Math.min(6, Math.round(decimals)));
        }
        const currency = cleanText(entry.currency, 3).toUpperCase();
        if (/^[A-Z]{3}$/.test(currency)) {
            field.currency = currency;
        }
    }
    if (type === "rating") {
        const max = Number(entry.max);
        field.max = Number.isFinite(max) ? Math.max(3, Math.min(10, Math.round(max))) : 5;
    }
    if (type === "formula") {
        field.formula = typeof entry.formula === "string" ? entry.formula.slice(0, 500) : "";
    }
    if (entry.onBar === true) {
        field.onBar = true;
    }
    if (entry.inTooltip === false) {
        field.inTooltip = false;
    }
    const description = cleanText(entry.description, 200);
    if (description) {
        field.description = description;
    }
    return field;
}

/**
 * The definitions from the Fields attribute: a JSON array, or an object with a `fields` array.
 * Broken JSON, unknown types and duplicate keys never throw; what cannot be used is left out.
 */
export function parseFields(text: string | undefined | null): FieldDef[] {
    if (!text || !text.trim()) {
        return [];
    }
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        return [];
    }
    const list = Array.isArray(data)
        ? data
        : data && typeof data === "object" && Array.isArray((data as { fields?: unknown }).fields)
        ? (data as { fields: unknown[] }).fields
        : [];
    const keys = new Set<string>();
    const fields: FieldDef[] = [];
    list.slice(0, MAX_FIELDS).forEach(raw => {
        const field = cleanField(raw);
        if (field && !keys.has(field.key)) {
            keys.add(field.key);
            fields.push(field);
        }
    });
    return fields;
}

/** The JSON written to the Fields attribute; only properties that are set. */
export function serializeFields(fields: FieldDef[]): string {
    return JSON.stringify(
        fields.map(field => {
            const out: Record<string, unknown> = { key: field.key, name: field.name, type: field.type };
            (
                [
                    "options",
                    "width",
                    "align",
                    "format",
                    "decimals",
                    "currency",
                    "max",
                    "formula",
                    "onBar",
                    "inTooltip",
                    "description"
                ] as Array<keyof FieldDef>
            ).forEach(name => {
                if (field[name] !== undefined) {
                    out[name] = field[name];
                }
            });
            return out;
        })
    );
}

// ---------------------------------------------------------------- task values JSON

export function parseValues(text: string | undefined | null): FieldValues {
    if (!text || !text.trim()) {
        return {};
    }
    try {
        const data = JSON.parse(text) as unknown;
        if (!data || typeof data !== "object" || Array.isArray(data)) {
            return {};
        }
        const values: FieldValues = {};
        Object.entries(data as Record<string, unknown>).forEach(([key, value]) => {
            if (!validKey(key)) {
                return;
            }
            if (typeof value === "string" || typeof value === "boolean") {
                values[key] = value;
            } else if (typeof value === "number" && Number.isFinite(value)) {
                values[key] = value;
            } else if (Array.isArray(value)) {
                values[key] = value.filter((entry): entry is string => typeof entry === "string");
            }
        });
        return values;
    } catch {
        return {};
    }
}

export function isEmptyValue(value: FieldValue | undefined | null): boolean {
    return (
        value === undefined ||
        value === null ||
        value === "" ||
        (Array.isArray(value) && value.length === 0) ||
        (typeof value === "number" && !Number.isFinite(value))
    );
}

/** The JSON written to a task's Values attribute: empty values are left out, "" when nothing is left. */
export function serializeValues(values: FieldValues): string {
    const out: FieldValues = {};
    Object.keys(values).forEach(key => {
        if (!isEmptyValue(values[key])) {
            out[key] = values[key];
        }
    });
    return Object.keys(out).length === 0 ? "" : JSON.stringify(out);
}

/** The values text with one field changed (undefined clears it); other fields, even unknown ones, stay. */
export function withFieldValue(text: string | undefined, key: string, value: FieldValue | undefined): string {
    const values = parseValues(text);
    if (value === undefined || isEmptyValue(value)) {
        delete values[key];
    } else {
        values[key] = value;
    }
    return serializeValues(values);
}

// ---------------------------------------------------------------- reading values for a field

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;

export function isoDay(date: Date): string {
    const pad = (n: number): string => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A stored date text as a local date at midnight. */
export function parseDay(text: string): Date | undefined {
    const match = ISO_DAY.exec(text.trim());
    if (!match) {
        return undefined;
    }
    const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : undefined;
}

/** Reads a number typed by a person: "1.250,50", "1,250.50", "€ 12k", "25%". */
export function parseNumberText(text: string): number | undefined {
    let value = text.trim().replace(/[\s\u00a0\u202f']/g, "");
    if (!value) {
        return undefined;
    }
    let factor = 1;
    const suffix = /([kmb])$/i.exec(value);
    if (suffix) {
        factor = { k: 1e3, m: 1e6, b: 1e9 }[suffix[1].toLowerCase() as "k" | "m" | "b"];
        value = value.slice(0, -1);
    }
    value = value.replace(/^[^\d+\-.,]+|[^\d.,]+$/g, "");
    const comma = value.lastIndexOf(",");
    const dot = value.lastIndexOf(".");
    if (comma >= 0 && dot >= 0) {
        // The later separator is the decimal one.
        value = comma > dot ? value.replace(/\./g, "").replace(",", ".") : value.replace(/,/g, "");
    } else if (comma >= 0) {
        const decimals = value.length - comma - 1;
        // One comma with exactly three digits after it reads as thousands (1,250), otherwise decimals.
        value =
            (value.match(/,/g) ?? []).length > 1 || decimals === 3 ? value.replace(/,/g, "") : value.replace(",", ".");
    } else if ((value.match(/\./g) ?? []).length > 1) {
        value = value.replace(/\./g, "");
    }
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(value)) {
        return undefined;
    }
    const number = Number(value) * factor;
    return Number.isFinite(number) ? number : undefined;
}

/** The option of a select value, matched by id first and label second (labels typed by apps). */
export function optionOf(field: FieldDef, value: unknown): FieldOption | undefined {
    if (typeof value !== "string" || !value) {
        return undefined;
    }
    const options = field.options ?? [];
    return (
        options.find(option => option.id === value) ??
        options.find(option => option.label.toLowerCase() === value.trim().toLowerCase())
    );
}

/** The stored value read for the field's current type, tolerant of values stored under another type. */
export function readValue(field: FieldDef, raw: FieldValue | undefined): FieldValue | undefined {
    if (raw === undefined || isEmptyValue(raw)) {
        return undefined;
    }
    switch (field.type) {
        case "number":
        case "rating": {
            const number = typeof raw === "number" ? raw : typeof raw === "string" ? parseNumberText(raw) : undefined;
            if (number === undefined) {
                return undefined;
            }
            return field.type === "rating" ? Math.max(0, Math.min(field.max ?? 5, Math.round(number))) : number;
        }
        case "checkbox":
            return raw === true || raw === "true";
        case "date":
            return typeof raw === "string" && parseDay(raw) ? raw.slice(0, 10) : undefined;
        case "select": {
            const option = optionOf(field, Array.isArray(raw) ? raw[0] : raw);
            return option ? option.id : undefined;
        }
        case "multi": {
            const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
            const ids = list.map(entry => optionOf(field, entry)?.id).filter((id): id is string => !!id);
            return ids.length > 0 ? [...new Set(ids)] : undefined;
        }
        case "formula":
            return undefined;
        default:
            return Array.isArray(raw) ? raw.join(", ") : String(raw);
    }
}

// ---------------------------------------------------------------- display

export interface FormatOptions {
    locale?: string;
    /** Texts for the checkbox states. */
    yes?: string;
    no?: string;
}

const numberFormats = new Map<string, Intl.NumberFormat>();
function numberFormat(locale: string | undefined, options: Intl.NumberFormatOptions): Intl.NumberFormat {
    const id = `${locale ?? ""}|${JSON.stringify(options)}`;
    let format = numberFormats.get(id);
    if (!format) {
        try {
            format = new Intl.NumberFormat(locale, options);
        } catch {
            // An unknown currency code or locale falls back to a plain number.
            const { minimumFractionDigits, maximumFractionDigits } = options;
            format = new Intl.NumberFormat(undefined, { minimumFractionDigits, maximumFractionDigits });
        }
        numberFormats.set(id, format);
    }
    return format;
}

export function formatNumberValue(field: FieldDef, value: number, locale?: string): string {
    const format = field.format ?? "plain";
    const decimals = field.decimals ?? (format === "currency" ? 2 : 0);
    const digits = { minimumFractionDigits: decimals, maximumFractionDigits: decimals };
    if (format === "currency" && field.currency) {
        return numberFormat(locale, { style: "currency", currency: field.currency, ...digits }).format(value);
    }
    const text = numberFormat(locale, digits).format(value);
    return format === "percent" ? `${text}%` : text;
}

/** Plain text of a value, as the list, tooltip, search, CSV and print show it. */
export function formatValue(field: FieldDef, value: FieldValue | undefined, options: FormatOptions = {}): string {
    const read = readValue(field, value);
    if (read === undefined) {
        return field.type === "checkbox" && value !== undefined ? options.no ?? "" : "";
    }
    switch (field.type) {
        case "number":
            return formatNumberValue(field, read as number, options.locale);
        case "rating":
            return `${"★".repeat(read as number)}${"☆".repeat(Math.max(0, (field.max ?? 5) - (read as number)))}`;
        case "checkbox":
            return read ? options.yes ?? "✓" : options.no ?? "";
        case "date": {
            const date = parseDay(read as string);
            if (!date) {
                return "";
            }
            try {
                return new Intl.DateTimeFormat(options.locale, {
                    day: "numeric",
                    month: "short",
                    year: "numeric"
                }).format(date);
            } catch {
                return read as string;
            }
        }
        case "select":
            return optionOf(field, read)?.label ?? "";
        case "multi":
            return (read as string[])
                .map(id => optionOf(field, id)?.label ?? "")
                .filter(Boolean)
                .join(", ");
        default:
            return String(read);
    }
}

/** A value for spreadsheets: numbers stay numbers, dates become Date objects, the rest text. */
export function exportValue(
    field: FieldDef,
    value: FieldValue | undefined,
    options: FormatOptions = {}
): string | number | Date | undefined {
    const read = readValue(field, value);
    if (read === undefined) {
        return undefined;
    }
    if (field.type === "number" || field.type === "rating") {
        return read as number;
    }
    if (field.type === "date") {
        return parseDay(read as string);
    }
    if (field.type === "checkbox") {
        return read ? options.yes ?? "Yes" : options.no ?? "No";
    }
    return formatValue(field, read, options);
}

/** Only http(s) and mailto links are opened; anything else (javascript:, data:) is shown as text. */
export function safeUrl(text: string): string | undefined {
    const value = text.trim();
    if (!value) {
        return undefined;
    }
    if (/^(https?:\/\/|mailto:)/i.test(value)) {
        return value;
    }
    if (/^[^\s@/:]+@[^\s@]+\.[a-z]{2,}$/i.test(value)) {
        return `mailto:${value}`;
    }
    // A bare host such as example.com/path (a port is fine, another scheme is not).
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?([/?#]\S*)?$/i.test(value)) {
        return `https://${value}`;
    }
    return undefined;
}

/** Up to two initials for a person avatar. */
export function initials(name: string): string {
    const words = name
        .trim()
        .split(/[\s._@-]+/)
        .filter(Boolean);
    if (words.length === 0) {
        return "?";
    }
    const first = words[0].charAt(0);
    const last = words.length > 1 ? words[words.length - 1].charAt(0) : words[0].charAt(1);
    return `${first}${last}`.toUpperCase();
}

/** A stable avatar colour for a name. */
export function personColor(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = (hash * 31 + name.charCodeAt(i)) % 2147483647;
    }
    return OPTION_COLORS[Math.abs(hash) % (OPTION_COLORS.length - 1)];
}

// ---------------------------------------------------------------- editing

export type InputResult = { value: FieldValue | undefined } | { error: "number" | "date" | "url" | "rating" };

/** A typed text read for the field; an empty text clears the value. */
export function parseInput(field: FieldDef, text: string): InputResult {
    const value = text.trim();
    if (!value) {
        return { value: undefined };
    }
    switch (field.type) {
        case "number": {
            const number = parseNumberText(value);
            return number === undefined ? { error: "number" } : { value: number };
        }
        case "rating": {
            const number = parseNumberText(value);
            if (number === undefined || number < 0 || number > (field.max ?? 5)) {
                return { error: "rating" };
            }
            return { value: Math.round(number) };
        }
        case "date": {
            const date = parseDay(value) ?? looseDate(value);
            return date ? { value: isoDay(date) } : { error: "date" };
        }
        case "url":
            return safeUrl(value) ? { value: value.slice(0, MAX_TEXT) } : { error: "url" };
        case "checkbox":
            return { value: truthy(value) };
        default:
            return { value: value.slice(0, MAX_TEXT) };
    }
}

function looseDate(text: string): Date | undefined {
    // dd-mm-yyyy and dd/mm/yyyy (day first, the common order outside the US) and what Date understands.
    const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(text);
    if (dmy) {
        const date = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
        return date.getDate() === Number(dmy[1]) ? date : undefined;
    }
    const time = Date.parse(text);
    if (Number.isNaN(time)) {
        return undefined;
    }
    const date = new Date(time);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

const YES_WORDS = ["true", "yes", "y", "1", "x", "✓", "✔", "done", "ok", "ja", "oui", "si", "sí"];

function truthy(text: string): boolean {
    return YES_WORDS.includes(text.trim().toLowerCase());
}

/** The text an editor starts with for typed fields. */
export function inputText(field: FieldDef, value: FieldValue | undefined): string {
    const read = readValue(field, value);
    if (read === undefined) {
        return "";
    }
    if (field.type === "number") {
        return String(read);
    }
    return Array.isArray(read) ? read.join(", ") : String(read);
}

// ---------------------------------------------------------------- type changes

export interface Conversion {
    /** The field after the change, with select options added for values that did not match one. */
    field: FieldDef;
    /** New stored value per task id; undefined clears the value. Only tasks that change are listed. */
    values: Map<string, FieldValue | undefined>;
    /** Values that carry over into the new type. */
    converted: number;
    /** Values that cannot be shown as the new type and are cleared. */
    cleared: number;
}

function textOf(field: FieldDef, raw: FieldValue): string {
    // Read with the old type, so select ids become their labels.
    const old = readValue(field, raw);
    if (old === undefined) {
        return Array.isArray(raw) ? raw.join(", ") : String(raw);
    }
    if (field.type === "select") {
        return optionOf(field, old)?.label ?? "";
    }
    if (field.type === "multi") {
        return (old as string[]).map(id => optionOf(field, id)?.label ?? id).join(", ");
    }
    if (field.type === "checkbox") {
        return old ? "Yes" : "No";
    }
    return Array.isArray(old) ? old.join(", ") : String(old);
}

/**
 * Converts every task's value from one definition of a field to another (type change, or options
 * removed). Nothing is lost silently: the caller shows `converted` and `cleared` before applying.
 */
export function convertField(
    from: FieldDef,
    to: FieldDef,
    entries: Array<{ id: string; raw: FieldValue | undefined }>
): Conversion {
    const field: FieldDef = { ...to, options: to.options ? [...to.options] : undefined };
    const values = new Map<string, FieldValue | undefined>();
    let converted = 0;
    let cleared = 0;
    const optionFor = (label: string): string | undefined => {
        const text = label.trim().slice(0, MAX_NAME);
        if (!text) {
            return undefined;
        }
        const existing = optionOf(field, text);
        if (existing) {
            return existing.id;
        }
        const options = field.options ?? (field.options = []);
        if (options.length >= MAX_OPTIONS) {
            return undefined;
        }
        const option = {
            id: newOptionId(options.map(o => o.id)),
            label: text,
            color: OPTION_COLORS[options.length % 10]
        };
        options.push(option);
        return option.id;
    };
    entries.forEach(({ id, raw }) => {
        if (raw === undefined || isEmptyValue(raw)) {
            return;
        }
        let next: FieldValue | undefined;
        const text = textOf(from, raw);
        switch (to.type) {
            case "text":
            case "person":
                next = text || undefined;
                break;
            case "url":
                next = safeUrl(text) ? text : undefined;
                break;
            case "number":
            case "rating": {
                const number =
                    from.type === "checkbox"
                        ? readValue(from, raw)
                            ? 1
                            : 0
                        : typeof raw === "number"
                        ? raw
                        : parseNumberText(text);
                next =
                    number === undefined
                        ? undefined
                        : to.type === "rating"
                        ? Math.max(0, Math.min(to.max ?? 5, Math.round(number)))
                        : number;
                break;
            }
            case "date": {
                const date = parseDay(text) ?? (from.type === "number" ? undefined : looseDate(text));
                next = date ? isoDay(date) : undefined;
                break;
            }
            case "checkbox":
                next = typeof raw === "number" ? raw !== 0 : typeof raw === "boolean" ? raw : truthy(text);
                break;
            case "select":
                next = optionFor((from.type === "multi" ? text.split(",")[0] : text) ?? "");
                break;
            case "multi": {
                const ids = text
                    .split(",")
                    .map(part => optionFor(part))
                    .filter((entry): entry is string => !!entry);
                next = ids.length > 0 ? [...new Set(ids)] : undefined;
                break;
            }
            default:
                next = undefined;
        }
        if (next === undefined) {
            cleared++;
            values.set(id, undefined);
            return;
        }
        converted++;
        if (JSON.stringify(next) !== JSON.stringify(raw)) {
            values.set(id, next);
        }
    });
    return { field, values, converted, cleared };
}

// ---------------------------------------------------------------- formulas

/** References are stored as [key] and shown as [Name], so a formula survives renames. */
export function toDisplayFormula(stored: string, fields: FieldDef[]): string {
    return stored.replace(/\[([^\]]+)\]/g, (whole, ref: string) => {
        const field = fields.find(entry => entry.key === ref);
        if (field) {
            return `[${field.name}]`;
        }
        return ref in BUILTIN_REFS ? `[${BUILTIN_REFS[ref]}]` : whole;
    });
}

export function toStoredFormula(display: string, fields: FieldDef[]): string {
    return display.replace(/\[([^\]]+)\]/g, (whole, ref: string) => {
        const name = ref.trim().toLowerCase();
        const field =
            fields.find(entry => entry.name.toLowerCase() === name) ?? fields.find(entry => entry.key === ref);
        if (field) {
            return `[${field.key}]`;
        }
        const builtin = Object.keys(BUILTIN_REFS).find(key => BUILTIN_REFS[key].toLowerCase() === name || key === ref);
        return builtin ? `[${builtin}]` : whole;
    });
}

type Token =
    | { kind: "num"; value: number }
    | { kind: "ref"; key: string }
    | { kind: "name"; name: string }
    | { kind: "op"; op: string };

function tokenize(source: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    while (i < source.length) {
        const c = source[i];
        if (/\s/.test(c)) {
            i++;
        } else if (/[0-9.]/.test(c)) {
            const match = /^\d*\.?\d+(e[+-]?\d+)?|^\d+\.?/i.exec(source.slice(i))!;
            tokens.push({ kind: "num", value: Number(match[0]) });
            i += match[0].length;
        } else if (c === "[") {
            const end = source.indexOf("]", i);
            if (end < 0) {
                throw new Error("bracket");
            }
            tokens.push({ kind: "ref", key: source.slice(i + 1, end).trim() });
            i = end + 1;
        } else if (/[A-Za-z_]/.test(c)) {
            const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i))!;
            tokens.push({ kind: "name", name: match[0].toUpperCase() });
            i += match[0].length;
        } else {
            const two = source.slice(i, i + 2);
            if (two === "<=" || two === ">=" || two === "<>" || two === "!=") {
                tokens.push({ kind: "op", op: two === "!=" ? "<>" : two });
                i += 2;
            } else if ("+-*/(),<>=%".includes(c)) {
                tokens.push({ kind: "op", op: c });
                i++;
            } else {
                throw new Error(`char ${c}`);
            }
        }
    }
    return tokens;
}

type Node =
    | { kind: "num"; value: number }
    | { kind: "ref"; key: string }
    | { kind: "unary"; op: string; arg: Node }
    | { kind: "bin"; op: string; left: Node; right: Node }
    | { kind: "call"; name: string; args: Node[] };

const FUNCTIONS: Record<string, { min: number; max: number }> = {
    ROUND: { min: 1, max: 2 },
    MIN: { min: 1, max: 20 },
    MAX: { min: 1, max: 20 },
    SUM: { min: 1, max: 20 },
    AVG: { min: 1, max: 20 },
    ABS: { min: 1, max: 1 },
    IF: { min: 2, max: 3 }
};
export const FORMULA_FUNCTIONS = Object.keys(FUNCTIONS);

function parse(tokens: Token[]): Node {
    let pos = 0;
    const peek = (): Token | undefined => tokens[pos];
    const isOp = (op: string): boolean => {
        const token = peek();
        return token?.kind === "op" && token.op === op;
    };
    const expect = (op: string): void => {
        if (!isOp(op)) {
            throw new Error(`expected ${op}`);
        }
        pos++;
    };
    const comparison = (): Node => {
        let left = additive();
        for (;;) {
            const token = peek();
            if (token?.kind === "op" && ["<", ">", "<=", ">=", "=", "<>"].includes(token.op)) {
                pos++;
                left = { kind: "bin", op: token.op, left, right: additive() };
            } else {
                return left;
            }
        }
    };
    const additive = (): Node => {
        let left = term();
        while (isOp("+") || isOp("-")) {
            const op = (tokens[pos++] as { op: string }).op;
            left = { kind: "bin", op, left, right: term() };
        }
        return left;
    };
    const term = (): Node => {
        let left = unary();
        while (isOp("*") || isOp("/")) {
            const op = (tokens[pos++] as { op: string }).op;
            left = { kind: "bin", op, left, right: unary() };
        }
        return left;
    };
    const unary = (): Node => {
        if (isOp("-") || isOp("+")) {
            const op = (tokens[pos++] as { op: string }).op;
            return { kind: "unary", op, arg: unary() };
        }
        let node = primary();
        if (isOp("%")) {
            pos++;
            node = { kind: "bin", op: "/", left: node, right: { kind: "num", value: 100 } };
        }
        return node;
    };
    const primary = (): Node => {
        const token = tokens[pos++];
        if (!token) {
            throw new Error("end");
        }
        if (token.kind === "num") {
            return token;
        }
        if (token.kind === "ref") {
            return token;
        }
        if (token.kind === "name") {
            const spec = FUNCTIONS[token.name];
            if (!spec) {
                throw new Error(`function ${token.name}`);
            }
            expect("(");
            const args: Node[] = [];
            if (!isOp(")")) {
                args.push(comparison());
                while (isOp(",")) {
                    pos++;
                    args.push(comparison());
                }
            }
            expect(")");
            if (args.length < spec.min || args.length > spec.max) {
                throw new Error(`arguments ${token.name}`);
            }
            return { kind: "call", name: token.name, args };
        }
        if (token.op === "(") {
            const inner = comparison();
            expect(")");
            return inner;
        }
        throw new Error(`unexpected ${token.op}`);
    };
    const node = comparison();
    if (pos < tokens.length) {
        throw new Error("trailing");
    }
    return node;
}

const compiled = new Map<string, Node | Error>();
function compile(formula: string): Node | Error {
    let node = compiled.get(formula);
    if (!node) {
        try {
            node = parse(tokenize(formula));
        } catch (error) {
            node = error instanceof Error ? error : new Error(String(error));
        }
        if (compiled.size > 500) {
            compiled.clear();
        }
        compiled.set(formula, node);
    }
    return node;
}

function references(node: Node, into: Set<string>): Set<string> {
    if (node.kind === "ref") {
        into.add(node.key);
    } else if (node.kind === "unary") {
        references(node.arg, into);
    } else if (node.kind === "bin") {
        references(node.left, into);
        references(node.right, into);
    } else if (node.kind === "call") {
        node.args.forEach(arg => references(arg, into));
    }
    return into;
}

/** Why a stored formula cannot be used, or undefined when it is fine. */
export function formulaProblem(
    stored: string,
    fields: FieldDef[],
    selfKey: string
): "empty" | "syntax" | "unknown" | "self" | "text" | undefined {
    if (!stored.trim()) {
        return "empty";
    }
    const node = compile(stored);
    if (node instanceof Error) {
        return "syntax";
    }
    const refs = references(node, new Set());
    for (const ref of refs) {
        if (ref === selfKey) {
            return "self";
        }
        if (ref in BUILTIN_REFS) {
            continue;
        }
        const field = fields.find(entry => entry.key === ref);
        if (!field) {
            return "unknown";
        }
        if (field.type === "formula") {
            // One level only: formulas use stored values, which keeps them cheap and free of cycles.
            return "self";
        }
        if (field.type === "text" || field.type === "person" || field.type === "url" || field.type === "multi") {
            return "text";
        }
    }
    return undefined;
}

/** Numbers a formula sees: numbers, ratings, checkboxes as 1 or 0, dates as days since 1970, built-ins. */
export function formulaInputs(
    fields: FieldDef[],
    values: FieldValues,
    builtins: Record<string, number | undefined>
): Record<string, number | undefined> {
    const inputs: Record<string, number | undefined> = { ...builtins };
    fields.forEach(field => {
        const read = readValue(field, values[field.key]);
        if (field.type === "checkbox") {
            inputs[field.key] = read ? 1 : 0;
        } else if (field.type === "date") {
            const date = typeof read === "string" ? parseDay(read) : undefined;
            inputs[field.key] = date
                ? Math.round(date.getTime() / 86400000 - date.getTimezoneOffset() / 1440)
                : undefined;
        } else if (field.type === "select") {
            // A select whose labels are numbers (1, 2, 3) can be calculated with.
            const label = optionOf(field, read)?.label;
            inputs[field.key] = label !== undefined ? parseNumberText(label) : undefined;
        } else if (typeof read === "number") {
            inputs[field.key] = read;
        }
    });
    return inputs;
}

/** The formula's result, or undefined when it cannot be worked out (missing input, division by zero). */
export function evaluateFormula(stored: string, inputs: Record<string, number | undefined>): number | undefined {
    const node = compile(stored);
    if (node instanceof Error) {
        return undefined;
    }
    const run = (n: Node): number | undefined => {
        switch (n.kind) {
            case "num":
                return n.value;
            case "ref":
                return inputs[n.key];
            case "unary": {
                const value = run(n.arg);
                return value === undefined ? undefined : n.op === "-" ? -value : value;
            }
            case "bin": {
                const a = run(n.left);
                const b = run(n.right);
                if (a === undefined || b === undefined) {
                    return undefined;
                }
                switch (n.op) {
                    case "+":
                        return a + b;
                    case "-":
                        return a - b;
                    case "*":
                        return a * b;
                    case "/":
                        return b === 0 ? undefined : a / b;
                    case "<":
                        return a < b ? 1 : 0;
                    case ">":
                        return a > b ? 1 : 0;
                    case "<=":
                        return a <= b ? 1 : 0;
                    case ">=":
                        return a >= b ? 1 : 0;
                    case "=":
                        return a === b ? 1 : 0;
                    default:
                        return a !== b ? 1 : 0;
                }
            }
            case "call": {
                if (n.name === "IF") {
                    const test = run(n.args[0]);
                    if (test === undefined) {
                        return undefined;
                    }
                    return test !== 0 ? run(n.args[1]) : n.args[2] ? run(n.args[2]) : 0;
                }
                const args = n.args.map(run);
                const known = args.filter((value): value is number => value !== undefined);
                switch (n.name) {
                    case "ROUND": {
                        if (args[0] === undefined) {
                            return undefined;
                        }
                        const digits = Math.max(0, Math.min(6, Math.round(args[1] ?? 0)));
                        const factor = 10 ** digits;
                        return Math.round(args[0] * factor) / factor;
                    }
                    case "ABS":
                        return args[0] === undefined ? undefined : Math.abs(args[0]);
                    case "SUM":
                        return known.reduce((sum, value) => sum + value, 0);
                    case "AVG":
                        return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : undefined;
                    case "MIN":
                        return known.length ? Math.min(...known) : undefined;
                    default:
                        return known.length ? Math.max(...known) : undefined;
                }
            }
        }
    };
    const result = run(node);
    return result !== undefined && Number.isFinite(result) ? result : undefined;
}

// ---------------------------------------------------------------- filters and columns

/** Fields a user can filter on with a picker, and their choices. */
export function filterChoices(
    fields: FieldDef[],
    valuesOf: () => FieldValues[],
    texts: { yes: string; no: string; empty: string }
): Array<{ field: FieldDef; choices: Array<{ value: string; label: string }> }> {
    const result: Array<{ field: FieldDef; choices: Array<{ value: string; label: string }> }> = [];
    let all: FieldValues[] | undefined;
    fields.forEach(field => {
        if (hasOptions(field.type)) {
            result.push({
                field,
                choices: [
                    ...(field.options ?? []).map(option => ({ value: option.id, label: option.label })),
                    { value: "", label: texts.empty }
                ]
            });
        } else if (field.type === "checkbox") {
            result.push({
                field,
                choices: [
                    { value: "true", label: texts.yes },
                    { value: "false", label: texts.no }
                ]
            });
        } else if (field.type === "person") {
            all = all ?? valuesOf();
            const names = new Set<string>();
            all.forEach(values => {
                const value = readValue(field, values[field.key]);
                if (typeof value === "string" && value.trim()) {
                    names.add(value.trim());
                }
            });
            if (names.size > 0) {
                result.push({
                    field,
                    choices: [
                        ...[...names].sort((a, b) => a.localeCompare(b)).map(name => ({ value: name, label: name })),
                        { value: "", label: texts.empty }
                    ]
                });
            }
        }
    });
    return result;
}

/** A field filter is written "key=value"; the empty value matches tasks without a value. */
export function encodeFieldFilter(key: string, value: string): string {
    return `${key}=${value}`;
}

export function matchesFieldFilter(filter: string, fields: FieldDef[], values: FieldValues | undefined): boolean {
    const at = filter.indexOf("=");
    if (at < 0) {
        return true;
    }
    const key = filter.slice(0, at);
    const wanted = filter.slice(at + 1);
    const field = fields.find(entry => entry.key === key);
    if (!field) {
        return true;
    }
    const value = readValue(field, values?.[key]);
    if (field.type === "checkbox") {
        return (value === true) === (wanted === "true");
    }
    if (wanted === "") {
        return value === undefined;
    }
    if (Array.isArray(value)) {
        return value.includes(wanted);
    }
    return typeof value === "string" && value.trim().toLowerCase() === wanted.toLowerCase();
}

/**
 * Puts columns in the user's order. Columns the order does not know (new fields, new built-ins)
 * keep their place after the column they follow by default.
 */
export function orderColumns<T extends { key: string }>(columns: T[], order: string[] | undefined): T[] {
    if (!order || order.length === 0) {
        return columns;
    }
    const byKey = new Map(columns.map(column => [column.key, column]));
    const result: T[] = order.filter(key => byKey.has(key)).map(key => byKey.get(key)!);
    const placed = new Set(result.map(column => column.key));
    columns.forEach((column, index) => {
        if (placed.has(column.key)) {
            return;
        }
        // After the nearest earlier column that is already placed, or first.
        let at = 0;
        for (let back = index - 1; back >= 0; back--) {
            const found = result.findIndex(entry => entry.key === columns[back].key);
            if (found >= 0) {
                at = found + 1;
                break;
            }
        }
        result.splice(at, 0, column);
        placed.add(column.key);
    });
    return result;
}

/** Moves one key in a list to before the key at `toIndex` of that list (after removal semantics). */
export function moveKey(keys: string[], key: string, toIndex: number): string[] {
    const from = keys.indexOf(key);
    if (from < 0) {
        return keys;
    }
    const next = keys.filter(entry => entry !== key);
    next.splice(Math.max(0, Math.min(next.length, toIndex)), 0, key);
    return next;
}
