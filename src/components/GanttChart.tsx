import classNames from "classnames";
import {
    CSSProperties,
    FocusEvent,
    KeyboardEvent,
    MouseEvent,
    PointerEvent,
    ReactElement,
    ReactNode,
    UIEvent,
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState
} from "react";

import {
    addWorkingTime,
    isWorkingDay,
    moveLike,
    nonWorkingDays,
    parseIsoDate,
    rollToWorkingDay,
    WorkCalendar,
    workingDaysBetween
} from "../utils/calendar";
import { ThemeSetting, useDarkMode } from "../hooks/useDarkMode";
import {
    ATTRIBUTE_BASELINE,
    baselineNames,
    baselineOf,
    compareBaselines,
    deleteBaseline,
    formatBaselines,
    saveBaseline,
    withBaseline
} from "../utils/baselines";
import { Constraint, constraintConflict, constrainSpan, isFixed, schedulePlan } from "../utils/constraints";
import { CostSettings, earnedFrom, EarnedValue, projectEarnedValue, sCurve, taskCost } from "../utils/cost";
import { levelResources } from "../utils/leveling";
import { ImportedPlan, importMspdi, ImportError, MAX_IMPORT_BYTES } from "../utils/mspdiImport";
import { projectSummaries } from "../utils/portfolio";
import {
    assignmentsOf,
    formatAssignments,
    invalidAssignments,
    parseAssignments,
    ResourceInfo,
    resourceUsage
} from "../utils/resources";
import {
    formatSegments,
    joinSegments,
    moveSegment,
    rebaseSegments,
    Segment,
    segmentSpans,
    spanDays,
    splitAt,
    workDays
} from "../utils/segments";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { csvDate, toCsv } from "../utils/csv";
import {
    addDependency,
    autoSchedule,
    formatLag,
    parseDependencies,
    placeAt,
    removeDependency,
    Span
} from "../utils/deps";
import { applyDrag, DragMode, keyEdit, sameSchedule, Schedule, shift, snapToCalendar } from "../utils/drag";
import { buildSvg, downloadBlob, ExportHeader, ExportPalette, printSvg, svgToPng } from "../utils/export";
import { filterTasks, isFiltering, NO_FILTER, TaskFilter } from "../utils/filter";
import { barBox, HEADER_HEIGHT, milestoneBox, visibleRange } from "../utils/geometry";
import { EMPTY_HISTORY, HistoryState, record, redo, TaskValues, undo } from "../utils/history";
import { buildMspdi, planSheet } from "../utils/planExport";
import {
    applyScenario,
    mergeScenario,
    ScenarioMap,
    scenarioChanges,
    scenarioSummary,
    taskValues
} from "../utils/scenario";
import { behindTasks, dependencyChain, expectedProgress } from "../utils/status";
import {
    deadlineOverrun,
    fitZoom,
    Health,
    Marker,
    missesDeadline,
    MotionSetting,
    motionLevel,
    progressLinePoints,
    projectHealth,
    totalFloat
} from "../utils/plan";
import { HealthStrip } from "./HealthStrip";
import { loadView, saveView, ViewState } from "../utils/storage";
import {
    buildLinks,
    buildRows,
    clampProgress,
    criticalTasks,
    groupRowId,
    isMilestone,
    isPortfolio,
    Link,
    projectId,
    linkType,
    Row,
    rowIndexOf,
    Task,
    taskBounds,
    variance
} from "../utils/tasks";
import { fill, Texts } from "../utils/texts";
import {
    addDays,
    DAY,
    dateToX,
    makeFormatters,
    scaleCells,
    scaleWidth,
    Snap,
    startOfDay,
    timelineRange,
    weekendSpans,
    xToDate,
    Zoom,
    ZOOMS
} from "../utils/time";
import { wbsNumbers } from "../utils/wbs";
import {
    aggregate,
    CellRaw,
    cellKey,
    defaultAlign,
    encodeCell,
    LayoutColumn,
    nextSort,
    parseCell,
    pinLeading,
    sortByValue,
    SortState
} from "../utils/layout";
import { labelText, STANDARD_LOOK, TimelineLook } from "../utils/look";
import { workload } from "../utils/workload";
import { buildXlsx, XLSX_MIME } from "../utils/xlsx";
import { BaselinePanel } from "./BaselinePanel";
import { Dialog } from "./Dialog";
import { EarnedValuePanel } from "./EarnedValuePanel";
import { Panel } from "./Panel";
import { PortfolioPanel } from "./PortfolioPanel";
import { ResourcePanel } from "./ResourcePanel";
import { Menu, MenuItem } from "./Menu";
import { CommitHow, EditingCell, EditKind, ListColumn, TaskList } from "./TaskList";
import {
    ChooserColumn,
    ColumnsPanel,
    decodeEdit,
    encodeEdit,
    FieldCell,
    FieldForm,
    FieldsHint,
    OptionChip
} from "./CustomFields";
import {
    convertField,
    evaluateFormula,
    exportValue,
    FieldDef,
    FieldValue,
    filterChoices,
    formatNumberValue,
    formatValue,
    formulaInputs,
    isoDay,
    matchesFieldFilter,
    moveKey,
    optionOf,
    orderColumns,
    readValue,
    typeInfo,
    withFieldValue
} from "../utils/fields";
import { Timeline } from "./Timeline";
import { Toolbar } from "./Toolbar";
import { WorkloadPanel } from "./WorkloadPanel";

export type CriticalMode = "none" | "off" | "on";
export type AutoMode = "none" | "off" | "on";

/** One task's new values and what they were, as handed to the widget to write. */
export interface TaskChange {
    id: string;
    next: TaskValues;
    previous: TaskValues;
}

export interface ExtraColumn {
    title: string;
    width: number;
    align: "left" | "center" | "right";
}

export interface GanttChartProps {
    tasks: Task[];
    loading: boolean;
    texts: Texts;
    initialZoom: Zoom;
    snap: Snap;
    rowHeight: number;
    height: number;
    gridWidth: number;
    showGrid: boolean;
    showToolbar: boolean;
    showToday: boolean;
    showWeekends: boolean;
    showLinks: boolean;
    criticalMode: CriticalMode;
    allowExport: boolean;
    exportFileName: string;
    hasProgress: boolean;
    /** Light, dark, or automatic (follows the page background around the widget). */
    theme: ThemeSetting;
    locale?: string;
    className?: string;
    style?: CSSProperties;
    onChange: (changes: TaskChange[]) => void;
    onClick?: (id: string) => void;

    // 2.0: every option below defaults to off, which is exactly the 1.0 behaviour.
    calendar: WorkCalendar;
    snapWorkingDays: boolean;
    autoSchedule: AutoMode;
    allowUndo: boolean;
    inlineEdit: boolean;
    canEditName: boolean;
    /** Key and Depends on are both set. */
    hasDependencies: boolean;
    linkEditing: boolean;
    hasBaseline: boolean;
    hasAssignee: boolean;
    showWbs: boolean;
    showVariance: boolean;
    columnChooser: boolean;
    columnResize: boolean;
    extraColumns: ExtraColumn[];
    showWorkload: boolean;
    workloadCapacity: number;
    showFilter: boolean;
    me?: string;
    exportCsv: boolean;
    printDetails: boolean;
    exportTitle: string;
    /** Where the view is remembered, when it is. */
    viewKey?: string;
    assigneeColors?: ReadonlyMap<string, string>;
    paging?: { shown: number; total?: number; hasMore: boolean; onLoadMore: () => void };
    onAdd?: (suggestion: { start: Date; end: Date }) => void;
    onDelete?: (id: string) => void;

    // 2.1: every option below except animate defaults to off.
    /** Adds the Plan a scenario toggle: changes stay in the widget until applied. */
    scenarioMode?: boolean;
    showStatusLine?: boolean;
    /** Colours bars whose progress is below what the status date expects (needs progress). */
    highlightBehind?: boolean;
    /** The date progress is measured against; the start of today when left out. */
    statusDate?: Date;
    /** Intro, zoom and hover motion; reduced motion in the OS always wins. */
    animate?: boolean;
    exportExcel?: boolean;
    exportProject?: boolean;

    // 2.2: every option below defaults to off (motion to full, the 2.1 behaviour with animations on).
    hasDeadline?: boolean;
    showSlack?: boolean;
    progressLine?: boolean;
    markers?: Marker[];
    zoomToFit?: boolean;
    showHealth?: boolean;
    motion?: MotionSetting;

    // 2.3: every option below defaults to off.
    /** The Assignments attribute is set: a Resources column that can be edited. */
    hasAssignments?: boolean;
    /** Maximum units and cost rates by resource name. */
    resources?: ReadonlyMap<string, ResourceInfo>;
    showResources?: boolean;
    resourceLeveling?: boolean;
    hoursPerDay?: number;
    /** Costs are configured (fixed cost, actual cost or rates). */
    hasCost?: boolean;
    showEarnedValue?: boolean;
    costColumns?: boolean;
    /** ISO 4217 code such as EUR; plain numbers without one. */
    currency?: string;
    /** The Baselines (JSON) attribute is set. */
    hasBaselines?: boolean;
    baselineEditing?: boolean;
    defaultBaseline?: string;
    /** The Segments attribute is set: tasks can be split. */
    hasSegments?: boolean;
    hasConstraints?: boolean;
    scheduleButton?: boolean;
    /** MS Project import: hands the parsed plan to the app. */
    onImport?: (plan: ImportedPlan) => void;
    showPortfolio?: boolean;
    /** Writes in flight or failed, from the widget. */
    saveState?: SaveState;

    // 1.1
    /** Custom fields: set when the app turned them on and configured both attributes. */
    customFields?: CustomFieldsSetup;

    // 1.2
    /** The configured columns after Task name; undefined keeps the classic columns. */
    layout?: LayoutColumn[];
    /** Users can sort by Task name. */
    nameSortable?: boolean;

    // 1.3
    /** Portfolio timeline display options; missing means the standard look. */
    look?: TimelineLook;
}

export interface CustomFieldsSetup {
    fields: FieldDef[];
    /** The user may add, change and delete fields. */
    canManage: boolean;
    /** Values can be written (the Task values attribute is set); each task's Editable still applies. */
    canEditValues: boolean;
    maxFields: number;
    /** Show the first-time hint while there are no fields. */
    showHint: boolean;
    onFieldsChange: (fields: FieldDef[]) => void;
}

const NO_FIELDS: FieldDef[] = [];

export interface SaveState {
    saving: boolean;
    /** Number of changes that failed and were rolled back. */
    failed: number;
    onRetry: () => void;
    onDismiss: () => void;
}

/** A proposed set of moves (resource levelling or Schedule plan) shown on the chart until applied. */
interface Proposal {
    kind: "level" | "schedule";
    moved: ReadonlyMap<string, Span>;
    lines: string[];
}

type ChartDragMode = DragMode | "link" | "segment";

interface DragState {
    id: string;
    mode: ChartDragMode;
    x0: number;
    pointerId: number;
    original: Schedule;
    barWidth: number;
    editable: boolean;
    moved: boolean;
    current?: Schedule;
    /** 2.3: the segment being dragged, and the segments it leads to. */
    segment?: number;
    segments?: { value: Segment[] | undefined };
}

interface Preview {
    id: string;
    schedule: Schedule;
    /** Successors auto-scheduling would move, shown while dragging. */
    pushed: ReadonlyMap<string, Span>;
    /** 2.3: the dragged task's segments while a segment is dragged. */
    segments?: { value: Segment[] | undefined };
}

type DialogState =
    | { kind: "help" }
    | { kind: "delete"; id: string }
    | { kind: "discard" }
    | { kind: "deleteBaseline"; name: string }
    | { kind: "import"; plan: ImportedPlan }
    | { kind: "deleteField"; key: string };

const GRID_MIN = 160;
const GRID_MAX = 1200;
const KEY_COMMIT_DELAY = 700;
const NO_PUSH: ReadonlyMap<string, Span> = new Map();
const NONE: ReadonlySet<string> = new Set();
/** Columns that exist only for the column chooser until a user shows them. */
const HIDDEN_BY_DEFAULT = ["baselineStart", "baselineEnd", "predecessors"];
/** 2.3 cost columns that start hidden (in the column chooser); views saved before 2.3 get them hidden too. */
const HIDDEN_23 = ["bac", "pv", "ac", "cv", "sv", "eac", "etc", "vac"];
const COST_KEYS = ["cost", "bac", "pv", "ev", "ac", "cv", "sv", "cpi", "spi", "eac", "etc", "vac"] as const;
type CostKey = (typeof COST_KEYS)[number];
/** How long the intro (bars growing in, arrows drawing in) may run after the first tasks show. */
const INTRO_TIME = 1600;
const ZOOM_TIME = 320;

/** A callback with a stable identity that always runs the latest version, so memoised panels do not re-render. */
function useStable<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    const ref = useRef(fn);
    useLayoutEffect(() => {
        ref.current = fn;
    });
    return useCallback((...args: A) => ref.current(...args), []);
}

function scheduleOf(task: Task): Schedule | undefined {
    return task.start && task.end ? { start: task.start, end: task.end, progress: task.progress } : undefined;
}

/** A date as the value of a date or datetime-local input, in local time. */
function inputValue(date: Date | undefined, withTime: boolean): string {
    if (!date) {
        return "";
    }
    const pad = (n: number): string => String(n).padStart(2, "0");
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    return withTime ? `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}` : day;
}

/** Reads a date or datetime-local input; a plain date keeps the original time of day. */
function readInput(text: string, original: Date | undefined, withTime: boolean): Date | undefined {
    const timed = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(text);
    if (withTime && timed) {
        const [, y, m, d, h, min] = timed.map(Number);
        const date = new Date(y, m - 1, d, h, min);
        return date.getMonth() === m - 1 ? date : undefined;
    }
    const day = parseIsoDate(text.slice(0, 10));
    if (!day) {
        return undefined;
    }
    if (original) {
        day.setHours(original.getHours(), original.getMinutes(), original.getSeconds(), original.getMilliseconds());
    }
    return day;
}

const valuesOf = taskValues;

/** Only the fields a schedule change actually changed. */
function scheduleDiff(next: Schedule, previous: Schedule): TaskValues {
    const values: TaskValues = {};
    if (next.start.getTime() !== previous.start.getTime()) {
        values.start = next.start;
    }
    if (next.end.getTime() !== previous.end.getTime()) {
        values.end = next.end;
    }
    if (next.progress !== undefined && next.progress !== previous.progress) {
        values.progress = next.progress;
    }
    return values;
}

export function GanttChart(props: GanttChartProps): ReactElement {
    const { texts, snap, rowHeight: rh, calendar } = props;
    const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
    const helpId = `mxgantt-${uid}-help`;
    const tipId = `mxgantt-${uid}-tip`;

    const [savedView] = useState<ViewState>(() => (props.viewKey ? loadView(props.viewKey) : {}));
    const [zoom, setZoom] = useState<Zoom>(props.initialZoom);
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set(savedView.collapsed ?? []));
    const defaultHidden = (): string[] =>
        props.layout
            ? // 1.2 configured columns: the ones set to Shown at first = No.
              props.layout.filter(entry => !entry.visible).map(entry => entry.key)
            : [...(props.showVariance ? HIDDEN_BY_DEFAULT : [...HIDDEN_BY_DEFAULT, "variance"]), ...HIDDEN_23];
    const [hiddenColumns, setHiddenColumns] = useState<ReadonlySet<string>>(() => {
        if (!savedView.hidden) {
            return new Set(defaultHidden());
        }
        if (props.layout) {
            // Columns added to the list since the view was saved start the way the developer set them.
            const known = new Set(savedView.known ?? []);
            return new Set([...savedView.hidden, ...defaultHidden().filter(key => !known.has(key))]);
        }
        return new Set(savedView.v23 ? savedView.hidden : [...savedView.hidden, ...HIDDEN_23]);
    });
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => savedView.widths ?? {});
    // 1.1 custom fields: the user's column order, the Add / Edit field popover, the first-time hint.
    const [columnOrder, setColumnOrder] = useState<string[]>(() => savedView.order ?? []);
    // 1.2: the header the tasks are sorted by.
    const [sort, setSort] = useState<SortState | undefined>(() => savedView.sort);
    const [fieldForm, setFieldForm] = useState<{ key?: string; anchor?: DOMRect }>();
    const hintKey = `mxgantt-fields-hint:${props.viewKey ?? "chart"}`;
    const [hintDismissed, setHintDismissed] = useState(() => {
        try {
            return window.localStorage.getItem(hintKey) === "1";
        } catch {
            return false;
        }
    });
    const [gridWidth, setGridWidth] = useState(() => Math.max(GRID_MIN, Math.min(GRID_MAX, props.gridWidth)));
    const [showCritical, setShowCritical] = useState(props.criticalMode === "on");
    const [autoOn, setAutoOn] = useState(props.autoSchedule === "on");
    const [filter, setFilter] = useState<TaskFilter>(NO_FILTER);
    const [history, setHistory] = useState<HistoryState>(EMPTY_HISTORY);
    const [editing, setEditing] = useState<EditingCell>();
    const [menu, setMenu] = useState<{ id: string; x: number; y: number }>();
    const [linking, setLinking] = useState<string>();
    const [linkDraft, setLinkDraft] = useState<{ x1: number; y1: number; x2: number; y2: number }>();
    const [dialog, setDialog] = useState<DialogState>();
    const [scroll, setScroll] = useState({ top: 0, left: 0 });
    const [viewport, setViewport] = useState({ width: 800, height: props.height, scrollbar: 0 });
    const [activeId, setActiveId] = useState<string>();
    const [preview, setPreview] = useState<Preview>();
    const [hoverId, setHoverId] = useState<string>();
    const [focusTipId, setFocusTipId] = useState<string>();
    const [announcement, setAnnouncement] = useState({ text: "", key: 0 });
    const [today, setToday] = useState(() => new Date());
    // A what-if scenario: the changes tried out so far, or undefined when no scenario is open.
    const [scenario, setScenario] = useState<ScenarioMap>();
    // The undo history from before the scenario, given back when it is applied or discarded.
    const [outerHistory, setOuterHistory] = useState<HistoryState>(EMPTY_HISTORY);
    const [intro, setIntro] = useState(true);
    // 2.3
    const [baselineChoice, setBaselineChoice] = useState<string | undefined>(() => savedView.baseline);
    const [baselineCompare, setBaselineCompare] = useState<string>(() => savedView.compare ?? "");
    const [baselinesOpen, setBaselinesOpen] = useState(false);
    const [proposal, setProposal] = useState<Proposal>();
    const [resourceFocus, setResourceFocus] = useState<string>();
    const [notice, setNotice] = useState<string>();
    const importInput = useRef<HTMLInputElement>(null);
    const revealAfterRender = useRef<string | null>(null);
    const reducedMotion = useReducedMotion();
    const motionLvl = motionLevel(props.motion, !!props.animate, reducedMotion);
    const motion = motionLvl !== "off";

    const rootRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<HTMLDivElement>(null);
    const dark = useDarkMode(props.theme, rootRef);
    const listRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<DragState | null>(null);
    const keyPending = useRef<{ id: string; schedule: Schedule; previous: Schedule } | null>(null);
    const keyTimer = useRef<number>(undefined);
    const anchorRef = useRef<{ date: Date; offsetX: number; fromPxPerDay: number } | null>(null);
    const pendingFocus = useRef<string | null>(null);
    const initialScroll = useRef(false);
    const scrollFrame = useRef(0);

    const announce = useCallback((text: string) => setAnnouncement(current => ({ text, key: current.key + 1 })), []);

    // Keep the today line honest on a page left open for hours.
    useEffect(() => {
        const timer = window.setInterval(() => setToday(new Date()), 60000);
        return () => window.clearInterval(timer);
    }, []);

    // The intro (bars growing in, arrows drawing in) plays once, when the first tasks show.
    const hasTasks = props.tasks.length > 0;
    useEffect(() => {
        if (!intro || !hasTasks) {
            return;
        }
        const timer = window.setTimeout(() => setIntro(false), motion ? INTRO_TIME : 0);
        return () => window.clearTimeout(timer);
    }, [intro, hasTasks, motion]);

    // Remember collapsed groups, hidden columns and widths for next time.
    const { viewKey } = props;
    const layoutKeys = useMemo(() => props.layout?.map(entry => entry.key), [props.layout]);
    useEffect(() => {
        if (viewKey) {
            saveView(viewKey, {
                collapsed: [...collapsed],
                hidden: [...hiddenColumns],
                widths: columnWidths,
                v23: true,
                ...(baselineChoice !== undefined ? { baseline: baselineChoice } : {}),
                ...(baselineCompare ? { compare: baselineCompare } : {}),
                ...(columnOrder.length > 0 ? { order: columnOrder } : {}),
                ...(sort ? { sort } : {}),
                ...(layoutKeys ? { known: layoutKeys } : {})
            });
        }
    }, [
        viewKey,
        collapsed,
        hiddenColumns,
        columnWidths,
        baselineChoice,
        baselineCompare,
        columnOrder,
        sort,
        layoutKeys
    ]);

    // ---------------------------------------------------------------- model

    // In a scenario everything below works on the scenario's copy of the tasks.
    const scenarioTasks = useMemo(() => applyScenario(props.tasks, scenario), [props.tasks, scenario]);
    // 2.3 named baselines: which one Baseline start / end show, and which one it is compared with.
    const namedBaselines = useMemo(
        () => (props.hasBaselines ? baselineNames(scenarioTasks) : []),
        [props.hasBaselines, scenarioTasks]
    );
    const defaultBaseline =
        props.defaultBaseline && namedBaselines.includes(props.defaultBaseline)
            ? props.defaultBaseline
            : props.hasBaseline
            ? ATTRIBUTE_BASELINE
            : namedBaselines[namedBaselines.length - 1] ?? "";
    const isKnownBaseline = (name: string): boolean =>
        name === ATTRIBUTE_BASELINE ? props.hasBaseline : namedBaselines.includes(name);
    const choiceValid = baselineChoice !== undefined && (baselineChoice === "" || isKnownBaseline(baselineChoice));
    const shownBaseline = props.hasBaselines
        ? choiceValid
            ? baselineChoice!
            : defaultBaseline
        : props.hasBaseline
        ? ATTRIBUTE_BASELINE
        : "";
    const compareWith =
        props.hasBaselines &&
        shownBaseline &&
        baselineCompare &&
        baselineCompare !== shownBaseline &&
        isKnownBaseline(baselineCompare)
            ? baselineCompare
            : "";
    const sourceTasks = useMemo(
        () => (props.hasBaselines ? scenarioTasks.map(task => withBaseline(task, shownBaseline)) : scenarioTasks),
        [props.hasBaselines, scenarioTasks, shownBaseline]
    );
    const hasBaseline = props.hasBaselines ? !!shownBaseline : props.hasBaseline;
    const scenarioIds = useMemo(
        () => (scenario ? new Set(scenarioChanges(props.tasks, scenario).map(change => change.id)) : NONE),
        [props.tasks, scenario]
    );
    const baseById = useMemo(() => new Map(sourceTasks.map(task => [task.id, task])), [sourceTasks]);
    const baseLinks = useMemo(() => buildLinks(sourceTasks, calendar), [sourceTasks, calendar]);
    const spans = useMemo(() => {
        const map = new Map<string, Span>();
        sourceTasks.forEach(task => {
            if (task.start && task.end) {
                map.set(task.id, { start: task.start, end: task.end });
            }
        });
        return map;
    }, [sourceTasks]);
    const locked = useMemo(
        () => new Set(sourceTasks.filter(task => !task.editable).map(task => task.id)),
        [sourceTasks]
    );
    const autoAvailable = props.autoSchedule !== "none" && props.hasDependencies;
    const autoActive = autoAvailable && autoOn;

    const previewed = useMemo(() => {
        if (!preview && !proposal) {
            return sourceTasks;
        }
        return sourceTasks.map(task => {
            if (preview && task.id === preview.id) {
                const next = { ...task, ...preview.schedule };
                if (preview.segments) {
                    next.segments = preview.segments.value;
                }
                return next;
            }
            const pushed = preview?.pushed.get(task.id) ?? proposal?.moved.get(task.id);
            return pushed ? { ...task, ...pushed } : task;
        });
    }, [sourceTasks, preview, proposal]);
    const allMap = useMemo(() => new Map(previewed.map(task => [task.id, task])), [previewed]);
    const allLinks = useMemo(
        () => (preview || proposal ? buildLinks(previewed, calendar) : baseLinks),
        [preview, proposal, previewed, calendar, baseLinks]
    );
    const criticalAvailable = props.criticalMode !== "none" && allLinks.length > 0;
    const needCritical = criticalAvailable && (showCritical || filter.critical);
    const criticalAll = useMemo(
        () => (needCritical ? criticalTasks(previewed, allLinks, undefined, calendar) : new Set<string>()),
        [needCritical, previewed, allLinks, calendar]
    );
    const critical = criticalAvailable && showCritical ? criticalAll : NONE;
    const wbsShown = props.layout ? props.layout.some(entry => entry.key === "wbs") : props.showWbs;
    const wbs = useMemo(
        () => (wbsShown || props.showFilter ? wbsNumbers(sourceTasks) : undefined),
        [wbsShown, props.showFilter, sourceTasks]
    );
    const customSetup = props.customFields;
    const fieldList = customSetup?.fields ?? NO_FIELDS;
    const fieldSearch = useCallback(
        (task: Task): string =>
            fieldList
                .filter(field => field.type !== "formula")
                .map(field =>
                    formatValue(field, task.fieldValues?.[field.key], { locale: props.locale, yes: texts.yes, no: "" })
                )
                .filter(Boolean)
                .join("\n"),
        [fieldList, props.locale, texts]
    );
    const fieldMatch = useCallback(
        (task: Task, value: string): boolean => matchesFieldFilter(value, fieldList, task.fieldValues),
        [fieldList]
    );
    const filtering = isFiltering(filter);
    const tasks = useMemo(
        () =>
            filtering
                ? filterTasks(previewed, filter, {
                      critical: criticalAll,
                      now: today,
                      me: props.me,
                      wbs,
                      calendar,
                      fieldText: fieldList.length > 0 ? fieldSearch : undefined,
                      fieldMatch
                  })
                : previewed,
        [filtering, previewed, filter, criticalAll, today, props.me, wbs, calendar, fieldList, fieldSearch, fieldMatch]
    );
    const taskMap = useMemo(
        () => (filtering ? new Map(tasks.map(task => [task.id, task])) : allMap),
        [filtering, tasks, allMap]
    );
    // Status date: what progress is measured against, the start of today unless the app sets one.
    const statusTime = props.statusDate?.getTime() ?? startOfDay(today).getTime();
    const statusDate = useMemo(() => new Date(statusTime), [statusTime]);
    const costSettings = useMemo<CostSettings>(
        () => ({ calendar, resources: props.resources, hoursPerDay: Math.max(1, props.hoursPerDay ?? 8) }),
        [calendar, props.resources, props.hoursPerDay]
    );
    /** The schedule (and stored cost) the budget was planned on: the baseline shown. */
    const planOf = useCallback(
        (task: Task) =>
            props.hasBaselines && shownBaseline && shownBaseline !== ATTRIBUTE_BASELINE
                ? baselineOf(task, shownBaseline)
                : task.baselineStart && task.baselineEnd
                ? { start: task.baselineStart, finish: task.baselineEnd }
                : undefined,
        [props.hasBaselines, shownBaseline]
    );
    // 1.2: with configured columns the cost columns come from the Columns list, not Cost columns.
    const costInList = props.layout ? props.layout.some(entry => entry.type === "cost") : !!props.costColumns;
    const needEarned = !!props.hasCost && (!!props.showEarnedValue || costInList || !!props.showPortfolio);
    const earned = useMemo(
        () => (needEarned ? projectEarnedValue(previewed, statusDate, costSettings, planOf) : undefined),
        [needEarned, previewed, statusDate, costSettings, planOf]
    );
    // 1.2: the sort the user chose with a sortable header; only in the view, and within groups.
    const sortable = useCallback(
        (key: string): boolean =>
            key === "name" ? !!props.nameSortable : !!props.layout?.some(entry => entry.key === key && entry.sortable),
        [props.layout, props.nameSortable]
    );
    const activeSort = sort && sortable(sort.key) ? sort : undefined;
    const sortValue = useCallback(
        (key: string, task: Task): CellRaw | undefined => {
            switch (key) {
                case "name":
                    return task.name;
                case "wbs":
                    return wbs?.get(task.id);
                case "start":
                    return task.start;
                case "end":
                    return task.end;
                case "duration":
                    return task.start && task.end ? workingDaysBetween(calendar, task.start, task.end) : undefined;
                case "progress":
                    return task.progress;
                case "assignee":
                    return task.assignee;
                case "assignments":
                    return task.assignmentsText;
                case "predecessors":
                    return task.depsText;
                case "baselineStart":
                    return task.baselineStart;
                case "baselineEnd":
                    return task.baselineEnd;
                case "variance":
                    return variance(task, calendar);
                case "cost":
                    return earned?.costs.get(task.id);
                default:
                    if ((COST_KEYS as readonly string[]).includes(key)) {
                        return earned?.perTask.get(task.id)?.[key as Exclude<CostKey, "cost">];
                    }
                    return task.cells?.[key]?.raw;
            }
        },
        [wbs, calendar, earned]
    );
    const sortedTasks = useMemo(
        () =>
            activeSort
                ? // The saved values decide, so rows do not jump around while a bar is dragged.
                  sortByValue(tasks, task => sortValue(activeSort.key, baseById.get(task.id) ?? task), activeSort.dir)
                : tasks,
        [tasks, activeSort, sortValue, baseById]
    );
    const rows = useMemo(() => buildRows(sortedTasks, collapsed), [sortedTasks, collapsed]);
    const rowIndex = useMemo(() => rowIndexOf(rows, taskMap), [rows, taskMap]);
    const links = useMemo(
        () => (filtering ? allLinks.filter(link => taskMap.has(link.from) && taskMap.has(link.to)) : allLinks),
        [filtering, allLinks, taskMap]
    );
    const conflicts = useMemo(() => new Set(allLinks.filter(link => link.conflict).map(link => link.to)), [allLinks]);
    const incoming = useMemo(() => {
        const map = new Map<string, Link[]>();
        allLinks.forEach(link => map.set(link.to, [...(map.get(link.to) ?? []), link]));
        return map;
    }, [allLinks]);
    const groupIds = useMemo(() => rows.filter(row => row.kind === "group").map(row => row.id), [rows]);

    const behind = useMemo(
        () => (props.highlightBehind ? behindTasks(previewed, statusDate, calendar) : NONE),
        [props.highlightBehind, previewed, statusDate, calendar]
    );
    // 2.2: total float, project health.
    const floats = useMemo(
        () => (props.showSlack ? totalFloat(previewed, allLinks, calendar) : undefined),
        [props.showSlack, previewed, allLinks, calendar]
    );
    const health = useMemo<Health | undefined>(() => {
        if (!props.showHealth) {
            return undefined;
        }
        const onPath = allLinks.length > 0 ? criticalTasks(previewed, allLinks, undefined, calendar) : NONE;
        return projectHealth(previewed, statusDate, onPath, calendar);
    }, [props.showHealth, previewed, allLinks, statusDate, calendar]);

    // Hovering a task lights up everything it depends on and everything depending on it.
    const chainId = props.animate && props.showLinks && !preview ? hoverId : undefined;
    const chain = useMemo(() => {
        if (!chainId) {
            return undefined;
        }
        const found = dependencyChain(allLinks, chainId);
        return found.links.size > 0 ? found : undefined;
    }, [chainId, allLinks]);
    const allCollapsed = groupIds.length > 0 && groupIds.every(id => collapsed.has(id));

    // The range follows the saved tasks, not the one being dragged, so the chart does not shift
    // under the pointer mid-drag.
    const bounds = useMemo(() => taskBounds(sourceTasks), [sourceTasks]);
    const minTime = bounds.min?.getTime();
    const maxTime = bounds.max?.getTime();
    const dayKey = startOfDay(today).getTime();
    const viewportWidth = viewport.width;
    const scale = useMemo(() => {
        const range = timelineRange(
            minTime === undefined ? undefined : new Date(minTime),
            maxTime === undefined ? undefined : new Date(maxTime),
            new Date(dayKey),
            zoom,
            snap
        );
        // Fill the view: a short plan at quarter zoom would otherwise stop halfway across.
        const fillEnd = range.start.getTime() + (viewportWidth / range.pxPerDay) * DAY;
        return fillEnd > range.end.getTime() ? { ...range, end: new Date(fillEnd) } : range;
    }, [minTime, maxTime, dayKey, zoom, snap, viewportWidth]);
    const formats = useMemo(() => makeFormatters(props.locale), [props.locale]);
    const cells = useMemo(() => {
        const result = scaleCells(zoom, scale, formats);
        if (!calendar.active || zoom !== "day") {
            return result;
        }
        // With a working calendar the day headers shade non-working days, holidays included.
        return {
            top: result.top,
            bottom: result.bottom.map(cell => ({
                ...cell,
                weekend: !isWorkingDay(calendar, new Date(Number(cell.key)))
            }))
        };
    }, [zoom, scale, formats, calendar]);
    const width = Math.ceil(scaleWidth(scale));
    // Event listeners registered once read the current scale and zoom through these.
    const scaleRef = useRef(scale);
    const zoomRef = useRef(zoom);
    useLayoutEffect(() => {
        scaleRef.current = scale;
        zoomRef.current = zoom;
    });

    const numberFormat = useMemo(() => {
        try {
            return new Intl.NumberFormat(props.locale, { maximumFractionDigits: 1 });
        } catch {
            return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
        }
    }, [props.locale]);
    const formatDate = useCallback(
        (date: Date | undefined) => (date ? (snap === "hour" ? formats.dateTime(date) : formats.date(date)) : ""),
        [formats, snap]
    );
    const formatNumber = useCallback((value: number) => numberFormat.format(value), [numberFormat]);
    // 1.3: the text after each bar; undefined keeps the name and progress.
    const look = props.look ?? STANDARD_LOOK;
    const barText = labelText(look, formats.date, props.locale);
    // The progress and remaining swatches take the first Status colour: the normal bar colour when one is listed.
    const legendColor = look.states[0]
        ? ({ "--mxgantt-task-color": look.states[0].color } as CSSProperties)
        : undefined;
    /** Duration in days, working days with a calendar. */
    const durationOf = useCallback(
        (start: Date, end: Date): number => workingDaysBetween(calendar, start, end),
        [calendar]
    );
    const formatDays = useCallback(
        (days: number) => fill(texts.days, { n: numberFormat.format(days) }),
        [numberFormat, texts]
    );
    const formatDuration = useCallback(
        (start: Date | undefined, end: Date | undefined) => {
            if (!start || !end) {
                return "";
            }
            const days = durationOf(start, end);
            if (snap === "hour" && days < 1) {
                return fill(texts.hours, { n: numberFormat.format(days * 24) });
            }
            return formatDays(days);
        },
        [numberFormat, snap, texts, durationOf, formatDays]
    );
    const varianceText = useCallback(
        (task: Task, signed: boolean): string => {
            const value = variance(task, calendar);
            if (value === undefined) {
                return "";
            }
            if (signed) {
                return `${value > 0 ? "+" : ""}${numberFormat.format(value)}`;
            }
            return value > 0
                ? fill(texts.tipLate, { n: formatDays(value) })
                : value < 0
                ? fill(texts.tipEarly, { n: formatDays(-value) })
                : texts.tipOnTime;
        },
        [calendar, numberFormat, texts, formatDays]
    );

    const rangeOf = (row: Row): { start?: Date; end?: Date; progress?: number; name: string } =>
        row.kind === "group"
            ? { start: row.start, end: row.end, progress: row.progress, name: row.name }
            : { start: row.task.start, end: row.task.end, progress: row.task.progress, name: row.task.name };

    // ---------------------------------------------------------------- 2.3 model: constraints, resources, cost, portfolio

    const constraintText = useCallback(
        (constraint: Constraint): string =>
            `${texts[`constraint${constraint.type}` as keyof Texts]}${
                constraint.date ? ` ${formatDate(constraint.date)}` : ""
            }`,
        [texts, formatDate]
    );
    const constraintInfo = useMemo(() => {
        if (!props.hasConstraints) {
            return undefined;
        }
        const map = new Map<string, { broken: boolean; label: string; days?: number }>();
        previewed.forEach(task => {
            if (!task.constraint || task.constraint.type === "ASAP") {
                return;
            }
            const conflict = constraintConflict(task, task.constraint, calendar);
            const label = constraintText(task.constraint);
            map.set(task.id, {
                broken: !!conflict,
                label: conflict
                    ? `${label}. ${fill(texts.constraintBroken, { days: formatNumber(conflict.days) })}`
                    : label,
                days: conflict?.days
            });
        });
        return map;
    }, [props.hasConstraints, previewed, calendar, constraintText, texts, formatNumber]);
    /** Auto-scheduling asks each pushed task's constraint where it may go. */
    const adjustForConstraint = useMemo(
        () =>
            props.hasConstraints
                ? (id: string, span: Span): Span | undefined => {
                      const constraint = baseById.get(id)?.constraint;
                      return isFixed(constraint) ? undefined : constrainSpan(span, constraint, calendar);
                  }
                : undefined,
        [props.hasConstraints, baseById, calendar]
    );

    const hasResourceData = !!props.hasAssignments || props.hasAssignee;
    const usage = useMemo(
        () =>
            (props.showResources || props.resourceLeveling) && hasResourceData
                ? resourceUsage(
                      previewed,
                      scale.start,
                      scale.end,
                      zoom === "day" ? "day" : "week",
                      calendar,
                      props.resources
                  )
                : undefined,
        [
            props.showResources,
            props.resourceLeveling,
            hasResourceData,
            previewed,
            scale,
            zoom,
            calendar,
            props.resources
        ]
    );
    const overallocated = useMemo<ReadonlySet<string>>(
        () => (usage && props.showResources ? new Set(usage.overallocated.keys()) : NONE),
        [usage, props.showResources]
    );
    const focusChain = useMemo(() => {
        if (!resourceFocus) {
            return undefined;
        }
        const ids = previewed
            .filter(task => assignmentsOf(task).some(entry => entry.resource === resourceFocus))
            .map(task => task.id);
        return { tasks: new Set(ids), links: new Set<string>() };
    }, [resourceFocus, previewed]);

    const curve = useMemo(
        () =>
            props.hasCost && props.showEarnedValue ? sCurve(previewed, statusDate, costSettings, planOf) : undefined,
        [props.hasCost, props.showEarnedValue, previewed, statusDate, costSettings, planOf]
    );
    /** Earned value of group and project rows: the sums of their tasks. */
    const groupEarned = useMemo(() => {
        if (!earned || !costInList) {
            return undefined;
        }
        const sums = new Map<string, { bac: number; pv: number; ev: number; ac: number; cost: number }>();
        const add = (key: string | undefined, value: EarnedValue, cost: number): void => {
            if (!key) {
                return;
            }
            const sum = sums.get(key) ?? { bac: 0, pv: 0, ev: 0, ac: 0, cost: 0 };
            sum.bac += value.bac;
            sum.pv += value.pv;
            sum.ev += value.ev;
            sum.ac += value.ac;
            sum.cost += cost;
            sums.set(key, sum);
        };
        previewed.forEach(task => {
            const value = earned.perTask.get(task.id);
            if (value) {
                const cost = earned.costs.get(task.id) ?? 0;
                add(groupRowId(task), value, cost);
                add(task.project ? projectId(task.project) : undefined, value, cost);
            }
        });
        const result = new Map<string, EarnedValue & { cost: number }>();
        sums.forEach((sum, key) => result.set(key, { ...earnedFrom(sum.bac, sum.pv, sum.ev, sum.ac), cost: sum.cost }));
        return result;
    }, [earned, costInList, previewed]);
    const moneyFormat = useMemo(() => {
        const options: Intl.NumberFormatOptions = { maximumFractionDigits: 0 };
        if (props.currency) {
            options.style = "currency";
            options.currency = props.currency.trim().toUpperCase();
        }
        try {
            return new Intl.NumberFormat(props.locale, options);
        } catch {
            return new Intl.NumberFormat(props.locale, { maximumFractionDigits: 0 });
        }
    }, [props.currency, props.locale]);
    const formatMoney = useCallback((value: number) => moneyFormat.format(value), [moneyFormat]);

    const portfolio = isPortfolio(previewed);
    const projects = useMemo(() => {
        if (!props.showPortfolio || !portfolio) {
            return undefined;
        }
        const onPath = allLinks.length > 0 ? criticalTasks(previewed, allLinks, undefined, calendar) : NONE;
        return projectSummaries(previewed, {
            statusDate,
            calendar,
            critical: onPath,
            overallocated: usage ? new Set(usage.overallocated.keys()) : undefined,
            links: allLinks,
            earned: earned?.perTask
        });
    }, [props.showPortfolio, portfolio, previewed, allLinks, calendar, statusDate, usage, earned]);
    const comparison = useMemo(
        () => (compareWith ? compareBaselines(sourceTasks, shownBaseline, compareWith, calendar) : undefined),
        [compareWith, sourceTasks, shownBaseline, calendar]
    );

    // ---------------------------------------------------------------- columns

    /** A formula field's result for a task: other fields plus Duration, Done and Cost. */
    const formulaOf = useCallback(
        (field: FieldDef, task: Task): number | undefined =>
            evaluateFormula(
                field.formula ?? "",
                formulaInputs(fieldList, task.fieldValues ?? {}, {
                    _duration: task.start && task.end ? durationOf(task.start, task.end) : undefined,
                    _progress: task.progress,
                    _cost: earned?.costs.get(task.id) ?? task.fixedCost
                })
            ),
        [fieldList, durationOf, earned]
    );
    /** A custom field value as plain text (list, tooltip, CSV, print). */
    const fieldText = useCallback(
        (field: FieldDef, task: Task): string => {
            if (field.type === "formula") {
                const value = formulaOf(field, task);
                return value === undefined ? "" : formatNumberValue(field, value, props.locale);
            }
            return formatValue(field, task.fieldValues?.[field.key], { locale: props.locale, yes: texts.yes, no: "" });
        },
        [formulaOf, props.locale, texts]
    );

    /** 1.2: group and project totals of the configured attribute columns, over the tasks shown. */
    const layoutTotals = useMemo(() => {
        const totalled = (props.layout ?? []).filter(entry => entry.type === "attribute" && entry.total !== "none");
        if (totalled.length === 0) {
            return undefined;
        }
        const buckets = new Map<string, Map<string, Array<CellRaw | undefined>>>();
        const add = (rowId: string | undefined, key: string, value: CellRaw | undefined): void => {
            if (!rowId) {
                return;
            }
            const byKey = buckets.get(rowId) ?? new Map<string, Array<CellRaw | undefined>>();
            byKey.set(key, [...(byKey.get(key) ?? []), value]);
            buckets.set(rowId, byKey);
        };
        tasks.forEach(task =>
            totalled.forEach(entry => {
                const value = task.cells?.[entry.key]?.raw;
                add(groupRowId(task), entry.key, value);
                add(task.project ? projectId(task.project) : undefined, entry.key, value);
            })
        );
        const result = new Map<string, Map<string, number | undefined>>();
        buckets.forEach((byKey, rowId) => {
            const totals = new Map<string, number | undefined>();
            totalled.forEach(entry => totals.set(entry.key, aggregate(byKey.get(entry.key) ?? [], entry.total)));
            result.set(rowId, totals);
        });
        return result;
    }, [props.layout, tasks]);

    const allColumns = useMemo<ListColumn[]>(() => {
        const withTime = snap === "hour";
        const dateKind = withTime ? "datetime" : "date";
        const task = (row: Row): Task | undefined => (row.kind === "task" ? row.task : undefined);
        const costTitles: Record<CostKey, string> = {
            cost: texts.colCost,
            bac: texts.colBac,
            pv: texts.colPv,
            ev: texts.colEv,
            ac: texts.colAc,
            cv: texts.colCv,
            sv: texts.colSv,
            cpi: texts.colCpi,
            spi: texts.colSpi,
            eac: texts.colEac,
            etc: texts.colEtc,
            vac: texts.colVac
        };
        const costValue = (row: Row, key: CostKey): number | undefined => {
            if (!earned) {
                return undefined;
            }
            if (row.kind === "group") {
                const sum = groupEarned?.get(row.id);
                return sum ? sum[key] : undefined;
            }
            if (key === "cost") {
                return earned.costs.get(row.id);
            }
            return earned.perTask.get(row.id)?.[key];
        };
        const costColumn = (key: CostKey): ListColumn => {
            const ratio = key === "cpi" || key === "spi";
            return {
                key,
                title: costTitles[key],
                width: ratio ? 56 : 92,
                align: "right",
                text: row => {
                    const value = costValue(row, key);
                    return value === undefined ? "" : ratio ? value.toFixed(2) : formatMoney(value);
                },
                csv: row => costValue(row, key) ?? ""
            };
        };

        /** A built-in column; undefined when the attributes it needs are not set. */
        const builtIn = (key: string): ListColumn | undefined => {
            switch (key) {
                case "wbs":
                    return {
                        key: "wbs",
                        title: texts.colWbs,
                        width: 56,
                        align: "left",
                        text: row => wbs?.get(row.id) ?? ""
                    };
                case "start":
                    return {
                        key: "start",
                        title: texts.colStart,
                        width: 98,
                        align: "left",
                        text: row => formatDate(rangeOf(row).start),
                        csv: row => csvDate(rangeOf(row).start, withTime),
                        edit: { kind: dateKind, value: t => inputValue(t.start, withTime) }
                    };
                case "end":
                    return {
                        key: "end",
                        title: texts.colEnd,
                        width: 98,
                        align: "left",
                        text: row => formatDate(rangeOf(row).end),
                        csv: row => csvDate(rangeOf(row).end, withTime),
                        edit: { kind: dateKind, value: t => inputValue(t.end, withTime) }
                    };
                case "duration":
                    return {
                        key: "duration",
                        title: texts.colDuration,
                        width: 64,
                        align: "right",
                        text: row => formatDuration(rangeOf(row).start, rangeOf(row).end),
                        csv: row => {
                            const range = rangeOf(row);
                            return range.start && range.end ? durationOf(range.start, range.end) : "";
                        },
                        edit: {
                            kind: "number",
                            value: t => (t.start && t.end ? String(durationOf(t.start, t.end)) : "")
                        }
                    };
                case "progress":
                    return props.hasProgress
                        ? {
                              key: "progress",
                              title: texts.colProgress,
                              width: 52,
                              align: "right",
                              text: row => {
                                  const progress = rangeOf(row).progress;
                                  return progress === undefined ? "" : `${progress}%`;
                              },
                              csv: row => rangeOf(row).progress ?? "",
                              edit: { kind: "number", value: t => String(t.progress ?? 0) }
                          }
                        : undefined;
                case "assignee":
                    return props.hasAssignee
                        ? {
                              key: "assignee",
                              title: texts.colAssignee,
                              width: 110,
                              align: "left",
                              text: row => task(row)?.assignee ?? ""
                          }
                        : undefined;
                case "baselineStart":
                    return hasBaseline
                        ? {
                              key: "baselineStart",
                              title: texts.colBaselineStart,
                              width: 98,
                              align: "left",
                              text: row => formatDate(task(row)?.baselineStart),
                              csv: row => csvDate(task(row)?.baselineStart, withTime)
                          }
                        : undefined;
                case "baselineEnd":
                    return hasBaseline
                        ? {
                              key: "baselineEnd",
                              title: texts.colBaselineEnd,
                              width: 98,
                              align: "left",
                              text: row => formatDate(task(row)?.baselineEnd),
                              csv: row => csvDate(task(row)?.baselineEnd, withTime)
                          }
                        : undefined;
                case "variance":
                    return hasBaseline
                        ? {
                              key: "variance",
                              title: texts.colVariance,
                              width: 70,
                              align: "right",
                              text: row => {
                                  const t = task(row);
                                  return t ? varianceText(t, true) : "";
                              },
                              csv: row => {
                                  const t = task(row);
                                  return t ? variance(t, calendar) ?? "" : "";
                              }
                          }
                        : undefined;
                case "predecessors":
                    return props.hasDependencies
                        ? {
                              key: "predecessors",
                              title: texts.colPredecessors,
                              width: 100,
                              align: "left",
                              text: row => task(row)?.depsText ?? "",
                              edit: { kind: "text", value: t => t.depsText ?? "" }
                          }
                        : undefined;
                case "assignments":
                    return props.hasAssignments
                        ? {
                              key: "assignments",
                              title: texts.colAssignments,
                              width: 130,
                              align: "left",
                              text: row => task(row)?.assignmentsText ?? "",
                              edit: { kind: "text", value: t => t.assignmentsText ?? "" }
                          }
                        : undefined;
                default:
                    return earned && (COST_KEYS as readonly string[]).includes(key)
                        ? costColumn(key as CostKey)
                        : undefined;
            }
        };

        /** 1.2: an attribute column of the Columns list. */
        const attributeColumn = (entry: LayoutColumn, position: number): ListColumn => {
            const cellOf = (row: Row): { text?: string; raw?: CellRaw } | undefined =>
                row.kind === "task" ? row.task.cells?.[entry.key] : undefined;
            const total = (row: Row): number | undefined =>
                row.kind === "group" ? layoutTotals?.get(row.id)?.get(entry.key) : undefined;
            const totalText = (row: Row): string => {
                const value = total(row);
                if (value === undefined) {
                    return "";
                }
                return entry.total === "count" ? formatNumber(value) : entry.formatRaw?.(value) ?? String(value);
            };
            const withClock = entry.format !== "date";
            const editKind: EditKind =
                entry.valueType === "number"
                    ? "number"
                    : entry.valueType === "date"
                    ? withClock
                        ? "datetime"
                        : "date"
                    : entry.valueType === "boolean" || entry.valueType === "enum"
                    ? "select"
                    : "text";
            return {
                key: entry.key,
                title: fill(texts.colNumbered, { n: position + 1 }),
                width: 100,
                align: defaultAlign(entry.valueType),
                text: row => {
                    if (row.kind === "group") {
                        return totalText(row);
                    }
                    const cell = cellOf(row);
                    return cell ? cell.text ?? entry.formatRaw?.(cell.raw) ?? "" : "";
                },
                csv: row => {
                    if (row.kind === "group") {
                        return total(row) ?? "";
                    }
                    const raw = cellOf(row)?.raw;
                    if (raw === undefined || raw === null) {
                        return "";
                    }
                    if (raw instanceof Date) {
                        return csvDate(raw, withClock);
                    }
                    if (typeof raw === "boolean") {
                        return raw ? texts.yes : texts.no;
                    }
                    return raw;
                },
                edit: entry.editable
                    ? {
                          kind: editKind,
                          value: t => encodeCell(t.cells?.[entry.key]?.raw, entry.valueType, withClock),
                          options: entry.options,
                          signed: true
                      }
                    : undefined
            };
        };

        /** 1.2: the settings of a Columns item on top of the column it shows. */
        const configure = (base: ListColumn, entry: LayoutColumn): ListColumn => ({
            ...base,
            title: entry.title ?? base.title,
            hint: entry.tooltip ?? base.hint,
            // Sortable columns get room for the sort arrows unless the developer set a width.
            width: entry.width ?? base.width + (entry.sortable ? 14 : 0),
            minWidth: entry.minWidth,
            fill: entry.fill,
            align: entry.align ?? base.align,
            wrap: entry.wrap,
            hideable: entry.hideable,
            sortable: entry.sortable,
            layout: entry,
            cellClass: row => (row.kind === "task" ? row.task.cells?.[entry.key]?.cls : undefined)
        });

        const list: ListColumn[] = [];
        const push = (column: ListColumn | undefined): void => {
            if (column) {
                list.push(column);
            }
        };
        const nameColumn: ListColumn = {
            key: "name",
            title: texts.colTask,
            width: 0,
            align: "left",
            text: row => rangeOf(row).name,
            edit: { kind: "text", value: t => t.nameValue ?? t.name },
            hideable: false,
            sortable: !!props.nameSortable
        };
        if (props.layout) {
            // 1.2: Task name, then the Columns list in its order (a WBS number column moves before Task name).
            push(nameColumn);
            props.layout.forEach((entry, index) => {
                const base = entry.type === "attribute" ? attributeColumn(entry, index) : builtIn(entry.key);
                push(base ? configure(base, entry) : undefined);
            });
        } else {
            if (props.showWbs) {
                push(builtIn("wbs"));
            }
            push(nameColumn);
            push(builtIn("start"));
            push(builtIn("end"));
            push(builtIn("duration"));
            push(builtIn("progress"));
            push(builtIn("assignee"));
            push(builtIn("baselineStart"));
            push(builtIn("baselineEnd"));
            push(builtIn("variance"));
            push(builtIn("predecessors"));
            push(builtIn("assignments"));
            if (props.costColumns && earned) {
                COST_KEYS.forEach(key => push(costColumn(key)));
            }
            props.extraColumns.forEach((column, index) =>
                list.push({
                    key: `custom${index}`,
                    title: column.title,
                    width: column.width,
                    align: column.align,
                    text: row => task(row)?.columns?.[index] ?? ""
                })
            );
        }
        // 1.1 custom fields, after the app's columns.
        fieldList.forEach(field => {
            const info = typeInfo(field.type);
            const quickType = field.type === "checkbox" || field.type === "rating";
            list.push({
                key: `f:${field.key}`,
                title: field.name,
                width: field.width ?? info.width,
                align: field.align ?? info.align,
                icon: info.icon,
                hint: field.description ? `${field.name}: ${field.description}` : field.name,
                field,
                text: row => {
                    const t = task(row);
                    return t ? fieldText(field, t) : "";
                },
                csv: row => {
                    const t = task(row);
                    if (!t) {
                        return "";
                    }
                    if (field.type === "formula") {
                        return formulaOf(field, t) ?? "";
                    }
                    const value = exportValue(field, t.fieldValues?.[field.key], { yes: texts.yes, no: texts.no });
                    return value instanceof Date ? isoDay(value) : value ?? "";
                },
                render: (row, quick) =>
                    row.kind === "task" ? (
                        <FieldCell
                            field={field}
                            value={row.task.fieldValues?.[field.key]}
                            computed={field.type === "formula" ? formulaOf(field, row.task) : undefined}
                            texts={texts}
                            locale={props.locale}
                            onQuick={quickType ? quick : undefined}
                        />
                    ) : null,
                edit:
                    field.type === "formula"
                        ? undefined
                        : { kind: "field", value: t => encodeEdit(readValue(field, t.fieldValues?.[field.key])) },
                fieldValue: t => t.fieldValues?.[field.key],
                suggestions:
                    field.type === "person" || field.type === "text"
                        ? () => {
                              const seen = new Set<string>();
                              props.tasks.forEach(t => {
                                  const value = readValue(field, t.fieldValues?.[field.key]);
                                  if (typeof value === "string" && value.trim() && seen.size < 50) {
                                      seen.add(value.trim());
                                  }
                              });
                              return [...seen].sort((a, b) => a.localeCompare(b));
                          }
                        : undefined
            });
        });
        return list;
    }, [
        fieldList,
        fieldText,
        formulaOf,
        props.locale,
        props.tasks,
        texts,
        formatDate,
        formatDuration,
        formatNumber,
        durationOf,
        varianceText,
        props.hasProgress,
        props.hasAssignee,
        hasBaseline,
        props.hasDependencies,
        props.showWbs,
        props.extraColumns,
        props.layout,
        props.nameSortable,
        layoutTotals,
        snap,
        wbs,
        calendar,
        props.hasAssignments,
        props.costColumns,
        earned,
        groupEarned,
        formatMoney
    ]);

    // 1.2: Task name always comes first, with the WBS number right before it.
    const orderedColumns = useMemo(() => pinLeading(orderColumns(allColumns, columnOrder)), [allColumns, columnOrder]);
    const isShown = useCallback(
        (column: ListColumn): boolean => column.hideable === false || !hiddenColumns.has(column.key),
        [hiddenColumns]
    );
    const columns = useMemo<ListColumn[]>(() => {
        const shown = orderedColumns
            .filter(isShown)
            .map(column => ({ ...column, width: columnWidths[column.key] ?? column.width }));
        // Task name and the Fill free space columns the user has not resized share what is left.
        const flexible = new Set(
            shown
                .filter(column => (column.key === "name" || column.fill) && columnWidths[column.key] === undefined)
                .map(column => column.key)
        );
        const fixed = shown.reduce((sum, column) => (flexible.has(column.key) ? sum : sum + column.width), 0);
        const share = flexible.size > 0 ? (gridWidth - fixed) / flexible.size : 0;
        return shown.map(column => {
            if (!flexible.has(column.key)) {
                return column;
            }
            // With configured columns the list is usually full, so Task name keeps room for a readable name.
            const least =
                column.key === "name" ? (props.layout ? 180 : 120) : Math.max(column.minWidth ?? 40, column.width);
            return { ...column, width: Math.max(least, Math.floor(share)) };
        });
    }, [orderedColumns, isShown, columnWidths, gridWidth, props.layout]);

    const canEditValues = !!customSetup?.canEditValues;
    const canEdit = useCallback(
        (row: Row, column: ListColumn): boolean => {
            if (row.kind !== "task" || !column.edit || !row.task.editable) {
                return false;
            }
            // 1.1: custom field values are edited whenever the task can be, without Edit in task list.
            if (column.field) {
                return canEditValues && column.field.type !== "formula";
            }
            // 1.2: configured attribute columns are edited when the column is set to Editable.
            if (column.layout?.type === "attribute") {
                return column.layout.editable;
            }
            if (!props.inlineEdit) {
                return false;
            }
            const { task } = row;
            switch (column.key) {
                case "name":
                    return props.canEditName;
                case "predecessors":
                    return props.hasDependencies;
                case "assignments":
                    return !!props.hasAssignments;
                case "progress":
                    return props.hasProgress && !isMilestone(task);
                case "duration":
                    return !!task.start && !task.milestone;
                default:
                    return !!task.start;
            }
        },
        [
            props.inlineEdit,
            props.canEditName,
            props.hasDependencies,
            props.hasProgress,
            props.hasAssignments,
            canEditValues
        ]
    );

    // ---------------------------------------------------------------- layout and scrolling

    const bodyViewport = Math.max(0, viewport.height - HEADER_HEIGHT);
    const { first, last } = visibleRange(scroll.top, bodyViewport, rh, rows.length);

    useLayoutEffect(() => {
        const element = chartRef.current;
        if (!element) {
            return;
        }
        const measure = (): void =>
            setViewport(current => {
                const next = {
                    width: element.clientWidth,
                    height: element.clientHeight,
                    scrollbar: element.offsetHeight - element.clientHeight
                };
                return current.width === next.width &&
                    current.height === next.height &&
                    current.scrollbar === next.scrollbar
                    ? current
                    : next;
            });
        measure();
        if (typeof ResizeObserver === "undefined") {
            return;
        }
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [width]);

    const onChartScroll = (event: UIEvent<HTMLDivElement>): void => {
        const element = event.currentTarget;
        if (listRef.current && listRef.current.scrollTop !== element.scrollTop) {
            listRef.current.scrollTop = element.scrollTop;
        }
        // One state update per frame is plenty and keeps fast scrolling smooth.
        cancelAnimationFrame(scrollFrame.current);
        scrollFrame.current = requestAnimationFrame(() =>
            setScroll({ top: element.scrollTop, left: element.scrollLeft })
        );
    };
    const onListScroll = (event: UIEvent<HTMLDivElement>): void => {
        const chart = chartRef.current;
        if (chart && chart.scrollTop !== event.currentTarget.scrollTop) {
            chart.scrollTop = event.currentTarget.scrollTop;
        }
    };
    useEffect(() => () => cancelAnimationFrame(scrollFrame.current), []);

    const setScrollLeft = useCallback((left: number, smooth = false) => {
        const chart = chartRef.current;
        if (!chart) {
            return;
        }
        const target = Math.max(0, left);
        if (smooth && typeof chart.scrollTo === "function") {
            chart.scrollTo({ left: target, behavior: "smooth" });
        } else {
            chart.scrollLeft = target;
            setScroll(current => ({ ...current, left: chart.scrollLeft }));
        }
    }, []);

    const changeZoom = useCallback((next: Zoom, offsetX?: number) => {
        const chart = chartRef.current;
        if (next === zoomRef.current) {
            return;
        }
        if (chart) {
            // Keep the date under the pointer (or the middle of the view) where it is.
            const offset = offsetX ?? chart.clientWidth / 2;
            anchorRef.current = {
                date: xToDate(chart.scrollLeft + offset, scaleRef.current),
                offsetX: offset,
                fromPxPerDay: scaleRef.current.pxPerDay
            };
        }
        setZoom(next);
    }, []);

    useLayoutEffect(() => {
        const anchor = anchorRef.current;
        if (anchor) {
            anchorRef.current = null;
            setScrollLeft(dateToX(anchor.date, scale) - anchor.offsetX);
            // Zoom as a smooth scale around the anchor instead of a jump: start at the old scale, ease to the new.
            const inner = chartRef.current?.querySelector<HTMLElement>(".mxgantt-chart-inner");
            if (motion && inner && typeof inner.animate === "function" && anchor.fromPxPerDay !== scale.pxPerDay) {
                const origin = `${dateToX(anchor.date, scale)}px 0`;
                inner.animate(
                    [
                        {
                            transform: `scaleX(${anchor.fromPxPerDay / scale.pxPerDay})`,
                            transformOrigin: origin,
                            opacity: 0.55
                        },
                        { transform: "scaleX(1)", transformOrigin: origin, opacity: 1 }
                    ],
                    { duration: ZOOM_TIME, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
                );
            }
        }
    }, [scale, setScrollLeft, motion]);

    // Open on today when the plan covers it, otherwise on the first task.
    useLayoutEffect(() => {
        if (initialScroll.current || props.loading || !chartRef.current) {
            return;
        }
        initialScroll.current = true;
        const now = new Date();
        const target = bounds.min && bounds.max && (now < bounds.min || now > bounds.max) ? bounds.min : now;
        setScrollLeft(dateToX(target, scale) - chartRef.current.clientWidth * 0.25);
    }, [props.loading, bounds, scale, setScrollLeft]);

    // Ctrl + wheel zooms. React's wheel listener is passive, so the page would zoom as well.
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) {
            return;
        }
        let last = 0;
        const onWheel = (event: WheelEvent): void => {
            if (!event.ctrlKey && !event.metaKey) {
                return;
            }
            event.preventDefault();
            const now = Date.now();
            // Touchpads send a burst of small events; one zoom step per gesture is enough.
            if (now - last < 200 || event.deltaY === 0) {
                return;
            }
            last = now;
            const index = ZOOMS.indexOf(zoomRef.current);
            const next = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, index + (event.deltaY > 0 ? 1 : -1)))];
            changeZoom(next, event.clientX - chart.getBoundingClientRect().left);
        };
        chart.addEventListener("wheel", onWheel, { passive: false });
        return () => chart.removeEventListener("wheel", onWheel);
    }, [changeZoom]);

    const fitToPlan = (): void => {
        const chart = chartRef.current;
        const { min, max } = taskBounds(previewed);
        if (!chart || !min || !max) {
            return;
        }
        const next = fitZoom(min, max, Math.max(200, chart.clientWidth - 48), snap);
        if (next === zoomRef.current) {
            setScrollLeft(dateToX(min, scale) - 24, motion);
        } else {
            anchorRef.current = { date: min, offsetX: 24, fromPxPerDay: scaleRef.current.pxPerDay };
            setZoom(next);
        }
        announce(texts.fitDone);
    };

    const scrollToToday = (): void => {
        const chart = chartRef.current;
        if (chart) {
            setScrollLeft(dateToX(new Date(), scale) - chart.clientWidth / 3, motion);
        }
    };

    const boxOfRow = (row: Row): { x: number; width: number } | undefined => {
        const range = rangeOf(row);
        if (!range.start || !range.end) {
            return undefined;
        }
        if (row.kind === "task" && isMilestone(row.task)) {
            return milestoneBox(range.start, scale, rh);
        }
        return barBox(range.start, range.end, scale, rh, row.kind);
    };

    const revealRow = (index: number, horizontal: boolean): void => {
        const chart = chartRef.current;
        if (!chart) {
            return;
        }
        const top = index * rh;
        const visible = chart.clientHeight - HEADER_HEIGHT;
        if (top < chart.scrollTop) {
            chart.scrollTop = top;
        } else if (top + rh > chart.scrollTop + visible) {
            chart.scrollTop = top + rh - visible;
        }
        const box = horizontal ? boxOfRow(rows[index]) : undefined;
        if (box && (box.x + box.width < chart.scrollLeft + 16 || box.x > chart.scrollLeft + chart.clientWidth - 40)) {
            setScrollLeft(box.x - 60);
        }
        setScroll({ top: chart.scrollTop, left: chart.scrollLeft });
    };

    const shading = useMemo(() => {
        if (!props.showWeekends || !(zoom === "day" || zoom === "week")) {
            return [];
        }
        const fromX = scroll.left - 300;
        const toX = scroll.left + viewport.width + 300;
        if (!calendar.active) {
            return weekendSpans(scale, fromX, toX);
        }
        return nonWorkingDays(calendar, xToDate(Math.max(0, fromX), scale), xToDate(toX, scale)).map(span => {
            const x = dateToX(span.start, scale);
            return { x, width: dateToX(span.end, scale) - x };
        });
    }, [props.showWeekends, zoom, scroll.left, viewport.width, calendar, scale]);

    // ---------------------------------------------------------------- focus

    const navigable = useMemo(() => rows.map((_, index) => index).filter(index => hasBox(rows[index])), [rows]);

    // After the filter changes, bring the first match into view: it may be months away.
    const revealMatch = useRef(false);
    const firstMatchStart = filtering ? tasks.find(task => task.start)?.start?.getTime() : undefined;
    useLayoutEffect(() => {
        const chart = chartRef.current;
        const wanted = revealMatch.current;
        revealMatch.current = false;
        if (!wanted || firstMatchStart === undefined || !chart) {
            return;
        }
        chart.scrollTop = 0;
        setScrollLeft(dateToX(new Date(firstMatchStart), scale) - 60);
        // The filter itself is a dependency: every change of it reveals the first match once.
    }, [filter, firstMatchStart, scale, setScrollLeft]);
    const changeFilter = (next: TaskFilter): void => {
        revealMatch.current = true;
        setFilter(next);
    };
    const tabStopId =
        activeId && rowIndex.has(activeId) && rows[rowIndex.get(activeId)!]?.id === activeId
            ? activeId
            : navigable.length > 0
            ? rows[navigable[0]].id
            : undefined;

    const focusRow = (id: string): void => {
        const index = rows.findIndex(row => row.id === id);
        if (index < 0) {
            return;
        }
        setActiveId(id);
        pendingFocus.current = id;
        revealRow(index, true);
    };

    useLayoutEffect(() => {
        const id = pendingFocus.current;
        if (!id || !rootRef.current) {
            return;
        }
        const target = Array.from(rootRef.current.querySelectorAll<HTMLElement>("[data-row-id]")).find(
            element => element.dataset.rowId === id
        );
        if (target) {
            pendingFocus.current = null;
            target.focus({ preventScroll: true });
        }
    });

    // ---------------------------------------------------------------- writing changes

    const editableRow = (row: Row): boolean => row.kind === "task" && row.task.editable && !!row.task.start;

    const describeChange = (task: Task, next: Schedule, previous: Schedule): string => {
        const values = {
            name: task.name,
            start: formatDate(next.start),
            end: formatDate(next.end),
            duration: formatDuration(next.start, next.end),
            progress: `${next.progress ?? 0}%`
        };
        if (next.progress !== previous.progress) {
            return fill(texts.progressSet, values);
        }
        if (next.end.getTime() - next.start.getTime() !== previous.end.getTime() - previous.start.getTime()) {
            return fill(texts.resized, values);
        }
        return fill(texts.moved, values);
    };

    /** Hands changes to the widget to write, or keeps them in the open scenario. */
    const emit = (changes: TaskChange[]): void => {
        if (scenario) {
            setScenario(current => mergeScenario(current ?? new Map(), changes));
        } else {
            props.onChange(changes);
        }
    };

    /** Hands a batch to the widget to write, and records it for undo. */
    const commitValues = (entries: Array<{ id: string; next: TaskValues }>, label: string): boolean => {
        const changes: TaskChange[] = [];
        entries.forEach(entry => {
            const task = baseById.get(entry.id);
            if (!task) {
                return;
            }
            const previous = valuesOf(task, Object.keys(entry.next) as Array<keyof TaskValues>);
            const changed = (Object.keys(entry.next) as Array<keyof TaskValues>).some(key => {
                const a = entry.next[key];
                const b = previous[key];
                return a instanceof Date && b instanceof Date ? a.getTime() !== b.getTime() : a !== b;
            });
            if (changed) {
                changes.push({ id: entry.id, next: entry.next, previous });
            }
        });
        if (changes.length === 0) {
            return false;
        }
        // A pending levelling or scheduling proposal was worked out on the old plan.
        setProposal(undefined);
        emit(changes);
        if (props.allowUndo) {
            setHistory(current =>
                record(current, {
                    label,
                    changes: changes.map(change => ({ id: change.id, before: change.previous, after: change.next }))
                })
            );
        }
        return true;
    };

    /** The successors auto-scheduling moves when a task gets a new schedule. */
    const pushedFor = (id: string, next: Schedule): ReadonlyMap<string, Span> =>
        autoActive
            ? autoSchedule(
                  spans,
                  baseLinks,
                  new Map([[id, { start: next.start, end: next.end }]]),
                  calendar,
                  locked,
                  adjustForConstraint
              )
            : NO_PUSH;

    /** The values a schedule change writes: the task itself and the successors it pushes. */
    const scheduleEntries = (
        id: string,
        next: Schedule,
        previous: Schedule
    ): { entries: Array<{ id: string; next: TaskValues }>; pushed: ReadonlyMap<string, Span> } => {
        const pushed = pushedFor(id, next);
        const own = scheduleDiff(next, previous) as TaskValues;
        // 2.3 split tasks: a move keeps the segments, a resize keeps them where they are in time.
        const task = baseById.get(id);
        if (props.hasSegments && task?.segments) {
            const moveOnly =
                Math.abs(spanDays(next, calendar) - spanDays(previous, calendar)) < 1e-6 &&
                next.start.getTime() !== previous.start.getTime();
            if (!moveOnly && (own.start || own.end)) {
                const rebased = rebaseSegments(
                    { start: previous.start, end: previous.end, segments: task.segments },
                    next,
                    calendar
                );
                const text = formatSegments(rebased);
                if (text !== (task.segmentsText ?? "")) {
                    own.segments = text;
                }
            }
        }
        const entries = [{ id, next: own }];
        pushed.forEach((span, pushedId) => entries.push({ id: pushedId, next: { start: span.start, end: span.end } }));
        return { entries, pushed };
    };

    const commit = (id: string, next: Schedule, previous: Schedule): void => {
        const task = baseById.get(id);
        if (!task || sameSchedule(next, previous)) {
            return;
        }
        const { entries, pushed } = scheduleEntries(id, next, previous);
        commitValues(entries, task.name);
        const pushedText = pushed.size > 0 ? `. ${fill(texts.pushed, { n: pushed.size })}` : "";
        announce(describeChange(task, next, previous) + pushedText);
    };

    const flushKeys = (): void => {
        window.clearTimeout(keyTimer.current);
        const pending = keyPending.current;
        keyPending.current = null;
        if (pending) {
            commit(pending.id, pending.schedule, pending.previous);
            setPreview(current => (current?.id === pending.id ? undefined : current));
        }
    };
    const flushRef = useRef(flushKeys);
    useEffect(() => {
        flushRef.current = flushKeys;
    });
    // A pending keyboard change is saved rather than lost when the widget goes away.
    useEffect(() => () => flushRef.current(), []);

    /** Day-snapped changes skip non-working days when the option is on. */
    const calendarSnap = (mode: DragMode, original: Schedule, next: Schedule): Schedule =>
        props.snapWorkingDays && snap === "day" ? snapToCalendar(mode, original, next, calendar) : next;

    const keyChange = (task: Task, mode: DragMode, change: (base: Schedule) => Schedule): void => {
        const saved = scheduleOf(baseById.get(task.id) ?? task);
        if (!saved) {
            return;
        }
        if (keyPending.current && keyPending.current.id !== task.id) {
            flushKeys();
        }
        const base = keyPending.current?.schedule ?? saved;
        const next = calendarSnap(mode, base, change(base));
        keyPending.current = { id: task.id, schedule: next, previous: keyPending.current?.previous ?? saved };
        setPreview({ id: task.id, schedule: next, pushed: pushedFor(task.id, next) });
        announce(describeChange(task, next, base));
        window.clearTimeout(keyTimer.current);
        // Several key presses in a row are saved as one change, not one commit per press.
        keyTimer.current = window.setTimeout(() => flushRef.current(), KEY_COMMIT_DELAY);
        const index = rowIndex.get(task.id);
        if (index !== undefined) {
            const chart = chartRef.current;
            const x = dateToX(next.start, scale);
            if (chart && (x < chart.scrollLeft + 16 || x > chart.scrollLeft + chart.clientWidth - 60)) {
                setScrollLeft(x - 60);
            }
        }
    };

    // ---------------------------------------------------------------- undo and redo

    const applyBatch = (apply: { changes: Array<{ id: string; before: TaskValues; after: TaskValues }> }): void => {
        emit(apply.changes.map(change => ({ id: change.id, next: change.after, previous: change.before })));
    };

    // ---------------------------------------------------------------- what-if scenario

    const scenarioAvailable = !!props.scenarioMode && props.showToolbar;
    const summary = useMemo(
        () => (scenario ? scenarioSummary(props.tasks, scenario) : undefined),
        [props.tasks, scenario]
    );

    /** A keyboard change still waiting for its commit delay, as scenario entries, taken off the queue. */
    const takePendingKeys = (): Array<{ id: string; next: TaskValues }> => {
        window.clearTimeout(keyTimer.current);
        const pending = keyPending.current;
        keyPending.current = null;
        if (!pending) {
            return [];
        }
        setPreview(undefined);
        return sameSchedule(pending.schedule, pending.previous)
            ? []
            : scheduleEntries(pending.id, pending.schedule, pending.previous).entries;
    };

    const startScenario = (): void => {
        flushKeys();
        setOuterHistory(history);
        setHistory(EMPTY_HISTORY);
        setScenario(new Map());
        announce(texts.scenarioStarted);
    };

    const closeScenario = (): void => {
        setScenario(undefined);
        setPreview(undefined);
        setDialog(undefined);
        setHistory(outerHistory);
        setOuterHistory(EMPTY_HISTORY);
    };

    const discardScenario = (): void => {
        takePendingKeys();
        closeScenario();
        announce(texts.scenarioDiscarded);
    };

    /** Writes every change of the scenario in one batch, through the normal write path. */
    const applyScenarioPlan = (): void => {
        const plan = mergeScenario(scenario ?? new Map(), takePendingKeys());
        const changes = scenarioChanges(props.tasks, plan);
        closeScenario();
        if (changes.length > 0) {
            props.onChange(changes);
            if (props.allowUndo) {
                setHistory(
                    record(outerHistory, {
                        label: texts.scenario,
                        changes: changes.map(change => ({
                            id: change.id,
                            before: change.previous,
                            after: change.next
                        }))
                    })
                );
            }
        }
        announce(fill(texts.scenarioApplied, { n: changes.length }));
    };

    const toggleScenario = (): void => {
        if (!scenario) {
            startScenario();
        } else if (scenarioIds.size > 0 || keyPending.current) {
            setDialog({ kind: "discard" });
        } else {
            discardScenario();
        }
    };

    let scenarioText = "";
    if (summary) {
        if (summary.changed === 0) {
            scenarioText = texts.scenarioEmpty;
        } else {
            const delta =
                summary.currentEnd && summary.plannedEnd
                    ? workingDaysBetween(calendar, summary.currentEnd, summary.plannedEnd)
                    : 0;
            scenarioText = fill(texts.scenarioSummary, {
                planned: formatDate(summary.plannedEnd),
                current: formatDate(summary.currentEnd),
                delta:
                    delta > 0
                        ? fill(texts.scenarioLater, { n: formatDays(delta) })
                        : delta < 0
                        ? fill(texts.scenarioEarlier, { n: formatDays(-delta) })
                        : texts.scenarioSameEnd,
                n: summary.moved
            });
        }
    }
    const doUndo = (): void => {
        flushKeys();
        const result = undo(history);
        if (!result.apply) {
            announce(texts.nothingToUndo);
            return;
        }
        setHistory(result.state);
        applyBatch(result.apply);
        announce(fill(texts.undone, { name: result.apply.label }));
    };
    const doRedo = (): void => {
        flushKeys();
        const result = redo(history);
        if (!result.apply) {
            announce(texts.nothingToRedo);
            return;
        }
        setHistory(result.state);
        applyBatch(result.apply);
        announce(fill(texts.redone, { name: result.apply.label }));
    };

    // ---------------------------------------------------------------- dependencies

    const keyed = useMemo(() => {
        const map = new Map<string, Task>();
        sourceTasks.forEach(task => {
            if (task.key && !map.has(task.key)) {
                map.set(task.key, task);
            }
        });
        return map;
    }, [sourceTasks]);

    const createLink = (fromId: string, toId: string): void => {
        const from = baseById.get(fromId);
        const to = baseById.get(toId);
        if (!from || !to) {
            return;
        }
        if (fromId === toId) {
            announce(texts.selfLink);
            return;
        }
        if (!from.key) {
            announce(fill(texts.linkNoKey, { name: from.name }));
            return;
        }
        if (!to.editable) {
            announce(fill(texts.readOnly, { name: to.name }));
            return;
        }
        const text = addDependency(to.depsText, { key: from.key, type: "FS" });
        if (commitValues([{ id: toId, next: { deps: text } }], to.name)) {
            announce(fill(texts.linkCreated, { from: from.name, to: to.name }));
        }
    };

    const removeLink = (link: Link): void => {
        const from = baseById.get(link.from);
        const to = baseById.get(link.to);
        if (!from?.key || !to) {
            return;
        }
        const text = removeDependency(to.depsText, from.key);
        if (commitValues([{ id: to.id, next: { deps: text } }], to.name)) {
            announce(fill(texts.linkRemoved, { from: from.name, to: to.name }));
        }
    };

    const startLinking = (task: Task): void => {
        if (!task.key) {
            announce(fill(texts.linkNoKey, { name: task.name }));
            return;
        }
        setLinking(task.id);
        announce(fill(texts.linkStart, { name: task.name }));
    };

    // ---------------------------------------------------------------- inline editing

    const startEdit = (id: string, columnKey?: string): void => {
        const index = rows.findIndex(row => row.id === id);
        const row = rows[index];
        if (!props.showGrid || !row || row.kind !== "task") {
            return;
        }
        const column = columnKey
            ? columns.find(candidate => candidate.key === columnKey)
            : columns.find(candidate => canEdit(row, candidate));
        if (!column || !canEdit(row, column)) {
            if (!row.task.editable) {
                announce(fill(texts.readOnly, { name: row.task.name }));
            }
            return;
        }
        flushKeys();
        // A row click just before (the first click of a double-click) must not pull focus out of the editor.
        pendingFocus.current = null;
        setActiveId(id);
        revealRow(index, false);
        setEditing({ rowId: id, column: column.key });
    };

    /** Validates and saves one edited cell; returns an error message when the value is refused. */
    const applyEdit = (task: Task, key: string, text: string): string | undefined => {
        const saved = scheduleOf(task);
        const withTime = snap === "hour";
        switch (key) {
            case "name": {
                if (!text) {
                    return texts.invalidName;
                }
                commitValues([{ id: task.id, next: { name: text } }], task.name);
                return undefined;
            }
            case "progress": {
                const value = Number(text.replace(",", "."));
                if (!text || !Number.isFinite(value) || value < 0 || value > 100) {
                    return fill(texts.invalidNumber, { min: 0, max: 100 });
                }
                if (saved) {
                    commit(task.id, { ...saved, progress: clampProgress(value) }, saved);
                }
                return undefined;
            }
            case "duration": {
                const value = Number(text.replace(",", "."));
                if (!text || !Number.isFinite(value) || value < 0 || value > 3650) {
                    return fill(texts.invalidNumber, { min: 0, max: 3650 });
                }
                if (saved) {
                    commit(task.id, { ...saved, end: addWorkingTime(calendar, saved.start, value) }, saved);
                }
                return undefined;
            }
            case "start": {
                const date = readInput(text, saved?.start, withTime);
                if (!date || !saved) {
                    return texts.invalidDate;
                }
                const start = props.snapWorkingDays ? rollToWorkingDay(calendar, date, 1) : date;
                const moved = calendar.active
                    ? placeAt(saved, start, calendar)
                    : { start, end: moveLike(saved.end, saved.start, start) };
                commit(task.id, { ...saved, ...moved }, saved);
                return undefined;
            }
            case "end": {
                const date = readInput(text, saved?.end, withTime);
                if (!date || !saved) {
                    return texts.invalidDate;
                }
                if (date < saved.start) {
                    return texts.endBeforeStart;
                }
                commit(task.id, { ...saved, end: date }, saved);
                return undefined;
            }
            case "predecessors": {
                const entries = parseDependencies(text);
                for (const entry of entries) {
                    const target = keyed.get(entry.raw) ?? keyed.get(entry.key);
                    if (!target) {
                        return fill(texts.unknownKey, { key: entry.key });
                    }
                    if (target.id === task.id) {
                        return texts.selfLink;
                    }
                }
                commitValues([{ id: task.id, next: { deps: entries.map(entry => entry.raw).join(", ") } }], task.name);
                return undefined;
            }
            case "assignments": {
                if (invalidAssignments(text).length > 0) {
                    return texts.invalidAssignments;
                }
                commitValues(
                    [{ id: task.id, next: { assignments: formatAssignments(parseAssignments(text)) } }],
                    task.name
                );
                return undefined;
            }
            default: {
                const entry = props.layout?.find(candidate => candidate.key === key && candidate.type === "attribute");
                if (entry) {
                    // 1.2: a configured attribute column, written like the other task values.
                    const parsed = parseCell(text, entry, task.cells?.[key]?.raw);
                    if (!parsed.ok) {
                        return parsed.error === "date"
                            ? texts.invalidDate
                            : parsed.error === "whole"
                            ? texts.invalidWholeNumber
                            : parsed.error === "number"
                            ? texts.invalidPlainNumber
                            : texts.invalidChoice;
                    }
                    commitValues([{ id: task.id, next: { [cellKey(key)]: parsed.value } }], task.name);
                    return undefined;
                }
                const field = key.startsWith("f:") ? fieldList.find(entry => `f:${entry.key}` === key) : undefined;
                if (field) {
                    writeFieldValue(task, field, decodeEdit(text));
                }
                return undefined;
            }
        }
    };

    /** 1.1: writes one custom field value of a task, as one undo step. */
    const writeFieldValue = (task: Task, field: FieldDef, value: FieldValue | undefined): void => {
        if (!canEditValues || !task.editable) {
            return;
        }
        const next = withFieldValue(task.fieldsText, field.key, value);
        if (next === (task.fieldsText ?? "")) {
            return;
        }
        commitValues([{ id: task.id, next: { fields: next } }], task.name);
        const shown = fieldText(field, { ...task, fieldValues: { ...task.fieldValues, [field.key]: value as never } });
        announce(
            value === undefined || !shown
                ? fill(texts.valueCleared, { field: field.name, task: task.name })
                : fill(texts.valueSet, { field: field.name, task: task.name, value: shown })
        );
    };
    const quickEdit = (row: Row, columnKey: string, value: FieldValue | undefined): void => {
        const field = fieldList.find(entry => `f:${entry.key}` === columnKey);
        const task = baseById.get(row.id);
        if (field && task) {
            flushKeys();
            setActiveId(row.id);
            writeFieldValue(task, field, value);
        }
    };

    const commitEdit = (value: string, how: CommitHow): void => {
        if (!editing) {
            return;
        }
        const task = baseById.get(editing.rowId);
        const row = rows[rowIndex.get(editing.rowId) ?? -1];
        if (!task || !row) {
            setEditing(undefined);
            return;
        }
        const column = columns.find(candidate => candidate.key === editing.column);
        const current = column?.edit?.value(task) ?? "";
        const error = value.trim() === current.trim() ? undefined : applyEdit(task, editing.column, value.trim());
        if (error) {
            if (how === "blur") {
                setEditing(undefined);
            } else {
                setEditing({ ...editing, error });
                announce(error);
            }
            return;
        }
        if (how === "next" || how === "previous") {
            const editable = columns.filter(candidate => canEdit(row, candidate));
            const at = editable.findIndex(candidate => candidate.key === editing.column);
            const target = editable[at + (how === "next" ? 1 : -1)];
            if (target) {
                setEditing({ rowId: editing.rowId, column: target.key });
                return;
            }
        }
        setEditing(undefined);
        if (how !== "blur") {
            focusRow(editing.rowId);
        }
    };

    const cancelEdit = (): void => {
        const id = editing?.rowId;
        setEditing(undefined);
        if (id) {
            focusRow(id);
        }
    };

    // ---------------------------------------------------------------- add and delete

    const addTask = (): void => {
        if (!props.onAdd) {
            return;
        }
        if (scenario) {
            announce(texts.scenarioBlocked);
            return;
        }
        flushKeys();
        const focused = activeId ? baseById.get(activeId) : undefined;
        let start = focused?.end ?? startOfDay(new Date());
        if (calendar.active) {
            start = rollToWorkingDay(calendar, start, 1);
        }
        props.onAdd({ start, end: addWorkingTime(calendar, start, 1) });
    };

    const askDelete = (id: string): void => {
        if (scenario && props.onDelete) {
            announce(texts.scenarioBlocked);
            return;
        }
        if (props.onDelete && baseById.has(id)) {
            flushKeys();
            setDialog({ kind: "delete", id });
        }
    };

    const confirmDelete = (id: string): void => {
        setDialog(undefined);
        const index = navigable.indexOf(rows.findIndex(row => row.id === id));
        const neighbour = navigable[index + 1] ?? navigable[index - 1];
        props.onDelete?.(id);
        if (neighbour !== undefined && rows[neighbour]) {
            focusRow(rows[neighbour].id);
        }
    };

    // ---------------------------------------------------------------- 2.3 actions

    const finishOf = (list: Task[], moved?: ReadonlyMap<string, Span>): Date | undefined => {
        let finish: number | undefined;
        list.forEach(task => {
            const end = moved?.get(task.id)?.end ?? task.end;
            if (end) {
                finish = Math.max(finish ?? -Infinity, end.getTime());
            }
        });
        return finish === undefined ? undefined : new Date(finish);
    };
    const deltaText = (before: Date | undefined, after: Date | undefined): string => {
        const delta = before && after ? workingDaysBetween(calendar, before, after) : 0;
        return delta > 0.01
            ? fill(texts.scenarioLater, { n: formatDays(Math.round(delta * 10) / 10) })
            : delta < -0.01
            ? fill(texts.scenarioEarlier, { n: formatDays(Math.round(-delta * 10) / 10) })
            : texts.scenarioSameEnd;
    };

    const startLeveling = (): void => {
        flushKeys();
        const result = levelResources(sourceTasks, baseLinks, {
            calendar,
            resources: props.resources,
            locked
        });
        const lines: string[] = [];
        if (result.moved.size === 0) {
            lines.push(texts.levelNothing);
        } else {
            lines.push(
                fill(texts.levelSummary, {
                    n: result.moved.size,
                    finish: formatDate(result.finishAfter),
                    delta: deltaText(result.finishBefore, result.finishAfter)
                })
            );
            const beyond = result.delays.filter(delay => delay.beyondFloat).length;
            if (beyond > 0) {
                lines.push(fill(texts.levelBeyond, { n: beyond }));
            }
        }
        if (result.unresolved.length > 0) {
            lines.push(fill(texts.levelUnresolved, { n: result.unresolved.length }));
        }
        setProposal({ kind: "level", moved: result.moved, lines });
        announce(lines.join(" "));
    };

    const startSchedule = (): void => {
        flushKeys();
        const plan = sourceTasks
            .filter(task => task.start && task.end)
            .map(task => ({
                id: task.id,
                start: task.start!,
                end: task.end!,
                constraint: task.constraint,
                fixed: !task.editable || (task.progress ?? 0) > 0
            }));
        const result = schedulePlan(plan, baseLinks, calendar);
        const lines: string[] = [];
        if (result.moved.size === 0) {
            lines.push(texts.scheduleNothing);
        } else {
            lines.push(
                fill(texts.scheduleSummary, {
                    n: result.moved.size,
                    finish: formatDate(finishOf(sourceTasks, result.moved)),
                    delta: deltaText(finishOf(sourceTasks), finishOf(sourceTasks, result.moved))
                })
            );
        }
        if (result.conflicts.length > 0) {
            lines.push(fill(texts.scheduleConflicts, { n: result.conflicts.length }));
        }
        setProposal({ kind: "schedule", moved: result.moved, lines });
        announce(lines.join(" "));
    };

    const applyProposal = (): void => {
        if (!proposal || proposal.moved.size === 0) {
            return;
        }
        const entries = [...proposal.moved].map(([id, span]) => ({ id, next: { start: span.start, end: span.end } }));
        const label = proposal.kind === "level" ? texts.levelTitle : texts.scheduleTitle;
        commitValues(entries, label);
        setProposal(undefined);
        announce(fill(texts.proposalApplied, { n: entries.length }));
        // The proposal bar goes away with the focused button: continue on the first moved task.
        focusRow(entries[0].id);
    };
    const cancelProposal = (): void => {
        setProposal(undefined);
        announce(texts.proposalCancelled);
        if (tabStopId) {
            focusRow(tabStopId);
        }
    };

    /** Saves the current plan (dates and cost) as a named baseline on every editable task, as one undo step. */
    const saveNamedBaseline = (name: string): string | undefined => {
        flushKeys();
        const now = new Date();
        const entries: Array<{ id: string; next: TaskValues }> = [];
        for (const task of sourceTasks) {
            if (!task.start || !task.end || !task.editable) {
                continue;
            }
            const next = saveBaseline(
                task.baselines ?? [],
                name,
                { start: task.start, finish: task.end, cost: props.hasCost ? taskCost(task, costSettings) : undefined },
                now
            );
            if (!next) {
                return texts.baselineFull;
            }
            entries.push({ id: task.id, next: { baselines: formatBaselines(next) } });
        }
        commitValues(entries, name);
        setBaselineChoice(name);
        announce(fill(texts.baselineSaved, { name, n: entries.length }));
        return undefined;
    };
    const removeNamedBaseline = (name: string): void => {
        setDialog(undefined);
        const entries = sourceTasks
            .filter(task => task.editable && task.baselines?.some(entry => entry.name === name))
            .map(task => ({
                id: task.id,
                next: { baselines: formatBaselines(deleteBaseline(task.baselines!, name)) }
            }));
        commitValues(entries, name);
        if (shownBaseline === name) {
            setBaselineChoice(undefined);
        }
        if (baselineCompare === name) {
            setBaselineCompare("");
        }
        announce(fill(texts.baselineDeleted, { name }));
    };

    /** Writes a split task's new segments and end, pushing successors like any other change. */
    const commitSegments = (task: Task, segments: Segment[] | undefined, total: number, announcement: string): void => {
        const saved = scheduleOf(task);
        if (!saved) {
            return;
        }
        const next: Schedule = { ...saved, end: addWorkingTime(calendar, saved.start, total) };
        const { entries } = scheduleEntries(task.id, next, saved);
        entries[0].next = { ...entries[0].next, segments: formatSegments(segments) };
        if (commitValues(entries, task.name)) {
            announce(announcement);
        }
    };
    const splitTask = (task: Task): void => {
        if (!task.start || !task.end) {
            return;
        }
        const total = spanDays({ start: task.start, end: task.end }, calendar);
        const pieces = task.segments ?? [{ start: 0, end: total }];
        const longest = pieces.reduce((best, piece) =>
            piece.end - piece.start > best.end - best.start ? piece : best
        );
        const length = longest.end - longest.start;
        const at = length >= 2 ? longest.start + Math.round(length / 2) : longest.start + length / 2;
        const result = splitAt(task.segments, total, at, 1);
        if (result) {
            commitSegments(
                task,
                result.segments,
                result.total,
                fill(texts.split, { name: task.name, n: result.segments.length })
            );
        }
    };
    const joinTask = (task: Task): void => {
        if (!task.start || !task.end || !task.segments) {
            return;
        }
        const total = joinSegments(task.segments, spanDays({ start: task.start, end: task.end }, calendar));
        commitSegments(task, undefined, total, fill(texts.joined, { name: task.name }));
    };
    /** Alt + arrows: the last segment moves a working day. */
    const nudgeSegment = (task: Task, direction: 1 | -1): void => {
        if (!task.start || !task.end || !task.segments || task.segments.length < 2) {
            return;
        }
        const index = task.segments.length - 1;
        const result = moveSegment(task.segments, index, direction);
        const pieces = segmentSpans(
            { start: task.start, end: addWorkingTime(calendar, task.start, result.total), segments: result.segments },
            calendar
        );
        const moved = pieces[Math.min(index, pieces.length - 1)];
        commitSegments(
            task,
            result.segments,
            result.total,
            fill(texts.segmentMoved, { n: index + 1, name: task.name, start: formatDate(moved?.start) })
        );
    };

    /** Brings a row into view and focuses it, expanding its group and project first when they are collapsed. */
    const goToRow = (id: string): void => {
        const task = baseById.get(id);
        const open = [task ? groupRowId(task) : undefined, task?.project ? projectId(task.project) : undefined].filter(
            (key): key is string => !!key && collapsed.has(key)
        );
        if (open.length > 0) {
            setCollapsed(current => {
                const next = new Set(current);
                open.forEach(key => next.delete(key));
                return next;
            });
            revealAfterRender.current = id;
            return;
        }
        focusRow(id);
    };
    useEffect(() => {
        const id = revealAfterRender.current;
        if (id && rows.some(row => row.id === id)) {
            revealAfterRender.current = null;
            focusRow(id);
        }
    });

    // Stable handlers for the memoised panels.
    const goToRowStable = useStable(goToRow);
    const goToProject = useStable((name: string) => goToRow(projectId(name)));
    const saveBaselineStable = useStable(saveNamedBaseline);
    const askDeleteBaseline = useStable((name: string) => setDialog({ kind: "deleteBaseline", name }));
    const showBaseline = useStable((selection: string) => {
        setBaselineChoice(selection);
        if (selection === baselineCompare) {
            setBaselineCompare("");
        }
    });
    const focusResource = useStable((name: string | undefined) => {
        setResourceFocus(name);
        if (name) {
            announce(fill(texts.resourceFocused, { name }));
        }
    });
    const formatShortDate = useCallback((date: Date) => formats.date(date), [formats]);

    const onImportFile = (file: File | undefined): void => {
        if (!file || !props.onImport) {
            return;
        }
        if (file.size > MAX_IMPORT_BYTES) {
            setNotice(texts.importTooLarge);
            announce(texts.importTooLarge);
            return;
        }
        file.text()
            .then(text => {
                const plan = importMspdi(text);
                setNotice(undefined);
                setDialog({ kind: "import", plan });
            })
            .catch(error => {
                const message =
                    error instanceof ImportError && error.reason === "size" ? texts.importTooLarge : texts.importFailed;
                if (!(error instanceof ImportError)) {
                    console.error("MxGantt: could not import the file", error);
                }
                setNotice(message);
                announce(message);
            });
    };
    const confirmImport = (plan: ImportedPlan): void => {
        setDialog(undefined);
        props.onImport?.(plan);
        announce(fill(texts.importDone, { tasks: plan.stats.tasks }));
    };

    // ---------------------------------------------------------------- task menu

    const menuItems = (id: string): MenuItem[] => {
        const task = baseById.get(id);
        if (!task) {
            return [];
        }
        const items: MenuItem[] = [];
        const row = rows[rowIndex.get(id) ?? -1];
        if (
            props.inlineEdit &&
            props.showGrid &&
            row?.kind === "task" &&
            columns.some(column => canEdit(row, column))
        ) {
            items.push({ key: "edit", label: texts.menuEdit });
        }
        if (props.linkEditing) {
            if (task.key) {
                items.push({ key: "link", label: texts.menuLink });
            }
            (incoming.get(id) ?? []).forEach(link => {
                const from = allMap.get(link.from);
                if (from && task.editable) {
                    items.push({ key: `in:${link.from}`, label: fill(texts.menuRemoveLink, { name: from.name }) });
                }
            });
            allLinks
                .filter(link => link.from === id)
                .forEach(link => {
                    const to = allMap.get(link.to);
                    if (to && to.editable) {
                        items.push({
                            key: `out:${link.to}`,
                            label: fill(texts.menuRemoveSuccessor, { name: to.name })
                        });
                    }
                });
        }
        if (props.hasSegments && task.editable && task.start && task.end && !isMilestone(task)) {
            items.push({ key: "split", label: texts.menuSplit });
            if (task.segments) {
                items.push({ key: "join", label: texts.menuJoin });
            }
        }
        if (props.onDelete) {
            items.push({ key: "delete", label: texts.menuDelete, danger: true });
        }
        return items;
    };

    /** Carries out the menu entry the user chose. */
    const runMenu = (id: string, key: string): void => {
        const task = baseById.get(id);
        if (!task) {
            return;
        }
        if (key === "edit") {
            startEdit(id);
        } else if (key === "link") {
            startLinking(task);
        } else if (key === "delete") {
            askDelete(id);
        } else if (key === "split") {
            splitTask(task);
        } else if (key === "join") {
            joinTask(task);
        } else if (key.startsWith("in:")) {
            const link = (incoming.get(id) ?? []).find(candidate => candidate.from === key.slice(3));
            if (link) {
                removeLink(link);
            }
        } else if (key.startsWith("out:")) {
            const link = allLinks.find(candidate => candidate.from === id && candidate.to === key.slice(4));
            if (link) {
                removeLink(link);
            }
        }
    };

    const openMenu = (id: string, clientX: number, clientY: number): boolean => {
        const root = rootRef.current;
        if (!root || menuItems(id).length === 0) {
            return false;
        }
        const rect = root.getBoundingClientRect();
        setActiveId(id);
        setHoverId(undefined);
        setMenu({
            id,
            x: Math.max(4, Math.min(clientX - rect.left, rect.width - 250)),
            y: Math.max(4, clientY - rect.top)
        });
        return true;
    };

    const closeMenu = useCallback((restoreFocus: boolean) => {
        setMenu(current => {
            if (current && restoreFocus) {
                pendingFocus.current = current.id;
            }
            return undefined;
        });
    }, []);

    // ---------------------------------------------------------------- keyboard

    const toggleGroup = (id: string): void => {
        setCollapsed(current => {
            const next = new Set(current);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, row: Row): void => {
        const index = rows.findIndex(candidate => candidate.id === row.id);
        const move = (target: number | undefined): void => {
            if (target !== undefined) {
                event.preventDefault();
                focusRow(rows[target].id);
            }
        };
        if (event.key === "Escape") {
            if (linking) {
                setLinking(undefined);
                announce(texts.linkCancelled);
                event.preventDefault();
            }
            if (dragRef.current || keyPending.current) {
                dragRef.current = null;
                keyPending.current = null;
                window.clearTimeout(keyTimer.current);
                setPreview(undefined);
                setLinkDraft(undefined);
                event.preventDefault();
            }
            setFocusTipId(undefined);
            setHoverId(undefined);
            return;
        }
        if (event.key === "ArrowDown") {
            move(navigable.find(candidate => candidate > index));
            return;
        }
        if (event.key === "ArrowUp") {
            move([...navigable].reverse().find(candidate => candidate < index));
            return;
        }
        if (event.key === "Home" && !event.shiftKey) {
            move(navigable[0]);
            return;
        }
        if (event.key === "End" && !event.shiftKey) {
            move(navigable[navigable.length - 1]);
            return;
        }
        if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
            const rect = event.currentTarget.getBoundingClientRect();
            if (row.kind === "task" && openMenu(row.id, rect.left, rect.bottom + 2)) {
                event.preventDefault();
            }
            return;
        }
        if (row.kind === "group") {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggleGroup(row.id);
            } else if (event.key === "ArrowLeft" && !row.collapsed) {
                event.preventDefault();
                toggleGroup(row.id);
            } else if (event.key === "ArrowRight" && row.collapsed) {
                event.preventDefault();
                toggleGroup(row.id);
            }
            return;
        }
        const { task } = row;
        if (linking && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            setLinking(undefined);
            createLink(linking, task.id);
            return;
        }
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            flushKeys();
            props.onClick?.(task.id);
            return;
        }
        if (event.key === "F2" && props.inlineEdit) {
            event.preventDefault();
            startEdit(task.id);
            return;
        }
        if (event.key === "Delete" && props.onDelete) {
            event.preventDefault();
            askDelete(task.id);
            return;
        }
        if ((event.key === "l" || event.key === "L") && props.linkEditing && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            startLinking(task);
            return;
        }
        if (
            event.altKey &&
            (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
            props.hasSegments &&
            task.segments
        ) {
            event.preventDefault();
            if (!editableRow(row)) {
                announce(fill(texts.readOnly, { name: task.name }));
                return;
            }
            flushKeys();
            nudgeSegment(baseById.get(task.id) ?? task, event.key === "ArrowRight" ? 1 : -1);
            return;
        }
        const edit = keyEdit(event.key, event.shiftKey, snap);
        const progressStep = event.key === "+" || event.key === "=" ? 10 : event.key === "-" ? -10 : 0;
        if (!edit && !(progressStep && props.hasProgress && !isMilestone(task))) {
            return;
        }
        event.preventDefault();
        if (!editableRow(row)) {
            announce(fill(texts.readOnly, { name: task.name }));
            return;
        }
        if (edit) {
            // Milestones have no length to change, so Shift moves them like a plain arrow.
            const mode = isMilestone(task) ? "move" : edit.mode;
            keyChange(task, mode, base => shift(mode, base, edit.units, snap));
        } else {
            keyChange(task, "progress", base => ({
                ...base,
                progress: clampProgress((base.progress ?? 0) + progressStep)
            }));
        }
    };

    /** Widget-wide shortcuts: undo, redo, add and the shortcut list. */
    const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        const target = event.target as HTMLElement;
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable) {
            return;
        }
        const ctrl = event.ctrlKey || event.metaKey;
        if (props.allowUndo && ctrl && !event.altKey) {
            const key = event.key.toLowerCase();
            if (key === "z" && !event.shiftKey) {
                event.preventDefault();
                doUndo();
                return;
            }
            if (key === "y" || (key === "z" && event.shiftKey)) {
                event.preventDefault();
                doRedo();
                return;
            }
        }
        if (event.key === "?" && !ctrl) {
            event.preventDefault();
            setDialog({ kind: "help" });
            return;
        }
        if (event.key === "Insert" && props.onAdd) {
            event.preventDefault();
            addTask();
            return;
        }
        if (props.zoomToFit && !ctrl && !event.altKey && (event.key === "f" || event.key === "F")) {
            event.preventDefault();
            fitToPlan();
        }
    };

    // ---------------------------------------------------------------- pointer

    const canvasPoint = (clientX: number, clientY: number): { x: number; y: number } => {
        const canvas = chartRef.current?.querySelector<HTMLElement>(".mxgantt-canvas");
        const rect = canvas?.getBoundingClientRect();
        return rect ? { x: clientX - rect.left, y: clientY - rect.top } : { x: 0, y: 0 };
    };

    const onPointerDown = (event: PointerEvent<HTMLDivElement>, row: Row): void => {
        if (event.button !== 0) {
            return;
        }
        event.currentTarget.focus({ preventScroll: true });
        setActiveId(row.id);
        if (row.kind === "group") {
            return;
        }
        const saved = scheduleOf(baseById.get(row.id) ?? row.task);
        if (!saved) {
            return;
        }
        flushKeys();
        const handle = (event.target as HTMLElement).closest<HTMLElement>("[data-mode]");
        const mode = (handle?.dataset.mode as ChartDragMode | undefined) ?? "move";
        dragRef.current = {
            id: row.id,
            mode,
            x0: event.clientX,
            pointerId: event.pointerId,
            original: saved,
            barWidth: event.currentTarget.offsetWidth,
            editable: mode === "link" ? props.linkEditing : editableRow(row),
            moved: false,
            segment: mode === "segment" ? Number(handle?.dataset.segment ?? 0) : undefined
        };
        try {
            event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
            // Synthetic events in tests have no active pointer to capture.
        }
    };

    const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) {
            return;
        }
        const dx = event.clientX - drag.x0;
        if (!drag.moved && Math.abs(dx) < 4 && drag.mode !== "link") {
            return;
        }
        if (!drag.editable) {
            return;
        }
        drag.moved = true;
        if (drag.mode === "link") {
            const index = rowIndex.get(drag.id);
            const task = baseById.get(drag.id);
            if (index === undefined || !task?.end) {
                return;
            }
            const point = canvasPoint(event.clientX, event.clientY);
            const x1 = dateToX(task.end, scale) + (isMilestone(task) ? Math.round(rh * 0.23) : 0) + 10;
            setLinkDraft({ x1, y1: index * rh + rh / 2, x2: point.x, y2: point.y });
            return;
        }
        if (drag.mode === "segment") {
            // 2.3: a segment (and the ones after it) slides; the gap before it grows or shrinks.
            const task = baseById.get(drag.id);
            if (!task?.segments || drag.segment === undefined) {
                return;
            }
            const pieces = segmentSpans(task, calendar);
            const piece = pieces[drag.segment];
            if (!piece) {
                return;
            }
            const days = dx / scale.pxPerDay;
            const step = snap === "hour" ? Math.round(days * 24) / 24 : Math.round(days);
            const target = snap === "hour" ? new Date(piece.start.getTime() + step * DAY) : addDays(piece.start, step);
            const delta = workingDaysBetween(calendar, piece.start, target);
            const result = moveSegment(task.segments, drag.segment, delta);
            const next: Schedule = {
                ...drag.original,
                end: addWorkingTime(calendar, drag.original.start, result.total)
            };
            if (!drag.current || !sameSchedule(drag.current, next)) {
                drag.current = next;
                drag.segments = { value: result.segments };
                setPreview({ id: drag.id, schedule: next, pushed: pushedFor(drag.id, next), segments: drag.segments });
            }
            return;
        }
        const raw = applyDrag(drag.mode, drag.original, dx, scale.pxPerDay, snap, drag.barWidth);
        const next = calendarSnap(drag.mode, drag.original, raw);
        if (!drag.current || !sameSchedule(drag.current, next)) {
            drag.current = next;
            setPreview({ id: drag.id, schedule: next, pushed: pushedFor(drag.id, next) });
        }
    };

    const endDrag = (event: PointerEvent<HTMLDivElement>, cancelled: boolean): void => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) {
            return;
        }
        dragRef.current = null;
        try {
            event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
            // Already released.
        }
        setPreview(undefined);
        setLinkDraft(undefined);
        if (cancelled) {
            return;
        }
        if (drag.mode === "link") {
            if (drag.moved) {
                const target = document
                    .elementFromPoint(event.clientX, event.clientY)
                    ?.closest<HTMLElement>("[data-row-id]")?.dataset.rowId;
                if (target && baseById.has(target)) {
                    createLink(drag.id, target);
                }
            }
            return;
        }
        if (drag.mode === "segment") {
            const task = baseById.get(drag.id);
            if (drag.moved && drag.current && drag.segments && task?.start) {
                const total = spanDays({ start: task.start, end: drag.current.end }, calendar);
                const pieces = segmentSpans(
                    { ...task, end: drag.current.end, segments: drag.segments.value },
                    calendar
                );
                const index = Math.min(drag.segment ?? 0, pieces.length - 1);
                commitSegments(
                    task,
                    drag.segments.value,
                    total,
                    fill(texts.segmentMoved, { n: index + 1, name: task.name, start: formatDate(pieces[index]?.start) })
                );
            }
            return;
        }
        if (drag.moved && drag.current) {
            commit(drag.id, drag.current, drag.original);
        } else if (!drag.moved) {
            if (linking) {
                setLinking(undefined);
                createLink(linking, drag.id);
            } else {
                props.onClick?.(drag.id);
            }
        }
    };

    const onContextMenu = (event: MouseEvent<HTMLDivElement>, row: Row): void => {
        if (row.kind === "task" && openMenu(row.id, event.clientX, event.clientY)) {
            event.preventDefault();
        }
    };

    // ---------------------------------------------------------------- splitter

    const splitDrag = useRef<{ x0: number; width0: number } | null>(null);
    const onSplitKey = (event: KeyboardEvent<HTMLDivElement>): void => {
        const steps: Record<string, number> = { ArrowLeft: -16, ArrowRight: 16 };
        if (event.key in steps) {
            event.preventDefault();
            setGridWidth(current => Math.max(GRID_MIN, Math.min(GRID_MAX, current + steps[event.key])));
        } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            setGridWidth(event.key === "Home" ? GRID_MIN : GRID_MAX);
        }
    };

    // ---------------------------------------------------------------- labels and tooltip

    const conflictText = (link: Link): string => {
        const name = allMap.get(link.from)?.name ?? "";
        const type = linkType(link);
        const template =
            type === "SS"
                ? texts.tipConflictSS
                : type === "FF"
                ? texts.tipConflictFF
                : type === "SF"
                ? texts.tipConflictSF
                : texts.tipConflict;
        return fill(template, { name });
    };
    const typeText = (link: Link): string => {
        const type = linkType(link);
        const lag = formatLag(link.lag);
        if (type === "FS" && !lag) {
            return "";
        }
        const names = { FS: texts.typeFS, SS: texts.typeSS, FF: texts.typeFF, SF: texts.typeSF };
        return ` (${names[type]}${lag ? ` ${lag}` : ""})`;
    };

    const behindText = (task: Task): string =>
        fill(texts.tipBehind, {
            progress: `${task.progress ?? 0}%`,
            expected: `${Math.round(expectedProgress(task, statusDate, calendar) ?? 0)}%`
        });

    const barLabel = (row: Row): string => {
        const range = rangeOf(row);
        const values = {
            name: range.name,
            start: formatDate(range.start),
            end: formatDate(range.end),
            duration: formatDuration(range.start, range.end),
            progress: `${range.progress ?? 0}%`
        };
        if (row.kind === "task" && isMilestone(row.task)) {
            return fill(texts.milestoneLabel, values);
        }
        const template =
            range.progress === undefined ? texts.barLabel.replace(/,?\s*\[progress\][^,]*/, "") : texts.barLabel;
        let label = fill(template, values);
        if (row.kind === "task") {
            (incoming.get(row.id) ?? [])
                .filter(link => link.conflict)
                .forEach(link => {
                    label += `. ${conflictText(link)}`;
                });
            if (critical.has(row.id)) {
                label += `. ${texts.tipCritical}`;
            }
            if (row.task.baselineEnd) {
                label += `. ${texts.tipVariance}: ${varianceText(row.task, false)}`;
            }
            if (row.task.assignee) {
                label += `. ${texts.tipAssignee}: ${row.task.assignee}`;
            }
            if (behind.has(row.id)) {
                label += `. ${behindText(row.task)}`;
            }
            if (scenarioIds.has(row.id)) {
                label += `. ${texts.tipScenario}`;
            }
            const constraint = constraintInfo?.get(row.id);
            if (constraint) {
                label += `. ${texts.tipConstraint}: ${constraint.label}`;
            }
            (usage?.overallocated.get(row.id) ?? []).forEach(entry => {
                if (props.showResources) {
                    label += `. ${fill(texts.overallocatedNote, { name: entry.resource, days: entry.days })}`;
                }
            });
            if (row.task.segments) {
                label += `. ${texts.tipSegments}: ${fill(texts.segmentsValue, {
                    n: segmentSpans(row.task, calendar).length,
                    work: formatDays(workDays(row.task, calendar))
                })}`;
            }
            fieldList.forEach(field => {
                if (field.inTooltip !== false) {
                    const text = fieldText(field, row.task);
                    if (text) {
                        label += `. ${field.name}: ${text}`;
                    }
                }
            });
        } else if (row.project) {
            label = `${texts.colProject}: ${label}`;
        }
        return label;
    };

    // The task being dragged or nudged shows its live dates; otherwise the hovered or focused one.
    const tooltipRowId = menu || editing ? undefined : preview?.id ?? hoverId ?? focusTipId;
    const tooltipIndex = tooltipRowId !== undefined ? rows.findIndex(row => row.id === tooltipRowId) : -1;
    let tooltip: { rowIndex: number; x: number; id: string; above: boolean; content: ReactNode } | undefined;
    if (tooltipIndex >= 0) {
        const row = rows[tooltipIndex];
        const range = rangeOf(row);
        const box = boxOfRow(row);
        if (box && range.start && range.end) {
            const entries: Array<[string, string]> = [
                [texts.tipStart, formatDate(range.start)],
                [texts.tipEnd, formatDate(range.end)],
                [texts.tipDuration, formatDuration(range.start, range.end)]
            ];
            if (range.progress !== undefined) {
                entries.push([texts.tipProgress, `${range.progress}%`]);
            }
            const notes: Array<{ text: string; kind: "critical" | "conflict" | "late" | "pushed" }> = [];
            if (row.kind === "task") {
                const { task } = row;
                if (task.group) {
                    entries.push([texts.tipGroup, task.group]);
                }
                if (task.assignee) {
                    entries.push([texts.tipAssignee, task.assignee]);
                }
                if (task.baselineStart && task.baselineEnd) {
                    entries.push([
                        texts.tipBaseline,
                        `${formatDate(task.baselineStart)} – ${formatDate(task.baselineEnd)}`
                    ]);
                    entries.push([texts.tipVariance, varianceText(task, false)]);
                }
                const predecessors = incoming.get(row.id) ?? [];
                if (predecessors.length > 0) {
                    entries.push([
                        texts.tipDependsOn,
                        predecessors.map(link => `${allMap.get(link.from)?.name ?? ""}${typeText(link)}`).join(", ")
                    ]);
                }
                predecessors
                    .filter(link => link.conflict)
                    .forEach(link => notes.push({ text: conflictText(link), kind: "conflict" }));
                const float = floats?.get(row.id);
                if (float) {
                    entries.push([texts.tipFloat, fill(texts.floatDays, { days: formatNumber(float.days) })]);
                }
                if (task.deadline) {
                    entries.push([texts.tipDeadline, formatDate(task.deadline)]);
                    if (missesDeadline(task)) {
                        notes.push({
                            text: fill(texts.deadlineMissed, {
                                days: formatNumber(deadlineOverrun(task, calendar) ?? 0)
                            }),
                            kind: "late"
                        });
                    }
                }
                if (critical.has(row.id)) {
                    notes.push({ text: texts.tipCritical, kind: "critical" });
                }
                if (preview && preview.id === row.id && preview.pushed.size > 0) {
                    notes.push({ text: fill(texts.pushed, { n: preview.pushed.size }), kind: "pushed" });
                }
                if (behind.has(row.id)) {
                    notes.push({ text: behindText(task), kind: "late" });
                }
                if (scenarioIds.has(row.id)) {
                    notes.push({ text: texts.tipScenario, kind: "pushed" });
                }
                // 2.3
                if (task.assignments && task.assignments.length > 0) {
                    entries.push([texts.tipAssignments, formatAssignments(task.assignments)]);
                }
                if (task.segments) {
                    entries.push([
                        texts.tipSegments,
                        fill(texts.segmentsValue, {
                            n: segmentSpans(task, calendar).length,
                            work: formatDays(workDays(task, calendar))
                        })
                    ]);
                }
                const constraint = constraintInfo?.get(row.id);
                if (constraint) {
                    entries.push([texts.tipConstraint, constraintText(task.constraint!)]);
                    if (constraint.broken) {
                        notes.push({
                            text: fill(texts.constraintBroken, { days: formatNumber(constraint.days ?? 0) }),
                            kind: "conflict"
                        });
                    }
                }
                if (earned?.costs.has(row.id)) {
                    entries.push([texts.tipCost, formatMoney(earned.costs.get(row.id)!)]);
                }
                // 1.1 custom fields
                fieldList.forEach(field => {
                    if (field.inTooltip !== false) {
                        const text = fieldText(field, task);
                        if (text) {
                            entries.push([field.name, text]);
                        }
                    }
                });
                if (props.showResources) {
                    (usage?.overallocated.get(row.id) ?? []).forEach(entry =>
                        notes.push({
                            text: fill(texts.overallocatedNote, { name: entry.resource, days: entry.days }),
                            kind: "late"
                        })
                    );
                }
            }
            const x = Math.max(scroll.left + 8, Math.min(box.x, scroll.left + viewport.width - 290));
            tooltip = {
                rowIndex: tooltipIndex,
                // Flip above the row when the space below it is scrolled out of view.
                above:
                    (tooltipIndex + 1) * rh + 150 > scroll.top + bodyViewport && tooltipIndex * rh - 150 > scroll.top,
                x,
                id: tipId,
                content: (
                    <>
                        <strong className="mxgantt-tooltip-title">{range.name}</strong>
                        <dl>
                            {entries.map(([term, value]) => (
                                <div key={term}>
                                    <dt>{term}</dt>
                                    <dd>{value}</dd>
                                </div>
                            ))}
                        </dl>
                        {notes.map(note => (
                            <p key={note.text} className={`mxgantt-tooltip-${note.kind}`}>
                                {note.text}
                            </p>
                        ))}
                    </>
                )
            };
        }
    }

    // ---------------------------------------------------------------- export

    const exportChart = (withHeader: boolean): { svg: string; width: number; height: number } | undefined => {
        const root = rootRef.current;
        if (!root) {
            return undefined;
        }
        const style = getComputedStyle(root);
        const read = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;
        const palette: ExportPalette = {
            background: read("--mxgantt-surface", "#fff"),
            text: read("--mxgantt-text", "#1f2328"),
            muted: read("--mxgantt-muted", "#667085"),
            border: read("--mxgantt-border", "#d0d5dd"),
            header: read("--mxgantt-header-bg", "#f5f6f8"),
            weekend: read("--mxgantt-weekend", "rgba(0,0,0,0.04)"),
            bar: read("--mxgantt-bar", "#3565d6"),
            group: read("--mxgantt-group", "#475467"),
            milestone: read("--mxgantt-milestone", "#b54708"),
            today: read("--mxgantt-today", "#e5484d"),
            link: read("--mxgantt-link", "#7a8599"),
            conflict: read("--mxgantt-conflict", "#d92d20"),
            critical: read("--mxgantt-critical", "#f79009"),
            baseline: read("--mxgantt-baseline", "#98a2b3"),
            behind: read("--mxgantt-behind", "#c4320a"),
            status: read("--mxgantt-status", "#0e9384"),
            fontFamily: style.fontFamily || "sans-serif"
        };
        const shadeWeekends = props.showWeekends && (zoom === "day" || zoom === "week");
        let header: ExportHeader | undefined;
        if (withHeader) {
            const legend: ExportHeader["legend"] = [{ label: texts.legendTask, kind: "task" }];
            if (groupIds.length > 0) {
                legend.push({ label: texts.legendGroup, kind: "group" });
            }
            if (props.tasks.some(isMilestone)) {
                legend.push({ label: texts.legendMilestone, kind: "milestone" });
            }
            if (critical.size > 0) {
                legend.push({ label: texts.legendCritical, kind: "critical" });
            }
            if (conflicts.size > 0) {
                legend.push({ label: texts.legendConflict, kind: "conflict" });
            }
            if (hasBaseline) {
                legend.push({ label: texts.legendBaseline, kind: "baseline" });
            }
            if (props.showToday) {
                legend.push({ label: texts.legendToday, kind: "today" });
            }
            if (props.highlightBehind && behind.size > 0) {
                legend.push({ label: texts.legendBehind, kind: "behind" });
            }
            if (props.showStatusLine) {
                legend.push({ label: `${texts.legendStatus}: ${formatDate(statusDate)}`, kind: "status" });
            }
            props.assigneeColors?.forEach((color, name) => legend.push({ label: name, kind: "task", color }));
            header = {
                title: props.exportTitle || props.exportFileName || "gantt",
                range: fill(texts.printRange, { start: formatDate(bounds.min), end: formatDate(bounds.max) }),
                legend
            };
        }
        return buildSvg({
            rows,
            tasks: taskMap,
            rowIndex,
            links,
            critical,
            scale,
            cells,
            columns: props.showGrid ? columns : [],
            rowHeight: rh,
            showWeekends: shadeWeekends,
            shading:
                shadeWeekends && calendar.active
                    ? nonWorkingDays(calendar, scale.start, scale.end).map(span => {
                          const x = dateToX(span.start, scale);
                          return { x, width: dateToX(span.end, scale) - x };
                      })
                    : undefined,
            showToday: props.showToday,
            showLinks: props.showLinks,
            today: new Date(),
            palette,
            header,
            behind,
            statusDate: props.showStatusLine ? statusDate : undefined
        });
    };

    const onExportPng = (): void => {
        const result = exportChart(false);
        if (!result) {
            return;
        }
        svgToPng(result.svg, result.width, result.height)
            .then(blob => downloadBlob(blob, `${props.exportFileName || "gantt"}.png`))
            .catch(error => console.error("MxGantt: could not save the image", error));
    };
    const onPrint = (): void => {
        const result = exportChart(props.printDetails);
        if (result) {
            printSvg(result.svg, props.exportTitle || props.exportFileName || "gantt");
        }
    };
    const fileBase = props.exportFileName || "gantt";
    // Both exports build the file and start the download inside the click, so browsers allow it.
    const onExportXlsx = (): void => {
        try {
            const sheet = planSheet(tasks, {
                calendar,
                withTime: snap === "hour",
                hasProgress: props.hasProgress,
                hasDependencies: props.hasDependencies,
                hasBaseline,
                hasAssignee: props.hasAssignee,
                titles: {
                    sheet: texts.xlsxSheet,
                    wbs: texts.colWbs,
                    key: texts.xlsxKey,
                    task: texts.colTask,
                    group: texts.tipGroup,
                    start: texts.colStart,
                    end: texts.colEnd,
                    duration: texts.xlsxDuration,
                    progress: texts.colProgress,
                    predecessors: texts.colPredecessors,
                    assignee: texts.colAssignee,
                    baselineStart: texts.colBaselineStart,
                    baselineEnd: texts.colBaselineEnd,
                    variance: texts.xlsxVariance
                },
                extra: columns
                    .filter(column => column.field)
                    .map(column => {
                        const field = column.field!;
                        const percent = field.format === "percent";
                        const numeric = field.type === "number" || field.type === "rating" || field.type === "formula";
                        return {
                            title: field.name,
                            kind: numeric ? (percent ? "percent" : "number") : field.type === "date" ? "date" : "text",
                            width: Math.max(10, Math.min(40, Math.round((column.width || 100) / 7))),
                            value: (t: Task) => {
                                const value =
                                    field.type === "formula"
                                        ? formulaOf(field, t)
                                        : exportValue(field, t.fieldValues?.[field.key], {
                                              yes: texts.yes,
                                              no: texts.no
                                          });
                                return percent && typeof value === "number" ? value / 100 : value;
                            }
                        };
                    })
            });
            const bytes = buildXlsx(sheet);
            downloadBlob(new Blob([bytes as BlobPart], { type: XLSX_MIME }), `${fileBase}.xlsx`);
        } catch (error) {
            console.error("MxGantt: could not export to Excel", error);
            announce(texts.exportFailed);
        }
    };
    const onExportProject = (): void => {
        try {
            const xml = buildMspdi(tasks, {
                name: props.exportTitle || fileBase,
                calendar,
                links,
                resources: props.resources
            });
            downloadBlob(new Blob([xml], { type: "application/xml;charset=utf-8" }), `${fileBase}.xml`);
        } catch (error) {
            console.error("MxGantt: could not export to MS Project", error);
            announce(texts.exportFailed);
        }
    };
    const onExportCsv = (): void => {
        const all = buildRows(sortedTasks, new Set());
        const header = columns.map(column => column.title);
        const body = all.map(row => columns.map(column => (column.csv ? column.csv(row) : column.text(row))));
        const blob = new Blob([toCsv(header, body)], { type: "text/csv;charset=utf-8" });
        downloadBlob(blob, `${props.exportFileName || "gantt"}.csv`);
    };

    // ---------------------------------------------------------------- workload

    const bucket = zoom === "day" ? "day" : "week";
    const loads = useMemo(
        () =>
            props.showWorkload && props.hasAssignee
                ? workload(tasks, scale.start, scale.end, bucket, calendar, props.workloadCapacity, texts.unassigned)
                : [],
        [props.showWorkload, props.hasAssignee, tasks, scale, bucket, calendar, props.workloadCapacity, texts]
    );

    // ---------------------------------------------------------------- render

    const rendered: number[] = [];
    for (let index = first; index < last; index++) {
        rendered.push(index);
    }
    const tabIndexRow = tabStopId !== undefined ? rowIndex.get(tabStopId) : undefined;
    if (tabIndexRow !== undefined && (tabIndexRow < first || tabIndexRow >= last)) {
        rendered.push(tabIndexRow);
    }
    const editingRow = editing ? rowIndex.get(editing.rowId) : undefined;

    const emptyText =
        props.loading && props.tasks.length === 0
            ? texts.loading
            : props.tasks.length === 0
            ? texts.empty
            : tasks.length === 0
            ? texts.noMatches
            : "";

    const enterprise =
        props.allowUndo ||
        props.showFilter ||
        props.inlineEdit ||
        props.linkEditing ||
        props.columnChooser ||
        autoAvailable ||
        scenarioAvailable ||
        !!props.onAdd ||
        !!props.onDelete ||
        !!props.hasSegments;

    const columnItems: MenuItem[] | undefined = props.columnChooser
        ? allColumns
              .filter(column => column.hideable !== false)
              .map(column => ({ key: column.key, label: column.title, checked: !hiddenColumns.has(column.key) }))
        : undefined;
    const toggleColumn = (key: string): void =>
        setHiddenColumns(current => {
            if (allColumns.find(column => column.key === key)?.hideable === false) {
                // 1.2: Task name and columns set to Users can hide = No stay visible.
                return current;
            }
            const next = new Set(current);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });

    // ---------------------------------------------------------------- 1.1 custom fields and column chooser

    const canManage = !!customSetup?.canManage;
    const maxFields = customSetup?.maxFields ?? 30;
    const chooserOn = props.columnChooser || !!customSetup;
    const orderedKeys = orderedColumns.map(column => column.key);
    const moveColumn = (key: string, toIndex: number): void => setColumnOrder(moveKey(orderedKeys, key, toIndex));
    // 1.2: a click on a sortable header sorts ascending, then descending, then not at all.
    const anySortable = orderedColumns.some(column => column.sortable);
    const toggleSort = (key: string): void => {
        const column = orderedColumns.find(entry => entry.key === key);
        if (!column?.sortable) {
            return;
        }
        const next = nextSort(activeSort, key);
        setSort(next);
        announce(
            next
                ? fill(next.dir === "asc" ? texts.sortedAscending : texts.sortedDescending, { name: column.title })
                : texts.sortCleared
        );
    };
    const reorderBefore = (key: string, before: string | undefined): void => {
        const rest = orderedKeys.filter(entry => entry !== key);
        const at = before ? rest.indexOf(before) : rest.length;
        setColumnOrder(moveKey(orderedKeys, key, at < 0 ? rest.length : at));
        const column = orderedColumns.find(entry => entry.key === key);
        if (column) {
            announce(fill(texts.columnMoved, { name: column.title, n: (at < 0 ? rest.length : at) + 1 }));
        }
    };
    const chooserColumns: ChooserColumn[] = orderedColumns.map(column => ({
        key: column.key,
        title: column.title,
        visible: isShown(column),
        locked: column.hideable === false,
        kind: column.field
            ? "custom"
            : /^custom\d+$/.test(column.key) || column.layout?.type === "attribute"
            ? "app"
            : "plan",
        icon: column.icon
    }));
    const openFieldForm = (anchor?: DOMRect, key?: string): void => {
        if (!canManage) {
            return;
        }
        if (!key && fieldList.length >= maxFields) {
            announce(fill(texts.tooManyFields, { n: maxFields }));
            return;
        }
        flushKeys();
        setEditing(undefined);
        setFieldForm({ key, anchor });
    };
    const dismissHint = (): void => {
        setHintDismissed(true);
        try {
            window.localStorage.setItem(hintKey, "1");
        } catch {
            // Storage blocked: the hint simply comes back next time.
        }
    };
    const valueEntries = (key: string): Array<{ id: string; raw: FieldValue | undefined }> =>
        props.tasks.map(task => ({ id: task.id, raw: task.fieldValues?.[key] }));
    const submitField = (field: FieldDef): void => {
        const existing = fieldList.find(entry => entry.key === field.key);
        setFieldForm(undefined);
        if (!existing) {
            customSetup?.onFieldsChange([...fieldList, field]);
            setHiddenColumns(current => {
                const next = new Set(current);
                next.delete(`f:${field.key}`);
                return next;
            });
            dismissHint();
            announce(fill(texts.fieldAdded, { name: field.name }));
            return;
        }
        let saved = field;
        if (existing.type !== field.type) {
            // Convert the stored values to the new type in one batch (one undo step for the values).
            const conversion = convertField(existing, field, valueEntries(field.key));
            saved = conversion.field;
            const entries: Array<{ id: string; next: TaskValues }> = [];
            conversion.values.forEach((value, id) => {
                const task = baseById.get(id);
                if (task) {
                    entries.push({ id, next: { fields: withFieldValue(task.fieldsText, field.key, value) } });
                }
            });
            if (entries.length > 0) {
                commitValues(entries, field.name);
            }
        }
        customSetup?.onFieldsChange(fieldList.map(entry => (entry.key === field.key ? saved : entry)));
        announce(fill(texts.fieldSaved, { name: field.name }));
    };
    const updateField = (key: string, patch: Partial<FieldDef>): void =>
        customSetup?.onFieldsChange(fieldList.map(entry => (entry.key === key ? { ...entry, ...patch } : entry)));
    const deleteField = (key: string): void => {
        const field = fieldList.find(entry => entry.key === key);
        setDialog(undefined);
        if (field) {
            customSetup?.onFieldsChange(fieldList.filter(entry => entry.key !== key));
            announce(fill(texts.fieldDeleted, { name: field.name }));
        }
    };
    const headerAnchor = (key: string): DOMRect | undefined =>
        rootRef.current?.querySelector<HTMLElement>(`[data-column="${CSS.escape(key)}"]`)?.getBoundingClientRect();
    const headerMenu = (column: ListColumn): MenuItem[] | undefined => {
        const items: MenuItem[] = [];
        if (column.field && canManage) {
            items.push(
                { key: "edit", label: texts.editField },
                { key: "onBar", label: texts.showOnBar, checked: !!column.field.onBar },
                { key: "inTooltip", label: texts.showInTooltip, checked: column.field.inTooltip !== false }
            );
        }
        if (chooserOn && column.hideable !== false) {
            items.push({ key: "hide", label: texts.hideColumn });
        }
        if (column.field && canManage) {
            items.push({ key: "delete", label: texts.deleteField, danger: true });
        }
        return items;
    };
    const onHeaderMenu = (columnKey: string, item: string): void => {
        const field = fieldList.find(entry => `f:${entry.key}` === columnKey);
        switch (item) {
            case "edit":
                if (field) {
                    // After the menu has closed, so the popover takes focus.
                    window.setTimeout(() => openFieldForm(headerAnchor(columnKey), field.key), 0);
                }
                break;
            case "onBar":
                if (field) {
                    updateField(field.key, { onBar: field.onBar ? undefined : true });
                }
                break;
            case "inTooltip":
                if (field) {
                    updateField(field.key, { inTooltip: field.inTooltip === false ? undefined : false });
                }
                break;
            case "hide": {
                toggleColumn(columnKey);
                const column = orderedColumns.find(entry => entry.key === columnKey);
                if (column) {
                    announce(fill(texts.columnHidden, { name: column.title }));
                }
                break;
            }
            case "delete":
                if (field) {
                    setDialog({ kind: "deleteField", key: field.key });
                }
                break;
            default:
        }
    };
    const fieldFilters = useMemo(
        () =>
            fieldList.length === 0
                ? undefined
                : filterChoices(fieldList, () => props.tasks.map(task => task.fieldValues ?? {}), {
                      yes: texts.yes,
                      no: texts.no,
                      empty: texts.emptyValue
                  }).map(({ field, choices }) => ({
                      label: field.name,
                      choices: choices.map(choice => ({
                          value: `${field.key}=${choice.value}`,
                          label: `${field.name}: ${choice.label}`
                      }))
                  })),
        [fieldList, props.tasks, texts]
    );
    const barFields = fieldList.filter(field => field.onBar);
    const barExtras =
        barFields.length > 0
            ? (task: Task): ReactNode => {
                  const parts = barFields
                      .slice(0, 4)
                      .map(field => {
                          if (field.type === "select") {
                              const option = optionOf(field, readValue(field, task.fieldValues?.[field.key]));
                              return option ? <OptionChip key={field.key} option={option} /> : null;
                          }
                          const text = fieldText(field, task);
                          return text ? (
                              <span key={field.key} className="mxgantt-bar-field" title={field.name}>
                                  {text}
                              </span>
                          ) : null;
                      })
                      .filter(Boolean);
                  return parts.length > 0 ? <span className="mxgantt-bar-fields">{parts}</span> : null;
              }
            : undefined;
    const showHint =
        canManage &&
        !!customSetup?.showHint &&
        fieldList.length === 0 &&
        !hintDismissed &&
        props.showGrid &&
        props.tasks.length > 0 &&
        !fieldForm;
    const editingField = fieldForm?.key ? fieldList.find(entry => entry.key === fieldForm.key) : undefined;
    const sampleTask = (activeId ? baseById.get(activeId) : undefined) ?? props.tasks[0];

    const dialogTask = dialog?.kind === "delete" ? baseById.get(dialog.id) : undefined;
    const helpRows: Array<[string, string]> = [
        ["↑ ↓", texts.helpNavigate],
        ["Home / End", texts.helpFirstLast],
        ["← →", texts.helpMove],
        ["Page Up / Page Down", texts.helpMoveWeek],
        ["Shift + ← →", texts.helpResize],
        ["+ / -", texts.helpProgress],
        ["Enter", texts.helpOpen],
        ["Ctrl + wheel", texts.helpZoom]
    ];
    if (props.inlineEdit) {
        helpRows.push(["F2", texts.helpEdit]);
    }
    if (props.linkEditing) {
        helpRows.push(["L", texts.helpLink]);
    }
    helpRows.push(["Shift + F10", texts.helpMenu]);
    if (props.onDelete) {
        helpRows.push(["Delete", texts.helpDelete]);
    }
    if (props.onAdd) {
        helpRows.push(["Insert", texts.addTask]);
    }
    if (props.allowUndo) {
        helpRows.push(["Ctrl + Z", texts.helpUndo], ["Ctrl + Y", texts.helpRedo]);
    }
    if (props.hasSegments) {
        helpRows.push(["Alt + ← →", texts.helpSegment]);
    }
    helpRows.push(["Esc", texts.helpCancel], ["?", texts.helpHelp]);

    return (
        <div
            ref={rootRef}
            className={classNames("mxgantt", props.className, {
                "mxgantt--dark": dark,
                "is-linking": !!linking || !!linkDraft,
                "mxgantt--animate": motion,
                "mxgantt--subtle": motionLvl === "subtle",
                "is-intro": motion && intro,
                "is-scenario": !!scenario,
                "mxgantt--portfolio": look.portfolio,
                "mxgantt--two-line": look.twoLine
            })}
            style={props.style}
            onKeyDown={onRootKeyDown}
        >
            {props.showToolbar && (
                <Toolbar
                    texts={texts}
                    zoom={zoom}
                    onZoom={next => changeZoom(next)}
                    onToday={scrollToToday}
                    onFit={props.zoomToFit ? fitToPlan : undefined}
                    hasGroups={groupIds.length > 0}
                    allCollapsed={allCollapsed}
                    onToggleAll={() => setCollapsed(allCollapsed ? new Set() : new Set(groupIds))}
                    criticalAvailable={criticalAvailable}
                    critical={showCritical}
                    onCritical={() => setShowCritical(current => !current)}
                    allowExport={props.allowExport}
                    onExportPng={onExportPng}
                    onPrint={onPrint}
                    undo={
                        props.allowUndo
                            ? {
                                  canUndo: history.past.length > 0,
                                  canRedo: history.future.length > 0,
                                  onUndo: doUndo,
                                  onRedo: doRedo
                              }
                            : undefined
                    }
                    autoSchedule={autoAvailable ? { on: autoOn, onToggle: () => setAutoOn(on => !on) } : undefined}
                    scenario={scenarioAvailable ? { on: !!scenario, onToggle: toggleScenario } : undefined}
                    onExportXlsx={props.exportExcel ? onExportXlsx : undefined}
                    onExportProject={props.exportProject ? onExportProject : undefined}
                    onAdd={props.onAdd ? addTask : undefined}
                    onDelete={
                        props.onDelete
                            ? {
                                  disabled: !!scenario || !activeId || !baseById.has(activeId),
                                  run: () => activeId && askDelete(activeId)
                              }
                            : undefined
                    }
                    columns={columnItems ? { items: columnItems, onToggle: toggleColumn } : undefined}
                    columnsPanel={
                        chooserOn && props.showGrid
                            ? (id, close) => (
                                  <ColumnsPanel
                                      id={id}
                                      texts={texts}
                                      columns={chooserColumns}
                                      onToggle={toggleColumn}
                                      onMove={moveColumn}
                                      onShowAll={() => setHiddenColumns(new Set())}
                                      onReset={() => {
                                          setHiddenColumns(new Set(defaultHidden()));
                                          setColumnOrder([]);
                                          setColumnWidths({});
                                          setSort(undefined);
                                      }}
                                      onAddField={
                                          canManage
                                              ? () => {
                                                    close(false);
                                                    openFieldForm(
                                                        rootRef.current
                                                            ?.querySelector<HTMLElement>(".mxgantt-button-columns")
                                                            ?.getBoundingClientRect()
                                                    );
                                                }
                                              : undefined
                                      }
                                      onClose={close}
                                  />
                              )
                            : undefined
                    }
                    onExportCsv={props.exportCsv ? onExportCsv : undefined}
                    onHelp={enterprise ? () => setDialog({ kind: "help" }) : undefined}
                    onLevel={props.resourceLeveling && hasResourceData ? startLeveling : undefined}
                    onSchedule={props.scheduleButton && props.hasDependencies ? startSchedule : undefined}
                    baselines={
                        props.hasBaselines
                            ? { on: baselinesOpen, onToggle: () => setBaselinesOpen(open => !open) }
                            : undefined
                    }
                    onImport={props.onImport ? () => importInput.current?.click() : undefined}
                    filter={
                        props.showFilter
                            ? {
                                  value: filter,
                                  onChange: changeFilter,
                                  showMine: props.hasAssignee && !!props.me,
                                  showCritical: criticalAvailable,
                                  status: filtering
                                      ? fill(texts.filtered, { n: tasks.length, total: props.tasks.length })
                                      : "",
                                  fields: fieldFilters
                              }
                            : undefined
                    }
                />
            )}
            {health && (
                <HealthStrip
                    texts={texts}
                    health={health}
                    animate={motion}
                    formatDate={formatDate}
                    formatNumber={formatNumber}
                />
            )}
            {props.saveState && props.saveState.failed > 0 ? (
                <div className="mxgantt-save is-failed" role="alert">
                    <span>{fill(texts.saveFailed, { n: props.saveState.failed })}</span>
                    <button type="button" className="mxgantt-button is-primary" onClick={props.saveState.onRetry}>
                        {texts.saveRetry}
                    </button>
                    <button type="button" className="mxgantt-button" onClick={props.saveState.onDismiss}>
                        {texts.saveDismiss}
                    </button>
                </div>
            ) : props.saveState?.saving ? (
                <div className="mxgantt-save" role="status">
                    <span className="mxgantt-save-spinner" aria-hidden="true" />
                    {texts.saving}
                </div>
            ) : null}
            {notice && (
                <div className="mxgantt-save is-failed" role="alert">
                    <span>{notice}</span>
                    <button type="button" className="mxgantt-button" onClick={() => setNotice(undefined)}>
                        {texts.saveDismiss}
                    </button>
                </div>
            )}
            {projects && projects.length > 0 && (
                <Panel texts={texts} title={texts.portfolioPanel} className="mxgantt-panel-portfolio">
                    <PortfolioPanel
                        texts={texts}
                        projects={projects}
                        formatDate={formatDate}
                        formatNumber={formatNumber}
                        onGoTo={goToProject}
                    />
                </Panel>
            )}
            {props.hasBaselines && baselinesOpen && (
                <Panel texts={texts} title={texts.baselinePanel} className="mxgantt-panel-baselines">
                    <BaselinePanel
                        texts={texts}
                        names={namedBaselines}
                        hasAttributes={props.hasBaseline}
                        shown={shownBaseline}
                        compare={compareWith}
                        onShow={showBaseline}
                        onCompare={setBaselineCompare}
                        onSave={props.baselineEditing !== false && !scenario ? saveBaselineStable : undefined}
                        onDelete={props.baselineEditing !== false && !scenario ? askDeleteBaseline : undefined}
                        comparison={comparison}
                        formatDate={formatDate}
                        formatNumber={formatNumber}
                        formatMoney={props.hasCost ? formatMoney : undefined}
                        onGoTo={goToRowStable}
                    />
                </Panel>
            )}
            {proposal && (
                <div className="mxgantt-scenario mxgantt-proposal" role="region" aria-label={texts.proposalRegion}>
                    <span className="mxgantt-scenario-badge">
                        {proposal.kind === "level" ? texts.levelTitle : texts.scheduleTitle}
                    </span>
                    <span className="mxgantt-scenario-text" role="status" aria-live="polite">
                        {proposal.lines.join(" ")}
                    </span>
                    <div className="mxgantt-scenario-actions">
                        <button type="button" className="mxgantt-button" onClick={cancelProposal}>
                            {texts.proposalCancel}
                        </button>
                        <button
                            type="button"
                            className="mxgantt-button is-primary mxgantt-proposal-apply"
                            aria-disabled={proposal.moved.size === 0}
                            onClick={applyProposal}
                        >
                            {texts.proposalApply}
                        </button>
                    </div>
                </div>
            )}
            {props.onImport && (
                <input
                    ref={importInput}
                    type="file"
                    className="mxgantt-sr"
                    tabIndex={-1}
                    aria-label={texts.importFile}
                    accept=".xml,application/xml,text/xml"
                    onChange={event => {
                        onImportFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
            )}
            {scenario && (
                <div className="mxgantt-scenario" role="region" aria-label={texts.scenarioRegion}>
                    <span className="mxgantt-scenario-badge">{texts.scenario}</span>
                    <span className="mxgantt-scenario-text" role="status" aria-live="polite">
                        {scenarioText}
                    </span>
                    <span className="mxgantt-sr">{texts.scenarioHint}</span>
                    <div className="mxgantt-scenario-actions">
                        <button type="button" className="mxgantt-button" onClick={discardScenario}>
                            {texts.scenarioDiscard}
                        </button>
                        <button
                            type="button"
                            className="mxgantt-button is-primary"
                            aria-disabled={!summary?.changed}
                            onClick={() => summary?.changed && applyScenarioPlan()}
                        >
                            {texts.scenarioApply}
                        </button>
                    </div>
                </div>
            )}
            <div className="mxgantt-body" style={{ height: props.height }}>
                {props.showGrid && (
                    <>
                        <TaskList
                            texts={texts}
                            rows={rows}
                            columns={columns}
                            width={gridWidth}
                            rowHeight={rh}
                            first={first}
                            last={last}
                            extraRows={editingRow !== undefined ? [editingRow] : []}
                            bottomPad={viewport.scrollbar}
                            focusedId={activeId}
                            bodyNode={listRef}
                            onScroll={onListScroll}
                            onRowClick={(row, onEditableCell) => {
                                if (editing) {
                                    return;
                                }
                                focusRow(row.id);
                                if (row.kind === "task") {
                                    if (linking) {
                                        setLinking(undefined);
                                        createLink(linking, row.id);
                                    } else if (!onEditableCell) {
                                        // 1.2: a click on an editable cell is the start of a double-click edit,
                                        // so On task click (often opening a page) only runs for the other cells.
                                        props.onClick?.(row.id);
                                    }
                                }
                            }}
                            onToggle={toggleGroup}
                            colorOf={row => (row.kind === "task" ? row.task.color : undefined)}
                            editing={editing}
                            canEdit={canEdit}
                            onStartEdit={(row, column) => startEdit(row.id, column)}
                            onCommitEdit={commitEdit}
                            onCancelEdit={cancelEdit}
                            onResize={
                                props.columnResize || customSetup
                                    ? (key, next) => setColumnWidths(current => ({ ...current, [key]: next }))
                                    : undefined
                            }
                            headerMenu={chooserOn || canManage ? headerMenu : undefined}
                            onHeaderMenu={onHeaderMenu}
                            onAddField={canManage ? anchor => openFieldForm(anchor) : undefined}
                            onQuickEdit={canEditValues ? quickEdit : undefined}
                            onReorder={chooserOn ? reorderBefore : undefined}
                            sort={activeSort}
                            onSort={anySortable ? toggleSort : undefined}
                            headerExtra={
                                showHint ? (
                                    <FieldsHint
                                        texts={texts}
                                        onAdd={() =>
                                            openFieldForm(
                                                rootRef.current
                                                    ?.querySelector<HTMLElement>(".mxgantt-head-addbutton")
                                                    ?.getBoundingClientRect()
                                            )
                                        }
                                        onDismiss={dismissHint}
                                    />
                                ) : undefined
                            }
                        />
                        <div
                            className="mxgantt-splitter"
                            role="separator"
                            aria-orientation="vertical"
                            aria-label={texts.splitter}
                            aria-valuenow={gridWidth}
                            aria-valuemin={GRID_MIN}
                            aria-valuemax={GRID_MAX}
                            tabIndex={0}
                            onKeyDown={onSplitKey}
                            onPointerDown={event => {
                                splitDrag.current = { x0: event.clientX, width0: gridWidth };
                                try {
                                    event.currentTarget.setPointerCapture(event.pointerId);
                                } catch {
                                    // Nothing to capture for synthetic events.
                                }
                            }}
                            onPointerMove={event => {
                                const split = splitDrag.current;
                                if (split) {
                                    const next = split.width0 + event.clientX - split.x0;
                                    setGridWidth(Math.max(GRID_MIN, Math.min(GRID_MAX, next)));
                                }
                            }}
                            onPointerUp={() => {
                                splitDrag.current = null;
                            }}
                            onPointerCancel={() => {
                                splitDrag.current = null;
                            }}
                        />
                    </>
                )}
                <Timeline
                    barExtras={barExtras}
                    barText={barText}
                    look={look}
                    rows={rows}
                    rendered={rendered}
                    first={first}
                    last={last}
                    scale={scale}
                    cells={cells}
                    width={width}
                    rowHeight={rh}
                    scrollLeft={scroll.left}
                    viewportWidth={viewport.width}
                    tasks={taskMap}
                    rowIndex={rowIndex}
                    links={links}
                    critical={critical}
                    conflicts={conflicts}
                    showLinks={props.showLinks}
                    shading={shading}
                    showToday={props.showToday}
                    today={today}
                    todayLabel={texts.todayLine}
                    focusedId={tabStopId}
                    activeId={activeId}
                    draggingId={preview?.id}
                    editable={editableRow}
                    label={barLabel}
                    roleDescription={row =>
                        row.kind === "group"
                            ? row.project
                                ? texts.projectSummary
                                : texts.summary
                            : isMilestone(row.task)
                            ? texts.milestone
                            : texts.taskBar
                    }
                    tooltip={tooltip}
                    chartLabel={texts.chart}
                    helpId={helpId}
                    idPrefix={`mxgantt-${uid}`}
                    hasProgress={props.hasProgress}
                    pushed={preview?.pushed ?? proposal?.moved ?? NO_PUSH}
                    linkHandles={props.linkEditing}
                    linkHandleLabel={texts.linkHandle}
                    linkSourceId={linking}
                    linkDraft={linkDraft}
                    baselineLabel={texts.tipBaseline}
                    statusDate={props.showStatusLine ? statusDate : undefined}
                    statusLabel={`${texts.statusLine}: ${formatDate(statusDate)}`}
                    behind={behind}
                    changed={scenarioIds}
                    chain={chain ?? focusChain}
                    intro={motion && intro}
                    floats={floats}
                    calendar={calendar}
                    constraints={constraintInfo}
                    overallocated={overallocated}
                    compareBaseline={
                        compareWith
                            ? task => {
                                  const base = baselineOf(task, compareWith);
                                  return base ? { start: base.start, finish: base.finish } : undefined;
                              }
                            : undefined
                    }
                    compareLabel={texts.legendBaseline2}
                    segmentLabel={(index, total) => fill(texts.segmentLabel, { n: index + 1, total })}
                    deadlines={props.hasDeadline}
                    deadlineLabel={date => fill(texts.deadlineFlag, { date: formatDate(date) })}
                    markers={props.markers}
                    markerLabel={marker =>
                        fill(texts.markerLabel, { label: marker.label, date: formatDate(marker.date) })
                    }
                    progressLine={
                        props.progressLine && props.hasProgress
                            ? progressLinePoints(
                                  rendered
                                      .map(index => {
                                          const row = rows[index];
                                          return { index, task: row.kind === "task" ? row.task : undefined };
                                      })
                                      .sort((a, b) => a.index - b.index),
                                  statusDate,
                                  rh,
                                  date => dateToX(date, scale)
                              )
                            : undefined
                    }
                    handlers={{
                        onPointerDown,
                        onPointerMove,
                        onPointerUp: event => endDrag(event, false),
                        onPointerCancel: event => endDrag(event, true),
                        onKeyDown,
                        onFocus: (_event: FocusEvent<HTMLDivElement>, row) => {
                            setActiveId(row.id);
                            setFocusTipId(row.id);
                        },
                        onBlur: (_event: FocusEvent<HTMLDivElement>, row) => {
                            setFocusTipId(current => (current === row.id ? undefined : current));
                            if (keyPending.current?.id === row.id) {
                                flushKeys();
                            }
                        },
                        onHover: row => {
                            if (!dragRef.current) {
                                setHoverId(row?.id);
                            }
                        },
                        onContextMenu
                    }}
                    scrollNode={chartRef}
                    onScroll={onChartScroll}
                />
                {props.loading && props.tasks.length === 0 ? (
                    <div className="mxgantt-empty mxgantt-skeleton" role="status" aria-busy="true">
                        <span className="mxgantt-sr">{texts.loading}</span>
                        {[0, 1, 2, 3, 4].map(index => (
                            <span
                                key={index}
                                className="mxgantt-skeleton-bar"
                                style={{ marginLeft: `${8 + index * 9}%`, width: `${22 + ((index * 13) % 20)}%` }}
                                aria-hidden="true"
                            />
                        ))}
                    </div>
                ) : props.tasks.length === 0 ? (
                    <div className="mxgantt-empty mxgantt-empty-state" role="status">
                        <svg viewBox="0 0 120 70" aria-hidden="true" focusable="false">
                            <rect className="mxgantt-empty-row" x="4" y="8" width="112" height="12" rx="3" />
                            <rect className="mxgantt-empty-row" x="4" y="29" width="112" height="12" rx="3" />
                            <rect className="mxgantt-empty-row" x="4" y="50" width="112" height="12" rx="3" />
                            <rect className="mxgantt-empty-bar" x="12" y="10" width="34" height="8" rx="3" />
                            <rect
                                className="mxgantt-empty-bar is-floating"
                                x="50"
                                y="31"
                                width="40"
                                height="8"
                                rx="3"
                            />
                            <path className="mxgantt-empty-link" d="M46 14h2v21h2" />
                        </svg>
                        <span className="mxgantt-empty-title">{texts.emptyTitle}</span>
                        {props.onAdd && (
                            <>
                                <span className="mxgantt-empty-hint">{texts.emptyHint}</span>
                                <button type="button" className="mxgantt-button mxgantt-empty-add" onClick={addTask}>
                                    {texts.addTask}
                                </button>
                            </>
                        )}
                    </div>
                ) : (
                    emptyText && <div className="mxgantt-empty">{emptyText}</div>
                )}
            </div>
            {(look.barLegend ||
                props.highlightBehind ||
                props.showStatusLine ||
                !!scenario ||
                !!floats ||
                (props.progressLine && props.hasProgress) ||
                props.hasDeadline ||
                overallocated.size > 0 ||
                (constraintInfo?.size ?? 0) > 0 ||
                !!compareWith ||
                allLinks.some(link => link.cross)) && (
                <ul className="mxgantt-legend" aria-label={texts.legend}>
                    {look.barLegend && props.hasProgress && (
                        <>
                            <li>
                                <span className="mxgantt-legend-bar is-done" style={legendColor} aria-hidden="true" />
                                {texts.legendProgress}
                            </li>
                            <li>
                                <span
                                    className="mxgantt-legend-bar is-remaining"
                                    style={legendColor}
                                    aria-hidden="true"
                                />
                                {texts.legendRemaining}
                            </li>
                        </>
                    )}
                    {look.barLegend && props.hasBaseline && (
                        <li>
                            <span
                                className={classNames("mxgantt-legend-baseline", {
                                    "is-outline": look.baselineOutline
                                })}
                                aria-hidden="true"
                            />
                            {texts.legendBaseline}
                        </li>
                    )}
                    {props.highlightBehind && (
                        <>
                            <li>
                                <span className="mxgantt-legend-swatch" aria-hidden="true" />
                                {texts.legendOnTrack}
                            </li>
                            <li>
                                <span className="mxgantt-legend-swatch is-behind" aria-hidden="true" />
                                {`${texts.legendBehind} (${behind.size})`}
                            </li>
                        </>
                    )}
                    {props.showStatusLine && (
                        <li>
                            <span className="mxgantt-legend-line" aria-hidden="true" />
                            {`${texts.legendStatus}: ${formatDate(statusDate)}`}
                        </li>
                    )}
                    {floats && (
                        <li>
                            <span className="mxgantt-legend-float" aria-hidden="true" />
                            {texts.legendFloat}
                        </li>
                    )}
                    {props.progressLine && props.hasProgress && (
                        <li>
                            <span className="mxgantt-legend-progress" aria-hidden="true" />
                            {texts.legendProgressLine}
                        </li>
                    )}
                    {props.hasDeadline && (
                        <li>
                            <span
                                className={classNames("mxgantt-legend-deadline", {
                                    "is-diamond": look.deadlineDiamond
                                })}
                                aria-hidden="true"
                            />
                            {texts.legendDeadline}
                        </li>
                    )}
                    {look.barLegend &&
                        look.states
                            .filter(state => state.caption)
                            .map(state => (
                                <li key={`state-${state.value}`}>
                                    <span
                                        className="mxgantt-legend-bar is-state"
                                        style={{ "--mxgantt-task-color": state.color } as CSSProperties}
                                        aria-hidden="true"
                                    />
                                    {state.caption}
                                </li>
                            ))}
                    {scenario && (
                        <li>
                            <span className="mxgantt-legend-swatch is-scenario" aria-hidden="true" />
                            {`${texts.legendScenario} (${scenarioIds.size})`}
                        </li>
                    )}
                    {overallocated.size > 0 && (
                        <li>
                            <span className="mxgantt-legend-swatch is-overallocated" aria-hidden="true" />
                            {`${texts.legendOverallocated} (${overallocated.size})`}
                        </li>
                    )}
                    {(constraintInfo?.size ?? 0) > 0 && (
                        <li>
                            <span className="mxgantt-legend-constraint" aria-hidden="true" />
                            {texts.legendConstraint}
                        </li>
                    )}
                    {[...(constraintInfo?.values() ?? [])].some(info => info.broken) && (
                        <li>
                            <span className="mxgantt-legend-constraint is-broken" aria-hidden="true" />
                            {texts.legendConstraintBroken}
                        </li>
                    )}
                    {compareWith && (
                        <li>
                            <span className="mxgantt-legend-baseline2" aria-hidden="true" />
                            {`${texts.legendBaseline2}: ${
                                compareWith === ATTRIBUTE_BASELINE ? texts.baselineAttributes : compareWith
                            }`}
                        </li>
                    )}
                    {allLinks.some(link => link.cross) && (
                        <li>
                            <span className="mxgantt-legend-cross" aria-hidden="true" />
                            {texts.legendCross}
                        </li>
                    )}
                </ul>
            )}
            {props.showResources && usage && usage.resources.length > 0 && (
                <Panel texts={texts} title={texts.resourcePanel} className="mxgantt-panel-resources">
                    <ResourcePanel
                        texts={texts}
                        usage={usage.resources}
                        scale={scale}
                        width={width}
                        scrollLeft={scroll.left}
                        viewportWidth={viewport.width}
                        labelWidth={props.showGrid ? gridWidth + 2 : 0}
                        formatDate={formatShortDate}
                        formatNumber={formatNumber}
                        focused={resourceFocus}
                        onFocus={focusResource}
                    />
                </Panel>
            )}
            {props.showEarnedValue && earned && (
                <Panel texts={texts} title={texts.evPanel} className="mxgantt-panel-ev">
                    <EarnedValuePanel
                        texts={texts}
                        value={earned}
                        curve={curve}
                        statusDate={statusDate}
                        formatMoney={formatMoney}
                        formatDate={formatDate}
                        animate={motion}
                    />
                </Panel>
            )}
            {props.showWorkload && props.hasAssignee && loads.length > 0 && (
                <WorkloadPanel
                    texts={texts}
                    loads={loads}
                    scale={scale}
                    width={width}
                    scrollLeft={scroll.left}
                    viewportWidth={viewport.width}
                    labelWidth={props.showGrid ? gridWidth + 2 : 0}
                    capacity={Math.max(1, props.workloadCapacity)}
                    formatDate={formatShortDate}
                />
            )}
            {props.paging?.hasMore && (
                <div className="mxgantt-footer">
                    <span>
                        {fill(texts.showing, {
                            n: props.paging.shown,
                            total: props.paging.total ?? `${props.paging.shown}+`
                        })}
                    </span>
                    <button
                        type="button"
                        className="mxgantt-button mxgantt-load-more"
                        onClick={props.paging.onLoadMore}
                    >
                        {texts.loadMore}
                    </button>
                </div>
            )}
            {menu && (
                <Menu
                    label={texts.menu}
                    items={menuItems(menu.id)}
                    onSelect={key => runMenu(menu.id, key)}
                    style={{ left: menu.x, top: menu.y }}
                    onClose={closeMenu}
                />
            )}
            {dialog?.kind === "help" && (
                <Dialog
                    title={texts.helpTitle}
                    buttons={[{ key: "close", label: texts.close, primary: true, onClick: () => setDialog(undefined) }]}
                    onClose={() => setDialog(undefined)}
                >
                    <table className="mxgantt-help-table">
                        <tbody>
                            {helpRows.map(([keys, text]) => (
                                <tr key={keys}>
                                    <th scope="row">
                                        <kbd>{keys}</kbd>
                                    </th>
                                    <td>{text}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </Dialog>
            )}
            {dialog?.kind === "delete" && dialogTask && (
                <Dialog
                    role="alertdialog"
                    title={fill(texts.confirmDelete, { name: dialogTask.name })}
                    focusKey="cancel"
                    buttons={[
                        {
                            key: "cancel",
                            label: texts.cancel,
                            onClick: () => {
                                setDialog(undefined);
                                focusRow(dialogTask.id);
                            }
                        },
                        {
                            key: "delete",
                            label: texts.confirm,
                            danger: true,
                            onClick: () => confirmDelete(dialogTask.id)
                        }
                    ]}
                    onClose={() => {
                        setDialog(undefined);
                        focusRow(dialogTask.id);
                    }}
                />
            )}
            {dialog?.kind === "deleteField" &&
                (() => {
                    const field = fieldList.find(entry => entry.key === dialog.key);
                    return field ? (
                        <Dialog
                            role="alertdialog"
                            title={fill(texts.deleteFieldTitle, { name: field.name })}
                            focusKey="cancel"
                            buttons={[
                                { key: "cancel", label: texts.cancel, onClick: () => setDialog(undefined) },
                                {
                                    key: "delete",
                                    label: texts.deleteField,
                                    danger: true,
                                    onClick: () => deleteField(field.key)
                                }
                            ]}
                            onClose={() => setDialog(undefined)}
                        >
                            <p className="mxgantt-dialog-text">{texts.deleteFieldBody}</p>
                        </Dialog>
                    ) : null;
                })()}
            {fieldForm && (
                <FieldForm
                    key={fieldForm.key ?? "new"}
                    texts={texts}
                    locale={props.locale}
                    field={editingField}
                    fields={fieldList}
                    takenNames={allColumns.filter(column => !column.field).map(column => column.title)}
                    anchor={fieldForm.anchor}
                    conversion={
                        editingField
                            ? to => {
                                  const result = convertField(editingField, to, valueEntries(editingField.key));
                                  return { converted: result.converted, cleared: result.cleared };
                              }
                            : undefined
                    }
                    sampleInputs={
                        sampleTask
                            ? formulaInputs(fieldList, sampleTask.fieldValues ?? {}, {
                                  _duration:
                                      sampleTask.start && sampleTask.end
                                          ? durationOf(sampleTask.start, sampleTask.end)
                                          : undefined,
                                  _progress: sampleTask.progress,
                                  _cost: earned?.costs.get(sampleTask.id) ?? sampleTask.fixedCost
                              })
                            : undefined
                    }
                    onSubmit={submitField}
                    onCancel={() => setFieldForm(undefined)}
                />
            )}
            {dialog?.kind === "deleteBaseline" && (
                <Dialog
                    role="alertdialog"
                    title={fill(texts.baselineConfirmDelete, { name: dialog.name })}
                    focusKey="cancel"
                    buttons={[
                        { key: "cancel", label: texts.cancel, onClick: () => setDialog(undefined) },
                        {
                            key: "delete",
                            label: texts.baselineDelete,
                            danger: true,
                            onClick: () => removeNamedBaseline(dialog.name)
                        }
                    ]}
                    onClose={() => setDialog(undefined)}
                />
            )}
            {dialog?.kind === "import" && (
                <Dialog
                    title={texts.importTitle}
                    focusKey="import"
                    buttons={[
                        { key: "cancel", label: texts.cancel, onClick: () => setDialog(undefined) },
                        {
                            key: "import",
                            label: texts.importConfirm,
                            primary: true,
                            onClick: () => confirmImport(dialog.plan)
                        }
                    ]}
                    onClose={() => setDialog(undefined)}
                >
                    <p className="mxgantt-import-summary">
                        {fill(texts.importSummary, {
                            name: dialog.plan.name || "–",
                            tasks: dialog.plan.stats.tasks,
                            links: dialog.plan.stats.links,
                            resources: dialog.plan.stats.resources,
                            assignments: dialog.plan.stats.assignments,
                            baselines: dialog.plan.stats.baselines,
                            constraints: dialog.plan.stats.constraints
                        })}
                    </p>
                    <p>
                        {fill(texts.importCalendar, {
                            days: dialog.plan.calendar.workingDays || "–",
                            holidays: dialog.plan.calendar.holidays
                                ? dialog.plan.calendar.holidays.split(",").length
                                : 0
                        })}
                    </p>
                    {dialog.plan.stats.skippedLinks > 0 && (
                        <p>{fill(texts.importSkipped, { n: dialog.plan.stats.skippedLinks })}</p>
                    )}
                </Dialog>
            )}
            {dialog?.kind === "discard" && (
                <Dialog
                    role="alertdialog"
                    title={texts.scenarioConfirmDiscard}
                    focusKey="cancel"
                    buttons={[
                        { key: "cancel", label: texts.cancel, onClick: () => setDialog(undefined) },
                        { key: "discard", label: texts.scenarioDiscard, danger: true, onClick: discardScenario }
                    ]}
                    onClose={() => setDialog(undefined)}
                />
            )}
            <span id={helpId} className="mxgantt-sr">
                {texts.keyboardHelp}
                {enterprise ? ` ${texts.shortcuts}: ?` : ""}
            </span>
            <div className="mxgantt-sr" role="status" aria-live="polite" aria-atomic="true">
                <span key={announcement.key}>{announcement.text}</span>
            </div>
        </div>
    );
}

/** Whether a row has anything to draw, without needing the scale. */
function hasBox(row: Row): boolean {
    return row.kind === "group" ? !!row.start && !!row.end : !!row.task.start && !!row.task.end;
}
