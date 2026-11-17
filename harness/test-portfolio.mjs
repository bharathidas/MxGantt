// 1.3 browser suite: the portfolio timeline (year zoom, code and second line, status colours,
// dashed baseline frames, business need diamonds, finish-and-progress labels, labelled today line,
// bar legend), with screenshots at 1600 and 1024 px in light and dark.
//   node harness/build.mjs && node harness/test-portfolio.mjs
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const here = fileURLToPath(new URL(".", import.meta.url));
const pageUrl = pathToFileURL(here + "index.html").href;
const shots = here + "dist/shots/portfolio/";
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

async function open(query, width = 1600, height = 1000) {
    await page.setViewport({ width, height });
    await page.goto(`${pageUrl}${query}`);
    await page.waitForSelector(".mxgantt-list-row");
    await wait(900);
}

await open("?portfolio=1&animate=0");

const years = await page.$$eval(".mxgantt-scale-bottom", cells => cells.map(cell => cell.textContent.trim()));
check("year zoom shows the years", ["2023", "2024", "2027", "2030"].every(year => years.includes(year)), years.join());
check(
    "Year is the pressed zoom button",
    await page.evaluate(
        () =>
            [...document.querySelectorAll(".mxgantt-toolbar button")].find(b => b.textContent.trim() === "Year")
                ?.getAttribute("aria-pressed") === "true"
    )
);

const groups = await page.$$eval(".mxgantt-list-group .mxgantt-name", cells => cells.map(c => c.textContent.trim()));
// Rows are virtualised: only what is on screen (plus some overscan) is drawn.
check("company groups", groups.length >= 2 && groups[0] === "Grid technologies", groups.join());
const groupStyle = await page.$eval(".mxgantt-list-group .mxgantt-name", el => getComputedStyle(el).textTransform);
check("group headings in capitals", groupStyle === "uppercase", groupStyle);
const groupBarsHidden = await page.$$eval(".mxgantt-bar-group", bars =>
    bars.every(bar => getComputedStyle(bar).backgroundColor === "rgba(0, 0, 0, 0)")
);
check("no summary bars", groupBarsHidden);

const first = await page.evaluate(() => {
    const row = document.querySelector(".mxgantt-list-row:not(.mxgantt-list-group)");
    return {
        code: row.querySelector(".mxgantt-code")?.textContent,
        name: row.querySelector(".mxgantt-name")?.textContent,
        subtitle: row.querySelector(".mxgantt-subtitle")?.textContent,
        height: row.getBoundingClientRect().height
    };
});
check("code before the name", first.code === "01.01" && first.name === "Riverside", JSON.stringify(first));
check("second line under the name", first.subtitle === "Lukas Becker · PM400", first.subtitle);
check("two-line rows are 64 px", Math.round(first.height) === 64, String(first.height));

const labels = await page.$$eval(".mxgantt-bar-label", els => els.map(el => el.textContent.trim()));
check(
    "bar labels show finish month and progress",
    labels.length >= 12 && labels.every(text => /^\d\d\.\d{4} · \d+ %$/.test(text)),
    labels.slice(0, 4).join(" | ")
);
check("Riverside reads 05.2027 · 45 %", labels.includes("05.2027 · 45 %"), labels[0]);

const bars = await page.evaluate(() =>
    [...document.querySelectorAll(".mxgantt-bar-task")].map(bar => ({
        id: bar.dataset.rowId,
        color: bar.style.getPropertyValue("--mxgantt-task-color"),
        height: bar.getBoundingClientRect().height,
        right: bar.getBoundingClientRect().right
    }))
);
const byId = Object.fromEntries(bars.map(bar => [bar.id, bar]));
check("Capacity short bar is red", byId.p1?.color === "#e01e2b", byId.p1?.color);
check("At risk bar is orange", byId.p6?.color === "#c77700", byId.p6?.color);
check("On track bar is purple", byId.p2?.color === "#45206b", byId.p2?.color);
check("bars are slim", bars.every(bar => bar.height <= 20), String(bars[0]?.height));

const frames = await page.$$eval(".mxgantt-baseline.is-outline", els =>
    els.map(el => ({ style: getComputedStyle(el).borderTopStyle, h: el.getBoundingClientRect().height }))
);
check("dashed baseline frames", frames.length === bars.length && frames.every(f => f.style === "dashed"), `${frames.length} of ${bars.length}`);
const diamonds = await page.$$eval(".mxgantt-deadline.is-diamond", els =>
    els.map(el => ({ t: getComputedStyle(el).transform, box: el.getBoundingClientRect() }))
);
check("business need diamonds", diamonds.length === bars.length && diamonds.every(d => d.t !== "none"), `${diamonds.length} of ${bars.length}`);

// The label starts after the bar and after the diamond, never on top of them.
const overlaps = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll(".mxgantt-bar-label").forEach(label => {
        const top = parseFloat(label.style.top);
        const left = label.getBoundingClientRect().left;
        const sameRow = el => Math.abs(el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2 - label.getBoundingClientRect().top - label.getBoundingClientRect().height / 2) < 8;
        document.querySelectorAll(".mxgantt-deadline.is-diamond, .mxgantt-bar-task").forEach(el => {
            if (sameRow(el) && el.getBoundingClientRect().right > left + 1) {
                out.push(label.textContent + " @" + top);
            }
        });
    });
    return out;
});
check("labels clear the bar and the diamond", overlaps.length === 0, overlaps.slice(0, 3).join());

const legend = await page.$$eval(".mxgantt-legend li", items => items.map(item => item.textContent.trim()));
check(
    "bar legend with the configured texts",
    JSON.stringify(legend) ===
        JSON.stringify([
            "Progress (actual %)",
            "Remaining to forecast",
            "I-App baseline",
            "Business need",
            "Bar red: capacity need will not be met"
        ]),
    legend.join(" | ")
);

const today = await page.evaluate(() => ({
    label: document.querySelector(".mxgantt-today-label")?.textContent,
    line: getComputedStyle(document.querySelector(".mxgantt-today")).borderLeftStyle
}));
check("labelled dashed today line", today.label === "Today" && today.line === "dashed", JSON.stringify(today));

// Clicking a project runs On task click (the demo opens its schedule).
await page.click(".mxgantt-list-row:not(.mxgantt-list-group) .mxgantt-cell-name");
await wait(200);
const clicks = await page.evaluate(() => window.harness.events.filter(event => event.name === "onTaskClick"));
check("row click runs On task click", clicks.length === 1 && clicks[0].id === "p1", JSON.stringify(clicks));
await page.click(".mxgantt-bar-task[data-row-id='p2']");
await wait(200);
const barClicks = await page.evaluate(() => window.harness.events.filter(event => event.name === "onTaskClick"));
check("bar click runs On task click", barClicks.length === 2 && barClicks[1].id === "p2", JSON.stringify(barClicks));

await page.screenshot({ path: shots + "portfolio-1600-light.png" });

await open("?portfolio=1&animate=0&theme=dark");
await page.screenshot({ path: shots + "portfolio-1600-dark.png" });
const darkText = await page.$eval(".mxgantt-list-row:not(.mxgantt-list-group) .mxgantt-name", el => getComputedStyle(el).color);
check("dark mode text is light", darkText !== "rgb(31, 35, 40)", darkText);

await open("?portfolio=1&animate=0", 1024, 800);
await page.screenshot({ path: shots + "portfolio-1024-light.png" });
const scrollable = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
check("no page overflow at 1024 px", scrollable);

await open("?portfolio=1&animate=0&label=none");
check("Bar label None leaves labels out", (await page.$$(".mxgantt-bar-label")).length === 0);

check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
