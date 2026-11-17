/**
 * Working out whether "Automatic" theme should be dark: the widget follows the page it sits on, not the operating
 * system, because most Mendix apps are light only and a dark chart on a light page looks broken.
 */

export interface Rgba {
    r: number;
    g: number;
    b: number;
    a: number;
}

/** Backgrounds at least this opaque decide the theme; more transparent ones let the next ancestor show through. */
export const OPAQUE_ALPHA = 0.5;

/** Relative luminance below this counts as a dark background. */
export const DARK_LUMINANCE = 0.35;

function channel(value: string): number {
    const text = value.trim();
    const number = parseFloat(text);
    if (Number.isNaN(number)) {
        return NaN;
    }
    return text.endsWith("%") ? (number / 100) * 255 : number;
}

function alpha(value: string | undefined): number {
    if (value === undefined) {
        return 1;
    }
    const text = value.trim();
    const number = parseFloat(text);
    if (Number.isNaN(number)) {
        return NaN;
    }
    return Math.max(0, Math.min(1, text.endsWith("%") ? number / 100 : number));
}

/**
 * Parses a computed colour: rgb() / rgba() in comma or space syntax, #rgb, #rgba, #rrggbb, #rrggbbaa and
 * "transparent". Returns undefined for anything else (such as color(srgb ...) or keywords).
 */
export function parseColor(value: string | null | undefined): Rgba | undefined {
    const text = value?.trim().toLowerCase();
    if (!text) {
        return undefined;
    }
    if (text === "transparent") {
        return { r: 0, g: 0, b: 0, a: 0 };
    }
    const hex = /^#([0-9a-f]{3,8})$/.exec(text);
    if (hex) {
        let digits = hex[1];
        if (digits.length === 3 || digits.length === 4) {
            digits = digits
                .split("")
                .map(d => d + d)
                .join("");
        }
        if (digits.length !== 6 && digits.length !== 8) {
            return undefined;
        }
        const n = (i: number): number => parseInt(digits.slice(i, i + 2), 16);
        return { r: n(0), g: n(2), b: n(4), a: digits.length === 8 ? n(6) / 255 : 1 };
    }
    const fn = /^rgba?\((.*)\)$/.exec(text);
    if (!fn) {
        return undefined;
    }
    const body = fn[1].trim();
    let parts: string[];
    let alphaPart: string | undefined;
    if (body.includes(",")) {
        parts = body.split(",");
        if (parts.length === 4) {
            alphaPart = parts.pop();
        }
    } else {
        const [rgb, a] = body.split("/");
        parts = rgb.trim().split(/\s+/);
        alphaPart = a;
    }
    if (parts.length !== 3) {
        return undefined;
    }
    const [r, g, b] = parts.map(channel);
    const a = alpha(alphaPart);
    if ([r, g, b, a].some(Number.isNaN)) {
        return undefined;
    }
    return { r, g, b, a };
}

/** WCAG 2 relative luminance of an sRGB colour (0 black to 1 white). */
export function relativeLuminance(color: Pick<Rgba, "r" | "g" | "b">): number {
    const linear = (v: number): number => {
        const c = Math.max(0, Math.min(255, v)) / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

export function isDarkColor(color: Pick<Rgba, "r" | "g" | "b">): boolean {
    return relativeLuminance(color) < DARK_LUMINANCE;
}

/** Reads an element's computed background colour; injectable so the walk can be tested without layout. */
export type BackgroundReader = (element: Element) => string | null | undefined;

const computedBackground: BackgroundReader = element =>
    element.ownerDocument?.defaultView?.getComputedStyle(element).backgroundColor;

/**
 * The first opaque (alpha >= 0.5) background colour from `start` upwards, then body and html. Background images are
 * ignored. Undefined when every background is transparent.
 */
export function findOpaqueBackground(
    start: Element | null | undefined,
    read: BackgroundReader = computedBackground
): Rgba | undefined {
    const seen = new Set<Element>();
    const check = (element: Element | null | undefined): Rgba | undefined => {
        if (!element || seen.has(element)) {
            return undefined;
        }
        seen.add(element);
        const color = parseColor(read(element));
        return color && color.a >= OPAQUE_ALPHA ? color : undefined;
    };
    for (let element = start; element; element = element.parentElement) {
        const found = check(element);
        if (found) {
            return found;
        }
    }
    const doc = start?.ownerDocument ?? (typeof document !== "undefined" ? document : undefined);
    return check(doc?.body) ?? check(doc?.documentElement);
}

/** Explicit dark markers an app can put on the page: class mx-theme-dark on html or body, or data-theme="dark". */
export function hasDarkMarker(doc: Document | undefined): boolean {
    if (!doc) {
        return false;
    }
    const html = doc.documentElement;
    return (
        !!html?.classList.contains("mx-theme-dark") ||
        !!doc.body?.classList.contains("mx-theme-dark") ||
        html?.getAttribute("data-theme") === "dark"
    );
}

/**
 * Whether the widget should be dark in Automatic mode. `root` is the widget's own root element; the walk starts at
 * its parent so the widget's own surface never decides. The operating system setting only counts when no opaque
 * background is found anywhere.
 */
export function detectPageDark(
    root: Element | null | undefined,
    systemDark: boolean,
    read: BackgroundReader = computedBackground
): boolean {
    const doc = root?.ownerDocument ?? (typeof document !== "undefined" ? document : undefined);
    if (hasDarkMarker(doc)) {
        return true;
    }
    const background = findOpaqueBackground(root ? root.parentElement ?? undefined : doc?.body, read);
    return background ? isDarkColor(background) : systemDark;
}
