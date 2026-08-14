/// <reference lib="webworker" />
/**
 * Diff worker: on-demand snapshot diffs so the trace worker is never blocked
 * by inspector compare work.
 */
import { diff } from "@reactlens/diff-engine";
import type { RenderSnapshot } from "@reactlens/protocol";

type DiffMsg = {
  type: "diff-snapshots";
  requestId: number;
  before: RenderSnapshot;
  after: RenderSnapshot;
};

self.addEventListener("message", (e: MessageEvent<DiffMsg>) => {
  const msg = e.data;
  if (!msg || msg.type !== "diff-snapshots") return;
  try {
    const props = diff({
      kind: "props",
      before: msg.before.props,
      after: msg.after.props,
    });
    const dom =
      msg.before.dom && msg.after.dom
        ? diff({ kind: "dom", before: msg.before.dom, after: msg.after.dom })
        : null;
    (self as DedicatedWorkerGlobalScope).postMessage({
      type: "diff-result",
      requestId: msg.requestId,
      props,
      dom,
    });
  } catch (err) {
    (self as DedicatedWorkerGlobalScope).postMessage({
      type: "diff-result",
      requestId: msg.requestId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
