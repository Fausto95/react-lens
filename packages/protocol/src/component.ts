import type { ComponentId, ComponentType, RootId, CommitId } from "./ids.js";

export interface SourceLocation {
  file: string;
  line: number;
  column: number;
}

/**
 * React Compiler status for a component. The Compiler being on is an
 * architectural input (DESIGN §1.4): a re-render may be caused by the Compiler
 * failing to memoize, which is legitimate — not a developer mistake.
 */
export interface CompilerStatus {
  compiled: boolean;
  memoized: boolean;
  bailoutReason?: string;
}

export interface ComponentInstance {
  id: ComponentId;
  type: ComponentType;
  name: string;
  parentId?: ComponentId;
  ownerId?: ComponentId;
  rootId: RootId;
  source?: SourceLocation;
  compiler: CompilerStatus;
  /**
   * Structural role when not a plain client component:
   * - suspense — a <Suspense> boundary
   * - server-boundary — Flight/RSC client or server reference (heuristic)
   */
  kind?: "component" | "suspense" | "server-boundary";
  /** Flight/RSC metadata when `kind` is server-boundary. */
  rsc?: {
    role: "client-reference" | "server-reference" | "lazy-payload";
    moduleId?: string;
    exportName?: string;
  };
  /** Sits under a <Suspense> boundary. */
  underSuspense?: boolean;
  /** The nearest Suspense boundary is currently showing its fallback. */
  suspended?: boolean;
  /** Nearest Suspense boundary's component id, when under one. */
  suspenseBoundaryId?: ComponentId;
}

/** A single React commit pass. Cheap: ids + timing, never serialized data. */
export interface CommitInfo {
  commitId: CommitId;
  rootId: RootId;
  timestamp: number;
  rendered: ComponentId[];
}
