import classNames from "classnames";
import { memo, ReactElement } from "react";

import { ResourceUsage } from "../utils/resources";
import { fill, Texts } from "../utils/texts";
import { dateToX, TimeScale } from "../utils/time";

export interface ResourcePanelProps {
    texts: Texts;
    usage: ResourceUsage[];
    scale: TimeScale;
    /** Width of the timeline and how far it is scrolled, so the histogram lines up with the bars. */
    width: number;
    scrollLeft: number;
    viewportWidth: number;
    /** Width of the name column, matching the task list (0 without a task list). */
    labelWidth: number;
    formatDate: (date: Date) => string;
    formatNumber: (value: number) => string;
    focused?: string;
    onFocus: (name: string | undefined) => void;
}

const ROW = 34;

/**
 * 2.3 resource usage: one row per resource with its load per day (day zoom) or its busiest day per
 * week, as a percentage of what it can give (its maximum units), a line at the maximum and the
 * over-allocated columns in red. The name is a toggle button that highlights the resource's tasks
 * on the chart; each row has a sentence for screen readers.
 */
function ResourcePanelView(props: ResourcePanelProps): ReactElement {
    const { usage, scale, texts } = props;
    const fromX = props.scrollLeft - 100;
    const toX = props.scrollLeft + props.viewportWidth + 100;
    return (
        <div className="mxgantt-resources" role="list" style={{ maxHeight: ROW * 7 + 2 }}>
            {usage.map(resource => {
                const top = Math.max(resource.maxUnits * 1.25, resource.peak);
                const height = ROW - 8;
                const capacityY = Math.round((resource.maxUnits / top) * height);
                const focused = props.focused === resource.name;
                return (
                    <div
                        key={resource.name}
                        role="listitem"
                        className={classNames("mxgantt-resource-row", {
                            "is-over": resource.overDays > 0,
                            "is-focused": focused
                        })}
                        style={{ height: ROW }}
                    >
                        <span className="mxgantt-sr">
                            {fill(texts.resourceRow, {
                                name: resource.name,
                                peak: props.formatNumber(resource.peak),
                                max: props.formatNumber(resource.maxUnits),
                                over: resource.overDays
                            })}
                        </span>
                        <div
                            className="mxgantt-resource-name"
                            style={props.labelWidth > 0 ? { width: props.labelWidth } : undefined}
                        >
                            <button
                                type="button"
                                className="mxgantt-resource-button"
                                aria-pressed={focused}
                                title={fill(texts.resourceFocus, { name: resource.name })}
                                onClick={() => props.onFocus(focused ? undefined : resource.name)}
                            >
                                <span className="mxgantt-resource-label">{resource.name}</span>
                                <span className="mxgantt-resource-max" aria-hidden="true">
                                    {fill(texts.resourceMax, { max: props.formatNumber(resource.maxUnits) })}
                                </span>
                            </button>
                            {resource.overDays > 0 && (
                                <span className="mxgantt-workload-badge" aria-hidden="true">
                                    {resource.overDays}
                                </span>
                            )}
                        </div>
                        <div className="mxgantt-workload-track" aria-hidden="true">
                            <div
                                className="mxgantt-workload-inner"
                                style={{ width: props.width, transform: `translateX(${-props.scrollLeft}px)` }}
                            >
                                <div className="mxgantt-workload-capacity" style={{ bottom: 2 + capacityY }} />
                                {resource.buckets.map(bucket => {
                                    if (bucket.peak <= 0) {
                                        return null;
                                    }
                                    const x = dateToX(bucket.start, scale);
                                    const right = dateToX(bucket.end, scale);
                                    if (right < fromX || x > toX) {
                                        return null;
                                    }
                                    const barHeight = Math.max(
                                        3,
                                        Math.round((Math.min(bucket.peak, top) / top) * height)
                                    );
                                    const percent = Math.round((bucket.peak / resource.maxUnits) * 100);
                                    return (
                                        <div
                                            key={bucket.start.getTime()}
                                            className={classNames("mxgantt-workload-bar mxgantt-resource-bar", {
                                                "is-over": bucket.peak > resource.maxUnits + 1e-6
                                            })}
                                            style={{
                                                left: x + 1,
                                                width: Math.max(2, right - x - 2),
                                                height: barHeight
                                            }}
                                            title={fill(texts.resourceCell, {
                                                name: resource.name,
                                                date: props.formatDate(bucket.start),
                                                units: props.formatNumber(bucket.peak),
                                                max: props.formatNumber(resource.maxUnits)
                                            })}
                                        >
                                            {right - x >= 30 && <span>{percent}%</span>}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

/** Re-renders only when its props change, not on every scroll of the chart. */
export const ResourcePanel = memo(ResourcePanelView);
