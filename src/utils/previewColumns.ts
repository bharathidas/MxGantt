/**
 * The task list columns as Studio Pro shows them (1.2), for the design preview and the structure
 * preview alike. Studio Pro runs editorConfig in Jint, so this file sticks to plain string and
 * array operations: no regular expressions, no split by pattern, no flat or replaceAll.
 */
import { GridColumnsPreviewType, MxGanttPreviewProps } from "../../typings/MxGanttProps";

export interface PreviewColumn {
    key: string;
    caption: string;
    /** What a structure-mode cell shows, such as [Budget]. */
    placeholder: string;
    /** Sample values for the design preview rows. */
    samples: string[];
    align: "left" | "center" | "right";
    width: number;
    sortable: boolean;
    /** Shown at first = No. */
    hidden: boolean;
    /** The Columns item, so Studio Pro can select it in structure mode. */
    object?: GridColumnsPreviewType;
}

export const BUILT_IN_LABELS: Record<string, string> = {
    attribute: "Attribute",
    wbs: "WBS",
    start: "Start",
    end: "End",
    duration: "Duration",
    progress: "Done",
    assignee: "Assigned to",
    assignments: "Resources",
    predecessors: "Predecessors",
    baselineStart: "Baseline start",
    baselineEnd: "Baseline end",
    variance: "Variance",
    cost: "Cost"
};

export const COST_LABELS: Record<string, string> = {
    cost: "Cost",
    bac: "BAC",
    pv: "PV",
    ev: "EV",
    ac: "AC",
    cv: "CV",
    sv: "SV",
    cpi: "CPI",
    spi: "SPI",
    eac: "EAC",
    etc: "ETC",
    vac: "VAC"
};

const SAMPLES: Record<string, string[]> = {
    wbs: ["1", "1.1", "1.2", "2", "3"],
    start: ["3 Mar", "3 Mar", "10 Mar", "17 Mar", "4 Apr"],
    end: ["28 Mar", "7 Mar", "14 Mar", "4 Apr", "4 Apr"],
    duration: ["20 d", "5 d", "5 d", "14 d", "0 d"],
    progress: ["70%", "100%", "40%", "0%", "0%"],
    assignee: ["", "Ann", "Bob", "Ann, Raj", "Raj"],
    assignments: ["", "Ann:50", "Bob", "Ann, Raj:50", ""],
    predecessors: ["", "", "1.1", "1.2", "2"],
    baselineStart: ["3 Mar", "3 Mar", "7 Mar", "14 Mar", "1 Apr"],
    baselineEnd: ["25 Mar", "7 Mar", "12 Mar", "1 Apr", "1 Apr"],
    variance: ["+3 d", "0 d", "+2 d", "+3 d", "+3 d"],
    cost: ["12,400", "2,000", "3,400", "7,000", "0"]
};

const NUMERIC = ["duration", "progress", "variance", "cost"];

/** The last part of an attribute path, such as Budget for MyModule.Task/Budget. */
export function attributeName(path: string): string {
    const parts = path.split("/");
    const last = parts[parts.length - 1] || path;
    const dot = last.lastIndexOf(".");
    return dot >= 0 ? last.slice(dot + 1) : last;
}

function columnCaption(column: GridColumnsPreviewType, index: number): string {
    const caption = (column.gcCaption || "").trim();
    if (caption) {
        return caption;
    }
    if (column.gcType === "attribute") {
        return column.gcAttribute ? attributeName(column.gcAttribute) : `Column ${index + 1}`;
    }
    if (column.gcType === "cost") {
        return COST_LABELS[column.gcCostMeasure] || "Cost";
    }
    return BUILT_IN_LABELS[column.gcType] || column.gcType;
}

function builtInPlaceholder(values: MxGanttPreviewProps, type: string): string {
    const path = (attribute: string, fallback: string): string =>
        `[${attribute ? attributeName(attribute) : fallback}]`;
    switch (type) {
        case "start":
            return path(values.startAttr, "Start");
        case "end":
            return path(values.endAttr, "End");
        case "progress":
            return path(values.progressAttr, "Progress");
        case "assignee":
            return path(values.assigneeAttr, "Assigned to");
        case "assignments":
            return path(values.assignmentsAttr, "Assignments");
        case "predecessors":
            return path(values.dependenciesAttr, "Depends on");
        case "baselineStart":
            return path(values.baselineStartAttr, "Baseline start");
        case "baselineEnd":
            return path(values.baselineEndAttr, "Baseline end");
        default:
            return `[${BUILT_IN_LABELS[type] || type}]`;
    }
}

/** The configured columns; the classic ones (Start, End, Duration, ...) while the list is empty. */
export function previewColumns(values: MxGanttPreviewProps): PreviewColumn[] {
    const list = values.gridColumns || [];
    if (list.length > 0) {
        const seen: Record<string, boolean> = {};
        const result: PreviewColumn[] = [];
        list.forEach((column, index) => {
            const key =
                column.gcType === "attribute"
                    ? `a${index}`
                    : column.gcType === "cost"
                    ? column.gcCostMeasure
                    : column.gcType;
            if (seen[key]) {
                return;
            }
            seen[key] = true;
            const isAttribute = column.gcType === "attribute";
            const numeric =
                NUMERIC.indexOf(column.gcType) >= 0 ||
                (isAttribute &&
                    (column.gcFormat === "number" || column.gcFormat === "currency" || column.gcFormat === "percent"));
            const placeholder = isAttribute
                ? `[${column.gcAttribute ? attributeName(column.gcAttribute) : "No attribute selected"}]`
                : column.gcType === "cost"
                ? `[${COST_LABELS[column.gcCostMeasure] || "Cost"}]`
                : builtInPlaceholder(values, column.gcType);
            const width = column.gcWidth && column.gcWidth > 0 ? column.gcWidth : isAttribute ? 100 : 84;
            result.push({
                key,
                caption: columnCaption(column, index),
                placeholder,
                samples: isAttribute ? [placeholder] : SAMPLES[column.gcType === "cost" ? "cost" : column.gcType] || [],
                align: column.gcAlign && column.gcAlign !== "auto" ? column.gcAlign : numeric ? "right" : "left",
                width: Math.max(40, Math.min(240, width)),
                sortable: !!column.gcSortable,
                hidden: column.gcVisible === false,
                object: column
            });
        });
        // A WBS number column is drawn before Task name, like at runtime; the caller puts it there.
        return result;
    }
    const classic: PreviewColumn[] = [];
    const add = (key: string, caption: string, width: number, align: "left" | "right" = "left"): void => {
        classic.push({
            key,
            caption,
            placeholder: builtInPlaceholder(values, key),
            samples: SAMPLES[key] || [],
            align,
            width,
            sortable: false,
            hidden: false
        });
    };
    if (values.showWbs) {
        add("wbs", "WBS", 48);
    }
    add("start", "Start", 70);
    add("end", "End", 70);
    add("duration", "Duration", 64, "right");
    if (values.progressAttr) {
        add("progress", "Done", 52, "right");
    }
    if (values.assigneeAttr) {
        add("assignee", "Assigned to", 90);
    }
    (values.columns || []).forEach((column, index) => {
        const caption = (column.colCaption || "").trim() || `Column ${index + 1}`;
        const placeholder = column.colAttribute
            ? `[${attributeName(column.colAttribute)}]`
            : column.colText
            ? column.colText
            : "[...]";
        classic.push({
            key: `custom${index}`,
            caption,
            placeholder,
            samples: [placeholder],
            align: column.colAlign === "right" ? "right" : column.colAlign === "center" ? "center" : "left",
            width: Math.max(40, Math.min(240, column.colWidth || 100)),
            sortable: false,
            hidden: false
        });
    });
    return classic;
}
