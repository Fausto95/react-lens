import { createSourceResolver, type Fetcher, type SourceResolver } from "@reactlens/source-maps";

/**
 * Panel source resolver. Embedded mode uses default same-origin fetch; the
 * extension calls `configureSourceFetcher` to proxy through the inspected page.
 */
let resolver: SourceResolver = createSourceResolver();

export function configureSourceFetcher(next: Fetcher | undefined): void {
  resolver = next ? createSourceResolver(next) : createSourceResolver();
}

export function getSourceResolver(): SourceResolver {
  return resolver;
}

/** @deprecated Prefer getSourceResolver() after configureSourceFetcher. */
export const sourceResolver: SourceResolver = {
  resolve: (compiled) => getSourceResolver().resolve(compiled),
  sourceContent: (file, prefer) => getSourceResolver().sourceContent(file, prefer),
  clear: () => getSourceResolver().clear(),
};

export type { Fetcher };
