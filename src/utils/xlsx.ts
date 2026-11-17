import { zipStore } from "./zip";

/**
 * A minimal Office Open XML spreadsheet writer: one sheet with a bold, frozen header row, an
 * auto filter, column widths, outline levels (so groups can be folded in Excel), bold summary rows
 * and real numbers and dates (Excel serial numbers with a date format), not text that looks like
 * them. Strings are written inline, so there is no shared string table to keep in step.
 */

export type XlsxKind = "text" | "number" | "date" | "datetime" | "percent";

export interface XlsxColumn {
    title: string;
    kind: XlsxKind;
    /** In characters, as Excel measures widths. */
    width: number;
}

/** Text, a number (a fraction for percent columns), a date, or empty. */
export type XlsxValue = string | number | Date | undefined | null;

export interface XlsxRow {
    values: XlsxValue[];
    /** Summary rows, such as groups, are bold. */
    bold?: boolean;
    /** Outline level for Excel's row grouping: 0 for top-level rows, 1 for rows inside a group. */
    level?: number;
    /** Indents the first text column by this many steps. */
    indent?: number;
}

export interface XlsxSheet {
    name: string;
    columns: XlsxColumn[];
    rows: XlsxRow[];
}

const KINDS: XlsxKind[] = ["text", "number", "date", "datetime", "percent"];
const NUM_FMT: Record<XlsxKind, number> = { text: 0, number: 0, date: 164, datetime: 165, percent: 9 };

/** The style index for a cell: 0 is the default, 1 the header, then four variants per kind. */
export function styleIndex(kind: XlsxKind, bold: boolean, indent: boolean): number {
    return 2 + KINDS.indexOf(kind) * 4 + (bold ? 2 : 0) + (indent ? 1 : 0);
}

/** Excel's serial date: days since 1899-12-30, from the local calendar date and time as shown. */
export function excelSerial(date: Date): number {
    const utc = Date.UTC(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        date.getHours(),
        date.getMinutes(),
        date.getSeconds(),
        date.getMilliseconds()
    );
    return utc / 86400000 + 25569;
}

/** Column letters: 0 -> A, 25 -> Z, 26 -> AA. */
export function columnName(index: number): string {
    let name = "";
    let n = index + 1;
    while (n > 0) {
        const rest = (n - 1) % 26;
        name = String.fromCharCode(65 + rest) + name;
        n = Math.floor((n - 1) / 26);
    }
    return name;
}

export function xmlText(text: string): string {
    return (
        text
            // Control characters other than tab, line feed and carriage return are not allowed in XML.
            // eslint-disable-next-line no-control-regex
            .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
    );
}

function sheetName(name: string): string {
    // Excel refuses : \ / ? * [ ] in sheet names and anything over 31 characters.
    const clean = name.replace(/[:\\/?*[\]]/g, " ").trim() || "Sheet1";
    return clean.slice(0, 31);
}

function cellXml(ref: string, value: XlsxValue, kind: XlsxKind, bold: boolean, indent: boolean): string {
    if (value === undefined || value === null || value === "") {
        return bold ? `<c r="${ref}" s="${styleIndex(kind, bold, false)}"/>` : "";
    }
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) {
            return "";
        }
        const dateKind = kind === "datetime" ? "datetime" : "date";
        return `<c r="${ref}" s="${styleIndex(dateKind, bold, false)}"><v>${excelSerial(value)}</v></c>`;
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            return "";
        }
        const numberKind = kind === "percent" ? "percent" : "number";
        return `<c r="${ref}" s="${styleIndex(numberKind, bold, false)}"><v>${value}</v></c>`;
    }
    return `<c r="${ref}" s="${styleIndex("text", bold, indent)}" t="inlineStr"><is><t xml:space="preserve">${xmlText(
        value
    )}</t></is></c>`;
}

export function sheetXml(sheet: XlsxSheet): string {
    const lastColumn = columnName(Math.max(0, sheet.columns.length - 1));
    const lastRow = sheet.rows.length + 1;
    const range = `A1:${lastColumn}${lastRow}`;
    const firstText = sheet.columns.findIndex(column => column.kind === "text");
    const header = sheet.columns
        .map(
            (column, index) =>
                `<c r="${columnName(index)}1" s="1" t="inlineStr"><is><t xml:space="preserve">${xmlText(
                    column.title
                )}</t></is></c>`
        )
        .join("");
    const body = sheet.rows
        .map((row, rowIndex) => {
            const r = rowIndex + 2;
            const level = row.level && row.level > 0 ? ` outlineLevel="${Math.min(7, row.level)}"` : "";
            const cells = sheet.columns
                .map((column, index) =>
                    cellXml(
                        `${columnName(index)}${r}`,
                        row.values[index],
                        column.kind,
                        !!row.bold,
                        index === firstText && !!row.indent
                    )
                )
                .join("");
            return `<row r="${r}"${level}>${cells}</row>`;
        })
        .join("");
    const maxLevel = sheet.rows.reduce((max, row) => Math.max(max, row.level ?? 0), 0);
    const cols = sheet.columns
        .map(
            (column, index) =>
                `<col min="${index + 1}" max="${index + 1}" width="${Math.max(4, column.width)}" customWidth="1"/>`
        )
        .join("");
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheetPr><outlinePr summaryBelow="0"/></sheetPr>' +
        `<dimension ref="${range}"/>` +
        '<sheetViews><sheetView workbookViewId="0">' +
        '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
        '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' +
        "</sheetView></sheetViews>" +
        `<sheetFormatPr defaultRowHeight="15"${maxLevel > 0 ? ` outlineLevelRow="${Math.min(7, maxLevel)}"` : ""}/>` +
        `<cols>${cols}</cols>` +
        `<sheetData><row r="1">${header}</row>${body}</sheetData>` +
        `<autoFilter ref="${range}"/>` +
        '<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' +
        '<pageSetup orientation="landscape"/>' +
        "</worksheet>"
    );
}

export function stylesXml(): string {
    const xfs: string[] = [
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>'
    ];
    KINDS.forEach(kind => {
        [false, true].forEach(bold => {
            [false, true].forEach(indent => {
                const fmt = NUM_FMT[kind];
                const align = indent ? ' applyAlignment="1"><alignment indent="1"/></xf>' : "/>";
                xfs.push(
                    `<xf numFmtId="${fmt}" fontId="${bold ? 1 : 0}" fillId="0" borderId="0" xfId="0"` +
                        `${fmt ? ' applyNumberFormat="1"' : ""}${bold ? ' applyFont="1"' : ""}${align}`
                );
            });
        });
    });
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/>' +
        '<numFmt numFmtId="165" formatCode="yyyy\\-mm\\-dd hh:mm"/></numFmts>' +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
        '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
        '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF8"/><bgColor indexed="64"/></patternFill></fill></fills>' +
        '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
        '<border><left/><right/><top/><bottom style="thin"><color rgb="FF98A2B3"/></bottom><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        `<cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs>` +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
        "</styleSheet>"
    );
}

/** The .xlsx file for one sheet, as bytes ready for a Blob. */
export function buildXlsx(sheet: XlsxSheet): Uint8Array {
    const name = sheetName(sheet.name);
    const lastColumn = columnName(Math.max(0, sheet.columns.length - 1));
    const quoted = `'${name.replace(/'/g, "''")}'`;
    const filterRange = `${quoted}!$A$1:$${lastColumn}$${sheet.rows.length + 1}`;
    return zipStore([
        {
            name: "[Content_Types].xml",
            data:
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
                '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
                '<Default Extension="xml" ContentType="application/xml"/>' +
                '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
                '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
                '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
                "</Types>"
        },
        {
            name: "_rels/.rels",
            data:
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
                "</Relationships>"
        },
        {
            name: "xl/workbook.xml",
            data:
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
                'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
                `<sheets><sheet name="${xmlText(name)}" sheetId="1" r:id="rId1"/></sheets>` +
                `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">${xmlText(
                    filterRange
                )}</definedName></definedNames>` +
                "</workbook>"
        },
        {
            name: "xl/_rels/workbook.xml.rels",
            data:
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
                '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
                "</Relationships>"
        },
        { name: "xl/worksheets/sheet1.xml", data: sheetXml(sheet) },
        { name: "xl/styles.xml", data: stylesXml() }
    ]);
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
