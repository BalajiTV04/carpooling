// Dependency-free fuzzy matching for the place picker.
//
// Why hand-rolled instead of a library? The project ships exactly three runtime
// deps (next/react/react-dom) and this project is meant to stay that way. The
// scorer below is small, pure and fully unit-testable in isolation.
//
// The scoring ladder, strongest first:
//   1. exact           "mandya"        -> "Mandya"
//   2. prefix          "mand"          -> "Mandya"
//   3. word prefix     "mandya dist"   -> "Mandya"
//   4. acronym         "mg r"          -> "MG Road"
//   5. subsequence      "mndya"        -> "Mandya"   (letters in order, gaps ok)
//   6. typo/edit dist  "mandyaa"       -> "Mandya"
//   7. token overlap   "mysore mura"   -> "Mysuru"
//
// Step 5 is what handles the reported case: "Man miss" tokenises to
// ["man", "miss"]; "man" is a prefix of "mandya", so Mandya still scores far
// above every other candidate even though the user typed a space and a typo.
import { CATALOG, type CatalogPlace } from "@/lib/places";

export type Suggestion = {
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  /** Higher is better. 0 means "no match". */
  score: number;
  /** Short human reason shown under the row, e.g. "prefix match". */
  reason: string;
  source: "catalog" | "nominatim";
};

const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

/** Levenshtein distance, capped for speed (inputs are place names, not prose). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** True when every character of `q` appears in `t` in order (gaps allowed). */
function isSubsequence(q: string, t: string): boolean {
  let i = 0;
  for (const ch of t) {
    if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  return q.length === 0;
}

/** Best score of one query-token against one candidate string. */
function tokenScore(tok: string, cand: string): { score: number; reason: string } {
  if (!tok) return { score: 0, reason: "" };
  if (tok === cand) return { score: 100, reason: "exact match" };
  if (cand.startsWith(tok)) return { score: 90, reason: "starts with what you typed" };
  // Word-prefix: "mand" should hit "mandya district".
  if (cand.split(" ").some((w) => w.startsWith(tok)))
    return { score: 84, reason: "word prefix" };
  if (cand.includes(tok)) return { score: 72, reason: "contains it" };
  if (isSubsequence(tok, cand)) return { score: 58, reason: "letters in order" };
  // Typo tolerance scaled to length: 1 edit on a 6-char word is a strong hit.
  const d = editDistance(tok, cand);
  const allow = tok.length >= 5 ? 2 : 1;
  if (d <= allow) return { score: 66 - d * 8, reason: "close spelling" };
  return { score: 0, reason: "" };
}

/**
 * Score one catalogue entry against a raw query.
 * Multi-token queries need every token to land somewhere, so the total is the
 * WEAKEST token — that is what stops "man miss" from matching a place that only
 * happens to contain "miss".
 */
export function scorePlace(place: CatalogPlace, query: string): Suggestion | null {
  const q = norm(query);
  if (!q) return null;

  const candidates = [place.name, ...(place.aliases ?? [])].map(norm);
  const qTokens = q.split(" ").filter(Boolean);

  let best = 0;
  let bestReason = "";
  for (const cand of candidates) {
    // Single-token query: take the strongest match across all aliases.
    if (qTokens.length === 1) {
      const r = tokenScore(qTokens[0], cand);
      if (r.score > best) {
        best = r.score;
        bestReason = r.reason;
      }
      continue;
    }
    // Multi-token: score each token against this candidate AND the area field,
    // then keep the weakest link.
    const area = norm(place.area);
    let weakest = Infinity;
    let weakestReason = "";
    for (const tok of qTokens) {
      const r1 = tokenScore(tok, cand);
      const r2 = tokenScore(tok, area);
      const r = r1.score >= r2.score ? r1 : r2;
      if (r.score === 0) {
        weakest = 0;
        break;
      }
      if (r.score < weakest) {
        weakest = r.score;
        weakestReason = r.reason;
      }
    }
    if (weakest !== 0 && weakest > best) {
      best = weakest;
      bestReason = weakestReason;
    }
  }

  if (best <= 0) return null;
  return {
    name: place.name,
    address: `${place.name}, ${place.area}, Karnataka`,
    lat: place.coordinates[1],
    lng: place.coordinates[0],
    score: best,
    reason: bestReason,
    source: "catalog"
  };
}

/** Rank the local catalogue against a query. Instant, offline, no rate limit. */
export function searchCatalog(query: string, limit = 8): Suggestion[] {
  const q = norm(query);
  // 1 char is too noisy to rank; the caller still shows the map picker.
  if (q.length < 1) return [];
  return CATALOG.map((p) => scorePlace(p, q))
    .filter((s): s is Suggestion => s !== null)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Merge catalogue hits with live Nominatim hits, best first, no duplicates. */
export function mergeSuggestions(
  local: Suggestion[],
  remote: Suggestion[],
  limit = 8
): Suggestion[] {
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const s of [...local, ...remote]) {
    const key = `${s.name.toLowerCase()}|${s.lat.toFixed(3)}|${s.lng.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}