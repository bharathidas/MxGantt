import { ALL_DAYS, isWorkingDay, WorkCalendar } from "./calendar";
import { assignmentsOf, ResourceInfo, resourceInfo } from "./resources";
import { segmentSpans } from "./segments";
import { isMilestone, Task } from "./tasks";
import { addDays, DAY, startOfDay } from "./time";

/**
 * 2.3 cost and earned value management (EVM), with the definitions MS Project and the PMI use:
 *
 *   cost of a task    fixed cost + sum over assignments of units x work days x hours a day x rate
 *   BAC (budget)      the cost in the baseline shown (its stored cost, or the cost of its dates)
 *   PV  (BCWS)        BAC x the share of the baseline's working time before the status date
 *   EV  (BCWP)        BAC x % complete
 *   AC  (ACWP)        the Actual cost attribute, or the current cost x % complete without one
 *   CV = EV - AC      SV = EV - PV      CPI = EV / AC      SPI = EV / PV
 *   EAC = BAC / CPI   ETC = EAC - AC    VAC = BAC - EAC
 *
 * Working time is looked up in a prefix table of working days, so a plan of 5,000 tasks and its
 * S-curve take milliseconds even with a working calendar.
 */

export interface CostSettings {
    calendar?: WorkCalendar;
    resources?: ReadonlyMap<string, ResourceInfo>;
    /** Working hours in a day, for hourly rates. */
    hoursPerDay?: number;
}

export interface EarnedValue {
    bac: number;
    pv: number;
    ev: number;
    ac: number;
    cv: number;
    sv: number;
    cpi?: number;
    spi?: number;
    eac: number;
    etc: number;
    vac: number;
}

export interface PlanSpan {
    start: Date;
    finish: Date;
    cost?: number;
}

/**
 * Working time from a fixed origin, in working days, as a step function over local days: O(1) per
 * lookup after a one-off table over the range. Times outside the range fall back to slow counting.
 */
export class WorkClock {
    private readonly prefix: Float64Array;
    private readonly days: number[];

    constructor(calendar: WorkCalendar, from: Date, to: Date) {
        const start = startOfDay(from);
        const days: number[] = [];
        let day = start;
        const end = addDays(startOfDay(to), 2);
        for (let guard = 0; day < end && guard < 20000; guard++) {
            days.push(day.getTime());
            day = addDays(day, 1);
        }
        days.push(day.getTime());
        this.days = days;
        this.prefix = new Float64Array(days.length);
        for (let i = 1; i < days.length; i++) {
            this.prefix[i] = this.prefix[i - 1] + (isWorkingDay(calendar, new Date(days[i - 1])) ? 1 : 0);
        }
    }

    /** Working days from the origin to `date`, counting the covered part of a working day. */
    at(date: Date): number {
        const time = date.getTime();
        const days = this.days;
        if (time <= days[0]) {
            return 0;
        }
        if (time >= days[days.length - 1]) {
            return this.prefix[days.length - 1];
        }
        let low = 0;
        let high = days.length - 1;
        while (low < high - 1) {
            const mid = Math.floor((low + high) / 2);
            if (days[mid] <= time) {
                low = mid;
            } else {
                high = mid;
            }
        }
        const working = this.prefix[low + 1] - this.prefix[low];
        const part = (time - days[low]) / (days[low + 1] - days[low]);
        return this.prefix[low] + working * part;
    }

    between(start: Date, end: Date): number {
        return Math.max(0, this.at(end) - this.at(start));
    }

    static elapsed(start: Date, end: Date): number {
        return Math.max(0, (end.getTime() - start.getTime()) / DAY);
    }
}

function clockFor(tasks: Task[], calendar: WorkCalendar, extra: Date[] = []): WorkClock | undefined {
    if (!calendar.active) {
        return undefined;
    }
    let min = Infinity;
    let max = -Infinity;
    const see = (date: Date | undefined): void => {
        if (date) {
            min = Math.min(min, date.getTime());
            max = Math.max(max, date.getTime());
        }
    };
    tasks.forEach(task => {
        see(task.start);
        see(task.end);
        see(task.baselineStart);
        see(task.baselineEnd);
    });
    extra.forEach(see);
    if (!Number.isFinite(min)) {
        return undefined;
    }
    return new WorkClock(calendar, new Date(min), new Date(max));
}

function workBetween(clock: WorkClock | undefined, start: Date, end: Date): number {
    return clock ? clock.between(start, end) : WorkClock.elapsed(start, end);
}

/** Cost per working day of the task's assignments. */
export function dailyRate(task: Task, settings: CostSettings): number {
    const hours = settings.hoursPerDay ?? 8;
    return assignmentsOf(task).reduce(
        (sum, assignment) =>
            sum + (assignment.units / 100) * hours * resourceInfo(assignment.resource, settings.resources).rate,
        0
    );
}

/** The work days of a span (only the segments of a split task). */
function workOf(
    task: Task,
    span: { start: Date; end: Date },
    clock: WorkClock | undefined,
    calendar: WorkCalendar
): number {
    if (isMilestone({ ...task, start: span.start, end: span.end })) {
        return 0;
    }
    return segmentSpans({ start: span.start, end: span.end, segments: task.segments }, calendar).reduce(
        (sum, piece) => sum + workBetween(clock, piece.start, piece.end),
        0
    );
}

function costWith(
    task: Task,
    span: { start: Date; end: Date } | undefined,
    settings: CostSettings,
    clock?: WorkClock
): number {
    const calendar = settings.calendar ?? ALL_DAYS;
    const work = span ? workOf(task, span, clock, calendar) : 0;
    return (task.fixedCost ?? 0) + work * dailyRate(task, settings);
}

/** The task's cost as currently planned. */
export function taskCost(task: Task, settings: CostSettings, clock?: WorkClock): number {
    return round2(
        costWith(task, task.start && task.end ? { start: task.start, end: task.end } : undefined, settings, clock)
    );
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

/** Share of a span's working time before `at`, 0 to 1; milestones count once reached. */
function fractionAt(start: Date, finish: Date, at: Date, clock: WorkClock | undefined): number {
    if (at.getTime() <= start.getTime()) {
        return 0;
    }
    if (at.getTime() >= finish.getTime()) {
        return 1;
    }
    const total = workBetween(clock, start, finish);
    if (total <= 0) {
        return at.getTime() >= start.getTime() ? 1 : 0;
    }
    return Math.max(0, Math.min(1, workBetween(clock, start, at) / total));
}

/** The derived figures from summed BAC, PV, EV and AC (for a task, a group or the project). */
export function earnedFrom(bac: number, pv: number, ev: number, ac: number): EarnedValue {
    return derived(bac, pv, ev, ac);
}

function derived(bac: number, pv: number, ev: number, ac: number): EarnedValue {
    const cpi = ac > 0 ? ev / ac : undefined;
    const spi = pv > 0 ? ev / pv : undefined;
    // Without a cost index yet the remaining work is assumed to cost as budgeted.
    const eac = cpi && cpi > 0 ? bac / cpi : ac + Math.max(0, bac - ev);
    return {
        bac: round2(bac),
        pv: round2(pv),
        ev: round2(ev),
        ac: round2(ac),
        cv: round2(ev - ac),
        sv: round2(ev - pv),
        cpi: cpi === undefined ? undefined : Math.round(cpi * 100) / 100,
        spi: spi === undefined ? undefined : Math.round(spi * 100) / 100,
        eac: round2(eac),
        etc: round2(Math.max(0, eac - ac)),
        vac: round2(bac - eac)
    };
}

export interface TaskEv {
    value: EarnedValue;
    /** The schedule the budget was planned on (baseline or current). */
    plan?: { start: Date; finish: Date };
    current: number;
}

/**
 * Earned value of one task at the status date. `baseline` is the baseline shown (with its stored
 * cost when it has one); without a baseline the current plan is its own budget.
 */
export function taskEarnedValue(
    task: Task,
    statusDate: Date,
    settings: CostSettings,
    baseline?: PlanSpan,
    clock?: WorkClock
): TaskEv {
    const current = costWith(
        task,
        task.start && task.end ? { start: task.start, end: task.end } : undefined,
        settings,
        clock
    );
    const plan = baseline ?? (task.start && task.end ? { start: task.start, finish: task.end } : undefined);
    const bac =
        baseline?.cost ??
        (baseline ? costWith(task, { start: baseline.start, end: baseline.finish }, settings, clock) : current);
    const progress = Math.max(0, Math.min(100, task.progress ?? 0)) / 100;
    const pv = plan ? bac * fractionAt(plan.start, plan.finish, statusDate, clock) : 0;
    const ev = bac * progress;
    const ac = task.actualCost ?? current * progress;
    return { value: derived(bac, pv, ev, ac), plan: plan && { start: plan.start, finish: plan.finish }, current };
}

export interface ProjectEv extends EarnedValue {
    perTask: Map<string, EarnedValue>;
    /** Current cost per task. */
    costs: Map<string, number>;
    /** Sum of the current costs (the estimate if nothing else changes). */
    currentCost: number;
}

export function projectEarnedValue(
    tasks: Task[],
    statusDate: Date,
    settings: CostSettings,
    baselineOf: (task: Task) => PlanSpan | undefined
): ProjectEv {
    const calendar = settings.calendar ?? ALL_DAYS;
    const clock = clockFor(tasks, calendar, [statusDate]);
    let bac = 0;
    let pv = 0;
    let ev = 0;
    let ac = 0;
    let currentCost = 0;
    const perTask = new Map<string, EarnedValue>();
    const costs = new Map<string, number>();
    tasks.forEach(task => {
        const result = taskEarnedValue(task, statusDate, settings, baselineOf(task), clock);
        perTask.set(task.id, result.value);
        costs.set(task.id, round2(result.current));
        bac += result.value.bac;
        pv += result.value.pv;
        ev += result.value.ev;
        ac += result.value.ac;
        currentCost += result.current;
    });
    return { ...derived(bac, pv, ev, ac), perTask, costs, currentCost: round2(currentCost) };
}

// ---------------------------------------------------------------- S-curve

export interface SCurve {
    dates: Date[];
    /** Cumulative planned value (baseline), at every date. */
    pv: number[];
    /** Cumulative earned value and actual cost up to the status date (undefined after it). */
    ev: Array<number | undefined>;
    ac: Array<number | undefined>;
    statusDate: Date;
    bac: number;
    eac: number;
    /** Where the forecast line ends: the plan's current finish. */
    forecastFinish?: Date;
}

/**
 * Cumulative curves for the S-curve chart. PV follows the baseline schedule. No history of progress
 * is stored, so EV and AC up to the status date are reconstructed: each task's earned share is
 * spread over the part of its current schedule before the status date (work done ahead of schedule
 * shows at the status date). At the status date they equal the project's EV and AC exactly.
 */
export function sCurve(
    tasks: Task[],
    statusDate: Date,
    settings: CostSettings,
    baselineOf: (task: Task) => PlanSpan | undefined,
    maxPoints = 120
): SCurve | undefined {
    const calendar = settings.calendar ?? ALL_DAYS;
    const clock = clockFor(tasks, calendar, [statusDate]);
    const entries: Array<{ ev: TaskEv; current?: { start: Date; finish: Date }; ac: number }> = [];
    let min = Infinity;
    let max = -Infinity;
    let finish = -Infinity;
    tasks.forEach(task => {
        const ev = taskEarnedValue(task, statusDate, settings, baselineOf(task), clock);
        const current = task.start && task.end ? { start: task.start, finish: task.end } : undefined;
        entries.push({ ev, current, ac: ev.value.ac });
        [ev.plan?.start, ev.plan?.finish, current?.start, current?.finish].forEach(date => {
            if (date) {
                min = Math.min(min, date.getTime());
                max = Math.max(max, date.getTime());
            }
        });
        if (current) {
            finish = Math.max(finish, current.finish.getTime());
        }
    });
    if (!Number.isFinite(min) || max <= min) {
        return undefined;
    }
    min = Math.min(min, statusDate.getTime());
    const span = max - min;
    const step = Math.max(DAY, Math.ceil(span / DAY / maxPoints) * DAY);
    const dates: Date[] = [];
    for (let time = startOfDay(new Date(min)).getTime(); time < max + step; time += step) {
        dates.push(new Date(time));
        if (dates.length > maxPoints + 2) {
            break;
        }
    }
    // The status date itself is always a point, so the curves end exactly on EV and AC.
    if (statusDate.getTime() > dates[0].getTime() && statusDate.getTime() < dates[dates.length - 1].getTime()) {
        if (!dates.some(date => date.getTime() === statusDate.getTime())) {
            dates.push(new Date(statusDate.getTime()));
            dates.sort((a, b) => a.getTime() - b.getTime());
        }
    }
    const status = statusDate.getTime();
    const pv: number[] = [];
    const ev: Array<number | undefined> = [];
    const ac: Array<number | undefined> = [];
    dates.forEach(date => {
        let plannedValue = 0;
        let earned = 0;
        let actual = 0;
        const past = date.getTime() <= status;
        entries.forEach(entry => {
            const { value, plan } = entry.ev;
            if (plan) {
                plannedValue += value.bac * fractionAt(plan.start, plan.finish, date, clock);
            }
            if (past) {
                let share = 1;
                if (date.getTime() < status && entry.current) {
                    const doneBy = fractionAt(entry.current.start, entry.current.finish, statusDate, clock);
                    const reached = fractionAt(entry.current.start, entry.current.finish, date, clock);
                    share = doneBy > 0 ? Math.min(1, reached / doneBy) : 0;
                }
                earned += value.ev * share;
                actual += entry.ac * share;
            }
        });
        pv.push(round2(plannedValue));
        ev.push(past ? round2(earned) : undefined);
        ac.push(past ? round2(actual) : undefined);
    });
    let bac = 0;
    let evTotal = 0;
    let acTotal = 0;
    entries.forEach(entry => {
        bac += entry.ev.value.bac;
        evTotal += entry.ev.value.ev;
        acTotal += entry.ac;
    });
    const summary = derived(bac, 0, evTotal, acTotal);
    return {
        dates,
        pv,
        ev,
        ac,
        statusDate,
        bac: round2(bac),
        eac: summary.eac,
        forecastFinish: Number.isFinite(finish) ? new Date(finish) : undefined
    };
}
