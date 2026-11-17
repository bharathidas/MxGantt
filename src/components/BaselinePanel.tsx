import classNames from "classnames";
import { memo, ReactElement, useId, useState } from "react";

import { ATTRIBUTE_BASELINE, BaselineComparison, MAX_BASELINES } from "../utils/baselines";
import { fill, Texts } from "../utils/texts";

export interface BaselinePanelProps {
    texts: Texts;
    /** Named baselines in the plan. */
    names: string[];
    /** The 2.0 attribute baseline exists. */
    hasAttributes: boolean;
    shown: string;
    compare: string;
    onShow: (selection: string) => void;
    onCompare: (selection: string) => void;
    /** Undefined when baselines cannot be saved (read-only or no attribute). */
    onSave?: (name: string) => string | undefined;
    onDelete?: (name: string) => void;
    comparison?: BaselineComparison;
    formatDate: (date: Date | undefined) => string;
    formatNumber: (value: number) => string;
    formatMoney?: (value: number) => string;
    onGoTo: (id: string) => void;
}

/** Rows shown in the comparison table; the rest are counted. */
const TABLE_LIMIT = 300;

/**
 * 2.3 baselines: which baseline the chart shows, a second one to compare it with (twin bars on
 * the chart and a variance table here), and saving or deleting named baselines. Native selects and
 * inputs, so keyboard and screen readers work as everywhere else.
 */
function BaselinePanelView(props: BaselinePanelProps): ReactElement {
    const { texts, names } = props;
    const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
    const [name, setName] = useState("");
    const [error, setError] = useState<string>();
    const label = (selection: string): string =>
        selection === ATTRIBUTE_BASELINE ? texts.baselineAttributes : selection || texts.baselineNone;
    const options = [...(props.hasAttributes ? [ATTRIBUTE_BASELINE] : []), ...names];
    const suggested = fill(texts.baselineDefaultName, { n: names.length + 1 });
    const save = (): void => {
        if (!props.onSave) {
            return;
        }
        const wanted = (name || suggested).trim();
        if (!wanted) {
            setError(texts.baselineEmptyName);
            return;
        }
        if (!names.includes(wanted) && names.length >= MAX_BASELINES) {
            setError(texts.baselineFull);
            return;
        }
        const problem = props.onSave(wanted);
        setError(problem);
        if (!problem) {
            setName("");
        }
    };
    const days = (value: number | undefined): string =>
        value === undefined ? "" : `${value > 0 ? "+" : ""}${props.formatNumber(value)}`;
    const comparison = props.comparison;
    const changedRows = comparison
        ? [...comparison.rows].sort(
              (a, b) => Math.abs(b.finishDays ?? 0) - Math.abs(a.finishDays ?? 0) || a.name.localeCompare(b.name)
          )
        : [];
    const deltaText = (value: number | undefined): string =>
        value === undefined || value === 0
            ? texts.compareSame
            : value > 0
            ? fill(texts.compareLater, { n: fill(texts.days, { n: props.formatNumber(value) }) })
            : fill(texts.compareEarlier, { n: fill(texts.days, { n: props.formatNumber(-value) }) });
    return (
        <div className="mxgantt-baselines">
            <div className="mxgantt-baselines-controls">
                <label className="mxgantt-field">
                    <span>{texts.baselineShow}</span>
                    <select value={props.shown} onChange={event => props.onShow(event.target.value)}>
                        <option value="">{texts.baselineNone}</option>
                        {options.map(option => (
                            <option key={option} value={option}>
                                {label(option)}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="mxgantt-field">
                    <span>{texts.baselineCompare}</span>
                    <select
                        value={props.compare}
                        disabled={!props.shown}
                        onChange={event => props.onCompare(event.target.value)}
                    >
                        <option value="">{texts.baselineNoCompare}</option>
                        {options
                            .filter(option => option !== props.shown)
                            .map(option => (
                                <option key={option} value={option}>
                                    {label(option)}
                                </option>
                            ))}
                    </select>
                </label>
                {props.onSave && (
                    <div className="mxgantt-field mxgantt-baselines-save">
                        <label htmlFor={`${id}-name`}>{texts.baselineName}</label>
                        <div className="mxgantt-field-row">
                            <input
                                id={`${id}-name`}
                                type="text"
                                maxLength={60}
                                value={name}
                                placeholder={suggested}
                                aria-invalid={!!error}
                                aria-describedby={error ? `${id}-error` : undefined}
                                onChange={event => {
                                    setName(event.target.value);
                                    setError(undefined);
                                }}
                                onKeyDown={event => {
                                    event.stopPropagation();
                                    if (event.key === "Enter") {
                                        event.preventDefault();
                                        save();
                                    }
                                }}
                            />
                            <button type="button" className="mxgantt-button is-primary" onClick={save}>
                                {texts.baselineSave}
                            </button>
                        </div>
                    </div>
                )}
                {props.onDelete && props.shown && props.shown !== ATTRIBUTE_BASELINE && (
                    <button
                        type="button"
                        className="mxgantt-button mxgantt-baselines-delete"
                        onClick={() => props.onDelete?.(props.shown)}
                    >
                        {texts.baselineDelete}
                    </button>
                )}
            </div>
            {error && (
                <p id={`${id}-error`} className="mxgantt-field-error" role="alert">
                    {error}
                </p>
            )}
            {comparison && props.compare && (
                <div className="mxgantt-compare">
                    <p className="mxgantt-compare-summary" role="status">
                        <strong>{fill(texts.compareTitle, { a: label(props.shown), b: label(props.compare) })}</strong>{" "}
                        {fill(texts.compareSummary, {
                            changed: comparison.changed,
                            b: label(props.compare),
                            delta: deltaText(comparison.finishDays)
                        })}
                    </p>
                    <div
                        className="mxgantt-compare-scroll"
                        tabIndex={0}
                        role="region"
                        aria-label={fill(texts.compareTitle, { a: label(props.shown), b: label(props.compare) })}
                    >
                        <table className="mxgantt-table">
                            <thead>
                                <tr>
                                    <th scope="col">{texts.colTask}</th>
                                    <th scope="col">{`${label(props.shown)} – ${texts.colStart}`}</th>
                                    <th scope="col">{`${label(props.shown)} – ${texts.colEnd}`}</th>
                                    <th scope="col">{`${label(props.compare)} – ${texts.colStart}`}</th>
                                    <th scope="col">{`${label(props.compare)} – ${texts.colEnd}`}</th>
                                    <th scope="col">{texts.compareStartVariance}</th>
                                    <th scope="col">{texts.compareFinishVariance}</th>
                                    {props.formatMoney && <th scope="col">{texts.compareCostVariance}</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {changedRows.slice(0, TABLE_LIMIT).map(row => (
                                    <tr key={row.id}>
                                        <th scope="row">
                                            <button
                                                type="button"
                                                className="mxgantt-link-button"
                                                onClick={() => props.onGoTo(row.id)}
                                            >
                                                {row.name}
                                            </button>
                                        </th>
                                        <td>{row.a ? props.formatDate(row.a.start) : texts.compareMissing}</td>
                                        <td>{row.a ? props.formatDate(row.a.finish) : ""}</td>
                                        <td>{row.b ? props.formatDate(row.b.start) : texts.compareMissing}</td>
                                        <td>{row.b ? props.formatDate(row.b.finish) : ""}</td>
                                        <td
                                            className={classNames("is-number", { "is-late": (row.startDays ?? 0) > 0 })}
                                        >
                                            {days(row.startDays)}
                                        </td>
                                        <td
                                            className={classNames("is-number", {
                                                "is-late": (row.finishDays ?? 0) > 0
                                            })}
                                        >
                                            {days(row.finishDays)}
                                        </td>
                                        {props.formatMoney && (
                                            <td className="is-number">
                                                {row.costDelta === undefined ? "" : props.formatMoney(row.costDelta)}
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {changedRows.length > TABLE_LIMIT && (
                            <p className="mxgantt-compare-more">
                                {fill(texts.compareMore, { n: changedRows.length - TABLE_LIMIT })}
                            </p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

/** Re-renders only when its props change, not on every scroll of the chart. */
export const BaselinePanel = memo(BaselinePanelView);
