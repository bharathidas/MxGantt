import classNames from "classnames";
import { memo, ReactElement } from "react";

import { fill, Texts } from "../utils/texts";
import { dateToX, TimeScale } from "../utils/time";
import { ResourceLoad } from "../utils/workload";

export interface WorkloadPanelProps {
    texts: Texts;
    loads: ResourceLoad[];
    scale: TimeScale;
    /** Width of the timeline, and how far it is scrolled, so the histogram lines up with the bars. */
    width: number;
    scrollLeft: number;
    viewportWidth: number;
    /** Width of the name column, matching the task list (0 without a task list). */
    labelWidth: number;
    capacity: number;
    formatDate: (date: Date) => string;
}

const ROW = 30;

/**
 * The resource histogram under the chart: one row per person, one column per day or week with the
 * busiest day's task count, red above capacity. It scrolls sideways with the timeline. Each row
 * carries a summary for screen readers; the columns are drawn only while on screen.
 */
function WorkloadPanelView(props: WorkloadPanelProps): ReactElement {
    const { loads, scale, texts } = props;
    const peak = Math.max(props.capacity + 1, ...loads.map(load => load.peak));
    const fromX = props.scrollLeft - 100;
    const toX = props.scrollLeft + props.viewportWidth + 100;
    const capacityY = Math.round((props.capacity / peak) * (ROW - 8));
    return (
        <div className="mxgantt-workload" role="region" aria-label={texts.workload}>
            <div className="mxgantt-workload-title" aria-hidden="true">
                {texts.workload}
            </div>
            <div className="mxgantt-workload-rows" role="list" style={{ maxHeight: ROW * 6 + 2 }}>
                {loads.map(load => (
                    <div
                        key={load.name}
                        role="listitem"
                        className={classNames("mxgantt-workload-row", { "is-over": load.overDays > 0 })}
                        style={{ height: ROW }}
                    >
                        <span className="mxgantt-sr">
                            {fill(texts.workloadRow, { name: load.name, n: load.peak, over: load.overDays })}
                        </span>
                        {props.labelWidth > 0 && (
                            <div
                                className="mxgantt-workload-name"
                                style={{ width: props.labelWidth }}
                                aria-hidden="true"
                            >
                                <span>{load.name}</span>
                                {load.overDays > 0 && <span className="mxgantt-workload-badge">{load.overDays}</span>}
                            </div>
                        )}
                        <div className="mxgantt-workload-track" aria-hidden="true">
                            <div
                                className="mxgantt-workload-inner"
                                style={{ width: props.width, transform: `translateX(${-props.scrollLeft}px)` }}
                            >
                                <div className="mxgantt-workload-capacity" style={{ bottom: 2 + capacityY }} />
                                {load.buckets.map(bucket => {
                                    if (bucket.peak === 0) {
                                        return null;
                                    }
                                    const x = dateToX(bucket.start, scale);
                                    const right = dateToX(bucket.end, scale);
                                    if (right < fromX || x > toX) {
                                        return null;
                                    }
                                    const height = Math.max(3, Math.round((bucket.peak / peak) * (ROW - 8)));
                                    const title = fill(texts.workloadCell, {
                                        name: load.name,
                                        date: props.formatDate(bucket.start),
                                        n: bucket.peak
                                    });
                                    return (
                                        <div
                                            key={bucket.start.getTime()}
                                            className={classNames("mxgantt-workload-bar", {
                                                "is-over": bucket.peak > props.capacity
                                            })}
                                            style={{ left: x + 1, width: Math.max(2, right - x - 2), height }}
                                            title={title}
                                        >
                                            {right - x >= 18 && <span>{bucket.peak}</span>}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

/** Re-renders only when its props change, not on every scroll of the chart. */
export const WorkloadPanel = memo(WorkloadPanelView);
