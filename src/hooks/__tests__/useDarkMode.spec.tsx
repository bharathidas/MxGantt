import { act, render } from "@testing-library/react";
import { ReactElement, useRef } from "react";

import { ThemeSetting, useDarkMode } from "../useDarkMode";

let systemDark = false;
const listeners = new Set<() => void>();

beforeEach(() => {
    systemDark = false;
    listeners.clear();
    window.matchMedia = jest.fn().mockImplementation(() => ({
        get matches() {
            return systemDark;
        },
        addEventListener: (_: string, fn: () => void) => listeners.add(fn),
        removeEventListener: (_: string, fn: () => void) => listeners.delete(fn)
    }));
});

afterEach(() => {
    document.body.className = "";
    document.body.style.backgroundColor = "";
    document.documentElement.style.backgroundColor = "";
});

function Probe(props: { theme: ThemeSetting; background?: string }): ReactElement {
    const ref = useRef<HTMLDivElement>(null);
    const dark = useDarkMode(props.theme, ref);
    return (
        <div style={{ backgroundColor: props.background }}>
            <div ref={ref} data-testid="root" data-dark={String(dark)} />
        </div>
    );
}

const isDark = (container: HTMLElement): string | null =>
    container.querySelector("[data-testid=root]")!.getAttribute("data-dark");

describe("useDarkMode", () => {
    it("keeps explicit settings", () => {
        systemDark = true;
        const { container, rerender } = render(<Probe theme="light" background="rgb(0, 0, 0)" />);
        expect(isDark(container)).toBe("false");
        rerender(<Probe theme="dark" background="rgb(255, 255, 255)" />);
        expect(isDark(container)).toBe("true");
    });

    it("follows the page, not the OS, in auto mode", () => {
        systemDark = true;
        const { container, rerender } = render(<Probe theme="auto" background="rgb(255, 255, 255)" />);
        expect(isDark(container)).toBe("false");
        rerender(<Probe theme="light" background="rgb(20, 20, 20)" />);
        rerender(<Probe theme="auto" background="rgb(20, 20, 20)" />);
        expect(isDark(container)).toBe("true");
    });

    it("falls back to the OS and follows its changes when nothing is opaque", () => {
        const { container, unmount } = render(<Probe theme="auto" />);
        expect(isDark(container)).toBe("false");
        systemDark = true;
        act(() => listeners.forEach(fn => fn()));
        expect(isDark(container)).toBe("true");
        unmount();
        expect(listeners.size).toBe(0);
    });

    it("re-checks when the body class changes", async () => {
        const { container } = render(<Probe theme="auto" />);
        expect(isDark(container)).toBe("false");
        await act(async () => {
            document.body.classList.add("mx-theme-dark");
            await Promise.resolve();
        });
        expect(isDark(container)).toBe("true");
    });
});
