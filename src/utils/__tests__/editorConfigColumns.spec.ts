import { readFileSync } from "fs";
import { join } from "path";
import { Properties } from "@mendix/pluggable-widgets-tools";
import { check, getPreview, getProperties } from "../../MxGantt.editorConfig";
import { GridColumnsPreviewType, MxGanttPreviewProps } from "../../../typings/MxGanttProps";
import { previewColumns } from "../previewColumns";

const column = (extra: Partial<GridColumnsPreviewType>): GridColumnsPreviewType => ({
    gcType: "attribute",
    gcCostMeasure: "cost",
    gcAttribute: "",
    gcCaption: "",
    gcTooltip: "",
    gcFormat: "auto",
    gcDecimals: 0,
    gcTotal: "none",
    gcClass: "",
    gcWidth: 0,
    gcMinWidth: 40,
    gcFill: false,
    gcAlign: "auto",
    gcWrap: false,
    gcVisible: true,
    gcHideable: true,
    gcSortable: false,
    gcEditable: false,
    gcAttributeName: "",
    ...extra
});

const values = (extra: Partial<MxGanttPreviewProps>): MxGanttPreviewProps =>
    ({
        columns: [],
        markers: [],
        gridColumns: [],
        showGrid: true,
        showToolbar: true,
        taskName: "{Name}",
        startAttr: "MyModule.Task.Start",
        endAttr: "MyModule.Task.End",
        ...extra
    } as unknown as MxGanttPreviewProps);

const problemsAt = (extra: Partial<MxGanttPreviewProps>): Array<{ property?: string; severity: string }> =>
    check(values(extra))
        .filter(problem => (problem.property ?? "").startsWith("gridColumns/"))
        .map(problem => ({ property: problem.property, severity: problem.severity ?? "error" }));

describe("editorConfig: Columns (1.2)", () => {
    it("asks for the attribute of an attribute column and a caption", () => {
        expect(problemsAt({ gridColumns: [column({})] })).toEqual([
            { property: "gridColumns/1/gcAttribute", severity: "error" },
            { property: "gridColumns/1/gcCaption", severity: "warning" }
        ]);
        expect(
            problemsAt({ gridColumns: [column({ gcAttribute: "MyModule.Task.Budget", gcCaption: "Budget" })] })
        ).toEqual([]);
    });

    it("allows each built-in column once", () => {
        const problems = problemsAt({ gridColumns: [column({ gcType: "start" }), column({ gcType: "start" })] });
        expect(problems).toEqual([{ property: "gridColumns/2/gcType", severity: "error" }]);
    });

    it("allows several cost columns with different measures", () => {
        const costs = {
            fixedCostAttr: "MyModule.Task.Cost",
            gridColumns: [
                column({ gcType: "cost", gcCostMeasure: "ev" }),
                column({ gcType: "cost", gcCostMeasure: "cpi" }),
                column({ gcType: "cost", gcCostMeasure: "ev" })
            ]
        };
        expect(problemsAt(costs)).toEqual([{ property: "gridColumns/3/gcType", severity: "error" }]);
    });

    it("reports built-in columns whose attributes are missing", () => {
        const problems = problemsAt({
            gridColumns: [
                column({ gcType: "progress" }),
                column({ gcType: "predecessors" }),
                column({ gcType: "variance" }),
                column({ gcType: "cost" })
            ]
        });
        expect(problems.map(problem => problem.property)).toEqual([
            "gridColumns/1/gcType",
            "gridColumns/2/gcType",
            "gridColumns/3/gcType",
            "gridColumns/4/gcType"
        ]);
        expect(
            problemsAt({ progressAttr: "MyModule.Task.Progress", gridColumns: [column({ gcType: "progress" })] })
        ).toEqual([]);
    });

    it("checks widths and decimals", () => {
        const problems = problemsAt({
            gridColumns: [column({ gcAttribute: "A", gcCaption: "A", gcWidth: 900, gcMinWidth: 10, gcDecimals: 9 })]
        });
        expect(problems.map(problem => problem.property)).toEqual([
            "gridColumns/1/gcDecimals",
            "gridColumns/1/gcWidth",
            "gridColumns/1/gcMinWidth"
        ]);
    });

    it("warns about a column that users can never see", () => {
        const hidden = [column({ gcType: "start", gcVisible: false })];
        expect(problemsAt({ gridColumns: hidden })).toEqual([
            { property: "gridColumns/1/gcVisible", severity: "warning" }
        ]);
        expect(problemsAt({ gridColumns: hidden, columnChooser: true })).toEqual([]);
    });

    it("hides the classic column settings while Columns is used", () => {
        const keys = ["columns", "showWbs", "showVariance", "costColumns", "nameSortable"];
        const list = (): Properties => [
            { caption: "Task list", properties: keys.map(key => ({ key, caption: key, description: "" })) }
        ];
        const shown = (extra: Partial<MxGanttPreviewProps>): string[] =>
            getProperties(values(extra), list())[0].properties!.map(property => property.key);
        const costs = { baselineEndAttr: "MyModule.Task.BaselineEnd", fixedCostAttr: "MyModule.Task.Cost" };
        expect(shown(costs)).toEqual(keys);
        expect(shown({ ...costs, gridColumns: [column({ gcType: "start" })] })).toEqual(["nameSortable"]);
    });
});

describe("Studio Pro previews (1.2)", () => {
    it("lists the configured columns with placeholders", () => {
        const columns = previewColumns(
            values({
                gridColumns: [
                    column({ gcType: "start", gcSortable: true }),
                    column({ gcAttribute: "MyModule.Task.Budget", gcFormat: "currency" }),
                    column({ gcType: "start" }),
                    column({ gcType: "cost", gcCostMeasure: "spi", gcVisible: false })
                ]
            })
        );
        expect(
            columns.map(entry => [entry.caption, entry.placeholder, entry.align, entry.sortable, entry.hidden])
        ).toEqual([
            ["Start", "[Start]", "left", true, false],
            ["Budget", "[Budget]", "right", false, false],
            ["SPI", "[SPI]", "right", false, true]
        ]);
    });

    it("shows the classic columns while Columns is empty", () => {
        const columns = previewColumns(values({ progressAttr: "MyModule.Task.Progress", showWbs: true }));
        expect(columns.map(entry => entry.caption)).toEqual(["WBS", "Start", "End", "Duration", "Done"]);
    });

    it("draws the structure preview with a selectable header and cell per configured column", () => {
        const items = [column({ gcType: "wbs" }), column({ gcAttribute: "MyModule.Task.Budget", gcCaption: "Budget" })];
        const preview = getPreview(values({ gridColumns: items }), false, [11, 12, 1]) as unknown as {
            children: Array<{ type: string; children?: Array<{ type: string; object?: object }> }>;
        };
        const rows = preview.children.filter(child => child.type === "RowLayout");
        // Title bar, toolbar, header row, then the data rows.
        const headerRow = rows[2];
        expect(headerRow.children!.map(child => child.type)).toEqual([
            "Selectable",
            "Container",
            "Selectable",
            "Container"
        ]);
        expect(headerRow.children![0].object).toBe(items[0]);
        expect(JSON.stringify(rows[3])).toContain("[Budget]");
        expect(JSON.stringify(rows[3])).toContain("[{Name}]");
        expect(JSON.stringify(preview)).toContain("Timeline");
    });

    it("works in dark mode and without the task list", () => {
        const preview = getPreview(values({ showGrid: false }), true);
        expect(JSON.stringify(preview)).not.toContain("Task");
    });

    it("uses no regular expressions or other APIs that break in the Jint engine of Studio Pro", () => {
        // eslint-disable-next-line no-undef
        const root = process.cwd();
        const config = readFileSync(join(root, "src", "MxGantt.editorConfig.ts"), "utf8");
        const part = config.slice(config.indexOf("/** What a built-in column needs"));
        const helper = readFileSync(join(root, "src", "utils", "previewColumns.ts"), "utf8").replace(
            "no regular expressions, no split by pattern, no flat or replaceAll",
            ""
        );
        const banned = ["RegExp", ".replaceAll(", ".flat(", ".flatMap(", ".test(", ".match(", ".search(", "split(/"];
        [part, helper].forEach(source => banned.forEach(api => expect(source.includes(api)).toBe(false)));
    });
});
