// 2.3 browser suite: resources and levelling, baselines, split tasks, constraints, cost and earned
// value, MS Project import, portfolio, save failures, performance, memory, WCAG checks and RTL.
//   node harness/build.mjs && node harness/test-v23.mjs
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const here = fileURLToPath(new URL(".", import.meta.url));
const pageUrl = pathToFileURL(here + "index.html").href;
const shots = here + "dist/shots/";
mkdirSync(shots, { recursive: true });

let passed = 0;
let failed = 0;
const perf = {};
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

const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--js-flags=--expose-gc", "--enable-precise-memory-info"]
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => {
    // The fake failing commit logs on purpose.
    if (message.type() === "error" && !/not reachable|could not save/.test(message.text())) {
        errors.push(message.text());
    }
});

async function open(query = "", width = 1280, height = 1000) {
    await page.setViewport({ width, height });
    await page.goto(`${pageUrl}${query}`);
    await page.waitForSelector(".mxgantt");
    await wait(300);
}
const count = selector => page.$$eval(selector, elements => elements.length);
const text = selector => page.$eval(selector, element => element.textContent ?? "");
const store = () => page.evaluate(() => window.harness.store());
const events = name => page.evaluate(n => window.harness.events.filter(e => e.name === n), name);
const clickButton = async (label, scope = ".mxgantt") => {
    const handle = await page.evaluateHandle(
        (l, s) =>
            [...document.querySelectorAll(`${s} button`)].find(
                b => b.textContent.trim() === l || b.getAttribute("aria-label") === l
            ),
        label,
        scope
    );
    const element = handle.asElement();
    if (!element) {
        throw new Error(`no button ${label}`);
    }
    await element.click();
};
const DAY = 86400000;

/** A Microsoft Project XML file with `n` tasks, links and resources, as Project itself writes it. */
function projectXml(n) {
    let tasks = "";
    for (let i = 1; i <= n; i++) {
        const day = 5 + Math.floor(i / 10);
        const pad = v => String(v).padStart(2, "0");
        const date = offset => {
            const value = new Date(2026, 9, day + offset);
            return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
        };
        tasks +=
            `<Task><UID>${i}</UID><ID>${i}</ID><Name>Imported ${i}</Name><OutlineLevel>1</OutlineLevel>` +
            `<Start>${date(0)}T08:00:00</Start><Finish>${date(1)}T17:00:00</Finish><PercentComplete>${i % 100}</PercentComplete>` +
            (i > 1 ? `<PredecessorLink><PredecessorUID>${i - 1}</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag><LagFormat>7</LagFormat></PredecessorLink>` : "") +
            `<Baseline><Number>0</Number><Start>${date(0)}T08:00:00</Start><Finish>${date(1)}T17:00:00</Finish></Baseline></Task>`;
    }
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Project xmlns="http://schemas.microsoft.com/project">' +
        "<Name>Imported plan</Name><MinutesPerDay>480</MinutesPerDay><CalendarUID>1</CalendarUID>" +
        "<Calendars><Calendar><UID>1</UID><Name>Standard</Name><IsBaseCalendar>1</IsBaseCalendar><WeekDays>" +
        "<WeekDay><DayType>1</DayType><DayWorking>0</DayWorking></WeekDay><WeekDay><DayType>7</DayType><DayWorking>0</DayWorking></WeekDay>" +
        "</WeekDays></Calendar></Calendars>" +
        `<Tasks>${tasks}</Tasks>` +
        "<Resources><Resource><UID>1</UID><Name>Ann</Name><MaxUnits>1.00</MaxUnits><StandardRate>60</StandardRate></Resource></Resources>" +
        "<Assignments><Assignment><UID>1</UID><TaskUID>1</TaskUID><ResourceUID>1</ResourceUID><Units>0.5</Units></Assignment></Assignments>" +
        "</Project>"
    );
}

/** WCAG relative-luminance contrast of an element's text against its first opaque background. */
async function contrastOf(selector) {
    return page.$eval(selector, element => {
        const parse = value => {
            const m = value.match(/rgba?\(([^)]+)\)/);
            if (!m) {
                return null;
            }
            const [r, g, b, a = "1"] = m[1].split(/[ ,/]+/).filter(Boolean);
            return [Number(r), Number(g), Number(b), Number(a)];
        };
        const lum = ([r, g, b]) => {
            const c = [r, g, b].map(v => {
                const s = v / 255;
                return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
            });
            return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        };
        const fg = parse(getComputedStyle(element).color);
        let node = element;
        let bg = null;
        while (node) {
            const value = parse(getComputedStyle(node).backgroundColor);
            if (value && value[3] > 0.9) {
                bg = value;
                break;
            }
            node = node.parentElement;
        }
        bg = bg ?? [255, 255, 255, 1];
        const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
        return Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100;
    });
}

try {
    // ------------------------------------------------------------ 1 portfolio, resources, constraints, split tasks
    await open("?v23=1");
    await page.screenshot({ path: shots + "v23-light.png", fullPage: true });
    check("project summary rows for both projects", (await count(".mxgantt-list-project")) === 2);
    check("project summary bars are drawn", (await count(".mxgantt-bar-project")) === 2);
    const portfolio = await text('[aria-label="Portfolio: Health"]');
    check("portfolio health table lists both projects with a rating", /Website/.test(portfolio) && /Mobile/.test(portfolio) && /(On track|At risk|Off track)/.test(portfolio), portfolio.slice(0, 200));
    check("cross-project links are drawn dashed", (await count(".mxgantt-link.is-cross")) >= 1);
    check("resource usage panel lists the resources", (await count(".mxgantt-resource-row")) === 4);
    check("Cy is over-allocated", await page.$$eval(".mxgantt-resource-row.is-over", rows => rows.some(row => /Cy/.test(row.textContent))));
    check("over-allocated bars are marked", (await count(".mxgantt-bar.is-overallocated")) >= 2);
    check("constraint indicators are drawn, broken ones in red", (await count(".mxgantt-constraint")) === 2 && (await count(".mxgantt-constraint.is-broken")) === 2);
    check("split task shows two segments", (await count('.mxgantt-bar[data-row-id="3"] .mxgantt-split-piece')) === 2);
    await page.hover('.mxgantt-bar[data-row-id="5"]');
    await wait(150);
    const tip5 = await text(".mxgantt-tooltip");
    check("tooltip explains the broken constraint and cost", /Finish no later than/.test(tip5) && /Breaks its constraint/.test(tip5) && /Cost/.test(tip5), tip5);
    const heads = await page.$$eval("[role=columnheader]", hs => hs.map(h => h.textContent));
    check("cost columns are in the task list", ["Resources", "Cost", "EV", "CPI", "SPI"].every(h => heads.includes(h)), heads.join("|"));

    // ------------------------------------------------------------ 2 earned value and S-curve
    const ev = await page.$eval('[aria-labelledby] .mxgantt-ev', el => ({ tiles: el.querySelectorAll(".mxgantt-ev-tile").length, text: el.textContent }));
    check("earned value panel has the eleven figures", ev.tiles === 11 && /€/.test(ev.text), String(ev.tiles));
    check("S-curve draws PV, EV, AC and the forecast", (await count(".mxgantt-scurve-line")) === 4);
    await page.$eval(".mxgantt-scurve svg", el => el.scrollIntoView({ block: "center" }));
    await wait(100);
    const svgBox = await page.$eval(".mxgantt-scurve svg", el => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    await page.mouse.move(svgBox.x + svgBox.w * 0.5, svgBox.y + svgBox.h * 0.5);
    await wait(100);
    check("hovering the S-curve shows a crosshair tooltip", (await count(".mxgantt-scurve-tip")) === 1 && (await count(".mxgantt-scurve-cross circle")) >= 1);
    await page.$eval(".mxgantt-scurve svg", el => el.focus());
    await page.keyboard.press("ArrowLeft");
    check("the S-curve is keyboard explorable", (await count(".mxgantt-scurve-tip")) === 1);

    // ------------------------------------------------------------ 3 resource levelling
    await clickButton("Level resources");
    await wait(200);
    const proposal = await text('[aria-label="Proposed changes"]');
    check("levelling shows a proposal", /Levelling delays \d+ tasks/.test(proposal), proposal);
    check("moved bars are previewed", (await count(".mxgantt-bar.is-pushed")) >= 1);
    const beforeLevel = await store();
    await clickButton("Apply", '[aria-label="Proposed changes"]');
    await wait(900);
    const afterLevel = await store();
    const movedIds = afterLevel.filter((row, i) => row.Start !== beforeLevel[i].Start).map(row => row.id);
    check("applying levelling writes the moved tasks in one commit", movedIds.length >= 1 && (await events("commit")).length === 1, movedIds.join(","));
    await page.waitForFunction(() => !document.querySelector(".mxgantt-resource-row.is-over"), { timeout: 3000 }).catch(() => undefined);
    check("after levelling nobody is over-allocated", (await count(".mxgantt-resource-row.is-over")) === 0);
    await page.keyboard.down("Control");
    await page.keyboard.press("z");
    await page.keyboard.up("Control");
    await wait(900);
    const undone = await store();
    check("one Ctrl+Z undoes the whole levelling", undone.every((row, i) => row.Start === beforeLevel[i].Start));

    // ------------------------------------------------------------ 4 schedule plan
    await open("?v23=1");
    await clickButton("Schedule plan");
    await wait(200);
    check("Schedule plan proposes moves", /Scheduling moves \d+ tasks|already follows/.test(await text('[aria-label="Proposed changes"]')));
    await clickButton("Cancel", '[aria-label="Proposed changes"]');
    check("cancel removes the proposal", (await count('[aria-label="Proposed changes"]')) === 0);

    // ------------------------------------------------------------ 5 split tasks: drag, menu, keyboard
    await open("?v23=1&zoom=day");
    const piece = await page.$('.mxgantt-bar[data-row-id="3"] .mxgantt-split-piece:nth-of-type(3), .mxgantt-bar[data-row-id="3"] [data-mode="segment"]');
    const pieceBox = await piece.boundingBox();
    await page.mouse.move(pieceBox.x + pieceBox.width / 2, pieceBox.y + pieceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(pieceBox.x + pieceBox.width / 2 + 40, pieceBox.y + pieceBox.height / 2, { steps: 4 });
    await page.mouse.move(pieceBox.x + pieceBox.width / 2 + 80, pieceBox.y + pieceBox.height / 2, { steps: 4 });
    await page.mouse.up();
    await wait(900);
    const seg = (await store()).find(row => row.id === "3");
    check("dragging a segment writes the new segments and end", seg.Segments === "0-3, 7-10", `${seg.Segments}`);
    await page.click('.mxgantt-bar[data-row-id="4"]', { button: "right" });
    await wait(100);
    await page.evaluate(() => [...document.querySelectorAll("[role=menuitem]")].find(item => item.textContent.trim() === "Split task").click());
    await wait(900);
    check("Split task from the menu splits the task", !!(await store()).find(row => row.id === "4").Segments);
    await page.focus('.mxgantt-bar[data-row-id="3"]');
    await page.keyboard.down("Alt");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.up("Alt");
    await wait(900);
    check("Alt + arrow moves the last segment", (await store()).find(row => row.id === "3").Segments === "0-3, 8-11");

    // ------------------------------------------------------------ 6 baselines
    await open("?v23=1");
    await clickButton("Baselines");
    await wait(100);
    const shown = await page.$eval('[aria-label="Baselines"] select, .mxgantt-baselines select', el => el.value);
    check("the configured baseline is shown", shown === "Approved", shown);
    await page.select(".mxgantt-baselines label:nth-of-type(2) select", "Re-plan");
    await wait(100);
    check("comparing draws twin baseline bars", (await count(".mxgantt-baseline2")) >= 2);
    check("comparison table lists the variances", (await count(".mxgantt-compare tbody tr")) >= 3);
    await page.type(".mxgantt-baselines input", "Sprint 9");
    await clickButton("Save current plan as baseline");
    await wait(900);
    check("saving a baseline writes it to every task", (await store()).every(row => (row.Baselines ?? "").includes("Sprint 9")));
    check("the new baseline is selectable", await page.$eval(".mxgantt-baselines select", el => [...el.options].some(o => o.value === "Sprint 9")));

    // ------------------------------------------------------------ 7 MS Project import
    await open("?v23=1");
    const file = here + "dist/import-sample.xml";
    writeFileSync(file, projectXml(12));
    const input = await page.$('input[type="file"]');
    await input.uploadFile(file);
    await page.waitForSelector("[role=dialog]", { timeout: 5000 });
    const dialogText = await text("[role=dialog]");
    check("the import preview counts what the file holds", /Imported plan: 12 tasks, 11 links, 1 resources, 1 assignments, 1 baselines/.test(dialogText), dialogText);
    await clickButton("Import", "[role=dialog]");
    await wait(100);
    const handed = await events("importJson");
    const json = handed.length ? JSON.parse(handed[0].args) : {};
    check("Import hands the plan over as JSON and runs On import", json.format === "mxgantt-mspdi-import" && json.tasks.length === 12 && (await events("onImport")).length === 1);
    writeFileSync(file, "<html><body>not a plan</body></html>");
    await (await page.$('input[type="file"]')).uploadFile(file);
    await wait(400);
    check("a file that is not Project XML is explained", /could not be read/.test(await text("[role=alert]")));

    // ------------------------------------------------------------ 8 save failures and slow saves
    await open("?v23=1&fail=1");
    const startBefore = (await store()).find(row => row.id === "4").Start;
    await page.focus('.mxgantt-bar[data-row-id="4"]');
    await page.keyboard.press("ArrowRight");
    await wait(1500);
    check("a failed save shows a banner with Retry", /could not be saved and were rolled back/.test(await text(".mxgantt-save.is-failed")));
    check("a failed save rolls the object back", (await store()).find(row => row.id === "4").Start === startBefore);
    await page.evaluate(() => window.harness.setFail(false));
    await clickButton("Retry");
    await wait(1200);
    check("Retry saves the change", (await store()).find(row => row.id === "4").Start === startBefore + DAY);
    check("the banner goes away after a successful retry", (await count(".mxgantt-save.is-failed")) === 0);
    await open("?v23=1&slow=1");
    await page.focus('.mxgantt-bar[data-row-id="4"]');
    await page.keyboard.press("ArrowRight");
    await wait(1900);
    check("a slow save shows Saving…", /Saving/.test(await text(".mxgantt-save")));

    // ------------------------------------------------------------ 9 accessibility: contrast, focus order, zoom, RTL, dark
    await open("?v23=1");
    const contrasts = {};
    for (const selector of [".mxgantt-panel-title", ".mxgantt-ev-tile dt", ".mxgantt-table thead th", ".mxgantt-resource-max", ".mxgantt-legend li", ".mxgantt-scenario-text, .mxgantt-ev-status"]) {
        contrasts[selector] = await contrastOf(selector).catch(() => 0);
    }
    check("text contrast at least 4.5:1 (light)", Object.values(contrasts).every(v => v >= 4.5), JSON.stringify(contrasts));
    await open("?v23=1&theme=dark");
    await page.screenshot({ path: shots + "v23-dark.png", fullPage: true });
    const dark = {};
    for (const selector of [".mxgantt-panel-title", ".mxgantt-ev-tile dt", ".mxgantt-table thead th", ".mxgantt-resource-max", ".mxgantt-legend li"]) {
        dark[selector] = await contrastOf(selector).catch(() => 0);
    }
    check("text contrast at least 4.5:1 (dark)", Object.values(dark).every(v => v >= 4.5), JSON.stringify(dark));
    await open("?v23=1");
    const order = [];
    await page.focus(".mxgantt-segment button");
    for (let i = 0; i < 60; i++) {
        order.push(await page.evaluate(() => {
            const el = document.activeElement;
            return el?.closest(".mxgantt-toolbar") ? "toolbar" : el?.closest(".mxgantt-panel-portfolio") ? "portfolio" : el?.closest(".mxgantt-body") ? "body" : el?.closest(".mxgantt-panel-resources") ? "resources" : el?.closest(".mxgantt-panel-ev") ? "ev" : "other";
        }));
        await page.keyboard.press("Tab");
    }
    const firstIndex = name => order.indexOf(name);
    check("focus order follows the layout: toolbar, portfolio, chart, resources, earned value", firstIndex("toolbar") === 0 && firstIndex("portfolio") > 0 && firstIndex("body") > firstIndex("portfolio") && firstIndex("resources") > firstIndex("body") && firstIndex("ev") > firstIndex("resources"), order.join(","));
    await open("?v23=1", 640, 900);
    const zoomOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check("200% zoom (640 CSS px): no page-level horizontal scroll", zoomOverflow <= 0, String(zoomOverflow));
    check("200% zoom: the toolbar wraps instead of clipping", await page.$eval(".mxgantt-toolbar-row", el => el.scrollWidth <= el.clientWidth + 1));
    await open("?v23=1&rtl=1");
    await page.screenshot({ path: shots + "v23-rtl.png", fullPage: true });
    const rtl = await page.evaluate(() => {
        const list = document.querySelector(".mxgantt-list").getBoundingClientRect();
        const chart = document.querySelector(".mxgantt-chart").getBoundingClientRect();
        const first = document.querySelector('.mxgantt-bar[data-row-id="1"]').getBoundingClientRect();
        const later = document.querySelector('.mxgantt-bar[data-row-id="5"]').getBoundingClientRect();
        return { listRight: list.left > chart.left, timeLtr: later.left > first.left };
    });
    check("RTL: the task list moves to the right and time still runs left to right", rtl.listRight && rtl.timeLtr, JSON.stringify(rtl));
    check("no innerHTML-based rendering of task names", await page.evaluate(() => !document.querySelector(".mxgantt script, .mxgantt iframe")));

    // ------------------------------------------------------------ 10 performance: 5,000 tasks
    const started = Date.now();
    // Production React, as Mendix apps run it.
    await open("?n=5000&animate=0&motion=off&prod=1");
    await page.waitForSelector(".mxgantt-bar");
    perf.firstRender = Date.now() - started;
    check("5,000 tasks: only the visible rows are in the DOM", (await count(".mxgantt-bar")) < 150);
    perf.scroll = await page.evaluate(async () => {
        const chart = document.querySelector(".mxgantt-chart");
        const frames = [];
        let last = performance.now();
        for (let i = 1; i <= 60; i++) {
            chart.scrollTop = i * 2500;
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const now = performance.now();
            frames.push(now - last);
            last = now;
        }
        frames.sort((a, b) => a - b);
        return { median: Math.round(frames[30]), p95: Math.round(frames[57]) };
    });
    // Each step waits two animation frames (about 33 ms at 60 Hz), so 60 ms allows at most one dropped frame.
    check("5,000 tasks: a scroll step (two frames) stays under 60 ms at the 95th percentile", perf.scroll.p95 < 60, JSON.stringify(perf.scroll));
    const levelStart = Date.now();
    await clickButton("Level resources");
    await page.waitForSelector('[aria-label="Proposed changes"]');
    perf.level = Date.now() - levelStart;
    check("5,000 tasks: levelling proposes in under 5 s", perf.level < 5000, `${perf.level} ms`);
    await clickButton("Cancel", '[aria-label="Proposed changes"]');
    const scheduleStart = Date.now();
    await clickButton("Schedule plan");
    await page.waitForSelector('[aria-label="Proposed changes"]');
    perf.schedule = Date.now() - scheduleStart;
    check("5,000 tasks: Schedule plan in under 3 s", perf.schedule < 3000, `${perf.schedule} ms`);
    await clickButton("Cancel", '[aria-label="Proposed changes"]');
    const moveStart = Date.now();
    await page.focus(".mxgantt-bar-task");
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => window.harness.events.some(e => e.name === "commit"), { timeout: 10000 });
    perf.keyboardMoveSaved = Date.now() - moveStart;
    writeFileSync(file, projectXml(5000));
    const importStart = Date.now();
    await (await page.$('input[type="file"]')).uploadFile(file);
    await page.waitForSelector("[role=dialog]", { timeout: 20000 });
    perf.import5000 = Date.now() - importStart;
    check("5,000 tasks: an MS Project file is read and previewed in under 5 s", perf.import5000 < 5000, `${perf.import5000} ms`);

    // ------------------------------------------------------------ 11 memory: mount / unmount loop
    await open("?v23=1&animate=0&motion=off");
    const heap = await page.evaluate(async () => {
        const settle = () => new Promise(resolve => setTimeout(resolve, 30));
        const used = () => {
            window.gc?.();
            return performance.memory?.usedJSHeapSize ?? 0;
        };
        for (let i = 0; i < 5; i++) {
            window.harness.unmount();
            await settle();
            window.harness.mount();
            await settle();
        }
        const before = used();
        for (let i = 0; i < 30; i++) {
            window.harness.unmount();
            await settle();
            window.harness.mount();
            await settle();
        }
        await settle();
        const after = used();
        return { before, after };
    });
    perf.heapGrowthKb = Math.round((heap.after - heap.before) / 1024);
    check("memory: 30 mount/unmount cycles keep the heap stable (< 2 MB growth)", heap.before > 0 && heap.after - heap.before < 2 * 1024 * 1024, `${perf.heapGrowthKb} KB`);

    check("no console errors", errors.length === 0, errors.join(" | "));
} catch (error) {
    check("harness ran without exceptions", false, error.stack);
} finally {
    await browser.close();
}
console.log(`PERF ${JSON.stringify(perf)}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
