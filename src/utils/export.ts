import { barBox, baselineBox, HEADER_HEIGHT, HEADER_ROW, linkEnds, linkPath, milestoneBox } from "./geometry";
import { isMilestone, Link, linkType, Row, Task } from "./tasks";
import { dateToX, ScaleCell, scaleWidth, TimeScale, weekendSpans } from "./time";

/**
 * The whole chart as one standalone SVG document, for saving as an image and printing.
 *
 * The live chart only draws the rows on screen and is spread over two scrolling panes, so it
 * cannot simply be copied; this draws every row from the same model and geometry instead.
 */

export interface ExportPalette {
    background: string;
    text: string;
    muted: string;
    border: string;
    header: string;
    weekend: string;
    bar: string;
    group: string;
    milestone: string;
    today: string;
    link: string;
    conflict: string;
    critical: string;
    fontFamily: string;
    baseline?: string;
    /** 2.1: bars behind schedule and the status date line. */
    behind?: string;
    status?: string;
}

export type LegendKind =
    | "task"
    | "group"
    | "milestone"
    | "critical"
    | "conflict"
    | "baseline"
    | "today"
    | "behind"
    | "status";

export interface ExportHeader {
    title: string;
    range: string;
    legend: Array<{ label: string; kind: LegendKind; color?: string }>;
}

export interface ExportColumn {
    title: string;
    width: number;
    align: "left" | "right" | "center";
    text: (row: Row) => string;
}

export interface ExportInput {
    rows: Row[];
    tasks: Map<string, Task>;
    rowIndex: Map<string, number>;
    links: Link[];
    critical: ReadonlySet<string>;
    scale: TimeScale;
    cells: { top: ScaleCell[]; bottom: ScaleCell[] };
    columns: ExportColumn[];
    rowHeight: number;
    showWeekends: boolean;
    showToday: boolean;
    showLinks: boolean;
    today: Date;
    palette: ExportPalette;
    /** Non-working days to shade instead of weekends, when a working calendar is set. */
    shading?: Array<{ x: number; width: number }>;
    /** A title, date range and legend above the chart, for printing. */
    header?: ExportHeader;
    /** Tasks drawn in the behind-schedule colour. */
    behind?: ReadonlySet<string>;
    /** Where the status date line goes. */
    statusDate?: Date;
}

const TITLE_HEIGHT = 58;

function legendSvg(header: ExportHeader, p: ExportPalette, width: number): string {
    const parts: string[] = [];
    parts.push(textEl(12, 24, header.title, p.text, `font-size="17" font-weight="700"`));
    parts.push(textEl(width - 12, 24, header.range, p.muted, `text-anchor="end" font-size="12"`));
    let x = 12;
    const y = 44;
    header.legend.forEach(entry => {
        // One line of legend; entries that do not fit on it are left out rather than overlapping.
        if (x + 24 + entry.label.length * 6.6 > width - 12) {
            return;
        }
        const color = entry.color ?? p.bar;
        switch (entry.kind) {
            case "group":
                parts.push(rect(x, y - 4, 18, 5, p.group, `rx="1"`));
                break;
            case "milestone":
                parts.push(
                    `<polygon points="${x + 9},${y - 7} ${x + 15},${y - 1} ${x + 9},${y + 5} ${x + 3},${
                        y - 1
                    }" fill="${escapeXml(entry.color ?? p.milestone)}"/>`
                );
                break;
            case "critical":
                parts.push(rect(x, y - 6, 18, 10, "none", `rx="3" stroke="${escapeXml(p.critical)}" stroke-width="2"`));
                break;
            case "conflict":
                parts.push(rect(x, y - 6, 18, 10, p.conflict, `rx="3" opacity="0.8"`));
                break;
            case "baseline":
                parts.push(rect(x, y - 2, 18, 4, p.baseline ?? p.muted, `rx="1"`));
                break;
            case "today":
                parts.push(rect(x + 8, y - 8, 2, 14, p.today));
                break;
            case "behind":
                parts.push(rect(x, y - 6, 18, 10, p.behind ?? p.conflict, `rx="3"`));
                break;
            case "status":
                parts.push(rect(x + 8, y - 8, 2, 14, p.status ?? p.muted));
                break;
            default:
                parts.push(rect(x, y - 6, 18, 10, color, `rx="3"`));
        }
        parts.push(textEl(x + 24, y + 3, entry.label, p.text));
        x += 24 + entry.label.length * 6.6 + 18;
    });
    parts.push(rect(0, TITLE_HEIGHT - 0.5, width, 1, p.border));
    return parts.join("");
}

export function escapeXml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function textEl(x: number, y: number, text: string, fill: string, extra = ""): string {
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="${escapeXml(fill)}" ${extra}>${escapeXml(text)}</text>`;
}

function rect(x: number, y: number, width: number, height: number, fill: string, extra = ""): string {
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(0, width).toFixed(1)}" height="${Math.max(
        0,
        height
    ).toFixed(1)}" fill="${escapeXml(fill)}" ${extra}/>`;
}

/** Cuts a label down to roughly what fits, since SVG has no text-overflow. */
function fit(text: string, width: number, charWidth = 6.6): string {
    const max = Math.floor((width - 12) / charWidth);
    return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
}

export function buildSvg(input: ExportInput): { svg: string; width: number; height: number } {
    const { rows, rowHeight: rh, scale, palette: p } = input;
    const gridWidth = input.columns.reduce((sum, column) => sum + column.width, 0);
    const chartWidth = scaleWidth(scale);
    const width = Math.ceil(gridWidth + chartWidth);
    const bodyHeight = rows.length * rh;
    const top = input.header ? TITLE_HEIGHT : 0;
    const height = HEADER_HEIGHT + bodyHeight;
    const parts: string[] = [];
    const ox = gridWidth;
    const oy = HEADER_HEIGHT;

    parts.push(rect(0, 0, width, height, p.background));
    parts.push(rect(0, 0, width, HEADER_HEIGHT, p.header));

    // Task list.
    let colX = 0;
    input.columns.forEach(column => {
        const tx =
            column.align === "right"
                ? colX + column.width - 8
                : column.align === "center"
                ? colX + column.width / 2
                : colX + 8;
        const anchor =
            column.align === "right" ? 'text-anchor="end"' : column.align === "center" ? 'text-anchor="middle"' : "";
        parts.push(textEl(tx, HEADER_HEIGHT - 10, column.title, p.muted, `font-weight="600" ${anchor}`));
        rows.forEach((row, index) => {
            const indent = column === input.columns[0] && row.kind === "task" ? row.depth * 16 : 0;
            const label = fit(column.text(row), column.width - indent);
            const weight = row.kind === "group" ? 'font-weight="600"' : "";
            parts.push(textEl(tx + indent, oy + index * rh + rh / 2 + 4, label, p.text, `${weight} ${anchor}`));
        });
        colX += column.width;
        parts.push(rect(colX - 0.5, 0, 1, height, p.border));
    });

    // Timeline background: weekends, grid lines, row lines.
    if (input.showWeekends) {
        (input.shading ?? weekendSpans(scale)).forEach(span =>
            parts.push(rect(ox + span.x, oy, span.width, bodyHeight, p.weekend))
        );
    }
    input.cells.bottom.forEach(cell => {
        parts.push(rect(ox + cell.x, HEADER_ROW, 1, height - HEADER_ROW, p.border, 'opacity="0.6"'));
        parts.push(
            textEl(ox + cell.x + cell.width / 2, HEADER_HEIGHT - 9, cell.label, p.muted, 'text-anchor="middle"')
        );
    });
    input.cells.top.forEach(cell => {
        parts.push(rect(ox + cell.x, 0, 1, HEADER_ROW, p.border));
        parts.push(textEl(ox + cell.x + 8, HEADER_ROW - 9, cell.label, p.text, 'font-weight="600"'));
    });
    parts.push(rect(0, HEADER_ROW - 0.5, width, 1, p.border, 'opacity="0.6"'));
    parts.push(rect(0, HEADER_HEIGHT - 0.5, width, 1, p.border));
    rows.forEach((_, index) => parts.push(rect(0, oy + (index + 1) * rh - 0.5, width, 1, p.border, 'opacity="0.4"')));

    // Links under the bars.
    if (input.showLinks) {
        // One marker per colour: context-stroke is not supported everywhere yet.
        const marker = (id: string, fill: string): string =>
            `<marker id="${id}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">` +
            `<path d="M0,0 L8,4 L0,8 z" fill="${escapeXml(fill)}"/></marker>`;
        parts.push(`<defs>${marker("al", p.link)}${marker("ac", p.conflict)}${marker("ak", p.critical)}</defs>`);
        input.links.forEach(link => {
            const from = input.tasks.get(link.from);
            const to = input.tasks.get(link.to);
            const fromRow = input.rowIndex.get(link.from);
            const toRow = input.rowIndex.get(link.to);
            if (
                !from?.start ||
                !from.end ||
                !to?.start ||
                !to.end ||
                fromRow === undefined ||
                toRow === undefined ||
                fromRow === toRow
            ) {
                return;
            }
            const type = linkType(link);
            const ends = linkEnds(type);
            const d = linkPath(
                {
                    x: ox + dateToX(ends.from === "end" ? from.end : from.start, scale),
                    y: oy + fromRow * rh + rh / 2
                },
                { x: ox + dateToX(ends.to === "start" ? to.start : to.end, scale), y: oy + toRow * rh + rh / 2 },
                rh,
                type
            );
            const onPath = input.critical.has(link.from) && input.critical.has(link.to);
            const stroke = link.conflict ? p.conflict : onPath ? p.critical : p.link;
            const markerId = link.conflict ? "ac" : onPath ? "ak" : "al";
            const dash = link.conflict ? 'stroke-dasharray="4 3"' : "";
            parts.push(
                `<path d="${d}" fill="none" stroke="${escapeXml(
                    stroke
                )}" stroke-width="1.5" ${dash} marker-end="url(#${markerId})"/>`
            );
        });
    }

    // Bars.
    rows.forEach((row, index) => {
        const y = oy + index * rh;
        if (row.kind === "group") {
            if (!row.start || !row.end) {
                return;
            }
            const box = barBox(row.start, row.end, scale, rh, "group");
            parts.push(rect(ox + box.x, y + box.top, box.width, box.height, p.group, 'rx="2"'));
            return;
        }
        const task = row.task;
        if (!task.start || !task.end) {
            return;
        }
        const critical = input.critical.has(task.id);
        const behind = !!input.behind?.has(task.id);
        const color = behind && p.behind ? p.behind : task.color || (isMilestone(task) ? p.milestone : p.bar);
        if (task.baselineStart && task.baselineEnd && task.baselineEnd > task.baselineStart) {
            const base = baselineBox(task.baselineStart, task.baselineEnd, scale, rh);
            parts.push(rect(ox + base.x, y + base.top, base.width, base.height, p.baseline ?? p.muted, `rx="1"`));
        }
        let labelX: number;
        if (isMilestone(task)) {
            const box = milestoneBox(task.start, scale, rh);
            const cx = ox + box.x + box.width / 2;
            const cy = y + rh / 2;
            const r = box.width / 2;
            const stroke = critical ? `stroke="${escapeXml(p.critical)}" stroke-width="2"` : "";
            parts.push(
                `<polygon points="${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}" fill="${escapeXml(
                    color
                )}" ${stroke}/>`
            );
            labelX = cx + r + 12;
        } else {
            const box = barBox(task.start, task.end, scale, rh, "task");
            const stroke = critical ? `stroke="${escapeXml(p.critical)}" stroke-width="2"` : "";
            parts.push(rect(ox + box.x, y + box.top, box.width, box.height, color, `rx="4" opacity="0.4"`));
            if (task.progress !== undefined && task.progress > 0) {
                parts.push(
                    rect(ox + box.x, y + box.top, (box.width * task.progress) / 100, box.height, color, 'rx="4"')
                );
            }
            if (critical) {
                parts.push(
                    `<rect x="${(ox + box.x).toFixed(1)}" y="${(y + box.top).toFixed(1)}" width="${box.width.toFixed(
                        1
                    )}" height="${box.height}" rx="4" fill="none" ${stroke}/>`
                );
            }
            labelX = ox + box.x + box.width + 12;
        }
        parts.push(textEl(labelX, y + rh / 2 + 4, task.name, p.text));
    });

    if (input.statusDate) {
        const x = ox + dateToX(input.statusDate, scale);
        if (x >= ox && x <= width) {
            parts.push(
                `<line x1="${x.toFixed(1)}" y1="${HEADER_ROW}" x2="${x.toFixed(1)}" y2="${height}" stroke="${escapeXml(
                    p.status ?? p.muted
                )}" stroke-width="2" stroke-dasharray="6 4"/>`
            );
        }
    }
    if (input.showToday) {
        const x = ox + dateToX(input.today, scale);
        if (x >= ox && x <= width) {
            parts.push(rect(x - 1, HEADER_ROW, 2, height - HEADER_ROW, p.today));
        }
    }

    const body = top > 0 ? `<g transform="translate(0 ${top})">${parts.join("")}</g>` : parts.join("");
    const heading = input.header ? rect(0, 0, width, top, p.background) + legendSvg(input.header, p, width) : "";
    const total = height + top;
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${total}" viewBox="0 0 ${width} ${total}" ` +
        `font-family="${escapeXml(p.fontFamily)}" font-size="12">${heading}${body}</svg>`;
    return { svg, width, height: total };
}

/** Browsers refuse canvases much beyond 16k pixels a side, so big charts are scaled down to fit. */
export function exportScale(width: number, height: number, preferred = 2, maxSide = 16000, maxArea = 120e6): number {
    const bySide = Math.min(maxSide / width, maxSide / height);
    const byArea = Math.sqrt(maxArea / Math.max(1, width * height));
    return Math.max(0.1, Math.min(preferred, bySide, byArea));
}

export function svgToPng(svg: string, width: number, height: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const ratio = exportScale(width, height);
        const image = new Image();
        image.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(width * ratio);
            canvas.height = Math.round(height * ratio);
            const context = canvas.getContext("2d");
            if (!context) {
                reject(new Error("no canvas"));
                return;
            }
            context.scale(ratio, ratio);
            context.drawImage(image, 0, 0, width, height);
            canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error("no image"))), "image/png");
        };
        image.onerror = () => reject(new Error("the chart could not be drawn"));
        // A data URL rather than a blob URL: the image never taints the canvas this way.
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
}

export function downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Prints the chart from a hidden frame, so the page's own layout and menus stay out of it. */
export function printSvg(svg: string, title: string): void {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) {
        frame.remove();
        return;
    }
    doc.open();
    doc.write(
        `<!doctype html><html><head><meta charset="utf-8"><title>${escapeXml(title)}</title>` +
            "<style>@page{size:landscape;margin:10mm}html,body{margin:0}svg{width:100%;height:auto}</style>" +
            `</head><body>${svg}</body></html>`
    );
    doc.close();
    const cleanUp = (): void => {
        setTimeout(() => frame.remove(), 500);
    };
    win.addEventListener("afterprint", cleanUp);
    setTimeout(() => {
        win.focus();
        win.print();
        // Some browsers never fire afterprint for frames; do not leave the frame behind for ever.
        setTimeout(cleanUp, 60000);
    }, 50);
}
