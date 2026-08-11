/**
 * Tiny fuzzy scorer for the command palette: case-insensitive subsequence
 * match with bonuses for consecutive runs (strongest), word-boundary hits,
 * and early positions. Returns null when the query is not a subsequence.
 *
 * Greedy matching from the first character can misalign ("card" grabbing the
 * c of "produCt" instead of "Card"), so the match is re-anchored at every
 * occurrence of the first query character and the best score wins.
 */
export function fuzzyScore(query: string, text: string): number | null {
  if (query.length === 0) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let best: number | null = null;
  for (let start = t.indexOf(q[0]!); start !== -1; start = t.indexOf(q[0]!, start + 1)) {
    const s = scoreFrom(q, t, text, start);
    if (s !== null && (best === null || s > best)) best = s;
  }
  return best;
}

function scoreFrom(q: string, t: string, text: string, start: number): number | null {
  let score = 0;
  let prevHit = -2;
  let ti = start;
  for (let qi = 0; qi < q.length; qi++) {
    const idx = t.indexOf(q[qi]!, ti);
    if (idx === -1) return null;
    score += 1;
    if (idx === prevHit + 1) score += 3; // consecutive run — the strongest signal
    // Word boundary: start of text, after a separator, or a camelCase hump.
    else if (idx === 0 || !/[a-z0-9]/.test(t[idx - 1]!) || /[A-Z]/.test(text[idx]!)) score += 2;
    score -= idx * 0.01; // earlier is better
    prevHit = idx;
    ti = idx + 1;
  }
  return score;
}
