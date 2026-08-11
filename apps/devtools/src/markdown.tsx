import { Fragment, useState } from "react";
import { openInEditor } from "./openInEditor.js";

/**
 * Dependency-free markdown for agent answers: headings, paragraphs, lists,
 * inline code/bold, and fenced code whose info string may carry `lang
 * file:line` (rendered with Copy + Open-in-editor). Inline `[component:12]`
 * style Lens ID tokens become clickable citation chips.
 */

export type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "para"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "code"; lang?: string; file?: string; line?: number; code: string };

export type InlineSeg =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "citation"; ref: CitationRef; raw: string };

export type CitationRef =
  | { kind: "component"; id: number }
  | { kind: "render"; id: number }
  | { kind: "interaction"; id: string }
  | { kind: "doctor"; ruleId: string; componentId: number };

export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith("```")) {
      const info = parseFenceInfo(line.slice(3).trim());
      const code: string[] = [];
      i++;
      // Unterminated fences render as code so streaming looks right mid-answer.
      while (i < lines.length && !lines[i]!.startsWith("```")) {
        code.push(lines[i]!);
        i++;
      }
      i++; // closing fence (or EOF)
      blocks.push({ kind: "code", ...info, code: code.join("\n") });
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1]!.length, text: heading[2]! });
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push({ kind: "list", items });
      continue;
    }
    if (line.trim() === "") {
      i++;
      continue;
    }
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !/^(#{1,4}\s|```|\s*[-*]\s)/.test(lines[i]!)
    ) {
      para.push(lines[i]!);
      i++;
    }
    blocks.push({ kind: "para", text: para.join(" ") });
  }
  return blocks;
}

export function parseFenceInfo(info: string): { lang?: string; file?: string; line?: number } {
  if (!info) return {};
  const [lang, loc] = info.split(/\s+/, 2);
  const out: { lang?: string; file?: string; line?: number } = {};
  if (lang) out.lang = lang;
  if (loc) {
    const m = /^(.*?)(?::(\d+))?$/.exec(loc);
    if (m?.[1]) {
      out.file = m[1];
      if (m[2]) out.line = Number(m[2]);
    }
  }
  return out;
}

const CITATION = /\[(component|render|interaction|doctor):([^\]\s]+)\]/g;
const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\[(?:component|render|interaction|doctor):[^\]\s]+\])/g;

function parseCitation(raw: string): CitationRef | null {
  CITATION.lastIndex = 0;
  const m = CITATION.exec(raw);
  if (!m || m[0] !== raw) return null;
  const [, kind, value] = m as unknown as [string, string, string];
  switch (kind) {
    case "component": {
      const id = Number(value);
      return Number.isFinite(id) ? { kind: "component", id } : null;
    }
    case "render": {
      const id = Number(value);
      return Number.isFinite(id) ? { kind: "render", id } : null;
    }
    case "interaction":
      return { kind: "interaction", id: value };
    case "doctor": {
      const at = value.lastIndexOf("@");
      if (at <= 0) return null;
      const componentId = Number(value.slice(at + 1));
      if (!Number.isFinite(componentId)) return null;
      return { kind: "doctor", ruleId: value.slice(0, at), componentId };
    }
    default:
      return null;
  }
}

export function splitInline(text: string): InlineSeg[] {
  const segs: InlineSeg[] = [];
  let last = 0;
  INLINE.lastIndex = 0;
  for (let m = INLINE.exec(text); m; m = INLINE.exec(text)) {
    if (m.index > last) segs.push({ kind: "text", text: text.slice(last, m.index) });
    const token = m[0];
    if (token.startsWith("`")) {
      segs.push({ kind: "code", text: token.slice(1, -1) });
    } else if (token.startsWith("**")) {
      segs.push({ kind: "bold", text: token.slice(2, -2) });
    } else {
      const ref = parseCitation(token);
      if (ref) segs.push({ kind: "citation", ref, raw: token });
      else segs.push({ kind: "text", text: token });
    }
    last = m.index + token.length;
  }
  if (last < text.length) segs.push({ kind: "text", text: text.slice(last) });
  return segs;
}

// ── React rendering ──────────────────────────────────────────────────────────

export function Markdown({
  text,
  onCitation,
}: {
  text: string;
  onCitation?: (ref: CitationRef) => void;
}) {
  const blocks = parseMarkdown(text);
  return (
    <div className="rl-md">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "heading":
            return (
              <div key={i} className={`rl-md-h rl-md-h${Math.min(b.level, 3)}`}>
                <Inline text={b.text} onCitation={onCitation} />
              </div>
            );
          case "list":
            return (
              <ul key={i} className="rl-md-list">
                {b.items.map((item, j) => (
                  <li key={j}>
                    <Inline text={item} onCitation={onCitation} />
                  </li>
                ))}
              </ul>
            );
          case "code":
            return <CodeBlock key={i} block={b} />;
          case "para":
            return (
              <p key={i}>
                <Inline text={b.text} onCitation={onCitation} />
              </p>
            );
        }
      })}
    </div>
  );
}

function Inline({ text, onCitation }: { text: string; onCitation?: (ref: CitationRef) => void }) {
  return (
    <>
      {splitInline(text).map((seg, i) => {
        switch (seg.kind) {
          case "code":
            return <code key={i}>{seg.text}</code>;
          case "bold":
            return <strong key={i}>{seg.text}</strong>;
          case "citation":
            return (
              <button
                key={i}
                type="button"
                className="rl-narrative-chip rl-md-cite"
                onClick={() => onCitation?.(seg.ref)}
                title={seg.raw}
              >
                {citationLabel(seg.ref)}
              </button>
            );
          default:
            return <Fragment key={i}>{seg.text}</Fragment>;
        }
      })}
    </>
  );
}

function citationLabel(ref: CitationRef): string {
  switch (ref.kind) {
    case "component":
      return `⬡ ${ref.id}`;
    case "render":
      return `r${ref.id}`;
    case "interaction":
      return `ixn ${ref.id}`;
    case "doctor":
      return ref.ruleId;
  }
}

function CodeBlock({ block }: { block: Extract<Block, { kind: "code" }> }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(block.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };
  return (
    <div className="rl-md-code">
      <div className="rl-md-code-bar">
        <span className="rl-md-code-loc">
          {block.file
            ? `${block.file}${block.line ? `:${block.line}` : ""}`
            : (block.lang ?? "code")}
        </span>
        <span className="rl-spacer" />
        <button type="button" className="rl-narrative-link" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
        {block.file && (
          <button
            type="button"
            className="rl-narrative-link"
            onClick={() => openInEditor(block.file!, block.line ?? 1)}
          >
            Open in editor
          </button>
        )}
      </div>
      <pre>{block.code}</pre>
    </div>
  );
}
