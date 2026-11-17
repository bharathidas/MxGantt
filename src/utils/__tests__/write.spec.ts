import { ObjectItem } from "mendix";

import {
    pickCandidate,
    resetAttributeNames,
    sameRaw,
    sameText,
    toNumber,
    WritableAttribute,
    writeTask,
    writeTasks
} from "../write";

type Rec = Record<string, unknown> & { guid: string };

const types: Record<string, string> = {
    Name: "String",
    Start: "DateTime",
    End: "DateTime",
    Progress: "Integer",
    DependsOn: "String",
    Color: "String"
};

function install(db: Rec[]): { commits: string[]; sets: Array<[string, string, unknown]> } {
    const log = { commits: [] as string[], sets: [] as Array<[string, string, unknown]> };
    (window as unknown as { mx: unknown }).mx = {
        data: {
            get({ guids, callback }: { guids: string[]; callback: (objects: unknown[]) => void }) {
                callback(
                    guids.map(guid => {
                        const rec = db.find(r => r.guid === guid)!;
                        return {
                            getGuid: () => rec.guid,
                            getAttributes: () => Object.keys(types),
                            getAttributeType: (name: string) => types[name],
                            get: (name: string) => rec[name],
                            set: (name: string, value: unknown) => {
                                rec[name] = value;
                                log.sets.push([guid, name, value]);
                            }
                        };
                    })
                );
            },
            commit({
                mxobj,
                mxobjs,
                callback
            }: {
                mxobj?: { getGuid: () => string };
                mxobjs?: Array<{ getGuid: () => string }>;
                callback: () => void;
            }) {
                log.commits.push(mxobjs ? mxobjs.map(object => object.getGuid()).join("+") : mxobj!.getGuid());
                callback();
            }
        }
    };
    return log;
}

function attribute(id: string, db: Rec[], read: (rec: Rec) => unknown): WritableAttribute {
    return { id, get: (item: ObjectItem) => ({ value: read(db.find(r => r.guid === item.id)!) }) };
}

describe("writing back", () => {
    beforeEach(() => resetAttributeNames());

    it("compares widget and client values", () => {
        expect(toNumber(new Date(5))).toBe(5);
        expect(toNumber("40")).toBe(40);
        expect(toNumber("")).toBeUndefined();
        expect(sameRaw(1700000000000, new Date(1700000000000))).toBe(true);
        expect(sameRaw("40", 40)).toBe(true);
        expect(sameRaw(undefined, null)).toBe(true);
    });

    it("finds the attribute names by value and writes, then commits once", async () => {
        const db: Rec[] = [
            { guid: "1", Name: "A", Start: 1000, End: 5000, Progress: "10" },
            { guid: "2", Name: "B", Start: 2000, End: 9000, Progress: "20" }
        ];
        const log = install(db);
        const items = db.map(r => ({ id: r.guid } as unknown as ObjectItem));
        const start = attribute("s", db, r => new Date(r.Start as number));
        const end = attribute("e", db, r => new Date(r.End as number));
        const progress = attribute("p", db, r => Number(r.Progress));

        const ok = await writeTask(
            items[1],
            [
                { attribute: start, kind: "date", value: new Date(3000) },
                { attribute: end, kind: "date", value: new Date(10000) },
                { attribute: progress, kind: "number", value: 55 }
            ],
            { items, commit: true }
        );
        expect(ok).toBe(true);
        expect(log.sets).toEqual([
            ["2", "Start", 3000],
            ["2", "End", 10000],
            ["2", "Progress", "55"]
        ]);
        expect(log.commits).toEqual(["2"]);
    });

    it("refuses to guess when two attributes always hold the same value", async () => {
        const db: Rec[] = [{ guid: "1", Name: "M", Start: 1000, End: 1000, Progress: "0" }];
        const log = install(db);
        const items = [{ id: "1" } as unknown as ObjectItem];
        const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);
        const warnings = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const ok = await writeTask(
            items[0],
            [{ attribute: attribute("s", db, r => new Date(r.Start as number)), kind: "date", value: new Date(2000) }],
            { items, commit: false }
        );
        expect(ok).toBe(false);
        expect(log.sets).toEqual([]);
        errors.mockRestore();
        warnings.mockRestore();
    });

    it("does nothing without the client API", async () => {
        delete (window as unknown as { mx?: unknown }).mx;
        const ok = await writeTask({ id: "1" } as unknown as ObjectItem, [], { items: [], commit: true });
        expect(ok).toBe(false);
    });

    it("compares texts treating empty and missing alike", () => {
        expect(sameText(null, "")).toBe(true);
        expect(sameText("3, 5", "3, 5")).toBe(true);
        expect(sameText("3", "4")).toBe(false);
    });

    it("writes a batch to several objects and commits them together", async () => {
        const db: Rec[] = [
            { guid: "1", Name: "A", Start: 1000, End: 5000, Progress: "10", DependsOn: "", Color: "" },
            { guid: "2", Name: "B", Start: 2000, End: 9000, Progress: "20", DependsOn: "1", Color: "" },
            { guid: "3", Name: "C", Start: 3000, End: 9500, Progress: "0", DependsOn: "2SS", Color: "red" }
        ];
        const log = install(db);
        const items = db.map(r => ({ id: r.guid } as unknown as ObjectItem));
        const start = attribute("s", db, r => new Date(r.Start as number));
        const deps = attribute("d", db, r => r.DependsOn);
        const name = attribute("n", db, r => r.Name);
        const ok = await writeTasks(
            [
                { item: items[0], fields: [{ attribute: start, kind: "date", value: new Date(1500) }] },
                {
                    item: items[2],
                    fields: [
                        { attribute: deps, kind: "string", value: "2SS, 1" },
                        { attribute: name, kind: "string", value: "C2" }
                    ]
                }
            ],
            { items, commit: true }
        );
        expect(ok).toBe(true);
        expect(log.sets).toEqual([
            ["1", "Start", 1500],
            ["3", "DependsOn", "2SS, 1"],
            ["3", "Name", "C2"]
        ]);
        expect(log.commits).toEqual(["1+3"]);
    });

    it("uses a configured attribute name instead of guessing", async () => {
        // Every Depends on and Colour is empty, so the values cannot tell them apart.
        const db: Rec[] = [{ guid: "1", Name: "A", Start: 1, End: 2, Progress: "0", DependsOn: "", Color: "" }];
        const log = install(db);
        const items = [{ id: "1" } as unknown as ObjectItem];
        const deps = attribute("d2", db, r => r.DependsOn);
        const ok = await writeTasks(
            [{ item: items[0], fields: [{ attribute: deps, kind: "string", value: "7", name: "DependsOn" }] }],
            { items, commit: false }
        );
        expect(ok).toBe(true);
        expect(log.sets).toEqual([["1", "DependsOn", "7"]]);
        expect(log.commits).toEqual([]);
    });
});

describe("choosing between attributes with the same values", () => {
    it("drops baseline copies, then prefers names that fit the role", () => {
        expect(pickCandidate(["Start", "BaselineStart"], /start/i)).toBe("Start");
        expect(pickCandidate(["EndDate", "PlannedEnd"], /end/i)).toBe("EndDate");
        expect(pickCandidate(["DependsOn", "Color"], /depend/i)).toBe("DependsOn");
        expect(pickCandidate(["Notes", "Color"], /depend/i)).toBeUndefined();
        expect(pickCandidate(["Only"])).toBe("Only");
    });
});
