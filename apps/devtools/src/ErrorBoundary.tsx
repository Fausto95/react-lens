import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "./errors.js";

/**
 * Containment for one region of the panel.
 *
 * Without this, a single bad derivation — a clip with a NaN width, a snapshot
 * the store evicted mid-read — unmounts the entire panel, and with it the
 * effect that owns the port. The session then stops arriving, so the crash
 * costs the trace as well as the view. A boundary per column means the timeline
 * can fail while the tree, the inspector and ingest carry on.
 *
 * Retry re-mounts only this region: the trace store is authoritative and lives
 * outside React, so a second attempt reads whatever has arrived since.
 */
export class ErrorBoundary extends Component<
  {
    /** Region name, reported alongside the failure. */
    scope: string;
    children?: ReactNode;
    /** Render your own recovery UI instead of the default region card. */
    fallback?: (error: Error, retry: () => void) => ReactNode;
  },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The component stack is the only pointer to which region actually threw,
    // and React logs it nowhere once a boundary handles the throw. Fold it into
    // the error's own stack rather than filing a second report about the first.
    if (info.componentStack) {
      error.stack = `${error.stack ?? error.message}\n\nComponent stack:${info.componentStack}`;
    }
    reportError(this.props.scope, error);
  }

  private retry = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.retry);
    return (
      <div className="rl-region-error" role="alert">
        <p>
          <strong>{this.props.scope}</strong> stopped working.
        </p>
        <p className="rl-region-error-message">{error.message}</p>
        <button type="button" onClick={this.retry}>
          Retry
        </button>
      </div>
    );
  }
}
