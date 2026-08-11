import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TraceStore } from "@reactlens/trace-engine";
import type { Causality } from "@reactlens/causality";
import type { ComponentId, RenderId } from "@reactlens/protocol";
import {
  createToolHandlers,
  createAgentSession,
  buildEvidencePack,
  PROVIDER_PRESETS,
  type AgentSession,
  type AgentSettings,
  type AgentStep,
  type ChatMessage,
  type ToolName,
} from "@reactlens/agent";
import type { LensRef } from "@reactlens/explain";
import { IconCopy } from "@reactlens/icons";
import { diagnoseOne } from "./doctor.js";
import { getSourceResolver } from "./sourceResolver.js";
import { loadAgentSettings } from "./settings.js";
import { Markdown, type CitationRef } from "./markdown.js";
import type { TimeCursor } from "./timeCursor.js";

const SUGGESTIONS = [
  "Why is the last interaction slow?",
  "What changed in the component that renders the most?",
  "How do I fix the top issue?",
];

interface PendingTurn {
  text: string;
  activity: Array<{ name: ToolName; summary: string }>;
}

/**
 * BYOK conversation with the React Lens agent. The session is bound to the
 * current store + settings; changing either starts a fresh conversation.
 */
export function AgentPane({
  open,
  store,
  causality,
  settings,
  settingsVersion = 0,
  askRequest = null,
  onClose,
  onOpenSettings,
  onSelectComponent,
  onCursor,
}: {
  open: boolean;
  store: TraceStore;
  causality: Causality;
  settings: AgentSettings | null;
  /** Bump to reset the conversation (e.g. after saving settings). */
  settingsVersion?: number;
  /** Inline "Fix with AI": a pre-built question to auto-ask (token dedupes). */
  askRequest?: { token: number; question: string } | null;
  onClose: () => void;
  onOpenSettings: () => void;
  onSelectComponent?: (id: ComponentId) => void;
  onCursor: (c: TimeCursor) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const sessionRef = useRef<AgentSession | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const handlers = useMemo(
    () =>
      createToolHandlers({
        store,
        causality,
        diagnose: (id) => diagnoseOne(store, causality, id),
        sourceResolver: getSourceResolver(),
      }),
    [store, causality],
  );

  const resetConversation = useCallback(() => {
    abortRef.current?.abort();
    sessionRef.current = null;
    setMessages([]);
    setPending(null);
    setError(null);
    setRunning(false);
  }, []);

  // New settings or a new store = a new conversation (the transcript embeds both).
  useEffect(() => resetConversation(), [resetConversation, settingsVersion, store]);
  useEffect(() => {
    if (!open) abortRef.current?.abort();
  }, [open]);
  useEffect(() => () => abortRef.current?.abort(), []);

  // Keep the newest turn in view while streaming.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || running) return;
      setError(null);
      setInput("");
      const cfg = settings ?? (await loadAgentSettings());
      if (PROVIDER_PRESETS[cfg.provider].keyRequired && !cfg.apiKey.trim()) {
        setError("Add an API key in Settings (BYOK).");
        setInput(q); // keep the question staged for after the key is saved
        return;
      }
      if (!sessionRef.current) {
        sessionRef.current = createAgentSession({
          settings: cfg,
          handlers,
          evidence: buildEvidencePack(store),
        });
      }
      const session = sessionRef.current;
      const ac = new AbortController();
      abortRef.current = ac;
      setRunning(true);
      setMessages([...session.messages, { role: "user", content: q }]);
      setPending({ text: "", activity: [] });
      try {
        await session.send(q, {
          signal: ac.signal,
          onEvent: (e) => {
            if (e.type === "text_delta") {
              setPending((p) => (p ? { ...p, text: p.text + e.text } : p));
            } else if (e.type === "tool_start") {
              setPending((p) =>
                p
                  ? { ...p, text: "", activity: [...p.activity, { name: e.name, summary: "" }] }
                  : p,
              );
            } else if (e.type === "tool_result") {
              setPending((p) => {
                if (!p) return p;
                const activity = [...p.activity];
                const lastIndex = activity.map((a) => a.name).lastIndexOf(e.name);
                if (lastIndex >= 0) activity[lastIndex] = { name: e.name, summary: e.summary };
                return { ...p, activity };
              });
            }
          },
        });
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setMessages([...session.messages]);
        setPending(null);
        setRunning(false);
      }
    },
    [handlers, running, settings, store],
  );

  // Inline "Fix with AI" entry points (tree rows, timeline bars) auto-ask.
  // If a run is already in flight, stage the question in the input instead.
  const consumedAsk = useRef(0);
  useEffect(() => {
    if (!open || !askRequest || askRequest.token === consumedAsk.current) return;
    consumedAsk.current = askRequest.token;
    if (running) setInput(askRequest.question);
    else void ask(askRequest.question);
  }, [open, askRequest, running, ask]);

  // Navigate to the cited evidence, then close the drawer: it overlays the
  // inspector and timeline it just pointed at, so staying open makes the jump
  // invisible. The conversation survives — reopening (⌘I) resumes it.
  const onCitation = useCallback(
    (ref: CitationRef | LensRef) => {
      let navigated = false;
      if (ref.kind === "component") {
        onSelectComponent?.(ref.id as ComponentId);
        navigated = onSelectComponent !== undefined;
      } else if (ref.kind === "doctor") {
        onSelectComponent?.(ref.componentId as ComponentId);
        navigated = onSelectComponent !== undefined;
      } else if (ref.kind === "render") {
        const ev = store.getRender(ref.id as RenderId);
        if (ev) {
          onSelectComponent?.(ev.componentId);
          onCursor({ t: ev.timestamp, mode: "historical" });
          navigated = true;
        }
      } else {
        // Interaction: seek the timeline to its start.
        const interaction = store.interactions().find((i) => String(i.id) === String(ref.id));
        if (interaction) {
          onCursor({ t: interaction.start, mode: "historical" });
          navigated = true;
        }
      }
      // Closing aborts an in-flight run — mid-stream, navigate but stay open.
      if (navigated && !running) onClose();
    },
    [onSelectComponent, onCursor, onClose, store, running],
  );

  if (!open) return null;

  return (
    <aside className="rl-agent" aria-label="AI assistant">
      <div className="rl-agent-head">
        <strong>Assistant</strong>
        <span className="rl-agent-sub">
          grounded in this session's trace
          {settings?.model ? ` · ${settings.model}` : ""}
        </span>
        <span className="rl-spacer" />
        {messages.length > 0 && (
          <button type="button" className="rl-narrative-link" onClick={resetConversation}>
            Clear
          </button>
        )}
        <button
          type="button"
          className="rl-icon-btn"
          onClick={onOpenSettings}
          title="Provider settings (BYOK)"
        >
          ⚙
        </button>
        <button
          type="button"
          className="rl-icon-btn"
          onClick={onClose}
          aria-label="Close assistant"
        >
          ×
        </button>
      </div>

      <div className="rl-agent-body" ref={bodyRef}>
        {messages.length === 0 && !pending && (
          <div className="rl-agent-empty">
            <p>Ask about this recording — answers cite real renders, components and timings.</p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                className="rl-btn rl-agent-suggest"
                onClick={() => void ask(s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="rl-agent-turn user">
              {m.content}
            </div>
          ) : (
            <AssistantTurn
              key={i}
              content={m.content}
              steps={m.steps}
              citations={m.citations}
              onCitation={onCitation}
            />
          ),
        )}
        {pending && (
          <div className="rl-agent-turn assistant">
            <ActivityChips activity={pending.activity} />
            {pending.text ? (
              <Markdown text={pending.text} onCitation={onCitation} />
            ) : (
              <span className="rl-agent-thinking">thinking…</span>
            )}
          </div>
        )}
        {error && (
          <div className="rl-agent-error">
            {error}{" "}
            <button type="button" className="rl-narrative-link" onClick={onOpenSettings}>
              Open Settings
            </button>
          </div>
        )}
      </div>

      <div className="rl-agent-ask">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(input);
            }
          }}
          rows={2}
          placeholder={messages.length === 0 ? "Why is this interaction janky?" : "Follow up…"}
          disabled={running}
        />
        {running ? (
          <button type="button" className="rl-btn" onClick={() => abortRef.current?.abort()}>
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="rl-btn primary"
            disabled={!input.trim()}
            onClick={() => void ask(input)}
          >
            Ask
          </button>
        )}
      </div>
    </aside>
  );
}

function AssistantTurn({
  content,
  steps,
  citations,
  onCitation,
}: {
  content: string;
  steps: AgentStep[];
  citations: LensRef[];
  onCitation: (ref: LensRef) => void;
}) {
  const activity = steps
    .filter((s) => s.role === "tool")
    .map((s) => ({ name: (s.name ?? "tool") as ToolName, summary: s.content }));
  const [copied, setCopied] = useState(false);
  return (
    <div className="rl-agent-turn assistant">
      <button
        type="button"
        className="rl-agent-copy"
        title="Copy answer as Markdown"
        aria-label="Copy answer"
        onClick={() => {
          void navigator.clipboard?.writeText(content);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? "✓" : <IconCopy size={11} />}
      </button>
      <ActivityChips activity={activity} />
      <Markdown text={content} onCitation={onCitation as never} />
      {citations.length > 0 && (
        <div className="rl-narrative-cites" aria-label="Citations">
          {citations.map((ref, i) => (
            <button
              key={i}
              type="button"
              className="rl-narrative-chip"
              onClick={() => onCitation(ref)}
            >
              {ref.kind === "render" ? `r${ref.id}` : ref.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Collapsed tool-activity row; click a chip to inspect the raw result. */
function ActivityChips({ activity }: { activity: Array<{ name: ToolName; summary: string }> }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (activity.length === 0) return null;
  return (
    <div className="rl-agent-activity">
      <div className="rl-agent-activity-row">
        {activity.map((a, i) => (
          <button
            key={i}
            type="button"
            className={`rl-agent-chip${openIndex === i ? " open" : ""}${a.summary ? "" : " busy"}`}
            onClick={() => setOpenIndex(openIndex === i ? null : i)}
            title={a.summary ? "Show tool result" : "Running…"}
          >
            ⚙ {a.name}
          </button>
        ))}
      </div>
      {openIndex !== null && activity[openIndex]?.summary && (
        <pre className="rl-agent-step-detail">{activity[openIndex].summary.slice(0, 4000)}</pre>
      )}
    </div>
  );
}
