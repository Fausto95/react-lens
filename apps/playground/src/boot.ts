import { createEmbeddedRuntime } from "@reactlens/devtools/runtime";

/**
 * Boot must be the first import in main.tsx: it installs the owned React
 * DevTools hook before react-dom evaluates and registers its renderer. This
 * module's dependency graph deliberately excludes react-dom for that reason.
 */
export const runtime = createEmbeddedRuntime();
runtime.start();
