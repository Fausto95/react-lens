export type SemanticZoom = "session" | "interactions" | "renders" | "details";

export function semanticZoomForPxPerMs(pxPerMs: number): SemanticZoom {
  if (pxPerMs < 8) return "session";
  if (pxPerMs < 30) return "interactions";
  if (pxPerMs < 120) return "renders";
  return "details";
}

export function rendersIndividualEvents(level: SemanticZoom): boolean {
  return level === "renders" || level === "details";
}
