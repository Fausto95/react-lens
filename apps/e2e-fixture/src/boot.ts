import { createEmbeddedRuntime } from "@reactlens/devtools/runtime";
import { reportError } from "@reactlens/devtools/errors";

/**
 * Boot must be the first import in main.tsx: it installs the owned React
 * DevTools hook before react-dom evaluates and registers its renderer.
 */
export const runtime = createEmbeddedRuntime();
runtime.start();

/** E2E seam — ErrorChip without relying on window error handlers. */
(window as unknown as { __lensReportError?: (msg: string) => void }).__lensReportError = (msg) => {
  reportError("e2e", new Error(msg));
};
