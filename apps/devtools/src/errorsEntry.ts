/**
 * The error seam as the extension shell consumes it. Separate entry so the
 * panel host can report and contain failures without pulling in the whole
 * panel module graph.
 */
export {
  reportError,
  subscribeErrors,
  lensErrors,
  clearErrors,
  installGlobalErrorHandlers,
  ERROR_RING_MAX,
  type LensError,
  type ErrorEventTarget,
  type ErrorLikeEvent,
} from "./errors.js";
export { ErrorBoundary } from "./ErrorBoundary.js";
export { ErrorChip } from "./ErrorChip.js";
