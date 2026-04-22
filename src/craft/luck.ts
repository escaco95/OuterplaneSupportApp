import type { LuckReport } from './types.js';

/**
 * Geometric-distribution survival function: given assumed true hit rate `p`,
 * what's the probability of reaching a streak of `N` consecutive misses?
 *
 *     P(streak ≥ N) = (1 − p)^N
 *
 * Interpretation: if this is 0.05, you're in the bottom 5% of luck — 95% of
 * players doing the same rolls would already have hit. Lower = unluckier.
 *
 * The assumed p is user-configurable (hand-wavy estimate). It's used only
 * for this UX hint, never for any decision logic.
 */
export function computeLuck(streak: number, p: number): LuckReport {
  if (streak <= 0) return { probNoHit: 1, percentBottom: 100, percentHitByNow: 0 };
  if (p <= 0 || p >= 1) {
    return { probNoHit: 1, percentBottom: 100, percentHitByNow: 0 };
  }
  const probNoHit = Math.pow(1 - p, streak);
  return {
    probNoHit,
    percentBottom: probNoHit * 100,
    percentHitByNow: (1 - probNoHit) * 100,
  };
}
