import {
    Component,
    ErrorInfo,
    Fragment,
    ReactElement,
    ReactNode,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState
} from "react";
import { ObjectItem, ValueStatus } from "mendix";

import { MxGanttContainerProps } from "../typings/MxGanttProps";
import { CustomFieldsSetup, ExtraColumn, GanttChart, SaveState, TaskChange } from "./components/GanttChart";
import { FieldDef, parseFields, parseValues, serializeFields } from "./utils/fields";
import { parseBaselines } from "./utils/baselines";
import { makeCalendar } from "./utils/calendar";
import { makeConstraint, parseConstraintType } from "./utils/constraints";
import { ImportedPlan } from "./utils/mspdiImport";
import { parseAssignments, ResourceInfo } from "./utils/resources";
import { parseSegments } from "./utils/segments";
import { TaskValues } from "./utils/history";
import {
    CellOption,
    CellValue,
    columnOfCellKey,
    isCellKey,
    LayoutColumn,
    layoutKey,
    makeCellFormatter,
    sameRawValue,
    toRaw,
    uniqueLayout,
    ValueType
} from "./utils/layout";
import { BarState, matchState, TimelineLook } from "./utils/look";
import { storageKey } from "./utils/storage";
import { sortMarkers } from "./utils/plan";
import { applyValues } from "./utils/scenario";
import { clampProgress, normaliseDates, Task, withDependencies } from "./utils/tasks";
import { readTexts } from "./utils/texts";
import { splitAssignees } from "./utils/workload";
import { WriteEntry, WriteField, WriteKind, writeTasks } from "./utils/write";

import "./ui/MxGantt.css";

/** How long a change the user made is shown before the data source has to confirm it. */
const OVERRIDE_TIMEOUT = 15000;

/** One colour per person for Bar colour = Assigned to; readable on light and dark backgrounds. */
const ASSIGNEE_PALETTE = [
    "#3565d6",
    "#0e9384",
    "#c4320a",
    "#7a5af8",
    "#dd2590",
    "#ca8504",
    "#15b79e",
    "#6172f3",
    "#e04f16",
    "#4e5ba6"
];

class ErrorBoundary extends Component<
    { message: string; retry: string; children: ReactNode },
    { error?: Error; attempt: number }
> {
    state: { error?: Error; attempt: number } = { attempt: 0 };

    componentDidCatch(error: Error, info: ErrorInfo): void {
        console.error("MxGantt:", error, info.componentStack);
    }

    render(): ReactNode {
        if (this.state.error) {
            return (
                <div className="mxgantt mxgantt-error" role="alert">
                    <span>{this.props.message}</span>
                    <button
                        type="button"
                        className="mxgantt-button"
                        onClick={() => this.setState(state => ({ error: undefined, attempt: state.attempt + 1 }))}
                    >
                        {this.props.retry}
                    </button>
                </div>
            );
        }
        // A new key remounts the chart from scratch on retry.
        return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
    }

    static getDerivedStateFromError(error: Error): { error: Error } {
        return { error };
    }
}

/** A CSS colour the browser understands, or undefined so the default bar colour is used. */
function validColor(value: string | undefined): string | undefined {
    const color = value?.trim();
    if (!color) {
        return undefined;
    }
    if (typeof CSS !== "undefined" && typeof CSS.supports === "function") {
        return CSS.supports("color", color) ? color : undefined;
    }
    return color;
}

function sessionLocale(): string | undefined {
    const mx = (window as unknown as { mx?: { session?: { sessionData?: { locale?: { code?: string } } } } }).mx;
    const code = mx?.session?.sessionData?.locale?.code;
    // Mendix uses en_US, Intl wants en-US.
    return code ? code.replace(/_/g, "-") : undefined;
}

function sessionUser(): string | undefined {
    try {
        const mx = (window as unknown as { mx?: { session?: { getUserId?: () => unknown } } }).mx;
        const id = mx?.session?.getUserId?.();
        return id === undefined || id === null ? undefined : String(id);
    } catch {
        return undefined;
    }
}

function sameValue(a: unknown, b: unknown): boolean {
    if (a instanceof Date && b instanceof Date) {
        return a.getTime() === b.getTime();
    }
    return a === b;
}

/** Whether the data source now shows what the user changed, so the local override can go. */
function confirmed(task: Task, values: TaskValues): boolean {
    return (
        (values.start === undefined || sameValue(task.start, values.start)) &&
        (values.end === undefined || sameValue(task.end, values.end)) &&
        (values.progress === undefined || task.progress === values.progress) &&
        (values.name === undefined || (task.nameValue ?? task.name) === values.name) &&
        (values.deps === undefined || (task.depsText ?? "") === values.deps) &&
        (values.assignments === undefined || (task.assignmentsText ?? "") === values.assignments) &&
        (values.segments === undefined || (task.segmentsText ?? "") === values.segments) &&
        (values.baselines === undefined || (task.baselinesText ?? "") === values.baselines) &&
        (values.fields === undefined || (task.fieldsText ?? "") === values.fields) &&
        Object.keys(values).every(
            key =>
                !isCellKey(key) ||
                values[key] === undefined ||
                sameRawValue(task.cells?.[columnOfCellKey(key)]?.raw, values[key])
        )
    );
}

/** 1.2: what kind of value an attribute of a configured column holds. */
function valueTypeOf(type: string | undefined): ValueType {
    switch (type) {
        case "Integer":
        case "Long":
        case "Decimal":
        case "AutoNumber":
            return "number";
        case "Boolean":
            return "boolean";
        case "DateTime":
            return "date";
        case "Enum":
            return "enum";
        default:
            return "string";
    }
}

const WRITE_KINDS: Record<ValueType, WriteKind> = {
    string: "string",
    number: "number",
    boolean: "boolean",
    date: "date",
    enum: "enum"
};

function numberOf(value: unknown): number | undefined {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }
    const number = Number(String(value));
    return Number.isFinite(number) ? number : undefined;
}

function Gantt(props: MxGanttContainerProps & { texts: ReturnType<typeof readTexts> }): ReactElement {
    const { texts } = props;
    const items = useMemo(() => props.tasks.items ?? [], [props.tasks]);
    const itemsById = useMemo(() => new Map(items.map(item => [item.id as string, item])), [items]);
    const calendar = useMemo(
        () => makeCalendar(props.workingDays, props.holidays?.value),
        [props.workingDays, props.holidays?.value]
    );

    // 1.2 configured columns: one entry per Columns item, with its key, in the order of the list.
    const locale = sessionLocale();
    const layoutSources = useMemo(
        () =>
            props.gridColumns.map((column, index) => ({
                column,
                key: layoutKey(column.gcType, index, column.gcCostMeasure)
            })),
        [props.gridColumns]
    );
    const layout = useMemo<LayoutColumn[] | undefined>(() => {
        if (layoutSources.length === 0) {
            return undefined;
        }
        const context = { locale, currency: props.currency || undefined, yes: texts.yes, no: texts.no };
        return uniqueLayout(
            layoutSources.map(({ column, key }): LayoutColumn => {
                const attribute = column.gcType === "attribute" ? column.gcAttribute : undefined;
                const attrType = attribute?.type as string | undefined;
                const valueType = attribute ? valueTypeOf(attrType) : undefined;
                let options: CellOption[] | undefined;
                if (attribute && valueType === "boolean") {
                    options = [
                        { value: "true", label: texts.yes },
                        { value: "false", label: texts.no }
                    ];
                } else if (attribute && valueType === "enum") {
                    const universe = (attribute.universe ?? []) as unknown[];
                    options = universe.map(value => {
                        let label = String(value);
                        try {
                            label = attribute.formatter.format(value as never) || label;
                        } catch {
                            // Keep the key as the label.
                        }
                        return { value: String(value), label };
                    });
                }
                const mendix =
                    attribute && valueType !== "number"
                        ? (raw: unknown): string | undefined => attribute.formatter?.format(raw as never) ?? undefined
                        : undefined;
                const width = column.gcWidth > 0 ? Math.max(24, Math.min(800, column.gcWidth)) : undefined;
                return {
                    key,
                    type: column.gcType,
                    title: column.gcCaption?.value?.trim() || undefined,
                    tooltip: column.gcTooltip?.value?.trim() || undefined,
                    width,
                    minWidth: Math.max(24, Math.min(400, column.gcMinWidth ?? 40)),
                    fill: column.gcFill,
                    align: column.gcAlign === "auto" ? undefined : column.gcAlign,
                    wrap: column.gcWrap,
                    visible: column.gcVisible,
                    hideable: column.gcHideable,
                    sortable: column.gcSortable,
                    editable: !!attribute && column.gcEditable && attrType !== "AutoNumber",
                    valueType,
                    integer: attrType === "Integer" || attrType === "Long" || attrType === "AutoNumber",
                    format: column.gcFormat,
                    decimals: column.gcDecimals,
                    total: column.gcTotal,
                    options,
                    formatRaw: makeCellFormatter(column.gcFormat, column.gcDecimals, context, options, mendix)
                };
            })
        );
    }, [layoutSources, locale, props.currency, texts]);
    const layoutByKey = useMemo(() => new Map((layout ?? []).map(entry => [entry.key, entry])), [layout]);

    // 1.3: Status colours, in list order; entries without a valid colour are skipped.
    const barStates = useMemo<BarState[]>(
        () =>
            props.barStates.flatMap(state => {
                const color = validColor(state.bsColor || undefined);
                const value = (state.bsValue ?? "").trim().toLowerCase();
                return color && value ? [{ value, color, caption: state.bsCaption?.value?.trim() ?? "" }] : [];
            }),
        [props.barStates]
    );

    const baseTasks = useMemo<Task[]>(
        () =>
            items.map((item: ObjectItem) => {
                const dates = normaliseDates(props.startAttr.get(item).value, props.endAttr.get(item).value);
                const progressValue = props.progressAttr?.get(item).value;
                const group = props.groupAttr?.get(item);
                const keyValue = props.keyAttr?.get(item).value;
                const assignee = props.assigneeAttr?.get(item);
                const task: Task = {
                    id: item.id as string,
                    name: props.taskName.get(item).value ?? "",
                    start: dates.start,
                    end: dates.end,
                    progress:
                        props.progressAttr === undefined
                            ? undefined
                            : clampProgress(progressValue === undefined ? 0 : Number(progressValue.toString())),
                    // Enumerations show their caption; strings are used as they are.
                    group:
                        (group?.displayValue || (group?.value !== undefined ? String(group.value) : "")).trim() ||
                        undefined,
                    color: validColor(props.colorAttr?.get(item).value),
                    milestone: props.milestoneAttr?.get(item).value === true,
                    key: keyValue === undefined || keyValue === null ? undefined : String(keyValue).trim(),
                    deps: [],
                    editable: props.editable.get(item).value === true
                };
                if (props.baselineStartAttr || props.baselineEndAttr) {
                    const baseline = normaliseDates(
                        props.baselineStartAttr?.get(item).value,
                        props.baselineEndAttr?.get(item).value
                    );
                    task.baselineStart = baseline.start;
                    task.baselineEnd = baseline.end;
                    task.attrBaselineStart = baseline.start;
                    task.attrBaselineEnd = baseline.end;
                }
                // 2.3
                if (props.assignmentsAttr) {
                    const text = props.assignmentsAttr.get(item).value ?? "";
                    task.assignmentsText = text;
                    task.assignments = parseAssignments(text);
                }
                if (props.segmentsAttr) {
                    const text = props.segmentsAttr.get(item).value ?? "";
                    task.segmentsText = text;
                    task.segments = parseSegments(text);
                }
                if (props.constraintTypeAttr) {
                    const type = props.constraintTypeAttr.get(item);
                    task.constraint = makeConstraint(
                        parseConstraintType(type.value) ?? parseConstraintType(type.displayValue),
                        props.constraintDateAttr?.get(item).value ?? undefined
                    );
                }
                if (props.priorityAttr) {
                    task.priority = numberOf(props.priorityAttr.get(item).value);
                }
                if (props.fixedCostAttr) {
                    task.fixedCost = numberOf(props.fixedCostAttr.get(item).value);
                }
                if (props.actualCostAttr) {
                    task.actualCost = numberOf(props.actualCostAttr.get(item).value);
                }
                if (props.baselinesAttr) {
                    const text = props.baselinesAttr.get(item).value ?? "";
                    task.baselinesText = text;
                    task.baselines = parseBaselines(text);
                }
                if (props.projectText) {
                    task.project = (props.projectText.get(item).value ?? "").trim() || undefined;
                }
                if (assignee) {
                    task.assignee =
                        (
                            assignee.displayValue || (assignee.value !== undefined ? String(assignee.value) : "")
                        ).trim() || undefined;
                }
                if (props.deadlineAttr) {
                    task.deadline = props.deadlineAttr.get(item).value ?? undefined;
                }
                if (props.nameAttr) {
                    task.nameValue = props.nameAttr.get(item).value ?? "";
                }
                // 1.3
                if (props.taskCode) {
                    task.code = (props.taskCode.get(item).value ?? "").trim() || undefined;
                }
                if (props.taskSubtitle) {
                    task.subtitle = (props.taskSubtitle.get(item).value ?? "").trim() || undefined;
                }
                if (props.barLabel === "custom" && props.barLabelText) {
                    task.barText = props.barLabelText.get(item).value ?? "";
                }
                if (props.stateAttr && barStates.length > 0) {
                    const status = props.stateAttr.get(item);
                    task.state = matchState(barStates, status.value, status.displayValue);
                    if (task.state !== undefined) {
                        task.color = barStates[task.state].color;
                    }
                }
                if (props.allowCustomFields && props.taskValuesAttr) {
                    const text = props.taskValuesAttr.get(item).value ?? "";
                    task.fieldsText = text;
                    task.fieldValues = parseValues(text);
                }
                if (layout) {
                    // 1.2: values, texts and cell classes of the configured columns.
                    const cells: Record<string, CellValue> = {};
                    const searchTexts: string[] = [];
                    layoutSources.forEach(({ column, key }) => {
                        const entry = layoutByKey.get(key);
                        if (!entry) {
                            return;
                        }
                        const cls = column.gcClass?.get(item).value?.trim() || undefined;
                        const attribute = column.gcType === "attribute" ? column.gcAttribute : undefined;
                        if (!attribute) {
                            if (cls) {
                                cells[key] = { cls };
                            }
                            return;
                        }
                        const value = attribute.get(item);
                        const raw = toRaw(value.value);
                        const text =
                            entry.format === "auto" && value.displayValue !== undefined
                                ? value.displayValue
                                : entry.formatRaw?.(raw) ?? "";
                        cells[key] = { raw, text, cls };
                        if (text) {
                            searchTexts.push(text);
                        }
                    });
                    task.cells = cells;
                    // Searched like the extra columns.
                    task.columns = searchTexts;
                } else if (props.columns.length > 0) {
                    task.columns = props.columns.map(column =>
                        column.colAttribute
                            ? column.colAttribute.get(item).displayValue ?? ""
                            : column.colText?.get(item).value ?? ""
                    );
                }
                return withDependencies(task, props.dependenciesAttr?.get(item).value);
            }),
        [
            items,
            props.taskName,
            props.startAttr,
            props.endAttr,
            props.progressAttr,
            props.groupAttr,
            props.colorAttr,
            props.milestoneAttr,
            props.keyAttr,
            props.dependenciesAttr,
            props.editable,
            props.baselineStartAttr,
            props.baselineEndAttr,
            props.assigneeAttr,
            props.nameAttr,
            props.columns,
            props.deadlineAttr,
            props.assignmentsAttr,
            props.segmentsAttr,
            props.constraintTypeAttr,
            props.constraintDateAttr,
            props.priorityAttr,
            props.fixedCostAttr,
            props.actualCostAttr,
            props.baselinesAttr,
            props.projectText,
            props.allowCustomFields,
            props.taskValuesAttr,
            layout,
            layoutSources,
            layoutByKey,
            props.taskCode,
            props.taskSubtitle,
            props.barLabel,
            props.barLabelText,
            props.stateAttr,
            barStates
        ]
    );

    // Bar colour = Assigned to: one palette colour per person, in name order so colours stay put.
    const assigneeColors = useMemo(() => {
        if (props.colorBy !== "assignee" || !props.assigneeAttr) {
            return undefined;
        }
        const names = [...new Set(baseTasks.flatMap(task => splitAssignees(task.assignee)))].sort((a, b) =>
            a.localeCompare(b)
        );
        return new Map(names.map((name, index) => [name, ASSIGNEE_PALETTE[index % ASSIGNEE_PALETTE.length]]));
    }, [props.colorBy, props.assigneeAttr, baseTasks]);
    const coloured = useMemo(
        () =>
            assigneeColors
                ? baseTasks.map(task => {
                      const color = assigneeColors.get(splitAssignees(task.assignee)[0] ?? "");
                      return color ? { ...task, color } : task;
                  })
                : baseTasks,
        [assigneeColors, baseTasks]
    );

    // Changes the user made are shown straight away and kept until the data source reports the
    // same values; otherwise the bar would jump back while the object is being saved.
    const [overrides, setOverrides] = useState<ReadonlyMap<string, TaskValues>>(() => new Map());
    const timers = useRef(new Map<string, number>());
    const dropOverride = useCallback((id: string) => {
        window.clearTimeout(timers.current.get(id));
        timers.current.delete(id);
        setOverrides(current => {
            if (!current.has(id)) {
                return current;
            }
            const next = new Map(current);
            next.delete(id);
            return next;
        });
    }, []);
    useEffect(() => {
        overrides.forEach((values, id) => {
            const task = coloured.find(candidate => candidate.id === id);
            if (!task || confirmed(task, values)) {
                dropOverride(id);
            }
        });
    }, [coloured, overrides, dropOverride]);
    useEffect(() => {
        const pending = timers.current;
        return () => pending.forEach(timer => window.clearTimeout(timer));
    }, []);

    const tasks = useMemo(
        () =>
            overrides.size === 0
                ? coloured
                : coloured.map(task => {
                      const override = overrides.get(task.id);
                      return override ? applyValues(task, override) : task;
                  }),
        [coloured, overrides]
    );

    // 2.3 reliability: slow saves show Saving..., failed ones are rolled back and offered for retry.
    const [pending, setPending] = useState(0);
    const [slow, setSlow] = useState(false);
    const [failed, setFailed] = useState<TaskChange[]>([]);
    useEffect(() => {
        if (pending === 0) {
            return;
        }
        const timer = window.setTimeout(() => setSlow(true), 1000);
        return () => window.clearTimeout(timer);
    }, [pending]);

    const onChange = (changes: TaskChange[]): void => {
        const entries: WriteEntry[] = [];
        const written: TaskChange[] = [];
        changes.forEach(({ id, next, previous }) => {
            const item = itemsById.get(id);
            if (!item) {
                return;
            }
            const fields: WriteField[] = [];
            if (next.start && !sameValue(next.start, previous.start)) {
                fields.push({ attribute: props.startAttr, kind: "date", value: next.start, hint: /start|begin|from/i });
            }
            if (next.end && !sameValue(next.end, previous.end)) {
                fields.push({ attribute: props.endAttr, kind: "date", value: next.end, hint: /end|finish|due|until/i });
            }
            if (props.progressAttr && next.progress !== undefined && next.progress !== previous.progress) {
                fields.push({
                    attribute: props.progressAttr,
                    kind: "number",
                    value: next.progress,
                    hint: /progress|percent|complete|done/i
                });
            }
            if (props.nameAttr && next.name !== undefined && next.name !== previous.name) {
                fields.push({
                    attribute: props.nameAttr,
                    kind: "string",
                    value: next.name,
                    hint: /name|title|subject/i
                });
            }
            if (props.dependenciesAttr && next.deps !== undefined && next.deps !== previous.deps) {
                fields.push({
                    attribute: props.dependenciesAttr,
                    kind: "string",
                    value: next.deps,
                    hint: /depend|predecessor|after/i,
                    name: props.dependencyAttrName?.trim() || undefined
                });
            }
            // 2.3 text fields; often all empty, so the attribute name decides which String attribute is meant.
            const text = (
                attribute: WriteField["attribute"] | undefined,
                value: string | undefined,
                before: string | undefined,
                hint: RegExp,
                name: string | undefined
            ): void => {
                if (attribute && value !== undefined && value !== before) {
                    fields.push({
                        attribute,
                        kind: "string",
                        value,
                        hint,
                        hintFirst: true,
                        name: name?.trim() || undefined
                    });
                }
            };
            text(
                props.assignmentsAttr,
                next.assignments,
                previous.assignments,
                /assign|resource/i,
                props.assignmentsAttrName
            );
            text(props.segmentsAttr, next.segments, previous.segments, /segment|split/i, props.segmentsAttrName);
            text(props.baselinesAttr, next.baselines, previous.baselines, /baseline/i, props.baselinesAttrName);
            // 1.1 custom field values.
            text(
                props.allowCustomFields ? props.taskValuesAttr : undefined,
                next.fields,
                previous.fields,
                /field|custom|values/i,
                props.taskValuesAttrName
            );
            // 1.2 configured attribute columns.
            Object.keys(next).forEach(key => {
                if (!isCellKey(key)) {
                    return;
                }
                const value = next[key];
                const columnKey = columnOfCellKey(key);
                const source = layoutSources.find(entry => entry.key === columnKey);
                const entry = layoutByKey.get(columnKey);
                const attribute = source?.column.gcType === "attribute" ? source.column.gcAttribute : undefined;
                if (!attribute || !entry?.valueType || value === undefined || sameRawValue(value, previous[key])) {
                    return;
                }
                fields.push({
                    attribute,
                    kind: WRITE_KINDS[entry.valueType],
                    value,
                    name: source?.column.gcAttributeName?.trim() || undefined
                });
            });
            if (fields.length > 0) {
                entries.push({ item, fields });
                written.push({ id, next, previous });
            }
        });
        if (entries.length === 0) {
            return;
        }
        setOverrides(current => {
            const map = new Map(current);
            written.forEach(change => map.set(change.id, { ...map.get(change.id), ...change.next }));
            return map;
        });
        written.forEach(change => {
            window.clearTimeout(timers.current.get(change.id));
            timers.current.set(
                change.id,
                window.setTimeout(() => dropOverride(change.id), OVERRIDE_TIMEOUT)
            );
        });
        setPending(count => count + 1);
        writeTasks(entries, { items, commit: props.saveMode === "commit" }).then(ok => {
            setPending(count => Math.max(0, count - 1));
            setSlow(false);
            if (!ok) {
                written.forEach(change => dropOverride(change.id));
                setFailed(current => [...current, ...written]);
                return;
            }
            entries.forEach(entry => {
                // Only custom field values changed: On field values changed, when the app set it.
                const onlyFields = entry.fields.every(field => field.attribute === props.taskValuesAttr);
                const action =
                    onlyFields && props.onTaskValuesChange
                        ? props.onTaskValuesChange.get(entry.item)
                        : props.onTaskChange?.get(entry.item);
                if (action?.canExecute && !action.isExecuting) {
                    action.execute();
                }
            });
        });
    };

    const onChangeRef = useRef(onChange);
    useLayoutEffect(() => {
        onChangeRef.current = onChange;
    });
    const saveState = useMemo<SaveState>(
        () => ({
            saving: slow,
            failed: failed.length,
            onRetry: () => {
                const retry = failed;
                setFailed([]);
                onChangeRef.current(retry);
            },
            onDismiss: () => setFailed([])
        }),
        [slow, failed]
    );

    const onImport = (plan: ImportedPlan): void => {
        const target = props.importJsonAttr;
        if (!target || target.readOnly) {
            console.error("MxGantt: Import: JSON is not set or read-only, so the imported plan cannot be handed over");
            return;
        }
        target.setValue(JSON.stringify(plan));
        if (props.onImport?.canExecute && !props.onImport.isExecuting) {
            props.onImport.execute();
        }
    };

    const resources = useMemo(() => {
        const list = props.resources?.items;
        if (!list || !props.resourceNameAttr) {
            return undefined;
        }
        const map = new Map<string, ResourceInfo>();
        list.forEach(item => {
            const attribute = props.resourceNameAttr!.get(item);
            const name = (
                attribute.displayValue || (attribute.value !== undefined ? String(attribute.value) : "")
            ).trim();
            if (!name || map.has(name)) {
                return;
            }
            const max = numberOf(props.resourceMaxUnitsAttr?.get(item).value);
            map.set(name, {
                name,
                maxUnits: max !== undefined && max > 0 ? max : 100,
                rate: Math.max(0, numberOf(props.resourceRateAttr?.get(item).value) ?? 0)
            });
        });
        return map;
    }, [props.resources, props.resourceNameAttr, props.resourceMaxUnitsAttr, props.resourceRateAttr]);

    const onClick = (id: string): void => {
        const item = itemsById.get(id);
        const action = item ? props.onTaskClick?.get(item) : undefined;
        if (action?.canExecute && !action.isExecuting) {
            action.execute();
        }
    };

    const onAdd = (suggestion: { start: Date; end: Date }): void => {
        if (props.addStartAttr && !props.addStartAttr.readOnly) {
            props.addStartAttr.setValue(suggestion.start);
        }
        if (props.addEndAttr && !props.addEndAttr.readOnly) {
            props.addEndAttr.setValue(suggestion.end);
        }
        if (props.onAdd?.canExecute && !props.onAdd.isExecuting) {
            props.onAdd.execute();
        }
    };

    const onDelete = (id: string): void => {
        const item = itemsById.get(id);
        const action = item ? props.onDelete?.get(item) : undefined;
        if (action?.canExecute && !action.isExecuting) {
            action.execute();
        }
    };

    // Paging: load the first Load at most tasks, then more on request.
    const { pageSize } = props;
    const [limit, setLimit] = useState(() => (pageSize > 0 ? pageSize : undefined));
    const taskList = props.tasks;
    useEffect(() => {
        if (limit === undefined) {
            return;
        }
        if (taskList.limit !== limit) {
            taskList.setLimit(limit);
        }
        if (taskList.totalCount === undefined) {
            taskList.requestTotalCount(true);
        }
    }, [limit, taskList]);

    const extraColumns = useMemo<ExtraColumn[]>(
        () =>
            props.columns.map(column => ({
                title: column.colCaption?.value ?? "",
                width: Math.max(40, column.colWidth),
                align: column.colAlign
            })),
        [props.columns]
    );

    // 1.1 custom fields: definitions on the data view object, shown at once while the object catches up.
    const fieldsAttr = props.fieldsAttr;
    const storedFields = fieldsAttr?.status === ValueStatus.Available ? fieldsAttr.value ?? "" : "";
    // The fields the user just saved win until the attribute shows another value than before the save.
    const [pendingFields, setPendingFields] = useState<{ before: string; fields: FieldDef[] }>();
    const parsedFields = useMemo(() => parseFields(storedFields), [storedFields]);
    const fieldDefs = pendingFields && pendingFields.before === storedFields ? pendingFields.fields : parsedFields;
    const canManageFields =
        !!fieldsAttr &&
        !fieldsAttr.readOnly &&
        props.fieldsEditable?.status === ValueStatus.Available &&
        props.fieldsEditable.value === true;
    const onFieldsChange = (next: FieldDef[]): void => {
        if (!fieldsAttr || fieldsAttr.readOnly) {
            return;
        }
        const text = serializeFields(next);
        setPendingFields({ before: storedFields, fields: next });
        fieldsAttr.setValue(text);
        if (props.onFieldsChange?.canExecute && !props.onFieldsChange.isExecuting) {
            props.onFieldsChange.execute();
        }
    };
    const onFieldsChangeRef = useRef(onFieldsChange);
    useLayoutEffect(() => {
        onFieldsChangeRef.current = onFieldsChange;
    });
    const customFields = useMemo<CustomFieldsSetup | undefined>(
        () =>
            props.allowCustomFields && (props.fieldsAttr || props.taskValuesAttr)
                ? {
                      fields: fieldDefs,
                      canManage: canManageFields,
                      canEditValues: !!props.taskValuesAttr,
                      maxFields: Math.max(1, Math.min(100, props.maxFields ?? 30)),
                      showHint: props.fieldsHint !== false,
                      onFieldsChange: next => onFieldsChangeRef.current(next)
                  }
                : undefined,
        [
            props.allowCustomFields,
            props.fieldsAttr,
            props.taskValuesAttr,
            fieldDefs,
            canManageFields,
            props.maxFields,
            props.fieldsHint
        ]
    );

    const hasDependencies = !!props.keyAttr && !!props.dependenciesAttr;
    const markers = useMemo(
        () =>
            sortMarkers(
                props.markers.map(marker => ({
                    date: marker.markerDate?.status === ValueStatus.Available ? marker.markerDate.value : undefined,
                    label: marker.markerLabel?.value ?? "",
                    color: validColor(marker.markerColor || undefined)
                }))
            ),
        [props.markers]
    );

    const look = useMemo<TimelineLook>(
        () => ({
            portfolio: props.look === "portfolio",
            twoLine: !!props.taskSubtitle,
            barLabel: props.barLabel,
            dateFormat: props.barLabelDateFormat ?? "",
            baselineOutline: props.baselineStyle === "outline",
            deadlineDiamond: props.deadlineStyle === "diamond",
            todayLabel: props.todayStyle === "labelled",
            barLegend: props.barLegend,
            states: barStates
        }),
        [
            props.look,
            props.taskSubtitle,
            props.barLabel,
            props.barLabelDateFormat,
            props.baselineStyle,
            props.deadlineStyle,
            props.todayStyle,
            props.barLegend,
            barStates
        ]
    );

    return (
        <GanttChart
            tasks={tasks}
            loading={props.tasks.status === ValueStatus.Loading}
            texts={texts}
            initialZoom={props.zoom}
            snap={props.snap}
            rowHeight={Math.max(props.taskSubtitle ? 52 : 24, Math.min(80, props.rowHeight))}
            look={look}
            height={Math.max(160, props.height)}
            gridWidth={props.gridWidth}
            showGrid={props.showGrid}
            showToolbar={props.showToolbar}
            showToday={props.showToday}
            showWeekends={props.showWeekends}
            showLinks={props.showDependencies && hasDependencies}
            criticalMode={hasDependencies ? props.criticalPath : "none"}
            allowExport={props.allowExport}
            exportFileName={props.exportFileName?.value || "gantt"}
            hasProgress={!!props.progressAttr}
            theme={props.theme}
            locale={sessionLocale()}
            className={props.class}
            style={props.style}
            onChange={onChange}
            onClick={props.onTaskClick ? onClick : undefined}
            calendar={calendar}
            snapWorkingDays={props.snapWorkingDays}
            autoSchedule={hasDependencies ? props.autoSchedule : "none"}
            allowUndo={props.allowUndo}
            inlineEdit={props.inlineEdit}
            canEditName={!!props.nameAttr}
            hasDependencies={hasDependencies}
            linkEditing={props.linkEditing && hasDependencies}
            hasBaseline={!!props.baselineStartAttr && !!props.baselineEndAttr}
            hasAssignee={!!props.assigneeAttr}
            showWbs={props.showWbs}
            showVariance={props.showVariance}
            columnChooser={props.columnChooser}
            columnResize={props.columnResize}
            extraColumns={extraColumns}
            layout={layout}
            nameSortable={props.nameSortable}
            showWorkload={props.showWorkload}
            workloadCapacity={props.workloadCapacity}
            showFilter={props.showFilter}
            me={props.myAssignee?.value || undefined}
            exportCsv={props.exportCsv}
            printDetails={props.printDetails}
            exportTitle={props.exportTitle?.value ?? ""}
            viewKey={props.rememberState ? storageKey(props.name, sessionUser()) : undefined}
            assigneeColors={assigneeColors}
            paging={
                limit !== undefined
                    ? {
                          shown: items.length,
                          total: props.tasks.totalCount,
                          hasMore: props.tasks.hasMoreItems === true,
                          onLoadMore: () => setLimit(current => (current ?? 0) + pageSize)
                      }
                    : undefined
            }
            onAdd={props.onAdd ? onAdd : undefined}
            onDelete={props.onDelete ? onDelete : undefined}
            scenarioMode={props.scenarioMode}
            showStatusLine={props.showStatusLine}
            highlightBehind={props.highlightBehind && !!props.progressAttr}
            statusDate={props.statusDate?.status === ValueStatus.Available ? props.statusDate.value : undefined}
            animate={props.animate}
            exportExcel={props.exportExcel}
            exportProject={props.exportProject}
            hasDeadline={!!props.deadlineAttr}
            showSlack={props.showSlack}
            progressLine={props.progressLine}
            markers={markers}
            zoomToFit={props.zoomToFit}
            showHealth={props.showHealth}
            motion={props.motion}
            hasAssignments={!!props.assignmentsAttr}
            resources={resources}
            showResources={props.showResources}
            resourceLeveling={props.resourceLeveling}
            hoursPerDay={props.hoursPerDay}
            hasCost={
                !!props.fixedCostAttr ||
                !!props.actualCostAttr ||
                [...(resources?.values() ?? [])].some(r => r.rate > 0)
            }
            showEarnedValue={props.showEarnedValue}
            costColumns={props.costColumns}
            currency={props.currency || undefined}
            hasBaselines={!!props.baselinesAttr}
            baselineEditing={props.baselineEditing}
            defaultBaseline={props.defaultBaseline || undefined}
            hasSegments={!!props.segmentsAttr}
            hasConstraints={!!props.constraintTypeAttr}
            scheduleButton={props.scheduleButton}
            onImport={props.onImport && props.importJsonAttr ? onImport : undefined}
            showPortfolio={props.showPortfolio && !!props.projectText}
            saveState={saveState}
            customFields={customFields}
        />
    );
}

export function MxGantt(props: MxGanttContainerProps): ReactElement {
    const texts = readTexts(props);
    return (
        <ErrorBoundary message={texts.widgetError} retry={texts.retry}>
            <Gantt {...props} texts={texts} />
        </ErrorBoundary>
    );
}
