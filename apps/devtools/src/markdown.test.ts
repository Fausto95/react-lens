import { describe, it, expect } from "vite-plus/test";
import { parseMarkdown, parseFenceInfo, splitInline } from "./markdown.js";

describe("parseMarkdown blocks", () => {
  it("parses headings, paragraphs, lists and fenced code", () => {
    const blocks = parseMarkdown(
      [
        "## Verdict",
        "ProductCard re-renders needlessly.",
        "",
        "- first",
        "- second",
        "",
        "```tsx src/ProductList.tsx:61",
        "const a = 1;",
        "```",
        "tail para",
      ].join("\n"),
    );
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "para", "list", "code", "para"]);
    const code = blocks.find((b) => b.kind === "code");
    expect(code).toMatchObject({
      lang: "tsx",
      file: "src/ProductList.tsx",
      line: 61,
      code: "const a = 1;",
    });
    const list = blocks.find((b) => b.kind === "list");
    expect(list).toMatchObject({ items: ["first", "second"] });
  });

  it("keeps an unterminated fence as code (streaming-friendly)", () => {
    const blocks = parseMarkdown("```tsx\nlet x = 1;");
    expect(blocks[0]).toMatchObject({ kind: "code", lang: "tsx", code: "let x = 1;" });
  });
});

describe("parseFenceInfo", () => {
  it("extracts lang, file and line from the info string", () => {
    expect(parseFenceInfo("tsx src/App.tsx:42")).toEqual({
      lang: "tsx",
      file: "src/App.tsx",
      line: 42,
    });
    expect(parseFenceInfo("ts")).toEqual({ lang: "ts" });
    expect(parseFenceInfo("")).toEqual({});
    // file without a line is still a file
    expect(parseFenceInfo("tsx src/App.tsx")).toEqual({ lang: "tsx", file: "src/App.tsx" });
  });
});

describe("splitInline — citation tokens, code spans, bold", () => {
  it("turns Lens ID tokens into citation segments", () => {
    const segs = splitInline(
      "Costly [component:12] via [render:412] in [interaction:i3], see [doctor:render-fanout@12].",
    );
    const cites = segs.filter((s) => s.kind === "citation");
    expect(cites).toEqual([
      { kind: "citation", ref: { kind: "component", id: 12 }, raw: "[component:12]" },
      { kind: "citation", ref: { kind: "render", id: 412 }, raw: "[render:412]" },
      { kind: "citation", ref: { kind: "interaction", id: "i3" }, raw: "[interaction:i3]" },
      {
        kind: "citation",
        ref: { kind: "doctor", ruleId: "render-fanout", componentId: 12 },
        raw: "[doctor:render-fanout@12]",
      },
    ]);
  });

  it("parses inline code and bold without swallowing citations", () => {
    const segs = splitInline("Prop `onSelect` is **new** each render [component:8].");
    expect(segs.some((s) => s.kind === "code" && s.text === "onSelect")).toBe(true);
    expect(segs.some((s) => s.kind === "bold" && s.text === "new")).toBe(true);
    expect(segs.some((s) => s.kind === "citation")).toBe(true);
  });

  it("leaves ordinary bracketed text alone", () => {
    const segs = splitInline("array access [0] and [see docs]");
    expect(segs.every((s) => s.kind === "text")).toBe(true);
  });
});
