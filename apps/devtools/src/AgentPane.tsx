import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TraceStore } from "@react-lens/trace-engine";
import type { Causality } from "@react-lens/causality";
import type { ComponentId, RenderId } from "@react-lens/protocol";
import {
  createToolHandlers,
  runAgent,
  PROVIDER_PRESETS,
  type AgentSettings,
  type AgentStep,
} from "@react-lens/agent";
import type { LensRef } from "@react-lens/explain";
import { diagnoseOne } from "./doctor.js";
import { getSourceResolver } from "./sourceResolver.js";
import { loadAgentSettings } from "./settings.js";
import type { TimeCursor } from "./timeCursor.js";

export function AgentPane({
  open,
  store,
  causality,
  settings,
  onClose,
  onOpenSettings,
  onSelectComponent,
  onCursor,
}: {
  open: boolean;
  store: TraceStore;
  causality: Causality;
  settings: AgentSettings | null;
  onClose: () => void;
  onOpenSettings: () => void;
  onSelectComponent?: (id: ComponentId) => void;
  onCursor: (c: TimeCursor) => void;
}) {
  const [question, setQuestion] = useState("Why is this interaction janky?");
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [answer, setAnswer] = useState<string | null>(null);
  const [citations, setCitations] = useState<LensRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

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

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
    }
  }, [open]);

  const run = useCallback(async () => {
    setError(null);
    setAnswer(null);
    setCitations([]);
    setSteps([]);
    const cfg = settings ?? (await loadAgentSettings());
    if (PROVIDER_PRESETS[cfg.provider].keyRequired && !cfg.apiKey.trim()) {
      setError("Add an API key in Settings (BYOK).");
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setRunning(true);
    try {
      const result = await runAgent({
        settings: cfg,
        question,
        handlers,
        signal: ac.signal,
        onStep: (step) => setSteps((prev) => [...prev, step]),
      });
      setAnswer(result.text);
      setCitations(result.citations);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, [settings, question, handlers]);

  const onCitation = useCallback(
    (ref: LensRef) => {
      if (ref.kind === "component") {
        onSelectComponent?.(ref.id);
        return;
      }
      if (ref.kind === "doctor") {
        onSelectComponent?.(ref.componentId);
        return;
      }
      if (ref.kind === "render") {
        onSelectComponent?.(ref.componentId);
        const ev = store.getRender(ref.id as RenderId);
        if (ev) onCursor({ t: ev.timestamp, mode: "historical" });
      }
    },
    [onSelectComponent, onCursor, store],
  );

  if (!open) return null;

  return (
    <aside className="rl-agent" aria-label="Agent">
      <div className="rl-agent-head">
        <strong>Agent</strong>
        <span className="rl-agent-sub">TRACE · GRAPH · DIFF</span>
        <span className="rl-spacer" />
        <button type="button" className="rl-icon-btn" onClick={onOpenSettings} title="Settings">
          ⚙
        </button>
        <button type="button" className="rl-icon-btn" onClick={onClose} aria-label="Close agent">
          ×
        </button>
      </div>
      <div className="rl-agent-ask">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={3}
          placeholder="Why is checkout janky?"
        />
        <button type="button" className="rl-btn primary" disabled={running} onClick={() => void run()}>
          {running ? "Running…" : "Ask"}
        </button>
      </div>
      {error && (
        <div className="rl-agent-error">
          {error}{" "}
          <button type="button" className="rl-narrative-link" onClick={onOpenSettings}>
            Open Settings
          </button>
        </div>
      )}
      <div className="rl-agent-body">
        {steps.map((s, i) => (
          <div key={i} className={`rl-agent-step ${s.role}`}>
            <div className="rl-agent-step-k">
              {s.role === "tool" ? `tool · ${s.name}` : s.role}
            </div>
            <pre>{s.content.slice(0, 600)}</pre>
          </div>
        ))}
        {answer && (
          <div className="rl-agent-answer">
            <div className="rl-agent-step-k">answer</div>
            <p>{answer}</p>
          </div>
        )}
      </div>
      {citations.length > 0 && (
        <div className="rl-narrative-cites" aria-label="Citations">
          {citations.map((ref, i) => (
            <button
              key={i}
              type="button"
              className="rl-narrative-chip"
              onClick={() => onCitation(ref)}
            >
              {ref.kind === "interaction" || ref.kind === "component" || ref.kind === "doctor"
                ? ref.label
                : `r${ref.id}`}
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
