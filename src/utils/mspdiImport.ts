import { BaselineEntry, formatBaselines } from "./baselines";
import { addDays, startOfDay } from "./time";
import { ConstraintType, MSPDI_CONSTRAINT } from "./constraints";
import { dayKey, parseIsoDate } from "./calendar";
import { DepType, formatDependency, Lag } from "./deps";
import { formatAssignments } from "./resources";
import { MSPDI_CURRENCY } from "./planExport";

/**
 * 2.3 Microsoft Project XML (MSPDI) import. The file is read in the browser with DOMParser (which
 * never loads external entities or DTDs), checked, and turned into a plain JSON document that a
 * microflow imports with an import mapping - the widget itself never creates objects. Everything the
 * export writes comes back: tasks with outline levels (summary tasks become groups and, two levels
 * deep, projects), links with type and lag, the calendar, resources with units and rates,
 * assignments, all eleven baselines, constraints, deadlines, priorities and fixed costs.
 *
 * Dates follow the widget's convention: a start at the calendar's day start (08:00) becomes
 * midnight, a finish at its day end (17:00) becomes the following midnight.
 */

export const IMPORT_FORMAT = "mxgantt-mspdi-import";
/** Files larger than this are refused before parsing. */
export const MAX_IMPORT_BYTES = 30 * 1024 * 1024;
export const MAX_IMPORT_TASKS = 20000;

export interface ImportedTask {
    uid: number;
    /** The task's key for Depends on: its UID. */
    key: string;
    name: string;
    wbs?: string;
    outlineLevel: number;
    summary: boolean;
    milestone: boolean;
    start?: string;
    end?: string;
    progress: number;
    priority: number;
    constraintType?: ConstraintType;
    constraintDate?: string;
    deadline?: string;
    fixedCost?: number;
    /** Name of the summary task directly above (the widget's Group). */
    group?: string;
    /** Top-level summary task when summaries are nested (the widget's Project). */
    project?: string;
    parentUid?: number;
    /** Depends on text with UIDs as keys: "3, 5SS+2d". */
    dependsOn: string;
    /** Assignments text: "Ann:50, Bob". */
    assignments: string;
    /** Baseline 0 as Baseline start / end. */
    baselineStart?: string;
    baselineEnd?: string;
    /** Every baseline as the Baselines (JSON) attribute stores them. */
    baselines: string;
}

export interface ImportedResource {
    uid: number;
    name: string;
    /** Percent: 100 for one person. */
    maxUnits: number;
    /** Cost per hour. */
    rate: number;
}

export interface ImportedAssignment {
    taskUid: number;
    resourceUid: number;
    resource: string;
    units: number;
}

export interface ImportedPlan {
    format: typeof IMPORT_FORMAT;
    version: 1;
    name: string;
    start?: string;
    finish?: string;
    calendar: { name?: string; workingDays: string; holidays: string };
    tasks: ImportedTask[];
    resources: ImportedResource[];
    assignments: ImportedAssignment[];
    /** Counts for the preview. */
    stats: {
        tasks: number;
        summaries: number;
        links: number;
        skippedLinks: number;
        resources: number;
        assignments: number;
        baselines: number;
        constraints: number;
    };
}

export class ImportError extends Error {
    constructor(public readonly reason: "size" | "xml" | "notProject" | "tooMany" | "unsupported") {
        super(reason);
        this.name = "ImportError";
    }
}

const LINK_TYPES: Record<string, DepType> = { "0": "FF", "1": "FS", "2": "SF", "3": "SS" };

function children(parent: Element, name: string): Element[] {
    const result: Element[] = [];
    for (let node = parent.firstElementChild; node; node = node.nextElementSibling) {
        if (node.localName === name) {
            result.push(node);
        }
    }
    return result;
}

function child(parent: Element, name: string): Element | undefined {
    for (let node = parent.firstElementChild; node; node = node.nextElementSibling) {
        if (node.localName === name) {
            return node;
        }
    }
    return undefined;
}

function text(parent: Element, name: string): string | undefined {
    const value = child(parent, name)?.textContent?.trim();
    return value ? value : undefined;
}

function num(parent: Element, name: string): number | undefined {
    const value = text(parent, name);
    if (value === undefined) {
        return undefined;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}

/** "2026-10-05T08:00:00" as local time. */
export function parseMspdiDate(value: string | undefined): Date | undefined {
    const match = value && /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value);
    if (!match) {
        return undefined;
    }
    const [, y, m, d, h = "0", min = "0", s = "0"] = match;
    const date = new Date(Number(y), Number(m) - 1, Number(d), Number(h), Number(min), Number(s));
    return Number.isNaN(date.getTime()) ? undefined : date;
}

function minutesOf(time: string | undefined, fallback: number): number {
    const match = time && /^(\d{1,2}):(\d{2})/.exec(time);
    return match ? Number(match[1]) * 60 + Number(match[2]) : fallback;
}

function minutesInDay(date: Date): number {
    return date.getHours() * 60 + date.getMinutes();
}

/** Lag from MSPDI tenths of a minute and its format, in the widget's units. */
export function importLag(
    value: number,
    format: number,
    minutesPerDay: number,
    minutesPerWeek: number
): Lag | undefined {
    if (!value) {
        return undefined;
    }
    const base = format >= 35 ? format - 32 : format;
    const minutes = value / 10;
    let lag: Lag;
    if (base === 5 || base === 6) {
        lag = { amount: minutes / 60, unit: "h" };
    } else if (base === 9 || base === 10) {
        lag = { amount: minutes / minutesPerWeek, unit: "w" };
    } else if (base === 19 || base === 20) {
        // Percent lags have no equivalent; they are dropped.
        return undefined;
    } else {
        lag = { amount: minutes / minutesPerDay, unit: "d" };
    }
    lag.amount = Math.round(lag.amount * 100) / 100;
    return lag.amount === 0 ? undefined : lag;
}

function workingDaysText(working: boolean[]): string {
    // ISO numbers, Monday first: 1-5 style ranges where days are consecutive.
    const iso = [1, 2, 3, 4, 5, 6, 0].map((day, index) => (working[day] ? index + 1 : 0)).filter(Boolean);
    if (iso.length === 0) {
        return "";
    }
    const parts: string[] = [];
    let from = iso[0];
    let previous = iso[0];
    iso.slice(1).forEach(day => {
        if (day === previous + 1) {
            previous = day;
            return;
        }
        parts.push(from === previous ? String(from) : `${from}-${previous}`);
        from = day;
        previous = day;
    });
    parts.push(from === previous ? String(from) : `${from}-${previous}`);
    return parts.join(", ");
}

function holidayText(ranges: Array<{ from: Date; to: Date }>): string {
    return ranges
        .map(range => {
            const from = dayKey(range.from);
            const to = dayKey(range.to);
            return from === to ? from : `${from}..${to}`;
        })
        .join(", ");
}

function readCalendar(project: Element): ImportedPlan["calendar"] {
    const calendars = child(project, "Calendars");
    const list = calendars ? children(calendars, "Calendar") : [];
    const wanted = num(project, "CalendarUID");
    const calendar =
        list.find(entry => num(entry, "UID") === wanted) ??
        list.find(entry => text(entry, "IsBaseCalendar") === "1") ??
        list[0];
    const working = [false, true, true, true, true, true, false];
    const holidays: Array<{ from: Date; to: Date }> = [];
    if (!calendar) {
        return { workingDays: "1-5", holidays: "" };
    }
    const weekDays = child(calendar, "WeekDays");
    (weekDays ? children(weekDays, "WeekDay") : []).forEach(day => {
        const type = num(day, "DayType");
        const isWorking = text(day, "DayWorking") === "1";
        if (type !== undefined && type >= 1 && type <= 7) {
            working[type - 1] = isWorking;
        } else if (type === 0 && !isWorking) {
            const period = child(day, "TimePeriod");
            const from = parseMspdiDate(period && text(period, "FromDate"));
            const to = parseMspdiDate(period && text(period, "ToDate"));
            if (from && to) {
                holidays.push({ from: startOfDay(from), to: startOfDay(to) });
            }
        }
    });
    // MS Project 2007+ keeps non-working exceptions here.
    const exceptions = child(calendar, "Exceptions");
    (exceptions ? children(exceptions, "Exception") : []).forEach(exception => {
        if (text(exception, "DayWorking") === "1") {
            return;
        }
        const period = child(exception, "TimePeriod");
        const from = parseMspdiDate(period && text(period, "FromDate"));
        const to = parseMspdiDate(period && text(period, "ToDate"));
        if (from && to) {
            holidays.push({ from: startOfDay(from), to: startOfDay(to) });
        }
    });
    return { name: text(calendar, "Name"), workingDays: workingDaysText(working), holidays: holidayText(holidays) };
}

/**
 * Reads an MSPDI document. Throws ImportError for files that are not Project XML or too large.
 */
export function importMspdi(xml: string): ImportedPlan {
    if (xml.length > MAX_IMPORT_BYTES) {
        throw new ImportError("size");
    }
    if (typeof DOMParser === "undefined") {
        throw new ImportError("unsupported");
    }
    // A DOCTYPE could declare entities; Project files never have one, so refuse instead of expanding.
    if (/<!DOCTYPE/i.test(xml.slice(0, 2000)) || /<!ENTITY/i.test(xml)) {
        throw new ImportError("xml");
    }
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.getElementsByTagName("parsererror").length > 0) {
        throw new ImportError("xml");
    }
    const project = doc.documentElement;
    if (!project || project.localName !== "Project") {
        throw new ImportError("notProject");
    }
    const dayStart = minutesOf(text(project, "DefaultStartTime"), 8 * 60);
    const dayEnd = minutesOf(text(project, "DefaultFinishTime"), 17 * 60);
    const minutesPerDay = num(project, "MinutesPerDay") || 480;
    const minutesPerWeek = num(project, "MinutesPerWeek") || minutesPerDay * 5;

    const startOf = (value: string | undefined): Date | undefined => {
        const date = parseMspdiDate(value);
        return date && minutesInDay(date) <= dayStart ? startOfDay(date) : date;
    };
    const finishOf = (value: string | undefined): Date | undefined => {
        const date = parseMspdiDate(value);
        if (!date) {
            return undefined;
        }
        if (minutesInDay(date) >= dayEnd) {
            return addDays(startOfDay(date), 1);
        }
        return date;
    };
    const iso = (date: Date | undefined): string | undefined => date?.toISOString();

    const taskNodes = (() => {
        const tasks = child(project, "Tasks");
        return tasks ? children(tasks, "Task") : [];
    })();
    if (taskNodes.length > MAX_IMPORT_TASKS) {
        throw new ImportError("tooMany");
    }

    // Resources and assignments first, so tasks can carry their assignment text.
    const resourcesNode = child(project, "Resources");
    const resources: ImportedResource[] = [];
    (resourcesNode ? children(resourcesNode, "Resource") : []).forEach(node => {
        const uid = num(node, "UID");
        const name = text(node, "Name");
        if (uid === undefined || !name || text(node, "IsNull") === "1") {
            return;
        }
        resources.push({
            uid,
            name,
            maxUnits: Math.round((num(node, "MaxUnits") ?? 1) * 10000) / 100,
            rate: num(node, "StandardRate") ?? 0
        });
    });
    const resourceByUid = new Map(resources.map(resource => [resource.uid, resource]));
    const assignmentsNode = child(project, "Assignments");
    const assignments: ImportedAssignment[] = [];
    (assignmentsNode ? children(assignmentsNode, "Assignment") : []).forEach(node => {
        const taskUid = num(node, "TaskUID");
        const resourceUid = num(node, "ResourceUID");
        const resource = resourceUid === undefined ? undefined : resourceByUid.get(resourceUid);
        if (taskUid === undefined || !resource) {
            return;
        }
        assignments.push({
            taskUid,
            resourceUid: resource.uid,
            resource: resource.name,
            units: Math.round((num(node, "Units") ?? 1) * 10000) / 100
        });
    });
    const assignmentsByTask = new Map<number, ImportedAssignment[]>();
    assignments.forEach(assignment => {
        const list = assignmentsByTask.get(assignment.taskUid) ?? [];
        list.push(assignment);
        assignmentsByTask.set(assignment.taskUid, list);
    });

    // First pass: the tasks and the outline.
    interface Raw {
        node: Element;
        uid: number;
        name: string;
        level: number;
        summary: boolean;
    }
    const raws: Raw[] = [];
    taskNodes.forEach(node => {
        const uid = num(node, "UID");
        if (uid === undefined || text(node, "IsNull") === "1") {
            return;
        }
        const level = num(node, "OutlineLevel") ?? 1;
        if (uid === 0 && level === 0) {
            // The project summary task.
            return;
        }
        raws.push({
            node,
            uid,
            name: text(node, "Name") ?? "",
            level: Math.max(1, level),
            summary: text(node, "Summary") === "1"
        });
    });
    const nested = raws.some(raw => raw.summary && raw.level >= 2);
    const summaries = new Set(raws.filter(raw => raw.summary).map(raw => raw.uid));
    const stack: Raw[] = [];
    let links = 0;
    let skippedLinks = 0;
    let constraints = 0;
    const baselineNumbers = new Set<number>();
    const tasks: ImportedTask[] = raws.map(raw => {
        while (stack.length > 0 && stack[stack.length - 1].level >= raw.level) {
            stack.pop();
        }
        const parent = stack[stack.length - 1];
        const top = stack[0];
        if (raw.summary) {
            stack.push(raw);
        }
        const node = raw.node;
        const milestone = text(node, "Milestone") === "1";
        const start = startOf(text(node, "Start"));
        let end = milestone ? start : finishOf(text(node, "Finish"));
        if (start && end && end < start) {
            end = start;
        }
        const dependencies: string[] = [];
        children(node, "PredecessorLink").forEach(link => {
            const from = num(link, "PredecessorUID");
            if (from === undefined) {
                return;
            }
            if (summaries.has(from) || raw.summary) {
                skippedLinks++;
                return;
            }
            const type = LINK_TYPES[text(link, "Type") ?? "1"] ?? "FS";
            const lag = importLag(
                num(link, "LinkLag") ?? 0,
                num(link, "LagFormat") ?? 7,
                minutesPerDay,
                minutesPerWeek
            );
            dependencies.push(formatDependency({ key: String(from), type, lag }));
            links++;
        });
        const constraintNumber = num(node, "ConstraintType");
        const constraintType = (Object.keys(MSPDI_CONSTRAINT) as ConstraintType[]).find(
            type => MSPDI_CONSTRAINT[type] === constraintNumber
        );
        const constraintRaw = text(node, "ConstraintDate");
        const constraintDate =
            constraintType === "FNET" || constraintType === "FNLT" || constraintType === "MFO"
                ? finishOf(constraintRaw)
                : startOf(constraintRaw);
        if (constraintType && constraintType !== "ASAP" && !raw.summary) {
            constraints++;
        }
        const baselines: BaselineEntry[] = [];
        let baselineStart: Date | undefined;
        let baselineEnd: Date | undefined;
        children(node, "Baseline").forEach(baseline => {
            const number = num(baseline, "Number") ?? 0;
            const bStart = startOf(text(baseline, "Start"));
            const bDuration = text(baseline, "Duration");
            const zero = !!bDuration && /^PT0H0M0S$/.test(bDuration);
            const bEnd = zero ? bStart : finishOf(text(baseline, "Finish"));
            if (!bStart || !bEnd) {
                return;
            }
            baselineNumbers.add(number);
            const cost = num(baseline, "Cost");
            const entry: BaselineEntry = {
                name: number === 0 ? "Baseline" : `Baseline ${number}`,
                start: bStart,
                finish: bEnd < bStart ? bStart : bEnd
            };
            if (cost !== undefined) {
                entry.cost = cost / MSPDI_CURRENCY;
            }
            baselines.push(entry);
            if (number === 0) {
                baselineStart = entry.start;
                baselineEnd = entry.finish;
            }
        });
        baselines.sort((a, b) =>
            a.name === "Baseline"
                ? -1
                : b.name === "Baseline"
                ? 1
                : a.name.localeCompare(b.name, undefined, { numeric: true })
        );
        const fixedCost = num(node, "FixedCost");
        const task: ImportedTask = {
            uid: raw.uid,
            key: String(raw.uid),
            name: raw.name,
            wbs: text(node, "WBS") ?? text(node, "OutlineNumber"),
            outlineLevel: raw.level,
            summary: raw.summary,
            milestone,
            start: iso(start),
            end: iso(end),
            progress: Math.max(0, Math.min(100, num(node, "PercentComplete") ?? 0)),
            priority: num(node, "Priority") ?? 500,
            dependsOn: dependencies.join(", "),
            assignments: formatAssignments(
                (assignmentsByTask.get(raw.uid) ?? []).map(entry => ({ resource: entry.resource, units: entry.units }))
            ),
            baselines: formatBaselines(baselines)
        };
        if (constraintType) {
            task.constraintType = constraintType;
            if (constraintDate && constraintType !== "ASAP" && constraintType !== "ALAP") {
                task.constraintDate = iso(constraintDate);
            }
        }
        const deadline = finishOf(text(node, "Deadline"));
        if (deadline) {
            task.deadline = iso(deadline);
        }
        if (fixedCost) {
            task.fixedCost = fixedCost / MSPDI_CURRENCY;
        }
        if (baselineStart && baselineEnd) {
            task.baselineStart = iso(baselineStart);
            task.baselineEnd = iso(baselineEnd);
        }
        if (parent) {
            task.parentUid = parent.uid;
            if (!nested) {
                task.group = parent.name;
            } else {
                // Two summary levels: the top one is the project, the one directly above the group.
                task.project = top.name;
                if (parent !== top) {
                    task.group = parent.name;
                }
            }
        }
        return task;
    });

    const name = text(project, "Title") ?? text(project, "Name") ?? "";
    const startDate = startOf(text(project, "StartDate"));
    const finishDate = finishOf(text(project, "FinishDate"));
    const workTasks = tasks.filter(task => !task.summary);
    return {
        format: IMPORT_FORMAT,
        version: 1,
        name,
        start: iso(startDate),
        finish: iso(finishDate),
        calendar: readCalendar(project),
        tasks,
        resources,
        assignments,
        stats: {
            tasks: workTasks.length,
            summaries: tasks.length - workTasks.length,
            links,
            skippedLinks,
            resources: resources.length,
            assignments: assignments.length,
            baselines: baselineNumbers.size,
            constraints
        }
    };
}

/** Holidays text of an import as a set of yyyy-mm-dd keys, for tests and previews. */
export function holidayKeys(textValue: string): string[] {
    const keys: string[] = [];
    textValue
        .split(/[,\s]+/)
        .filter(Boolean)
        .forEach(part => {
            const [fromText, toText] = part.split("..");
            const from = parseIsoDate(fromText);
            const to = toText ? parseIsoDate(toText) : from;
            if (!from || !to) {
                return;
            }
            let day = from;
            for (let guard = 0; day <= to && guard < 1000; guard++) {
                keys.push(dayKey(day));
                day = addDays(day, 1);
            }
        });
    return keys;
}
