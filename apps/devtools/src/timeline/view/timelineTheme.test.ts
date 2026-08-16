import { describe, expect, it } from "vite-plus/test";
import { readTimelineTheme, resolveCanvasToken } from "./timelineTheme.js";

describe("canvas timeline theme", () => {
  it("resolves aliased custom properties before passing them to Canvas", () => {
    const root = document.createElement("div");
    root.style.setProperty("--rl-bg", "#ffffff");
    root.style.setProperty("--bg", "var(--rl-bg)");
    root.style.setProperty("--rl-ink-rgb", "0, 0, 0");
    root.style.setProperty("--line", "rgba(var(--rl-ink-rgb), 0.07)");
    document.body.appendChild(root);

    const theme = readTimelineTheme(root);
    expect(theme.bg).toBe("#ffffff");
    expect(theme.line).toBe("rgba(0, 0, 0, 0.07)");

    root.remove();
  });

  it("resolves nested aliases and fallbacks", () => {
    const root = document.createElement("div");
    root.style.setProperty("--a", "var(--b)");
    root.style.setProperty("--b", "var(--c, #123456)");
    document.body.appendChild(root);

    const styles = getComputedStyle(root);
    expect(resolveCanvasToken(styles, "var(--a)")).toBe("#123456");

    root.remove();
  });
});
