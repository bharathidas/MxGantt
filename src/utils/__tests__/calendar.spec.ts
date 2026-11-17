import {
    addWorkingTime,
    ALL_DAYS,
    dayKey,
    isWorkingDay,
    makeCalendar,
    moveLike,
    nonWorkingDays,
    parseHolidays,
    parseIsoDate,
    parseWorkingDays,
    rollToWorkingDay,
    workingDaysBetween
} from "../calendar";

// October 2026: the 5th is a Monday.
const at = (day: number, hour = 0): Date => new Date(2026, 9, day, hour);
const weekdays = makeCalendar("1-5", "");

describe("working days", () => {
    it("parses ranges, lists, names and wrap-around ranges", () => {
        expect(parseWorkingDays("1-5")).toEqual([false, true, true, true, true, true, false]);
        expect(parseWorkingDays("Mon-Thu, Sat")).toEqual([false, true, true, true, true, false, true]);
        expect(parseWorkingDays("7-1")).toEqual([true, true, false, false, false, false, false]);
        expect(parseWorkingDays("0 6")).toEqual([true, false, false, false, false, false, true]);
        expect(parseWorkingDays("")).toBeUndefined();
        expect(parseWorkingDays("nonsense, 9")).toBeUndefined();
    });

    it("parses holidays as local dates, with ranges, ignoring invalid ones", () => {
        const holidays = parseHolidays("2026-12-25, 2026-12-31..2027-01-01\n2026-02-30 junk");
        expect([...holidays]).toEqual(["2026-12-25", "2026-12-31", "2027-01-01"]);
        expect(parseIsoDate("2026-10-05")).toEqual(at(5));
        expect(parseIsoDate("2026-13-01")).toBeUndefined();
        expect(dayKey(at(5, 23))).toBe("2026-10-05");
    });

    it("stays inactive when every day works and nothing is off", () => {
        expect(makeCalendar("1-7", "")).toBe(ALL_DAYS);
        expect(makeCalendar("", "")).toBe(ALL_DAYS);
        expect(makeCalendar("", "2026-10-07").active).toBe(true);
    });

    it("knows weekends and holidays", () => {
        const calendar = makeCalendar("1-5", "2026-10-07");
        expect(isWorkingDay(calendar, at(5))).toBe(true);
        expect(isWorkingDay(calendar, at(7, 15))).toBe(false);
        expect(isWorkingDay(calendar, at(10))).toBe(false);
        expect(isWorkingDay(ALL_DAYS, at(10))).toBe(true);
    });

    it("rolls to the nearest working day keeping the time", () => {
        expect(rollToWorkingDay(weekdays, at(10, 9), 1)).toEqual(at(12, 9));
        expect(rollToWorkingDay(weekdays, at(11, 9), -1)).toEqual(at(9, 9));
        expect(rollToWorkingDay(weekdays, at(6), 1)).toEqual(at(6));
    });
});

describe("working time", () => {
    it("counts working days a span covers", () => {
        expect(workingDaysBetween(weekdays, at(5), at(7))).toBe(2);
        // Friday to Tuesday over a weekend: Friday and Monday.
        expect(workingDaysBetween(weekdays, at(9), at(13))).toBe(2);
        expect(workingDaysBetween(weekdays, at(5), at(19))).toBe(10);
        expect(workingDaysBetween(weekdays, at(5, 12), at(6))).toBe(0.5);
        expect(workingDaysBetween(weekdays, at(10), at(12))).toBe(0);
        expect(workingDaysBetween(weekdays, at(7), at(5))).toBe(-2);
        expect(workingDaysBetween(ALL_DAYS, at(9), at(13))).toBe(4);
    });

    it("adds working days without jumping a weekend an end does not need", () => {
        // Thursday + 2 ends at the end of Friday, Saturday 00:00.
        expect(addWorkingTime(weekdays, at(8), 2)).toEqual(at(10));
        // Friday + 2 covers Friday and Monday.
        expect(addWorkingTime(weekdays, at(9), 2)).toEqual(at(13));
        expect(addWorkingTime(weekdays, at(5, 12), 0.5)).toEqual(at(6));
        expect(addWorkingTime(weekdays, at(5), 0)).toEqual(at(5));
    });

    it("goes back in working days", () => {
        expect(addWorkingTime(weekdays, at(13), -2)).toEqual(at(9));
        expect(addWorkingTime(weekdays, at(10), -5)).toEqual(at(5));
        expect(addWorkingTime(weekdays, at(12), -1)).toEqual(at(9));
    });

    it("is plain calendar arithmetic without a calendar", () => {
        expect(addWorkingTime(ALL_DAYS, at(9, 9), 3)).toEqual(at(12, 9));
        expect(addWorkingTime(ALL_DAYS, at(9), 1.5)).toEqual(at(10, 12));
        expect(addWorkingTime(ALL_DAYS, at(9), -2)).toEqual(at(7));
    });

    it("round-trips: adding a span's working days to its start gives its end", () => {
        const calendar = makeCalendar("1-5", "2026-10-14");
        for (let start = 5; start < 20; start++) {
            for (let length = 1; length < 12; length++) {
                const from = rollToWorkingDay(calendar, at(start), 1);
                const end = addWorkingTime(calendar, from, length);
                expect(workingDaysBetween(calendar, from, end)).toBe(length);
            }
        }
    });

    it("moves a date like another one moved, keeping the wall-clock time", () => {
        expect(moveLike(at(8, 17), at(5, 9), at(7, 9))).toEqual(at(10, 17));
        expect(moveLike(at(8, 17), at(5, 9), at(5, 11))).toEqual(at(8, 19));
    });

    it("finds the non-working spans to shade", () => {
        const spans = nonWorkingDays(weekdays, at(5), at(19));
        expect(spans).toEqual([
            { start: at(10), end: at(12) },
            { start: at(17), end: at(19) }
        ]);
        expect(nonWorkingDays(ALL_DAYS, at(5), at(19))).toEqual([]);
    });
});
