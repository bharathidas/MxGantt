import { RefObject, useLayoutEffect, useState } from "react";

import { detectPageDark } from "../utils/theme";

export type ThemeSetting = "auto" | "light" | "dark";

const OBSERVED_ATTRIBUTES = ["class", "style", "data-theme"];

function systemPrefersDark(): boolean {
    return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

/**
 * Whether the widget renders dark. Light and Dark are fixed; Automatic follows the background of the page around
 * `rootRef` (see detectPageDark), re-checked when the OS setting changes or html / body change class, style or
 * data-theme. The first check runs in a layout effect so the chart never flashes the wrong theme.
 */
export function useDarkMode(theme: ThemeSetting, rootRef: RefObject<HTMLElement | null>): boolean {
    const [autoDark, setAutoDark] = useState(false);

    useLayoutEffect(() => {
        if (theme !== "auto" || typeof document === "undefined") {
            return;
        }
        const media = typeof window !== "undefined" ? window.matchMedia?.("(prefers-color-scheme: dark)") : undefined;
        const evaluate = (): void => {
            setAutoDark(detectPageDark(rootRef.current, systemPrefersDark()));
        };

        media?.addEventListener?.("change", evaluate);
        const observer = typeof MutationObserver !== "undefined" ? new MutationObserver(evaluate) : undefined;
        if (observer) {
            observer.observe(document.documentElement, { attributes: true, attributeFilter: OBSERVED_ATTRIBUTES });
            if (document.body) {
                observer.observe(document.body, { attributes: true, attributeFilter: OBSERVED_ATTRIBUTES });
            }
        }
        evaluate();

        return () => {
            media?.removeEventListener?.("change", evaluate);
            observer?.disconnect();
        };
    }, [theme, rootRef]);

    return theme === "dark" || (theme === "auto" && autoDark);
}
