import { dateToX, TimeScale } from "./time";

/**
 * Where things go on the timeline. The live chart and the image export both use these, so a
 * saved PNG looks like what is on screen.
 */

export const HEADER_ROW = 26;
export const HEADER_HEIGHT = HEADER_ROW * 2;
const MIN_BAR = 3;

export interface BarBox {
    x: number;
    width: number;
    /** Offset from the top of the row. */
    top: number;
    height: number;
}

export function barBox(start: Date, end: Date, scale: TimeScale, rowHeight: number, kind: "task" | "group"): BarBox {
    const x = dateToX(start, scale);
    // A bar never shrinks below a few pixels, or a one-hour task at quarter zoom would vanish.
    const width = Math.max(MIN_BAR, dateToX(end, scale) - x);
    const height = kind === "group" ? Math.round(rowHeight * 0.3) : Math.round(rowHeight * 0.58);
    return { x, width, top: Math.round((rowHeight - height) / 2), height };
}

export function milestoneBox(date: Date, scale: TimeScale, rowHeight: number): BarBox {
    const size = Math.round(rowHeight * 0.46);
    return { x: dateToX(date, scale) - size / 2, width: size, top: Math.round((rowHeight - size) / 2), height: size };
}

export interface Point {
    x: number;
    y: number;
}

/**
 * A finish-to-start arrow from the end of one bar to the start of another. When the successor
 * starts far enough to the right the line turns down once; otherwise it has to double back,
 * running along the gap between the rows so it does not cut through either bar.
 */
export function linkPath(from: Point, to: Point, rowHeight: number, type: "FS" | "SS" | "FF" | "SF" = "FS"): string {
    const gap = 8;
    const down = to.y >= from.y ? 1 : -1;
    const laneY = from.y + (down * rowHeight) / 2;
    switch (type) {
        case "SS": {
            // Out of the left of the predecessor, into the left of the successor.
            const x = Math.min(from.x, to.x) - gap;
            return `M ${from.x} ${from.y} H ${x} V ${to.y} H ${to.x}`;
        }
        case "FF": {
            // Out of the right of the predecessor, into the right of the successor.
            const x = Math.max(from.x, to.x) + gap;
            return `M ${from.x} ${from.y} H ${x} V ${to.y} H ${to.x}`;
        }
        case "SF": {
            // Out of the left of the predecessor, into the right of the successor.
            if (from.x - to.x >= gap * 2) {
                return `M ${from.x} ${from.y} H ${from.x - gap} V ${to.y} H ${to.x}`;
            }
            return `M ${from.x} ${from.y} H ${from.x - gap} V ${laneY} H ${to.x + gap} V ${to.y} H ${to.x}`;
        }
        default:
            if (to.x - from.x >= gap * 2) {
                const midX = from.x + gap;
                return `M ${from.x} ${from.y} H ${midX} V ${to.y} H ${to.x}`;
            }
            return `M ${from.x} ${from.y} H ${from.x + gap} V ${laneY} H ${to.x - gap} V ${to.y} H ${to.x}`;
    }
}

/**
 * Where a link leaves its predecessor and enters its successor: finish-to-start leaves the end
 * and enters the start, SS uses both starts, FF both ends and SF the start and the end.
 */
export function linkEnds(type: "FS" | "SS" | "FF" | "SF"): { from: "start" | "end"; to: "start" | "end" } {
    return {
        from: type === "SS" || type === "SF" ? "start" : "end",
        to: type === "FF" || type === "SF" ? "end" : "start"
    };
}

/** The thin baseline bar under a task bar. */
export function baselineBox(start: Date, end: Date, scale: TimeScale, rowHeight: number): BarBox {
    const bar = barBox(start, end, scale, rowHeight, "task");
    const height = Math.max(3, Math.round(rowHeight * 0.1));
    return { x: bar.x, width: bar.width, top: Math.min(rowHeight - height - 1, bar.top + bar.height + 2), height };
}

/** The visible slice of rows, with some overscan so fast scrolling does not show gaps. */
export function visibleRange(
    scrollTop: number,
    viewportHeight: number,
    rowHeight: number,
    count: number,
    overscan = 6
): { first: number; last: number } {
    const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const last = Math.min(count, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan);
    return { first, last: Math.max(first, last) };
}
