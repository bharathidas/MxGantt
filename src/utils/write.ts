import { ObjectItem } from "mendix";

/**
 * Writing the new dates, progress, names and dependencies back to the task objects.
 *
 * The pluggable widget API refuses to write an attribute that came from a data source ("This
 * operation is not yet supported on attributes linked to a datasource"), so the values go through
 * the Mendix client API instead: fetch the object by its guid, set the attribute, optionally commit,
 * and let the data source push the change back into the widget. The one thing the client API needs
 * and the widget API hides is the attribute's name - `attribute.id` is an opaque handle - so the
 * name is recovered by matching values across the objects that are already loaded, unless the app
 * configured it.
 */

export type WriteKind = "date" | "number" | "string" | "boolean" | "enum";

/** The part of a ListAttributeValue this module needs, so tests and the harness can fake it. */
export interface WritableAttribute {
    id: string;
    get(item: ObjectItem): { value?: unknown };
}

interface MxClientObject {
    get(name: string): unknown;
    set(name: string, value: unknown): void;
    getAttributes(): string[];
    getAttributeType(name: string): string;
    getGuid?: () => string;
}

interface MxClientData {
    get(options: {
        guids: string[];
        callback: (objects: MxClientObject[] | MxClientObject) => void;
        error: (error: unknown) => void;
    }): void;
    commit?: (options: {
        mxobj?: MxClientObject;
        mxobjs?: MxClientObject[];
        callback: () => void;
        error: (error: unknown) => void;
    }) => void;
}

const CLIENT_TYPES: Record<WriteKind, string[]> = {
    date: ["DateTime"],
    number: ["Integer", "Long", "Decimal"],
    string: ["String"],
    // 1.2 configured attribute columns.
    boolean: ["Boolean"],
    enum: ["Enum"]
};

const attributeNames = new Map<string, Promise<string | undefined>>();

function clientData(): MxClientData | undefined {
    const mx = (window as unknown as { mx?: { data?: MxClientData } }).mx;
    return mx?.data && typeof mx.data.get === "function" ? mx.data : undefined;
}

function reportError(message: string, error: unknown): void {
    const mx = (window as unknown as { mx?: { ui?: { error?: (text: string) => void } } }).mx;
    const text = `MxGantt: ${message}: ${error instanceof Error ? error.message : String(error)}`;
    console.error(text);
    mx?.ui?.error?.(text);
}

function getObjects(data: MxClientData, guids: string[]): Promise<MxClientObject[]> {
    return new Promise((resolve, reject) => {
        data.get({ guids, callback: result => resolve(Array.isArray(result) ? result : [result]), error: reject });
    });
}

/** Normalises a widget value (Date, Big, number) and a client value to a comparable number. */
export function toNumber(value: unknown): number | undefined {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }
    if (value instanceof Date) {
        return value.getTime();
    }
    const number = Number(String(value));
    return Number.isNaN(number) ? undefined : number;
}

/** Whether a client object's raw value is the value the widget sees. */
export function sameRaw(raw: unknown, value: unknown): boolean {
    const a = toNumber(raw);
    const b = toNumber(value);
    return a === b;
}

/** The same for text, where empty, null and undefined are all "no value". */
export function sameText(raw: unknown, value: unknown): boolean {
    const text = (entry: unknown): string => (entry === undefined || entry === null ? "" : String(entry));
    return text(raw) === text(value);
}

/** Names that sound like a copy of the real value, such as BaselineStart or PlannedEnd. */
const COPY_NAMES = /baseline|planned|original|target|previous|old/i;

/**
 * When the values leave several candidates (a freshly baselined plan has Start = BaselineStart on
 * every task), the name decides: copies are dropped first, then names that fit the role of the
 * field are preferred. Undefined when that still leaves more than one.
 */
export function pickCandidate(candidates: string[], hint?: RegExp, hintFirst = false): string | undefined {
    if (candidates.length === 1) {
        return candidates[0];
    }
    if (hintFirst && hint) {
        // 2.3 text fields (assignments, segments, baselines) are often all empty: the name decides first.
        const named = candidates.filter(name => hint.test(name));
        if (named.length === 1) {
            return named[0];
        }
    }
    const originals = candidates.filter(name => !COPY_NAMES.test(name));
    if (originals.length === 1) {
        return originals[0];
    }
    const pool = originals.length > 0 ? originals : candidates;
    const fitting = hint ? pool.filter(name => hint.test(name)) : [];
    return fitting.length === 1 ? fitting[0] : undefined;
}

function resolveAttributeName(
    data: MxClientData,
    attribute: WritableAttribute,
    kind: WriteKind,
    items: ObjectItem[],
    hint?: RegExp,
    hintFirst = false
): Promise<string | undefined> {
    const cached = attributeNames.get(attribute.id);
    if (cached) {
        return cached;
    }
    // Start and end are both DateTime, and texts are often empty, so take a generous sample: the
    // more objects, the likelier two attributes differ somewhere.
    const sample = items.slice(0, 200);
    const matches = kind === "string" || kind === "boolean" || kind === "enum" ? sameText : sameRaw;
    const resolved = getObjects(
        data,
        sample.map(item => item.id)
    )
        .then(objects => {
            let candidates: string[] | undefined;
            objects.forEach(object => {
                const guid = typeof object.getGuid === "function" ? object.getGuid() : undefined;
                const item = sample.find(entry => entry.id === guid) ?? sample[objects.indexOf(object)];
                if (!item) {
                    return;
                }
                const expected = attribute.get(item).value;
                candidates = (candidates ?? object.getAttributes()).filter(
                    name =>
                        CLIENT_TYPES[kind].includes(object.getAttributeType(name)) &&
                        matches(object.get(name), expected)
                );
            });
            const picked = candidates ? pickCandidate(candidates, hint, hintFirst) : undefined;
            if (!picked) {
                console.warn("MxGantt: cannot tell which attribute to write, candidates:", candidates);
                attributeNames.delete(attribute.id);
                return undefined;
            }
            return picked;
        })
        .catch(error => {
            reportError("could not load the tasks to write to", error);
            attributeNames.delete(attribute.id);
            return undefined;
        });
    attributeNames.set(attribute.id, resolved);
    return resolved;
}

export interface WriteField {
    attribute: WritableAttribute;
    kind: WriteKind;
    /** null clears the attribute (1.2). */
    value: Date | number | string | boolean | null;
    /** The attribute's name when the app configured it; skips working it out from the values. */
    name?: string;
    /** What the attribute is likely called, to choose between attributes that hold the same values. */
    hint?: RegExp;
    /** 2.3: try the hint before dropping copy-like names (a Baselines attribute is not a copy). */
    hintFirst?: boolean;
}

export interface WriteOptions {
    /** Every item currently loaded, used to work out which attribute is which. */
    items: ObjectItem[];
    commit: boolean;
}

export interface WriteEntry {
    item: ObjectItem;
    fields: WriteField[];
}

function clientValue(value: Date | number | string | boolean | null): unknown {
    // Same shapes mxSheet writes: epoch milliseconds for dates, a decimal string for numbers, which
    // the client turns into a Big for Integer, Long and Decimal alike, and text as it is. Booleans
    // stay booleans, and an empty value is the empty string the client uses for "no value".
    if (value === null) {
        return "";
    }
    if (typeof value === "boolean") {
        return value;
    }
    return value instanceof Date ? value.getTime() : String(value);
}

/**
 * Writes several attributes of several objects: the attribute names are worked out once, all
 * objects are fetched in one call and committed in one call, so a batch (a task and the successors
 * it pushed, or an undo) is saved together.
 */
export function writeTasks(entries: WriteEntry[], options: WriteOptions): Promise<boolean> {
    const data = clientData();
    const work = entries.filter(entry => entry.fields.length > 0);
    if (!data || work.length === 0) {
        return Promise.resolve(false);
    }
    const distinct = new Map<string, WriteField>();
    work.forEach(entry => entry.fields.forEach(field => distinct.set(field.attribute.id, field)));
    const fields = [...distinct.values()];
    return Promise.all(
        fields.map(field =>
            field.name
                ? Promise.resolve(field.name)
                : resolveAttributeName(data, field.attribute, field.kind, options.items, field.hint, field.hintFirst)
        )
    )
        .then(resolved => {
            const names = new Map(fields.map((field, index) => [field.attribute.id, resolved[index]]));
            if ([...names.values()].some(name => !name)) {
                reportError("could not save the change", new Error("the attribute to write could not be found"));
                return false;
            }
            return getObjects(
                data,
                work.map(entry => entry.item.id)
            ).then(objects => {
                const byGuid = new Map<string, MxClientObject>();
                objects.forEach((object, index) => {
                    const guid = typeof object.getGuid === "function" ? object.getGuid() : work[index]?.item.id;
                    if (guid) {
                        byGuid.set(guid, object);
                    }
                });
                const changed: MxClientObject[] = [];
                // 2.3: what the objects held before, so a failed commit can be rolled back in the client.
                const undoValues: Array<{ object: MxClientObject; name: string; value: unknown }> = [];
                work.forEach(entry => {
                    const object = byGuid.get(entry.item.id);
                    if (!object) {
                        return;
                    }
                    entry.fields.forEach(field => {
                        const name = names.get(field.attribute.id)!;
                        undoValues.push({ object, name, value: object.get(name) });
                        object.set(name, clientValue(field.value));
                    });
                    changed.push(object);
                });
                const rollback = (): void => {
                    [...undoValues].reverse().forEach(entry => {
                        try {
                            entry.object.set(entry.name, entry.value);
                        } catch {
                            // The object may be gone; nothing left to restore.
                        }
                    });
                };
                if (changed.length === 0) {
                    return false;
                }
                if (options.commit && data.commit) {
                    return new Promise<boolean>(resolve => {
                        data.commit!({
                            ...(changed.length === 1 ? { mxobj: changed[0] } : { mxobjs: changed }),
                            callback: () => resolve(true),
                            error: error => {
                                reportError("could not save the task", error);
                                rollback();
                                resolve(false);
                            }
                        });
                    });
                }
                return true;
            });
        })
        .catch(error => {
            reportError("could not save the change", error);
            return false;
        });
}

/** Writes several attributes of one object, with a single fetch and at most one commit. */
export function writeTask(item: ObjectItem, fields: WriteField[], options: WriteOptions): Promise<boolean> {
    return writeTasks([{ item, fields }], options);
}

/** For tests: forget the attribute names worked out so far. */
export function resetAttributeNames(): void {
    attributeNames.clear();
}
