import { KeyboardEvent, ReactElement, ReactNode, useEffect, useId, useRef } from "react";

export interface DialogProps {
    title: string;
    /** alertdialog for confirmations, dialog otherwise. */
    role?: "dialog" | "alertdialog";
    children?: ReactNode;
    buttons: Array<{ key: string; label: string; primary?: boolean; danger?: boolean; onClick: () => void }>;
    /** The button that takes focus when the dialog opens: the safe choice for confirmations. */
    focusKey?: string;
    onClose: () => void;
}

/**
 * A modal dialog inside the widget: focus moves into it, Tab stays inside it, Escape closes it,
 * and the caller puts focus back where it was.
 */
export function Dialog(props: DialogProps): ReactElement {
    const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
    const boxRef = useRef<HTMLDivElement>(null);
    const { focusKey } = props;

    useEffect(() => {
        const previous = document.activeElement;
        const box = boxRef.current;
        const target =
            (focusKey && box?.querySelector<HTMLElement>(`[data-key="${focusKey}"]`)) ||
            box?.querySelector<HTMLElement>("button");
        target?.focus();
        return () => {
            // Back to where the user was, unless closing already moved focus somewhere sensible.
            const now = document.activeElement;
            if (previous instanceof HTMLElement && previous.isConnected && (!now || now === document.body)) {
                previous.focus({ preventScroll: true });
            }
        };
    }, [focusKey]);

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        event.stopPropagation();
        if (event.key === "Escape") {
            event.preventDefault();
            props.onClose();
            return;
        }
        if (event.key === "Tab") {
            const focusable = Array.from(boxRef.current?.querySelectorAll<HTMLElement>("button") ?? []);
            if (focusable.length === 0) {
                return;
            }
            const index = focusable.indexOf(document.activeElement as HTMLElement);
            const next = event.shiftKey ? index - 1 : index + 1;
            event.preventDefault();
            focusable[(next + focusable.length) % focusable.length].focus();
        }
    };

    return (
        <div
            className="mxgantt-overlay"
            onPointerDown={event => event.target === event.currentTarget && props.onClose()}
        >
            <div
                ref={boxRef}
                className="mxgantt-dialog"
                role={props.role ?? "dialog"}
                aria-modal="true"
                aria-labelledby={`${id}-title`}
                onKeyDown={onKeyDown}
            >
                <h2 id={`${id}-title`} className="mxgantt-dialog-title">
                    {props.title}
                </h2>
                {props.children}
                <div className="mxgantt-dialog-buttons">
                    {props.buttons.map(button => (
                        <button
                            key={button.key}
                            type="button"
                            data-key={button.key}
                            className={`mxgantt-button${button.primary ? " is-primary" : ""}${
                                button.danger ? " is-danger" : ""
                            }`}
                            onClick={button.onClick}
                        >
                            {button.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
