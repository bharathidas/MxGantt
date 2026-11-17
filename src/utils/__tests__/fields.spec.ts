import { ObjectItem } from "mendix";

import {
    cleanField,
    convertField,
    evaluateFormula,
    FieldDef,
    FieldValues,
    filterChoices,
    formatValue,
    formulaInputs,
    formulaProblem,
    initials,
    matchesFieldFilter,
    moveKey,
    newFieldKey,
    orderColumns,
    parseDay,
    parseFields,
    parseInput,
    parseNumberText,
    parseValues,
    readValue,
    safeUrl,
    serializeFields,
    serializeValues,
    toDisplayFormula,
    toStoredFormula,
    withFieldValue
} from "../fields";
import { applyValues, scenarioChanges, taskValues } from "../scenario";
import { searchText, filterTasks, NO_FILTER } from "../filter";
import { loadView, saveView } from "../storage";
import { Task } from "../tasks";
import { resetAttributeNames, WritableAttribute, writeTasks } from "../write";

const RISK: FieldDef = {
    key: "risk",
    name: "Risk",
    type: "select",
    options: [
        { id: "low", label: "Low", color: "#15803d" },
        { id: "med", label: "Medium", color: "#ca8504" },
        { id: "high", label: "High", color: "#d92d20" }
    ]
};
const BUDGET: FieldDef = {
    key: "budget",
    name: "Budget",
    type: "number",
    format: "currency",
    currency: "EUR",
    decimals: 0
};
const APPROVED: FieldDef = { key: "approved", name: "Approved", type: "checkbox" };
const VENDOR: FieldDef = { key: "vendor", name: "Vendor", type: "text" };

describe("field definitions JSON", () => {
    it("round-trips and keeps only what is set", () => {
        const text = serializeFields([RISK, BUDGET, APPROVED]);
        expect(parseFields(text)).toEqual([RISK, BUDGET, APPROVED]);
        expect(JSON.parse(text)[2]).toEqual({ key: "approved", name: "Approved", type: "checkbox" });
    });

    it("accepts an object with a fields array, plain option strings and missing keys", () => {
        const fields = parseFields(
            JSON.stringify({
                fields: [
                    { name: "Due by", type: "date" },
                    { name: "Tier", type: "select", options: ["A", "B"] }
                ]
            })
        );
        expect(fields.map(f => f.key)).toEqual(["due_by", "tier"]);
        expect(fields[1].options?.map(o => [o.id, o.label])).toEqual([
            ["A", "A"],
            ["B", "B"]
        ]);
        expect(fields[1].options?.[0].color).toMatch(/^#/);
    });

    it("never throws on broken input and drops duplicates, unknown types become text", () => {
        expect(parseFields("{not json")).toEqual([]);
        expect(parseFields("")).toEqual([]);
        expect(parseFields("42")).toEqual([]);
        const fields = parseFields(
            JSON.stringify([{ key: "a", name: "A", type: "wat" }, { key: "a", name: "Again" }, null, { name: "" }])
        );
        expect(fields).toEqual([{ key: "a", name: "A", type: "text" }]);
    });

    it("clamps widths, decimals, rating maximum and currency codes", () => {
        expect(cleanField({ key: "n", name: "N", type: "number", decimals: 12, width: 5000, currency: "eur" })).toEqual(
            {
                key: "n",
                name: "N",
                type: "number",
                decimals: 6,
                width: 800,
                currency: "EUR"
            }
        );
        expect(cleanField({ key: "r", name: "R", type: "rating", max: 50 })?.max).toBe(10);
        expect(cleanField({ key: "r", name: "R", type: "rating" })?.max).toBe(5);
    });

    it("makes stable, unique keys from names", () => {
        expect(newFieldKey("Budget (€)", [])).toBe("budget");
        expect(newFieldKey("Budget", ["budget"])).toBe("budget_2");
        expect(newFieldKey("2026 target", [])).toBe("f_2026_target");
        expect(newFieldKey("Crème brûlée", [])).toBe("creme_brulee");
        expect(newFieldKey("!!!", [])).toBe("f");
    });
});

describe("task values JSON", () => {
    it("parses, cleans and serialises values", () => {
        expect(parseValues('{"budget":12500,"risk":"high","tags":["a",3],"bad key":1,"x":null}')).toEqual({
            budget: 12500,
            risk: "high",
            tags: ["a"]
        });
        expect(parseValues("nope")).toEqual({});
        expect(serializeValues({ a: "", b: [], c: 0, d: false })).toBe('{"c":0,"d":false}');
        expect(serializeValues({})).toBe("");
    });

    it("changes one field and keeps the others, also unknown ones", () => {
        const text = '{"risk":"low","old":"kept"}';
        expect(JSON.parse(withFieldValue(text, "budget", 5))).toEqual({ risk: "low", old: "kept", budget: 5 });
        expect(JSON.parse(withFieldValue(text, "risk", undefined))).toEqual({ old: "kept" });
        expect(withFieldValue('{"risk":"low"}', "risk", "")).toBe("");
    });
});

describe("reading and showing values", () => {
    it("formats each type", () => {
        expect(formatValue(BUDGET, 12500, { locale: "en-US" })).toBe("€12,500");
        expect(formatValue({ ...BUDGET, format: "percent", decimals: 1 }, 12.34, { locale: "en-US" })).toBe("12.3%");
        expect(formatValue(RISK, "high")).toBe("High");
        expect(formatValue(RISK, "Medium")).toBe("Medium");
        expect(formatValue({ ...RISK, type: "multi" }, ["low", "high", "gone"])).toBe("Low, High");
        expect(formatValue(APPROVED, true, { yes: "Yes", no: "No" })).toBe("Yes");
        expect(formatValue(APPROVED, false, { yes: "Yes", no: "No" })).toBe("No");
        expect(formatValue({ key: "s", name: "S", type: "rating", max: 5 }, 3)).toBe("★★★☆☆");
        expect(formatValue({ key: "d", name: "D", type: "date" }, "2026-11-30", { locale: "en-GB" })).toBe(
            "30 Nov 2026"
        );
        expect(formatValue(VENDOR, undefined)).toBe("");
    });

    it("reads values stored under another type without throwing", () => {
        expect(readValue(BUDGET, "1.250,50")).toBe(1250.5);
        expect(readValue(BUDGET, "abc")).toBeUndefined();
        expect(readValue(APPROVED, "true")).toBe(true);
        expect(readValue(RISK, ["med"])).toBe("med");
        expect(readValue({ key: "d", name: "D", type: "date" }, "2026-02-30")).toBeUndefined();
        expect(readValue({ key: "r", name: "R", type: "rating", max: 5 }, 9)).toBe(5);
    });

    it("reads numbers the way people type them", () => {
        expect(parseNumberText("1,250.50")).toBe(1250.5);
        expect(parseNumberText("1.250,50")).toBe(1250.5);
        expect(parseNumberText("12,5")).toBe(12.5);
        expect(parseNumberText("€ 12k")).toBe(12000);
        expect(parseNumberText("-3")).toBe(-3);
        expect(parseNumberText("25%")).toBe(25);
        expect(parseNumberText("twelve")).toBeUndefined();
    });

    it("only opens safe links", () => {
        expect(safeUrl("https://example.com")).toBe("https://example.com");
        expect(safeUrl("example.com/docs")).toBe("https://example.com/docs");
        expect(safeUrl("ann@example.com")).toBe("mailto:ann@example.com");
        expect(safeUrl("javascript:alert(1)")).toBeUndefined();
        expect(safeUrl("data:text/html,x")).toBeUndefined();
        expect(safeUrl("just words")).toBeUndefined();
    });

    it("parses typed input per type", () => {
        expect(parseInput(BUDGET, "12 500")).toEqual({ value: 12500 });
        expect(parseInput(BUDGET, "lots")).toEqual({ error: "number" });
        expect(parseInput({ key: "d", name: "D", type: "date" }, "30-11-2026")).toEqual({ value: "2026-11-30" });
        expect(parseInput({ key: "d", name: "D", type: "date" }, "soon")).toEqual({ error: "date" });
        expect(parseInput({ key: "u", name: "U", type: "url" }, "javascript:x")).toEqual({ error: "url" });
        expect(parseInput({ key: "r", name: "R", type: "rating", max: 5 }, "7")).toEqual({ error: "rating" });
        expect(parseInput(VENDOR, "  ")).toEqual({ value: undefined });
        expect(parseDay("2026-11-30")?.getDate()).toBe(30);
        expect(initials("Maya Patel")).toBe("MP");
        expect(initials("bob")).toBe("BO");
    });
});

describe("type changes", () => {
    const entries = [
        { id: "1", raw: "Low" as const },
        { id: "2", raw: "High" as const },
        { id: "3", raw: "Critical" as const },
        { id: "4", raw: undefined }
    ];

    it("turns text into select options, reusing existing ones and adding the rest", () => {
        const to: FieldDef = { ...RISK };
        const result = convertField(VENDOR, to, entries);
        expect(result.converted).toBe(3);
        expect(result.cleared).toBe(0);
        expect(result.values.get("1")).toBe("low");
        expect(result.values.get("2")).toBe("high");
        const added = result.field.options!.find(option => option.label === "Critical")!;
        expect(result.values.get("3")).toBe(added.id);
        expect(RISK.options).toHaveLength(3);
    });

    it("counts values that cannot be converted", () => {
        const result = convertField(VENDOR, BUDGET, [
            { id: "1", raw: "12k" },
            { id: "2", raw: "n/a" }
        ]);
        expect(result.converted).toBe(1);
        expect(result.cleared).toBe(1);
        expect(result.values.get("1")).toBe(12000);
        expect(result.values.has("2")).toBe(true);
        expect(result.values.get("2")).toBeUndefined();
    });

    it("converts select to text and multi, checkbox to number and back", () => {
        expect(convertField(RISK, VENDOR, [{ id: "1", raw: "med" }]).values.get("1")).toBe("Medium");
        expect(convertField(RISK, { ...RISK, type: "multi" }, [{ id: "1", raw: "med" }]).values.get("1")).toEqual([
            "med"
        ]);
        expect(convertField(APPROVED, BUDGET, [{ id: "1", raw: true }]).values.get("1")).toBe(1);
        expect(convertField(VENDOR, APPROVED, [{ id: "1", raw: "yes" }]).values.get("1")).toBe(true);
        // Unchanged values are not written again.
        expect(convertField(BUDGET, { ...BUDGET, type: "rating", max: 5 }, [{ id: "1", raw: 4 }]).values.size).toBe(0);
    });
});

describe("formulas", () => {
    const fields = [BUDGET, APPROVED, RISK, { key: "spent", name: "Spent", type: "number" } as FieldDef];
    const inputs = formulaInputs(fields, { budget: 1000, spent: 250, approved: true }, { _duration: 5, _progress: 40 });

    it("evaluates arithmetic, functions, comparisons and built-ins", () => {
        expect(evaluateFormula("[budget] - [spent]", inputs)).toBe(750);
        expect(evaluateFormula("ROUND([spent] / [budget] * 100, 1)", inputs)).toBe(25);
        expect(evaluateFormula("[budget] * [_progress]%", inputs)).toBe(400);
        expect(evaluateFormula("IF([approved], [budget], 0)", inputs)).toBe(1000);
        expect(evaluateFormula("MAX([spent], 300, [_duration])", inputs)).toBe(300);
        expect(evaluateFormula("AVG(2, 4)", inputs)).toBe(3);
        expect(evaluateFormula("-[spent] + 2 * (3 + 1)", inputs)).toBe(-242);
        expect(evaluateFormula("[spent] >= 250", inputs)).toBe(1);
    });

    it("returns nothing for missing inputs, division by zero and broken formulas", () => {
        expect(evaluateFormula("[risk] + 1", inputs)).toBeUndefined();
        expect(evaluateFormula("1 / 0", inputs)).toBeUndefined();
        expect(evaluateFormula("1 +", inputs)).toBeUndefined();
        expect(evaluateFormula("EVIL(1)", inputs)).toBeUndefined();
    });

    it("reports problems and converts names to keys and back", () => {
        expect(formulaProblem("", fields, "f")).toBe("empty");
        expect(formulaProblem("1 +", fields, "f")).toBe("syntax");
        expect(formulaProblem("[nope]", fields, "f")).toBe("unknown");
        expect(formulaProblem("[f] + 1", fields, "f")).toBe("self");
        expect(formulaProblem("[vendor]", [...fields, VENDOR], "f")).toBe("text");
        expect(formulaProblem("[budget] * [_progress]", fields, "f")).toBeUndefined();
        const stored = toStoredFormula("[Budget] - [spent] * [Done]", fields);
        expect(stored).toBe("[budget] - [spent] * [_progress]");
        expect(toDisplayFormula(stored, fields)).toBe("[Budget] - [Spent] * [Done]");
    });
});

describe("filters and column order", () => {
    it("matches field filters", () => {
        const fields = [RISK, APPROVED, { ...RISK, key: "tags", name: "Tags", type: "multi" } as FieldDef];
        expect(matchesFieldFilter("risk=high", fields, { risk: "high" })).toBe(true);
        expect(matchesFieldFilter("risk=high", fields, { risk: "low" })).toBe(false);
        expect(matchesFieldFilter("risk=", fields, {})).toBe(true);
        expect(matchesFieldFilter("approved=false", fields, {})).toBe(true);
        expect(matchesFieldFilter("approved=true", fields, { approved: true })).toBe(true);
        expect(matchesFieldFilter("tags=med", fields, { tags: ["low", "med"] })).toBe(true);
        expect(matchesFieldFilter("gone=x", fields, {})).toBe(true);
        const choices = filterChoices(
            [RISK, APPROVED, { key: "owner", name: "Owner", type: "person" }],
            (): FieldValues[] => [{ owner: "Bea" }, { owner: "Al" }, {}],
            { yes: "Yes", no: "No", empty: "Empty" }
        );
        expect(choices.map(c => c.field.key)).toEqual(["risk", "approved", "owner"]);
        expect(choices[2].choices.map(c => c.label)).toEqual(["Al", "Bea", "Empty"]);
    });

    it("applies the user's order and slots new columns in after their neighbour", () => {
        const cols = ["name", "start", "end", "f:risk", "f:budget"].map(key => ({ key }));
        expect(orderColumns(cols, ["f:risk", "name", "end", "start"]).map(c => c.key)).toEqual([
            "f:risk",
            "f:budget",
            "name",
            "end",
            "start"
        ]);
        expect(orderColumns(cols, []).map(c => c.key)).toEqual(cols.map(c => c.key));
        expect(moveKey(["a", "b", "c", "d"], "d", 1)).toEqual(["a", "d", "b", "c"]);
        expect(moveKey(["a", "b"], "x", 0)).toEqual(["a", "b"]);
    });

    it("searches custom field texts and filters tasks", () => {
        const task = (id: string, fields: Record<string, string>): Task => ({
            id,
            name: `Task ${id}`,
            milestone: false,
            deps: [],
            editable: true,
            fieldValues: fields
        });
        const tasks = [task("1", { vendor: "Northwind", risk: "high" }), task("2", { vendor: "Contoso", risk: "low" })];
        const fieldText = (t: Task): string => formatValue(VENDOR, t.fieldValues?.vendor);
        expect(searchText(tasks[0], undefined, "Northwind")).toContain("northwind");
        const ctx = {
            critical: new Set<string>(),
            now: new Date(),
            fieldText,
            fieldMatch: (t: Task, f: string) => matchesFieldFilter(f, [RISK], t.fieldValues)
        };
        expect(filterTasks(tasks, { ...NO_FILTER, text: "contoso" }, ctx).map(t => t.id)).toEqual(["2"]);
        expect(filterTasks(tasks, { ...NO_FILTER, field: "risk=high" }, ctx).map(t => t.id)).toEqual(["1"]);
    });
});

describe("persistence", () => {
    it("carries field values through undo, scenarios and the remembered view", () => {
        const task: Task = {
            id: "1",
            name: "A",
            milestone: false,
            deps: [],
            editable: true,
            fieldsText: '{"risk":"low"}'
        };
        expect(taskValues(task, ["fields"])).toEqual({ fields: '{"risk":"low"}' });
        const next = applyValues(task, { fields: '{"risk":"high"}' });
        expect(next.fieldValues).toEqual({ risk: "high" });
        const changes = scenarioChanges([task], new Map([["1", { fields: '{"risk":"high"}' }]]));
        expect(changes).toEqual([
            { id: "1", next: { fields: '{"risk":"high"}' }, previous: { fields: '{"risk":"low"}' } }
        ]);
        saveView("mxgantt:test", { order: ["f:risk", "name"], hidden: ["duration"] });
        expect(loadView("mxgantt:test").order).toEqual(["f:risk", "name"]);
    });

    it("writes the values JSON to the attribute whose name says so, even while every task is empty", async () => {
        resetAttributeNames();
        const db = [
            { guid: "1", Notes: "", FieldValues: "" },
            { guid: "2", Notes: "", FieldValues: "" }
        ];
        const commits: string[] = [];
        (window as unknown as { mx: unknown }).mx = {
            data: {
                get({ guids, callback }: { guids: string[]; callback: (objects: unknown[]) => void }) {
                    callback(
                        guids.map(guid => {
                            const rec = db.find(r => r.guid === guid)! as Record<string, string>;
                            return {
                                getGuid: () => guid,
                                getAttributes: () => ["Notes", "FieldValues"],
                                getAttributeType: () => "String",
                                get: (name: string) => rec[name],
                                set: (name: string, value: string) => {
                                    rec[name] = value;
                                }
                            };
                        })
                    );
                },
                commit({ mxobj, callback }: { mxobj: { getGuid: () => string }; callback: () => void }) {
                    commits.push(mxobj.getGuid());
                    callback();
                }
            }
        };
        const attribute: WritableAttribute = {
            id: "attr_values",
            get: (item: ObjectItem) => ({ value: db.find(r => r.guid === item.id)!.FieldValues })
        };
        const ok = await writeTasks(
            [
                {
                    item: { id: "1" } as ObjectItem,
                    fields: [
                        {
                            attribute,
                            kind: "string",
                            value: '{"risk":"high"}',
                            hint: /field|custom|values/i,
                            hintFirst: true
                        }
                    ]
                }
            ],
            { items: [{ id: "1" }, { id: "2" }] as ObjectItem[], commit: true }
        );
        expect(ok).toBe(true);
        expect(db[0]).toEqual({ guid: "1", Notes: "", FieldValues: '{"risk":"high"}' });
        expect(commits).toEqual(["1"]);
        delete (window as unknown as { mx?: unknown }).mx;
    });
});
