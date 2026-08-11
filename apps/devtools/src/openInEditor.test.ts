import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { openInEditor, preferredEditor, editorOpenPlan } from "./openInEditor.js";

function iframes(): HTMLIFrameElement[] {
  return [...document.querySelectorAll("iframe")];
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  for (const f of iframes()) f.remove();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("editorOpenPlan — routing", () => {
  const origin = "http://localhost:5178";

  it("dev-server URLs go through Vite's /__open-in-editor middleware", () => {
    expect(editorOpenPlan("http://localhost:5178/src/App.tsx", 19, 6, origin)).toEqual({
      kind: "dev-server",
      url: "http://localhost:5178/__open-in-editor?file=src%2FApp.tsx%3A19%3A6",
    });
  });

  it("sourcemap root-relative paths resolve against the page's dev server", () => {
    // '/App.tsx' is relative to the served root, NOT an OS path — a
    // vscode://file scheme would error with \"Path does not exist\".
    expect(editorOpenPlan("/App.tsx", 19, 6, origin)).toEqual({
      kind: "dev-server",
      url: "http://localhost:5178/__open-in-editor?file=App.tsx%3A19%3A6",
    });
    expect(editorOpenPlan("src/App.tsx", 3, 1, origin)).toEqual({
      kind: "dev-server",
      url: "http://localhost:5178/__open-in-editor?file=src%2FApp.tsx%3A3%3A1",
    });
  });

  it("real OS-absolute paths keep the editor scheme", () => {
    expect(editorOpenPlan("/Users/dev/repo/src/App.tsx", 42, 7, origin)).toEqual({
      kind: "scheme",
      url: "vscode://file//Users/dev/repo/src/App.tsx:42:7",
    });
    expect(editorOpenPlan("C:/dev/app/src/App.tsx", 1, 1, origin)).toEqual({
      kind: "scheme",
      url: "vscode://file/C:/dev/app/src/App.tsx:1:1",
    });
  });

  it("without an http page origin, relative paths have nowhere to go", () => {
    expect(editorOpenPlan("src/App.tsx", 1, 1, "chrome-extension://abc")).toBeNull();
  });

  it("refuses empty and webpack-virtual paths", () => {
    expect(editorOpenPlan("  ", 1, 1, origin)).toBeNull();
    expect(editorOpenPlan("webpack://app/./src/x.ts", 1, 1, origin)).toBeNull();
  });
});

describe("openInEditor — execution", () => {
  it("dev-server plan fires a fetch, no iframe", () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response()));
    vi.stubGlobal("fetch", fetchSpy);
    expect(openInEditor("/App.tsx", 19, 6)).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(iframes()).toHaveLength(0);
  });

  it("fires exactly one protocol navigation for absolute paths", () => {
    openInEditor("/Users/dev/repo/src/App.tsx", 42, 7);
    vi.advanceTimersByTime(500);
    expect(iframes()).toHaveLength(1);
    expect(iframes()[0]!.src).toBe("vscode://file//Users/dev/repo/src/App.tsx:42:7");
  });

  it("keeps the iframe alive long enough for the user to answer the prompt", () => {
    openInEditor("/Users/dev/repo/src/App.tsx", 1);
    vi.advanceTimersByTime(5_000);
    expect(iframes()).toHaveLength(1);
    vi.advanceTimersByTime(60_000);
    expect(iframes()).toHaveLength(0);
  });

  it("honors the persisted editor preference", () => {
    localStorage.setItem("react-lens:editor", "cursor");
    expect(preferredEditor()).toBe("cursor");
    openInEditor("/Users/dev/repo/src/App.tsx", 3, 1);
    expect(iframes()[0]!.src).toBe("cursor://file//Users/dev/repo/src/App.tsx:3:1");
  });

  it("falls back to vscode for unknown preference values", () => {
    localStorage.setItem("react-lens:editor", "emacs-butterflies");
    expect(preferredEditor()).toBe("vscode");
  });

  it("still refuses empty paths", () => {
    expect(openInEditor("  ", 1)).toBe(false);
    expect(iframes()).toHaveLength(0);
  });
});
