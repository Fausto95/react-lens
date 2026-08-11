import { useEffect, useRef, type RefObject } from "react";

/**
 * The latest value, readable from a callback that must not re-subscribe.
 *
 * Long-lived callbacks — a window listener, a replay ticker — need current
 * props without being torn down and reinstalled whenever those props change.
 * Keying the effect on them restarts the ticker on every trace ingest, which
 * is exactly the bug that froze replay twice.
 *
 * The usual shorthand is `ref.current = value` in the component body, and it
 * is a Rules of React violation: render must be pure, and a ref write is not.
 * React Compiler enforces it — a component doing this is skipped wholesale,
 * losing memoization everywhere else in the file for one assignment. Writing
 * in an effect is both legal and equivalent here, because every reader runs
 * after commit.
 */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  // No dependency array: the point is to track *every* render.
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}
