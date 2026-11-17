// Drives the harness in headless Chrome and prints PASS/FAIL per check: node harness/test.mjs
import puppeteer from "puppeteer-core";
import { fileURLToPath, pathToFileURL } from "node:url";

// Any Chromium-based browser works; set CHROME_PATH to use an open-source Chromium build.
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const pageUrl = pathToFileURL(fileURLToPath(new URL("index.html", import.meta.url))).href;

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

async function open(query = "", width = 1280) {
    await page.setViewport({ width, height: 900 });
    await page.goto(`${pageUrl}${query}`);
    await page.waitForSelector(".mxgantt");
    await wait(250);
}
const count = selector => page.$$eval(selector, elements => elements.length);
const text = selector => page.$eval(selector, element => element.textContent ?? "");
const lastEvent = name => page.evaluate(n => [...window.harness.events].reverse().find(e => e.name === n), name);
const DAY = 86400000;

try {
    // 1 - planning aids render
    await open();
    check("renders six task bars", (await count(".mxgantt-bar-task, .mxgantt-milestone")) === 6);
    check("project health strip is a labelled region", (await count('section.mxgantt-health[aria-label="Project health"]')) === 1);
    await wait(900);
    const healthText = await text(".mxgantt-health");
    check("health shows complete, schedule index and forecast finish", /Complete/.test(healthText) && /Schedule index/.test(healthText) && /Forecast finish/.test(healthText), healthText);
    check("health counts missed deadlines", /2\s*Missed deadlines/.test(healthText), healthText);
    check("SPI count-up settles on the computed value", await page.$eval(".mxgantt-health-tile:nth-of-type(2) .mxgantt-health-value", el => el.textContent === Number(el.dataset.value).toFixed(2)));
    check("float tails are drawn for tasks with slack", (await count(".mxgantt-float")) >= 1);
    const uiFloat = await page.$eval('.mxgantt-bar[data-row-id="4"]', bar => {
        const tail = [...document.querySelectorAll(".mxgantt-float")].find(el => Math.abs(parseFloat(el.style.left) - (parseFloat(bar.style.left) + parseFloat(bar.style.width))) < 2);
        return tail ? parseFloat(tail.style.width) : 0;
    });
    check("Build UI has a float tail of about four days", uiFloat > 50, String(uiFloat));
    check("deadline flags are drawn", (await count(".mxgantt-deadline")) === 3);
    check("missed deadlines are flagged", (await count(".mxgantt-deadline.is-missed")) === 2);
    check("bars that miss their deadline are outlined", (await count(".mxgantt-bar.is-missed")) === 2);
    check("timeline markers show their labels", (await page.$$eval(".mxgantt-marker-flag", els => els.map(el => el.textContent).join("|"))) === "Code freeze|Launch");
    check("marker colour comes from configuration", await page.$eval(".mxgantt-marker-line", el => getComputedStyle(el).borderLeftColor === "rgb(196, 50, 10)"));
    const points = await page.$eval(".mxgantt-progress-line polyline", el => el.getAttribute("points").split(" ").length);
    check("progress line runs through every task with progress", points === 18, String(points));
    check("legend lists float, progress line and deadline", /Total float/.test(await text(".mxgantt-legend")) && /Progress line/.test(await text(".mxgantt-legend")) && /Deadline/.test(await text(".mxgantt-legend")));

    // 2 - tooltip
    await page.hover('.mxgantt-bar[data-row-id="2"]');
    await wait(150);
    const tip = await text(".mxgantt-tooltip");
    check("tooltip shows deadline and overrun", /Deadline/.test(tip) && /Misses its deadline by 1 days/.test(tip), tip);
    await page.hover('.mxgantt-bar[data-row-id="4"]');
    await wait(150);
    check("tooltip shows total float", /Total float/.test(await text(".mxgantt-tooltip")));

    // 3 - zoom to fit
    await open("?zoom=quarter");
    check("starts at quarter zoom", await page.$$eval(".mxgantt-segment button", bs => bs.find(b => b.getAttribute("aria-pressed") === "true")?.textContent) === "Quarter");
    await page.click(".mxgantt-button-fit");
    await wait(500);
    const pressed = await page.$$eval(".mxgantt-segment button", bs => bs.find(b => b.getAttribute("aria-pressed") === "true")?.textContent);
    check("Fit zooms in to the most detailed level that shows the plan", pressed === "Week", pressed);
    const firstBar = await page.$eval('.mxgantt-bar[data-row-id="1"]', bar => {
        const chart = document.querySelector(".mxgantt-chart");
        return parseFloat(bar.style.left) - chart.scrollLeft;
    });
    check("Fit scrolls the plan start into view", firstBar >= 0 && firstBar < 120, String(firstBar));
    const lastVisible = await page.$eval('.mxgantt-milestone[data-row-id="6"]', bar => {
        const chart = document.querySelector(".mxgantt-chart");
        return parseFloat(bar.style.left) - chart.scrollLeft <= chart.clientWidth;
    });
    check("Fit shows the end of the plan too", lastVisible);
    await open("?zoom=quarter");
    await page.focus('.mxgantt-bar[data-row-id="1"]');
    await page.keyboard.press("f");
    await wait(400);
    check("F key zooms to fit", (await page.$$eval(".mxgantt-segment button", bs => bs.find(b => b.getAttribute("aria-pressed") === "true")?.textContent)) === "Week");

    // 4 - keyboard reschedule writes back and health follows
    await open();
    const before = (await page.evaluate(() => window.harness.store())).find(row => row.id === "4").Start;
    await page.focus('.mxgantt-bar[data-row-id="4"]');
    await page.keyboard.press("ArrowRight");
    await wait(1200);
    const after = (await page.evaluate(() => window.harness.store())).find(row => row.id === "4").Start;
    check("keyboard move writes the new start", after - before === DAY, `${(after - before) / DAY}`);
    check("On task change runs", (await lastEvent("onTaskChange"))?.id === "4");

    // 5 - options off, motion, theme, empty and loading
    await open("?slack=0&pline=0&markers=0&health=0&fit=0&deadline=0");
    check("with the options off nothing new is drawn", (await count(".mxgantt-float, .mxgantt-deadline, .mxgantt-marker-line, .mxgantt-health, .mxgantt-progress-line, .mxgantt-button-fit")) === 0);
    await open("?motion=subtle");
    check("Motion subtle sets the subtle class", await page.$eval(".mxgantt", el => el.classList.contains("mxgantt--subtle")));
    await open("?motion=off");
    check("Motion off switches animations off", await page.$eval(".mxgantt", el => !el.classList.contains("mxgantt--animate")));
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await open();
    check("reduced motion switches animations off", await page.$eval(".mxgantt", el => !el.classList.contains("mxgantt--animate")));
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    await open("?theme=dark");
    check("dark theme applies", await page.$eval(".mxgantt", el => el.classList.contains("mxgantt--dark")));
    await open("?empty=1");
    check("empty plan shows the illustration", (await count(".mxgantt-empty-state svg")) === 1);
    await page.click(".mxgantt-empty-add");
    check("empty state Add task runs On add", !!(await lastEvent("onAdd")));
    await open("?loading=1");
    check("loading shows a skeleton", (await count(".mxgantt-skeleton-bar")) === 5);
    await open("", 360);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check("no page-level horizontal scroll at 360px", overflow <= 0, String(overflow));

    check("no console errors", errors.length === 0, errors.join(" | "));
} catch (error) {
    check("harness ran without exceptions", false, error.stack);
} finally {
    await browser.close();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
