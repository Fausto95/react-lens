import { createEmbeddedRuntime } from "@react-lens/devtools/runtime";

/**
 * Boot must be the first import in main.tsx: it installs the owned React
 * DevTools hook before react-dom evaluates and registers its renderer — so the
 * panel can inspect this very site. Deliberately excludes react-dom from its
 * dependency graph for that reason.
 */
export const runtime = createEmbeddedRuntime();
runtime.start();
