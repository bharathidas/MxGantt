import { applyDrag, keyEdit, sameSchedule, shift, unitsFor } from "../drag";
import { linkPath, visibleRange } from "../geometry";

const at = (day: number, hour = 0): Date => new Date(2026, 9, day, hour);
const original = { start: at(5), end: at(8), progress: 40 };

describe("dragging", () => {
    it("counts whole snap units", () => {
        expect(unitsFor(59, 40, "day")).toBe(1);
        expect(unitsFor(-61, 40, "day")).toBe(-2);
        expect(unitsFor(-10, 40, "day")).toBe(0);
        expect(Object.is(unitsFor(-10, 40, "day"), 0)).toBe(true);
        expect(unitsFor(9, 72, "hour")).toBe(3);
    });

    it("moves keeping the duration", () => {
        const moved = applyDrag("move", original, 80, 40, "day");
        expect(moved.start).toEqual(at(7));
        expect(moved.end).toEqual(at(10));
        expect(moved.progress).toBe(40);
    });

    it("resizes either end without crossing the other", () => {
        expect(applyDrag("end", original, 40, 40, "day").end).toEqual(at(9));
        expect(applyDrag("end", original, -400, 40, "day").end).toEqual(at(6));
        expect(applyDrag("start", original, 400, 40, "day").start).toEqual(at(7));
        expect(applyDrag("start", original, -40, 40, "day").start).toEqual(at(4));
    });

    it("sets progress relative to the bar width", () => {
        expect(applyDrag("progress", original, 30, 40, "day", 100).progress).toBe(70);
        expect(applyDrag("progress", original, 500, 40, "day", 100).progress).toBe(100);
        expect(applyDrag("progress", original, -500, 40, "day", 100).progress).toBe(0);
    });

    it("keeps milestones as points when moved", () => {
        const point = { start: at(5), end: at(5) };
        const moved = shift("move", point, 2, "day");
        expect(moved.start).toEqual(at(7));
        expect(moved.end).toEqual(at(7));
    });

    it("compares schedules", () => {
        expect(sameSchedule(original, { ...original })).toBe(true);
        expect(sameSchedule(original, { ...original, progress: 41 })).toBe(false);
    });
});

describe("keyboard", () => {
    it("maps arrows and pages to moves and resizes", () => {
        expect(keyEdit("ArrowRight", false, "day")).toEqual({ mode: "move", units: 1 });
        expect(keyEdit("ArrowLeft", true, "day")).toEqual({ mode: "end", units: -1 });
        expect(keyEdit("PageDown", false, "day")).toEqual({ mode: "move", units: 7 });
        expect(keyEdit("PageUp", false, "hour")).toEqual({ mode: "move", units: -168 });
        expect(keyEdit("a", false, "day")).toBeUndefined();
    });
});

describe("geometry", () => {
    it("routes arrows straight when there is room and doubles back when not", () => {
        expect(linkPath({ x: 10, y: 18 }, { x: 100, y: 54 }, 36)).toBe("M 10 18 H 18 V 54 H 100");
        expect(linkPath({ x: 100, y: 18 }, { x: 50, y: 54 }, 36)).toBe("M 100 18 H 108 V 36 H 42 V 54 H 50");
    });

    it("draws only the rows on screen plus overscan", () => {
        expect(visibleRange(0, 360, 36, 300)).toEqual({ first: 0, last: 16 });
        expect(visibleRange(3600, 360, 36, 300)).toEqual({ first: 94, last: 116 });
        expect(visibleRange(0, 360, 36, 3)).toEqual({ first: 0, last: 3 });
    });
});
