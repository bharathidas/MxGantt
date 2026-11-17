import {
    addUnits,
    dateToX,
    durationDays,
    isoWeek,
    makeFormatters,
    scaleCells,
    startOfWeek,
    timelineRange,
    weekendSpans,
    xToDate
} from "../time";

const d = (y: number, m: number, day: number, h = 0): Date => new Date(y, m - 1, day, h);

describe("date steps", () => {
    it("starts weeks on Monday", () => {
        expect(startOfWeek(d(2026, 9, 26))).toEqual(d(2026, 9, 21)); // Saturday -> Monday
        expect(startOfWeek(d(2026, 9, 27))).toEqual(d(2026, 9, 21)); // Sunday belongs to the week before
        expect(startOfWeek(d(2026, 9, 21))).toEqual(d(2026, 9, 21));
    });

    it("computes ISO week numbers", () => {
        expect(isoWeek(d(2026, 1, 1))).toBe(1);
        expect(isoWeek(d(2021, 1, 3))).toBe(53); // belongs to 2020's last week
        expect(isoWeek(d(2026, 9, 26))).toBe(39);
        expect(isoWeek(d(2024, 12, 30))).toBe(1);
    });

    it("moves by calendar days, keeping the time of day", () => {
        expect(addUnits(d(2026, 3, 10, 9), 3, "day")).toEqual(d(2026, 3, 13, 9));
        expect(addUnits(d(2026, 3, 10, 9), -2, "hour")).toEqual(d(2026, 3, 10, 7));
        expect(addUnits(d(2026, 2, 27), 2, "day")).toEqual(d(2026, 3, 1));
    });

    it("measures durations to the hour", () => {
        expect(durationDays(d(2026, 3, 10), d(2026, 3, 15))).toBe(5);
        expect(durationDays(d(2026, 3, 10, 6), d(2026, 3, 10, 18))).toBe(0.5);
    });
});

describe("time scale", () => {
    const today = d(2026, 9, 26);

    it("pads and aligns the range to the zoom level", () => {
        const week = timelineRange(d(2026, 10, 7), d(2026, 11, 20), today, "week");
        expect(week.start.getDay()).toBe(1);
        expect(week.start <= today).toBe(true); // today is always inside
        expect(week.end > d(2026, 11, 20)).toBe(true);

        const month = timelineRange(d(2026, 10, 7), d(2026, 11, 20), today, "month");
        expect(month.start.getDate()).toBe(1);

        const quarter = timelineRange(d(2026, 10, 7), d(2026, 11, 20), today, "quarter");
        expect([0, 3, 6, 9]).toContain(quarter.start.getMonth());
        expect(quarter.pxPerDay).toBeLessThan(month.pxPerDay);
    });

    it("uses a wider day when snapping to hours", () => {
        expect(timelineRange(undefined, undefined, today, "day", "hour").pxPerDay).toBeGreaterThan(
            timelineRange(undefined, undefined, today, "day").pxPerDay
        );
    });

    it("maps dates to pixels and back", () => {
        const scale = { start: d(2026, 9, 21), end: d(2026, 12, 1), pxPerDay: 18 };
        expect(dateToX(d(2026, 9, 23), scale)).toBe(36);
        expect(xToDate(36, scale)).toEqual(d(2026, 9, 23));
    });

    it("builds header cells that tile the range", () => {
        const scale = timelineRange(d(2026, 10, 1), d(2026, 10, 31), today, "day");
        const cells = scaleCells("day", scale, makeFormatters("en-GB"));
        const width = dateToX(scale.end, scale);
        const covered = cells.bottom.reduce((sum, cell) => sum + cell.width, 0);
        expect(Math.round(covered)).toBe(Math.round(width));
        expect(cells.bottom.some(cell => cell.weekend)).toBe(true);
        expect(cells.top[0].label).toMatch(/2026/);

        const quarters = scaleCells(
            "quarter",
            timelineRange(d(2026, 1, 1), d(2026, 12, 1), today, "quarter"),
            makeFormatters("en-GB")
        );
        expect(quarters.bottom.map(cell => cell.label)).toEqual(expect.arrayContaining(["Q1", "Q2", "Q3", "Q4"]));
        expect(quarters.top.map(cell => cell.label)).toContain("2026");
    });

    it("finds weekends inside a window", () => {
        const scale = { start: d(2026, 9, 21), end: d(2026, 10, 19), pxPerDay: 40 };
        const spans = weekendSpans(scale);
        expect(spans).toHaveLength(4);
        expect(spans[0].x).toBe(5 * 40);
        expect(spans[0].width).toBe(80);
        expect(weekendSpans(scale, 0, 300)).toHaveLength(1);
    });

    it("survives an unknown locale", () => {
        expect(() => makeFormatters("xx-not-a-locale-!!").date(today)).not.toThrow();
    });
});
