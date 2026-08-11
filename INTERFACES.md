# React Lens — Package Interface Spec

Concrete seams for the packages in [DESIGN.md](DESIGN.md). These are the
public contracts each package exports. Internals are free to change; these
signatures are the promises across the one-way layering boundary.

TypeScript rules in force: strict, no `any` in public APIs (`unknown` + narrow,
`as never` over `as any`), invariants encoded in types where possible.

---

## protocol

Zero dependencies. Every other package imports from here; it imports from none.

### IDs — branded, compact at runtime

```ts
// Branded so a ComponentId can never be passed where an EventId is expected.
type Brand<T, B> = T & { readonly __brand: B };

type RootId = Brand<number, "RootId">;
type ComponentId = Brand<number, "ComponentId">; // one per fiber instance
type ComponentType = Brand<number, "ComponentType">; // shared across instances
type RenderId = Brand<number, "RenderId">;
type CommitId = Brand<number, "CommitId">;
type EventId = Brand<number, "EventId">;
type InteractionId = Brand<number, "InteractionId">;
type EffectId = Brand<number, "EffectId">;

// Human-readable strings are produced only at the UI boundary.
```

### Serialized values — the wire representation of app data

```ts
type SerializedValue =
  | { k: "primitive"; type: "string" | "number" | "boolean"; value: string | number | boolean }
  | { k: "null" }
  | { k: "undefined" }
  | { k: "bigint"; value: string }
  | { k: "symbol"; description?: string; identity: string }
  | { k: "function"; identity: string; name?: string } // identity enables diffing
  | { k: "date"; iso: string }
  | { k: "regexp"; source: string; flags: string }
  | { k: "array"; identity: string; length: number; items?: SerializedValue[] } // items omitted if over budget
  | { k: "object"; identity: string; ctor?: string; entries?: [string, SerializedValue][] }
  | { k: "map"; identity: string; size: number; entries?: [SerializedValue, SerializedValue][] }
  | { k: "set"; identity: string; size: number; values?: SerializedValue[] }
  | { k: "dom"; identity: string; nodeName: string } // never the live node
  | { k: "react-element"; identity: string; typeName?: string }
  | { k: "ref"; identity: string } // back-ref for cycles
  | { k: "unserializable"; reason: string };
```

`identity` is a stable string minted by `serializer` per underlying reference
within a session. Two snapshots sharing an `identity` are the same reference —
this is the entire basis of reference-vs-value diffing.

### Events

```ts
interface BaseEvent {
  id: EventId;
  timestamp: number; // performance.now() on the page clock
  componentId?: ComponentId;
  interactionId?: InteractionId;
  causedBy?: EventId[]; // filled by `causality`, absent at capture
}

interface RenderEvent extends BaseEvent {
  type: "render";
  renderId: RenderId;
  commitId: CommitId;
  componentId: ComponentId;
  selfDuration: number;
  totalDuration: number;
  reasons: RenderReason[]; // captured cheaply; enriched later
  compiler: CompilerStatus; // §DESIGN 1.4 — first-class
}

type RenderReason =
  | { type: "mount" }
  | { type: "props"; changed: string[] } // key names only at capture
  | { type: "state"; hookIndex: number }
  | { type: "context"; contextType: ComponentType }
  | { type: "parent"; componentId: ComponentId }
  | { type: "external-store" }
  | { type: "force-update" }
  | { type: "compiler-bailout"; reason: string };

interface CompilerStatus {
  compiled: boolean;
  memoized: boolean;
  bailoutReason?: string; // e.g. "unsupported mutation"
}

interface InteractionEvent extends BaseEvent {
  type: "interaction";
  interactionId: InteractionId;
  kind: "click" | "keypress" | "submit" | "navigation" | "hover" | "drag" | "transition";
  target?: { selector: string; componentId?: ComponentId };
}

interface StateChangeEvent extends BaseEvent {
  type: "state-change";
  componentId: ComponentId;
  hookIndex: number;
  before: SerializedValue;
  after: SerializedValue;
}

// PropsChangeEvent, ContextChangeEvent, EffectEvent, NetworkEvent, QueryEvent,
// LayoutEvent, PaintEvent, DiagnosticEvent follow the same shape.

type LensEvent = RenderEvent | InteractionEvent | StateChangeEvent /* | ... */;
```

### Messages — versioned envelope

```ts
interface LensMessage<T = unknown> {
  protocolVersion: 1;
  type: string; // discriminant, e.g. "events/batch"
  payload: T;
}

// Concrete channels:
type EventsBatch = LensMessage<{ events: LensEvent[]; snapshots: RenderSnapshot[] }>;
type SnapshotReq = LensMessage<{ componentId: ComponentId; renderId: RenderId }>;
type Hello = LensMessage<{ runtimeVersion: string; reactVersion: string; tabId: number }>;
```

### Snapshots

```ts
interface RenderSnapshot {
  renderId: RenderId;
  componentId: ComponentId;
  timestamp: number;
  props: SerializedValue;
  state?: SerializedValue;
  context?: SerializedValue;
  hooks?: SerializedValue;
  dom?: DOMSnapshot; // §DESIGN 6 — captured in v1
}

interface DOMSnapshot {
  root: DOMNodeSnapshot;
}
interface DOMNodeSnapshot {
  nodeName: string;
  attributes?: Record<string, string>;
  text?: string;
  children?: DOMNodeSnapshot[];
}
```

### Time travel

```ts
// The panel never sends values — only which render's captured raw state the
// page should restore (DESIGN §10.5).
interface TimeTravelEntry {
  componentId: ComponentId;
  renderId: RenderId;
}
interface TimeTravelResult {
  applied: number;
  failed: number;
  supported: boolean;
}
```

---

## serializer

`[protocol]`. Pure on the value side; holds one piece of session state (the
identity table). Runs on the page.

```ts
interface SerializeOptions {
  maxDepth: number; // default 4
  maxItems: number; // per array/object, default 50
  maxStringLength: number; // default 1_000
}

interface Serializer {
  serialize(value: unknown, opts?: Partial<SerializeOptions>): SerializedValue;
  // Stable identity for a reference within this session. Same ref → same id.
  // Uses a WeakMap; never retains a strong ref to app objects.
  identityOf(value: object | Function): string;
  reset(): void; // clears identity table on session end
}

function createSerializer(): Serializer;
```

Invariant: `serialize` never throws (unserializable → `{ k: "unserializable" }`)
and never follows a live reference into the app graph beyond `maxDepth`.

---

## fiber

`[protocol]`. Page-side. Owns the injected hook (§DESIGN 7). The **only** module
allowed to touch React internals; everything else goes through this interface.

```ts
interface ComponentInstance {
  id: ComponentId;
  type: ComponentType;
  name: string;
  parentId?: ComponentId;
  ownerId?: ComponentId;
  rootId: RootId;
  source?: SourceLocation;
  compiler: CompilerStatus;
}

interface SourceLocation {
  file: string;
  line: number;
  column: number;
}

interface CommitInfo {
  commitId: CommitId;
  rootId: RootId;
  timestamp: number;
  rendered: ComponentId[]; // fibers that committed this pass
}

interface FiberBridge {
  // Installed at document_start, before React. Chains a pre-existing hook
  // rather than clobbering it.
  install(): void;

  // DOM → Fiber → Component. Null if the node is not React-owned.
  resolveComponent(node: Node): ComponentInstance | null;
  // Reverse: component → its host DOM nodes (via WeakRef).
  domNodesOf(id: ComponentId): Node[];

  getInstance(id: ComponentId): ComponentInstance | null;
  getCompilerStatus(id: ComponentId): CompilerStatus;

  // Commit callbacks. Cheap: hand back ids + timing, not serialized data.
  onCommit(cb: (commit: CommitInfo) => void): Dispose;
  onUnmount(cb: (id: ComponentId) => void): Dispose;

  // Live edit / time travel (dev-build renderer only; see DESIGN §10.5).
  canEditValues(): boolean;
  setProp(id: ComponentId, path: Array<string | number>, value: unknown): boolean;
  setHookState(
    id: ComponentId,
    hookIndex: number,
    path: Array<string | number>,
    value: unknown,
  ): boolean;
  setClassState(id: ComponentId, state: unknown): boolean;
  hasFiber(id: ComponentId): boolean;
  captureLiveState(id: ComponentId): LiveState | undefined; // raw refs, baseline + shape guard
}

type Dispose = () => void;

function createFiberBridge(): FiberBridge;
```

Risk noted in DESIGN §7 flag: `getCompilerStatus` depends on React 19 exposing
bailout reasons in a reachable place. If unavailable, `bailoutReason` is
`undefined` and `compiled` is best-effort — verify before relying on it.

---

## instrumentation

`[protocol, fiber, serializer]`. Page-side orchestrator. Turns commits + browser
events into `LensEvent`s and ships batched frames. Owns the overhead budget.

```ts
interface Instrumentation {
  start(config: CaptureConfig): void;
  stop(): void;
  isRecording(): boolean;
  snapshot(renderId: RenderId): RenderSnapshot | undefined; // on-demand (large apps)
  timeTravel: TimeTravelController; // page-side raw-state history (DESIGN §10.5)
}

interface TimeTravelController {
  supported(): boolean; // renderer exposes the override API
  isActive(): boolean; // events suppressed while true
  apply(entries: TimeTravelEntry[]): TimeTravelResult;
  goLive(): TimeTravelResult; // restore baselines, resume recording
}

interface CaptureConfig {
  captureDOM: boolean; // v1: true
  ringBuffer: { maxEvents: number; maxRendersPerComponent: number };
  serialize: Partial<SerializeOptions>;
  captureStateHistory?: boolean; // raw time-travel history (default true)
  onFrame: (frame: EventsBatch) => void; // wired to postMessage transport
}

function createInstrumentation(deps: {
  fiber: FiberBridge;
  serializer: Serializer;
}): Instrumentation;
```

Batches on `requestIdleCallback`/microtask boundaries; never one message per
event. Self-measures and reports overhead as a `DiagnosticEvent` about itself.

---

## trace-engine

`[protocol]`. Panel-side, in the worker. The single source of truth: the
normalized event log + ring buffers. Framework-free, unit-testable.

```ts
interface TraceStore {
  ingest(frame: EventsBatch): void;

  // Queries — the TRACE primitive.
  eventsByInteraction(id: InteractionId): LensEvent[];
  rendersOf(id: ComponentId): RenderEvent[]; // capped history
  snapshot(renderId: RenderId): RenderSnapshot | undefined;
  instance(id: ComponentId): ComponentInstance | undefined;

  // Historical resolution (time travel).
  renderAtOrBefore(id: ComponentId, t: number): RenderEvent | undefined;
  snapshotAtOrBefore(id: ComponentId, t: number): RenderSnapshot | undefined;
  commitAt(t: number): CommitSummary | undefined;

  // Narrow subscriptions — panel subscribes to slices, not the whole log.
  subscribe(sel: TraceSelector, cb: () => void): Dispose;

  stats(): { events: number; renders: number; bytesApprox: number };
}

// Pure apply-set computation for real time travel (DESIGN §10.5):
// which (component, render) pairs constitute the page state at time t,
// and the delta against what was last applied.
function applySetAt(store: TraceStore, t: number): Map<ComponentId, RenderId>;
function diffApplySet(
  prev: ReadonlyMap<ComponentId, RenderId>,
  next: ReadonlyMap<ComponentId, RenderId>,
): TimeTravelEntry[];

// Commit-cost outliers (≥5× median with an 8ms floor, at/above p95).
// Shared by the Timeline's ⚠ markers and the agent's evidence pack.
function anomalyStats(commits: CommitSummary[]): AnomalyStats;
interface AnomalyStats {
  median: number;
  p95: number;
  max: number;
  isAnomaly(c: CommitSummary): boolean;
}

type TraceSelector =
  | { kind: "component"; id: ComponentId }
  | { kind: "interaction"; id: InteractionId }
  | { kind: "global" };
```

---

## diff-engine

`[protocol, serializer]`. Pure. One engine, strategy table keyed by target kind
(§DESIGN 3). Built and tested standalone first.

```ts
type DiffTarget =
  | { kind: "value"; before: SerializedValue; after: SerializedValue }
  | { kind: "props"; before: SerializedValue; after: SerializedValue }
  | { kind: "state"; before: SerializedValue; after: SerializedValue }
  | { kind: "context"; before: SerializedValue; after: SerializedValue }
  | { kind: "hooks"; before: SerializedValue; after: SerializedValue }
  | { kind: "dom"; before: DOMSnapshot; after: DOMSnapshot };
// open union: css | visual | tree | performance slot in later, untouched core

type ChangeKind =
  | "UNCHANGED"
  | "VALUE_CHANGED"
  | "REFERENCE_ONLY_CHANGED" // identity differs, structure equal
  | "FUNCTION_IDENTITY_CHANGED"
  | "STRUCTURE_CHANGED"
  | "ADDED"
  | "REMOVED";

interface DiffChange {
  path: (string | number)[];
  kind: ChangeKind;
  before?: SerializedValue;
  after?: SerializedValue;
  confidence: number; // 0..1; e.g. function behavior unknown
}

interface DiffResult {
  target: DiffTarget["kind"];
  changes: DiffChange[]; // UNCHANGED entries omitted unless requested
  summary: {
    changed: number;
    referenceOnly: number; // key signal for "suspicious render"
    observableOutputChanged: boolean; // DOM target only
  };
}

// Declarative dispatch — no switch ladder in callers.
type DiffStrategy<T extends DiffTarget> = (t: T) => DiffResult;
const strategies: { [K in DiffTarget["kind"]]: DiffStrategy<Extract<DiffTarget, { kind: K }>> };

function diff(target: DiffTarget): DiffResult;
```

---

## causality

`[protocol, trace-engine, diff-engine]`. Pure inference. Reconstructs
`causedBy` edges and answers "why did this render?" — the GRAPH primitive.

```ts
interface TraceEdge {
  from: EventId;
  to: EventId;
  type: "triggered" | "scheduled" | "rendered" | "committed" | "requested" | "resolved";
  confidence: number; // solid ≈ 1, inferred < 1
}

interface WhyResult {
  render: RenderEvent;
  // Progressive disclosure, ranked; earliest actionable cause first.
  causes: Array<{
    level: 1 | 2 | 3; // parent → what changed → originating call site
    explanation: string; // plain English (DESIGN §Explanation style)
    confidence: number;
    diff?: DiffResult;
    sourceLocation?: SourceLocation;
  }>;
  observableOutputChanged: boolean; // from the DOM diff — drives "suspicious"
}

interface Causality {
  buildEdges(events: LensEvent[]): TraceEdge[];
  why(renderId: RenderId): WhyResult;
  rootCause(renderId: RenderId): WhyResult["causes"][number] | undefined;
}
```

Never emits "unnecessary render" — uses "potentially avoidable / no observable
output change" with the attached confidence.

---

## diagnostics

`[protocol]`. Pure rules over runtime evidence + optional static findings.
OXC parses in the Doctor worker when available; `analyzeSourceSmart` falls back
to regex (§DESIGN 8).

```ts
interface DiagnosticInput {
  componentId: ComponentId;
  name: string;
  renders: number;
  suspiciousRenders: number;
  selfTime: number;
  functionPropChurn: boolean;
  uncompiled: boolean;
  source?: SourceLocation;
}

interface Diagnostic {
  ruleId: string;
  componentId: ComponentId;
  severity: "info" | "warn" | "suspicious" | "severe";
  title: string;
  detail: string;
  impact: number;
  fix?: string;
  source?: SourceLocation;
}

function analyze(inputs: DiagnosticInput[]): Diagnostic[];
function analyzeOne(input: DiagnosticInput): Diagnostic[];
function analyzeSourceSmart(source: string, opts, regexFallback): Promise<StaticFinding[]>;
function mergeStaticAndRuntime(
  staticFindings: StaticFinding[],
  runtime: Diagnostic[],
  evidence: {
    componentId: ComponentId;
    selfTime: number;
    renders: number;
    suspiciousRenders?: number;
  },
): Diagnostic[];
```

---

## source-maps

`[protocol]`. Compiled `_debugStack` coords → original file/line via injectable
fetcher (page-proxied in the extension).

```ts
type Fetcher = (url: string) => Promise<string>;

interface SourceResolver {
  resolve(compiled: SourceLocation): Promise<SourceLocation | null>;
  sourceContent(compiledFile: string, prefer?: string): Promise<OriginalSource | null>;
  clear(): void;
}

function createSourceResolver(fetcher?: Fetcher): SourceResolver;
```

Protocol messages: `source/request` `{ requestId, url }` → `source/response`
`{ requestId, url, body?, error? }` (body capped ~2MB).

---

## explain

`[protocol, trace-engine, causality, diagnostics]`. Deterministic interaction
narrative — no LLM.

```ts
function explainInteraction(
  store: TraceStore,
  causality: Causality,
  interaction: Interaction,
  opts?: { diagnose?: (id: ComponentId) => Diagnostic[] },
): Narrative;

interface Narrative {
  headline: string;
  summary: string;
  topCost: Array<{ componentId; name; self; renderId; wasted }>;
  waste: Array<{ componentId; name; renderId; self }>;
  chain: Cause[];
  doctor: Diagnostic[];
  nextClick: { kind: "component" | "render" | "doctor"; id; reason } | null;
  citations: LensRef[];
}
```

---

## agent

`[trace-engine, causality, diff-engine, diagnostics, explain, source-maps, graph]`.
Closed tool loop over OpenAI-compatible / Anthropic chat APIs (BYOK), streamed
(SSE with buffered fallback). Answers the five product questions grounded in
the trace, and proposes concrete fixes from the user's actual source.

```ts
interface AgentSettings {
  provider: "openai" | "anthropic" | "zml";
  baseUrl: string;
  apiKey: string;
  model: string;
}

function createToolHandlers(deps: {
  store: TraceStore;
  causality: Causality;
  diagnose: (id: ComponentId) => Diagnostic[];
  sourceResolver: SourceResolver;
}): ToolHandlers; // typed results per tool (ToolResultMap)

// Multi-turn conversation; the session owns the provider transcript.
function createAgentSession(opts: {
  settings: AgentSettings;
  handlers: ToolHandlers;
  evidence?: EvidencePack; // ~1-2KB session digest in the first turn
}): AgentSession;
interface AgentSession {
  send(
    question: string,
    opts?: { signal?: AbortSignal; onEvent?: (e: AgentEvent) => void },
  ): Promise<AgentAnswer>;
  readonly messages: ChatMessage[];
}
type AgentEvent = model_start | text_delta | tool_start | tool_result | done | error;

function buildEvidencePack(store: TraceStore): EvidencePack; // stats, interactions,
// top components, commit anomalies (trace-engine anomalyStats), compiler coverage

// Tools (11): explain_interaction | query_trace | why | find_component |
//   component_renders | read_component_source | effects_summary |
//   graph_neighbors | diff_snapshots | diagnose | resolve_source
// - why carries per-cause diff summaries, top changed paths, and the cause's
//   source location (e.g. the re-rendering parent's file:line).
// - read_component_source returns a line-numbered snippet scoped to the
//   definition via diagnostics.definitionSpan — the fix-proposing enabler.
// - Tool results are budgeted (6KB, 10KB for source) before reaching the model.
```

Answers must cite Lens ID tokens (`[component:12]`, `[render:412]`,
`[interaction:i3]`, `[doctor:rule@12]`) the panel turns into clickable chips.
The prompt enforces the React Compiler invariant (no manual memoization advice
for compiled components) and a fix contract: `read_component_source` + `why`
before any fenced `lang file:line` code proposal. Keys stay on-device except
as auth headers to the user-configured provider (`openai` | `anthropic`/Claude
| `zml`/Z.AI GLM via Anthropic-compatible `https://api.z.ai/api/anthropic`,
model `glm-5v-turbo`); direct browser calls to Anthropic send the
`anthropic-dangerous-direct-browser-access` opt-in header.

---

## Cross-cutting invariants

- `protocol` imports nothing; the dependency arrows in DESIGN §3 are enforced by
  the build (no cycles, no inner→outer imports).
- Page-half packages (`fiber`, `serializer`, `instrumentation`) ship no React
  and never call `setState`.
- Every inferred relationship carries a `confidence`. The UI encodes it
  (solid/dashed, opacity) rather than presenting inference as fact.
- IDs are numeric and branded internally; human-readable strings appear only at
  the UI boundary.
- The Agent may only call the closed tool set; it is not a general chatbot over
  the app heap.
