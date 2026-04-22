import type { ScreenProfile } from '../profile.js';
import { captureRender } from '../ldplayer.js';
import { scan, type ScanResult, type StatReferences } from '../detect/index.js';
import { fingerprint, isJunkState } from './match.js';
import { DEFAULT_SETTLE, type SettleTuning } from './types.js';

export interface SettleResult {
  scan: ScanResult;
  settleMs: number;
  /** True if the safety cap was hit without detecting a stable state. */
  timedOut: boolean;
}

/**
 * Adaptive settle: wait minMs, then poll every pollMs until a non-junk
 * fingerprint appears twice in a row (AND differs from pre-click). Cap at
 * maxMs — if we hit the cap, return the most recent non-junk scan.
 *
 * Why this shape:
 *   - Fixed 3s sleep worked but wasted 1–2s per iteration on fast rerolls.
 *   - "Wait for pixel-stable state" is the real signal: the game animation
 *     finishes, then nothing changes. Two consecutive equal fingerprints
 *     confirms "nothing changing".
 *   - The reroll burst animation has a bright-flash plateau where rank bars
 *     are obscured → rank=0 across all rows. Two burst captures can look
 *     identical, so we filter out rank-sum-zero states (isJunkState).
 *   - minMs exists because polls before that are guaranteed to catch burst
 *     or pre-animation state — wasted CPU.
 *
 * If the window goes away mid-settle (capture returns null), treat that as
 * transient and keep polling until cap. The caller's next iteration will
 * observe the disappearance through its own capture path.
 */
export async function waitForSettle(
  windowKey: string,
  screenProfile: ScreenProfile,
  statRefs: StatReferences,
  preFingerprint: string,
  tuning: SettleTuning = DEFAULT_SETTLE
): Promise<SettleResult | null> {
  await sleep(tuning.minMs);
  let elapsed = tuning.minMs;

  let lastFp: string | null = null;
  let lastScan: ScanResult | null = null;

  while (elapsed < tuning.maxMs) {
    const cap = captureRender(windowKey);
    if (cap) {
      const result = scan(cap.buffer, cap.width, cap.height, screenProfile, statRefs, undefined, {
        skipValidation: true,
      });
      if (!isJunkState(result.rows)) {
        const fp = fingerprint(result.rows);
        if (fp !== preFingerprint && lastFp === fp) {
          return { scan: result, settleMs: elapsed, timedOut: false };
        }
        lastFp = fp;
        lastScan = result;
      }
    }
    await sleep(tuning.pollMs);
    elapsed += tuning.pollMs;
  }

  // Safety cap — take whatever the last non-junk scan was.
  if (lastScan) {
    return { scan: lastScan, settleMs: elapsed, timedOut: true };
  }

  // Never saw a non-junk scan. Do a final capture so caller has SOMETHING.
  const cap = captureRender(windowKey);
  if (!cap) return null;
  const result = scan(cap.buffer, cap.width, cap.height, screenProfile, statRefs, undefined, {
    skipValidation: true,
  });
  return { scan: result, settleMs: elapsed, timedOut: true };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
