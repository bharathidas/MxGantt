// 1.2 browser suite: configured task list columns (order, Task name first, sorting, group totals,
// typed editing written through mx.data, undo, column chooser, fill, remembered view), with
// screenshots at 1600 and 1024 px in light and dark.
//   node harness/build.mjs && node harness/test-layout.mjs
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const here = fileURLToPath(new URL(".", import.meta.url));
const pageUrl = pathToFileURL(here + "index.html").href;
const shots = here + "dist/shots/layout/";
mkdirSync(shots, { recursive: true });

let passed = 0;
let failed = 0;
function check(name, ok, detail = "") {
    if (ok) {
        passed++;
        console.log(`PASS ${name}`);
    } else {
        failed++;
        console.log(`FAIL ${name}${detail ? ` - ${detail}` : ""}`);
    }
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => {
    if (message.type() === "error") {
        errors.push(message.text());
    }
});

async function open(query, width = 1600, height = 900) {
    await page.setViewport({ width, height });
    await page.goto(`${pageUrl}${query}`);
    await page.waitForSelector(".mxgantt-list-row");
    await wait(500);
}
const headers = () =>
    page.$$eval(".mxgantt-list-headrow [role=columnheader]", cells => cells.map(cell => cell.textContent.trim()));
const names = () => page.$$eval(".mxgantt-list-row .mxgantt-name", cells => cells.map(cell => cell.textContent.trim()));
const store = () => page.evaluate(() => window.harness.store());
const row = async id => (await store()).find(entry => entry.id === id);
const events = () => page.evaluate(() => window.harness.events.map(event => event.name));

/** Text, classes and the centre of a cell, found by row name and header text. */
async function cell(task, column) {
    return page.evaluate(
        (t, c) => {
            const heads = [...document.querySelectorAll(".mxgantt-list-headrow [role=columnheader]")];
            const index = heads.findIndex(h => h.textContent.trim() === c);
            const target = [...document.querySelectorAll(".mxgantt-list-row")].find(
                r => r.querySelector(".mxgantt-name")?.textContent.trim() === t
            );
            const element = target?.querySelectorAll("[role=cell], [role=rowheader]")[index];
            if (!element) {
                return null;
            }
            const box = element.getBoundingClientRect();
            return {
                text: element.textContent.trim(),
                className: element.className,
                title: element.title,
                x: box.x + box.width / 2,
                y: box.y + box.height / 2,
                width: box.width
            };
        },
        task,
        column
    );
}
async function header(title) {
    return page.evaluate(t => {
        const element = [...document.querySelectorAll(".mxgantt-list-headrow [role=columnheader]")].find(
            h => h.textContent.trim() === t
        );
        if (!element) {
            return null;
        }
        const box = element.getBoundingClientRect();
        const button = element.querySelector(".mxgantt-head-sort");
        const buttonBox = button?.getBoundingClientRect();
        return {
            sort: element.getAttribute("aria-sort"),
            title: element.title,
            width: box.width,
            x: box.x + box.width / 2,
            y: box.y + box.height / 2,
            bx: buttonBox ? buttonBox.x + buttonBox.width / 2 : undefined,
            by: buttonBox ? buttonBox.y + buttonBox.height / 2 : undefined
        };
    }, title);
}
async function clickSort(title) {
    const box = await header(title);
    await page.mouse.click(box.bx, box.by);
    await wait(150);
}
async function editCell(task, column) {
    const box = await cell(task, column);
    await page.mouse.click(box.x, box.y, { clickCount: 2 });
    await wait(150);
}

// ---------------------------------------------------------------- layout and order

await open("?layout=1");
const expected = ["WBS", "Task", "Start", "Duration", "Done", "Owner", "Status", "Budget", "Approved"];
check(
    "columns follow the Columns list, WBS before Task name",
    JSON.stringify(await headers()) === JSON.stringify(expected),
    JSON.stringify(await headers())
);
check("hidden-at-first Notes column is not shown", !(await headers()).includes("Notes"));
check("End is not shown (not in the list)", !(await headers()).includes("End"));
check("header tooltip from Header tooltip", (await header("Budget")).title.startsWith("Approved budget"));
check(
    "currency format",
    (await cell("Requirements", "Budget"))?.text === "€4,000",
    (await cell("Requirements", "Budget"))?.text
);
check("enumeration shows its caption", (await cell("Build API", "Status"))?.text === "At risk");
check("boolean shows Yes / No", (await cell("Requirements", "Approved"))?.text === "Yes");
check(
    "dynamic cell class on an over-budget task",
    (await cell("Build API", "Budget"))?.className.includes("harness-over")
);
check("no dynamic class within budget", !(await cell("Design", "Budget"))?.className.includes("harness-over"));
check(
    "group row shows the Budget sum",
    (await cell("Build", "Budget"))?.text === "€59,000",
    (await cell("Build", "Budget"))?.text
);
check(
    "Release total skips the empty budget",
    (await cell("Release", "Budget"))?.text === "€9,000",
    (await cell("Release", "Budget"))?.text
);
check("built-in Assigned to with caption Owner", (await cell("Design", "Owner"))?.text === "Bob");

for (const theme of ["light", "dark"]) {
    for (const width of [1600, 1024]) {
        await open(`?layout=1&theme=${theme}${width === 1024 ? "&grid=620" : ""}`, width, 760);
        await page.screenshot({ path: `${shots}layout-${theme}-${width}.png` });
    }
}
await open("?layout=1");

// ---------------------------------------------------------------- sorting

const original = await names();
check("Start header is sortable and unsorted", (await header("Start")).sort === "none");
check("Approved header is not sortable", (await header("Approved")).sort === null);
await clickSort("Budget");
check("Budget ascending", (await header("Budget")).sort === "ascending");
const ascending = await names();
check(
    "sorted within groups: Build UI before Build API",
    ascending.indexOf("Build UI") < ascending.indexOf("Build API"),
    JSON.stringify(ascending)
);
await clickSort("Budget");
const descending = await names();
check(
    "Budget descending",
    (await header("Budget")).sort === "descending" && descending.indexOf("Build API") < descending.indexOf("Build UI")
);
check(
    "Go-live (no budget) stays last in its group",
    descending.indexOf("Go-live") > descending.indexOf("Test"),
    JSON.stringify(descending)
);
await clickSort("Budget");
check("third click restores the data source order", JSON.stringify(await names()) === JSON.stringify(original));
await clickSort("Task");
await clickSort("Task");
const byName = await names();
check("Task name sorts descending", byName.indexOf("Test") < byName.indexOf("Go-live"), JSON.stringify(byName));
await clickSort("Task");
await page.screenshot({ path: `${shots}sorted.png` });

// ---------------------------------------------------------------- editing

await editCell("Design", "Budget");
let input = await page.$(".mxgantt-list-row input.mxgantt-editor");
check("Budget opens a number editor", !!input && (await input.evaluate(el => el.type)) === "number");
check("the editor starts with the plain number", (await input.evaluate(el => el.value)) === "12500");
await input.evaluate(el => el.select());
await page.keyboard.type("15000");
await page.keyboard.press("Enter");
await wait(600);
check("Budget written to the object", (await row("2")).Budget === 15000, JSON.stringify(await row("2")));
check(
    "committed and On task changed ran",
    (await events()).includes("commit") && (await events()).includes("onTaskChange")
);
check("the cell shows the new value", (await cell("Design", "Budget"))?.text === "€15,000");
check(
    "the group total follows",
    (await cell("Plan", "Budget"))?.text === "€19,000",
    (await cell("Plan", "Budget"))?.text
);

await page.click(".mxgantt-list");
await page.keyboard.down("Control");
await page.keyboard.press("z");
await page.keyboard.up("Control");
await wait(600);
check("undo writes the old budget back", (await row("2")).Budget === 12500, JSON.stringify(await row("2")));

await editCell("Test", "Status");
const select = await page.$(".mxgantt-list-row select.mxgantt-editor");
check("Status opens a list of the enumeration values", !!select);
const optionsText = select ? await select.evaluate(el => [...el.options].map(option => option.textContent)) : [];
check(
    "the list shows the captions",
    JSON.stringify(optionsText) === JSON.stringify(["Not started", "In progress", "At risk", "Done"]),
    JSON.stringify(optionsText)
);
await select.select("in_progress");
await wait(600);
check(
    "Status written as the enumeration key",
    (await row("5")).Status === "in_progress",
    JSON.stringify(await row("5"))
);
check("the cell shows the caption", (await cell("Test", "Status"))?.text === "In progress");

await editCell("Test", "Approved");
const flag = await page.$(".mxgantt-list-row select.mxgantt-editor");
await flag.select("true");
await wait(600);
check("Approved written as a boolean", (await row("5")).Approved === true, JSON.stringify(await row("5")));

await editCell("Build UI", "Budget");
input = await page.$(".mxgantt-list-row input.mxgantt-editor");
await input.evaluate(el => el.select());
await page.keyboard.press("Escape");
await wait(200);
check(
    "Escape closes the editor without saving",
    !(await page.$(".mxgantt-list-row input.mxgantt-editor")) && (await row("4")).Budget === 21000
);

// ---------------------------------------------------------------- reordering and the column chooser

const status = await header("Status");
const task = await header("Task");
await page.mouse.move(status.x, status.y);
await page.mouse.down();
await page.mouse.move(status.x - 40, status.y, { steps: 4 });
await page.mouse.move(task.x - task.width / 2 - 20, task.y, { steps: 6 });
await page.mouse.up();
await wait(250);
const afterDrag = await headers();
check(
    "a column dropped before Task name lands right after it",
    afterDrag[1] === "Task" && afterDrag[2] === "Status",
    JSON.stringify(afterDrag)
);
check("dragging a sortable header does not sort it", (await header("Status")).sort === "none");

await page.click(".mxgantt-button-columns");
await page.waitForSelector(".mxgantt-colpanel, [role=dialog]");
await wait(200);
const chooser = await page.evaluate(() => {
    const items = [
        ...document.querySelectorAll(".mxgantt-colpanel input[type=checkbox], [role=dialog] input[type=checkbox]")
    ];
    return items.map(item => ({
        label: item.closest("label, li, [role=listitem], div")?.textContent.trim(),
        checked: item.checked,
        disabled: item.disabled
    }));
});
const entry = label => chooser.find(item => item.label?.startsWith(label));
check("chooser lists Notes unchecked", entry("Notes") && !entry("Notes").checked, JSON.stringify(chooser));
check(
    "Status cannot be hidden (Users can hide = No)",
    entry("Status")?.disabled === true,
    JSON.stringify(entry("Status"))
);
check("Task name cannot be hidden", entry("Task")?.disabled === true);
await page.evaluate(() => {
    const items = [
        ...document.querySelectorAll(".mxgantt-colpanel input[type=checkbox], [role=dialog] input[type=checkbox]")
    ];
    items
        .find(item => item.closest("label, li, [role=listitem], div")?.textContent.trim().startsWith("Notes"))
        ?.click();
});
await page.keyboard.press("Escape");
await wait(300);
check("Notes appears after showing it", (await headers()).includes("Notes"));
const notes = await cell("Build API", "Notes");
check("Notes wraps long text", notes?.className.includes("is-wrap"));
const notesHead = await header("Notes");
const taskHead = await header("Task");
check("Notes (Fill free space) is at least its minimum width", notesHead.width >= 140, String(notesHead.width));
check(
    "Notes and Task name share the free width",
    Math.abs(notesHead.width - taskHead.width) <= 2 || notesHead.width === 140,
    `${notesHead.width} / ${taskHead.width}`
);
await page.screenshot({ path: `${shots}chooser-notes.png` });

// ---------------------------------------------------------------- remembered view

await open("?layout=1&remember=1");
await page.evaluate(() => window.localStorage.clear());
await open("?layout=1&remember=1");
await clickSort("Start");
await wait(200);
await open("?layout=1&remember=1");
check("Remember view keeps the sort", (await header("Start")).sort === "ascending");
await page.evaluate(() => window.localStorage.clear());

// ---------------------------------------------------------------- classic columns still work

await open("");
check(
    "without Columns the classic columns are shown",
    (await headers()).slice(0, 4).join(",") === "Task,Start,End,Duration",
    JSON.stringify(await headers())
);

check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
