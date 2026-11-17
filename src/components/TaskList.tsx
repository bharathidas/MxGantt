import classNames from "classnames";
import {
    CSSProperties,
    KeyboardEvent,
    PointerEvent,
    ReactElement,
    ReactNode,
    Ref,
    UIEvent,
    useEffect,
    useId,
    useRef,
    useState
} from "react";

import { FieldDef, FieldValue } from "../utils/fields";
import { CellOption, LayoutColumn, SortState } from "../utils/layout";
import { HEADER_HEIGHT } from "../utils/geometry";
import { Row, Task } from "../utils/tasks";
import { fill, Texts } from "../utils/texts";
import { FieldIcon, FieldValueEditor } from "./CustomFields";
import { Menu, MenuItem } from "./Menu";

export type EditKind = "text" | "date" | "datetime" | "number" | "field" | "select";

export interface ListColumn {
    key: string;
    title: string;
    width: number;
    align: "left" | "right" | "center";
    text: (row: Row) => string;
    /** The value for CSV export when it differs from the text, such as ISO dates and plain numbers. */
    csv?: (row: Row) => string | number;
    /** Set on columns that can be edited in the list. */
    edit?: {
        kind: EditKind;
        value: (task: Task) => string;
        /** 1.2: the choices of a select editor (Enumeration and Boolean attributes). */
        options?: CellOption[];
        /** 1.2: numbers below zero are allowed. */
        signed?: boolean;
    };
    /** 1.1: rich cell content (custom fields); quick is set when a click may change the value. */
    render?: (row: Row, quick?: (value: FieldValue | undefined) => void) => ReactNode;
    /** 1.1: the custom field behind the column. */
    field?: FieldDef;
    /** 1.1: the value an editor of a custom field starts with, and suggestions while typing. */
    fieldValue?: (task: Task) => FieldValue | undefined;
    suggestions?: () => string[];
    /** 1.1: a small type icon in the header, and the header's tooltip. */
    icon?: string;
    hint?: string;
    /** 1.2 configured columns: the smallest width when resizing, sharing the free width, wrapping text. */
    minWidth?: number;
    fill?: boolean;
    wrap?: boolean;
    /** False keeps the column visible (Task name, and columns set to Users can hide = No). */
    hideable?: boolean;
    /** Users can sort the tasks by this column. */
    sortable?: boolean;
    /** The Columns item behind the column. */
    layout?: LayoutColumn;
    /** The Dynamic cell class of a cell. */
    cellClass?: (row: Row) => string | undefined;
}

export type CommitHow = "enter" | "next" | "previous" | "blur";

export interface EditingCell {
    rowId: string;
    column: string;
    error?: string;
}

export interface TaskListProps {
    texts: Texts;
    rows: Row[];
    columns: ListColumn[];
    width: number;
    rowHeight: number;
    first: number;
    last: number;
    /** Rows drawn although they are scrolled out of view, such as the one being edited. */
    extraRows: number[];
    /** Extra space under the rows, matching the timeline's horizontal scrollbar, so both panes scroll equally far. */
    bottomPad: number;
    focusedId?: string;
    bodyNode: Ref<HTMLDivElement>;
    onScroll: (event: UIEvent<HTMLDivElement>) => void;
    /** onEditableCell: the click landed on a cell that can be edited (a double-click there edits it). */
    onRowClick: (row: Row, onEditableCell?: boolean) => void;
    onToggle: (id: string) => void;
    colorOf: (row: Row) => string | undefined;
    editing?: EditingCell;
    canEdit: (row: Row, column: ListColumn) => boolean;
    onStartEdit: (row: Row, column: string) => void;
    /** Returns an error message, or undefined when the value was accepted. */
    onCommitEdit: (value: string, how: CommitHow) => void;
    onCancelEdit: () => void;
    /** Set when columns can be resized. */
    onResize?: (column: string, width: number) => void;
    /** 1.1: the header menu of a column (custom field options, hide); none when undefined or empty. */
    headerMenu?: (column: ListColumn) => MenuItem[] | undefined;
    onHeaderMenu?: (column: string, item: string) => void;
    /** 1.1: the + at the end of the header row that adds a custom field. */
    onAddField?: (anchor: DOMRect) => void;
    /** 1.1: a click on a checkbox or star changes the value without opening an editor. */
    onQuickEdit?: (row: Row, column: string, value: FieldValue | undefined) => void;
    /** 1.1: dragging a header moves the column before another one (undefined: to the end). */
    onReorder?: (column: string, before: string | undefined) => void;
    /** 1.1: shown under the header, such as the first-time custom fields hint. */
    headerExtra?: ReactNode;
    /** 1.2: the current sort, and what a click on a sortable header does. */
    sort?: SortState;
    onSort?: (column: string) => void;
}

const ADD_WIDTH = 40;

interface EditorProps {
    kind: EditKind;
    initial: string;
    options?: CellOption[];
    signed?: boolean;
    label: string;
    error?: string;
    align: ListColumn["align"];
    onCommit: (value: string, how: CommitHow) => void;
    onCancel: () => void;
}

function CellEditor(props: EditorProps): ReactElement {
    const inputRef = useRef<HTMLInputElement & HTMLSelectElement>(null);
    const settled = useRef(false);
    const errorId = `${useId().replace(/[^a-zA-Z0-9_-]/g, "")}-error`;
    const { error } = props;

    useEffect(() => {
        const input = inputRef.current;
        if (input) {
            input.focus({ preventScroll: true });
            if (
                input.tagName === "INPUT" &&
                (input.type === ("text" as string) || input.type === ("number" as string))
            ) {
                (input as HTMLInputElement).select();
            }
        }
    }, []);
    // A refused value leaves the editor open for another try.
    useEffect(() => {
        if (error) {
            settled.current = false;
            inputRef.current?.focus({ preventScroll: true });
        }
    }, [error]);

    const finish = (how: CommitHow): void => {
        settled.current = true;
        props.onCommit(inputRef.current?.value ?? "", how);
    };
    const onKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>): void => {
        event.stopPropagation();
        if (event.key === "Enter") {
            event.preventDefault();
            finish("enter");
        } else if (event.key === "Tab") {
            event.preventDefault();
            finish(event.shiftKey ? "previous" : "next");
        } else if (event.key === "Escape") {
            event.preventDefault();
            settled.current = true;
            props.onCancel();
        }
    };
    const type = props.kind === "datetime" ? "datetime-local" : props.kind;
    const shared = {
        className: "mxgantt-editor",
        "aria-label": props.label,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": error ? errorId : undefined,
        style: { textAlign: props.align },
        onKeyDown,
        onPointerDown: (event: PointerEvent<HTMLElement>) => event.stopPropagation(),
        onClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
        onDoubleClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
        onBlur: () => {
            if (!settled.current) {
                finish("blur");
            }
        }
    };
    return (
        <>
            {props.kind === "select" ? (
                // 1.2: Enumeration and Boolean attributes; picking a value saves it.
                <select ref={inputRef} defaultValue={props.initial} {...shared} onChange={() => finish("enter")}>
                    {!props.options?.some(option => option.value === props.initial) && (
                        <option value={props.initial}>{props.initial}</option>
                    )}
                    {props.options?.map(option => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
            ) : (
                <input
                    ref={inputRef}
                    type={type}
                    defaultValue={props.initial}
                    min={props.kind === "number" && !props.signed ? 0 : undefined}
                    step={props.kind === "number" && props.signed ? "any" : undefined}
                    {...shared}
                />
            )}
            {error && (
                <span
                    id={errorId}
                    className={classNames("mxgantt-editor-error", { "is-right": props.align === "right" })}
                    role="alert"
                >
                    {error}
                </span>
            )}
        </>
    );
}

const MIN_COLUMN = 40;
const MAX_COLUMN = 800;

/**
 * The task list left of the timeline. It is a table for screen readers, but its rows are not tab
 * stops: keyboard users work on the bars, which carry the same information in their labels, and
 * press F2 on a bar to edit its row here.
 */
export function TaskList(props: TaskListProps): ReactElement {
    const { rows, columns, rowHeight: rh, texts, bodyNode, onScroll, editing } = props;
    const headRef = useRef<HTMLDivElement>(null);
    const resizeDrag = useRef<{ key: string; x0: number; width0: number } | null>(null);
    const headDrag = useRef<{ key: string; x0: number; pointerId: number } | null>(null);
    // A header that was just dragged is not also sorted by the click that ends the drag.
    const justDragged = useRef(false);
    const [dragging, setDragging] = useState<{ key: string; x: number; before?: string }>();
    const [headMenu, setHeadMenu] = useState<{ key: string; x: number; y: number }>();
    const menuId = `${useId().replace(/[^a-zA-Z0-9_-]/g, "")}-colmenu`;
    const addWidth = props.onAddField ? ADD_WIDTH : 0;
    const totalWidth = columns.reduce((sum, column) => sum + column.width, 0) + addWidth;

    const indexes: number[] = [];
    for (let index = props.first; index < props.last; index++) {
        indexes.push(index);
    }
    props.extraRows.forEach(index => {
        if ((index < props.first || index >= props.last) && index >= 0 && index < rows.length) {
            indexes.push(index);
        }
    });

    const visible = indexes.map(index => {
        const row = rows[index];
        const style: CSSProperties = { top: index * rh, height: rh, width: Math.max(totalWidth, props.width) };
        const isGroup = row.kind === "group";
        return (
            <div
                key={row.id}
                role="row"
                aria-rowindex={index + 2}
                aria-level={isGroup ? (row.level ?? 0) + 1 : row.depth + 1}
                className={classNames("mxgantt-list-row", {
                    "mxgantt-list-group": isGroup,
                    "mxgantt-list-project": isGroup && row.project,
                    "is-odd": index % 2 === 1,
                    "is-focused": row.id === props.focusedId
                })}
                style={style}
                onClick={event =>
                    props.onRowClick(row, !!(event.target as HTMLElement).closest?.(".mxgantt-cell.is-editable"))
                }
            >
                {columns.map(column => {
                    const isEditing = editing?.rowId === row.id && editing.column === column.key;
                    const editable = row.kind === "task" && !!column.edit && props.canEdit(row, column);
                    const onDoubleClick = editable
                        ? () => {
                              props.onStartEdit(row, column.key);
                          }
                        : undefined;
                    if (isEditing && row.kind === "task" && column.edit && column.field) {
                        return (
                            <div
                                key={column.key}
                                role="cell"
                                className={classNames("mxgantt-cell", "mxgantt-cell-field", "is-editing")}
                                style={{ width: column.width }}
                            >
                                <FieldValueEditor
                                    field={column.field}
                                    value={column.fieldValue?.(row.task)}
                                    texts={texts}
                                    label={fill(texts.editCell, { column: column.title, name: row.task.name })}
                                    align={column.align}
                                    suggestions={column.suggestions?.()}
                                    onCommit={props.onCommitEdit}
                                    onCancel={props.onCancelEdit}
                                />
                            </div>
                        );
                    }
                    if (isEditing && row.kind === "task" && column.edit) {
                        return (
                            <div
                                key={column.key}
                                role={column.key === "name" ? "rowheader" : "cell"}
                                className={classNames("mxgantt-cell", `mxgantt-cell-${column.key}`, "is-editing")}
                                style={{ width: column.width }}
                            >
                                <CellEditor
                                    kind={column.edit.kind}
                                    initial={column.edit.value(row.task)}
                                    options={column.edit.options}
                                    signed={column.edit.signed}
                                    label={fill(texts.editCell, { column: column.title, name: row.task.name })}
                                    error={editing.error}
                                    align={column.align}
                                    onCommit={props.onCommitEdit}
                                    onCancel={props.onCancelEdit}
                                />
                            </div>
                        );
                    }
                    if (column.render) {
                        const quick =
                            editable && props.onQuickEdit
                                ? (value: FieldValue | undefined) => props.onQuickEdit!(row, column.key, value)
                                : undefined;
                        return (
                            <div
                                key={column.key}
                                role="cell"
                                className={classNames("mxgantt-cell", "mxgantt-cell-field", {
                                    "is-editable": editable
                                })}
                                style={{ width: column.width, textAlign: column.align }}
                                onDoubleClick={onDoubleClick}
                            >
                                {row.kind === "task" ? column.render(row, quick) : column.text(row)}
                            </div>
                        );
                    }
                    if (column.key !== "name") {
                        const text = column.text(row);
                        return (
                            <div
                                key={column.key}
                                role="cell"
                                className={classNames(
                                    "mxgantt-cell",
                                    `mxgantt-cell-${column.key}`,
                                    {
                                        "is-editable": editable,
                                        "is-negative": column.key === "variance" && text.startsWith("-"),
                                        "is-positive": column.key === "variance" && text.startsWith("+"),
                                        "is-wrap": column.wrap,
                                        "has-class": !!column.cellClass?.(row),
                                        "is-total": isGroup && !!column.layout && !!text
                                    },
                                    column.cellClass?.(row)
                                )}
                                style={{ width: column.width, textAlign: column.align }}
                                title={column.layout && text && !column.wrap ? text : undefined}
                                onDoubleClick={onDoubleClick}
                            >
                                {column.wrap ? <span className="mxgantt-wrap">{text}</span> : text}
                            </div>
                        );
                    }
                    const indent = row.kind === "task" ? 8 + row.depth * 18 : 4 + (row.level ?? 0) * 18;
                    const color = props.colorOf(row);
                    return (
                        <div
                            key={column.key}
                            role="rowheader"
                            className={classNames("mxgantt-cell mxgantt-cell-name", { "is-editable": editable })}
                            style={{ width: column.width, paddingLeft: indent }}
                            title={column.text(row)}
                            onDoubleClick={onDoubleClick}
                        >
                            {row.kind === "group" ? (
                                <button
                                    type="button"
                                    tabIndex={-1}
                                    className="mxgantt-toggle"
                                    aria-expanded={!row.collapsed}
                                    aria-label={fill(row.collapsed ? texts.expandGroup : texts.collapseGroup, {
                                        name: row.name
                                    })}
                                    onClick={event => {
                                        event.stopPropagation();
                                        props.onToggle(row.id);
                                    }}
                                >
                                    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                                        <path d={row.collapsed ? "M6 4l4 4-4 4" : "M4 6l4 4 4-4"} />
                                    </svg>
                                </button>
                            ) : (
                                <span
                                    className={classNames("mxgantt-swatch", { "is-milestone": row.task.milestone })}
                                    style={color ? { background: color } : undefined}
                                    aria-hidden="true"
                                />
                            )}
                            {row.kind === "task" && (row.task.code || row.task.subtitle) ? (
                                // 1.3: code before the name, a second line under it.
                                <span className="mxgantt-name-block">
                                    <span className="mxgantt-name-line">
                                        {row.task.code && <span className="mxgantt-code">{row.task.code}</span>}
                                        <span className="mxgantt-name">{column.text(row)}</span>
                                    </span>
                                    {row.task.subtitle && <span className="mxgantt-subtitle">{row.task.subtitle}</span>}
                                </span>
                            ) : (
                                <span className="mxgantt-name">{column.text(row)}</span>
                            )}
                            {row.kind === "group" && <span className="mxgantt-count">{row.count}</span>}
                        </div>
                    );
                })}
            </div>
        );
    });

    const headMenuColumn = headMenu ? columns.find(entry => entry.key === headMenu.key) : undefined;
    const headMenuItems = headMenuColumn ? props.headerMenu?.(headMenuColumn) : undefined;

    // Header drag: press on a header, move a few pixels, drop before another column.
    const dropTarget = (clientX: number): { x: number; before?: string } => {
        const cells = Array.from(headRef.current?.querySelectorAll<HTMLElement>("[data-column]") ?? []);
        const origin = headRef.current?.getBoundingClientRect().left ?? 0;
        const scrollLeft = headRef.current?.scrollLeft ?? 0;
        for (const cell of cells) {
            const box = cell.getBoundingClientRect();
            if (clientX < box.left + box.width / 2) {
                return { x: box.left - origin + scrollLeft, before: cell.dataset.column };
            }
        }
        const last = cells[cells.length - 1]?.getBoundingClientRect();
        return { x: last ? last.right - origin + scrollLeft : 0 };
    };
    const onHeadDown = (event: PointerEvent<HTMLDivElement>, column: ListColumn): void => {
        if (
            event.button !== 0 ||
            (event.target as HTMLElement).closest("button:not(.mxgantt-head-sort), .mxgantt-col-resize")
        ) {
            return;
        }
        headDrag.current = { key: column.key, x0: event.clientX, pointerId: event.pointerId };
    };
    const onHeadMove = (event: PointerEvent<HTMLDivElement>): void => {
        const drag = headDrag.current;
        if (!drag || (!dragging && Math.abs(event.clientX - drag.x0) < 6)) {
            return;
        }
        if (!dragging) {
            try {
                event.currentTarget.setPointerCapture(drag.pointerId);
            } catch {
                // Nothing to capture for synthetic events.
            }
        }
        setDragging({ key: drag.key, ...dropTarget(event.clientX) });
    };
    const onHeadUp = (): void => {
        const drag = headDrag.current;
        headDrag.current = null;
        if (drag && dragging) {
            justDragged.current = true;
            window.setTimeout(() => {
                justDragged.current = false;
            }, 0);
        }
        if (drag && dragging && dragging.before !== drag.key) {
            props.onReorder?.(drag.key, dragging.before);
        }
        setDragging(undefined);
    };

    const minOf = (key: string): number => columns.find(column => column.key === key)?.minWidth ?? MIN_COLUMN;
    const onResizeKey = (event: KeyboardEvent<HTMLDivElement>, column: ListColumn): void => {
        const steps: Record<string, number> = { ArrowLeft: -8, ArrowRight: 8 };
        if (event.key in steps && props.onResize) {
            event.preventDefault();
            props.onResize(
                column.key,
                Math.max(minOf(column.key), Math.min(MAX_COLUMN, column.width + steps[event.key]))
            );
        }
    };
    const onResizeMove = (event: PointerEvent<HTMLDivElement>): void => {
        const drag = resizeDrag.current;
        if (drag && props.onResize) {
            const next = drag.width0 + event.clientX - drag.x0;
            props.onResize(drag.key, Math.max(minOf(drag.key), Math.min(MAX_COLUMN, next)));
        }
    };

    return (
        <div
            className="mxgantt-list"
            style={{ width: props.width }}
            role="table"
            aria-label={texts.colTask}
            aria-rowcount={rows.length + 1}
        >
            <div className="mxgantt-list-head" role="rowgroup" style={{ height: HEADER_HEIGHT }} ref={headRef}>
                <div
                    role="row"
                    aria-rowindex={1}
                    className="mxgantt-list-headrow"
                    style={{ width: Math.max(totalWidth, props.width) }}
                >
                    {columns.map(column => {
                        const items = props.headerMenu?.(column);
                        const hasMenu = !!items && items.length > 0;
                        const canSort = !!props.onSort && !!column.sortable;
                        const sortDir = props.sort?.key === column.key ? props.sort.dir : undefined;
                        return (
                            <div
                                key={column.key}
                                role="columnheader"
                                aria-sort={
                                    canSort
                                        ? sortDir === "asc"
                                            ? "ascending"
                                            : sortDir === "desc"
                                            ? "descending"
                                            : "none"
                                        : undefined
                                }
                                data-column={column.key}
                                className={classNames("mxgantt-cell", `mxgantt-cell-${column.key}`, {
                                    "mxgantt-head-field": !!column.field,
                                    "has-menu": hasMenu,
                                    "is-sortable": canSort,
                                    "is-sorted": !!sortDir,
                                    "is-draggable": !!props.onReorder,
                                    "is-dragged": dragging?.key === column.key,
                                    "is-drop-before":
                                        !!dragging && dragging.before === column.key && dragging.key !== column.key
                                })}
                                style={{ width: column.width, textAlign: column.align }}
                                title={column.hint}
                                onPointerDown={props.onReorder ? event => onHeadDown(event, column) : undefined}
                                onPointerMove={props.onReorder ? onHeadMove : undefined}
                                onPointerUp={props.onReorder ? onHeadUp : undefined}
                                onPointerCancel={() => {
                                    headDrag.current = null;
                                    setDragging(undefined);
                                }}
                            >
                                {column.icon && <FieldIcon name={column.icon} className="mxgantt-head-icon" />}
                                {canSort ? (
                                    <button
                                        type="button"
                                        className="mxgantt-head-sort"
                                        title={column.hint ? undefined : fill(texts.sortBy, { name: column.title })}
                                        onClick={() => {
                                            if (!justDragged.current) {
                                                props.onSort?.(column.key);
                                            }
                                        }}
                                    >
                                        <span className="mxgantt-head-title">{column.title}</span>
                                        <svg
                                            className={classNames("mxgantt-sort-icon", {
                                                "is-asc": sortDir === "asc",
                                                "is-desc": sortDir === "desc"
                                            })}
                                            viewBox="0 0 12 16"
                                            aria-hidden="true"
                                            focusable="false"
                                        >
                                            <path className="mxgantt-sort-up" d="M6 2l4 5H2z" />
                                            <path className="mxgantt-sort-down" d="M6 14l4-5H2z" />
                                        </svg>
                                    </button>
                                ) : (
                                    <span className="mxgantt-head-title">{column.title}</span>
                                )}
                                {hasMenu && (
                                    <button
                                        type="button"
                                        className="mxgantt-head-menu"
                                        aria-label={fill(texts.fieldMenu, { name: column.title })}
                                        aria-haspopup="menu"
                                        aria-expanded={headMenu?.key === column.key}
                                        aria-controls={headMenu?.key === column.key ? menuId : undefined}
                                        onPointerDown={event => event.stopPropagation()}
                                        onClick={event => {
                                            const box = event.currentTarget.getBoundingClientRect();
                                            setHeadMenu(current =>
                                                current?.key === column.key
                                                    ? undefined
                                                    : {
                                                          key: column.key,
                                                          x: Math.max(
                                                              8,
                                                              Math.min(box.right - 200, window.innerWidth - 216)
                                                          ),
                                                          y: box.bottom + 4
                                                      }
                                            );
                                        }}
                                    >
                                        <FieldIcon name="more" />
                                    </button>
                                )}
                                {props.onResize && (
                                    <div
                                        className="mxgantt-col-resize"
                                        role="separator"
                                        aria-orientation="vertical"
                                        aria-label={fill(texts.resizeColumn, { name: column.title })}
                                        aria-valuenow={Math.round(column.width)}
                                        aria-valuemin={column.minWidth ?? MIN_COLUMN}
                                        aria-valuemax={MAX_COLUMN}
                                        tabIndex={0}
                                        data-column={column.key}
                                        onKeyDown={event => onResizeKey(event, column)}
                                        onPointerDown={event => {
                                            event.stopPropagation();
                                            resizeDrag.current = {
                                                key: column.key,
                                                x0: event.clientX,
                                                width0: column.width
                                            };
                                            try {
                                                event.currentTarget.setPointerCapture(event.pointerId);
                                            } catch {
                                                // Nothing to capture for synthetic events.
                                            }
                                        }}
                                        onPointerMove={onResizeMove}
                                        onPointerUp={() => {
                                            resizeDrag.current = null;
                                        }}
                                        onPointerCancel={() => {
                                            resizeDrag.current = null;
                                        }}
                                    />
                                )}
                            </div>
                        );
                    })}
                    {props.onAddField && (
                        <div className="mxgantt-cell mxgantt-head-add" role="columnheader" style={{ width: ADD_WIDTH }}>
                            <button
                                type="button"
                                className="mxgantt-head-addbutton"
                                aria-label={texts.addField}
                                title={texts.addField}
                                onClick={event => props.onAddField!(event.currentTarget.getBoundingClientRect())}
                            >
                                <FieldIcon name="plus" />
                            </button>
                        </div>
                    )}
                    {dragging && (
                        <span className="mxgantt-head-ghost" style={{ left: dragging.x }} aria-hidden="true" />
                    )}
                </div>
            </div>
            {headMenuColumn && headMenuItems && headMenu && (
                <Menu
                    id={menuId}
                    label={fill(texts.fieldMenu, { name: headMenuColumn.title })}
                    items={headMenuItems}
                    style={{ position: "fixed", left: headMenu.x, top: headMenu.y }}
                    onSelect={item => props.onHeaderMenu?.(headMenuColumn.key, item)}
                    onClose={restore => {
                        setHeadMenu(undefined);
                        if (restore) {
                            headRef.current
                                ?.querySelector<HTMLElement>(`[data-column="${headMenuColumn.key}"] .mxgantt-head-menu`)
                                ?.focus();
                        }
                    }}
                />
            )}
            {props.headerExtra}
            <div
                className="mxgantt-list-body"
                role="rowgroup"
                ref={bodyNode}
                onScroll={event => {
                    if (headRef.current) {
                        headRef.current.scrollLeft = event.currentTarget.scrollLeft;
                    }
                    onScroll(event);
                }}
            >
                <div
                    className="mxgantt-list-inner"
                    style={{ height: rows.length * rh + props.bottomPad, width: Math.max(totalWidth, props.width) }}
                >
                    {visible}
                </div>
            </div>
        </div>
    );
}
