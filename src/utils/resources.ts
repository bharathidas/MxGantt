import { isWorkingDay, WorkCalendar } from "./calendar";
import { segmentSpans } from "./segments";
import { isMilestone, Task } from "./tasks";
import { addDays, DAY, startOfDay, startOfWeek } from "./time";
import { splitAssignees } from "./workload";

/**
 * 2.3 resources: assignments with units per task ("Ann:50, Bob" - Ann half time, Bob full time),
 * the resources themselves (maximum units and cost rate, from an optional data source), and the
 * resource usage histogram with over-allocation: for every resource and working day the sum of the
 * units of the tasks it works on, against its maximum units.
 */

export interface Assignment {
    resource: string;
    /** Percent of the resource's time: 100 is full time, 50 half time. */
    units: number;
}

export interface ResourceInfo {
    name: string;
    /** Percent the resource can give at most at once; 100 for one person, 300 for a team of three. */
    maxUnits: number;
    /** Cost per hour of work. */
    rate: number;
}

export const DEFAULT_UNITS = 100;
const MAX_UNITS = 10000;

/** "Ann:50", "Ann [50%]", "Ann (50%)", "Ann 50%" or plain "Ann". */
const UNIT_FORMS = [
    /^(.+?)\s*:\s*(\d+(?:[.,]\d+)?)\s*%?$/,
    /^(.+?)\s*[[(]\s*(\d+(?:[.,]\d+)?)\s*%?\s*[\])]$/,
    /^(.+?)\s+(\d+(?:[.,]\d+)?)\s*%$/
];

function parseOne(part: string): Assignment | "invalid" | undefined {
    const text = part.trim();
    if (!text) {
        return undefined;
    }
    for (const form of UNIT_FORMS) {
        const match = form.exec(text);
        if (match) {
            const units = Number(match[2].replace(",", "."));
            if (!Number.isFinite(units) || units < 0 || units > MAX_UNITS) {
                return "invalid";
            }
            return { resource: match[1].trim(), units };
        }
    }
    if (/[:[\]()%]/.test(text)) {
        return "invalid";
    }
    return { resource: text, units: DEFAULT_UNITS };
}

/** The assignments in a stored text. Entries for the same resource are added up. */
export function parseAssignments(text: string | undefined): Assignment[] {
    if (!text) {
        return [];
    }
    const result: Assignment[] = [];
    text.split(/[,;\n]+/).forEach(part => {
        const entry = parseOne(part);
        if (!entry || entry === "invalid" || !entry.resource) {
            return;
        }
        const existing = result.find(candidate => candidate.resource === entry.resource);
        if (existing) {
            existing.units = Math.min(MAX_UNITS, existing.units + entry.units);
        } else {
            result.push(entry);
        }
    });
    return result;
}

/** The entries of an assignment text the parser could not read, for validation messages. */
export function invalidAssignments(text: string): string[] {
    return text
        .split(/[,;\n]+/)
        .map(part => part.trim())
        .filter(part => part.length > 0 && parseOne(part) === "invalid");
}

function units(value: number): string {
    return String(Math.round(value * 100) / 100);
}

/** "Ann:50, Bob": full-time units are left out, as people write them. */
export function formatAssignments(list: Assignment[]): string {
    return list
        .map(entry => (entry.units === DEFAULT_UNITS ? entry.resource : `${entry.resource}:${units(entry.units)}`))
        .join(", ");
}

/** A task's assignments: the Assignments attribute, or everyone in Assigned to at full time. */
export function assignmentsOf(task: Pick<Task, "assignments" | "assignee">): Assignment[] {
    if (task.assignments && task.assignments.length > 0) {
        return task.assignments;
    }
    return splitAssignees(task.assignee).map(resource => ({ resource, units: DEFAULT_UNITS }));
}

export function resourceInfo(name: string, resources: ReadonlyMap<string, ResourceInfo> | undefined): ResourceInfo {
    return resources?.get(name) ?? { name, maxUnits: DEFAULT_UNITS, rate: 0 };
}

// ---------------------------------------------------------------- usage

export type UsageBucketSize = "day" | "week";

export interface UsageBucket {
    start: Date;
    end: Date;
    /** Highest total units on a working day in the bucket. */
    peak: number;
    /** Working days in the bucket above the maximum units. */
    over: number;
}

export interface ResourceUsage {
    name: string;
    maxUnits: number;
    buckets: UsageBucket[];
    peak: number;
    overDays: number;
    /** Busiest share of the maximum, in percent (peak / max units). */
    utilisation: number;
    /** Average load over the working days of the range, in percent of the maximum. */
    average: number;
}

export interface UsageResult {
    resources: ResourceUsage[];
    /** Tasks that work on a day their resource is over-allocated, with the resources and days. */
    overallocated: Map<string, Array<{ resource: string; days: number }>>;
}

/** Index of the last day start that is <= time, by binary search; -1 before the first. */
function dayIndexOf(days: number[], time: number): number {
    if (days.length === 0 || time < days[0]) {
        return -1;
    }
    let low = 0;
    let high = days.length - 1;
    while (low < high) {
        const mid = Math.floor((low + high + 1) / 2);
        if (days[mid] <= time) {
            low = mid;
        } else {
            high = mid - 1;
        }
    }
    return low;
}

const MAX_RANGE_DAYS = 5000;

/**
 * Resource usage over [from, to): per resource and working day the sum of the assignment units of
 * the tasks working that day (only on their segments for split tasks), bucketed by day or week with
 * the busiest day per bucket. Built with difference arrays, so 5,000 tasks over two years take a
 * few milliseconds. Resources from the data source without any assignment are listed with zero load.
 */
export function resourceUsage(
    tasks: Task[],
    from: Date,
    to: Date,
    bucket: UsageBucketSize,
    calendar: WorkCalendar,
    resources?: ReadonlyMap<string, ResourceInfo>
): UsageResult {
    const days: number[] = [];
    let day = startOfDay(from);
    for (let guard = 0; day < to && guard < MAX_RANGE_DAYS; guard++) {
        days.push(day.getTime());
        day = addDays(day, 1);
    }
    const overallocated = new Map<string, Array<{ resource: string; days: number }>>();
    if (days.length === 0) {
        return { resources: [], overallocated };
    }
    const working = days.map(time => isWorkingDay(calendar, new Date(time)));
    const diffs = new Map<string, Float64Array>();
    const ranges: Array<{ task: string; resource: string; first: number; last: number }> = [];
    const diffOf = (name: string): Float64Array => {
        let diff = diffs.get(name);
        if (!diff) {
            diff = new Float64Array(days.length + 1);
            diffs.set(name, diff);
        }
        return diff;
    };
    resources?.forEach((_, name) => diffOf(name));
    tasks.forEach(task => {
        if (!task.start || !task.end || isMilestone(task)) {
            return;
        }
        const assignments = assignmentsOf(task);
        if (assignments.length === 0) {
            return;
        }
        segmentSpans(task, calendar).forEach(piece => {
            const first = Math.max(0, dayIndexOf(days, piece.start.getTime()));
            // The end is exclusive: a piece ending at midnight does not load the next day.
            const last = dayIndexOf(days, piece.end.getTime() - 1);
            if (last < 0 || first > last || piece.end.getTime() <= days[0]) {
                return;
            }
            assignments.forEach(assignment => {
                if (assignment.units <= 0) {
                    return;
                }
                const diff = diffOf(assignment.resource);
                diff[first] += assignment.units;
                diff[Math.min(days.length, last + 1)] -= assignment.units;
                ranges.push({ task: task.id, resource: assignment.resource, first, last });
            });
        });
    });

    const overPrefix = new Map<string, Int32Array>();
    const result: ResourceUsage[] = [];
    [...diffs.keys()]
        .sort((a, b) => a.localeCompare(b))
        .forEach(name => {
            const diff = diffs.get(name)!;
            const max = Math.max(1, resourceInfo(name, resources).maxUnits);
            const prefix = new Int32Array(days.length + 1);
            const buckets: UsageBucket[] = [];
            let running = 0;
            let peak = 0;
            let overDays = 0;
            let total = 0;
            let workDays = 0;
            let current: UsageBucket | undefined;
            days.forEach((time, index) => {
                running += diff[index];
                // Float sums of 33.3 + 66.7 should still read as 100.
                const load = working[index] ? Math.round(running * 1000) / 1000 : 0;
                const date = new Date(time);
                const bucketStart = bucket === "day" ? date : startOfWeek(date);
                if (!current || current.start.getTime() !== bucketStart.getTime()) {
                    current = {
                        start: bucketStart,
                        end: addDays(bucketStart, bucket === "day" ? 1 : 7),
                        peak: 0,
                        over: 0
                    };
                    buckets.push(current);
                }
                current.peak = Math.max(current.peak, load);
                const over = load > max + 1e-6;
                if (over) {
                    current.over++;
                    overDays++;
                }
                if (working[index]) {
                    total += load;
                    workDays++;
                }
                prefix[index + 1] = prefix[index] + (over ? 1 : 0);
                peak = Math.max(peak, load);
            });
            overPrefix.set(name, prefix);
            result.push({
                name,
                maxUnits: max,
                buckets,
                peak,
                overDays,
                utilisation: Math.round((peak / max) * 100),
                average: workDays > 0 ? Math.round((total / workDays / max) * 100) : 0
            });
        });

    ranges.forEach(range => {
        const prefix = overPrefix.get(range.resource);
        if (!prefix) {
            return;
        }
        const count = prefix[range.last + 1] - prefix[range.first];
        if (count > 0) {
            const list = overallocated.get(range.task) ?? [];
            const existing = list.find(entry => entry.resource === range.resource);
            if (existing) {
                existing.days += count;
            } else {
                list.push({ resource: range.resource, days: count });
            }
            overallocated.set(range.task, list);
        }
    });
    return { resources: result, overallocated };
}

/** Whole days between two local midnights, safe across daylight saving changes. */
export function dayNumber(date: Date, base: Date): number {
    return Math.round((startOfDay(date).getTime() - startOfDay(base).getTime()) / DAY);
}
