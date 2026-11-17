import {
    BackgroundReader,
    detectPageDark,
    findOpaqueBackground,
    hasDarkMarker,
    isDarkColor,
    parseColor,
    relativeLuminance
} from "../theme";

/** Reads backgrounds from data-bg attributes so the walk can be tested without real CSS. */
const readAttr: BackgroundReader = element => element.getAttribute("data-bg") ?? "rgba(0, 0, 0, 0)";

function tree(backgrounds: Array<string | undefined>): { root: HTMLElement; cleanup: () => void } {
    // backgrounds[0] is the outermost ancestor; the last element made is the widget root.
    let parent: HTMLElement = document.body;
    const container = document.createElement("div");
    parent.appendChild(container);
    parent = container;
    for (const bg of backgrounds) {
        const el = document.createElement("div");
        if (bg !== undefined) {
            el.setAttribute("data-bg", bg);
        }
        parent.appendChild(el);
        parent = el;
    }
    return { root: parent, cleanup: () => container.remove() };
}

afterEach(() => {
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-bg");
    document.body.className = "";
    document.body.removeAttribute("data-bg");
});

describe("parseColor", () => {
    it("reads rgb and rgba in comma and space syntax", () => {
        expect(parseColor("rgb(255, 107, 94)")).toEqual({ r: 255, g: 107, b: 94, a: 1 });
        expect(parseColor("rgba(0, 0, 0, 0)")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
        expect(parseColor("rgb(10 20 30 / 0.4)")).toEqual({ r: 10, g: 20, b: 30, a: 0.4 });
        expect(parseColor("rgb(10 20 30 / 50%)")).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    });

    it("reads hex and transparent", () => {
        expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
        expect(parseColor("#16191F")).toEqual({ r: 22, g: 25, b: 31, a: 1 });
        expect(parseColor("#00000080")?.a).toBeCloseTo(0.5, 2);
        expect(parseColor("transparent")?.a).toBe(0);
    });

    it("gives up on what it does not understand", () => {
        expect(parseColor("")).toBeUndefined();
        expect(parseColor(undefined)).toBeUndefined();
        expect(parseColor("color(srgb 1 1 1)")).toBeUndefined();
        expect(parseColor("rgb(1, 2)")).toBeUndefined();
    });
});

describe("luminance", () => {
    it("follows the WCAG formula", () => {
        expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
        expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
        expect(relativeLuminance({ r: 128, g: 128, b: 128 })).toBeCloseTo(0.2158, 3);
    });

    it("calls dark below 0.35", () => {
        expect(isDarkColor({ r: 22, g: 25, b: 31 })).toBe(true);
        expect(isDarkColor({ r: 128, g: 128, b: 128 })).toBe(true);
        expect(isDarkColor({ r: 246, g: 247, b: 249 })).toBe(false);
        expect(isDarkColor({ r: 180, g: 180, b: 180 })).toBe(false);
    });
});

describe("findOpaqueBackground", () => {
    it("takes the nearest ancestor that is at least half opaque", () => {
        const { root, cleanup } = tree(["rgb(20, 20, 20)", "rgba(255, 255, 255, 0.3)", undefined, undefined]);
        expect(findOpaqueBackground(root.parentElement, readAttr)).toEqual({ r: 20, g: 20, b: 20, a: 1 });
        cleanup();
    });

    it("falls back to body and then html", () => {
        const { root, cleanup } = tree([undefined, undefined]);
        document.documentElement.setAttribute("data-bg", "rgb(1, 2, 3)");
        expect(findOpaqueBackground(root.parentElement, readAttr)).toEqual({ r: 1, g: 2, b: 3, a: 1 });
        document.body.setAttribute("data-bg", "rgb(250, 250, 250)");
        expect(findOpaqueBackground(root.parentElement, readAttr)).toEqual({ r: 250, g: 250, b: 250, a: 1 });
        cleanup();
    });

    it("is undefined when everything is transparent", () => {
        const { root, cleanup } = tree([undefined, "rgba(0, 0, 0, 0.2)"]);
        expect(findOpaqueBackground(root.parentElement, readAttr)).toBeUndefined();
        cleanup();
    });
});

describe("detectPageDark", () => {
    it("is light on a light page even when the OS is dark", () => {
        const { root, cleanup } = tree(["rgb(255, 255, 255)", undefined]);
        expect(detectPageDark(root, true, readAttr)).toBe(false);
        cleanup();
    });

    it("is dark on a dark page even when the OS is light", () => {
        const { root, cleanup } = tree(["rgb(22, 25, 31)", undefined]);
        expect(detectPageDark(root, false, readAttr)).toBe(true);
        cleanup();
    });

    it("ignores the widget's own background", () => {
        const { root, cleanup } = tree(["rgb(255, 255, 255)", "rgb(22, 25, 31)"]);
        expect(detectPageDark(root, false, readAttr)).toBe(false);
        cleanup();
    });

    it("honours explicit dark markers", () => {
        const { root, cleanup } = tree(["rgb(255, 255, 255)", undefined]);
        document.body.classList.add("mx-theme-dark");
        expect(hasDarkMarker(document)).toBe(true);
        expect(detectPageDark(root, false, readAttr)).toBe(true);
        document.body.classList.remove("mx-theme-dark");
        document.documentElement.setAttribute("data-theme", "dark");
        expect(detectPageDark(root, false, readAttr)).toBe(true);
        document.documentElement.removeAttribute("data-theme");
        document.documentElement.classList.add("mx-theme-dark");
        expect(detectPageDark(root, false, readAttr)).toBe(true);
        cleanup();
    });

    it("uses the OS setting only when nothing is opaque", () => {
        const { root, cleanup } = tree([undefined, undefined]);
        expect(detectPageDark(root, true, readAttr)).toBe(true);
        expect(detectPageDark(root, false, readAttr)).toBe(false);
        cleanup();
    });

    it("reads computed styles by default", () => {
        const { root, cleanup } = tree([undefined, undefined]);
        (root.parentElement as HTMLElement).style.backgroundColor = "rgb(10, 10, 10)";
        expect(detectPageDark(root, false)).toBe(true);
        (root.parentElement as HTMLElement).style.backgroundColor = "rgb(250, 250, 250)";
        expect(detectPageDark(root, true)).toBe(false);
        cleanup();
    });
});
