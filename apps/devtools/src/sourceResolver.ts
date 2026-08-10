import { createSourceResolver } from "@react-lens/source-maps";

// One resolver for the panel — caches source maps + original source across
// selections. Fetches are same-origin in embedded mode; in the extension the
// panel is a different origin, so these calls degrade gracefully to null.
export const sourceResolver = createSourceResolver();
