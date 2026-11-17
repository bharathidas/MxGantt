import classNames from "classnames";
import { CSSProperties, KeyboardEvent, ReactElement, useEffect, useRef } from "react";

export interface MenuItem {
    key: string;
    label: string;
    /** A checkbox item (column chooser); plain command otherwise. */
    checked?: boolean;
    danger?: boolean;
    disabled?: boolean;
}

export interface MenuProps {
    id?: string;
    label: string;
    items: MenuItem[];
    style: CSSProperties;
    /** Checkbox menus stay open after a choice so several columns can be switched in one go. */
    keepOpen?: boolean;
    onSelect: (key: string) => void;
    /** restoreFocus is false when the user clicked somewhere else, which keeps that focus. */
    onClose: (restoreFocus: boolean) => void;
}

/**
 * A small popup menu (task actions, column chooser) with the WAI-ARIA menu keyboard model: the
 * first item takes focus, arrows, Home and End move, Enter or Space choose, Escape and Tab close.
 */
export function Menu(props: MenuProps): ReactElement {
    const listRef = useRef<HTMLDivElement>(null);
    const { onClose, id } = props;

    useEffect(() => {
        listRef.current?.querySelector<HTMLElement>("[role^=menuitem]:not([aria-disabled=true])")?.focus();
    }, []);

    // A click anywhere else closes the menu.
    useEffect(() => {
        const onDown = (event: PointerEvent): void => {
            // The button that opened the menu toggles it itself.
            const owner = id ? document.querySelector(`[aria-controls="${id}"]`) : null;
            if (owner?.contains(event.target as Node)) {
                return;
            }
            if (listRef.current && !listRef.current.contains(event.target as Node)) {
                onClose(false);
            }
        };
        document.addEventListener("pointerdown", onDown, true);
        return () => document.removeEventListener("pointerdown", onDown, true);
    }, [onClose, id]);

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[role^=menuitem]") ?? []);
        const index = items.indexOf(document.activeElement as HTMLElement);
        const go = (next: number): void => {
            event.preventDefault();
            items[(next + items.length) % items.length]?.focus();
        };
        switch (event.key) {
            case "ArrowDown":
                go(index + 1);
                break;
            case "ArrowUp":
                go(index - 1);
                break;
            case "Home":
                go(0);
                break;
            case "End":
                go(items.length - 1);
                break;
            case "Escape":
            case "Tab":
                event.preventDefault();
                event.stopPropagation();
                onClose(true);
                break;
            default:
                return;
        }
        event.stopPropagation();
    };

    const choose = (item: MenuItem): void => {
        if (item.disabled) {
            return;
        }
        props.onSelect(item.key);
        if (!props.keepOpen) {
            onClose(true);
        }
    };

    return (
        <div
            id={props.id}
            ref={listRef}
            className="mxgantt-menu"
            role="menu"
            aria-label={props.label}
            style={props.style}
            onKeyDown={onKeyDown}
        >
            {props.items.map(item => (
                <div
                    key={item.key}
                    role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                    aria-checked={item.checked}
                    aria-disabled={item.disabled || undefined}
                    tabIndex={-1}
                    className={classNames("mxgantt-menu-item", { "is-danger": item.danger })}
                    onClick={() => choose(item)}
                    onKeyDown={event => {
                        if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            event.stopPropagation();
                            choose(item);
                        }
                    }}
                >
                    {item.checked !== undefined && (
                        <span className="mxgantt-menu-check" aria-hidden="true">
                            {item.checked ? "✓" : ""}
                        </span>
                    )}
                    {item.label}
                </div>
            ))}
        </div>
    );
}
