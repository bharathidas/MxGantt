import classNames from "classnames";
import { memo, ReactElement } from "react";

import { ProjectSummary } from "../utils/portfolio";
import { fill, Texts } from "../utils/texts";

export interface PortfolioPanelProps {
    texts: Texts;
    projects: ProjectSummary[];
    formatDate: (date: Date | undefined) => string;
    formatNumber: (value: number) => string;
    onGoTo: (project: string) => void;
}

/**
 * 2.3 portfolio health: one row per project with its finish, progress, indices and risks, and a
 * rating shown as a word with a coloured dot (never colour alone). The project name jumps to its
 * summary row in the chart.
 */
function PortfolioPanelView(props: PortfolioPanelProps): ReactElement {
    const { texts, projects, formatNumber } = props;
    const bad = projects.filter(project => project.rating === "bad").length;
    const warning = projects.filter(project => project.rating === "warning").length;
    const word = (rating: ProjectSummary["rating"]): string =>
        rating === "good" ? texts.healthGood : rating === "warning" ? texts.healthWarning : texts.healthBad;
    const index = (value: number | undefined): string => (value === undefined ? "–" : value.toFixed(2));
    return (
        <div className="mxgantt-portfolio">
            <p className="mxgantt-sr" role="status">
                {fill(texts.portfolioAnnounce, { n: projects.length, bad, warning })}
            </p>
            <div
                className="mxgantt-compare-scroll"
                tabIndex={0}
                role="region"
                aria-label={`${texts.portfolioPanel}: ${texts.pfHealth}`}
            >
                <table className="mxgantt-table mxgantt-portfolio-table">
                    <thead>
                        <tr>
                            <th scope="col">{texts.colProject}</th>
                            <th scope="col">{texts.pfHealth}</th>
                            <th scope="col" className="is-number">
                                {texts.pfTasks}
                            </th>
                            <th scope="col">{texts.pfFinish}</th>
                            <th scope="col" className="is-number">
                                {texts.pfComplete}
                            </th>
                            <th scope="col" className="is-number">
                                {texts.pfSpi}
                            </th>
                            <th scope="col" className="is-number">
                                {texts.pfCpi}
                            </th>
                            <th scope="col" className="is-number">
                                {texts.healthCritical}
                            </th>
                            <th scope="col" className="is-number">
                                {texts.pfBehind}
                            </th>
                            <th scope="col" className="is-number">
                                {texts.pfMissed}
                            </th>
                            <th scope="col" className="is-number">
                                {texts.pfOver}
                            </th>
                            <th scope="col" className="is-number">
                                {texts.pfCross}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {projects.map(project => (
                            <tr key={project.name}>
                                <th scope="row">
                                    <button
                                        type="button"
                                        className="mxgantt-link-button"
                                        title={fill(texts.pfShow, { name: project.name })}
                                        onClick={() => props.onGoTo(project.name)}
                                    >
                                        {project.name}
                                    </button>
                                </th>
                                <td>
                                    <span className={classNames("mxgantt-rating", `is-${project.rating}`)}>
                                        <i aria-hidden="true" />
                                        {word(project.rating)}
                                    </span>
                                </td>
                                <td className="is-number">{project.tasks}</td>
                                <td>
                                    {props.formatDate(project.finish)}
                                    {project.finishVariance !== undefined && project.finishVariance !== 0 && (
                                        <span
                                            className={classNames("mxgantt-portfolio-variance", {
                                                "is-late": project.finishVariance > 0
                                            })}
                                        >
                                            {` (${project.finishVariance > 0 ? "+" : ""}${formatNumber(
                                                project.finishVariance
                                            )})`}
                                        </span>
                                    )}
                                </td>
                                <td className="is-number">
                                    {project.complete === undefined ? "–" : `${formatNumber(project.complete)}%`}
                                </td>
                                <td className="is-number">{index(project.spi)}</td>
                                <td className="is-number">{index(project.cpi)}</td>
                                <td className="is-number">{project.critical}</td>
                                <td className={classNames("is-number", { "is-late": project.behind > 0 })}>
                                    {project.behind}
                                </td>
                                <td className={classNames("is-number", { "is-late": project.missed > 0 })}>
                                    {project.missed}
                                </td>
                                <td className={classNames("is-number", { "is-late": project.overallocated > 0 })}>
                                    {project.overallocated}
                                </td>
                                <td className="is-number">{project.crossLinks}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/** Re-renders only when its props change, not on every scroll of the chart. */
export const PortfolioPanel = memo(PortfolioPanelView);
