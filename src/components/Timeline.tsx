import classNames from "classnames";
import {
    CSSProperties,
    FocusEvent,
    KeyboardEvent,
    MouseEvent,
    PointerEvent,
    ReactElement,
    ReactNode,
    Ref,
    UIEvent
} from "react";

import {
    barBox,
    BarBox,
    baselineBox,
    HEADER_HEIGHT,
    HEADER_ROW,
    linkEnds,
    linkPath,
    milestoneBox
} from "../utils/geometry";
import { WorkCalendar } from "../utils/calendar";
import { Float, Marker, missesDeadline } from "../utils/plan";
import { segmentSpans } from "../utils/segments";
import { Chain, linkKey } from "../utils/status";
import { TimelineLook } from "../utils/look";
import { isMilestone, Link, linkType, Row, Task } from "../utils/tasks";
import { dateToX, ScaleCell, TimeScale } from "../utils/time";

export interface BarHandlers {
    onPointerDown: (event: PointerEvent<HTMLDivElement>, row: Row) => void;
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>, row: Row) => void;
    onFocus: (event: FocusEvent<HTMLDivElement>, row: Row) => void;
    onBlur: (event: FocusEvent<HTMLDivElement>, row: Row) => void;
    onHover: (row: Row | undefined) => void;
    onContextMenu: (event: MouseEvent<HTMLDivElement>, row: Row) => void;
}

export interface TimelineProps {
    rows: Row[];
    /** Row indexes to draw: the visible slice plus the focused row, which must exist to keep focus. */
    rendered: number[];
    first: number;
    last: number;
    scale: TimeScale;
    cells: { top: ScaleCell[]; bottom: ScaleCell[] };
    width: number;
    rowHeight: number;
    scrollLeft: number;
    viewportWidth: number;
    tasks: Map<string, Task>;
    rowIndex: Map<string, number>;
    links: Link[];
    critical: ReadonlySet<string>;
    conflicts: ReadonlySet<string>;
    showLinks: boolean;
    /** Weekends, or non-working days with a working calendar, already limited to what is on screen. */
    shading: Array<{ x: number; width: number }>;
    showToday: boolean;
    today: Date;
    todayLabel: string;
    /** The row whose bar is the tab stop (roving tabindex). */
    focusedId?: string;
    /** The row the user is working on, highlighted across both panes. */
    activeId?: string;
    draggingId?: string;
    editable: (row: Row) => boolean;
    label: (row: Row) => string;
    roleDescription: (row: Row) => string;
    /** above: there is no room under the row in the visible part of the chart. */
    tooltip?: { rowIndex: number; x: number; id: string; above: boolean; content: ReactNode };
    chartLabel: string;
    /** Unique per widget instance, so two charts on a page do not share arrow markers. */
    idPrefix: string;
    helpId: string;
    hasProgress: boolean;
    /** Tasks moved by auto-scheduling in the current preview. */
    pushed: { has: (id: string) => boolean };
    /** Shows the dot at the end of editable bars that starts a new dependency. */
    linkHandles: boolean;
    linkHandleLabel: string;
    /** The task a keyboard link starts from, and a link being dragged. */
    linkSourceId?: string;
    linkDraft?: { x1: number; y1: number; x2: number; y2: number };
    baselineLabel: string;
    /** 2.1: the status date line, tasks behind schedule, tasks a scenario changed, the hovered dependency chain. */
    statusDate?: Date;
    statusLabel: string;
    behind: ReadonlySet<string>;
    changed: ReadonlySet<string>;
    chain?: Chain;
    /** Bars grow in and arrows draw in while this is set (only right after the chart first shows tasks). */
    intro: boolean;
    /** 2.2: total float tails, deadline flags, timeline markers and the progress line. */
    floats?: ReadonlyMap<string, Float>;
    deadlines?: boolean;
    deadlineLabel?: (date: Date) => string;
    markers?: Marker[];
    markerLabel?: (marker: Marker) => string;
    progressLine?: Array<[number, number]>;
    /** 2.3: split tasks, constraint indicators, over-allocation, a compared baseline. */
    calendar?: WorkCalendar;
    constraints?: ReadonlyMap<string, { broken: boolean; label: string }>;
    overallocated?: ReadonlySet<string>;
    compareBaseline?: (task: Task) => { start: Date; finish: Date } | undefined;
    compareLabel?: string;
    segmentLabel?: (index: number, total: number) => string;
    /** 1.1: custom field values shown after the name on the bar label. */
    barExtras?: (task: Task) => ReactNode;
    /** 1.3: replaces the name and progress after the bar; an empty text leaves the label out. */
    barText?: (task: Task) => string;
    look?: TimelineLook;
    handlers: BarHandlers;
    scrollNode: Ref<HTMLDivElement>;
    onScroll: (event: UIEvent<HTMLDivElement>) => void;
}

/** 1.3 portfolio look: bars stay slim in tall two-line rows. */
export function slimBox(box: BarBox, rh: number): BarBox {
    const height = Math.min(box.height, Math.max(14, Math.round(rh * 0.3)));
    return { ...box, height, top: Math.round((rh - height) / 2) };
}

function boxOf(row: Row, scale: TimeScale, rh: number, slim: boolean): BarBox | undefined {
    if (row.kind === "group") {
        return row.start && row.end ? barBox(row.start, row.end, scale, rh, "group") : undefined;
    }
    const { task } = row;
    if (!task.start || !task.end) {
        return undefined;
    }
    if (isMilestone(task)) {
        if (!slim) {
            return milestoneBox(task.start, scale, rh);
        }
        const small = milestoneBox(task.start, scale, Math.min(rh, 40));
        return { ...small, top: Math.round((rh - small.height) / 2) };
    }
    const box = barBox(task.start, task.end, scale, rh, "task");
    return slim ? slimBox(box, rh) : box;
}

export function Timeline(props: TimelineProps): ReactElement {
    const { rows, scale, rowHeight: rh, handlers, scrollNode, onScroll } = props;
    const slim = !!props.look?.portfolio;
    const outline = !!props.look?.baselineOutline;
    const diamond = !!props.look?.deadlineDiamond;
    const bodyHeight = rows.length * rh;
    // Header cells, weekends and grid lines are only drawn around what is on screen: at day zoom a
    // long plan has thousands of them.
    const fromX = props.scrollLeft - 300;
    const toX = props.scrollLeft + props.viewportWidth + 300;
    const onScreen = (cell: ScaleCell): boolean => cell.x + cell.width >= fromX && cell.x <= toX;
    const todayX = dateToX(props.today, scale);
    const statusX = props.statusDate ? dateToX(props.statusDate, scale) : undefined;
    const showStatus = statusX !== undefined && statusX >= 0 && statusX <= props.width;
    const { chain } = props;
    const markers = (props.markers ?? [])
        .map(marker => ({ ...marker, x: dateToX(marker.date, scale) }))
        .filter(marker => marker.x >= 0 && marker.x <= props.width);

    const header = (
        <div className="mxgantt-scale" style={{ width: props.width, height: HEADER_HEIGHT }} aria-hidden="true">
            {props.cells.top.filter(onScreen).map(cell => {
                // Keep the month or year name in view while its cell is scrolled partly off screen.
                const inset = Math.max(8, Math.min(props.scrollLeft - cell.x + 8, cell.width - 90));
                return (
                    <div
                        key={cell.key}
                        className="mxgantt-scale-top"
                        style={{ left: cell.x, width: cell.width, height: HEADER_ROW }}
                        title={cell.title}
                    >
                        <span style={{ left: inset }}>{cell.label}</span>
                    </div>
                );
            })}
            {props.cells.bottom.filter(onScreen).map(cell => (
                <div
                    key={cell.key}
                    className={classNames("mxgantt-scale-bottom", { "is-weekend": cell.weekend })}
                    style={{ left: cell.x, width: cell.width, top: HEADER_ROW, height: HEADER_ROW }}
                    title={cell.title}
                >
                    {cell.label}
                </div>
            ))}
            {props.showToday && todayX >= 0 && todayX <= props.width && (
                <div
                    className={classNames("mxgantt-today-flag", { "is-labelled": props.look?.todayLabel })}
                    style={{ left: todayX }}
                    title={props.todayLabel}
                >
                    {props.look?.todayLabel && <span className="mxgantt-today-label">{props.todayLabel}</span>}
                </div>
            )}
            {showStatus && <div className="mxgantt-status-flag" style={{ left: statusX }} title={props.statusLabel} />}
            {markers.map(marker => (
                <div
                    key={`m${marker.date.getTime()}-${marker.label}`}
                    className="mxgantt-marker-flag"
                    style={{
                        left: marker.x,
                        ...(marker.color ? ({ "--mxgantt-marker": marker.color } as CSSProperties) : {})
                    }}
                    title={props.markerLabel?.(marker)}
                >
                    <span>{marker.label}</span>
                </div>
            ))}
        </div>
    );

    const background: ReactElement[] = [];
    props.shading.forEach(span =>
        background.push(
            <div
                key={`w${span.x}`}
                className="mxgantt-weekend"
                style={{ left: span.x, width: span.width, height: bodyHeight }}
            />
        )
    );
    props.cells.bottom
        .filter(onScreen)
        .forEach(cell =>
            background.push(
                <div key={`g${cell.key}`} className="mxgantt-gridline" style={{ left: cell.x, height: bodyHeight }} />
            )
        );
    for (let index = props.first; index < props.last; index++) {
        const row = rows[index];
        background.push(
            <div
                key={`r${row.id}`}
                className={classNames("mxgantt-row-bg", {
                    "is-odd": index % 2 === 1,
                    "is-focused": row.id === props.activeId
                })}
                style={{ top: index * rh, height: rh, width: props.width }}
            />
        );
    }

    const links: ReactElement[] = [];
    if (props.showLinks) {
        props.links.forEach(link => {
            const from = props.tasks.get(link.from);
            const to = props.tasks.get(link.to);
            const fromRow = props.rowIndex.get(link.from);
            const toRow = props.rowIndex.get(link.to);
            if (
                !from?.start ||
                !from.end ||
                !to?.start ||
                !to.end ||
                fromRow === undefined ||
                toRow === undefined ||
                fromRow === toRow
            ) {
                return;
            }
            if (Math.max(fromRow, toRow) < props.first || Math.min(fromRow, toRow) >= props.last) {
                return;
            }
            const type = linkType(link);
            const ends = linkEnds(type);
            const half = Math.round(rh * 0.23);
            const fromHalf = isMilestone(from) ? half : 0;
            const toHalf = isMilestone(to) ? half : 0;
            const x1 =
                ends.from === "end" ? dateToX(from.end, scale) + fromHalf : dateToX(from.start, scale) - fromHalf;
            const x2 = ends.to === "start" ? dateToX(to.start, scale) - toHalf : dateToX(to.end, scale) + toHalf;
            const d = linkPath({ x: x1, y: fromRow * rh + rh / 2 }, { x: x2, y: toRow * rh + rh / 2 }, rh, type);
            const onPath = props.critical.has(link.from) && props.critical.has(link.to);
            const kind = link.conflict ? "conflict" : onPath ? "critical" : "normal";
            links.push(
                <path
                    key={linkKey(link)}
                    d={d}
                    className={classNames(`mxgantt-link mxgantt-link-${kind}`, {
                        "is-chain": chain?.links.has(linkKey(link)),
                        "is-cross": link.cross
                    })}
                    data-type={type}
                    // A path length of 1 lets the intro draw every arrow in with the same dash animation.
                    pathLength={props.intro ? 1 : undefined}
                    markerEnd={`url(#${props.idPrefix}-arrow-${kind})`}
                />
            );
        });
    }

    const bars = props.rendered.map(index => {
        const row = rows[index];
        const box = boxOf(row, scale, rh, slim);
        if (!box) {
            return null;
        }
        const top = index * rh + box.top;
        // Bars grow in one after another during the intro, top to bottom.
        const stagger = props.intro
            ? ({ "--mxgantt-i": Math.max(0, Math.min(24, index - props.first)) } as CSSProperties)
            : undefined;
        const inChain = chain?.tasks.has(row.id);
        const focused = row.id === props.focusedId;
        const active = row.id === props.activeId;
        const editable = props.editable(row);
        const common = {
            "data-row-id": row.id,
            tabIndex: focused ? 0 : -1,
            role: "button",
            "aria-roledescription": props.roleDescription(row),
            "aria-label": props.label(row),
            "aria-describedby": props.tooltip?.rowIndex === index ? props.tooltip.id : props.helpId,
            onPointerDown: (event: PointerEvent<HTMLDivElement>) => handlers.onPointerDown(event, row),
            onPointerMove: handlers.onPointerMove,
            onPointerUp: handlers.onPointerUp,
            onPointerCancel: handlers.onPointerCancel,
            onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => handlers.onKeyDown(event, row),
            onFocus: (event: FocusEvent<HTMLDivElement>) => handlers.onFocus(event, row),
            onBlur: (event: FocusEvent<HTMLDivElement>) => handlers.onBlur(event, row),
            onMouseEnter: () => handlers.onHover(row),
            onMouseLeave: () => handlers.onHover(undefined),
            onContextMenu: (event: MouseEvent<HTMLDivElement>) => handlers.onContextMenu(event, row)
        };
        if (row.kind === "group") {
            return (
                <div
                    key={row.id}
                    {...common}
                    aria-expanded={!row.collapsed}
                    className={classNames("mxgantt-bar mxgantt-bar-group", {
                        "is-focused": active,
                        "is-narrow": box.width < 20,
                        "mxgantt-bar-project": row.project
                    })}
                    style={{ left: box.x, width: box.width, top, height: box.height, ...stagger }}
                >
                    {row.progress !== undefined && (
                        <div className="mxgantt-bar-done" style={{ width: `${row.progress}%` }} />
                    )}
                </div>
            );
        }
        const { task } = row;
        const behind = props.behind.has(task.id);
        // Behind schedule overrides the bar colour, so the inline task colour is left out.
        const color = behind ? undefined : task.color;
        const critical = props.critical.has(task.id);
        const conflict = props.conflicts.has(task.id);
        const state = {
            // A diamond shows the date itself; the red bar outline would repeat it.
            "is-missed": props.deadlines && !diamond && missesDeadline(task),
            "is-focused": active,
            "is-critical": critical,
            "is-conflict": conflict,
            "is-dragging": props.draggingId === task.id,
            "is-editable": editable,
            "is-pushed": props.pushed.has(task.id),
            "is-link-source": props.linkSourceId === task.id,
            "is-behind": behind,
            "is-scenario": props.changed.has(task.id),
            "is-chain": inChain,
            "is-overallocated": props.overallocated?.has(task.id),
            "is-split": !!task.segments
        };
        let baseline: ReactElement | null = null;
        // Where the label may start: past the bar, and past a baseline frame or a diamond after it.
        let labelLeft = box.x + box.width;
        if (outline && task.baselineStart && task.baselineEnd && !isMilestone(task)) {
            // 1.3: a dashed frame around the baseline dates, a little larger than the bar.
            const x1 = dateToX(task.baselineStart, scale);
            const x2 = Math.max(x1 + 4, dateToX(task.baselineEnd, scale));
            labelLeft = Math.max(labelLeft, x2);
            baseline = (
                <span
                    key={`${row.id}-baseline`}
                    className="mxgantt-baseline is-outline"
                    style={{ left: x1 - 3, width: x2 - x1 + 6, top: top - 4, height: box.height + 8 }}
                    aria-hidden="true"
                    title={props.baselineLabel}
                />
            );
        } else if (task.baselineStart && task.baselineEnd) {
            const base =
                task.baselineStart.getTime() === task.baselineEnd.getTime()
                    ? { ...milestoneBox(task.baselineStart, scale, rh), height: 0 }
                    : baselineBox(task.baselineStart, task.baselineEnd, scale, rh);
            baseline =
                base.height === 0 ? (
                    <span
                        key={`${row.id}-baseline`}
                        className="mxgantt-baseline mxgantt-baseline-point"
                        style={{ left: base.x + base.width / 2 - 4, top: index * rh + rh - 9 }}
                        aria-hidden="true"
                        title={props.baselineLabel}
                    />
                ) : (
                    <span
                        key={`${row.id}-baseline`}
                        className="mxgantt-baseline"
                        style={{ left: base.x, width: base.width, top: index * rh + base.top, height: base.height }}
                        aria-hidden="true"
                        title={props.baselineLabel}
                    />
                );
        }
        const linkHandle = props.linkHandles ? (
            <span className="mxgantt-link-handle" data-mode="link" title={props.linkHandleLabel} />
        ) : null;
        const float = props.floats?.get(task.id);
        const floatTail =
            float && float.days > 0 && task.end ? (
                <span
                    key={`${row.id}-float`}
                    className="mxgantt-float"
                    style={{
                        left: dateToX(task.end, scale),
                        width: Math.max(2, dateToX(float.latestFinish, scale) - dateToX(task.end, scale)),
                        top: index * rh + rh / 2 - 1,
                        ...stagger
                    }}
                    aria-hidden="true"
                />
            ) : null;
        const missed = missesDeadline(task);
        let deadlineFlag: ReactElement | null = null;
        if (props.deadlines && task.deadline) {
            const x = dateToX(task.deadline, scale);
            if (diamond) {
                // 1.3: a diamond on the bar's centre line, such as a business need date.
                labelLeft = Math.max(labelLeft, x + 8);
                deadlineFlag = (
                    <span
                        key={`${row.id}-deadline`}
                        className={classNames("mxgantt-deadline is-diamond", { "is-missed": missed })}
                        style={{ left: x, top: index * rh + rh / 2 }}
                        title={props.deadlineLabel?.(task.deadline)}
                        aria-hidden="true"
                    />
                );
            } else {
                deadlineFlag = (
                    <span
                        key={`${row.id}-deadline`}
                        className={classNames("mxgantt-deadline", { "is-missed": missed })}
                        style={{ left: x, top: index * rh + 2, height: rh - 4 }}
                        title={props.deadlineLabel?.(task.deadline)}
                        aria-hidden="true"
                    />
                );
            }
        }
        const compared = props.compareBaseline?.(task);
        let baseline2: ReactElement | null = null;
        if (compared) {
            const x1 = dateToX(compared.start, scale);
            const x2 = dateToX(compared.finish, scale);
            baseline2 = (
                <span
                    key={`${row.id}-baseline2`}
                    className="mxgantt-baseline mxgantt-baseline2"
                    style={{ left: x1, width: Math.max(3, x2 - x1), top: index * rh + rh - 4, height: 3 }}
                    aria-hidden="true"
                    title={props.compareLabel}
                />
            );
        }
        const constraint = props.constraints?.get(task.id);
        // Past the arrow stub that leaves the bar end, so outgoing arrows do not cut through the name.
        const labelStyle: CSSProperties = { left: labelLeft + 12, top: index * rh + rh / 2 };
        const warn = conflict || (missed && !diamond);
        const custom = props.barText?.(task);
        const label =
            custom !== undefined ? (
                custom || warn ? (
                    <span
                        key={`${row.id}-label`}
                        className={classNames("mxgantt-bar-label is-custom", { "is-chain": inChain })}
                        style={{ ...labelStyle, ...stagger }}
                        aria-hidden="true"
                    >
                        {warn && <span className="mxgantt-warning">!</span>}
                        {custom}
                    </span>
                ) : null
            ) : (
                <span
                    key={`${row.id}-label`}
                    className={classNames("mxgantt-bar-label", { "is-chain": inChain })}
                    style={{ ...labelStyle, ...stagger }}
                    aria-hidden="true"
                >
                    {warn && <span className="mxgantt-warning">!</span>}
                    {constraint && (
                        <span
                            className={classNames("mxgantt-constraint", { "is-broken": constraint.broken })}
                            title={constraint.label}
                        >
                            <svg viewBox="0 0 12 12" focusable="false" aria-hidden="true">
                                <path d="M2 5h8v6H2zM4 5V3.5a2 2 0 014 0V5" />
                            </svg>
                        </span>
                    )}
                    {task.name}
                    {task.progress !== undefined && !isMilestone(task) && (
                        <span className="mxgantt-bar-pct">{task.progress}%</span>
                    )}
                    {props.barExtras?.(task)}
                </span>
            );
        if (isMilestone(task)) {
            return [
                <div
                    key={row.id}
                    {...common}
                    className={classNames("mxgantt-milestone", state)}
                    style={{
                        left: box.x,
                        width: box.width,
                        top,
                        height: box.height,
                        ...stagger,
                        ...(color ? ({ "--mxgantt-task-color": color } as CSSProperties) : {})
                    }}
                >
                    {linkHandle}
                </div>,
                label,
                baseline,
                baseline2,
                deadlineFlag
            ];
        }
        const progress = task.progress ?? 0;
        const pieces = task.segments ? segmentSpans(task, props.calendar) : [];
        const split = pieces.length > 1;
        const progressX = box.width * (progress / 100);
        return [
            <div
                key={row.id}
                {...common}
                className={classNames("mxgantt-bar mxgantt-bar-task", state)}
                style={{
                    left: box.x,
                    width: box.width,
                    top,
                    height: box.height,
                    ...stagger,
                    ...(color ? ({ "--mxgantt-task-color": color } as CSSProperties) : {})
                }}
            >
                {split ? (
                    <>
                        <span className="mxgantt-split-gap" aria-hidden="true" />
                        {pieces.map((piece, i) => {
                            const left = dateToX(piece.start, scale) - box.x;
                            const segmentWidth = Math.max(2, dateToX(piece.end, scale) - box.x - left);
                            const done = Math.max(0, Math.min(segmentWidth, progressX - left));
                            return (
                                <div
                                    key={i}
                                    className="mxgantt-split-piece"
                                    style={{ left, width: segmentWidth }}
                                    data-mode={editable && i > 0 ? "segment" : undefined}
                                    data-segment={i}
                                    title={props.segmentLabel?.(i, pieces.length)}
                                >
                                    <div className="mxgantt-bar-track" />
                                    {done > 0 && <div className="mxgantt-bar-done" style={{ width: done }} />}
                                </div>
                            );
                        })}
                    </>
                ) : (
                    <>
                        <div className="mxgantt-bar-track" />
                        {progress > 0 && <div className="mxgantt-bar-done" style={{ width: `${progress}%` }} />}
                    </>
                )}
                {editable && (
                    <>
                        <span className="mxgantt-handle mxgantt-handle-start" data-mode="start" />
                        <span className="mxgantt-handle mxgantt-handle-end" data-mode="end" />
                        {props.hasProgress && (
                            <span
                                className="mxgantt-progress-handle"
                                data-mode="progress"
                                style={{ left: `${progress}%` }}
                            />
                        )}
                    </>
                )}
                {linkHandle}
            </div>,
            floatTail,
            label,
            baseline,
            baseline2,
            deadlineFlag
        ];
    });

    return (
        <div className="mxgantt-chart" ref={scrollNode} onScroll={onScroll}>
            <div className="mxgantt-chart-inner" style={{ width: props.width, height: HEADER_HEIGHT + bodyHeight }}>
                {header}
                <div
                    className={classNames("mxgantt-canvas", { "has-chain": !!chain })}
                    style={{ width: props.width, height: bodyHeight }}
                    role="group"
                    aria-label={props.chartLabel}
                    aria-describedby={props.helpId}
                >
                    <div className="mxgantt-background" aria-hidden="true">
                        {background}
                    </div>
                    {props.showToday && todayX >= 0 && todayX <= props.width && (
                        <div
                            className={classNames("mxgantt-today", { "is-dashed": props.look?.todayLabel })}
                            style={{ left: todayX, height: bodyHeight }}
                            aria-hidden="true"
                        />
                    )}
                    {showStatus && (
                        <div
                            className="mxgantt-status-line"
                            style={{ left: statusX, height: bodyHeight }}
                            aria-hidden="true"
                        />
                    )}
                    {markers.map(marker => (
                        <div
                            key={`ml${marker.date.getTime()}-${marker.label}`}
                            className="mxgantt-marker-line"
                            style={{
                                left: marker.x,
                                height: bodyHeight,
                                ...(marker.color ? ({ "--mxgantt-marker": marker.color } as CSSProperties) : {})
                            }}
                            aria-hidden="true"
                        />
                    ))}
                    {props.progressLine && props.progressLine.length > 1 && (
                        <svg
                            className="mxgantt-progress-line"
                            width={props.width}
                            height={bodyHeight}
                            aria-hidden="true"
                            focusable="false"
                        >
                            <polyline
                                points={props.progressLine.map(([x, y]) => `${x},${y}`).join(" ")}
                                pathLength={1}
                            />
                        </svg>
                    )}
                    {links.length > 0 && (
                        <svg
                            className="mxgantt-links"
                            width={props.width}
                            height={bodyHeight}
                            aria-hidden="true"
                            focusable="false"
                        >
                            <defs>
                                {["normal", "conflict", "critical"].map(kind => (
                                    <marker
                                        key={kind}
                                        id={`${props.idPrefix}-arrow-${kind}`}
                                        className={`mxgantt-arrow-${kind}`}
                                        viewBox="0 0 8 8"
                                        refX="7"
                                        refY="4"
                                        markerWidth="7"
                                        markerHeight="7"
                                        orient="auto"
                                    >
                                        <path d="M0,0 L8,4 L0,8 z" />
                                    </marker>
                                ))}
                            </defs>
                            {links}
                        </svg>
                    )}
                    {bars}
                    {props.linkDraft && (
                        <svg
                            className="mxgantt-links mxgantt-link-draft"
                            width={props.width}
                            height={bodyHeight}
                            aria-hidden="true"
                            focusable="false"
                        >
                            <line
                                x1={props.linkDraft.x1}
                                y1={props.linkDraft.y1}
                                x2={props.linkDraft.x2}
                                y2={props.linkDraft.y2}
                                className="mxgantt-link mxgantt-link-draft-line"
                            />
                        </svg>
                    )}
                    {props.tooltip && (
                        <div
                            id={props.tooltip.id}
                            role="tooltip"
                            className={classNames("mxgantt-tooltip", {
                                "is-above": props.tooltip.above
                            })}
                            style={
                                props.tooltip.above
                                    ? { left: props.tooltip.x, top: props.tooltip.rowIndex * rh - 6 }
                                    : { left: props.tooltip.x, top: (props.tooltip.rowIndex + 1) * rh + 2 }
                            }
                        >
                            {props.tooltip.content}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
