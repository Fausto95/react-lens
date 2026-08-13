import { Suspense, useState } from "react";
import { Button, Card, Section } from "@reactlens/demo-ui";

export function SuspenseDemo() {
  const [key, setKey] = useState(0);
  return (
    <Section kicker="Deals" title="Limited offer" hint="Reload to suspend the child, then resolve.">
      <Button size="sm" onClick={() => setKey((k) => k + 1)}>
        Reload (suspend)
      </Button>
      <div style={{ marginTop: 12 }}>
        <Suspense fallback={<div className="demo-meta">Loading…</div>}>
          <AsyncContent key={key} nonce={key} />
        </Suspense>
      </div>
    </Section>
  );
}
SuspenseDemo.displayName = "SuspenseDemo";

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
    <Card style={{ background: "var(--demo-accent-soft)", borderColor: "#b7dccf" }}>
      Resolved content (load #{nonce})
    </Card>
  );
}
AsyncContent.displayName = "AsyncContent";
