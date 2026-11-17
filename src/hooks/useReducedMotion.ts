import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function media(): MediaQueryList | undefined {
    return typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia(QUERY)
        : undefined;
}

function subscribe(onChange: () => void): () => void {
    const list = media();
    if (!list) {
        return () => undefined;
    }
    if (typeof list.addEventListener === "function") {
        list.addEventListener("change", onChange);
        return () => list.removeEventListener("change", onChange);
    }
    // Older Safari only has the deprecated listener API.
    list.addListener?.(onChange);
    return () => list.removeListener?.(onChange);
}

function snapshot(): boolean {
    return !!media()?.matches;
}

/** Whether the user asked the system for reduced motion; follows changes to the setting live. */
export function useReducedMotion(): boolean {
    return useSyncExternalStore(subscribe, snapshot, () => false);
}
