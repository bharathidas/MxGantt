import { buildSvg, escapeXml, exportScale, ExportPalette } from "../export";
import { buildLinks, buildRows, rowIndexOf, Task } from "../tasks";
import { makeFormatters, scaleCells, timelineRange } from "../time";
import { fill, readTexts, textPropertyKey } from "../texts";

const palette: ExportPalette = {
    background: "#fff",
    text: "#000",
    muted: "#666",
    border: "#ccc",
    header: "#eee",
    weekend: "#f4f4f4",
    bar: "#36c",
    group: "#444",
    milestone: "#c60",
    today: "red",
    link: "#888",
    conflict: "#d00",
    critical: "#f90",
    fontFamily: "Segoe UI"
};

describe("image export", () => {
    it("draws every row, bar, milestone and arrow", () => {
        const day = (n: number): Date => new Date(2026, 9, 1 + n);
        const tasks: Task[] = [
            {
                id: "a",
                name: "Plan <&>",
                start: day(0),
                end: day(3),
                progress: 50,
                group: "G",
                milestone: false,
                key: "1",
                deps: [],
                editable: true
            },
            {
                id: "b",
                name: "Ship",
                start: day(4),
                end: day(4),
                milestone: true,
                key: "2",
                deps: ["1"],
                editable: true
            }
        ];
        const rows = buildRows(tasks, new Set());
        const map = new Map(tasks.map(t => [t.id, t]));
        const scale = timelineRange(day(0), day(4), day(0), "week");
        const { svg, width, height } = buildSvg({
            rows,
            tasks: map,
            rowIndex: rowIndexOf(rows, map),
            links: buildLinks(tasks),
            critical: new Set(),
            scale,
            cells: scaleCells("week", scale, makeFormatters("en-GB")),
            columns: [
                {
                    title: "Task",
                    width: 200,
                    align: "left",
                    text: row => (row.kind === "group" ? row.name : row.task.name)
                }
            ],
            rowHeight: 36,
            showWeekends: true,
            showToday: true,
            showLinks: true,
            today: day(1),
            palette
        });
        expect(svg.startsWith("<svg")).toBe(true);
        expect(height).toBe(52 + 3 * 36);
        expect(width).toBeGreaterThan(200);
        expect(svg).toContain("Plan &lt;&amp;&gt;");
        expect(svg).toContain("<polygon"); // the milestone
        expect(svg).toContain('marker-end="url(#al)"');
        expect(svg).not.toMatch(/NaN|undefined/);
    });

    it("scales huge charts down to what a canvas can hold", () => {
        expect(exportScale(1000, 500)).toBe(2);
        expect(exportScale(40000, 500)).toBeCloseTo(0.4);
        expect(exportScale(10000, 10000)).toBeLessThan(1.2);
    });

    it("escapes XML", () => {
        expect(escapeXml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;");
    });
});

describe("texts", () => {
    it("reads overrides and fills [name] placeholders", () => {
        const texts = readTexts({ [textPropertyKey("today")]: { value: "Heute" }, txtZoom: { value: "" } });
        expect(texts.today).toBe("Heute");
        expect(texts.zoom).toBe("Zoom");
        expect(fill(texts.moved, { name: "A", start: "1", end: "2" })).toBe("A moved to 1 – 2");
        expect(fill("[missing]", {})).toBe("[missing]");
    });

    it("has no braces anywhere, which Studio Pro would reject", () => {
        Object.values(readTexts({})).forEach(text => expect(text).not.toMatch(/[{}]/));
    });
});
