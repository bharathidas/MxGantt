/**
 * CSV that Excel opens correctly: a UTF-8 byte order mark so accented names survive, CRLF line
 * ends, every field that needs it quoted, and cells that would start a formula made harmless.
 */

/** The UTF-8 byte order mark that tells Excel the file is UTF-8. */
const BOM = String.fromCharCode(0xfeff);
const NUMBER = /^-?\d+(?:[.,]\d+)?$/;

export function csvCell(value: string | number | undefined): string {
    let text = value === undefined ? "" : String(value);
    // =, +, - and @ start a formula in spreadsheets; a leading apostrophe keeps it text. Plain
    // negative numbers such as a variance of -2 are left alone.
    if (/^[=+@\t\r]/.test(text) || (text.startsWith("-") && !NUMBER.test(text))) {
        text = `'${text}`;
    }
    return /[",\r\n;]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: Array<Array<string | number | undefined>>): string {
    const lines = [header, ...rows].map(row => row.map(csvCell).join(","));
    return `${BOM}${lines.join("\r\n")}\r\n`;
}

/** Local date as yyyy-mm-dd, or with the time when it is not midnight or hours are shown. */
export function csvDate(date: Date | undefined, withTime: boolean): string {
    if (!date) {
        return "";
    }
    const pad = (n: number): string => String(n).padStart(2, "0");
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    return withTime ? `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}` : day;
}
