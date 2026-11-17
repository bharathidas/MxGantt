import classNames from "classnames";
import { memo, ReactElement, useEffect, useRef, useState } from "react";

import { Health, spiTone } from "../utils/plan";
import { fill, Texts } from "../utils/texts";

export interface HealthStripProps {
    texts: Texts;
    health: Health;
    animate: boolean;
    formatDate: (date: Date | undefined) => string;
    formatNumber: (value: number) => string;
}

const COUNT_TIME = 700;

/** Counts from the previous value to `value` with an ease-out curve; jumps straight there without motion. */
function useCountUp(value: number | undefined, animate: boolean): number | undefined {
    const [shown, setShown] = useState(animate && value !== undefined ? 0 : value);
    const from = useRef(0);
    useEffect(() => {
        if (value === undefined || !animate || typeof requestAnimationFrame !== "function") {
            const frame = requestAnimationFrame(() => setShown(value));
            from.current = value ?? 0;
            return () => cancelAnimationFrame(frame);
        }
        const start = performance.now();
        const origin = from.current;
        let frame = 0;
        const step = (now: number): void => {
            const t = Math.min(1, (now - start) / COUNT_TIME);
            const eased = 1 - Math.pow(1 - t, 3);
            setShown(origin + (value - origin) * eased);
            if (t < 1) {
                frame = requestAnimationFrame(step);
            } else {
                from.current = value;
            }
        };
        frame = requestAnimationFrame(step);
        return () => cancelAnimationFrame(frame);
    }, [value, animate]);
    return shown;
}

/**
 * Project health (2.2): actual against planned complete, the schedule performance index, the
 * forecast finish against the baseline, and risk counts. A region with plain text for screen
 * readers; the numbers count up when motion is on.
 */
function HealthStripView(props: HealthStripProps): ReactElement {
    const { texts, health, formatNumber } = props;
    const actual = useCountUp(health.actual, props.animate);
    const spi = useCountUp(health.spi, props.animate);
    const tone = spiTone(health.spi);
    const finishNote =
        health.finishVariance === undefined
            ? ""
            : health.finishVariance > 0
            ? fill(texts.healthLate, { days: formatNumber(health.finishVariance) })
            : health.finishVariance < 0
            ? fill(texts.healthEarly, { days: formatNumber(-health.finishVariance) })
            : texts.healthOnBaseline;
    const percent = (value: number | undefined): string =>
        value === undefined ? "–" : `${formatNumber(Math.round(value))}%`;
    return (
        <section className="mxgantt-health" aria-label={texts.health}>
            {health.actual !== undefined && (
                <span className="mxgantt-sr">
                    {fill(texts.healthAnnounce, {
                        actual: formatNumber(Math.round(health.actual)),
                        planned: formatNumber(Math.round(health.planned ?? 0)),
                        spi: health.spi === undefined ? "–" : health.spi.toFixed(2)
                    })}
                </span>
            )}
            {health.actual !== undefined && (
                <div className="mxgantt-health-tile">
                    <span className="mxgantt-health-label">{texts.healthComplete}</span>
                    <span className="mxgantt-health-value" data-value={health.actual}>
                        {percent(actual)}
                    </span>
                    <span className="mxgantt-health-meter" aria-hidden="true">
                        <span className="mxgantt-health-meter-plan" style={{ width: `${health.planned ?? 0}%` }} />
                        <span className="mxgantt-health-meter-done" style={{ width: `${health.actual}%` }} />
                    </span>
                    <span className="mxgantt-health-note">
                        {fill(texts.healthCompleteValue, { planned: formatNumber(Math.round(health.planned ?? 0)) })}
                    </span>
                </div>
            )}
            {health.actual !== undefined && (
                <div className={classNames("mxgantt-health-tile", `is-${tone}`)} title={texts.healthSpiHint}>
                    <span className="mxgantt-health-label">{texts.healthSpi}</span>
                    <span className="mxgantt-health-value" data-value={health.spi ?? ""}>
                        {spi === undefined ? "–" : spi.toFixed(2)}
                    </span>
                    <span className="mxgantt-health-note">{texts.healthSpiHint}</span>
                </div>
            )}
            {health.finish && (
                <div
                    className={classNames("mxgantt-health-tile", {
                        "is-bad": (health.finishVariance ?? 0) > 0,
                        "is-good": (health.finishVariance ?? 1) <= 0
                    })}
                >
                    <span className="mxgantt-health-label">{texts.healthFinish}</span>
                    <span className="mxgantt-health-value is-date">{props.formatDate(health.finish)}</span>
                    {finishNote && <span className="mxgantt-health-note">{finishNote}</span>}
                </div>
            )}
            <div className="mxgantt-health-counts">
                {health.actual !== undefined && (
                    <span className={classNames("mxgantt-health-count", { "is-bad": health.behind > 0 })}>
                        {/* Label first, so the plural label reads right for any count ("Critical tasks: 1"). */}
                        {texts.healthBehind}: <strong>{health.behind}</strong>
                    </span>
                )}
                <span className="mxgantt-health-count">
                    {texts.healthCritical}: <strong>{health.critical}</strong>
                </span>
                <span className={classNames("mxgantt-health-count", { "is-bad": health.missedDeadlines > 0 })}>
                    {texts.healthDeadlines}: <strong>{health.missedDeadlines}</strong>
                </span>
            </div>
        </section>
    );
}

/** Re-renders only when its props change, not on every scroll of the chart. */
export const HealthStrip = memo(HealthStripView);
