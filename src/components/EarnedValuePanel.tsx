import classNames from "classnames";
import { KeyboardEvent, memo, PointerEvent, ReactElement, useId, useRef, useState } from "react";

import { EarnedValue, SCurve } from "../utils/cost";
import { fill, Texts } from "../utils/texts";

export interface EarnedValuePanelProps {
    texts: Texts;
    value: EarnedValue;
    curve?: SCurve;
    statusDate: Date;
    formatMoney: (value: number) => string;
    formatDate: (date: Date | undefined) => string;
    animate: boolean;
}

const WIDTH = 640;
const HEIGHT = 220;
const PAD = { left: 64, right: 16, top: 12, bottom: 28 };

function tone(index: number | undefined): "good" | "warning" | "bad" | "none" {
    if (index === undefined) {
        return "none";
    }
    return index >= 0.95 ? "good" : index >= 0.85 ? "warning" : "bad";
}

/** Rounded, readable axis steps: 1, 2 or 5 times a power of ten. */
export function niceStep(range: number, ticks: number): number {
    if (range <= 0) {
        return 1;
    }
    const raw = range / ticks;
    const power = Math.pow(10, Math.floor(Math.log10(raw)));
    const factor = raw / power;
    return (factor <= 1 ? 1 : factor <= 2 ? 2 : factor <= 5 ? 5 : 10) * power;
}

/**
 * 2.3 earned value: the eleven EVM figures as tiles (indices coloured good / at risk / off track,
 * with a word, never colour alone) and the S-curve - cumulative planned value, earned value and
 * actual cost with the forecast to completion - as an SVG with a crosshair tooltip that follows the
 * pointer or the arrow keys, and a table of the numbers for screen readers and print.
 */
function EarnedValuePanelView(props: EarnedValuePanelProps): ReactElement {
    const { texts, value, curve, formatMoney } = props;
    const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
    const [hover, setHover] = useState<number>();
    const [table, setTable] = useState(false);
    const svgRef = useRef<SVGSVGElement>(null);
    const index = (number: number | undefined): string => (number === undefined ? "–" : number.toFixed(2));
    const tiles: Array<{ key: string; label: string; text: string; tone?: string }> = [
        { key: "bac", label: texts.evBac, text: formatMoney(value.bac) },
        { key: "pv", label: texts.evPv, text: formatMoney(value.pv) },
        { key: "ev", label: texts.evEv, text: formatMoney(value.ev) },
        { key: "ac", label: texts.evAc, text: formatMoney(value.ac) },
        { key: "cv", label: texts.evCv, text: formatMoney(value.cv), tone: value.cv < 0 ? "bad" : "good" },
        { key: "sv", label: texts.evSv, text: formatMoney(value.sv), tone: value.sv < 0 ? "bad" : "good" },
        { key: "cpi", label: texts.evCpi, text: index(value.cpi), tone: tone(value.cpi) },
        { key: "spi", label: texts.evSpi, text: index(value.spi), tone: tone(value.spi) },
        { key: "eac", label: texts.evEac, text: formatMoney(value.eac) },
        { key: "etc", label: texts.evEtc, text: formatMoney(value.etc) },
        { key: "vac", label: texts.evVac, text: formatMoney(value.vac), tone: value.vac < 0 ? "bad" : "good" }
    ];
    const toneWord = (name: string | undefined): string =>
        name === "good"
            ? texts.healthGood
            : name === "warning"
            ? texts.healthWarning
            : name === "bad"
            ? texts.healthBad
            : "";

    let chart: ReactElement | null = null;
    if (curve && curve.dates.length > 1) {
        const first = curve.dates[0].getTime();
        const last = Math.max(curve.dates[curve.dates.length - 1].getTime(), curve.forecastFinish?.getTime() ?? 0);
        const top =
            Math.max(curve.bac, curve.eac, ...curve.pv, ...curve.ev.map(v => v ?? 0), ...curve.ac.map(v => v ?? 0)) ||
            1;
        const step = niceStep(top, 4);
        const yMax = Math.ceil(top / step) * step;
        const x = (time: number): number =>
            PAD.left + ((time - first) / Math.max(1, last - first)) * (WIDTH - PAD.left - PAD.right);
        const y = (amount: number): number => HEIGHT - PAD.bottom - (amount / yMax) * (HEIGHT - PAD.top - PAD.bottom);
        const line = (values: Array<number | undefined>): string =>
            values
                .map((amount, i) =>
                    amount === undefined
                        ? undefined
                        : `${x(curve.dates[i].getTime()).toFixed(1)},${y(amount).toFixed(1)}`
                )
                .filter(Boolean)
                .join(" ");
        const status = curve.statusDate.getTime();
        const statusIndex = curve.ac.reduce<number>((found, amount, i) => (amount !== undefined ? i : found), -1);
        const acNow = statusIndex >= 0 ? curve.ac[statusIndex] ?? 0 : 0;
        const forecast =
            curve.forecastFinish && curve.forecastFinish.getTime() > status
                ? `${x(status).toFixed(1)},${y(acNow).toFixed(1)} ${x(curve.forecastFinish.getTime()).toFixed(1)},${y(
                      curve.eac
                  ).toFixed(1)}`
                : "";
        const yTicks: number[] = [];
        for (let tick = 0; tick <= yMax + step / 2; tick += step) {
            yTicks.push(tick);
        }
        const xTicks = [0, 0.25, 0.5, 0.75, 1].map(part => first + (last - first) * part);
        const pick = (clientX: number): void => {
            const box = svgRef.current?.getBoundingClientRect();
            if (!box || box.width === 0) {
                return;
            }
            const svgX = ((clientX - box.left) / box.width) * WIDTH;
            let best = 0;
            curve.dates.forEach((date, i) => {
                if (Math.abs(x(date.getTime()) - svgX) < Math.abs(x(curve.dates[best].getTime()) - svgX)) {
                    best = i;
                }
            });
            setHover(best);
        };
        const onKey = (event: KeyboardEvent<SVGSVGElement>): void => {
            if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                event.preventDefault();
                event.stopPropagation();
                const next = (hover ?? (statusIndex >= 0 ? statusIndex : 0)) + (event.key === "ArrowRight" ? 1 : -1);
                setHover(Math.max(0, Math.min(curve.dates.length - 1, next)));
            } else if (event.key === "Escape") {
                setHover(undefined);
            }
        };
        const hx = hover === undefined ? undefined : x(curve.dates[hover].getTime());
        const tipLeft = hx === undefined ? 0 : (hx / WIDTH) * 100;
        chart = (
            <figure className="mxgantt-scurve">
                <svg
                    ref={svgRef}
                    viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                    role="img"
                    tabIndex={0}
                    aria-labelledby={`${id}-title ${id}-desc`}
                    className={classNames({ "is-animated": props.animate })}
                    onPointerMove={(event: PointerEvent<SVGSVGElement>) => pick(event.clientX)}
                    onPointerLeave={() => setHover(undefined)}
                    onKeyDown={onKey}
                    onBlur={() => setHover(undefined)}
                >
                    <title id={`${id}-title`}>{texts.sCurve}</title>
                    <desc id={`${id}-desc`}>
                        {fill(texts.sCurveDesc, {
                            date: props.formatDate(curve.statusDate),
                            bac: formatMoney(curve.bac),
                            eac: formatMoney(curve.eac)
                        })}
                    </desc>
                    {yTicks.map(tick => (
                        <g key={tick} className="mxgantt-scurve-grid">
                            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} />
                            <text x={PAD.left - 6} y={y(tick) + 4} textAnchor="end">
                                {formatMoney(tick)}
                            </text>
                        </g>
                    ))}
                    {xTicks.map(time => (
                        <text key={time} className="mxgantt-scurve-axis" x={x(time)} y={HEIGHT - 8} textAnchor="middle">
                            {props.formatDate(new Date(time))}
                        </text>
                    ))}
                    <line
                        className="mxgantt-scurve-status"
                        x1={x(status)}
                        x2={x(status)}
                        y1={PAD.top}
                        y2={HEIGHT - PAD.bottom}
                    />
                    <line
                        className="mxgantt-scurve-bac"
                        x1={PAD.left}
                        x2={WIDTH - PAD.right}
                        y1={y(curve.bac)}
                        y2={y(curve.bac)}
                    />
                    <polyline className="mxgantt-scurve-line is-pv" points={line(curve.pv)} pathLength={1} />
                    <polyline className="mxgantt-scurve-line is-ac" points={line(curve.ac)} pathLength={1} />
                    <polyline className="mxgantt-scurve-line is-ev" points={line(curve.ev)} pathLength={1} />
                    {forecast && <polyline className="mxgantt-scurve-line is-eac" points={forecast} />}
                    {hx !== undefined && hover !== undefined && (
                        <g className="mxgantt-scurve-cross" aria-hidden="true">
                            <line x1={hx} x2={hx} y1={PAD.top} y2={HEIGHT - PAD.bottom} />
                            {[
                                { kind: "pv", amount: curve.pv[hover] },
                                { kind: "ev", amount: curve.ev[hover] },
                                { kind: "ac", amount: curve.ac[hover] }
                            ]
                                .filter(point => point.amount !== undefined)
                                .map(point => (
                                    <circle
                                        key={point.kind}
                                        className={`is-${point.kind}`}
                                        cx={hx}
                                        cy={y(point.amount!)}
                                        r={4}
                                    />
                                ))}
                        </g>
                    )}
                </svg>
                {hover !== undefined && (
                    <div
                        className="mxgantt-scurve-tip"
                        style={{ left: `${Math.min(80, Math.max(2, tipLeft))}%` }}
                        role="status"
                        aria-live="polite"
                    >
                        <strong>{props.formatDate(curve.dates[hover])}</strong>
                        <span>
                            <i className="is-pv" aria-hidden="true" />
                            {`${texts.legendPv}: ${formatMoney(curve.pv[hover])}`}
                        </span>
                        {curve.ev[hover] !== undefined && (
                            <span>
                                <i className="is-ev" aria-hidden="true" />
                                {`${texts.legendEv}: ${formatMoney(curve.ev[hover]!)}`}
                            </span>
                        )}
                        {curve.ac[hover] !== undefined && (
                            <span>
                                <i className="is-ac" aria-hidden="true" />
                                {`${texts.legendAc}: ${formatMoney(curve.ac[hover]!)}`}
                            </span>
                        )}
                    </div>
                )}
                <figcaption className="mxgantt-scurve-legend">
                    <span>
                        <i className="is-pv" aria-hidden="true" />
                        {texts.legendPv}
                    </span>
                    <span>
                        <i className="is-ev" aria-hidden="true" />
                        {texts.legendEv}
                    </span>
                    <span>
                        <i className="is-ac" aria-hidden="true" />
                        {texts.legendAc}
                    </span>
                    {forecast && (
                        <span>
                            <i className="is-eac" aria-hidden="true" />
                            {texts.legendEac}
                        </span>
                    )}
                    <button
                        type="button"
                        className="mxgantt-link-button"
                        aria-expanded={table}
                        aria-controls={`${id}-table`}
                        onClick={() => setTable(current => !current)}
                    >
                        {table ? texts.hideTable : texts.showTable}
                    </button>
                </figcaption>
                <div id={`${id}-table`} className={classNames("mxgantt-scurve-table", { "mxgantt-sr": !table })}>
                    <table className="mxgantt-table">
                        <caption className="mxgantt-sr">{texts.sCurve}</caption>
                        <thead>
                            <tr>
                                <th scope="col">{texts.sCurveDate}</th>
                                <th scope="col">{texts.legendPv}</th>
                                <th scope="col">{texts.legendEv}</th>
                                <th scope="col">{texts.legendAc}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {curve.dates
                                .map((date, i) => ({ date, i }))
                                .filter(
                                    ({ i }) =>
                                        i % Math.max(1, Math.ceil(curve.dates.length / 24)) === 0 || i === statusIndex
                                )
                                .map(({ date, i }) => (
                                    <tr key={date.getTime()}>
                                        <th scope="row">{props.formatDate(date)}</th>
                                        <td className="is-number">{formatMoney(curve.pv[i])}</td>
                                        <td className="is-number">
                                            {curve.ev[i] === undefined ? "" : formatMoney(curve.ev[i]!)}
                                        </td>
                                        <td className="is-number">
                                            {curve.ac[i] === undefined ? "" : formatMoney(curve.ac[i]!)}
                                        </td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                </div>
            </figure>
        );
    }

    return (
        <div className="mxgantt-ev">
            <span className="mxgantt-sr">
                {fill(texts.evAnnounce, {
                    date: props.formatDate(props.statusDate),
                    cpi: index(value.cpi),
                    spi: index(value.spi),
                    eac: formatMoney(value.eac)
                })}
            </span>
            <p className="mxgantt-ev-status">{fill(texts.evStatus, { date: props.formatDate(props.statusDate) })}</p>
            <dl className="mxgantt-ev-tiles">
                {tiles.map(tile => (
                    <div
                        key={tile.key}
                        className={classNames("mxgantt-ev-tile", tile.tone && `is-${tile.tone}`)}
                        data-key={tile.key}
                    >
                        <dt>{tile.label}</dt>
                        <dd>
                            <span className="mxgantt-ev-value">{tile.text}</span>
                            {(tile.key === "cpi" || tile.key === "spi") && tile.tone !== "none" && (
                                <span className="mxgantt-ev-word">{toneWord(tile.tone)}</span>
                            )}
                        </dd>
                    </div>
                ))}
            </dl>
            {chart}
        </div>
    );
}

/** Re-renders only when its props change, not on every scroll of the chart. */
export const EarnedValuePanel = memo(EarnedValuePanelView);
