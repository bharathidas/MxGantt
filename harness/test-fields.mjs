// 1.1 browser suite: custom fields and the column chooser, with screenshots at 1600 and 1024 px in light and dark.
//   node harness/build.mjs && node harness/test-fields.mjs
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const here = fileURLToPath(new URL(".", import.meta.url));
const pageUrl = pathToFileURL(here + "index.html").href;
const shots = here + "dist/shots/fields/";
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
    await wait(400);
}
const headers = () =>
    page.$$eval(".mxgantt-list-headrow [role=columnheader]", cells =>
        cells.map(cell => cell.textContent.trim()).filter(Boolean)
    );
const store = () => page.evaluate(() => window.harness.store());
const values = async id => JSON.parse((await store()).find(row => row.id === id).FieldValues || "{}");
const fields = async () => JSON.parse((await page.evaluate(() => window.harness.fields())) || "[]");
/** The cell of a task row (by name) in a column (by header text). */
async function cellBox(task, column) {
    return page.evaluate(
        (t, c) => {
            const heads = [...document.querySelectorAll(".mxgantt-list-headrow [role=columnheader]")];
            const index = heads.findIndex(h => h.textContent.trim() === c);
            const row = [...document.querySelectorAll(".mxgantt-list-row")].find(r =>
                r.querySelector(".mxgantt-cell-name")?.textContent.includes(t)
            );
            const cell = row?.querySelectorAll("[role=cell], [role=rowheader]")[index];
            if (!cell) {
                return null;
            }
            cell.scrollIntoView({ block: "nearest", inline: "nearest" });
            const box = cell.getBoundingClientRect();
            return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        },
        task,
        column
    );
}
async function clickByText(selector, text) {
    const handle = await page.evaluateHandle(
        (s, t) => [...document.querySelectorAll(s)].find(e => e.textContent.trim() === t || e.getAttribute("aria-label") === t),
        selector,
        text
    );
    const element = handle.asElement();
    if (!element) {
        throw new Error(`nothing matches ${selector} "${text}"`);
    }
    await element.click();
}

// ---------------------------------------------------------------- columns and values
await open("?fields=1");
let heads = await headers();
check("custom field columns follow the built-in ones", ["Budget", "Risk", "Approved", "Vendor"].every(h => heads.includes(h)), heads.join("|"));
check("select values are coloured chips", (await page.$$(".mxgantt-cell-field .mxgantt-chip-tag")).length >= 6);
check(
    "currency is formatted",
    await page.evaluate(() => [...document.querySelectorAll(".mxgantt-cell-field")].some(c => c.textContent === "€38,000"))
);
check("risk is shown on the bars", (await page.$$(".mxgantt-bar-fields .mxgantt-chip-tag")).length >= 5);
check("the + add field button is in the header", !!(await page.$(".mxgantt-head-addbutton")));
await page.screenshot({ path: shots + "fields-1600-light.png" });

// tooltip lists the fields
const bar = await page.$(".mxgantt-bar-task");
await bar.hover();
await wait(300);
const tip = await page.$eval(".mxgantt-tooltip", t => t.textContent).catch(() => "");
check("the tooltip lists custom fields", tip.includes("Budget") && tip.includes("Risk"), tip.slice(0, 120));
await page.mouse.move(5, 5);

// checkbox: one click
let box = await cellBox("Build API", "Approved");
await page.mouse.click(box.x, box.y);
await wait(400);
check("one click ticks Approved and saves it", (await values("3")).approved === true, JSON.stringify(await values("3")));

// number typed with a k suffix
box = await cellBox("Test", "Budget");
await page.mouse.click(box.x, box.y, { clickCount: 2 });
await page.waitForSelector(".mxgantt-cell-field.is-editing input");
await page.keyboard.down("Control");
await page.keyboard.press("A");
await page.keyboard.up("Control");
await page.keyboard.type("11k");
await page.keyboard.press("Enter");
await wait(400);
check("a number typed as 11k is saved as 11000", (await values("5")).budget === 11000, JSON.stringify(await values("5")));

// select with the keyboard: Down, Enter
box = await cellBox("Go-live", "Risk");
await page.mouse.click(box.x, box.y, { clickCount: 2 });
await page.waitForSelector(".mxgantt-fv-popup [role=option]");
await page.screenshot({ path: shots + "select-editor-1600.png" });
await page.keyboard.press("ArrowDown");
await page.keyboard.press("ArrowDown");
await page.keyboard.press("Enter");
await wait(400);
check("a choice picked with the arrow keys is saved", (await values("6")).risk === "high", JSON.stringify(await values("6")));
check("other values of the task are kept", (await values("6")).budget === 2500);

// undo restores the value
await page.keyboard.down("Control");
await page.keyboard.press("z");
await page.keyboard.up("Control");
await wait(400);
check("undo puts the old value back", (await values("6")).risk === "low", JSON.stringify(await values("6")));

// ---------------------------------------------------------------- add a field
await page.click(".mxgantt-head-addbutton");
await page.waitForSelector(".mxgantt-ff");
await page.type(".mxgantt-ff input[type=text]", "Priority");
await clickByText(".mxgantt-ff-type", "Single select");
const optionInputs = await page.$$(".mxgantt-ff-option-input");
for (const [index, label] of ["P1", "P2", "P3"].entries()) {
    await optionInputs[index].type(label);
}
await wait(250);
await page.screenshot({ path: shots + "add-field-1600.png" });
check(
    "the preview shows a chip for the first choice",
    (await page.$eval(".mxgantt-ff-preview-value", p => p.textContent)) === "P1"
);
await clickByText(".mxgantt-ff-foot button", "Add field");
await wait(400);
const afterAdd = await fields();
check("the new field is written to Fields", afterAdd.some(f => f.key === "priority" && f.type === "select" && f.options.length === 3));
check("On fields changed ran", await page.evaluate(() => window.harness.events.some(e => e.name === "onFieldsChange")));
check("the Priority column appears", (await headers()).includes("Priority"));

// ---------------------------------------------------------------- column chooser
await clickByText(".mxgantt-toolbar button", "Columns");
await page.waitForSelector(".mxgantt-columns");
await clickByText(".mxgantt-columns-title", "Duration");
await wait(150);
check("unticking Duration hides it", !(await headers()).includes("Duration"));
// Move Risk up until it sits right after Task (Alt + Up on its checkbox).
for (let i = 0; i < 20 && (await headers())[1] !== "Risk"; i++) {
    await page.evaluate(() => {
        const item = [...document.querySelectorAll(".mxgantt-columns-item")].find(i => i.textContent.includes("Risk"));
        item.querySelector("input").focus();
    });
    await page.keyboard.down("Alt");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.up("Alt");
    await wait(80);
}
check("Risk moved next to Task with Alt + Up", (await headers())[1] === "Risk", (await headers()).join("|"));
await page.screenshot({ path: shots + "columns-panel-1600.png" });
// drag in the panel: Vendor above Budget (the list is scrolled to its end first)
await page.$eval(".mxgantt-columns-list", list => {
    list.scrollTop = list.scrollHeight;
});
const handles = await page.evaluate(() =>
    [...document.querySelectorAll(".mxgantt-columns-item")].map(i => {
        const b = i.querySelector(".mxgantt-columns-handle").getBoundingClientRect();
        return { title: i.textContent, x: b.x + b.width / 2, y: b.y + b.height / 2 };
    })
);
const vendor = handles.find(h => h.title.startsWith("Vendor"));
const budget = handles.find(h => h.title.startsWith("Budget"));
await page.mouse.move(vendor.x, vendor.y);
await page.mouse.down();
await page.mouse.move(vendor.x, vendor.y - 10, { steps: 3 });
await page.mouse.move(budget.x, budget.y - 6, { steps: 8 });
await page.mouse.up();
await wait(200);
heads = await headers();
check("dragging a column in the panel reorders it", heads.indexOf("Vendor") === heads.indexOf("Budget") - 1, heads.join("|"));
await page.keyboard.press("Escape");
await wait(100);
check("Escape closes the panel", !(await page.$(".mxgantt-columns")));

// header drag: Vendor back after Task
const headBoxes = await page.$$eval(".mxgantt-list-headrow [data-column]", cells =>
    cells.map(c => {
        const b = c.getBoundingClientRect();
        return { key: c.dataset.column, x: b.x, y: b.y + b.height / 2, w: b.width };
    })
);
const vendorHead = headBoxes.find(h => h.key === "f:vendor");
const startHead = headBoxes.find(h => h.key === "start");
await page.mouse.move(vendorHead.x + 20, vendorHead.y);
await page.mouse.down();
await page.mouse.move(vendorHead.x + 40, vendorHead.y, { steps: 3 });
await page.mouse.move(startHead.x + 5, startHead.y, { steps: 10 });
await page.mouse.up();
await wait(200);
heads = await headers();
check("dragging a header moves the column", heads.indexOf("Vendor") === heads.indexOf("Start") - 1, heads.join("|"));

// reset
await clickByText(".mxgantt-toolbar button", "Columns");
await page.waitForSelector(".mxgantt-columns");
await clickByText(".mxgantt-columns button", "Reset");
await wait(150);
heads = await headers();
check("Reset brings back the default order and Duration", heads[1] === "Start" && heads.includes("Duration"), heads.join("|"));
await page.keyboard.press("Escape");

// ---------------------------------------------------------------- filter
await page.select(".mxgantt-field-filter", "risk=high");
await wait(200);
let rows = await page.$$eval(".mxgantt-list-row:not(.mxgantt-list-group)", r => r.length);
check("the field filter keeps the high-risk tasks", rows === 2, String(rows));
await page.select(".mxgantt-field-filter", "");
await page.type(".mxgantt-search-input", "northwind");
await wait(200);
rows = await page.$$eval(".mxgantt-list-row:not(.mxgantt-list-group)", r => r.length);
check("search finds custom field text", rows === 2, String(rows));
await page.$eval(".mxgantt-search-input", i => {
    i.select();
});
await page.keyboard.press("Backspace");
await wait(150);

// ---------------------------------------------------------------- change type and delete
await page.hover('[data-column="f:vendor"]');
await page.click('[data-column="f:vendor"] .mxgantt-head-menu');
await clickByText(".mxgantt-menu-item", "Edit field");
await page.waitForSelector(".mxgantt-ff");
await clickByText(".mxgantt-ff-type", "Single select");
await wait(150);
const note = await page.$eval(".mxgantt-ff-note", n => n.textContent).catch(() => "");
check("a type change says how many values convert", note.includes("converts 4 values; 0 cannot"), note);
await page.screenshot({ path: shots + "change-type-1600.png" });
await clickByText(".mxgantt-ff-foot button", "Save");
await wait(500);
const vendorField = (await fields()).find(f => f.key === "vendor");
check("Vendor became a select with the old values as choices", vendorField.type === "select" && vendorField.options.length === 3, JSON.stringify(vendorField));
const v2 = await values("2");
check("task values were converted to choice ids", vendorField.options.some(o => o.id === v2.vendor && o.label === "Northwind Design"), JSON.stringify(v2));

await page.hover('[data-column="f:approved"]');
await page.click('[data-column="f:approved"] .mxgantt-head-menu');
await clickByText(".mxgantt-menu-item", "Delete field");
await page.waitForSelector("[role=alertdialog]");
await clickByText("[role=alertdialog] button", "Delete field");
await wait(300);
check("Delete field removes the column", !(await headers()).includes("Approved"));
check("its values stay on the task", (await values("1")).approved === true);

// ---------------------------------------------------------------- 1024, dark, hint, read-only, reduced motion
await open("?fields=1&grid=560", 1024, 760);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check("no horizontal page scroll at 1024 px", overflow <= 0, String(overflow));
await page.screenshot({ path: shots + "fields-1024-light.png" });
await page.click(".mxgantt-head-addbutton");
await page.waitForSelector(".mxgantt-ff");
await wait(250);
const formBox = await page.$eval(".mxgantt-ff", f => {
    const b = f.getBoundingClientRect();
    return { left: b.left, right: b.right, bottom: b.bottom };
});
check("the add field popover fits in a 1024 px window", formBox.left >= 0 && formBox.right <= 1024, JSON.stringify(formBox));
await page.screenshot({ path: shots + "add-field-1024.png" });
await page.keyboard.press("Escape");

await open("?fields=1&theme=dark");
await page.screenshot({ path: shots + "fields-1600-dark.png" });
await clickByText(".mxgantt-toolbar button", "Columns");
await wait(250);
await page.screenshot({ path: shots + "columns-panel-1600-dark.png" });
await page.keyboard.press("Escape");
await page.click(".mxgantt-head-addbutton");
await wait(250);
await page.screenshot({ path: shots + "add-field-1600-dark.png" });
await page.keyboard.press("Escape");

await page.evaluate(() => localStorage.clear());
await open("?fields=empty");
await wait(1200);
check("the first-time hint shows while there are no fields", !!(await page.$(".mxgantt-fields-hint")));
await page.screenshot({ path: shots + "hint-1600.png" });
await clickByText(".mxgantt-fields-hint button", "Not now");
check("Not now hides the hint", !(await page.$(".mxgantt-fields-hint")));

await open("?fields=1&manage=0");
check("users who may not manage fields get no + button", !(await page.$(".mxgantt-head-addbutton")));
box = await cellBox("Test", "Approved");
await page.mouse.click(box.x, box.y);
await wait(300);
check("they can still fill in values", (await values("5")).approved === true);

await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
await open("?fields=1");
await clickByText(".mxgantt-toolbar button", "Columns");
const animation = await page.$eval(".mxgantt-columns", p => getComputedStyle(p).animationName);
check("reduced motion: the panel does not animate", animation === "none", animation);

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
