import { Suspense, useState } from "react";
import { Section, btn } from "./ui.js";

/** A Suspense boundary whose child suspends on a promise, then resolves —
 *  the inspector/tree show the ◇ suspended badge while the fallback is up. */
export function SuspenseDemo() {
  const [key, setKey] = useState(0);
  return (
    <Section
      title="Suspense"
      hint="Reload to suspend the child (~800ms). While it's pending, the tree/inspector show the ◇ suspended badge."
    >
      <button style={btn} onClick={() => setKey((k) => k + 1)}>
        Reload (suspend)
      </button>
      <div style={{ marginTop: 12 }}>
        <Suspense fallback={<div style={{ color: "#a0a6b2" }}>Loading…</div>}>
          <AsyncContent key={key} nonce={key} />
        </Suspense>
      </div>
    </Section>
  );
}

// A tiny suspense resource cache keyed by nonce.
const cache = new Map<number, Resource>();
interface Resource {
  status: "pending" | "done";
  promise: Promise<void>;
}
function getResource(nonce: number): Resource {
  let r = cache.get(nonce);
  if (!r) {
    const res: Resource = {
      status: "pending",
      promise: new Promise<void>((resolve) =>
        setTimeout(() => {
          res.status = "done";
          resolve();
        }, 1_200),
      ),
    };
    cache.set(nonce, res);
    r = res;
  }
  return r;
}

function AsyncContent({ nonce }: { nonce: number }) {
  const resource = getResource(nonce);
  if (resource.status === "pending") throw resource.promise;
  return (
    <div style={{ padding: 12, borderRadius: 8, background: "#eefaf0", border: "1px solid #cdeccf" }}>
      Resolved content (load #{nonce})
    </div>
  );
}
