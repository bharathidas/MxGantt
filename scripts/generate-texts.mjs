// Writes one translatable text property per entry of src/utils/texts.ts into src/MxGantt.xml,
// between the texts:begin and texts:end markers. Run after changing texts.ts:
//   node scripts/generate-texts.mjs
import { readFileSync, writeFileSync } from "node:fs";

const source = readFileSync(new URL("../src/utils/texts.ts", import.meta.url), "utf8");
const start = source.indexOf("export const TEXT_GROUPS = ");
const end = source.indexOf("} as const;", start);
const literal = source.slice(start + "export const TEXT_GROUPS = ".length, end + 1);
// The object is plain data (strings in plain objects), so evaluating it is safe.
const groups = Function(`"use strict"; return (${literal});`)();

const xmlPath = new URL("../src/MxGantt.xml", import.meta.url);
const xml = readFileSync(xmlPath, "utf8");
const begin = "<!-- texts:begin -->";
const finish = "<!-- texts:end -->";
if (!xml.includes(begin) || !xml.includes(finish)) {
    throw new Error("MxGantt.xml has no texts:begin / texts:end markers");
}

const escape = text => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const words = key =>
    key
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/^./, c => c.toUpperCase())
        .replace(/\b(Xlsx|Csv)\b/g, m => m.toUpperCase());
const captions = {
    Toolbar: "Toolbar",
    Grid: "Task list",
    Chart: "Timeline",
    Tooltip: "Tooltip",
    Messages: "Messages",
    Editing: "Editing",
    Filter: "Filter",
    Workload: "Workload",
    Help: "Shortcut help",
    Print: "Print",
    Planning: "Planning aids and health",
    Resources: "Resources and levelling",
    Baselines: "Baselines",
    Segments: "Split tasks",
    Constraints: "Constraints",
    Cost: "Cost and earned value",
    Import: "MS Project import",
    Portfolio: "Portfolio",
    Reliability: "Saving and errors",
    CustomFields: "Custom fields"
};
const pad = "            ";
let out = `${begin}\n`;
for (const [group, entries] of Object.entries(groups)) {
    out += `${pad}<propertyGroup caption="${captions[group] ?? group}">\n`;
    for (const [key, text] of Object.entries(entries)) {
        if (/[{}]/.test(text)) {
            throw new Error(`Text ${key} contains a brace, which Mendix text templates do not allow`);
        }
        const prop = `txt${key.charAt(0).toUpperCase()}${key.slice(1)}`;
        const placeholders = [...text.matchAll(/\[(\w+)\]/g)].map(m => `[${m[1]}]`);
        const hint = placeholders.length ? ` Keep ${[...new Set(placeholders)].join(", ")}: it is replaced when shown.` : "";
        out += `${pad}    <property key="${prop}" type="textTemplate" required="false">\n`;
        out += `${pad}        <caption>${escape(words(key))}</caption>\n`;
        out += `${pad}        <description>Default: ${escape(text)}${/[.?!]$/.test(text) ? "" : "."}${escape(hint)}</description>\n`;
        out += `${pad}        <translations>\n${pad}            <translation lang="en_US">${escape(text)}</translation>\n${pad}        </translations>\n`;
        out += `${pad}    </property>\n`;
    }
    out += `${pad}</propertyGroup>\n`;
}
out += `${pad}${finish}`;
const next = xml.slice(0, xml.indexOf(begin)) + out + xml.slice(xml.indexOf(finish) + finish.length);
writeFileSync(xmlPath, next);
console.log(`Wrote ${Object.values(groups).reduce((n, g) => n + Object.keys(g).length, 0)} text properties`);
