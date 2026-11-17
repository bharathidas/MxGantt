import { baselineNames } from "./baselines";
import { ALL_DAYS, dayKey, isWorkingDay, WorkCalendar, workingDaysBetween, workingDaysPerWeek } from "./calendar";
import { MSPDI_CONSTRAINT } from "./constraints";
import { Lag } from "./deps";
import { assignmentsOf, ResourceInfo, resourceInfo } from "./resources";
import { buildLinks, buildRows, isMilestone, Link, linkType, Task, variance } from "./tasks";
import { addDays, startOfDay } from "./time";
import { wbsNumbers } from "./wbs";
import { XlsxColumn, XlsxKind, XlsxRow, XlsxSheet, XlsxValue } from "./xlsx";

/**
 * The plan as a spreadsheet (Excel) and as Microsoft Project XML (MSPDI), built from the same task
 * model the chart draws, so both files show what the user sees: groups as summary rows or summary
 * tasks, WBS numbers, typed dependencies with their lags, assignees and baselines.
 */

export interface PlanSheetTitles {
    sheet: string;
    wbs: string;
    key: string;
    task: string;
    group: string;
    start: string;
    end: string;
    duration: string;
    progress: string;
    predecessors: string;
    assignee: string;
    baselineStart: string;
    baselineEnd: string;
    variance: string;
}

export interface PlanSheetOptions {
    calendar?: WorkCalendar;
    /** Dates with their time of day (hour snapping) instead of plain dates. */
    withTime?: boolean;
    hasProgress: boolean;
    hasDependencies: boolean;
    hasBaseline: boolean;
    hasAssignee: boolean;
    titles: PlanSheetTitles;
    /** 1.1: more columns after the built-in ones, such as custom fields. */
    extra?: Array<{ title: string; kind: XlsxKind; width: number; value: (task: Task) => XlsxValue }>;
}

/** The task list as one sheet: group rows in bold with the tasks indented and outlined under them. */
export function planSheet(tasks: Task[], options: PlanSheetOptions): XlsxSheet {
    const calendar = options.calendar ?? ALL_DAYS;
    const { titles } = options;
    const dateKind = options.withTime ? "datetime" : "date";
    const wbs = wbsNumbers(tasks);
    const hasGroups = tasks.some(task => !!task.group);
    const hasKeys = options.hasDependencies && tasks.some(task => !!task.key);

    type Cell = { column: XlsxColumn; value: (row: ReturnType<typeof buildRows>[number]) => XlsxRow["values"][number] };
    const cells: Cell[] = [];
    const days = (start?: Date, end?: Date): number | undefined =>
        start && end ? workingDaysBetween(calendar, start, end) : undefined;
    cells.push({ column: { title: titles.wbs, kind: "text", width: 8 }, value: row => wbs.get(row.id) ?? "" });
    if (hasKeys) {
        cells.push({
            column: { title: titles.key, kind: "text", width: 8 },
            value: row => (row.kind === "task" ? row.task.key ?? "" : "")
        });
    }
    cells.push({
        column: { title: titles.task, kind: "text", width: 40 },
        value: row => (row.kind === "group" ? row.name : row.task.name)
    });
    if (hasGroups) {
        cells.push({
            column: { title: titles.group, kind: "text", width: 18 },
            value: row => (row.kind === "group" ? row.name : row.task.group ?? "")
        });
    }
    cells.push(
        {
            column: { title: titles.start, kind: dateKind, width: options.withTime ? 17 : 12 },
            value: row => (row.kind === "group" ? row.start : row.task.start)
        },
        {
            column: { title: titles.end, kind: dateKind, width: options.withTime ? 17 : 12 },
            value: row => (row.kind === "group" ? row.end : row.task.end)
        },
        {
            column: { title: titles.duration, kind: "number", width: 14 },
            value: row => (row.kind === "group" ? days(row.start, row.end) : days(row.task.start, row.task.end))
        }
    );
    if (options.hasProgress) {
        cells.push({
            column: { title: titles.progress, kind: "percent", width: 10 },
            value: row => {
                const progress = row.kind === "group" ? row.progress : row.task.progress;
                return progress === undefined ? undefined : progress / 100;
            }
        });
    }
    if (options.hasDependencies) {
        cells.push({
            column: { title: titles.predecessors, kind: "text", width: 18 },
            value: row => (row.kind === "task" ? row.task.depsText ?? "" : "")
        });
    }
    if (options.hasAssignee) {
        cells.push({
            column: { title: titles.assignee, kind: "text", width: 20 },
            value: row => (row.kind === "task" ? row.task.assignee ?? "" : "")
        });
    }
    if (options.hasBaseline) {
        cells.push(
            {
                column: { title: titles.baselineStart, kind: dateKind, width: options.withTime ? 17 : 14 },
                value: row => (row.kind === "task" ? row.task.baselineStart : undefined)
            },
            {
                column: { title: titles.baselineEnd, kind: dateKind, width: options.withTime ? 17 : 14 },
                value: row => (row.kind === "task" ? row.task.baselineEnd : undefined)
            },
            {
                column: { title: titles.variance, kind: "number", width: 14 },
                value: row => (row.kind === "task" ? variance(row.task, calendar) : undefined)
            }
        );
    }
    (options.extra ?? []).forEach(column =>
        cells.push({
            column: { title: column.title, kind: column.kind, width: column.width },
            value: row => (row.kind === "task" ? column.value(row.task) : undefined)
        })
    );
    const rows: XlsxRow[] = buildRows(tasks, new Set()).map(row => ({
        values: cells.map(cell => cell.value(row)),
        bold: row.kind === "group",
        level: row.kind === "task" ? row.depth : 0,
        indent: row.kind === "task" ? row.depth : 0
    }));
    return { name: titles.sheet, columns: cells.map(cell => cell.column), rows };
}

// ---------------------------------------------------------------- Microsoft Project XML

/** Link types as MSPDI numbers them. */
export const MSPDI_LINK_TYPE: Record<string, number> = { FF: 0, FS: 1, SF: 2, SS: 3 };

/** MSPDI duration formats used for lags: days, weeks and elapsed hours. */
const FORMAT_DAYS = 7;
const FORMAT_WEEKS = 9;
const FORMAT_ELAPSED_HOURS = 6;
const MINUTES_PER_DAY = 480;

/** A lag as MSPDI stores it: tenths of a minute of working time (8 hours a working day), and its unit. */
export function mspdiLag(lag: Lag | undefined, calendar: WorkCalendar = ALL_DAYS): { value: number; format: number } {
    if (!lag || lag.amount === 0) {
        return { value: 0, format: FORMAT_DAYS };
    }
    if (lag.unit === "h") {
        return { value: Math.round(lag.amount * 600), format: FORMAT_ELAPSED_HOURS };
    }
    if (lag.unit === "w") {
        return {
            value: Math.round(lag.amount * workingDaysPerWeek(calendar) * MINUTES_PER_DAY * 10),
            format: FORMAT_WEEKS
        };
    }
    return { value: Math.round(lag.amount * MINUTES_PER_DAY * 10), format: FORMAT_DAYS };
}

/** Local date and time as MSPDI writes it: 2026-10-05T08:00:00. */
export function mspdiDate(date: Date): string {
    const pad = (n: number): string => String(n).padStart(2, "0");
    return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
        `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    );
}

function atTime(day: Date, hours: number): Date {
    const date = startOfDay(day);
    date.setHours(hours, 0, 0, 0);
    return date;
}

/** A start at midnight begins the working day at 08:00 in Project's standard calendar. */
export function projectStart(date: Date): Date {
    return date.getTime() === startOfDay(date).getTime() ? atTime(date, 8) : date;
}

/**
 * An end at midnight is the end of the last working day before it, 17:00 in Project's standard
 * calendar (Wednesday 00:00 becomes Tuesday 17:00, Monday 00:00 becomes Friday 17:00).
 */
export function projectFinish(end: Date, start: Date, calendar: WorkCalendar = ALL_DAYS): Date {
    if (end.getTime() !== startOfDay(end).getTime() || end.getTime() <= start.getTime()) {
        return end.getTime() <= start.getTime() ? projectStart(start) : end;
    }
    let day = addDays(startOfDay(end), -1);
    for (let guard = 0; guard < 366 && !isWorkingDay(calendar, day) && day > start; guard++) {
        day = addDays(day, -1);
    }
    return day < startOfDay(start) ? projectStart(start) : atTime(day, 17);
}

/**
 * A finish-type date (deadline, finish constraint) as Project writes it: a date at midnight is the
 * end of the working day before it.
 */
export function finishStamp(date: Date, calendar: WorkCalendar = ALL_DAYS): Date {
    return projectFinish(date, addDays(startOfDay(date), -400), calendar);
}

/** Working days as an ISO 8601 duration of 8-hour days: 2.5 days -> PT20H0M0S. */
export function mspdiDuration(days: number): string {
    const minutes = Math.max(0, Math.round(days * MINUTES_PER_DAY));
    return `PT${Math.floor(minutes / 60)}H${minutes % 60}M0S`;
}

function x(text: string): string {
    return (
        text
            // eslint-disable-next-line no-control-regex
            .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
    );
}

function el(name: string, value: string | number | undefined): string {
    return value === undefined || value === ""
        ? ""
        : `<${name}>${typeof value === "number" ? value : x(value)}</${name}>`;
}

/** Holidays as runs of consecutive dates. */
export function holidayRanges(holidays: ReadonlySet<string>): Array<{ from: string; to: string }> {
    const sorted = [...holidays].sort();
    const ranges: Array<{ from: string; to: string }> = [];
    sorted.forEach(day => {
        const last = ranges[ranges.length - 1];
        if (last) {
            const [y, m, d] = last.to.split("-").map(Number);
            if (dayKey(addDays(new Date(y, m - 1, d), 1)) === day) {
                last.to = day;
                return;
            }
        }
        ranges.push({ from: day, to: day });
    });
    return ranges;
}

function calendarXml(calendar: WorkCalendar): string {
    const hours =
        "<WorkingTimes>" +
        "<WorkingTime><FromTime>08:00:00</FromTime><ToTime>12:00:00</ToTime></WorkingTime>" +
        "<WorkingTime><FromTime>13:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime>" +
        "</WorkingTimes>";
    let days = "";
    // MSPDI day types: 1 is Sunday ... 7 is Saturday, the same order as Date.getDay().
    calendar.working.forEach((working, index) => {
        days += `<WeekDay><DayType>${index + 1}</DayType><DayWorking>${working ? 1 : 0}</DayWorking>${
            working ? hours : ""
        }</WeekDay>`;
    });
    holidayRanges(calendar.holidays).forEach(range => {
        days +=
            "<WeekDay><DayType>0</DayType><DayWorking>0</DayWorking>" +
            `<TimePeriod><FromDate>${range.from}T00:00:00</FromDate><ToDate>${range.to}T23:59:00</ToDate></TimePeriod>` +
            "</WeekDay>";
    });
    return (
        "<Calendars><Calendar><UID>1</UID><Name>Standard</Name><IsBaseCalendar>1</IsBaseCalendar>" +
        `<BaseCalendarUID>-1</BaseCalendarUID><WeekDays>${days}</WeekDays></Calendar></Calendars>`
    );
}

export interface MspdiOptions {
    name: string;
    calendar?: WorkCalendar;
    /** Links as the chart built them; built from the tasks when left out. */
    links?: Link[];
    /** Creation stamp written into the file; fixed in tests. */
    now?: Date;
    /** 2.3: maximum units and cost rates of the resources. */
    resources?: ReadonlyMap<string, ResourceInfo>;
}

/** MSPDI keeps currency in hundredths. */
export const MSPDI_CURRENCY = 100;

function units(value: number): string {
    return String(Math.round((value / 100) * 10000) / 10000);
}

/** The 2.0 attribute baseline of a task, as exported in Baseline 0. */
function attributeBaseline(task: Task): { start: Date; finish: Date } | undefined {
    const fromAttributes = task.attrBaselineStart !== undefined || task.attrBaselineEnd !== undefined;
    const start = fromAttributes ? task.attrBaselineStart : task.baselines?.length ? undefined : task.baselineStart;
    const finish = fromAttributes ? task.attrBaselineEnd : task.baselines?.length ? undefined : task.baselineEnd;
    return start && finish ? { start, finish } : undefined;
}

interface MspdiTask {
    uid: number;
    name: string;
    wbs: string;
    level: number;
    start?: Date;
    end?: Date;
    progress?: number;
    milestone: boolean;
    summary: boolean;
    task?: Task;
}

/**
 * The plan as Microsoft Project XML (MSPDI), which Microsoft Project, ProjectLibre and most other
 * planning tools open: a calendar matching the working days and holidays, a summary task per group
 * with its tasks one outline level down, predecessor links with their type and lag, Start No
 * Earlier Than constraints so Project keeps the dates as planned, baselines, and resources with
 * their assignments.
 */
export function buildMspdi(tasks: Task[], options: MspdiOptions): string {
    const calendar = options.calendar ?? ALL_DAYS;
    const links = options.links ?? buildLinks(tasks, calendar);
    const wbs = wbsNumbers(tasks);
    const rows = buildRows(tasks, new Set());
    const list: MspdiTask[] = [];
    const uidOf = new Map<string, number>();
    // Baseline numbers: 0 for the attribute baseline when there is one, then the named baselines.
    const hasAttributeBaseline = tasks.some(task => !!attributeBaseline(task));
    const named = baselineNames(tasks).slice(0, hasAttributeBaseline ? 10 : 11);
    const baselineNumber = new Map(named.map((name, index) => [name, index + (hasAttributeBaseline ? 1 : 0)]));
    rows.forEach(row => {
        const uid = list.length + 1;
        uidOf.set(row.id, uid);
        if (row.kind === "group") {
            list.push({
                uid,
                name: row.name,
                wbs: wbs.get(row.id) ?? String(uid),
                level: (row.level ?? 0) + 1,
                start: row.start,
                end: row.end,
                progress: row.progress,
                milestone: false,
                summary: true
            });
            return;
        }
        list.push({
            uid,
            name: row.task.name,
            wbs: wbs.get(row.id) ?? String(uid),
            level: row.depth + 1,
            start: row.task.start,
            end: row.task.end,
            progress: row.task.progress,
            milestone: isMilestone(row.task),
            summary: false,
            task: row.task
        });
    });

    let projectStartDate: Date | undefined;
    let projectEndDate: Date | undefined;
    tasks.forEach(task => {
        if (task.start && (!projectStartDate || task.start < projectStartDate)) {
            projectStartDate = task.start;
        }
        if (task.end && (!projectEndDate || task.end > projectEndDate)) {
            projectEndDate = task.end;
        }
    });
    const now = options.now ?? new Date();
    const first = projectStart(projectStartDate ?? startOfDay(now));
    const last = projectEndDate && projectStartDate ? projectFinish(projectEndDate, projectStartDate, calendar) : first;

    const incoming = new Map<string, Link[]>();
    links.forEach(link => incoming.set(link.to, [...(incoming.get(link.to) ?? []), link]));

    const taskXml = (entry: MspdiTask): string => {
        const start = entry.start ? projectStart(entry.start) : undefined;
        const finish =
            entry.start && entry.end
                ? entry.milestone
                    ? projectStart(entry.start)
                    : projectFinish(entry.end, entry.start, calendar)
                : undefined;
        const days =
            entry.start && entry.end && !entry.milestone ? workingDaysBetween(calendar, entry.start, entry.end) : 0;
        let xml =
            "<Task>" +
            el("UID", entry.uid) +
            el("ID", entry.uid) +
            el("Name", entry.name) +
            "<Active>1</Active><Manual>0</Manual><IsNull>0</IsNull>" +
            el("CreateDate", mspdiDate(now)) +
            el("WBS", entry.wbs) +
            el("OutlineNumber", entry.wbs) +
            el("OutlineLevel", entry.level) +
            el("Priority", Math.max(0, Math.min(1000, Math.round(entry.task?.priority ?? 500)))) +
            (start ? el("Start", mspdiDate(start)) : "") +
            (finish ? el("Finish", mspdiDate(finish)) : "") +
            el("Duration", mspdiDuration(days)) +
            `<DurationFormat>${FORMAT_DAYS}</DurationFormat>` +
            "<Estimated>0</Estimated>" +
            el("Milestone", entry.milestone ? 1 : 0) +
            el("Summary", entry.summary ? 1 : 0) +
            el("PercentComplete", Math.round(entry.progress ?? 0));
        const constraint = entry.task?.constraint;
        if (!entry.summary && constraint) {
            // 2.3: the task's own constraint, with dates in Project's working-day convention.
            const date = constraint.date
                ? constraint.type === "FNET" || constraint.type === "FNLT" || constraint.type === "MFO"
                    ? finishStamp(constraint.date, calendar)
                    : projectStart(constraint.date)
                : undefined;
            xml +=
                el("ConstraintType", MSPDI_CONSTRAINT[constraint.type]) +
                (date ? el("ConstraintDate", mspdiDate(date)) : "");
        } else if (!entry.summary && start) {
            // Start No Earlier Than the planned start: Project schedules the links, but never pulls a task earlier.
            xml += `<ConstraintType>4</ConstraintType>${el("ConstraintDate", mspdiDate(start))}`;
        }
        if (entry.task?.deadline) {
            xml += el("Deadline", mspdiDate(finishStamp(entry.task.deadline, calendar)));
        }
        if (entry.task?.fixedCost !== undefined) {
            xml +=
                el("FixedCost", Math.round(entry.task.fixedCost * MSPDI_CURRENCY)) +
                "<FixedCostAccrual>3</FixedCostAccrual>";
        }
        if (entry.task) {
            (incoming.get(entry.task.id) ?? []).forEach(link => {
                const from = uidOf.get(link.from);
                if (from === undefined) {
                    return;
                }
                const lag = mspdiLag(link.lag, calendar);
                xml +=
                    "<PredecessorLink>" +
                    el("PredecessorUID", from) +
                    el("Type", MSPDI_LINK_TYPE[linkType(link)]) +
                    "<CrossProject>0</CrossProject>" +
                    el("LinkLag", lag.value) +
                    el("LagFormat", lag.format) +
                    "</PredecessorLink>";
            });
            const task = entry.task;
            const baselineXml = (
                number: number,
                baselineStart: Date,
                baselineEnd: Date,
                cost: number | undefined
            ): string => {
                const baseDays = isMilestone({ ...task, start: baselineStart, end: baselineEnd })
                    ? 0
                    : workingDaysBetween(calendar, baselineStart, baselineEnd);
                return (
                    `<Baseline><Number>${number}</Number>` +
                    el("Start", mspdiDate(projectStart(baselineStart))) +
                    el(
                        "Finish",
                        mspdiDate(
                            baseDays === 0
                                ? projectStart(baselineStart)
                                : projectFinish(baselineEnd, baselineStart, calendar)
                        )
                    ) +
                    el("Duration", mspdiDuration(baseDays)) +
                    `<DurationFormat>${FORMAT_DAYS}</DurationFormat>` +
                    (cost !== undefined ? el("Cost", Math.round(cost * MSPDI_CURRENCY)) : "") +
                    "</Baseline>"
                );
            };
            const legacy = attributeBaseline(task);
            if (legacy) {
                xml += baselineXml(0, legacy.start, legacy.finish, undefined);
            }
            (task.baselines ?? []).forEach(baseline => {
                const number = baselineNumber.get(baseline.name);
                if (number !== undefined) {
                    xml += baselineXml(number, baseline.start, baseline.finish, baseline.cost);
                }
            });
        }
        return `${xml}</Task>`;
    };

    const summaryTask =
        "<Task><UID>0</UID><ID>0</ID>" +
        el("Name", options.name) +
        "<Active>1</Active><Manual>0</Manual><IsNull>0</IsNull>" +
        el("CreateDate", mspdiDate(now)) +
        "<WBS>0</WBS><OutlineNumber>0</OutlineNumber><OutlineLevel>0</OutlineLevel><Priority>500</Priority>" +
        el("Start", mspdiDate(first)) +
        el("Finish", mspdiDate(last)) +
        `<DurationFormat>${FORMAT_DAYS}</DurationFormat><Milestone>0</Milestone><Summary>1</Summary></Task>`;

    // Resources: one per person assigned (Assignments, else Assigned to), in name order, plus the
    // resources of the data source that have no work yet.
    const people = [
        ...new Set([
            ...tasks.flatMap(task => assignmentsOf(task).map(assignment => assignment.resource)),
            ...(options.resources ? [...options.resources.keys()] : [])
        ])
    ].sort((a, b) => a.localeCompare(b));
    const resourceUid = new Map(people.map((person, index) => [person, index + 1]));
    const resources = people
        .map(person => {
            const info = resourceInfo(person, options.resources);
            return (
                `<Resource>${el("UID", resourceUid.get(person))}${el("ID", resourceUid.get(person))}${el(
                    "Name",
                    person
                )}<Type>1</Type><IsNull>0</IsNull><MaxUnits>${(info.maxUnits / 100).toFixed(2)}</MaxUnits>` +
                (info.rate > 0 ? `${el("StandardRate", info.rate)}<StandardRateFormat>2</StandardRateFormat>` : "") +
                "</Resource>"
            );
        })
        .join("");
    let assignmentUid = 0;
    const assignments = list
        .filter(entry => entry.task && !entry.summary)
        .flatMap(entry =>
            assignmentsOf(entry.task!).map(assignment => {
                assignmentUid++;
                return (
                    `<Assignment>${el("UID", assignmentUid)}${el("TaskUID", entry.uid)}` +
                    `${el("ResourceUID", resourceUid.get(assignment.resource))}<Units>${units(
                        assignment.units
                    )}</Units></Assignment>`
                );
            })
        )
        .join("");

    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Project xmlns="http://schemas.microsoft.com/project">' +
        "<SaveVersion>14</SaveVersion>" +
        el("Name", options.name) +
        el("Title", options.name) +
        el("CreationDate", mspdiDate(now)) +
        "<ScheduleFromStart>1</ScheduleFromStart>" +
        el("StartDate", mspdiDate(first)) +
        el("FinishDate", mspdiDate(last)) +
        "<CalendarUID>1</CalendarUID>" +
        "<DefaultStartTime>08:00:00</DefaultStartTime><DefaultFinishTime>17:00:00</DefaultFinishTime>" +
        `<MinutesPerDay>${MINUTES_PER_DAY}</MinutesPerDay>` +
        el("MinutesPerWeek", MINUTES_PER_DAY * workingDaysPerWeek(calendar)) +
        "<DaysPerMonth>20</DaysPerMonth>" +
        calendarXml(calendar) +
        `<Tasks>${summaryTask}${list.map(taskXml).join("")}</Tasks>` +
        `<Resources>${resources}</Resources>` +
        `<Assignments>${assignments}</Assignments>` +
        "</Project>\n"
    );
}
