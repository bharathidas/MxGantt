import { Component, ErrorInfo, ReactElement, ReactNode, useId, useState } from "react";

import { fill, Texts } from "../utils/texts";

/**
 * 2.3: the frame of the panels under the toolbar and the chart (resources, baselines, earned
 * value, portfolio): a labelled region with a header that folds it away, and an error boundary of
 * its own, so a panel that fails shows a message instead of taking the whole chart down.
 */

class PanelBoundary extends Component<{ message: string; children: ReactNode }, { error?: Error }> {
    state: { error?: Error } = {};

    componentDidCatch(error: Error, info: ErrorInfo): void {
        console.error("MxGantt panel:", error, info.componentStack);
    }

    render(): ReactNode {
        if (this.state.error) {
            return (
                <p className="mxgantt-panel-error" role="alert">
                    {this.props.message}
                </p>
            );
        }
        return this.props.children;
    }

    static getDerivedStateFromError(error: Error): { error: Error } {
        return { error };
    }
}

export interface PanelProps {
    texts: Texts;
    title: string;
    className?: string;
    /** Buttons in the header, next to the title. */
    actions?: ReactNode;
    defaultOpen?: boolean;
    children: ReactNode;
}

export function Panel(props: PanelProps): ReactElement {
    const [open, setOpen] = useState(props.defaultOpen ?? true);
    const id = `mxgantt-panel-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
    return (
        <section className={`mxgantt-panel ${props.className ?? ""}`} aria-labelledby={`${id}-title`}>
            <div className="mxgantt-panel-head">
                <button
                    type="button"
                    className="mxgantt-panel-toggle"
                    aria-expanded={open}
                    aria-controls={`${id}-body`}
                    aria-label={fill(open ? props.texts.collapsePanel : props.texts.expandPanel, {
                        name: props.title
                    })}
                    onClick={() => setOpen(current => !current)}
                >
                    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                        <path d={open ? "M4 6l4 4 4-4" : "M6 4l4 4-4 4"} />
                    </svg>
                </button>
                <h3 id={`${id}-title`} className="mxgantt-panel-title">
                    {props.title}
                </h3>
                {props.actions && <div className="mxgantt-panel-actions">{props.actions}</div>}
            </div>
            <div id={`${id}-body`} className="mxgantt-panel-body" hidden={!open}>
                <PanelBoundary message={props.texts.panelError}>{open ? props.children : null}</PanelBoundary>
            </div>
        </section>
    );
}
