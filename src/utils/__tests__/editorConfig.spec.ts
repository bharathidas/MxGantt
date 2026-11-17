import { readFileSync } from "fs";
import { join } from "path";
import { Properties } from "@mendix/pluggable-widgets-tools";
import { check, getProperties } from "../../MxGantt.editorConfig";
import { MxGanttPreviewProps } from "../../../typings/MxGanttProps";

const props = (): Properties => [
    { caption: "Timeline", properties: [{ key: "statusDate", caption: "Status date", description: "" }] }
];
const visible = (values: Partial<MxGanttPreviewProps>): boolean => {
    const result = getProperties({ columns: [], markers: [], ...values } as unknown as MxGanttPreviewProps, props());
    return result[0].properties!.some(p => p.key === "statusDate");
};

describe("editorConfig: status date (2.3.1)", () => {
    it("is hidden when nothing uses it", () => {
        expect(visible({})).toBe(false);
    });
    it("is shown for the status line and Behind schedule", () => {
        expect(visible({ showStatusLine: true })).toBe(true);
        expect(visible({ highlightBehind: true })).toBe(true);
    });
    it("is shown for earned value and the cost columns", () => {
        expect(visible({ showEarnedValue: true })).toBe(true);
        expect(visible({ costColumns: true })).toBe(true);
    });
});

describe("editorConfig: custom fields (1.1)", () => {
    const keys = ["fieldsAttr", "taskValuesAttr", "taskValuesAttrName", "fieldsEditable", "onFieldsChange"];
    const shown = (values: Partial<MxGanttPreviewProps>): string[] => {
        const list: Properties = [
            { caption: "Custom fields", properties: keys.map(key => ({ key, caption: key, description: "" })) }
        ];
        const result = getProperties({ columns: [], markers: [], ...values } as unknown as MxGanttPreviewProps, list);
        return result[0].properties!.map(p => p.key);
    };
    it("hides every custom field property while the feature is off", () => {
        expect(shown({ allowCustomFields: false })).toEqual([]);
    });
    it("shows them when it is on, the values name only with Task values", () => {
        expect(shown({ allowCustomFields: true })).toEqual([
            "fieldsAttr",
            "taskValuesAttr",
            "fieldsEditable",
            "onFieldsChange"
        ]);
        expect(shown({ allowCustomFields: true, taskValuesAttr: "Values" })).toEqual(keys);
    });
    it("reports missing attributes and a missing save action", () => {
        const problems = check({
            columns: [],
            markers: [],
            allowCustomFields: true,
            maxFields: 30
        } as unknown as MxGanttPreviewProps);
        expect(problems.map(p => p.property)).toEqual(expect.arrayContaining(["fieldsAttr", "taskValuesAttr"]));
        const later = check({
            columns: [],
            markers: [],
            allowCustomFields: true,
            maxFields: 30,
            fieldsAttr: "Fields",
            taskValuesAttr: "Values",
            fieldsEditable: "true"
        } as unknown as MxGanttPreviewProps);
        expect(later.map(p => p.property)).toEqual(["onFieldsChange"]);
    });
    it("uses no RegExp, split, replaceAll, flat or flatMap in the 1.1 code (Studio Pro runs it in Jint)", () => {
        // eslint-disable-next-line no-undef
        const source = readFileSync(join(process.cwd(), "src", "MxGantt.editorConfig.ts"), "utf8");
        const one = source.slice(source.indexOf("// 1.1 custom fields"), source.indexOf("if (values.editable"));
        const two = source.slice(
            source.indexOf("if (values.allowCustomFields)"),
            source.lastIndexOf("return problems")
        );
        const part = one + two;
        ["RegExp", ".split(", ".replaceAll(", ".flat(", ".flatMap(", ".test(", ".match("].forEach(api => {
            expect(part.includes(api)).toBe(false);
        });
    });
});
