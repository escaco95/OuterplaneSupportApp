import type { ScanRow } from '../detect/types.js';

/**
 * Rank template — one entry per UI row (0–4):
 *   0 = don't care (this slot can be any stat at any rank)
 *   N (1–4) = "a valuable stat of rank ≥ N must appear in SOME row"
 *
 * Position-agnostic: the template is a multiset of minimum-rank requirements,
 * matched against the actual 4 rows via the match.ts algorithm. So a template
 * of [3,3,3,0] demands that 3 of the 4 rows be (rank≥3 AND valuable), with
 * the 4th row unconstrained.
 *
 * Mirrors the in-game 위력 UI visually in the config form even though matching
 * ignores the specific row each value is entered in.
 */
export type Template = readonly [number, number, number, number];

export interface CraftConfig {
  /** Canonical stat strings the user cares about (e.g. "체력%", "속도"). */
  valuable: string[];
  /**
   * 1–2 rank templates (OR semantics): a preview is a HIT when ANY template
   * matches. Lets the user express alternatives like "3,3,3,? or 3,3,2,2"
   * that a single multiset can't capture.
   */
  templates: Template[];
  /** Upper bound on reroll iterations before giving up. */
  maxIter: number;
}

export interface SessionState {
  totalAttempts: number;
  totalHits: number;
  currentStreak: number;
  longestStreak: number;
  /** ISO timestamp of the most recent hit, or null if never. */
  lastHitAt: string | null;
}

export function emptyState(): SessionState {
  return {
    totalAttempts: 0,
    totalHits: 0,
    currentStreak: 0,
    longestStreak: 0,
    lastHitAt: null,
  };
}

/** Events emitted by AutoRerollController over its lifetime. */
export type CraftEvent =
  | {
      type: 'iteration';
      iter: number;
      maxIter: number;
      rows: ScanRow[];
      /** Human-friendly log line matching the skill's format. */
      logLine: string;
    }
  | {
      type: 'settled';
      settleMs: number;
      timedOut: boolean;
    }
  | {
      type: 'hit';
      iter: number;
      rows: ScanRow[];
      state: SessionState;
      elapsedMs: number;
    }
  | {
      type: 'detection-failure';
      iter: number;
      rows: ScanRow[];
      /** Canonical BGRA buffer captured at the failing frame. */
      canonical: Buffer;
      canonicalSize: { width: number; height: number };
      /** Which rows failed — stat null, or pct ambiguous. */
      failedRows: number[];
    }
  | {
      type: 'limit';
      state: SessionState;
      elapsedMs: number;
    }
  | {
      type: 'fail';
      reason: string;
      /** If the failure is screen-validation, list the ROIs that fell below threshold. */
      screenFailedRois?: string[];
    }
  | {
      type: 'done';
      state: SessionState;
      elapsedMs: number;
    };

/**
 * Adaptive-settle tuning. Poll cadence after a reroll click to detect the
 * moment the UI stabilizes. See settle.ts for the rule.
 */
export interface SettleTuning {
  /** Don't bother polling before this — the game never responds faster. */
  minMs: number;
  /** Polling interval after minMs. */
  pollMs: number;
  /** Safety cap — if no stable state detected, take what we have and move on. */
  maxMs: number;
}

export const DEFAULT_SETTLE: SettleTuning = {
  minMs: 1200,
  pollMs: 200,
  maxMs: 3500,
};
