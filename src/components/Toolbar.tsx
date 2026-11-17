import { ReactElement, ReactNode, useCallback, useId, useRef, useState } from "react";

import { TaskFilter } from "../utils/filter";
import { Texts } from "../utils/texts";
import { Zoom, ZOOMS } from "../utils/time";
import { Menu, MenuItem } from "./Menu";

export interface ToolbarProps {
    texts: Texts;
    zoom: Zoom;
    onZoom: (zoom: Zoom) => void;
    onToday: () => void;
    /** 2.2: zoom to fit the whole plan. */
    onFit?: () => void;
    hasGroups: boolean;
    allCollapsed: boolean;
    onToggleAll: () => void;
    criticalAvailable: boolean;
    critical: boolean;
    onCritical: () => void;
    allowExport: boolean;
    onExportPng: () => void;
    onPrint: () => void;
    /** The 2.0 additions; each is left out when its feature is off. */
    undo?: { canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void };
    autoSchedule?: { on: boolean; onToggle: () => void };
    onAdd?: () => void;
    onDelete?: { disabled: boolean; run: () => void };
    columns?: { items: MenuItem[]; onToggle: (key: string) => void };
    /** 1.1: the richer Columns panel (search, reorder, custom fields); replaces the plain menu. */
    columnsPanel?: (id: string, close: (restoreFocus: boolean) => void) => ReactNode;
    onExportCsv?: () => void;
    /** 2.1: Excel and MS Project export, and the what-if scenario toggle. */
    onExportXlsx?: () => void;
    onExportProject?: () => void;
    scenario?: { on: boolean; onToggle: () => void };
    onHelp?: () => void;
    /** 2.3: resource levelling, Schedule plan, the baselines panel and MS Project import. */
    onLevel?: () => void;
    onSchedule?: () => void;
    baselines?: { on: boolean; onToggle: () => void };
    onImport?: () => void;
    filter?: {
        value: TaskFilter;
        onChange: (next: TaskFilter) => void;
        showMine: boolean;
        showCritical: boolean;
        status: string;
        /** 1.1: custom field values to filter on, grouped by field. */
        fields?: Array<{ label: string; choices: Array<{ value: string; label: string }> }>;
    };
}

const ZOOM_TEXT: Record<Zoom, "zoomDay" | "zoomWeek" | "zoomMonth" | "zoomQuarter" | "zoomYear"> = {
    day: "zoomDay",
    week: "zoomWeek",
    month: "zoomMonth",
    quarter: "zoomQuarter",
    year: "zoomYear"
};

/** Small inline icons: the widget ships without an icon font so it looks the same in every theme. */
const Icon = ({ d }: { d: string }): ReactElement => (
    <svg className="mxgantt-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d={d} />
    </svg>
);

const ICONS = {
    today: "M3 2v12M3 4h9l-2 2.5L12 9H3",
    fit: "M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4M5 8h6",
    expand: "M4 6l4 4 4-4",
    collapse: "M4 10l4-4 4 4",
    critical: "M2 12h3l2-8 2 8 2-5h3",
    image: "M2 3h12v10H2zM2 11l3.5-3.5 3 3L11 8l3 3M10.5 5.5h.01",
    print: "M4 6V2h8v4M4 11H2V6h12v5h-2M4 9h8v5H4z",
    undo: "M5 3L2 6l3 3M2 6h8a4 4 0 010 8H6",
    redo: "M11 3l3 3-3 3M14 6H6a4 4 0 000 8h4",
    add: "M8 3v10M3 8h10",
    remove: "M3 4h10M6 4V2.5h4V4M4.5 4l.8 9.5h5.4l.8-9.5",
    auto: "M2 4h5v3H2zM9 9h5v3H9zM7 5.5h3.5V9",
    columns: "M2 3h12v10H2zM6 3v10M10 3v10",
    csv: "M4 2h6l3 3v9H4zM10 2v3h3M6 9h5M6 11.5h5",
    help: "M6 6a2 2 0 114 0c0 1.5-2 1.5-2 3M8 12h.01M8 1.5a6.5 6.5 0 110 13 6.5 6.5 0 010-13z",
    search: "M7 12A5 5 0 107 2a5 5 0 000 10zM11 11l3.5 3.5",
    xlsx: "M3 2h7l3 3v9H3zM10 2v3h3M5.5 7.5l3 4M8.5 7.5l-3 4",
    project: "M2 3h5v2.5H2zM5 7h6v2.5H5zM9 11h5v2.5H9zM4.5 5.5V8H5M10.5 9.5V12H9",
    scenario: "M3 13V9M3 9c0-3 3-3 5-3h5M10.5 3.5L13 6l-2.5 2.5M3 9c0 2 2 3 5 3h2",
    level: "M2 13h12M3 13V9h3v4M7 13V5h3v8M11 13V8h3v5M2 3h12",
    schedule: "M2 4h5v3H2zM9 9h5v3H9zM7 5.5h1.5a1 1 0 011 1V9",
    baselines: "M2 4h9M2 4v0M4 7h10M2 10h8M4 13h9",
    importFile: "M8 2v8M5 7l3 3 3-3M3 12v2h10v-2"
};

export function Toolbar(props: ToolbarProps): ReactElement {
    const { texts, filter } = props;
    const menuId = `${useId().replace(/[^a-zA-Z0-9_-]/g, "")}-columns`;
    const [columnsOpen, setColumnsOpen] = useState(false);
    const columnsButton = useRef<HTMLButtonElement>(null);
    // The panel restores focus by looking the button up, so no ref is handed to it during render.
    const closePanel = useCallback(
        (restoreFocus: boolean) => {
            const button = restoreFocus ? document.querySelector<HTMLElement>(`[aria-controls="${menuId}"]`) : null;
            setColumnsOpen(false);
            button?.focus();
        },
        [menuId]
    );
    const closeColumns = useCallback((restoreFocus: boolean) => {
        setColumnsOpen(false);
        if (restoreFocus) {
            columnsButton.current?.focus();
        }
    }, []);
    return (
        <div className="mxgantt-toolbar" role="toolbar" aria-label={texts.toolbar}>
            <div className="mxgantt-toolbar-row">
                <div className="mxgantt-segment" role="group" aria-label={texts.zoom}>
                    {ZOOMS.map(zoom => (
                        <button
                            key={zoom}
                            type="button"
                            className="mxgantt-button"
                            aria-pressed={props.zoom === zoom}
                            onClick={() => props.onZoom(zoom)}
                        >
                            {texts[ZOOM_TEXT[zoom]]}
                        </button>
                    ))}
                </div>
                <button type="button" className="mxgantt-button" onClick={props.onToday}>
                    <Icon d={ICONS.today} />
                    {texts.today}
                </button>
                {props.onFit && (
                    <button
                        type="button"
                        className="mxgantt-button mxgantt-button-fit"
                        aria-keyshortcuts="F"
                        title={`${texts.fit} (F)`}
                        onClick={props.onFit}
                    >
                        <Icon d={ICONS.fit} />
                        {texts.fit}
                    </button>
                )}
                {props.hasGroups && (
                    <button type="button" className="mxgantt-button" onClick={props.onToggleAll}>
                        <Icon d={props.allCollapsed ? ICONS.expand : ICONS.collapse} />
                        {props.allCollapsed ? texts.expandAll : texts.collapseAll}
                    </button>
                )}
                {props.criticalAvailable && (
                    <button
                        type="button"
                        className="mxgantt-button mxgantt-button-critical"
                        aria-pressed={props.critical}
                        onClick={props.onCritical}
                    >
                        <Icon d={ICONS.critical} />
                        {texts.criticalPath}
                    </button>
                )}
                {props.autoSchedule && (
                    <button
                        type="button"
                        className="mxgantt-button mxgantt-button-auto"
                        aria-pressed={props.autoSchedule.on}
                        onClick={props.autoSchedule.onToggle}
                    >
                        <Icon d={ICONS.auto} />
                        {texts.autoSchedule}
                    </button>
                )}
                {props.scenario && (
                    <button
                        type="button"
                        className="mxgantt-button mxgantt-button-scenario"
                        aria-pressed={props.scenario.on}
                        onClick={props.scenario.onToggle}
                    >
                        <Icon d={ICONS.scenario} />
                        {texts.scenario}
                    </button>
                )}
                {props.onSchedule && (
                    <button type="button" className="mxgantt-button mxgantt-button-schedule" onClick={props.onSchedule}>
                        <Icon d={ICONS.schedule} />
                        {texts.schedule}
                    </button>
                )}
                {props.onLevel && (
                    <button type="button" className="mxgantt-button mxgantt-button-level" onClick={props.onLevel}>
                        <Icon d={ICONS.level} />
                        {texts.level}
                    </button>
                )}
                {props.baselines && (
                    <button
                        type="button"
                        className="mxgantt-button mxgantt-button-baselines"
                        aria-pressed={props.baselines.on}
                        onClick={props.baselines.onToggle}
                    >
                        <Icon d={ICONS.baselines} />
                        {texts.baselines}
                    </button>
                )}
                {props.undo && (
                    <div className="mxgantt-segment" role="group" aria-label={`${texts.undo} / ${texts.redo}`}>
                        <button
                            type="button"
                            className="mxgantt-button mxgantt-button-undo"
                            aria-disabled={!props.undo.canUndo}
                            title={`${texts.undo} (Ctrl+Z)`}
                            aria-keyshortcuts="Control+Z"
                            onClick={props.undo.onUndo}
                        >
                            <Icon d={ICONS.undo} />
                            {texts.undo}
                        </button>
                        <button
                            type="button"
                            className="mxgantt-button mxgantt-button-redo"
                            aria-disabled={!props.undo.canRedo}
                            title={`${texts.redo} (Ctrl+Y)`}
                            aria-keyshortcuts="Control+Y"
                            onClick={props.undo.onRedo}
                        >
                            <Icon d={ICONS.redo} />
                            {texts.redo}
                        </button>
                    </div>
                )}
                {props.onAdd && (
                    <button
                        type="button"
                        className="mxgantt-button mxgantt-button-add"
                        aria-keyshortcuts="Insert"
                        onClick={props.onAdd}
                    >
                        <Icon d={ICONS.add} />
                        {texts.addTask}
                    </button>
                )}
                {props.onDelete && (
                    <button
                        type="button"
                        className="mxgantt-button mxgantt-button-delete"
                        aria-disabled={props.onDelete.disabled}
                        aria-keyshortcuts="Delete"
                        onClick={() => !props.onDelete!.disabled && props.onDelete!.run()}
                    >
                        <Icon d={ICONS.remove} />
                        {texts.deleteTask}
                    </button>
                )}
                {(props.columns || props.columnsPanel) && (
                    <div className="mxgantt-menu-anchor">
                        <button
                            ref={columnsButton}
                            type="button"
                            className="mxgantt-button mxgantt-button-columns"
                            aria-haspopup={props.columnsPanel ? "dialog" : "menu"}
                            aria-expanded={columnsOpen}
                            aria-controls={columnsOpen ? menuId : undefined}
                            onClick={() => setColumnsOpen(open => !open)}
                        >
                            <Icon d={ICONS.columns} />
                            {texts.columns}
                        </button>
                        {columnsOpen && props.columnsPanel && props.columnsPanel(menuId, closePanel)}
                        {columnsOpen && !props.columnsPanel && props.columns && (
                            <Menu
                                id={menuId}
                                label={texts.showColumns}
                                items={props.columns.items}
                                onSelect={props.columns.onToggle}
                                keepOpen
                                style={{ left: 0, top: "100%" }}
                                onClose={closeColumns}
                            />
                        )}
                    </div>
                )}
                <div className="mxgantt-toolbar-end">
                    {props.onImport && (
                        <button type="button" className="mxgantt-button mxgantt-button-import" onClick={props.onImport}>
                            <Icon d={ICONS.importFile} />
                            {texts.importProject}
                        </button>
                    )}
                    {props.onExportCsv && (
                        <button type="button" className="mxgantt-button mxgantt-button-csv" onClick={props.onExportCsv}>
                            <Icon d={ICONS.csv} />
                            {texts.exportCsv}
                        </button>
                    )}
                    {props.onExportXlsx && (
                        <button
                            type="button"
                            className="mxgantt-button mxgantt-button-xlsx"
                            onClick={props.onExportXlsx}
                        >
                            <Icon d={ICONS.xlsx} />
                            {texts.exportXlsx}
                        </button>
                    )}
                    {props.onExportProject && (
                        <button
                            type="button"
                            className="mxgantt-button mxgantt-button-project"
                            onClick={props.onExportProject}
                        >
                            <Icon d={ICONS.project} />
                            {texts.exportProject}
                        </button>
                    )}
                    {props.allowExport && (
                        <>
                            <button type="button" className="mxgantt-button" onClick={props.onExportPng}>
                                <Icon d={ICONS.image} />
                                {texts.exportPng}
                            </button>
                            <button type="button" className="mxgantt-button" onClick={props.onPrint}>
                                <Icon d={ICONS.print} />
                                {texts.print}
                            </button>
                        </>
                    )}
                    {props.onHelp && (
                        <button
                            type="button"
                            className="mxgantt-button mxgantt-button-help"
                            aria-label={texts.shortcuts}
                            title={`${texts.shortcuts} (?)`}
                            aria-keyshortcuts="Shift+?"
                            onClick={props.onHelp}
                        >
                            <Icon d={ICONS.help} />
                        </button>
                    )}
                </div>
            </div>
            {filter && (
                <div className="mxgantt-toolbar-row mxgantt-filterbar">
                    <label className="mxgantt-search">
                        <Icon d={ICONS.search} />
                        <input
                            type="search"
                            className="mxgantt-search-input"
                            aria-label={texts.search}
                            placeholder={texts.search}
                            value={filter.value.text}
                            onChange={event => filter.onChange({ ...filter.value, text: event.target.value })}
                        />
                    </label>
                    {filter.showCritical && (
                        <button
                            type="button"
                            className="mxgantt-button mxgantt-chip"
                            aria-pressed={filter.value.critical}
                            onClick={() => filter.onChange({ ...filter.value, critical: !filter.value.critical })}
                        >
                            {texts.onlyCritical}
                        </button>
                    )}
                    <button
                        type="button"
                        className="mxgantt-button mxgantt-chip"
                        aria-pressed={filter.value.late}
                        onClick={() => filter.onChange({ ...filter.value, late: !filter.value.late })}
                    >
                        {texts.onlyLate}
                    </button>
                    {filter.showMine && (
                        <button
                            type="button"
                            className="mxgantt-button mxgantt-chip"
                            aria-pressed={filter.value.mine}
                            onClick={() => filter.onChange({ ...filter.value, mine: !filter.value.mine })}
                        >
                            {texts.onlyMine}
                        </button>
                    )}
                    {filter.fields && filter.fields.length > 0 && (
                        <select
                            className="mxgantt-select mxgantt-field-filter"
                            aria-label={texts.fieldFilter}
                            value={filter.value.field ?? ""}
                            onChange={event => filter.onChange({ ...filter.value, field: event.target.value })}
                        >
                            <option value="">{texts.fieldFilterAny}</option>
                            {filter.fields.map(group => (
                                <optgroup key={group.label} label={group.label}>
                                    {group.choices.map(choice => (
                                        <option key={choice.value} value={choice.value}>
                                            {choice.label}
                                        </option>
                                    ))}
                                </optgroup>
                            ))}
                        </select>
                    )}
                    <span className="mxgantt-filter-status" role="status" aria-live="polite">
                        {filter.status}
                    </span>
                </div>
            )}
        </div>
    );
}
