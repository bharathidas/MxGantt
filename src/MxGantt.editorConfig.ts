import { hideNestedPropertiesIn, hidePropertiesIn, Problem, Properties } from "@mendix/pluggable-widgets-tools";
import { GridColumnsPreviewType, MxGanttPreviewProps } from "../typings/MxGanttProps";
import { BUILT_IN_LABELS, COST_LABELS, previewColumns } from "./utils/previewColumns";

type Keys = Array<keyof MxGanttPreviewProps>;
type ColumnKeys = Array<keyof GridColumnsPreviewType>;

/** 1.2: the Columns list is used, so the classic column settings do nothing. */
function hasLayout(values: MxGanttPreviewProps): boolean {
    return (values.gridColumns || []).length > 0;
}

function layoutHasCost(values: MxGanttPreviewProps): boolean {
    return (values.gridColumns || []).some(column => column.gcType === "cost");
}

export function getProperties(values: MxGanttPreviewProps, defaultProperties: Properties): Properties {
    if (!values.keyAttr || !values.dependenciesAttr) {
        // Arrows, the critical path, auto-scheduling and link editing all need the two dependency attributes.
        hidePropertiesIn(defaultProperties, values, [
            "showDependencies",
            "criticalPath",
            "autoSchedule",
            "linkEditing",
            "dependencyAttrName"
        ] as Keys);
    }
    if (!values.workingDays && !values.holidays) {
        hidePropertiesIn(defaultProperties, values, ["snapWorkingDays"] as Keys);
    }
    if (!values.inlineEdit) {
        hidePropertiesIn(defaultProperties, values, ["nameAttr"] as Keys);
    }
    if (!values.onAdd) {
        hidePropertiesIn(defaultProperties, values, ["addStartAttr", "addEndAttr"] as Keys);
    }
    if (!values.baselineEndAttr) {
        hidePropertiesIn(defaultProperties, values, ["showVariance"] as Keys);
    }
    if (!values.assigneeAttr) {
        hidePropertiesIn(defaultProperties, values, [
            "showWorkload",
            "workloadCapacity",
            "colorBy",
            "myAssignee"
        ] as Keys);
    } else if (!values.showWorkload) {
        hidePropertiesIn(defaultProperties, values, ["workloadCapacity"] as Keys);
    }
    if (!values.showFilter) {
        hidePropertiesIn(defaultProperties, values, ["myAssignee"] as Keys);
    }
    if (!values.showGrid) {
        hidePropertiesIn(defaultProperties, values, ["gridWidth"] as Keys);
    }
    if (!values.allowExport && !values.exportCsv && !values.exportExcel && !values.exportProject) {
        hidePropertiesIn(defaultProperties, values, ["exportFileName"] as Keys);
    }
    if (!values.allowExport) {
        hidePropertiesIn(defaultProperties, values, ["printDetails", "exportTitle"] as Keys);
    } else if (!values.printDetails) {
        hidePropertiesIn(defaultProperties, values, ["exportTitle"] as Keys);
    }
    // Earned value and the cost columns measure progress at the status date as well (2.3.1).
    const costShown = hasLayout(values) ? layoutHasCost(values) : values.costColumns;
    if (!values.showStatusLine && !values.highlightBehind && !values.showEarnedValue && !costShown) {
        hidePropertiesIn(defaultProperties, values, ["statusDate"] as Keys);
    }
    if (!values.progressAttr && !values.highlightBehind) {
        // Behind schedule compares progress with the status date, so it means nothing without Progress.
        hidePropertiesIn(defaultProperties, values, ["highlightBehind"] as Keys);
    }
    // 2.3
    const hide = (keys: Keys): void => hidePropertiesIn(defaultProperties, values, keys);
    if (!values.assignmentsAttr) {
        hide(["assignmentsAttrName"]);
    }
    // 1.3
    if (!values.stateAttr) {
        hide(["barStates"]);
    }
    if (values.barLabel !== "custom") {
        hide(["barLabelText"]);
    }
    if (values.barLabel !== "finishProgress") {
        hide(["barLabelDateFormat"]);
    }
    if (!values.deadlineAttr) {
        hide(["deadlineStyle"]);
    }
    if (!values.baselineStartAttr || !values.baselineEndAttr) {
        hide(["baselineStyle"]);
    }
    if (!values.showToday) {
        hide(["todayStyle"]);
    }
    if (!values.segmentsAttr) {
        hide(["segmentsAttrName"]);
    }
    if (!values.baselinesAttr) {
        hide(["baselinesAttrName", "baselineEditing", "defaultBaseline"]);
    }
    if (!values.constraintTypeAttr) {
        hide(["constraintDateAttr"]);
    }
    if (!values.resources) {
        hide(["resourceNameAttr", "resourceMaxUnitsAttr", "resourceRateAttr"]);
    }
    if (!values.onImport) {
        hide(["importJsonAttr"]);
    }
    if (!values.projectText) {
        hide(["showPortfolio"]);
    }
    if (!values.assigneeAttr && !values.assignmentsAttr) {
        hide(["showResources", "resourceLeveling"]);
    }
    if (!values.fixedCostAttr && !values.actualCostAttr && !values.resourceRateAttr) {
        hide(["showEarnedValue", "costColumns", "currency"]);
    }
    if (!values.keyAttr || !values.dependenciesAttr) {
        hide(["scheduleButton"]);
    }
    // 1.1 custom fields. Plain comparisons only: Studio Pro runs this file in Jint, where regular expressions break.
    if (!values.allowCustomFields) {
        hide([
            "fieldsAttr",
            "taskValuesAttr",
            "taskValuesAttrName",
            "fieldsEditable",
            "maxFields",
            "fieldsHint",
            "onFieldsChange",
            "onTaskValuesChange"
        ]);
    } else if (!values.taskValuesAttr) {
        hide(["taskValuesAttrName", "onTaskValuesChange"]);
    }
    // 1.2 configured columns: only the settings that apply to the kind of column.
    const chooser = values.columnChooser || values.allowCustomFields;
    (values.gridColumns || []).forEach((column, index) => {
        const hidden: ColumnKeys = [];
        const isAttribute = column.gcType === "attribute";
        if (column.gcType !== "cost") {
            hidden.push("gcCostMeasure");
        }
        if (!isAttribute) {
            hidden.push("gcAttribute", "gcFormat", "gcDecimals", "gcTotal", "gcEditable", "gcAttributeName");
        } else {
            if (column.gcFormat !== "number" && column.gcFormat !== "currency" && column.gcFormat !== "percent") {
                hidden.push("gcDecimals");
            }
            if (!column.gcEditable) {
                hidden.push("gcAttributeName");
            }
        }
        if (!chooser) {
            hidden.push("gcHideable");
        }
        hideNestedPropertiesIn(defaultProperties, values, "gridColumns", index, hidden);
    });
    if (hasLayout(values)) {
        hide(["columns", "showWbs", "showVariance", "costColumns"]);
    }
    if (values.editable === "false") {
        // A chart nobody can change needs no save settings or change handler.
        hidePropertiesIn(defaultProperties, values, [
            "snap",
            "saveMode",
            "onTaskChange",
            "allowUndo",
            "inlineEdit",
            "nameAttr",
            "snapWorkingDays",
            "scenarioMode"
        ] as Keys);
    }
    return defaultProperties;
}

export function check(values: MxGanttPreviewProps): Problem[] {
    const problems: Problem[] = [];
    if (values.dependenciesAttr && !values.keyAttr) {
        problems.push({
            property: "keyAttr",
            severity: "error",
            message:
                "Depends on is set, so a Key attribute is needed: the dependency list refers to tasks by their key."
        });
    }
    if (values.keyAttr && !values.dependenciesAttr) {
        problems.push({
            property: "dependenciesAttr",
            severity: "warning",
            message: "Key is set but Depends on is not, so no dependency arrows will be drawn."
        });
    }
    if (values.startAttr && values.startAttr === values.endAttr) {
        problems.push({
            property: "endAttr",
            severity: "warning",
            message:
                "Start and End use the same attribute, so every task is drawn as a milestone and cannot be resized."
        });
    }
    if (values.rowHeight !== null && (values.rowHeight < 24 || values.rowHeight > 80)) {
        problems.push({
            property: "rowHeight",
            severity: "error",
            message: "Row height must be between 24 and 80 pixels."
        });
    }
    if (values.height !== null && values.height < 160) {
        problems.push({ property: "height", severity: "error", message: "Height must be at least 160 pixels." });
    }
    // 1.3
    if (values.barLabel === "custom" && !values.barLabelText) {
        problems.push({
            property: "barLabelText",
            severity: "warning",
            message: "Bar label is Custom but Bar label text is empty, so the bars have no label."
        });
    }
    if (values.stateAttr && (values.barStates ?? []).length === 0) {
        problems.push({
            property: "barStates",
            severity: "warning",
            message: "Status is set but Status colours is empty, so the status changes nothing. Add a colour per value."
        });
    }
    (values.barStates ?? []).forEach((state, index) => {
        if (!(state.bsValue ?? "").trim()) {
            problems.push({
                property: `barStates/${index + 1}/bsValue`,
                severity: "error",
                message: "Enter the Status value this colour is for."
            });
        }
        if (!(state.bsColor ?? "").trim()) {
            problems.push({
                property: `barStates/${index + 1}/bsColor`,
                severity: "error",
                message: "Enter a CSS colour, such as #e5242b or orange."
            });
        }
    });
    if (values.showGrid && values.gridWidth !== null && (values.gridWidth < 160 || values.gridWidth > 1200)) {
        problems.push({
            property: "gridWidth",
            severity: "error",
            message: "Task list width must be between 160 and 1200 pixels."
        });
    }
    if (values.saveMode === "change" && !values.onTaskChange && values.editable !== "false") {
        problems.push({
            property: "onTaskChange",
            severity: "warning",
            message:
                "Save changes is set to Change only and there is no On task changed action, so moved tasks are never committed."
        });
    }
    if (!!values.baselineStartAttr !== !!values.baselineEndAttr) {
        problems.push({
            property: values.baselineStartAttr ? "baselineEndAttr" : "baselineStartAttr",
            severity: "warning",
            message: "Baselines are drawn only when both Baseline start and Baseline end are set."
        });
    }
    if (values.workingDays && !/^[\s,;0-9a-zA-Z-]+$/.test(values.workingDays)) {
        problems.push({
            property: "workingDays",
            severity: "error",
            message:
                "Working days are ISO weekday numbers (1 is Monday, 7 is Sunday) or day names, such as 1-5 or Mon-Thu, Sat."
        });
    }
    if (values.pageSize !== null && values.pageSize < 0) {
        problems.push({ property: "pageSize", severity: "error", message: "Load at most cannot be negative." });
    }
    if (values.showWorkload && values.workloadCapacity !== null && values.workloadCapacity < 1) {
        problems.push({
            property: "workloadCapacity",
            severity: "error",
            message: "Tasks per person must be at least 1."
        });
    }
    if (values.showWorkload && !values.assigneeAttr) {
        problems.push({
            property: "showWorkload",
            severity: "warning",
            message: "The workload panel needs the Assigned to attribute."
        });
    }
    if (values.onAdd && !values.addStartAttr) {
        problems.push({
            property: "addStartAttr",
            severity: "warning",
            message: "On add task is set without Add: start, so the action does not know where to put the new task."
        });
    }
    if (values.highlightBehind && !values.progressAttr) {
        problems.push({
            property: "highlightBehind",
            severity: "warning",
            message: "Highlight behind schedule needs the Progress attribute: without it no task can be behind."
        });
    }
    if (values.scenarioMode && values.editable === "false") {
        problems.push({
            property: "scenarioMode",
            severity: "warning",
            message: "What-if scenarios need tasks that can be moved; Editable is false, so nothing can be planned."
        });
    }
    values.columns.forEach((column, index) => {
        if (!hasLayout(values) && !column.colAttribute && !column.colText) {
            problems.push({
                property: `columns/${index + 1}/colAttribute`,
                severity: "warning",
                message: "Set an Attribute or a Text for this column, or it stays empty."
            });
        }
    });
    if (values.progressLine && !values.progressAttr) {
        problems.push({
            property: "progressLine",
            severity: "warning",
            message: "The progress line needs a Progress attribute."
        });
    }
    if (values.showSlack && (!values.keyAttr || !values.dependenciesAttr)) {
        problems.push({
            property: "showSlack",
            severity: "warning",
            message:
                "Without Key and Depends on every task can slip until the end of the plan, so total float says little."
        });
    }
    // 2.3
    if (values.onImport && !values.importJsonAttr) {
        problems.push({
            property: "importJsonAttr",
            severity: "error",
            message: "On import needs Import: JSON, the String attribute that receives the imported plan."
        });
    }
    if (values.resources && !values.resourceNameAttr) {
        problems.push({
            property: "resourceNameAttr",
            severity: "error",
            message: "Resources needs a Resource name attribute to match the names in Assignments."
        });
    }
    if (values.constraintTypeAttr && !values.constraintDateAttr) {
        problems.push({
            property: "constraintDateAttr",
            severity: "warning",
            message: "Without a Constraint date only as soon / late as possible constraints can be used."
        });
    }
    if (values.hoursPerDay !== null && (values.hoursPerDay < 1 || values.hoursPerDay > 24)) {
        problems.push({
            property: "hoursPerDay",
            severity: "error",
            message: "Hours per working day must be between 1 and 24."
        });
    }
    if (
        (values.showEarnedValue || (!hasLayout(values) && values.costColumns)) &&
        !values.fixedCostAttr &&
        !values.actualCostAttr &&
        !values.resourceRateAttr
    ) {
        problems.push({
            property: "showEarnedValue",
            severity: "warning",
            message: "Earned value needs costs: a Fixed cost attribute or resources with a Cost rate per hour."
        });
    }
    if (values.resourceLeveling && !values.assignmentsAttr && !values.assigneeAttr) {
        problems.push({
            property: "resourceLeveling",
            severity: "warning",
            message: "Resource levelling needs Assignments or Assigned to."
        });
    }
    if (values.currency && !/^[A-Za-z]{3}$/.test(values.currency.trim())) {
        problems.push({
            property: "currency",
            severity: "warning",
            message:
                "Currency is a three-letter ISO 4217 code such as EUR or USD; costs are shown as plain numbers otherwise."
        });
    }
    (values.markers ?? []).forEach((marker, index) => {
        if (marker.markerColor && !/^(#[0-9a-f]{3,8}|[a-z]+|(rgb|hsl)a?\(.*\))$/i.test(marker.markerColor.trim())) {
            problems.push({
                property: `markers/${index + 1}/markerColor`,
                severity: "warning",
                message: "The marker colour does not look like a CSS colour; the default marker colour is used."
            });
        }
    });
    // 1.1
    if (values.allowCustomFields) {
        if (!values.fieldsAttr) {
            problems.push({
                property: "fieldsAttr",
                severity: "error",
                message:
                    "Custom fields needs Fields: a String attribute (unlimited length) of the data view object, such as the project, that keeps the field definitions."
            });
        }
        if (!values.taskValuesAttr) {
            problems.push({
                property: "taskValuesAttr",
                severity: "error",
                message:
                    "Custom fields needs Task values: a String attribute (unlimited length) of the task that keeps its values."
            });
        }
        if (values.maxFields !== null && (values.maxFields < 1 || values.maxFields > 100)) {
            problems.push({
                property: "maxFields",
                severity: "error",
                message: "Most fields must be between 1 and 100."
            });
        }
        if (values.fieldsAttr && !values.onFieldsChange && values.fieldsEditable !== "false") {
            problems.push({
                property: "onFieldsChange",
                severity: "warning",
                message:
                    "Without On fields changed the new field definitions are only saved when the page saves the data view object. Add an action that commits it."
            });
        }
    }
    checkColumns(values, problems);
    return problems;
}

/** What a built-in column needs, as a message; undefined when it can be shown. */
function missingFor(values: MxGanttPreviewProps, column: GridColumnsPreviewType): string | undefined {
    const baseline = (!!values.baselineStartAttr && !!values.baselineEndAttr) || !!values.baselinesAttr;
    switch (column.gcType) {
        case "progress":
            return values.progressAttr ? undefined : "Done needs the Progress attribute.";
        case "assignee":
            return values.assigneeAttr ? undefined : "Assigned to needs the Assigned to attribute.";
        case "assignments":
            return values.assignmentsAttr ? undefined : "Resources needs the Assignments attribute.";
        case "predecessors":
            return values.keyAttr && values.dependenciesAttr
                ? undefined
                : "Predecessors needs the Key and Depends on attributes.";
        case "baselineStart":
        case "baselineEnd":
        case "variance":
            return baseline
                ? undefined
                : `${BUILT_IN_LABELS[column.gcType]} needs Baseline start and Baseline end, or Baselines (JSON).`;
        case "cost":
            return values.fixedCostAttr || values.actualCostAttr || values.resourceRateAttr
                ? undefined
                : "Cost and earned value columns need costs: a Fixed cost or Actual cost attribute, or resources with a Cost rate per hour.";
        default:
            return undefined;
    }
}

/** 1.2: the Columns list. Plain comparisons only (Jint). */
function checkColumns(values: MxGanttPreviewProps, problems: Problem[]): void {
    const seen: Record<string, number> = {};
    const chooser = values.columnChooser || values.allowCustomFields;
    (values.gridColumns || []).forEach((column, index) => {
        const at = (key: keyof GridColumnsPreviewType): string => `gridColumns/${index + 1}/${key}`;
        const isAttribute = column.gcType === "attribute";
        const label = isAttribute
            ? "This attribute column"
            : column.gcType === "cost"
            ? `The ${COST_LABELS[column.gcCostMeasure] || "Cost"} column`
            : `The ${BUILT_IN_LABELS[column.gcType] || column.gcType} column`;
        if (!isAttribute) {
            const key = column.gcType === "cost" ? column.gcCostMeasure : column.gcType;
            if (seen[key] !== undefined) {
                problems.push({
                    property: at("gcType"),
                    severity: "error",
                    message: `${label} is already column ${seen[key] + 1}. Each built-in column can be used once.`
                });
            } else {
                seen[key] = index;
            }
            const missing = missingFor(values, column);
            if (missing) {
                problems.push({ property: at("gcType"), severity: "error", message: missing });
            }
        } else {
            if (!column.gcAttribute) {
                problems.push({
                    property: at("gcAttribute"),
                    severity: "error",
                    message: "Select the attribute this column shows."
                });
            }
            if (!(column.gcCaption || "").trim()) {
                problems.push({
                    property: at("gcCaption"),
                    severity: "warning",
                    message: "Give the column a caption: users see it in the header and in the column chooser."
                });
            }
            if (column.gcDecimals !== null && (column.gcDecimals < 0 || column.gcDecimals > 6)) {
                problems.push({ property: at("gcDecimals"), severity: "error", message: "Decimals must be 0 to 6." });
            }
            if (column.gcEditable && values.editable === "false") {
                problems.push({
                    property: at("gcEditable"),
                    severity: "warning",
                    message: "Editable is false for every task, so this column cannot be edited."
                });
            }
        }
        if (column.gcWidth !== null && (column.gcWidth < 0 || column.gcWidth > 800)) {
            problems.push({
                property: at("gcWidth"),
                severity: "error",
                message: "Width must be 0 (the column's own width) to 800 pixels."
            });
        }
        if (column.gcMinWidth !== null && (column.gcMinWidth < 24 || column.gcMinWidth > 400)) {
            problems.push({
                property: at("gcMinWidth"),
                severity: "error",
                message: "Minimum width must be 24 to 400 pixels."
            });
        }
        if (!column.gcVisible && (!chooser || !column.gcHideable)) {
            problems.push({
                property: at("gcVisible"),
                severity: "warning",
                message: chooser
                    ? "This column is hidden at first and Users can hide is No, so it is always shown."
                    : "This column is hidden at first and there is no column chooser, so users can never show it. Turn on Column chooser."
            });
        }
    });
}

// ---------------------------------------------------------------- 1.2 structure mode preview

interface ContainerProps {
    type: "Container";
    children?: StructurePreviewProps[];
    borders?: boolean;
    borderWidth?: number;
    backgroundColor?: string;
    grow?: number;
    padding?: number;
}

interface RowLayoutProps {
    type: "RowLayout";
    children: StructurePreviewProps[];
    columnSize?: "fixed" | "grow";
    borders?: boolean;
    borderWidth?: number;
    backgroundColor?: string;
    grow?: number;
    padding?: number;
}

interface TextProps {
    type: "Text";
    content: string;
    fontSize?: number;
    fontColor?: string;
    bold?: boolean;
    italic?: boolean;
}

interface SelectableProps {
    type: "Selectable";
    object: object;
    child: StructurePreviewProps;
    grow?: number;
}

interface DatasourceProps {
    type: "Datasource";
    property: object | null;
    child?: StructurePreviewProps;
}

type StructurePreviewProps = ContainerProps | RowLayoutProps | TextProps | SelectableProps | DatasourceProps;

// The Data Grid 2 palette, as AG Grid uses it.
const PALETTE = {
    light: {
        text: { primary: "#2F3646", secondary: "#6B707B", data: "#146FF4" },
        background: { topbarData: "#DCEEFE", topbarStandard: "#F7F7F7", containerFill: "#F2F2F3", bar: "#3565D6" }
    },
    dark: {
        text: { primary: "#DEDEDE", secondary: "#A4A4A4", data: "#579BF9" },
        background: { topbarData: "#333A65E5", topbarStandard: "#33646464", containerFill: "#3E3E3E", bar: "#6E96FF" }
    }
};

const container =
    (props: Omit<ContainerProps, "type" | "children"> = {}) =>
    (...children: StructurePreviewProps[]): ContainerProps => ({ type: "Container", ...props, children });
const rowLayout =
    (props: Omit<RowLayoutProps, "type" | "children"> = {}) =>
    (...children: StructurePreviewProps[]): RowLayoutProps => ({ type: "RowLayout", ...props, children });
const text =
    (props: Omit<TextProps, "type" | "content"> = {}) =>
    (content: string): TextProps => ({ type: "Text", ...props, content });

/** Structure mode: the task list columns as configured, with [Attribute] placeholders, and the timeline. */
export function getPreview(
    values: MxGanttPreviewProps,
    isDarkMode: boolean,
    version: number[] = [0, 0, 0]
): StructurePreviewProps {
    const major = version[0] || 0;
    const minor = version[1] || 0;
    const modernStudio = major > 9 || (major === 9 && minor >= 20);
    const palette = isDarkMode ? PALETTE.dark : PALETTE.light;
    const cell =
        (props: Omit<ContainerProps, "type" | "children">) =>
        (...children: StructurePreviewProps[]): ContainerProps =>
            container({ borders: true, ...props })(...children);

    // Studio Pro gives every cell the same share of the width, so long column lists are cut to "...".
    // Show the first columns and one "+N more" cell instead (all of them stay listed in the Columns property).
    const MAX_COLUMNS = 4;
    const all = values.showGrid ? previewColumns(values) : [];
    const lead = all.filter(column => column.key === "wbs");
    const others = all.filter(column => column.key !== "wbs");
    const rest = others.slice(0, Math.max(0, MAX_COLUMNS - lead.length));
    const more = others.length - rest.length;
    const taskCaption = `Task${values.nameSortable ? " ⇅" : ""}`;
    const taskPlaceholder = `[${values.taskName ? values.taskName : "Task name"}]`;
    const timelineGrow = 2;

    const titleBar = rowLayout({
        columnSize: "fixed",
        backgroundColor: palette.background.topbarData,
        borders: true,
        borderWidth: 1
    })(container({ padding: 4 })(text({ fontColor: palette.text.data })("MxGantt")));

    const toolbar = values.showToolbar
        ? [
              rowLayout({ columnSize: "fixed", borders: true, padding: 6 })(
                  container({ grow: 3 })(
                      text({ fontSize: 10, fontColor: palette.text.secondary })(
                          values.showFilter ? "Search tasks" : ""
                      )
                  ),
                  container({ grow: 2 })(
                      text({ fontSize: 10, fontColor: palette.text.data })(
                          `Day  Week  Month  Quarter   Today${values.columnChooser ? "   Columns" : ""}`
                      )
                  )
              )
          ]
        : [];

    const headerCell = (caption: string, hidden: boolean): ContainerProps =>
        cell({
            grow: 1,
            padding: 8,
            backgroundColor: hidden ? palette.background.containerFill : palette.background.topbarStandard
        })(
            text({ bold: true, fontSize: 10, fontColor: hidden ? palette.text.secondary : palette.text.primary })(
                caption
            )
        );
    const header = (column: (typeof all)[number]): StructurePreviewProps => {
        const child = headerCell(`${column.caption}${column.sortable ? " ⇅" : ""}`, column.hidden);
        return column.object ? { type: "Selectable", object: column.object, child, grow: 1 } : child;
    };
    const dataCell = (content: string, hidden: boolean): ContainerProps =>
        cell({ grow: 1, padding: 8, backgroundColor: hidden ? palette.background.containerFill : undefined })(
            text({ fontSize: 10, fontColor: palette.text.secondary })(content)
        );
    // Only the header cell is Selectable (like AG Grid): Studio Pro drops the whole structure preview
    // when the same Columns item is wrapped in Selectable more than once.
    const data = (column: (typeof all)[number]): StructurePreviewProps => dataCell(column.placeholder, column.hidden);

    const timelineHeader = cell({ grow: timelineGrow, padding: 8, backgroundColor: palette.background.topbarStandard })(
        text({ bold: true, fontSize: 10, fontColor: palette.text.primary })("Timeline")
    );
    const timelineCell = (row: number): ContainerProps =>
        cell({ grow: timelineGrow, padding: 8 })(
            text({ fontSize: 10, fontColor: palette.background.bar })(
                `${"   ".slice(0, row % 3)}${"▬▬▬▬▬▬".slice(0, 3 + (row % 3))}`
            )
        );

    const headerRow = rowLayout({ columnSize: "fixed" })(
        ...lead.map(header),
        ...(values.showGrid ? [headerCell(taskCaption, false)] : []),
        ...rest.map(header),
        ...(more > 0 ? [headerCell(`+${more} more`, true)] : []),
        timelineHeader
    );
    const dataRows = [0, 1, 2, 3].map(row =>
        rowLayout({ columnSize: "fixed" })(
            ...lead.map(data),
            ...(values.showGrid ? [dataCell(taskPlaceholder, false)] : []),
            ...rest.map(data),
            ...(more > 0 ? [dataCell("", true)] : []),
            timelineCell(row)
        )
    );

    const datasourceHeader: StructurePreviewProps[] = modernStudio
        ? [{ type: "Datasource", property: values.tasks }]
        : [];
    return container()(titleBar, ...datasourceHeader, ...toolbar, headerRow, ...dataRows);
}
