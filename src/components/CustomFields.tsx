import classNames from "classnames";
import {
    CSSProperties,
    KeyboardEvent,
    PointerEvent as ReactPointerEvent,
    ReactElement,
    ReactNode,
    RefObject,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState
} from "react";

import {
    BUILTIN_REFS,
    cleanField,
    evaluateFormula,
    FIELD_TYPES,
    FieldDef,
    FieldOption,
    FieldType,
    FieldValue,
    formatNumberValue,
    formatValue,
    formulaInputs,
    formulaProblem,
    hasOptions,
    initials,
    inputText,
    MAX_NAME,
    MAX_OPTIONS,
    newFieldKey,
    newOptionId,
    NumberFormat,
    OPTION_COLORS,
    optionOf,
    parseInput,
    personColor,
    readValue,
    safeUrl,
    toDisplayFormula,
    toStoredFormula,
    typeInfo
} from "../utils/fields";
import { fill, Texts } from "../utils/texts";

/**
 * Custom fields UI (1.1): field type icons, cell renderers and editors, the Add / Edit field
 * popover, the column chooser panel and the first-time hint. GanttChart wires them to the task
 * list; the data rules live in utils/fields.ts.
 */

const ICON_PATHS: Record<string, string[]> = {
    text: ["M3 4h10", "M8 4v9"],
    number: ["M6 2.5 4.5 13.5", "M11.5 2.5 10 13.5", "M2.5 6h11", "M2 10.5h11"],
    date: ["M3 4h10v9.5H3z", "M3 7h10", "M5.5 2.5v3", "M10.5 2.5v3"],
    select: ["M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z", "M5.5 7l2.5 2.5L10.5 7"],
    multi: ["M2.5 4.5h2", "M2.5 8h2", "M2.5 11.5h2", "M6.5 4.5h7", "M6.5 8h7", "M6.5 11.5h7"],
    checkbox: ["M3 3h10v10H3z", "M5.5 8l2 2 3.5-4"],
    person: ["M8 2.5a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z", "M3 13.5a5 5 0 0 1 10 0"],
    url: ["M6.5 9.5l3-3", "M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1", "M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1"],
    rating: ["M8 2.2l1.8 3.7 4 .6-2.9 2.8.7 4L8 11.4l-3.6 1.9.7-4L2.2 6.5l4-.6z"],
    formula: ["M10.5 2.5H8.5a1.5 1.5 0 0 0-1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-2", "M4.5 7h6"],
    plus: ["M8 3v10", "M3 8h10"],
    close: ["M4 4l8 8", "M12 4l-8 8"],
    more: ["M3.5 8h.01", "M8 8h.01", "M12.5 8h.01"],
    drag: ["M6 3.5h.01", "M10 3.5h.01", "M6 8h.01", "M10 8h.01", "M6 12.5h.01", "M10 12.5h.01"],
    up: ["M4.5 9.5L8 6l3.5 3.5"],
    down: ["M4.5 6.5L8 10l3.5-3.5"],
    trash: ["M3 4.5h10", "M6.5 4.5V3h3v1.5", "M4.5 4.5l.7 9h5.6l.7-9"],
    search: ["M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z", "M10.5 10.5l3 3"],
    check: ["M3 8.5l3 3 7-7"],
    sparkle: [
        "M8 2v3",
        "M8 11v3",
        "M2 8h3",
        "M11 8h3",
        "M4 4l1.5 1.5",
        "M10.5 10.5L12 12",
        "M12 4l-1.5 1.5",
        "M5.5 10.5L4 12"
    ]
};

export function FieldIcon({ name, className }: { name: string; className?: string }): ReactElement {
    return (
        <svg
            className={classNames("mxgantt-ficon", className)}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
        >
            {(ICON_PATHS[name] ?? ICON_PATHS.text).map(d => (
                <path key={d} d={d} />
            ))}
        </svg>
    );
}

const TYPE_TEXT: Record<FieldType, { label: keyof Texts; help: keyof Texts }> = {
    text: { label: "typeText", help: "helpText" },
    number: { label: "typeNumber", help: "helpNumber" },
    date: { label: "typeDate", help: "helpDate" },
    select: { label: "typeSelect", help: "helpSelect" },
    multi: { label: "typeMulti", help: "helpMulti" },
    checkbox: { label: "typeCheckbox", help: "helpCheckbox" },
    person: { label: "typePerson", help: "helpPerson" },
    url: { label: "typeUrl", help: "helpUrl" },
    rating: { label: "typeRating", help: "helpRating" },
    formula: { label: "typeFormula", help: "helpFormula" }
};

export function typeLabel(texts: Texts, type: FieldType): string {
    return texts[TYPE_TEXT[type].label];
}

/** Chip colours come from one CSS variable, so dark mode can tint them differently. */
function chipStyle(color: string): CSSProperties {
    return { "--mxgantt-chip": color } as CSSProperties;
}

export function OptionChip({ option }: { option: FieldOption }): ReactElement {
    return (
        <span className="mxgantt-chip-tag" style={chipStyle(option.color)} title={option.label}>
            {option.label}
        </span>
    );
}

export interface FieldCellProps {
    field: FieldDef;
    value: FieldValue | undefined;
    /** Formula fields: the calculated result. */
    computed?: number;
    texts: Texts;
    locale?: string;
    /** Set when a click may change the value straight away (checkbox, rating). */
    onQuick?: (value: FieldValue | undefined) => void;
}

/** A custom field value as the task list shows it. */
export function FieldCell(props: FieldCellProps): ReactElement | null {
    const { field, texts, locale, onQuick } = props;
    if (field.type === "formula") {
        return props.computed === undefined ? null : (
            <span className="mxgantt-fv-formula">{formatNumberValue(field, props.computed, locale)}</span>
        );
    }
    const value = readValue(field, props.value);
    switch (field.type) {
        case "checkbox": {
            const on = value === true;
            const box = (
                <span className={classNames("mxgantt-fv-check", { "is-on": on })} aria-hidden="true">
                    {on && <FieldIcon name="check" />}
                </span>
            );
            return onQuick ? (
                <button
                    type="button"
                    tabIndex={-1}
                    className="mxgantt-fv-quick"
                    role="checkbox"
                    aria-checked={on}
                    aria-label={field.name}
                    onClick={event => {
                        event.stopPropagation();
                        onQuick(!on);
                    }}
                    onDoubleClick={event => event.stopPropagation()}
                >
                    {box}
                </button>
            ) : (
                <span role="img" aria-label={on ? texts.yes : texts.no}>
                    {box}
                </span>
            );
        }
        case "rating": {
            const max = field.max ?? 5;
            const score = (value as number | undefined) ?? 0;
            return (
                <span
                    className="mxgantt-fv-rating"
                    role="img"
                    aria-label={fill(texts.rateValue, { n: score, max })}
                    title={fill(texts.rateValue, { n: score, max })}
                >
                    {Array.from({ length: max }, (_, index) => (
                        <span
                            key={index}
                            className={classNames("mxgantt-fv-star", { "is-on": index < score })}
                            onClick={
                                onQuick
                                    ? event => {
                                          event.stopPropagation();
                                          onQuick(index + 1 === score ? undefined : index + 1);
                                      }
                                    : undefined
                            }
                        >
                            <FieldIcon name="rating" />
                        </span>
                    ))}
                </span>
            );
        }
        case "select": {
            const option = optionOf(field, value);
            return option ? <OptionChip option={option} /> : null;
        }
        case "multi": {
            const options = ((value as string[] | undefined) ?? [])
                .map(id => optionOf(field, id))
                .filter((option): option is FieldOption => !!option);
            return options.length === 0 ? null : (
                <span className="mxgantt-fv-chips" title={options.map(option => option.label).join(", ")}>
                    {options.map(option => (
                        <OptionChip key={option.id} option={option} />
                    ))}
                </span>
            );
        }
        case "person": {
            if (typeof value !== "string") {
                return null;
            }
            return (
                <span className="mxgantt-fv-person" title={value}>
                    <span className="mxgantt-avatar" style={chipStyle(personColor(value))} aria-hidden="true">
                        {initials(value)}
                    </span>
                    <span className="mxgantt-fv-text">{value}</span>
                </span>
            );
        }
        case "url": {
            if (typeof value !== "string") {
                return null;
            }
            const href = safeUrl(value);
            const shown = value.replace(/^(https?:\/\/|mailto:)/i, "").replace(/\/$/, "");
            return href ? (
                <a
                    className="mxgantt-fv-link"
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={fill(texts.openLink, { url: value })}
                    onClick={event => event.stopPropagation()}
                    onDoubleClick={event => event.stopPropagation()}
                    tabIndex={-1}
                >
                    {shown}
                </a>
            ) : (
                <span className="mxgantt-fv-text">{value}</span>
            );
        }
        case "number": {
            if (typeof value !== "number") {
                return null;
            }
            const text = formatNumberValue(field, value, locale);
            if (field.format === "percent" && value >= 0 && value <= 100) {
                return (
                    <span className="mxgantt-fv-percent">
                        <span className="mxgantt-fv-meter" aria-hidden="true">
                            <span style={{ width: `${value}%` }} />
                        </span>
                        {text}
                    </span>
                );
            }
            return <span className={classNames("mxgantt-fv-number", { "is-negative": value < 0 })}>{text}</span>;
        }
        default: {
            const text = formatValue(field, value, { locale, yes: texts.yes, no: texts.no });
            return text ? (
                <span className="mxgantt-fv-text" title={text}>
                    {text}
                </span>
            ) : null;
        }
    }
}

// ---------------------------------------------------------------- value editors

export type EditCommitHow = "enter" | "next" | "previous" | "blur";

export interface FieldEditorProps {
    field: FieldDef;
    value: FieldValue | undefined;
    texts: Texts;
    label: string;
    align: "left" | "center" | "right";
    /** Values of this field on other tasks, offered while typing a person or text. */
    suggestions?: string[];
    /** The edited value as JSON ({"v": value}); the caller writes it. */
    onCommit: (json: string, how: EditCommitHow) => void;
    onCancel: () => void;
}

export function encodeEdit(value: FieldValue | undefined): string {
    return JSON.stringify({ v: value === undefined ? null : value });
}

export function decodeEdit(json: string): FieldValue | undefined {
    try {
        const parsed = JSON.parse(json) as { v?: FieldValue | null };
        return parsed && parsed.v !== null && parsed.v !== undefined ? parsed.v : undefined;
    } catch {
        return undefined;
    }
}

/** The editor for one custom field cell, picked by type; all of them work with the keyboard alone. */
export function FieldValueEditor(props: FieldEditorProps): ReactElement {
    const { field } = props;
    if (hasOptions(field.type)) {
        return <OptionEditor {...props} />;
    }
    if (field.type === "checkbox") {
        return <CheckEditor {...props} />;
    }
    if (field.type === "rating") {
        return <RatingEditor {...props} />;
    }
    return <TextEditor {...props} />;
}

function keyHow(event: KeyboardEvent): EditCommitHow | "cancel" | undefined {
    if (event.key === "Enter") {
        return "enter";
    }
    if (event.key === "Tab") {
        return event.shiftKey ? "previous" : "next";
    }
    if (event.key === "Escape") {
        return "cancel";
    }
    return undefined;
}

function TextEditor(props: FieldEditorProps): ReactElement {
    const { field, texts } = props;
    const inputRef = useRef<HTMLInputElement>(null);
    const settled = useRef(false);
    const [error, setError] = useState<string>();
    const listId = `${useId().replace(/[^a-zA-Z0-9_-]/g, "")}-list`;
    const errorId = `${listId}-error`;
    useEffect(() => {
        const input = inputRef.current;
        input?.focus({ preventScroll: true });
        if (input && input.type === "text") {
            input.select();
        }
    }, []);
    const finish = (how: EditCommitHow): void => {
        const result = parseInput(field, inputRef.current?.value ?? "");
        if ("error" in result) {
            if (how === "blur") {
                settled.current = true;
                props.onCancel();
                return;
            }
            setError(
                result.error === "number"
                    ? texts.invalidFieldNumber
                    : result.error === "date"
                    ? texts.invalidFieldDate
                    : result.error === "rating"
                    ? fill(texts.invalidRating, { max: field.max ?? 5 })
                    : texts.invalidUrl
            );
            inputRef.current?.focus({ preventScroll: true });
            return;
        }
        settled.current = true;
        props.onCommit(encodeEdit(result.value), how);
    };
    const initial = inputText(field, props.value);
    return (
        <>
            <input
                ref={inputRef}
                className="mxgantt-editor"
                type={field.type === "date" ? "date" : field.type === "url" ? "url" : "text"}
                inputMode={field.type === "number" ? "decimal" : undefined}
                defaultValue={initial}
                list={props.suggestions && props.suggestions.length > 0 ? listId : undefined}
                aria-label={props.label}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                maxLength={2000}
                style={{ textAlign: props.align }}
                onKeyDown={event => {
                    event.stopPropagation();
                    const how = keyHow(event);
                    if (!how) {
                        return;
                    }
                    event.preventDefault();
                    if (how === "cancel") {
                        settled.current = true;
                        props.onCancel();
                    } else {
                        finish(how);
                    }
                }}
                onPointerDown={event => event.stopPropagation()}
                onClick={event => event.stopPropagation()}
                onDoubleClick={event => event.stopPropagation()}
                onBlur={() => {
                    if (!settled.current) {
                        finish("blur");
                    }
                }}
            />
            {props.suggestions && props.suggestions.length > 0 && (
                <datalist id={listId}>
                    {props.suggestions.map(entry => (
                        <option key={entry} value={entry} />
                    ))}
                </datalist>
            )}
            {error && (
                <span id={errorId} className="mxgantt-editor-error" role="alert">
                    {error}
                </span>
            )}
        </>
    );
}

/** Where a popup below the cell fits: fixed coordinates, flipped above when the space below is short. */
function usePopupPlace(anchor: RefObject<HTMLElement | null>, height: number): CSSProperties {
    const [place, setPlace] = useState<CSSProperties>({ visibility: "hidden" });
    useLayoutEffect(() => {
        const box = anchor.current?.getBoundingClientRect();
        if (!box) {
            return;
        }
        const width = Math.max(220, box.width);
        const left = Math.max(8, Math.min(box.left, window.innerWidth - width - 8));
        const below = window.innerHeight - box.bottom;
        const top = below < height && box.top > below ? Math.max(8, box.top - height - 4) : box.bottom + 4;
        // Measuring the cell needs the DOM, so the place is set after layout.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPlace({ position: "fixed", left, top, width });
    }, [anchor, height]);
    return place;
}

function OptionEditor(props: FieldEditorProps): ReactElement {
    const { field, texts } = props;
    const multi = field.type === "multi";
    const options = field.options ?? [];
    const anchorRef = useRef<HTMLDivElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const settled = useRef(false);
    const initial = readValue(field, props.value);
    const [chosen, setChosen] = useState<string[]>(() =>
        Array.isArray(initial) ? initial : typeof initial === "string" ? [initial] : []
    );
    const [query, setQuery] = useState("");
    const shown = options.filter(option => option.label.toLowerCase().includes(query.trim().toLowerCase()));
    const [activeRaw, setActive] = useState(() =>
        Math.max(
            0,
            shown.findIndex(option => chosen.includes(option.id))
        )
    );
    const active = Math.min(Math.max(0, activeRaw), Math.max(0, shown.length - 1));
    const listId = `${useId().replace(/[^a-zA-Z0-9_-]/g, "")}-options`;
    const place = usePopupPlace(anchorRef, Math.min(300, 56 + options.length * 32));

    useEffect(() => {
        searchRef.current?.focus({ preventScroll: true });
        // Once more after the chart has settled focus for the click that opened the editor.
        const timer = window.setTimeout(() => {
            if (!rootRef.current?.contains(document.activeElement)) {
                searchRef.current?.focus({ preventScroll: true });
            }
        }, 0);
        return () => window.clearTimeout(timer);
    }, []);

    const valueOf = (ids: string[]): FieldValue | undefined => (multi ? (ids.length ? ids : undefined) : ids[0]);
    const commit = (ids: string[], how: EditCommitHow): void => {
        settled.current = true;
        props.onCommit(encodeEdit(valueOf(ids)), how);
    };
    const pick = (option: FieldOption): void => {
        if (multi) {
            setChosen(current =>
                current.includes(option.id) ? current.filter(id => id !== option.id) : [...current, option.id]
            );
        } else {
            commit([option.id], "enter");
        }
    };
    const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
        event.stopPropagation();
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            setActive(index => (shown.length === 0 ? 0 : (index + step + shown.length) % shown.length));
            return;
        }
        if (event.key === "Enter" || (multi && event.key === " " && !query)) {
            event.preventDefault();
            const option = shown[active];
            if (option) {
                pick(option);
            } else if (event.key === "Enter") {
                commit(chosen, "enter");
            }
            return;
        }
        if (event.key === "Tab") {
            event.preventDefault();
            commit(chosen, event.shiftKey ? "previous" : "next");
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            settled.current = true;
            if (multi) {
                // Like the other editors' Enter: Escape on a multi-select keeps the ticks made so far.
                props.onCommit(encodeEdit(valueOf(chosen)), "enter");
            } else {
                props.onCancel();
            }
            return;
        }
        if (event.key === "Delete" && !query) {
            event.preventDefault();
            commit([], "enter");
        }
    };

    return (
        <div
            ref={rootRef}
            className="mxgantt-fv-editor"
            onPointerDown={event => event.stopPropagation()}
            onClick={event => event.stopPropagation()}
            onDoubleClick={event => event.stopPropagation()}
            onBlur={event => {
                if (!settled.current && !rootRef.current?.contains(event.relatedTarget as Node | null)) {
                    commit(chosen, "blur");
                }
            }}
        >
            <div ref={anchorRef} className="mxgantt-fv-current">
                {chosen.length === 0 ? (
                    <span className="mxgantt-fv-placeholder">{texts.emptyValue}</span>
                ) : (
                    chosen.map(id => {
                        const option = optionOf(field, id);
                        return option ? <OptionChip key={id} option={option} /> : null;
                    })
                )}
            </div>
            <div className="mxgantt-popup mxgantt-fv-popup" style={place}>
                <label className="mxgantt-popup-search">
                    <FieldIcon name="search" />
                    <input
                        ref={searchRef}
                        type="text"
                        value={query}
                        placeholder={texts.selectSearch}
                        aria-label={props.label}
                        role="combobox"
                        aria-expanded="true"
                        aria-controls={listId}
                        aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
                        onChange={event => setQuery(event.target.value)}
                        onKeyDown={onKeyDown}
                    />
                </label>
                <div
                    id={listId}
                    role="listbox"
                    aria-multiselectable={multi || undefined}
                    className="mxgantt-fv-options"
                >
                    {options.length === 0 && <div className="mxgantt-popup-empty">{texts.noChoices}</div>}
                    {shown.map((option, index) => {
                        const selected = chosen.includes(option.id);
                        return (
                            <div
                                key={option.id}
                                id={`${listId}-${index}`}
                                role="option"
                                aria-selected={selected}
                                className={classNames("mxgantt-fv-option", { "is-active": index === active })}
                                onMouseDown={event => event.preventDefault()}
                                onMouseEnter={() => setActive(index)}
                                onClick={() => pick(option)}
                            >
                                {multi && (
                                    <span className={classNames("mxgantt-fv-check", { "is-on": selected })}>
                                        {selected && <FieldIcon name="check" />}
                                    </span>
                                )}
                                <OptionChip option={option} />
                                {!multi && selected && <FieldIcon name="check" className="mxgantt-fv-tick" />}
                            </div>
                        );
                    })}
                </div>
                <div className="mxgantt-popup-foot">
                    <button
                        type="button"
                        className="mxgantt-button mxgantt-button-quiet"
                        onMouseDown={event => event.preventDefault()}
                        onClick={() => commit([], "enter")}
                    >
                        {texts.clearValue}
                    </button>
                    {multi && (
                        <button
                            type="button"
                            className="mxgantt-button mxgantt-button-primary"
                            onMouseDown={event => event.preventDefault()}
                            onClick={() => commit(chosen, "enter")}
                        >
                            {texts.close}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

function CheckEditor(props: FieldEditorProps): ReactElement {
    const ref = useRef<HTMLButtonElement>(null);
    const settled = useRef(false);
    const [on, setOn] = useState(readValue(props.field, props.value) === true);
    useEffect(() => ref.current?.focus({ preventScroll: true }), []);
    const commit = (how: EditCommitHow, value = on): void => {
        settled.current = true;
        props.onCommit(encodeEdit(value), how);
    };
    return (
        <button
            ref={ref}
            type="button"
            role="checkbox"
            aria-checked={on}
            aria-label={props.label}
            className="mxgantt-fv-quick is-editing"
            onPointerDown={event => event.stopPropagation()}
            onClick={event => {
                event.stopPropagation();
                setOn(!on);
            }}
            onKeyDown={event => {
                event.stopPropagation();
                if (event.key === " ") {
                    event.preventDefault();
                    setOn(!on);
                    return;
                }
                const how = keyHow(event);
                if (how) {
                    event.preventDefault();
                    if (how === "cancel") {
                        settled.current = true;
                        props.onCancel();
                    } else {
                        commit(how);
                    }
                }
            }}
            onBlur={() => !settled.current && commit("blur")}
        >
            <span className={classNames("mxgantt-fv-check", { "is-on": on })} aria-hidden="true">
                {on && <FieldIcon name="check" />}
            </span>
        </button>
    );
}

function RatingEditor(props: FieldEditorProps): ReactElement {
    const { field, texts } = props;
    const max = field.max ?? 5;
    const ref = useRef<HTMLDivElement>(null);
    const settled = useRef(false);
    const [score, setScore] = useState(() => (readValue(field, props.value) as number | undefined) ?? 0);
    useEffect(() => ref.current?.focus({ preventScroll: true }), []);
    const commit = (how: EditCommitHow, value = score): void => {
        settled.current = true;
        props.onCommit(encodeEdit(value > 0 ? value : undefined), how);
    };
    return (
        <div
            ref={ref}
            tabIndex={0}
            role="slider"
            aria-label={props.label}
            aria-valuemin={0}
            aria-valuemax={max}
            aria-valuenow={score}
            aria-valuetext={fill(texts.rateValue, { n: score, max })}
            className="mxgantt-fv-rating is-editing"
            onPointerDown={event => event.stopPropagation()}
            onKeyDown={event => {
                event.stopPropagation();
                if (event.key === "ArrowRight" || event.key === "ArrowUp") {
                    event.preventDefault();
                    setScore(value => Math.min(max, value + 1));
                    return;
                }
                if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
                    event.preventDefault();
                    setScore(value => Math.max(0, value - 1));
                    return;
                }
                if (/^[0-9]$/.test(event.key)) {
                    event.preventDefault();
                    setScore(Math.min(max, Number(event.key)));
                    return;
                }
                const how = keyHow(event);
                if (how) {
                    event.preventDefault();
                    if (how === "cancel") {
                        settled.current = true;
                        props.onCancel();
                    } else {
                        commit(how);
                    }
                }
            }}
            onBlur={() => !settled.current && commit("blur")}
        >
            {Array.from({ length: max }, (_, index) => (
                <span
                    key={index}
                    className={classNames("mxgantt-fv-star", { "is-on": index < score })}
                    onClick={event => {
                        event.stopPropagation();
                        const next = index + 1 === score ? 0 : index + 1;
                        setScore(next);
                        commit("enter", next);
                    }}
                >
                    <FieldIcon name="rating" />
                </span>
            ))}
        </div>
    );
}

// ---------------------------------------------------------------- Add / Edit field popover

export interface FieldFormProps {
    texts: Texts;
    locale?: string;
    /** The field being edited; a new field when undefined. */
    field?: FieldDef;
    fields: FieldDef[];
    /** Every column title in the list (built-in, app and custom), to keep names unique. */
    takenNames: string[];
    /** Where to open: the header button's box. */
    anchor?: DOMRect;
    /** How many values a type change converts and clears. */
    conversion?: (to: FieldDef) => { converted: number; cleared: number };
    /** A task's numbers for the live formula preview. */
    sampleInputs?: Record<string, number | undefined>;
    onSubmit: (field: FieldDef) => void;
    onCancel: () => void;
}

const SAMPLE_VALUES: Partial<Record<FieldType, FieldValue>> = {
    text: "Northwind Ltd",
    number: 12500,
    date: "2026-11-30",
    checkbox: true,
    person: "Maya Patel",
    url: "https://example.com",
    rating: 4
};

export function FieldForm(props: FieldFormProps): ReactElement {
    const { texts, field: original, fields, onCancel } = props;
    const isNew = !original;
    const boxRef = useRef<HTMLFormElement>(null);
    const nameRef = useRef<HTMLInputElement>(null);
    const titleId = `${useId().replace(/[^a-zA-Z0-9_-]/g, "")}-title`;
    const others = fields.filter(entry => entry.key !== original?.key);
    const [draft, setDraft] = useState<FieldDef>(
        () => original ?? { key: "", name: "", type: "text", inTooltip: true }
    );
    const [formulaText, setFormulaText] = useState(() => toDisplayFormula(original?.formula ?? "", fields));
    const [touched, setTouched] = useState(false);
    const [paletteFor, setPaletteFor] = useState<number>();
    const set = (patch: Partial<FieldDef>): void => setDraft(current => ({ ...current, ...patch }));

    useEffect(() => {
        nameRef.current?.focus({ preventScroll: true });
    }, []);

    // Placement: under the anchor, moved up when a full-height form would not fit, kept inside the window.
    const place = useMemo<CSSProperties>(() => {
        const width = Math.min(400, window.innerWidth - 16);
        const height = Math.min(640, window.innerHeight - 16);
        const anchor = props.anchor;
        const left = anchor
            ? Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8))
            : (window.innerWidth - width) / 2;
        const top = anchor
            ? Math.max(8, Math.min(anchor.bottom + 6, window.innerHeight - height - 8))
            : Math.max(8, (window.innerHeight - height) / 2);
        return { position: "fixed", left, top, width, maxHeight: window.innerHeight - top - 8 };
    }, [props.anchor]);

    const name = draft.name.trim();
    const lower = name.toLowerCase();
    const nameTaken =
        !!name &&
        (others.some(entry => entry.name.trim().toLowerCase() === lower) ||
            props.takenNames.some(
                entry =>
                    entry.trim().toLowerCase() === lower && entry.trim().toLowerCase() !== original?.name.toLowerCase()
            ));
    const storedFormula = toStoredFormula(formulaText, others);
    const problem = draft.type === "formula" ? formulaProblem(storedFormula, others, draft.key || "__new") : undefined;
    const nameError = !name ? texts.nameRequired : nameTaken ? fill(texts.nameTaken, { name }) : undefined;
    const formulaError =
        problem === "empty"
            ? texts.formulaEmpty
            : problem === "syntax"
            ? texts.formulaSyntax
            : problem === "unknown"
            ? texts.formulaUnknown
            : problem === "self"
            ? texts.formulaSelf
            : problem === "text"
            ? texts.formulaText
            : undefined;
    const valid = !nameError && !formulaError;

    const result = (): FieldDef => {
        const options = hasOptions(draft.type)
            ? (draft.options ?? [])
                  .filter(option => option.label.trim())
                  .map(option => ({ ...option, label: option.label.trim() }))
            : undefined;
        const key =
            original?.key ??
            newFieldKey(
                name,
                fields.map(entry => entry.key)
            );
        const next = cleanField({
            ...draft,
            key,
            name,
            options,
            formula: draft.type === "formula" ? storedFormula : undefined,
            // A new type means new default width and alignment, unless the user set them.
            width: original && original.type === draft.type ? draft.width : undefined,
            align: original && original.type === draft.type ? draft.align : undefined
        });
        return next ?? { key, name, type: draft.type };
    };

    const conversion = useMemo(() => {
        if (!original || original.type === draft.type || !props.conversion) {
            return undefined;
        }
        return props.conversion({ ...draft, key: original.key });
    }, [original, draft, props]);

    const submit = (): void => {
        setTouched(true);
        if (valid) {
            props.onSubmit(result());
        } else {
            nameRef.current?.focus();
        }
    };

    const onKeyDown = (event: KeyboardEvent<HTMLFormElement>): void => {
        event.stopPropagation();
        if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
            return;
        }
        if (event.key === "Tab") {
            // Keep focus inside the popover.
            const focusable = Array.from(
                boxRef.current?.querySelectorAll<HTMLElement>(
                    "input:not([disabled]), button:not([disabled]), textarea, select, [tabindex='0']"
                ) ?? []
            ).filter(element => element.offsetParent !== null);
            if (focusable.length === 0) {
                return;
            }
            const index = focusable.indexOf(document.activeElement as HTMLElement);
            if (event.shiftKey && index <= 0) {
                event.preventDefault();
                focusable[focusable.length - 1].focus();
            } else if (!event.shiftKey && index === focusable.length - 1) {
                event.preventDefault();
                focusable[0].focus();
            }
        }
    };

    const options = draft.options ?? [];
    const setOption = (index: number, patch: Partial<FieldOption>): void =>
        set({ options: options.map((option, i) => (i === index ? { ...option, ...patch } : option)) });
    const addOption = (): void => {
        if (options.length >= MAX_OPTIONS) {
            return;
        }
        set({
            options: [
                ...options,
                { id: newOptionId(options.map(o => o.id)), label: "", color: OPTION_COLORS[options.length % 10] }
            ]
        });
        window.setTimeout(() => {
            const inputs = boxRef.current?.querySelectorAll<HTMLInputElement>(".mxgantt-ff-option-input");
            inputs?.[inputs.length - 1]?.focus();
        }, 0);
    };
    const moveOption = (index: number, step: number): void => {
        const target = index + step;
        if (target < 0 || target >= options.length) {
            return;
        }
        const next = [...options];
        [next[index], next[target]] = [next[target], next[index]];
        set({ options: next });
    };

    const setType = (type: FieldType): void => {
        const patch: Partial<FieldDef> = { type };
        if (hasOptions(type) && options.length === 0) {
            patch.options = ["", "", ""].map((_, index) => ({
                id: newOptionId(),
                label: "",
                color: OPTION_COLORS[[2, 3, 5][index]]
            }));
        }
        if (type === "rating" && !draft.max) {
            patch.max = 5;
        }
        set(patch);
    };

    const typeKeys = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
        const steps: Record<string, number> = { ArrowRight: 1, ArrowDown: 2, ArrowLeft: -1, ArrowUp: -2 };
        if (!(event.key in steps)) {
            return;
        }
        event.preventDefault();
        const next = (index + steps[event.key] + FIELD_TYPES.length) % FIELD_TYPES.length;
        setType(FIELD_TYPES[next].type);
        boxRef.current?.querySelectorAll<HTMLButtonElement>(".mxgantt-ff-type")[next]?.focus();
    };

    const formulaChoices = [
        ...Object.keys(BUILTIN_REFS).map(key => ({
            key,
            label:
                key === "_duration"
                    ? texts.builtinDuration
                    : key === "_progress"
                    ? texts.builtinDone
                    : texts.builtinCost
        })),
        ...others
            .filter(entry => ["number", "rating", "checkbox", "date", "select"].includes(entry.type))
            .map(entry => ({ key: entry.key, label: entry.name }))
    ];
    const insertRef = (label: string): void => {
        setFormulaText(current => `${current}${current && !current.endsWith(" ") ? " " : ""}[${label}]`);
    };

    const preview = result();
    const sampleValue: FieldValue | undefined = hasOptions(preview.type)
        ? preview.options?.length
            ? preview.type === "multi"
                ? preview.options.slice(0, 2).map(option => option.id)
                : preview.options[0].id
            : undefined
        : preview.type === "number" && preview.format === "percent"
        ? 65
        : SAMPLE_VALUES[preview.type];
    const sampleComputed =
        preview.type === "formula" && !problem
            ? evaluateFormula(
                  storedFormula,
                  props.sampleInputs ?? formulaInputs(others, {}, { _duration: 5, _progress: 40, _cost: 1000 })
              )
            : undefined;

    const number = draft.type === "number" || draft.type === "formula";
    return (
        <div
            className="mxgantt-popover-layer"
            onPointerDown={event => event.target === event.currentTarget && onCancel()}
        >
            <form
                ref={boxRef}
                className="mxgantt-popover mxgantt-ff"
                style={place}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                onKeyDown={onKeyDown}
                onSubmit={event => {
                    event.preventDefault();
                    submit();
                }}
            >
                <div className="mxgantt-ff-head">
                    <h2 id={titleId} className="mxgantt-ff-title">
                        {isNew ? texts.addFieldTitle : texts.editFieldTitle}
                    </h2>
                    <button type="button" className="mxgantt-iconbutton" aria-label={texts.close} onClick={onCancel}>
                        <FieldIcon name="close" />
                    </button>
                </div>
                <div className="mxgantt-ff-body">
                    <label className="mxgantt-ff-label" htmlFor={`${titleId}-name`}>
                        {texts.fieldName}
                    </label>
                    <input
                        id={`${titleId}-name`}
                        ref={nameRef}
                        className="mxgantt-ff-input"
                        type="text"
                        value={draft.name}
                        maxLength={MAX_NAME}
                        placeholder={texts.fieldNamePlaceholder}
                        aria-invalid={touched && !!nameError ? true : undefined}
                        aria-describedby={touched && nameError ? `${titleId}-name-error` : undefined}
                        onChange={event => set({ name: event.target.value })}
                        onBlur={() => name && setTouched(true)}
                    />
                    {touched && nameError && (
                        <span id={`${titleId}-name-error`} className="mxgantt-ff-error" role="alert">
                            {nameError}
                        </span>
                    )}

                    <span className="mxgantt-ff-label" id={`${titleId}-type`}>
                        {texts.fieldType}
                    </span>
                    <div className="mxgantt-ff-types" role="radiogroup" aria-labelledby={`${titleId}-type`}>
                        {FIELD_TYPES.map((info, index) => (
                            <button
                                key={info.type}
                                type="button"
                                role="radio"
                                aria-checked={draft.type === info.type}
                                tabIndex={draft.type === info.type ? 0 : -1}
                                className="mxgantt-ff-type"
                                onClick={() => setType(info.type)}
                                onKeyDown={event => typeKeys(event, index)}
                            >
                                <FieldIcon name={info.icon} />
                                {typeLabel(texts, info.type)}
                            </button>
                        ))}
                    </div>
                    <p className="mxgantt-ff-help">{texts[TYPE_TEXT[draft.type].help]}</p>

                    {hasOptions(draft.type) && (
                        <fieldset className="mxgantt-ff-group">
                            <legend className="mxgantt-ff-label">{texts.fieldOptions}</legend>
                            <ul className="mxgantt-ff-options">
                                {options.map((option, index) => {
                                    const label = option.label || texts.optionPlaceholder;
                                    return (
                                        <li key={option.id} className="mxgantt-ff-option">
                                            <button
                                                type="button"
                                                className="mxgantt-swatchbutton"
                                                style={chipStyle(option.color)}
                                                aria-label={fill(texts.optionColor, { name: label })}
                                                aria-expanded={paletteFor === index}
                                                onClick={() => setPaletteFor(paletteFor === index ? undefined : index)}
                                            />
                                            <input
                                                className="mxgantt-ff-input mxgantt-ff-option-input"
                                                type="text"
                                                value={option.label}
                                                maxLength={MAX_NAME}
                                                placeholder={texts.optionPlaceholder}
                                                aria-label={texts.optionPlaceholder}
                                                onChange={event => setOption(index, { label: event.target.value })}
                                                onKeyDown={event => {
                                                    if (event.key === "Enter") {
                                                        event.preventDefault();
                                                        addOption();
                                                    }
                                                }}
                                            />
                                            <button
                                                type="button"
                                                className="mxgantt-iconbutton"
                                                aria-label={fill(texts.moveOptionUp, { name: label })}
                                                disabled={index === 0}
                                                onClick={() => moveOption(index, -1)}
                                            >
                                                <FieldIcon name="up" />
                                            </button>
                                            <button
                                                type="button"
                                                className="mxgantt-iconbutton"
                                                aria-label={fill(texts.moveOptionDown, { name: label })}
                                                disabled={index === options.length - 1}
                                                onClick={() => moveOption(index, 1)}
                                            >
                                                <FieldIcon name="down" />
                                            </button>
                                            <button
                                                type="button"
                                                className="mxgantt-iconbutton is-danger"
                                                aria-label={fill(texts.removeOption, { name: label })}
                                                onClick={() => set({ options: options.filter((_, i) => i !== index) })}
                                            >
                                                <FieldIcon name="trash" />
                                            </button>
                                            {paletteFor === index && (
                                                <div
                                                    className="mxgantt-palette"
                                                    role="group"
                                                    aria-label={fill(texts.optionColor, { name: label })}
                                                >
                                                    {OPTION_COLORS.map(color => (
                                                        <button
                                                            key={color}
                                                            type="button"
                                                            className="mxgantt-palette-swatch"
                                                            style={chipStyle(color)}
                                                            aria-label={color}
                                                            aria-pressed={option.color === color}
                                                            onClick={() => {
                                                                setOption(index, { color });
                                                                setPaletteFor(undefined);
                                                            }}
                                                        />
                                                    ))}
                                                </div>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                            <button
                                type="button"
                                className="mxgantt-button mxgantt-button-quiet mxgantt-ff-addoption"
                                disabled={options.length >= MAX_OPTIONS}
                                onClick={addOption}
                            >
                                <FieldIcon name="plus" />
                                {texts.addOption}
                            </button>
                        </fieldset>
                    )}

                    {number && (
                        <div className="mxgantt-ff-row">
                            <div>
                                <span className="mxgantt-ff-label">{texts.numberFormat}</span>
                                <div className="mxgantt-segment" role="group" aria-label={texts.numberFormat}>
                                    {(["plain", "currency", "percent"] as NumberFormat[]).map(format => (
                                        <button
                                            key={format}
                                            type="button"
                                            className="mxgantt-button"
                                            aria-pressed={(draft.format ?? "plain") === format}
                                            onClick={() =>
                                                set({
                                                    format,
                                                    currency:
                                                        format === "currency"
                                                            ? draft.currency || "EUR"
                                                            : draft.currency,
                                                    decimals: draft.decimals ?? (format === "currency" ? 2 : 0)
                                                })
                                            }
                                        >
                                            {format === "plain"
                                                ? texts.formatPlain
                                                : format === "currency"
                                                ? texts.formatCurrency
                                                : texts.formatPercent}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <span className="mxgantt-ff-label">{texts.decimals}</span>
                                <div className="mxgantt-stepper">
                                    <button
                                        type="button"
                                        className="mxgantt-iconbutton"
                                        aria-label={`${texts.decimals} -`}
                                        onClick={() => set({ decimals: Math.max(0, (draft.decimals ?? 0) - 1) })}
                                    >
                                        −
                                    </button>
                                    <output aria-live="polite">
                                        {draft.decimals ?? (draft.format === "currency" ? 2 : 0)}
                                    </output>
                                    <button
                                        type="button"
                                        className="mxgantt-iconbutton"
                                        aria-label={`${texts.decimals} +`}
                                        onClick={() => set({ decimals: Math.min(6, (draft.decimals ?? 0) + 1) })}
                                    >
                                        +
                                    </button>
                                </div>
                            </div>
                            {draft.format === "currency" && (
                                <div>
                                    <label className="mxgantt-ff-label" htmlFor={`${titleId}-currency`}>
                                        {texts.currencyCode}
                                    </label>
                                    <input
                                        id={`${titleId}-currency`}
                                        className="mxgantt-ff-input mxgantt-ff-short"
                                        type="text"
                                        maxLength={3}
                                        value={draft.currency ?? ""}
                                        onChange={event => set({ currency: event.target.value.toUpperCase() })}
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    {draft.type === "rating" && (
                        <div>
                            <span className="mxgantt-ff-label">{texts.ratingMax}</span>
                            <div className="mxgantt-segment" role="group" aria-label={texts.ratingMax}>
                                {[3, 5, 10].map(max => (
                                    <button
                                        key={max}
                                        type="button"
                                        className="mxgantt-button"
                                        aria-pressed={(draft.max ?? 5) === max}
                                        onClick={() => set({ max })}
                                    >
                                        {max}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {draft.type === "formula" && (
                        <div className="mxgantt-ff-formula">
                            <label className="mxgantt-ff-label" htmlFor={`${titleId}-formula`}>
                                {texts.formula}
                            </label>
                            <textarea
                                id={`${titleId}-formula`}
                                className="mxgantt-ff-input mxgantt-ff-code"
                                rows={2}
                                value={formulaText}
                                spellCheck={false}
                                aria-invalid={touched && !!formulaError ? true : undefined}
                                aria-describedby={`${titleId}-formula-help`}
                                onChange={event => setFormulaText(event.target.value)}
                            />
                            <p id={`${titleId}-formula-help`} className="mxgantt-ff-help">
                                {texts.formulaHelp}
                            </p>
                            <div className="mxgantt-ff-refs" role="group" aria-label={texts.formulaInsert}>
                                {formulaChoices.map(choice => (
                                    <button
                                        key={choice.key}
                                        type="button"
                                        className="mxgantt-button mxgantt-button-quiet mxgantt-ff-ref"
                                        onClick={() => insertRef(choice.label)}
                                    >
                                        [{choice.label}]
                                    </button>
                                ))}
                            </div>
                            {(touched || formulaText) && formulaError && (
                                <span className="mxgantt-ff-error" role="alert">
                                    {formulaError}
                                </span>
                            )}
                        </div>
                    )}

                    <div className="mxgantt-ff-switches">
                        <label className="mxgantt-switch">
                            <input
                                type="checkbox"
                                checked={!!draft.onBar}
                                onChange={event => set({ onBar: event.target.checked || undefined })}
                            />
                            <span className="mxgantt-switch-track" aria-hidden="true" />
                            {texts.showOnBar}
                        </label>
                        <label className="mxgantt-switch">
                            <input
                                type="checkbox"
                                checked={draft.inTooltip !== false}
                                onChange={event => set({ inTooltip: event.target.checked ? undefined : false })}
                            />
                            <span className="mxgantt-switch-track" aria-hidden="true" />
                            {texts.showInTooltip}
                        </label>
                    </div>

                    <label className="mxgantt-ff-label" htmlFor={`${titleId}-description`}>
                        {texts.fieldDescription}
                    </label>
                    <input
                        id={`${titleId}-description`}
                        className="mxgantt-ff-input"
                        type="text"
                        maxLength={200}
                        value={draft.description ?? ""}
                        placeholder={texts.fieldDescriptionPlaceholder}
                        onChange={event => set({ description: event.target.value })}
                    />

                    <div className="mxgantt-ff-preview" aria-label={texts.fieldPreview} role="group">
                        <span className="mxgantt-ff-label">{texts.fieldPreview}</span>
                        <div className="mxgantt-ff-preview-cell">
                            <div className="mxgantt-ff-preview-head">
                                <FieldIcon name={typeInfo(preview.type).icon} />
                                {preview.name || texts.fieldNamePlaceholder}
                            </div>
                            <div
                                className="mxgantt-ff-preview-value"
                                style={{ textAlign: typeInfo(preview.type).align }}
                            >
                                <FieldCell
                                    field={preview}
                                    value={sampleValue}
                                    computed={sampleComputed}
                                    texts={texts}
                                    locale={props.locale}
                                />
                            </div>
                        </div>
                    </div>

                    {conversion && (
                        <p
                            className={classNames("mxgantt-ff-note", { "is-warning": conversion.cleared > 0 })}
                            role="status"
                        >
                            {conversion.converted + conversion.cleared === 0
                                ? texts.conversionNone
                                : fill(texts.conversionNote, conversion)}
                        </p>
                    )}
                </div>
                <div className="mxgantt-ff-foot">
                    <button type="button" className="mxgantt-button" onClick={onCancel}>
                        {texts.cancel}
                    </button>
                    <button
                        type="submit"
                        className="mxgantt-button mxgantt-button-primary"
                        aria-disabled={!valid || undefined}
                    >
                        {isNew ? texts.createField : texts.saveField}
                    </button>
                </div>
            </form>
        </div>
    );
}

// ---------------------------------------------------------------- column chooser

export interface ChooserColumn {
    key: string;
    title: string;
    visible: boolean;
    /** The task name cannot be hidden. */
    locked?: boolean;
    kind: "plan" | "app" | "custom";
    icon?: string;
}

export interface ColumnsPanelProps {
    id: string;
    texts: Texts;
    columns: ChooserColumn[];
    onToggle: (key: string) => void;
    onMove: (key: string, toIndex: number) => void;
    onShowAll: () => void;
    onReset: () => void;
    onAddField?: () => void;
    onClose: (restoreFocus: boolean) => void;
}

/** The Columns panel: search, show / hide, drag (or Alt + arrows) to reorder, show all, reset, add a field. */
export function ColumnsPanel(props: ColumnsPanelProps): ReactElement {
    const { texts, columns, onClose, id } = props;
    const rootRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLUListElement>(null);
    const [query, setQuery] = useState("");
    const [drag, setDrag] = useState<{ key: string; over: number; y0: number; moved: boolean }>();
    const [announcement, setAnnouncement] = useState("");
    const searching = query.trim() !== "";
    const shown = searching
        ? columns.filter(column => column.title.toLowerCase().includes(query.trim().toLowerCase()))
        : columns;

    useEffect(() => {
        rootRef.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    }, []);
    useEffect(() => {
        const onDown = (event: PointerEvent): void => {
            const owner = document.querySelector(`[aria-controls="${id}"]`);
            if (owner?.contains(event.target as Node)) {
                return;
            }
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
                onClose(false);
            }
        };
        document.addEventListener("pointerdown", onDown, true);
        return () => document.removeEventListener("pointerdown", onDown, true);
    }, [onClose, id]);

    const move = (key: string, to: number): void => {
        const column = columns.find(entry => entry.key === key);
        props.onMove(key, to);
        if (column) {
            setAnnouncement(fill(texts.columnMoved, { name: column.title, n: to + 1 }));
        }
        window.setTimeout(() => {
            listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"] input`)?.focus();
        }, 0);
    };

    const overIndex = (clientY: number): number => {
        const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>("li[data-key]") ?? []);
        for (let i = 0; i < items.length; i++) {
            const box = items[i].getBoundingClientRect();
            if (clientY < box.top + box.height / 2) {
                return i;
            }
        }
        return items.length;
    };
    const onHandleDown = (event: ReactPointerEvent<HTMLSpanElement>, key: string): void => {
        if (searching) {
            return;
        }
        event.preventDefault();
        try {
            event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
            // Synthetic events have nothing to capture.
        }
        setDrag({ key, over: columns.findIndex(column => column.key === key), y0: event.clientY, moved: false });
    };
    const onHandleMove = (event: ReactPointerEvent<HTMLSpanElement>): void => {
        if (!drag) {
            return;
        }
        const moved = drag.moved || Math.abs(event.clientY - drag.y0) > 3;
        setDrag({ ...drag, moved, over: overIndex(event.clientY) });
    };
    const onHandleUp = (): void => {
        if (drag?.moved) {
            const from = columns.findIndex(column => column.key === drag.key);
            const to = drag.over > from ? drag.over - 1 : drag.over;
            if (to !== from) {
                move(drag.key, to);
            }
        }
        setDrag(undefined);
    };

    const kindText = (column: ChooserColumn): string =>
        column.kind === "custom" ? texts.columnsCustom : column.kind === "app" ? texts.columnsApp : texts.columnsPlan;

    return (
        <div
            id={id}
            ref={rootRef}
            className="mxgantt-popover mxgantt-columns"
            role="dialog"
            aria-label={texts.columnsTitle}
            onKeyDown={event => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    onClose(true);
                }
            }}
        >
            <label className="mxgantt-popup-search">
                <FieldIcon name="search" />
                <input
                    type="search"
                    value={query}
                    placeholder={texts.columnsSearch}
                    aria-label={texts.columnsSearch}
                    onChange={event => setQuery(event.target.value)}
                />
            </label>
            <p className="mxgantt-columns-hint">{texts.columnsHint}</p>
            <ul ref={listRef} className={classNames("mxgantt-columns-list", { "is-dragging": drag?.moved })}>
                {shown.map((column, index) => (
                    <li
                        key={column.key}
                        data-key={column.key}
                        className={classNames("mxgantt-columns-item", {
                            "is-hidden": !column.visible,
                            "is-dragged": drag?.moved && drag.key === column.key,
                            "is-drop-before": drag?.moved && !searching && drag.over === index,
                            "is-drop-after":
                                drag?.moved && !searching && drag.over === shown.length && index === shown.length - 1
                        })}
                    >
                        <span
                            className={classNames("mxgantt-columns-handle", { "is-disabled": searching })}
                            aria-hidden="true"
                            title={fill(texts.dragColumn, { name: column.title })}
                            onPointerDown={event => onHandleDown(event, column.key)}
                            onPointerMove={onHandleMove}
                            onPointerUp={onHandleUp}
                            onPointerCancel={() => setDrag(undefined)}
                        >
                            <FieldIcon name="drag" />
                        </span>
                        <label className="mxgantt-columns-label">
                            <input
                                type="checkbox"
                                checked={column.visible}
                                disabled={column.locked}
                                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                                onChange={() => {
                                    props.onToggle(column.key);
                                    setAnnouncement(
                                        fill(column.visible ? texts.columnHidden : texts.columnShown, {
                                            name: column.title
                                        })
                                    );
                                }}
                                onKeyDown={event => {
                                    if (
                                        event.altKey &&
                                        (event.key === "ArrowUp" || event.key === "ArrowDown") &&
                                        !searching
                                    ) {
                                        event.preventDefault();
                                        const from = columns.findIndex(entry => entry.key === column.key);
                                        const to = from + (event.key === "ArrowUp" ? -1 : 1);
                                        if (to >= 0 && to < columns.length) {
                                            move(column.key, to);
                                        }
                                    }
                                }}
                            />
                            {column.icon && <FieldIcon name={column.icon} />}
                            <span className="mxgantt-columns-title">{column.title}</span>
                        </label>
                        {column.kind !== "plan" && <span className="mxgantt-columns-kind">{kindText(column)}</span>}
                    </li>
                ))}
            </ul>
            <div className="mxgantt-popup-foot">
                <button type="button" className="mxgantt-button mxgantt-button-quiet" onClick={props.onShowAll}>
                    {texts.columnsShowAll}
                </button>
                <button type="button" className="mxgantt-button mxgantt-button-quiet" onClick={props.onReset}>
                    {texts.columnsReset}
                </button>
                {props.onAddField && (
                    <button
                        type="button"
                        className="mxgantt-button mxgantt-button-primary mxgantt-columns-add"
                        onClick={props.onAddField}
                    >
                        <FieldIcon name="plus" />
                        {texts.addField}
                    </button>
                )}
            </div>
            <span className="mxgantt-sr" role="status" aria-live="polite">
                {announcement}
            </span>
        </div>
    );
}

// ---------------------------------------------------------------- first-time hint

export function FieldsHint(props: {
    texts: Texts;
    onAdd: () => void;
    onDismiss: () => void;
    style?: CSSProperties;
}): ReactNode {
    const { texts } = props;
    return (
        <div className="mxgantt-fields-hint" role="note" style={props.style}>
            <span className="mxgantt-fields-hint-icon" aria-hidden="true">
                <FieldIcon name="sparkle" />
            </span>
            <div className="mxgantt-fields-hint-text">
                <strong>{texts.hintTitle}</strong>
                <span>{texts.hintBody}</span>
            </div>
            <div className="mxgantt-fields-hint-actions">
                <button type="button" className="mxgantt-button mxgantt-button-primary" onClick={props.onAdd}>
                    {texts.hintAction}
                </button>
                <button type="button" className="mxgantt-button mxgantt-button-quiet" onClick={props.onDismiss}>
                    {texts.hintDismiss}
                </button>
            </div>
        </div>
    );
}
