import type { CascadeCause, CascadeNode } from "./model.js";

function causeLabel(cause: CascadeCause): string {
  return cause === "parent" ? "cascade" : cause;
}

/** Lowercased haystack a query token can hit: name, cause, and aggregate kind. */
export function cascadeSearchHaystack(node: CascadeNode): string {
  const bits = [node.name, causeLabel(node.cause)];
  if (node.cause === "parent") bits.push("parent");
  if (node.kind === "aggregate") bits.push("aggregate");
  return bits.join(" ").toLowerCase();
}

/**
 * Space-separated tokens are AND-combined. Each token is a case-insensitive
 * substring of the node's name, cause label (`cascade` for parent), or
 * `aggregate`. An empty / whitespace query matches nothing — search is opt-in.
 */
export function nodeMatchesQuery(node: CascadeNode, query: string): boolean {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return false;
  const hay = cascadeSearchHaystack(node);
  return tokens.every((token) => hay.includes(token));
}

const EMPTY_POSTING: readonly number[] = [];

/**
 * Trigram (and 1-/2-gram) inverted index. Built once per layout — already O(n)
 * to place the nodes — so each keystroke is posting-list intersection + verify,
 * O(matches), not a scan of the graph.
 */
export interface CascadeSearchIndex {
  nodes: readonly CascadeNode[];
  haystacks: readonly string[];
  /** Sorted unique node indices per gram. Insertion order is 0..n-1, so lists stay sorted. */
  grams: ReadonlyMap<string, readonly number[]>;
}

export function buildCascadeSearchIndex(nodes: readonly CascadeNode[]): CascadeSearchIndex {
  const haystacks: string[] = [];
  const grams = new Map<string, number[]>();
  for (let i = 0; i < nodes.length; i++) {
    const hay = cascadeSearchHaystack(nodes[i]!);
    haystacks.push(hay);
    indexHaystack(hay, i, grams);
  }
  return { nodes, haystacks, grams };
}

/**
 * Query the index. Empty query → no hits (search is opt-in). Layout order is
 * preserved so next/prev walks the graph left-to-right, top-to-bottom.
 */
export function queryCascadeSearchIndex(index: CascadeSearchIndex, query: string): CascadeNode[] {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return [];

  let candidates: readonly number[] | null = null;
  for (const token of tokens) {
    const posting = postingForToken(index, token);
    if (posting.length === 0) return [];
    candidates = candidates === null ? posting : intersectSorted(candidates, posting);
    if (candidates.length === 0) return [];
  }

  const hits: CascadeNode[] = [];
  for (const i of candidates ?? EMPTY_POSTING) {
    const hay = index.haystacks[i]!;
    if (tokens.every((token) => hay.includes(token))) hits.push(index.nodes[i]!);
  }
  return hits;
}

export function matchCascadeNodes(nodes: readonly CascadeNode[], query: string): CascadeNode[] {
  if (!query.trim()) return [];
  return queryCascadeSearchIndex(buildCascadeSearchIndex(nodes), query);
}

function tokenizeQuery(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function indexHaystack(hay: string, nodeIndex: number, grams: Map<string, number[]>): void {
  const seen = new Set<string>();
  const add = (gram: string) => {
    if (seen.has(gram)) return;
    seen.add(gram);
    const list = grams.get(gram);
    if (list) list.push(nodeIndex);
    else grams.set(gram, [nodeIndex]);
  };
  for (let i = 0; i < hay.length; i++) {
    add(hay[i]!);
    if (i + 1 < hay.length) add(hay.slice(i, i + 2));
    if (i + 2 < hay.length) add(hay.slice(i, i + 3));
  }
}

function postingForToken(index: CascadeSearchIndex, token: string): readonly number[] {
  if (token.length <= 3) return index.grams.get(token) ?? EMPTY_POSTING;
  let posting: readonly number[] | null = null;
  for (let i = 0; i <= token.length - 3; i++) {
    const next = index.grams.get(token.slice(i, i + 3)) ?? EMPTY_POSTING;
    if (next.length === 0) return EMPTY_POSTING;
    posting = posting === null ? next : intersectSorted(posting, next);
    if (posting.length === 0) return EMPTY_POSTING;
  }
  return posting ?? EMPTY_POSTING;
}

function intersectSorted(a: readonly number[], b: readonly number[]): number[] {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const av = a[i]!;
    const bv = b[j]!;
    if (av === bv) {
      out.push(av);
      i++;
      j++;
    } else if (av < bv) i++;
    else j++;
  }
  return out;
}
