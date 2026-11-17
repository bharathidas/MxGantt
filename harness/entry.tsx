// Browser harness: renders the real MxGantt container with mocked Mendix props and a fake mx.data
// client that writes into an in-memory store and pushes the change back like a data source does.
// ?v23=1 adds the 2.3 attributes (assignments, segments, constraints, baselines, projects, costs),
// ?n=5000 a generated plan of that size, ?fail=1 commits that fail, ?slow=1 commits that take 2 s.
import Big from "big.js";
import { createRoot, Root } from "react-dom/client";
import { MxGantt } from "../src/MxGantt";

type AnyProps = Record<string, any>;
interface Row {
    id: string;
    Name: string;
    Start: Date;
    End: Date;
    Progress: number;
    Phase: string;
    Key: string;
    DependsOn: string;
    BaselineStart?: Date;
    BaselineEnd?: Date;
    Deadline?: Date;
    Assignee: string;
    // 2.3
    Assignments?: string;
    Segments?: string;
    ConstraintType?: string;
    ConstraintDate?: Date;
    Priority?: number;
    Baselines?: string;
    Project?: string;
    FixedCost?: number;
    // 1.1
    FieldValues?: string;
    // 1.2 configured columns
    Budget?: number;
    Spent?: number;
    Status?: string;
    Approved?: boolean;
    Notes?: string;
    // 1.3 portfolio timeline
    Code?: string;
    Manager?: string;
    Grade?: string;
    Health?: string;
}

const params = new URLSearchParams(location.search);
const v23 = params.get("v23") === "1";
// 1.1 custom fields: ?fields=1 (a launch plan with four fields), ?fields=empty (no fields yet, shows the hint),
// ?manage=0 (users may only fill in values).
const fieldsMode = params.get("fields");
// 1.2 configured columns: ?layout=1 (Owner, Status, Budget with group totals, Approved, a hidden Notes column).
const layoutMode = params.get("layout") === "1";
if (params.get("rtl") === "1") {
    document.documentElement.dir = "rtl";
}
const events: Array<{ name: string; args?: unknown; id?: string }> = [];
const base = new Date();
base.setHours(0, 0, 0, 0);
const d = (offset: number): Date => new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);

function baselineJson(entries: Array<[string, number, number, number?]>): string {
    return JSON.stringify(
        entries.map(([name, from, to, cost], index) => ({
            name,
            start: d(from).toISOString(),
            finish: d(to).toISOString(),
            ...(cost !== undefined ? { cost } : {}),
            saved: d(-30 + index).toISOString()
        }))
    );
}

function generated(count: number): Row[] {
    const rows: Row[] = [];
    for (let i = 0; i < count; i++) {
        const start = Math.floor(i / 7) + (i % 5) - 20;
        const length = 1 + (i % 6);
        rows.push({
            id: String(i + 1),
            Name: `Task ${i + 1}`,
            Start: d(start),
            End: d(start + length),
            Progress: (i * 7) % 101,
            Phase: `Phase ${Math.floor(i / 100)}`,
            Key: String(i + 1),
            DependsOn: i > 0 && i % 3 === 0 ? String(i - 2) : "",
            BaselineStart: d(start),
            BaselineEnd: d(start + length),
            Assignee: `R${i % 40}`,
            Assignments: `R${Math.floor(i / 2) % 40}:${50 + (i % 3) * 25}`,
            Project: v23 ? `Project ${Math.floor(i / 1000) + 1}` : undefined,
            FixedCost: i % 10 === 0 ? 1000 : undefined
        });
    }
    return rows;
}

const SAMPLE: Row[] = [
    {
        id: "1",
        Name: "Requirements",
        Start: d(-10),
        End: d(-5),
        Progress: 100,
        Phase: "Plan",
        Key: "1",
        DependsOn: "",
        BaselineStart: d(-10),
        BaselineEnd: d(-6),
        Deadline: d(-4),
        Assignee: "Ann"
    },
    {
        id: "2",
        Name: "Design",
        Start: d(-5),
        End: d(1),
        Progress: 60,
        Phase: "Plan",
        Key: "2",
        DependsOn: "1",
        BaselineStart: d(-6),
        BaselineEnd: d(-1),
        Deadline: d(0),
        Assignee: "Bob"
    },
    {
        id: "3",
        Name: "Build API",
        Start: d(1),
        End: d(9),
        Progress: 0,
        Phase: "Build",
        Key: "3",
        DependsOn: "2",
        BaselineStart: d(-1),
        BaselineEnd: d(6),
        Assignee: "Cy"
    },
    {
        id: "4",
        Name: "Build UI",
        Start: d(1),
        End: d(5),
        Progress: 10,
        Phase: "Build",
        Key: "4",
        DependsOn: "2",
        BaselineStart: d(-1),
        BaselineEnd: d(4),
        Assignee: "Ann"
    },
    {
        id: "5",
        Name: "Test",
        Start: d(9),
        End: d(13),
        Progress: 0,
        Phase: "Release",
        Key: "5",
        DependsOn: "3, 4",
        BaselineStart: d(6),
        BaselineEnd: d(10),
        Deadline: d(12),
        Assignee: "Dee"
    },
    {
        id: "6",
        Name: "Go-live",
        Start: d(13),
        End: d(13),
        Progress: 0,
        Phase: "Release",
        Key: "6",
        DependsOn: "5",
        BaselineStart: d(10),
        BaselineEnd: d(10),
        Assignee: "Ann"
    }
];

/** The 2.3 sample: two projects, over-allocated Ann, a split task, constraints, baselines and costs. */
function sample23(): Row[] {
    const rows = SAMPLE.map(row => ({ ...row }));
    const extra: Record<string, Partial<Row>> = {
        "1": {
            Assignments: "Ann",
            Project: "Website",
            FixedCost: 500,
            Baselines: baselineJson([
                ["Approved", -10, -6, 2000],
                ["Re-plan", -10, -5, 2400]
            ])
        },
        "2": {
            Assignments: "Bob:50, Ann:50",
            Project: "Website",
            Baselines: baselineJson([
                ["Approved", -6, -1, 2000],
                ["Re-plan", -5, 0, 2200]
            ])
        },
        "3": {
            Assignments: "Cy",
            Project: "Website",
            Segments: "0-3, 5-8",
            ConstraintType: "SNET",
            ConstraintDate: d(2),
            Baselines: baselineJson([
                ["Approved", -1, 6],
                ["Re-plan", 0, 8]
            ])
        },
        "4": {
            Assignments: "Ann, Cy:50",
            Project: "Website",
            Priority: 800,
            Baselines: baselineJson([["Approved", -1, 4]])
        },
        "5": {
            Assignments: "Ann",
            Project: "Mobile",
            ConstraintType: "Finish no later than",
            ConstraintDate: d(12),
            FixedCost: 1500
        },
        "6": { Assignments: "", Project: "Mobile", ConstraintType: "ASAP" }
    };
    rows.forEach(row => Object.assign(row, extra[row.id] ?? {}));
    return rows;
}

const LAUNCH_FIELDS = JSON.stringify([
    { key: "budget", name: "Budget", type: "number", format: "currency", currency: "EUR", decimals: 0 },
    {
        key: "risk",
        name: "Risk",
        type: "select",
        options: [
            { id: "low", label: "Low", color: "#15803d" },
            { id: "medium", label: "Medium", color: "#ca8504" },
            { id: "high", label: "High", color: "#d92d20" }
        ],
        onBar: true
    },
    { key: "approved", name: "Approved", type: "checkbox" },
    { key: "vendor", name: "Vendor", type: "text" }
]);
const LAUNCH_VALUES: Record<string, string> = {
    "1": '{"budget":4000,"risk":"low","approved":true,"vendor":"In-house"}',
    "2": '{"budget":12500,"risk":"medium","approved":true,"vendor":"Northwind Design"}',
    "3": '{"budget":38000,"risk":"high","vendor":"Contoso Cloud"}',
    "4": '{"budget":21000,"risk":"medium","vendor":"Northwind Design"}',
    "5": '{"budget":9000,"risk":"high"}',
    "6": '{"budget":2500,"risk":"low"}'
};
let fieldDefs = fieldsMode === "1" ? LAUNCH_FIELDS : "";

// 1.3 portfolio timeline: ?portfolio=1 - three companies, 24 projects over several years.
const portfolioMode = params.get("portfolio") === "1";
const ym = (value: number): Date => {
    const year = Math.floor(value);
    return new Date(year, Math.round((value - year) * 12), 1);
};
// [company, name, manager, grade, start, forecast end, progress, baseline end, business need, health]
const PORTFOLIO: Array<[string, string, string, string, number, number, number, number, number, string]> = [
    ["Grid technologies", "Riverside", "Lukas Becker", "PM400", 2023.75, 2027.33, 45, 2026.92, 2026.83, "Short"],
    ["Grid technologies", "Northport", "Sophie Wagner", "PM400", 2024.08, 2027.17, 52, 2027.17, 2027.33, "OnTrack"],
    ["Grid technologies", "Aurora", "Lena Hoffmann", "PM400", 2024.33, 2027.42, 45, 2027.42, 2027.5, "OnTrack"],
    ["Grid technologies", "Lakeview Ph. 2", "Hannah Koch", "PM400", 2024.08, 2027.17, 38, 2027.17, 2027.25, "OnTrack"],
    ["Grid technologies", "Heron", "Leon Klein", "PM400", 2023.92, 2027.0, 61, 2027.0, 2027.08, "OnTrack"],
    ["Grid technologies", "Horizon", "Elias Schröder", "PM200", 2024.67, 2027.92, 15, 2027.75, 2027.83, "AtRisk"],
    ["Grid technologies", "Amber Point", "Finn Hartmann", "PM200", 2024.92, 2028.25, 22, 2028.25, 2028.33, "OnTrack"],
    ["Grid technologies", "Falcon Ridge", "Luca Schmitt", "PM400", 2024.0, 2027.5, 48, 2027.33, 2027.42, "AtRisk"],
    ["Grid technologies", "Millbrook", "Tim Krause", "PM400", 2024.25, 2027.58, 57, 2027.58, 2027.67, "OnTrack"],
    ["Transformation of industry", "Atlas Campus (US)", "Jan Lehmann", "PM400", 2024.0, 2027.5, 40, 2027.33, 2027.42, "AtRisk"],
    ["Transformation of industry", "Stonebridge", "Katharina Maier", "PM400", 2023.67, 2027.0, 64, 2027.0, 2027.08, "OnTrack"],
    ["Transformation of industry", "North Star", "Charlotte Herrmann", "PM200", 2024.58, 2027.92, 29, 2027.92, 2028.0, "OnTrack"],
    ["Transformation of industry", "Willow Park", "Amelie Walter", "PM600", 2023.58, 2026.92, 80, 2026.92, 2027.0, "OnTrack"],
    ["Transformation of industry", "Sunhill", "Lina Huber", "PM070", 2025.17, 2028.58, 12, 2028.58, 2028.67, "OnTrack"],
    ["Transformation of industry", "Birchfield", "Greta Fuchs", "PM400", 2023.75, 2027.0, 66, 2027.0, 2027.08, "OnTrack"],
    ["Transformation of industry", "Larkfield", "Ella Lang", "PM400", 2024.33, 2027.58, 41, 2027.58, 2027.67, "OnTrack"],
    ["Gas services", "Bayside Ph. 2", "Frieda Möller", "PM040", 2026.42, 2029.75, 5, 2029.75, 2029.83, "OnTrack"],
    ["Gas services", "Bayside Ph. 1", "Frieda Möller", "PM650", 2023.67, 2026.75, 92, 2026.75, 2026.83, "OnTrack"],
    ["Gas services", "Maple Grove", "Florian Hahn", "PM400", 2024.67, 2027.83, 35, 2027.83, 2027.92, "OnTrack"],
    ["Gas services", "Pebble Creek", "Sebastian Vogel", "PM200", 2024.92, 2028.08, 27, 2028.08, 2028.17, "OnTrack"],
    ["Gas services", "Moorland", "Matthias Keller", "PM600", 2023.75, 2026.83, 88, 2026.83, 2026.92, "OnTrack"],
    ["Gas services", "Harbour City", "Andreas Frank", "PM200", 2024.58, 2028.42, 19, 2028.42, 2028.5, "OnTrack"]
];
function portfolioRows(): Row[] {
    const counters: Record<string, number> = {};
    const companies = [...new Set(PORTFOLIO.map(entry => entry[0]))];
    return PORTFOLIO.map(([company, name, manager, grade, start, end, progress, baseEnd, need, health], index) => {
        counters[company] = (counters[company] ?? 0) + 1;
        const code = `${String(companies.indexOf(company) + 1).padStart(2, "0")}.${String(counters[company]).padStart(
            2,
            "0"
        )}`;
        return {
            id: `p${index + 1}`,
            Name: name,
            Start: ym(start),
            End: ym(end),
            Progress: progress,
            Phase: company,
            Key: code,
            DependsOn: "",
            BaselineStart: ym(start),
            BaselineEnd: ym(baseEnd),
            Deadline: ym(need),
            Assignee: manager,
            Code: code,
            Manager: manager,
            Grade: grade,
            Health: health
        };
    });
}

let store: Row[] =
    params.get("empty") === "1"
        ? []
        : portfolioMode
        ? portfolioRows()
        : params.has("n")
        ? generated(Number(params.get("n")))
        : v23
        ? sample23()
        : SAMPLE;

if (fieldsMode) {
    store.forEach(row => {
        row.FieldValues = fieldsMode === "1" ? LAUNCH_VALUES[row.id] ?? "" : "";
    });
}

// 1.2: budgets in euros, a status enumeration and an approval flag per task; Build API is over budget.
const LAYOUT_VALUES: Record<string, Partial<Row>> = {
    "1": {
        Budget: 4000,
        Spent: 3800,
        Status: "done",
        Approved: true,
        Notes: "Signed off by the steering group on Monday"
    },
    "2": {
        Budget: 12500,
        Spent: 9100,
        Status: "in_progress",
        Approved: true,
        Notes: "Waiting for the brand guide from marketing"
    },
    "3": {
        Budget: 38000,
        Spent: 41250,
        Status: "at_risk",
        Approved: false,
        Notes: "Vendor quote came in above budget; change request raised"
    },
    "4": { Budget: 21000, Spent: 2100, Status: "in_progress", Approved: true },
    "5": { Budget: 9000, Status: "not_started", Approved: false },
    "6": { Status: "not_started", Approved: false, Notes: "Go / no-go call the day before" }
};
if (layoutMode) {
    store.forEach(row => Object.assign(row, LAYOUT_VALUES[row.id] ?? {}));
    const style = document.createElement("style");
    style.textContent =
        ".harness-over { color: #b42318; font-weight: 600; } .mxgantt--dark .harness-over { color: #ff8a80; }";
    document.head.appendChild(style);
}
if (portfolioMode) {
    // What an app theme would set for this page: a purple today line.
    const style = document.createElement("style");
    style.textContent = ".harness-gantt.mxgantt { --mxgantt-today: #8e24d8; }";
    document.head.appendChild(style);
}
const STATUS_CAPTIONS: Record<string, string> = {
    not_started: "Not started",
    in_progress: "In progress",
    at_risk: "At risk",
    done: "Done"
};

const resourceRows = [
    { id: "r1", Name: "Ann", MaxUnits: 100, Rate: 60 },
    { id: "r2", Name: "Bob", MaxUnits: 100, Rate: 80 },
    { id: "r3", Name: "Cy", MaxUnits: 100, Rate: 70 },
    { id: "r4", Name: "Dee", MaxUnits: 200, Rate: 50 }
];

// ---------------------------------------------------------------- fake Mendix client (mx.data)

const TYPES: Record<string, string> = {
    Name: "String",
    Start: "DateTime",
    End: "DateTime",
    Progress: "Integer",
    Phase: "String",
    Key: "String",
    DependsOn: "String",
    BaselineStart: "DateTime",
    BaselineEnd: "DateTime",
    Deadline: "DateTime",
    Assignee: "String",
    ...(fieldsMode ? { FieldValues: "String" } : {}),
    ...(layoutMode
        ? { Budget: "Decimal", Spent: "Decimal", Status: "Enum", Approved: "Boolean", Notes: "String" }
        : {}),
    ...(portfolioMode ? { Code: "String", Manager: "String", Grade: "String", Health: "Enum" } : {}),
    ...(v23 || params.has("n")
        ? {
              Assignments: "String",
              Segments: "String",
              ConstraintType: "String",
              ConstraintDate: "DateTime",
              Priority: "Integer",
              Baselines: "String",
              Project: "String",
              FixedCost: "Decimal"
          }
        : {})
};
function clientObject(row: Row): any {
    return {
        getGuid: () => row.id,
        get: (name: string) => {
            const value = (row as any)[name];
            return value instanceof Date ? value.getTime() : value;
        },
        set: (name: string, value: unknown) => {
            (row as any)[name] =
                TYPES[name] === "DateTime"
                    ? new Date(Number(value))
                    : TYPES[name] === "Integer" || TYPES[name] === "Decimal"
                    ? value === ""
                        ? undefined
                        : Number(value)
                    : TYPES[name] === "Enum" && value === ""
                    ? undefined
                    : value;
        },
        getAttributes: () => Object.keys(TYPES),
        getAttributeType: (name: string) => TYPES[name]
    };
}
let failCommits = params.get("fail") === "1";
const commitDelay = params.get("slow") === "1" ? 2000 : 30;
(window as any).mx = {
    data: {
        get: ({ guids, callback }: any) => {
            const found = store.filter(row => guids.includes(row.id)).map(clientObject);
            setTimeout(() => callback(found), 20);
        },
        commit: ({ callback, error }: any) => {
            setTimeout(() => {
                if (failCommits) {
                    events.push({ name: "commitFailed" });
                    error(new Error("The server is not reachable"));
                    // The rolled-back values come back from the data source.
                    setTimeout(render, 50);
                    return;
                }
                callback();
                events.push({ name: "commit" });
                setTimeout(render, 150);
            }, commitDelay);
        }
    },
    ui: { error: (text: string) => events.push({ name: "error", args: text }) }
};

// ---------------------------------------------------------------- mocked props

const dv = <T,>(value: T): any => ({ status: "available", value });
const rowOf = (entry: { id: string }): Row => store.find(row => row.id === entry.id) as Row;
function listAttr(name: keyof Row, extra: AnyProps = {}): any {
    return {
        id: `attr_${String(name)}`,
        type: TYPES[name as string],
        sortable: true,
        get: (entry: any) => {
            const value = rowOf(entry)?.[name];
            const out =
                (name === "Progress" ||
                    name === "Priority" ||
                    name === "FixedCost" ||
                    name === "Budget" ||
                    name === "Spent") &&
                value !== undefined
                    ? new Big(value as number)
                    : value;
            const displayValue = extra.formatter
                ? extra.formatter.format(value)
                : value instanceof Date
                ? value.toDateString()
                : String(value ?? "");
            return { status: "available", value: out, displayValue, readOnly: false };
        },
        ...extra
    };
}
function resourceAttr(name: "Name" | "MaxUnits" | "Rate"): any {
    return {
        id: `res_${name}`,
        get: (entry: any) => {
            const value = resourceRows.find(row => row.id === entry.id)?.[name];
            const out = name === "Name" ? value : new Big(value as number);
            return { status: "available", value: out, displayValue: String(value ?? ""), readOnly: true };
        }
    };
}
const expr = (fn: (row: Row) => unknown): any => ({ get: (entry: any) => dv(fn(rowOf(entry))) });
const itemAction = (name: string): any => ({
    get: (entry: any) => ({ canExecute: true, isExecuting: false, execute: () => events.push({ name, id: entry.id }) })
});
const action = (name: string): any => ({
    canExecute: true,
    isExecuting: false,
    execute: (vars?: unknown) => events.push({ name, args: vars })
});
const editable = (name: string): any => ({
    status: "available",
    readOnly: false,
    value: undefined,
    setValue: (value: unknown) => events.push({ name, args: value })
});

function baseProps(): AnyProps {
    const on = (key: string, fallback = true): boolean => (params.has(key) ? params.get(key) === "1" : fallback);
    const big = params.has("n");
    const props: AnyProps = {
        name: "gantt1",
        class: "harness-gantt",
        tabIndex: 0,
        tasks: {
            status: params.get("loading") === "1" ? "loading" : "available",
            items: params.get("loading") === "1" ? [] : store.map(row => ({ id: row.id })),
            limit: Infinity,
            setLimit: () => undefined,
            requestTotalCount: () => undefined,
            hasMoreItems: false,
            totalCount: store.length
        },
        taskName: expr(row => row.Name),
        startAttr: listAttr("Start"),
        endAttr: listAttr("End"),
        progressAttr: listAttr("Progress"),
        pageSize: 0,
        groupAttr: listAttr("Phase"),
        keyAttr: listAttr("Key"),
        dependenciesAttr: listAttr("DependsOn"),
        baselineStartAttr: listAttr("BaselineStart"),
        baselineEndAttr: listAttr("BaselineEnd"),
        assigneeAttr: listAttr("Assignee"),
        deadlineAttr: on("deadline") ? listAttr("Deadline") : undefined,
        workingDays: params.get("days") ?? "",
        snapWorkingDays: false,
        autoSchedule: "off",
        editable: expr(() => true),
        snap: "day",
        saveMode: "commit",
        allowUndo: true,
        inlineEdit: v23,
        linkEditing: false,
        dependencyAttrName: "DependsOn",
        scenarioMode: false,
        onTaskChange: itemAction("onTaskChange"),
        onTaskClick: itemAction("onTaskClick"),
        onAdd: action("onAdd"),
        addStartAttr: editable("addStart"),
        addEndAttr: editable("addEnd"),
        zoom: params.get("zoom") ?? "week",
        showToday: true,
        showWeekends: true,
        showDependencies: true,
        criticalPath: "off",
        showStatusLine: !big,
        highlightBehind: !big,
        animate: params.get("animate") !== "0",
        motion: params.get("motion") ?? "full",
        showSlack: on("slack", !big),
        progressLine: on("pline", !big),
        markers: on("markers", !big)
            ? [
                  { markerDate: dv(d(11)), markerLabel: dv("Code freeze"), markerColor: "#c4320a" },
                  { markerDate: dv(d(14)), markerLabel: dv("Launch"), markerColor: "" }
              ]
            : [],
        zoomToFit: on("fit"),
        showHealth: on("health", !big),
        showToolbar: true,
        showGrid: true,
        gridWidth: 380,
        rowHeight: 36,
        height: 420,
        theme: params.get("theme") ?? "light",
        columns: [],
        gridColumns: [],
        nameSortable: false,
        barStates: [],
        look: "standard",
        barLabel: "name",
        barLabelDateFormat: "MM.yyyy",
        baselineStyle: "bar",
        deadlineStyle: "flag",
        todayStyle: "line",
        barLegend: false,
        showWbs: false,
        showVariance: false,
        columnChooser: v23,
        columnResize: false,
        rememberState: false,
        showWorkload: false,
        workloadCapacity: 1,
        colorBy: "task",
        showFilter: false,
        allowExport: false,
        exportCsv: false,
        exportExcel: false,
        exportProject: v23,
        printDetails: false,
        hoursPerDay: 8,
        currency: "",
        baselineEditing: true,
        scheduleButton: false,
        showResources: false,
        resourceLeveling: false,
        showEarnedValue: false,
        costColumns: false,
        showPortfolio: false,
        defaultBaseline: ""
    };
    if (fieldsMode) {
        Object.assign(props, {
            allowCustomFields: true,
            fieldsAttr: {
                status: "available",
                readOnly: false,
                value: fieldDefs,
                setValue: (value: string) => {
                    fieldDefs = value;
                    events.push({ name: "fieldsSet", args: value });
                    setTimeout(render, 40);
                }
            },
            taskValuesAttr: listAttr("FieldValues"),
            taskValuesAttrName: "",
            fieldsEditable: dv(params.get("manage") !== "0"),
            maxFields: 30,
            fieldsHint: true,
            onFieldsChange: action("onFieldsChange"),
            columnChooser: true,
            columnResize: true,
            showFilter: true,
            exportCsv: true,
            exportExcel: true,
            rememberState: params.get("remember") === "1",
            gridWidth: Number(params.get("grid") ?? 640)
        });
    }
    if (layoutMode) {
        const gc = (extra: AnyProps): AnyProps => ({
            gcType: "attribute",
            gcCostMeasure: "cost",
            gcFormat: "auto",
            gcDecimals: 0,
            gcTotal: "none",
            gcWidth: 0,
            gcMinWidth: 40,
            gcFill: false,
            gcAlign: "auto",
            gcWrap: false,
            gcVisible: true,
            gcHideable: true,
            gcSortable: false,
            gcEditable: false,
            gcAttributeName: "",
            ...extra
        });
        const status = listAttr("Status", {
            universe: Object.keys(STATUS_CAPTIONS),
            formatter: { format: (value: unknown) => (value ? STATUS_CAPTIONS[String(value)] ?? String(value) : "") }
        });
        const approved = listAttr("Approved", {
            universe: [true, false],
            formatter: { format: (value: unknown) => (value === true ? "Yes" : value === false ? "No" : "") }
        });
        Object.assign(props, {
            gridColumns: [
                gc({ gcType: "wbs" }),
                gc({ gcType: "start", gcSortable: true }),
                gc({ gcType: "duration" }),
                gc({ gcType: "progress", gcSortable: true }),
                gc({ gcType: "assignee", gcCaption: dv("Owner"), gcSortable: true, gcWidth: 80 }),
                gc({
                    gcAttribute: status,
                    gcCaption: dv("Status"),
                    gcTooltip: dv("Where the task stands this week"),
                    gcEditable: true,
                    gcSortable: true,
                    gcHideable: false,
                    gcWidth: 104,
                    gcClass: expr(row => (row.Status === "at_risk" ? "harness-over" : ""))
                }),
                gc({
                    gcAttribute: listAttr("Budget"),
                    gcCaption: dv("Budget"),
                    gcTooltip: dv("Approved budget; red when the spend is higher"),
                    gcFormat: "currency",
                    gcTotal: "sum",
                    gcEditable: true,
                    gcSortable: true,
                    gcWidth: 96,
                    gcClass: expr(row => ((row.Spent ?? 0) > (row.Budget ?? Infinity) ? "harness-over" : ""))
                }),
                gc({
                    gcAttribute: approved,
                    gcCaption: dv("Approved"),
                    gcEditable: true,
                    gcAlign: "center",
                    gcWidth: 84
                }),
                gc({
                    gcAttribute: listAttr("Notes"),
                    gcCaption: dv("Notes"),
                    gcWrap: true,
                    gcFill: true,
                    gcVisible: false,
                    gcMinWidth: 140
                })
            ],
            nameSortable: true,
            columnChooser: true,
            columnResize: true,
            currency: "EUR",
            rememberState: params.get("remember") === "1",
            gridWidth: Number(params.get("grid") ?? 900)
        });
    }
    if (portfolioMode) {
        Object.assign(props, {
            taskCode: expr(row => row.Code ?? ""),
            taskSubtitle: expr(row => `${row.Manager} · ${row.Grade}`),
            dependenciesAttr: undefined,
            stateAttr: listAttr("Health", {
                formatter: {
                    format: (value: unknown) =>
                        ({ OnTrack: "On track", AtRisk: "At risk", Short: "Capacity short" } as any)[String(value)] ?? ""
                }
            }),
            barStates: [
                { bsValue: "OnTrack", bsColor: "#45206b", bsCaption: dv("") },
                { bsValue: "AtRisk", bsColor: "#c77700", bsCaption: dv("") },
                { bsValue: "Short", bsColor: "#e01e2b", bsCaption: dv("Bar red: capacity need will not be met") }
            ],
            // Only the name shows; Start, Forecast and Done are in the column chooser.
            gridColumns: ["start", "end", "progress"].map(gcType => ({
                gcType,
                gcCostMeasure: "cost",
                gcCaption: dv(gcType === "end" ? "Forecast" : ""),
                gcFormat: "auto",
                gcDecimals: 0,
                gcTotal: "none",
                gcWidth: 0,
                gcMinWidth: 40,
                gcFill: false,
                gcAlign: "auto",
                gcWrap: false,
                gcVisible: false,
                gcHideable: true,
                gcSortable: true,
                gcEditable: false,
                gcAttributeName: ""
            })),
            columnChooser: true,
            zoom: "year",
            look: "portfolio",
            barLabel: params.get("label") ?? "finishProgress",
            barLabelDateFormat: "MM.yyyy",
            baselineStyle: "outline",
            deadlineStyle: "diamond",
            todayStyle: "labelled",
            barLegend: true,
            txtLegendProgress: dv("Progress (actual %)"),
            txtLegendRemaining: dv("Remaining to forecast"),
            txtLegendBaseline: dv("I-App baseline"),
            txtLegendDeadline: dv("Business need"),
            showWeekends: false,
            showStatusLine: false,
            highlightBehind: false,
            showSlack: false,
            progressLine: false,
            markers: [],
            showHealth: false,
            editable: expr(() => false),
            rowHeight: 64,
            height: 760,
            gridWidth: 400
        });
    }
    if (v23 || big) {
        Object.assign(props, {
            assignmentsAttr: listAttr("Assignments"),
            segmentsAttr: listAttr("Segments"),
            constraintTypeAttr: listAttr("ConstraintType"),
            constraintDateAttr: listAttr("ConstraintDate"),
            priorityAttr: listAttr("Priority"),
            baselinesAttr: listAttr("Baselines"),
            projectText: v23 ? expr(row => row.Project ?? "") : undefined,
            fixedCostAttr: listAttr("FixedCost"),
            resources: { status: "available", items: resourceRows.map(row => ({ id: row.id })) },
            resourceNameAttr: resourceAttr("Name"),
            resourceMaxUnitsAttr: resourceAttr("MaxUnits"),
            resourceRateAttr: resourceAttr("Rate"),
            currency: "EUR",
            scheduleButton: true,
            showResources: true,
            resourceLeveling: true,
            showEarnedValue: true,
            costColumns: true,
            showPortfolio: v23,
            defaultBaseline: v23 ? "Approved" : "",
            onImport: action("onImport"),
            importJsonAttr: editable("importJson")
        });
    }
    return props;
}

const container = document.getElementById("root")!;
let root: Root | undefined = createRoot(container);
let overrides: AnyProps = {};
function render(): void {
    root?.render(<MxGantt {...({ ...baseProps(), ...overrides } as any)} />);
}

(window as any).harness = {
    events,
    store: () =>
        store.map(row => ({
            id: row.id,
            Start: row.Start.getTime(),
            End: row.End.getTime(),
            Segments: row.Segments,
            Assignments: row.Assignments,
            Baselines: row.Baselines,
            FieldValues: row.FieldValues,
            Budget: row.Budget,
            Status: row.Status,
            Approved: row.Approved
        })),
    fields: () => fieldDefs,
    set: (next: AnyProps) => {
        overrides = { ...overrides, ...next };
        render();
    },
    setFail: (fail: boolean) => {
        failCommits = fail;
    },
    /** Memory-leak check: take the widget down and put it back. */
    unmount: () => {
        root?.unmount();
        root = undefined;
    },
    mount: () => {
        root = createRoot(container);
        render();
    }
};

render();
