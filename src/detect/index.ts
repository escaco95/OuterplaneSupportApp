import type { ScreenProfile } from '../profile.js';
import { assessScreen, toCanonical } from './screen.js';
import { scanStats } from './stat-scan.js';
import { scanRanks } from './rank-scan.js';
import {
  DEFAULT_THRESHOLDS,
  type ScanResult,
  type ScanRow,
  type ScanThresholds,
  type StatReferences,
} from './types.js';

export * from './types.js';
export * from './histogram.js';
export * from './screen.js';
export * from './binary-mask.js';
export * from './stat-scan.js';
export * from './rank-scan.js';
export * from './refs.js';
export * from './stat-catalog.js';

/**
 * Unified scan: BGRA capture → ScanResult. Does screen validation, stat scan,
 * rank scan on the same canonical 1280×720 buffer (resize happens once).
 *
 * If screen validation fails, still returns per-row scan output so the caller
 * can make UX decisions (e.g. show "wrong screen" vs "detection failure"); the
 * canonical buffer is always valid.
 */
export interface ScanOptions {
  /**
   * Skip the screen-profile histogram check. Use during settle-polling where
   * validation can't change faster than polls fire, so the extra ~20ms is
   * pure overhead. First call per iteration should always validate.
   */
  skipValidation?: boolean;
}

export function scan(
  captureBuf: Buffer,
  captureW: number,
  captureH: number,
  screenProfile: ScreenProfile,
  refs: StatReferences,
  thresholds: ScanThresholds = DEFAULT_THRESHOLDS,
  opts: ScanOptions = {}
): ScanResult {
  const CW = screenProfile.canonicalSize.width;
  const CH = screenProfile.canonicalSize.height;

  let canonical: Buffer;
  let screenValid = true;
  let screenFailedRois: string[] = [];
  if (opts.skipValidation) {
    canonical = toCanonical(captureBuf, captureW, captureH, CW, CH);
  } else {
    const s = assessScreen(captureBuf, captureW, captureH, screenProfile);
    canonical = s.canonical;
    screenValid = s.match;
    screenFailedRois = s.failedRois;
  }

  const statRows = scanStats(canonical, CW, CH, refs, thresholds);
  const ranks = scanRanks(canonical, CW, CH);
  const rows: ScanRow[] = statRows.map((r, i) => ({ ...r, rank: ranks[i] }));

  return { screenValid, screenFailedRois, rows, canonical };
}
