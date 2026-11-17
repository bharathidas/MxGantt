import { ReactElement } from "react";
import { MxGanttPreviewProps } from "../typings/MxGanttProps";
import { PreviewColumn, previewColumns } from "./utils/previewColumns";

// Design mode has no data, so a small representative plan is drawn instead: a group with its
// summary bar, three tasks with progress, a milestone and two dependency arrows.
const ROWS = [
    { name: "Design", group: true, left: 4, width: 150, done: 70 },
    { name: "Requirements", left: 4, width: 70, done: 100, risk: "Low" },
    { name: "UI design", left: 74, width: 80, done: 40, risk: "Medium" },
    { name: "Build", left: 154, width: 120, done: 0, risk: "High" },
    { name: "Release", milestone: true, left: 280, width: 0, done: 0 }
];

// 1.1: the sample custom field shown while Custom fields is on, coloured like the runtime chips.
const RISK_COLORS: Record<string, string> = { Low: "#15803d", Medium: "#ca8504", High: "#d92d20" };

export function preview(props: MxGanttPreviewProps): ReactElement {
    const rh = Math.max(24, Math.min(80, props.rowHeight ?? 36));
    const withLinks = !!props.keyAttr && !!props.dependenciesAttr && props.showDependencies;
    const withBaseline = !!props.baselineStartAttr && !!props.baselineEndAttr;
    const withWorkload = !!props.assigneeAttr && props.showWorkload;
    const days = Array.from({ length: 24 }, (_, index) => index);
    const withFields = !!props.allowCustomFields;
    // 1.2: the configured columns (or the classic ones), with a WBS number before Task name.
    const columns = previewColumns(props);
    const lead = columns.filter(column => column.key === "wbs");
    const rest = columns.filter(column => column.key !== "wbs");
    const nameWidth = 180;
    const listWidth = Math.min(
        props.gridWidth ?? 460,
        nameWidth + columns.reduce((sum, column) => sum + column.width, 0) + (withFields ? 112 : 0)
    );
    const headCell = (column: PreviewColumn): ReactElement => (
        <div
            key={column.key}
            className={`mxgantt-cell ${column.hidden ? "mxgantt-preview-hidden" : ""}`}
            style={{ width: column.width, textAlign: column.align }}
            title={column.hidden ? "Hidden at first" : undefined}
        >
            <span className="mxgantt-head-title">{column.caption}</span>
            {column.sortable && (
                <svg className="mxgantt-sort-icon" viewBox="0 0 12 16" aria-hidden="true">
                    <path d="M6 2l4 5H2z" />
                    <path d="M6 14l4-5H2z" />
                </svg>
            )}
        </div>
    );
    const bodyCell = (column: PreviewColumn, index: number): ReactElement => (
        <div
            key={column.key}
            className={`mxgantt-cell ${column.hidden ? "mxgantt-preview-hidden" : ""}`}
            style={{ width: column.width, textAlign: column.align }}
        >
            {column.samples.length === 1 ? column.samples[0] : column.samples[index] ?? ""}
        </div>
    );
    return (
        <div className={`mxgantt ${props.theme === "dark" ? "mxgantt--dark" : ""} ${props.className ?? ""}`}>
            {props.showToolbar && (
                // Same markup as the runtime toolbar: the toolbar stacks rows, each row lays its items out in a line.
                <div className="mxgantt-toolbar">
                    <div className="mxgantt-toolbar-row">
                        <div className="mxgantt-segment">
                            {["Day", "Week", "Month", "Quarter", "Year"].map(label => (
                                <span
                                    key={label}
                                    className="mxgantt-button"
                                    aria-pressed={label.toLowerCase() === props.zoom ? "true" : "false"}
                                >
                                    {label}
                                </span>
                            ))}
                        </div>
                        <span className="mxgantt-button">Today</span>
                    </div>
                    {props.showFilter && (
                        <div className="mxgantt-toolbar-row mxgantt-filterbar">
                            <span className="mxgantt-search">Search tasks</span>
                            <span className="mxgantt-button mxgantt-chip">Late only</span>
                        </div>
                    )}
                </div>
            )}
            <div className="mxgantt-body" style={{ height: 52 + ROWS.length * rh + 8 }}>
                {props.showGrid && (
                    <div className="mxgantt-list" style={{ width: listWidth }}>
                        <div className="mxgantt-list-head" style={{ height: 52 }}>
                            <div className="mxgantt-list-headrow">
                                {lead.map(headCell)}
                                <div className="mxgantt-cell" style={{ width: nameWidth }}>
                                    <span className="mxgantt-head-title">Task</span>
                                    {props.nameSortable && (
                                        <svg className="mxgantt-sort-icon" viewBox="0 0 12 16" aria-hidden="true">
                                            <path d="M6 2l4 5H2z" />
                                            <path d="M6 14l4-5H2z" />
                                        </svg>
                                    )}
                                </div>
                                {rest.map(headCell)}
                                {withFields && (
                                    <div className="mxgantt-cell mxgantt-head-field" style={{ width: 84 }}>
                                        Risk
                                    </div>
                                )}
                                {withFields && (
                                    <div className="mxgantt-cell mxgantt-head-add" style={{ width: 28 }}>
                                        +
                                    </div>
                                )}
                            </div>
                        </div>
                        <div style={{ position: "relative" }}>
                            {ROWS.map((row, index) => (
                                <div
                                    key={row.name}
                                    className={`mxgantt-list-row ${row.group ? "mxgantt-list-group" : ""}`}
                                    style={{ top: index * rh, height: rh }}
                                >
                                    {lead.map(column => bodyCell(column, index))}
                                    <div
                                        className="mxgantt-cell mxgantt-cell-name"
                                        style={{ width: nameWidth, paddingLeft: row.group ? 8 : 26 }}
                                    >
                                        {props.taskName ? row.name : `[${row.name}]`}
                                    </div>
                                    {rest.map(column => bodyCell(column, index))}
                                    {withFields && (
                                        <div className="mxgantt-cell mxgantt-cell-field" style={{ width: 84 }}>
                                            {row.risk && (
                                                <span
                                                    className="mxgantt-chip-tag"
                                                    style={{ ["--mxgantt-chip" as string]: RISK_COLORS[row.risk] }}
                                                >
                                                    {row.risk}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                <div className="mxgantt-chart" style={{ overflow: "hidden" }}>
                    <div className="mxgantt-scale" style={{ height: 52, position: "relative" }}>
                        <div className="mxgantt-scale-top" style={{ left: 0, width: 480, height: 26 }}>
                            <span style={{ left: 8 }}>Month</span>
                        </div>
                        {days.map(day => (
                            <div
                                key={day}
                                className="mxgantt-scale-bottom"
                                style={{ left: day * 20, width: 20, top: 26, height: 26 }}
                            >
                                {day + 1}
                            </div>
                        ))}
                    </div>
                    <div className="mxgantt-canvas" style={{ height: ROWS.length * rh }}>
                        {ROWS.map((row, index) => {
                            const height = row.group ? Math.round(rh * 0.3) : Math.round(rh * 0.58);
                            const top = index * rh + (rh - height) / 2;
                            if (row.milestone) {
                                const size = Math.round(rh * 0.46);
                                return (
                                    <div
                                        key={row.name}
                                        className="mxgantt-milestone"
                                        style={{
                                            left: row.left - size / 2,
                                            top: index * rh + (rh - size) / 2,
                                            width: size,
                                            height: size
                                        }}
                                    />
                                );
                            }
                            return (
                                <div
                                    key={row.name}
                                    className={`mxgantt-bar ${row.group ? "mxgantt-bar-group" : "mxgantt-bar-task"}`}
                                    style={{ left: row.left, width: row.width, top, height }}
                                >
                                    {!row.group && <div className="mxgantt-bar-track" />}
                                    <div className="mxgantt-bar-done" style={{ width: `${row.done}%` }} />
                                    {withBaseline && !row.group && (
                                        <span
                                            className="mxgantt-baseline"
                                            style={{ left: 0, width: "85%", top: height + 2, height: 4 }}
                                        />
                                    )}
                                </div>
                            );
                        })}
                        {withLinks && (
                            <svg
                                className="mxgantt-links"
                                width={480}
                                height={ROWS.length * rh}
                                style={{ position: "absolute", left: 0, top: 0 }}
                            >
                                <path className="mxgantt-link" d={`M 154 ${2.5 * rh} H 162 V ${3.5 * rh} H 154`} />
                                <path className="mxgantt-link" d={`M 274 ${3.5 * rh} H 280 V ${4.5 * rh - 10}`} />
                            </svg>
                        )}
                    </div>
                </div>
            </div>
            {withWorkload && (
                <div className="mxgantt-workload">
                    <div className="mxgantt-workload-title">Resource workload</div>
                </div>
            )}
        </div>
    );
}

export function getPreviewCss(): string {
    return require("./ui/MxGantt.css");
}
