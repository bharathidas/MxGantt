import { ALL_DAYS, WorkCalendar, workingDaysBetween } from "./calendar";
import { EarnedValue } from "./cost";
import { missesDeadline } from "./plan";
import { expectedProgress, isBehind } from "./status";
import { isMilestone, Link, Task } from "./tasks";

/**
 * 2.3 portfolio view: one health line per project - its dates, duration-weighted progress against
 * plan, schedule and cost indices, and the risks (critical, behind, missed deadlines, over-allocated
 * work, links to other projects) - with an overall rating.
 */

export type HealthRating = "good" | "warning" | "bad";

export interface ProjectSummary {
    name: string;
    tasks: number;
    start?: Date;
    finish?: Date;
    baselineFinish?: Date;
    /** Forecast finish minus baseline finish in (working) days. */
    finishVariance?: number;
    complete?: number;
    planned?: number;
    spi?: number;
    cpi?: number;
    critical: number;
    behind: number;
    missed: number;
    overallocated: number;
    /** Links into or out of other projects. */
    crossLinks: number;
    rating: HealthRating;
}

export interface PortfolioContext {
    statusDate: Date;
    calendar?: WorkCalendar;
    critical?: ReadonlySet<string>;
    overallocated?: ReadonlySet<string>;
    links?: Link[];
    earned?: ReadonlyMap<string, EarnedValue>;
}

export function rate(summary: Omit<ProjectSummary, "rating">): HealthRating {
    const spi = summary.spi ?? 1;
    const cpi = summary.cpi ?? 1;
    if (spi < 0.85 || cpi < 0.85 || summary.missed > 0 || (summary.finishVariance ?? 0) > 5) {
        return "bad";
    }
    if (
        spi < 0.95 ||
        cpi < 0.95 ||
        summary.behind > 0 ||
        summary.overallocated > 0 ||
        (summary.finishVariance ?? 0) > 0
    ) {
        return "warning";
    }
    return "good";
}

export function projectSummaries(tasks: Task[], context: PortfolioContext): ProjectSummary[] {
    const calendar = context.calendar ?? ALL_DAYS;
    const byProject = new Map<string, Task[]>();
    tasks.forEach(task => {
        if (task.project) {
            const list = byProject.get(task.project) ?? [];
            list.push(task);
            byProject.set(task.project, list);
        }
    });
    const projectOf = new Map(tasks.map(task => [task.id, task.project]));
    const cross = new Map<string, number>();
    (context.links ?? []).forEach(link => {
        if (!link.cross) {
            return;
        }
        [projectOf.get(link.from), projectOf.get(link.to)].forEach(project => {
            if (project) {
                cross.set(project, (cross.get(project) ?? 0) + 1);
            }
        });
    });
    const result: ProjectSummary[] = [];
    byProject.forEach((list, name) => {
        let start: number | undefined;
        let finish: number | undefined;
        let baselineFinish: number | undefined;
        let weight = 0;
        let earned = 0;
        let planned = 0;
        let hasProgress = false;
        let behind = 0;
        let missed = 0;
        let critical = 0;
        let overallocated = 0;
        let ev = 0;
        let pv = 0;
        let ac = 0;
        let hasCost = false;
        list.forEach(task => {
            if (context.critical?.has(task.id)) {
                critical++;
            }
            if (context.overallocated?.has(task.id)) {
                overallocated++;
            }
            const value = context.earned?.get(task.id);
            if (value) {
                ev += value.ev;
                pv += value.pv;
                ac += value.ac;
                hasCost = hasCost || value.bac > 0;
            }
            if (!task.start || !task.end) {
                return;
            }
            start = Math.min(start ?? Infinity, task.start.getTime());
            finish = Math.max(finish ?? -Infinity, task.end.getTime());
            if (task.baselineEnd) {
                baselineFinish = Math.max(baselineFinish ?? -Infinity, task.baselineEnd.getTime());
            }
            if (missesDeadline(task)) {
                missed++;
            }
            if (task.progress === undefined) {
                return;
            }
            hasProgress = true;
            const length = Math.max(0.5, isMilestone(task) ? 0.5 : workingDaysBetween(calendar, task.start, task.end));
            weight += length;
            earned += (length * task.progress) / 100;
            planned += (length * (expectedProgress(task, context.statusDate, calendar) ?? 0)) / 100;
            if (isBehind(task, context.statusDate, calendar)) {
                behind++;
            }
        });
        const summary: Omit<ProjectSummary, "rating"> = {
            name,
            tasks: list.length,
            start: start === undefined ? undefined : new Date(start),
            finish: finish === undefined ? undefined : new Date(finish),
            baselineFinish: baselineFinish === undefined ? undefined : new Date(baselineFinish),
            critical,
            behind,
            missed,
            overallocated,
            crossLinks: cross.get(name) ?? 0
        };
        if (hasProgress && weight > 0) {
            summary.complete = Math.round((earned / weight) * 1000) / 10;
            summary.planned = Math.round((planned / weight) * 1000) / 10;
            summary.spi = planned > 0 ? Math.round((earned / planned) * 100) / 100 : undefined;
        }
        if (hasCost) {
            // With costs, the cost-weighted indices are the better measure.
            summary.spi = pv > 0 ? Math.round((ev / pv) * 100) / 100 : summary.spi;
            summary.cpi = ac > 0 ? Math.round((ev / ac) * 100) / 100 : undefined;
        }
        if (summary.finish && summary.baselineFinish) {
            const late = summary.finish >= summary.baselineFinish;
            const days = workingDaysBetween(
                calendar,
                late ? summary.baselineFinish : summary.finish,
                late ? summary.finish : summary.baselineFinish
            );
            summary.finishVariance = Math.round((late ? days : -days) * 10) / 10;
        }
        result.push({ ...summary, rating: rate(summary) });
    });
    return result;
}
