import type { ScanRow } from '../detect/types.js';
import type { Template } from './types.js';

/**
 * Position-agnostic template match: are there enough valuable rows at high
 * enough ranks to satisfy every non-zero slot in the template?
 *
 * Algorithm:
 *   1. Drop zero slots (don't-care). Sort remaining template descending.
 *   2. Collect actual rows where (stat ∈ valuable). Sort by rank descending.
 *   3. Greedy pairing: template[i] must be satisfied by valuableRows[i].
 *      Sorted greedy is optimal here because both arrays are sorted by the
 *      same key — if the top valuable can't cover the top template slot, no
 *      other pairing can either.
 *
 * Examples (valuable check abbreviated as "V"):
 *   template [3,3,3,0], rows = 3× (V,rank3) + 1× (non-V, rank anything) → PASS
 *   template [3,3,3,0], rows = 2× (V,rank3) + 1× (V,rank2) + 1× (V,rank1) → FAIL
 *   template [3,3,2,2], rows = 4× V with ranks [3,3,2,2] → PASS
 *   template [3,3,2,2], rows = 3× V (ranks any) + 1× non-V → FAIL (4th req unmet)
 */
export function matches(
  rows: ScanRow[],
  template: Template,
  valuable: ReadonlySet<string>
): boolean {
  const reqs = template.filter((r) => r > 0).sort((a, b) => b - a);
  if (reqs.length === 0) return true; // empty template trivially matches

  const vRanks: number[] = [];
  for (const row of rows) {
    if (row.stat !== null && valuable.has(row.stat)) {
      vRanks.push(row.rank);
    }
  }
  vRanks.sort((a, b) => b - a);

  if (vRanks.length < reqs.length) return false;
  for (let i = 0; i < reqs.length; i++) {
    if (vRanks[i] < reqs[i]) return false;
  }
  return true;
}

/**
 * Build a fingerprint string that captures everything settle cares about:
 * per-row (stat | rank). Two equal fingerprints on back-to-back captures
 * means the UI is stable at that state.
 */
export function fingerprint(rows: ScanRow[]): string {
  const parts: string[] = [];
  for (const row of rows) {
    parts.push(`${row.stat ?? 'UNKNOWN'}#${row.rank}`);
  }
  return parts.join('|');
}

/**
 * Junk-state guard: filter out mid-animation captures so settle doesn't
 * lock onto a transient state.
 *
 * In the final stable To-Be panel every row has a progress bar at rank ≥ 1
 * (the game never renders an empty bar for a real option). During the reroll
 * burst / fade-in any of:
 *   - all 4 ranks read 0 (flash plateau)
 *   - a subset of rows render while others are still mid-fade (e.g. [0,0,0,1])
 * can produce a briefly-stable fingerprint that doesn't reflect the true
 * final state. So we treat any row with rank=0 as evidence of a transition.
 */
export function isJunkState(rows: ScanRow[]): boolean {
  for (const row of rows) {
    if (row.rank === 0) return true;
  }
  return false;
}
