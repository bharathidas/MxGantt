import { isWorkingDay, WorkCalendar } from "./calendar";
import { isMilestone, Task } from "./tasks";
import { addDays, startOfDay, startOfWeek } from "./time";

/**
 * Resource workload: how many tasks each person has on each working day, and per bucket (day or
 * week) the busiest day, so over-allocation shows up however far the chart is zoomed out.
 *
 * Built with a difference array per person, so 5,000 tasks over a year take a few milliseconds.
 */

/** "Anna, Ben; Chris" -> ["Anna", "Ben", "Chris"]. */
export function splitAssignees(text: string | undefined): string[] {
    if (!text) {
        return [];
    }
    return [
        ...new Set(
            text
                .split(/[,;]+/)
                .map(part => part.trim())
                .filter(part => part.length > 0)
        )
    ];
}

export type BucketSize = "day" | "week";

export interface WorkloadBucket {
    start: Date;
    end: Date;
    /** The most tasks on any working day in the bucket. */
    peak: number;
    /** Working days in the bucket above capacity. */
    over: number;
}

export interface ResourceLoad {
    name: string;
    buckets: WorkloadBucket[];
    peak: number;
    /** Working days above capacity over the whole range. */
    overDays: number;
}

/** Index of the last day start that is <= time, by binary search. */
function dayIndexOf(days: number[], time: number): number {
    let low = 0;
    let high = days.length - 1;
    if (time < days[0]) {
        return -1;
    }
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

export function workload(
    tasks: Task[],
    from: Date,
    to: Date,
    bucket: BucketSize,
    calendar: WorkCalendar,
    capacity: number,
    unassigned?: string
): ResourceLoad[] {
    // Day starts over the range, stepping with addDays so every entry is a local midnight.
    const days: number[] = [];
    let day = startOfDay(from);
    for (let guard = 0; day < to && guard < 5000; guard++) {
        days.push(day.getTime());
        day = addDays(day, 1);
    }
    if (days.length === 0) {
        return [];
    }
    const working = days.map(time => isWorkingDay(calendar, new Date(time)));
    const diffs = new Map<string, Int32Array>();
    tasks.forEach(task => {
        if (!task.start || !task.end || isMilestone(task)) {
            return;
        }
        let names = splitAssignees(task.assignee);
        if (names.length === 0) {
            if (unassigned === undefined) {
                return;
            }
            names = [unassigned];
        }
        const first = Math.max(0, dayIndexOf(days, task.start.getTime()));
        // The end is exclusive: a task ending at midnight does not load the next day.
        const last = dayIndexOf(days, task.end.getTime() - 1);
        if (last < 0 || first > last || task.end.getTime() <= days[0]) {
            return;
        }
        names.forEach(name => {
            let diff = diffs.get(name);
            if (!diff) {
                diff = new Int32Array(days.length + 1);
                diffs.set(name, diff);
            }
            diff[first]++;
            diff[Math.min(days.length, last + 1)]--;
        });
    });
    const limit = Math.max(1, capacity);
    const result: ResourceLoad[] = [];
    [...diffs.keys()]
        .sort((a, b) => (a === unassigned ? 1 : b === unassigned ? -1 : a.localeCompare(b)))
        .forEach(name => {
            const diff = diffs.get(name)!;
            const buckets: WorkloadBucket[] = [];
            let running = 0;
            let peak = 0;
            let overDays = 0;
            let current: WorkloadBucket | undefined;
            days.forEach((time, index) => {
                running += diff[index];
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
                const load = working[index] ? running : 0;
                current.peak = Math.max(current.peak, load);
                if (load > limit) {
                    current.over++;
                    overDays++;
                }
                peak = Math.max(peak, load);
            });
            result.push({ name, buckets, peak, overDays });
        });
    return result;
}
