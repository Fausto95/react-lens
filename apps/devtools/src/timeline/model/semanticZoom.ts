export type SemanticZoom = "session" | "interactions" | "renders" | "details";

export function semanticZoomForPxPerMs(pxPerMs: number): SemanticZoom {
  // Keep individual render marks visible through normal whole-session views.
  // Session/interactions are true overview LODs, not the default for a short
  // ~100ms recording where users still expect to see the render clips.
  if (pxPerMs < 0.5) return "session";
  if (pxPerMs < 2) return "interactions";
  if (pxPerMs < 120) return "renders";
  return "details";
}

export function rendersIndividualEvents(level: SemanticZoom): boolean {
  return level === "renders" || level === "details";
}
