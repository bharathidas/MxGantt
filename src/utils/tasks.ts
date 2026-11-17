import { addWorkingTime, ALL_DAYS, WorkCalendar, workingDaysBetween } from "./calendar";
import type { BaselineEntry } from "./baselines";
import type { Constraint } from "./constraints";
import { applyLag, Dependency, DepType, Lag, parseDependencies, violates } from "./deps";
import type { CellValue } from "./layout";
import type { Assignment } from "./resources";
import type { Segment } from "./segments";

/**
 * The chart's model, built from plain values so it can be tested without Mendix: tasks, the rows
 * they are laid out in (with group rows), the dependency links and the critical path.
 */

export interface Task {
    /** The object's guid. */
    id: string;
    name: string;
    /** Missing dates leave the task in the list without a bar. */
    start?: Date;
    end?: Date;
    /** 0-100, or undefined when there is no progress attribute. */
    progress?: number;
    group?: string;
    color?: string;
    milestone: boolean;
    key?: string;
    /** Keys of the predecessors. */
    deps: string[];
    editable: boolean;
    /** Typed dependencies with lags; when missing, `deps` are plain finish-to-start links. */
    dependencies?: Dependency[];
    /** The Depends on text as stored, which new links are added to. */
    depsText?: string;
    baselineStart?: Date;
    baselineEnd?: Date;
    /** Who does the work; several people are separated by commas. */
    assignee?: string;
    /** The texts of the configured extra grid columns, in order. */
    columns?: string[];
    /** The value of the Name attribute, for editing; undefined when the name cannot be edited. */
    nameValue?: string;
    /** 2.2: the date the task must be finished by. */
    deadline?: Date;

    // 2.3 - every field below is optional and only set when its attribute is configured.
    /** Resources with units, from the Assignments attribute. */
    assignments?: Assignment[];
    /** The Assignments text as stored. */
    assignmentsText?: string;
    /** Work segments of a split task (offsets from the start in working days); undefined when not split. */
    segments?: Segment[];
    segmentsText?: string;
    constraint?: Constraint;
    /** 0-1000 like MS Project; higher is levelled first (kept in place). */
    priority?: number;
    fixedCost?: number;
    actualCost?: number;
    /** Named baselines from the Baselines (JSON) attribute. */
    baselines?: BaselineEntry[];
    baselinesText?: string;
    /** The 2.0 Baseline start / end attributes, kept while another baseline is shown. */
    attrBaselineStart?: Date;
    attrBaselineEnd?: Date;
    /** Portfolio view: the project the task belongs to. */
    project?: string;

    // 1.1 custom fields - only set when the Task values attribute is configured.
    /** The values JSON as stored, which edits are made on. */
    fieldsText?: string;
    /** The values by field key. */
    fieldValues?: Record<string, string | number | boolean | string[]>;

    // 1.2 configured columns - only set when the Columns list has attribute columns or cell classes.
    /** The values, texts and cell classes by column key. */
    cells?: Record<string, CellValue>;

    // 1.3 portfolio timeline - only set when the matching property is configured.
    /** Short code shown before the name, such as a project number. */
    code?: string;
    /** Smaller second line under the name. */
    subtitle?: string;
    /** The Bar label text when Bar label is Custom. */
    barText?: string;
    /** Index into the Status colours list of the matched status. */
    state?: number;
}

export interface TaskRow {
    kind: "task";
    id: string;
    task: Task;
    /** 1 for tasks inside a group, so the list can indent them. */
    depth: number;
}

export interface GroupRow {
    kind: "group";
    id: string;
    name: string;
    /** 2.3 portfolio view: 0 for project rows and groups outside projects, 1 for a group inside a project. */
    level?: number;
    /** A project summary row in the portfolio view. */
    project?: boolean;
    start?: Date;
    end?: Date;
    progress?: number;
    collapsed: boolean;
    count: number;
}

export type Row = TaskRow | GroupRow;

export interface Link {
    from: string;
    to: string;
    /** The successor breaks the link: for finish to start, it starts before the predecessor ends. */
    conflict: boolean;
    /** Left out for finish to start, the default. */
    type?: DepType;
    lag?: Lag;
    /** 2.3: the two tasks belong to different projects. */
    cross?: boolean;
}

export function linkType(link: Pick<Link, "type">): DepType {
    return link.type ?? "FS";
}

/** "3, 5;7 8" -> ["3", "5", "7", "8"]: people type lists in all sorts of ways. */
export function parseKeys(text: string | undefined): string[] {
    if (!text) {
        return [];
    }
    return text
        .split(/[,;\s]+/)
        .map(part => part.trim())
        .filter(part => part.length > 0);
}

export function isMilestone(task: Task): boolean {
    return task.milestone || (!!task.start && !!task.end && task.start.getTime() === task.end.getTime());
}

/** Fills in a missing start or end from the other one, and swaps them when they are the wrong way round. */
export function normaliseDates(start: Date | undefined, end: Date | undefined): { start?: Date; end?: Date } {
    const s = start ?? end;
    const e = end ?? start;
    if (s && e && e < s) {
        return { start: e, end: s };
    }
    return { start: s, end: e };
}

export function groupId(name: string): string {
    return `group:${name}`;
}

function summarise(tasks: Task[]): Pick<GroupRow, "start" | "end" | "progress"> {
    let start: Date | undefined;
    let end: Date | undefined;
    let weighted = 0;
    let weight = 0;
    let plain = 0;
    let counted = 0;
    tasks.forEach(task => {
        if (task.start && (!start || task.start < start)) {
            start = task.start;
        }
        if (task.end && (!end || task.end > end)) {
            end = task.end;
        }
        if (task.progress !== undefined) {
            // Weigh by duration so a two-day task does not count as much as a two-month one.
            const duration = task.start && task.end ? task.end.getTime() - task.start.getTime() : 0;
            weighted += task.progress * duration;
            weight += duration;
            plain += task.progress;
            counted++;
        }
    });
    const progress = counted === 0 ? undefined : weight > 0 ? weighted / weight : plain / counted;
    return { start, end, progress: progress === undefined ? undefined : Math.round(progress) };
}

/**
 * Lays the tasks out in rows. A group row is placed where its first task appears and gathers all
 * of the group's tasks under it, so the data source's sort order is kept as far as grouping allows.
 */
export function buildRows(tasks: Task[], collapsed: ReadonlySet<string>): Row[] {
    const rows: Row[] = [];
    if (!isPortfolio(tasks)) {
        layoutGroups(tasks, collapsed, groupId, undefined, 0, rows);
        return rows;
    }
    // 2.3 portfolio view: a summary row per project with its groups and tasks one level down; tasks
    // without a project are laid out as before, in the order they appear.
    const byProject = new Map<string, Task[]>();
    const loose: Task[] = [];
    tasks.forEach(task => {
        if (task.project) {
            const list = byProject.get(task.project) ?? [];
            list.push(task);
            byProject.set(task.project, list);
        } else {
            loose.push(task);
        }
    });
    const looseRows: Row[] = [];
    layoutGroups(loose, collapsed, groupId, 0, 0, looseRows);
    const looseRowOf = new Map<string, Row[]>();
    let currentKey = "";
    looseRows.forEach(row => {
        if (row.kind === "group" || row.depth === 0) {
            currentKey = row.id;
        }
        const list = looseRowOf.get(currentKey) ?? [];
        list.push(row);
        looseRowOf.set(currentKey, list);
    });
    const placed = new Set<string>();
    tasks.forEach(task => {
        if (!task.project) {
            const key = task.group ? groupId(task.group) : task.id;
            if (!placed.has(key)) {
                placed.add(key);
                rows.push(...(looseRowOf.get(key) ?? []));
            }
            return;
        }
        const key = projectId(task.project);
        if (placed.has(key)) {
            return;
        }
        placed.add(key);
        const members = byProject.get(task.project) ?? [];
        const isCollapsed = collapsed.has(key);
        rows.push({
            kind: "group",
            id: key,
            name: task.project,
            level: 0,
            project: true,
            collapsed: isCollapsed,
            count: members.length,
            ...summarise(members)
        });
        if (!isCollapsed) {
            const project = task.project;
            layoutGroups(members, collapsed, name => nestedGroupId(project, name), 1, 1, rows);
        }
    });
    return rows;
}

/** Whether the tasks span projects, which switches the rows to the portfolio layout. */
export function isPortfolio(tasks: Task[]): boolean {
    return tasks.some(task => !!task.project);
}

export function projectId(name: string): string {
    return `project:${name}`;
}

export function nestedGroupId(project: string, name: string): string {
    return `group:${project}::${name}`;
}

/** The row id of the group a task sits in, in the layout its plan uses. */
export function groupRowId(task: Task): string | undefined {
    if (!task.group) {
        return undefined;
    }
    return task.project ? nestedGroupId(task.project, task.group) : groupId(task.group);
}

function layoutGroups(
    tasks: Task[],
    collapsed: ReadonlySet<string>,
    idOf: (name: string) => string,
    level: number | undefined,
    depth: number,
    rows: Row[]
): void {
    const byGroup = new Map<string, Task[]>();
    tasks.forEach(task => {
        if (task.group) {
            const list = byGroup.get(task.group) ?? [];
            list.push(task);
            byGroup.set(task.group, list);
        }
    });
    const placed = new Set<string>();
    tasks.forEach(task => {
        if (!task.group) {
            rows.push({ kind: "task", id: task.id, task, depth });
            return;
        }
        if (placed.has(task.group)) {
            return;
        }
        placed.add(task.group);
        const members = byGroup.get(task.group) ?? [];
        const id = idOf(task.group);
        const isCollapsed = collapsed.has(id);
        const row: GroupRow = {
            kind: "group",
            id,
            name: task.group,
            collapsed: isCollapsed,
            count: members.length,
            ...summarise(members)
        };
        if (level !== undefined) {
            row.level = level;
        }
        rows.push(row);
        if (!isCollapsed) {
            members.forEach(member => rows.push({ kind: "task", id: member.id, task: member, depth: depth + 1 }));
        }
    });
}

/**
 * Links from the Depends on keys, typed and with lags when written so ("3SS+2d"). Unknown keys and
 * self references are ignored; a key that matches a task exactly as written wins over reading it
 * as a key plus a type, so keys such as "A-1" keep working.
 */
export function buildLinks(tasks: Task[], calendar: WorkCalendar = ALL_DAYS): Link[] {
    const byKey = new Map<string, Task>();
    // 2.3 portfolio: keys are looked up in the task's own project first, so projects may reuse numbers.
    const byProjectKey = new Map<string, Task>();
    tasks.forEach(task => {
        if (task.key !== undefined && task.key !== "") {
            if (!byKey.has(task.key)) {
                byKey.set(task.key, task);
            }
            if (task.project) {
                const scoped = `${task.project}\u0000${task.key}`;
                if (!byProjectKey.has(scoped)) {
                    byProjectKey.set(scoped, task);
                }
            }
        }
    });
    const links: Link[] = [];
    const seen = new Set<string>();
    tasks.forEach(task => {
        const dependencies: Array<Pick<Dependency, "raw" | "key" | "type" | "lag">> =
            task.dependencies ?? task.deps.map(key => ({ raw: key, key, type: "FS" }));
        const lookup = (key: string): Task | undefined =>
            (task.project && byProjectKey.size > 0 ? byProjectKey.get(`${task.project}\u0000${key}`) : undefined) ??
            byKey.get(key);
        dependencies.forEach(dependency => {
            const exact = lookup(dependency.raw);
            const from = exact ?? lookup(dependency.key);
            if (!from || from.id === task.id || seen.has(`${from.id}>${task.id}`)) {
                return;
            }
            seen.add(`${from.id}>${task.id}`);
            const type: DepType = exact ? "FS" : dependency.type;
            const lag = exact ? undefined : dependency.lag;
            const conflict =
                !!from.start &&
                !!from.end &&
                !!task.start &&
                !!task.end &&
                violates(
                    type,
                    lag,
                    { start: from.start, end: from.end },
                    { start: task.start, end: task.end },
                    calendar
                );
            const link: Link = { from: from.id, to: task.id, conflict };
            if (type !== "FS") {
                link.type = type;
            }
            if (lag) {
                link.lag = lag;
            }
            if ((from.project || task.project) && from.project !== task.project) {
                link.cross = true;
            }
            links.push(link);
        });
    });
    return links;
}

/** A task with its Depends on text parsed, as the widget builds it. */
export function withDependencies(task: Task, text: string | undefined): Task {
    const dependencies = parseDependencies(text);
    return { ...task, depsText: text ?? "", dependencies, deps: dependencies.map(entry => entry.key) };
}

/**
 * The tasks on the critical path: those whose latest allowed start, working back from the plan's
 * end through the links (all four types, with their lags), is their actual start, so any delay
 * moves the end date. With a working calendar the latest dates are worked out in working days, so
 * a weekend between two tasks is not mistaken for slack. Tasks in a dependency cycle have no
 * meaningful latest start and are left out. The default tolerance of just over an hour absorbs a
 * daylight saving night inside a task's duration.
 */
export function criticalTasks(
    tasks: Task[],
    links: Link[],
    tolerance = 61 * 60000,
    calendar: WorkCalendar = ALL_DAYS
): Set<string> {
    const critical = new Set<string>();
    const pass = backwardPass(tasks, links, calendar);
    if (pass.links === 0) {
        return critical;
    }
    const { dated, latestStart } = pass;
    latestStart.forEach((latest, id) => {
        const start = dated.get(id)!.start!;
        const slack =
            calendar.active && latest > start.getTime()
                ? workingDaysBetween(calendar, start, new Date(latest), tolerance / (24 * 3600000)) * 24 * 3600000
                : latest - start.getTime();
        if (slack <= tolerance) {
            critical.add(id);
        }
    });
    return critical;
}

export interface BackwardPass {
    /** Tasks with both dates, by id. */
    dated: Map<string, Task>;
    /** Number of links between dated tasks. */
    links: number;
    /** Latest allowed start and finish (ms) of every dated task outside a dependency cycle. */
    latestStart: Map<string, number>;
    latestFinish: Map<string, number>;
}

/**
 * The backward pass of the critical path method: working back from the plan's end through the
 * links (all four types with their lags, in working time with a calendar), the latest each task may
 * start and finish without moving the end of the plan. Shared by the critical path and total float.
 */
export function backwardPass(tasks: Task[], links: Link[], calendar: WorkCalendar = ALL_DAYS): BackwardPass {
    const dated = new Map<string, Task>();
    tasks.forEach(task => {
        if (task.start && task.end) {
            dated.set(task.id, task);
        }
    });
    const usable = links.filter(link => dated.has(link.from) && dated.has(link.to));
    let projectEnd = -Infinity;
    dated.forEach(task => {
        projectEnd = Math.max(projectEnd, task.end!.getTime());
    });

    // Kahn's algorithm from the end: a task is ready once all of its successors are done.
    const outgoing = new Map<string, Link[]>();
    const incoming = new Map<string, Link[]>();
    const pending = new Map<string, number>();
    dated.forEach((_, id) => {
        outgoing.set(id, []);
        incoming.set(id, []);
        pending.set(id, 0);
    });
    usable.forEach(link => {
        outgoing.get(link.from)!.push(link);
        incoming.get(link.to)!.push(link);
        pending.set(link.from, pending.get(link.from)! + 1);
    });
    const queue = [...dated.keys()].filter(id => pending.get(id) === 0);
    const latestStart = new Map<string, number>();
    const latestFinish = new Map<string, number>();
    // The queue grows while it is walked; an array iterator picks up the added entries.
    for (const id of queue) {
        const task = dated.get(id)!;
        const length = workingDaysBetween(calendar, task.start!, task.end!);
        let finish = projectEnd;
        outgoing.get(id)!.forEach(link => {
            const type = linkType(link);
            const anchor = type === "FS" || type === "SS" ? latestStart.get(link.to)! : latestFinish.get(link.to)!;
            const bound = applyLag(new Date(anchor), link.lag, calendar, -1);
            // SS and SF bound the predecessor's start; turn that into a bound on its finish.
            const asFinish = type === "SS" || type === "SF" ? addWorkingTime(calendar, bound, length) : bound;
            finish = Math.min(finish, asFinish.getTime());
        });
        latestFinish.set(id, finish);
        latestStart.set(id, addWorkingTime(calendar, new Date(finish), -length).getTime());
        incoming.get(id)!.forEach(link => {
            const left = pending.get(link.from)! - 1;
            pending.set(link.from, left);
            if (left === 0) {
                queue.push(link.from);
            }
        });
    }
    return { dated, links: usable.length, latestStart, latestFinish };
}

export function taskBounds(tasks: Task[]): { min?: Date; max?: Date } {
    let min: Date | undefined;
    let max: Date | undefined;
    tasks.forEach(task => {
        if (task.start && (!min || task.start < min)) {
            min = task.start;
        }
        if (task.end && (!max || task.end > max)) {
            max = task.end;
        }
        if (task.baselineStart && (!min || task.baselineStart < min)) {
            min = task.baselineStart;
        }
        if (task.baselineEnd && (!max || task.baselineEnd > max)) {
            max = task.baselineEnd;
        }
    });
    return { min, max };
}

/** Which row shows a task: its own, or its group's row when the group is collapsed. */
export function rowIndexOf(rows: Row[], tasks: Map<string, Task>): Map<string, number> {
    const index = new Map<string, number>();
    rows.forEach((row, i) => index.set(row.id, i));
    tasks.forEach(task => {
        if (index.has(task.id)) {
            return;
        }
        // Hidden in a collapsed group: its group row; in a collapsed project: the project row.
        const candidates = [
            task.project && task.group ? nestedGroupId(task.project, task.group) : undefined,
            task.project ? projectId(task.project) : undefined,
            task.group ? groupId(task.group) : undefined
        ];
        for (const candidate of candidates) {
            const row = candidate === undefined ? undefined : index.get(candidate);
            if (row !== undefined) {
                index.set(task.id, row);
                return;
            }
        }
    });
    return index;
}

export function clampProgress(value: number): number {
    return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * How far the end is from the baseline end, in (working) days: positive when late, negative when
 * early. Undefined without a baseline.
 */
export function variance(task: Task, calendar: WorkCalendar = ALL_DAYS): number | undefined {
    if (!task.end || !task.baselineEnd) {
        return undefined;
    }
    return workingDaysBetween(calendar, task.baselineEnd, task.end);
}

/**
 * Late: unfinished work whose end has passed, or work that ends after its baseline end.
 */
export function isLate(task: Task, now: Date, calendar: WorkCalendar = ALL_DAYS): boolean {
    if (!task.end) {
        return false;
    }
    // Without a progress attribute there is no telling whether past work is done.
    const unfinished = task.progress !== undefined && task.progress < 100;
    if (unfinished && task.end.getTime() < now.getTime()) {
        return true;
    }
    const behind = variance(task, calendar);
    return behind !== undefined && behind > 0;
}
