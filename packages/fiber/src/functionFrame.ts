/**
 * Compiled definition site of a component function, derived WITHOUT any
 * dev-only fiber fields — the only source signal available on a production
 * React build.
 *
 * Technique (a port of React DevTools' `describeNativeComponentFrame`): call
 * the component shallowly inside a sandbox rigged to throw immediately, and
 * capture the resulting "sample" stack. Throw a "control" error from the same
 * depth, then walk both stacks from a deliberately-shared root frame; the
 * first frame that differs is the one describing the component function
 * itself, and the engine reports it with the function's own coordinates.
 *
 * Safety, mirroring DevTools: a re-entrancy latch, a per-function cache, the
 * hook dispatcher nulled so the first hook call throws instead of mutating
 * state, console silenced for the duration, and every global restored in a
 * `finally`.
 */

/** React's dispatcher holder: `.H` on React 19, `.current` before it. */
export interface DispatcherRef {
  H?: unknown;
  current?: unknown;
}

export interface FrameCaptureOptions {
  /** Nulled during the call so hooks throw rather than run. */
  currentDispatcherRef?: DispatcherRef | null | undefined;
  /** Class components must be constructed, not called. */
  construct?: boolean;
}

/** Anything React may treat as a component: call or construct shapes. */
type ComponentLike = (...args: never[]) => unknown;

export interface FrameLocation {
  file: string;
  line: number;
  column: number;
}

/**
 * `Error.prepareStackTrace` is a V8 extension: absent from the DOM lib types,
 * and typed as a required function by @types/node. Both must accept undefined
 * here, so go through an independent view of the constructor.
 */
const ErrorWithPrepare = Error as unknown as {
  prepareStackTrace?: ((err: Error, frames: unknown[]) => unknown) | undefined;
};

let reentry = false;
const frameCache = new WeakMap<object, string | null>();

/** Drop memoized frames (tests; a page navigation invalidates nothing else). */
export function clearFrameCache(): void {
  // WeakMap has no clear(); swap the identity behind the module binding.
  cacheEpoch++;
}
let cacheEpoch = 0;
const epochByFn = new WeakMap<object, number>();

export function describeFunctionFrame(
  fn: unknown,
  { currentDispatcherRef, construct = false }: FrameCaptureOptions,
): string | null {
  if (typeof fn !== "function" || reentry) return null;

  const cached = frameCache.get(fn);
  if (cached !== undefined && epochByFn.get(fn) === cacheEpoch) return cached;

  const previousPrepareStackTrace = ErrorWithPrepare.prepareStackTrace;
  ErrorWithPrepare.prepareStackTrace = undefined;
  reentry = true;
  // Capture BEFORE nulling so a hook-shaped dispatcher can be put back exactly.
  const hadH = currentDispatcherRef != null && "H" in currentDispatcherRef;
  const previousH = currentDispatcherRef?.H;
  const previousCurrent = currentDispatcherRef?.current;
  if (currentDispatcherRef) {
    currentDispatcherRef.H = null;
    if ("current" in currentDispatcherRef) currentDispatcherRef.current = null;
  }
  const restoreLogs = disableLogs();

  try {
    const [sampleStack, controlStack] = captureStacks(fn as ComponentLike, construct);
    const frame = sampleStack && controlStack ? diffFrames(sampleStack, controlStack, fn) : null;
    frameCache.set(fn, frame);
    epochByFn.set(fn, cacheEpoch);
    return frame;
  } finally {
    reentry = false;
    ErrorWithPrepare.prepareStackTrace = previousPrepareStackTrace;
    restoreLogs();
    if (currentDispatcherRef) {
      if (hadH) currentDispatcherRef.H = previousH;
      else delete currentDispatcherRef.H;
      if ("current" in currentDispatcherRef) currentDispatcherRef.current = previousCurrent;
    }
  }
}

/**
 * Both stacks are produced from inside a method named
 * `DetermineComponentFrameRoot` so the two traces share an identifiable root
 * frame even under different VMs' truncation rules.
 */
function captureStacks(fn: ComponentLike, construct: boolean): [string | null, string | null] {
  const RunInRootFrame = {
    DetermineComponentFrameRoot(): [string | null, string | null] {
      let control: unknown;
      try {
        if (construct) {
          // A throwing `props` setter aborts the constructor at its first
          // statement — before any user side effect can run.
          const Fake = function Fake() {
            throw new Error();
          };
          Object.defineProperty(Fake.prototype, "props", {
            set() {
              throw new Error();
            },
          });
          if (typeof Reflect === "object" && Reflect.construct) {
            try {
              Reflect.construct(Fake, []);
            } catch (x) {
              control = x;
            }
            Reflect.construct(fn as unknown as new () => unknown, [], Fake as never);
          } else {
            try {
              (Fake as unknown as () => void).call(undefined);
            } catch (x) {
              control = x;
            }
            let prototypeModified = false;
            let prevProps: PropertyDescriptor | undefined;
            const proto = (fn as unknown as { prototype?: object }).prototype;
            try {
              if (proto) {
                prevProps = Object.getOwnPropertyDescriptor(proto, "props");
                Object.defineProperty(proto, "props", {
                  configurable: true,
                  set() {
                    throw new Error();
                  },
                });
                prototypeModified = true;
              }
              new (fn as unknown as new () => unknown)();
            } finally {
              if (prototypeModified && proto) {
                if (prevProps !== undefined) Object.defineProperty(proto, "props", prevProps);
                else delete (proto as { props?: unknown }).props;
              }
            }
          }
        } else {
          try {
            throw new Error();
          } catch (x) {
            control = x;
          }
          // Props that throw on ANY read: with the dispatcher already nulled,
          // this makes hook-callers AND prop-readers abort inside their own
          // frame. (DevTools passes no props and misses the latter.)
          const maybePromise = (fn as (props: object) => unknown)(throwingProps()) as
            | { catch?: (cb: () => void) => void }
            | undefined;
          // Async components reject once the sandbox tears down; swallow it so
          // no unhandled rejection reaches the page.
          if (maybePromise && typeof maybePromise.catch === "function") {
            maybePromise.catch(() => {});
          }
        }
      } catch (sample) {
        if (sample && control && typeof (sample as Error).stack === "string") {
          return [(sample as Error).stack!, (control as Error).stack ?? null];
        }
      }
      return [null, null];
    },
  };

  // V8 reads `name` when formatting frames; both stacks must show the same one.
  const root = RunInRootFrame.DetermineComponentFrameRoot as unknown as {
    displayName?: string;
  };
  root.displayName = "DetermineComponentFrameRoot";
  const nameDescriptor = Object.getOwnPropertyDescriptor(
    RunInRootFrame.DetermineComponentFrameRoot,
    "name",
  );
  if (nameDescriptor?.configurable) {
    Object.defineProperty(RunInRootFrame.DetermineComponentFrameRoot, "name", {
      value: "DetermineComponentFrameRoot",
    });
  }

  return RunInRootFrame.DetermineComponentFrameRoot();
}

/** First frame present in `sample` but not in `control` — the component's own. */
function diffFrames(sampleStack: string, controlStack: string, fn: unknown): string | null {
  const sampleLines = sampleStack.split("\n");
  const controlLines = controlStack.split("\n");
  let s = 0;
  let c = 0;
  while (s < sampleLines.length && !sampleLines[s]!.includes("DetermineComponentFrameRoot")) s++;
  while (c < controlLines.length && !controlLines[c]!.includes("DetermineComponentFrameRoot")) c++;
  // The injected root frame was truncated away — fall back to the deepest
  // frame the two stacks still share.
  if (s === sampleLines.length || c === controlLines.length) {
    s = sampleLines.length - 1;
    c = controlLines.length - 1;
    while (s >= 1 && c >= 0 && sampleLines[s] !== controlLines[c]) c--;
  }
  for (; s >= 1 && c >= 0; s--, c--) {
    if (sampleLines[s] === controlLines[c]) continue;
    // Both stacks diverging on their first line means the sample threw before
    // entering the component at all (e.g. a class passed as a function).
    if (s !== 1 || c !== 1) {
      do {
        s--;
        c--;
        if (c < 0 || sampleLines[s] !== controlLines[c]) {
          let frame = sampleLines[s]!.replace(" at new ", " at ");
          const displayName = (fn as { displayName?: string }).displayName;
          if (displayName && frame.includes("<anonymous>")) {
            frame = frame.replace("<anonymous>", displayName);
          }
          return frame;
        }
      } while (s >= 1 && c >= 0);
    }
    break;
  }
  return null;
}

/** A props object that throws on any property read (including destructuring). */
function throwingProps(): object {
  return new Proxy(
    {},
    {
      get(_t, key) {
        // Destructuring probes Symbol.toPrimitive/iterator on some paths; only
        // real prop reads should abort, and any throw here is inside the
        // component's own frame either way.
        if (typeof key === "symbol") return undefined;
        throw new Error();
      },
      has() {
        throw new Error();
      },
    },
  );
}

const CONSOLE_METHODS = ["error", "warn", "log", "info", "debug", "trace", "group"] as const;

/** Mute the console while a component runs — it is not a real render. */
function disableLogs(): () => void {
  const target = globalThis.console as unknown as Record<string, unknown>;
  if (!target) return () => {};
  const saved = new Map<string, unknown>();
  for (const method of CONSOLE_METHODS) {
    if (typeof target[method] === "function") {
      saved.set(method, target[method]);
      target[method] = () => {};
    }
  }
  return () => {
    for (const [method, original] of saved) target[method] = original;
  };
}

/**
 * `file:line:column` out of one stack frame. Handles V8
 * (`at Name (url:1:2)` / `at url:1:2`) and Firefox/Safari (`Name@url:1:2`).
 */
export function parseFrameLocation(frame: string): FrameLocation | null {
  const m = /\(?((?:[a-z]+:\/\/[^\s)]+?)|(?:\/[^\s)]+?)|(?:[A-Za-z]:[\\/][^\s)]+?)):(\d+):(\d+)\)?\s*$/.exec(
    frame.trim(),
  );
  if (!m) return null;
  return {
    file: m[1]!.split("?")[0]!,
    line: Number(m[2]),
    column: Number(m[3]),
  };
}
