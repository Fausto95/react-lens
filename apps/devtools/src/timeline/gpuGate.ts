/**
 * Decide whether the OffscreenCanvas worker path should be preferred.
 * At very large layouts the structured-clone cost of Lane[] dominates — prefer
 * transferable geometry when available.
 */
export function preferWorkerPaint(args: {
  clipEstimate: number;
  hasGeometry: boolean;
  offscreenAvailable: boolean;
}): boolean {
  if (!args.offscreenAvailable) return false;
  if (args.hasGeometry) return true;
  // Without geometry, keep worker for medium traces; fall back to main when
  // cloning would dominate (huge clip lists).
  return args.clipEstimate < 20_000;
}
