import type { ScreenProfile } from '../profile.js';
import { compareHistograms, computeHistogram, resizeBGRANearest } from './histogram.js';

/** Module-level scratch buffer reused across assessScreen calls to avoid GC pressure. */
let canonicalScratch: Buffer | null = null;
function getScratch(size: number): Buffer {
  if (!canonicalScratch || canonicalScratch.length !== size) {
    canonicalScratch = Buffer.alloc(size);
  }
  return canonicalScratch;
}

/**
 * Resize-only path for callers that already know the screen is valid (e.g.
 * settle-polling between reroll clicks where the screen can't navigate away
 * faster than the poll interval). Shares the scratch buffer with assessScreen
 * so back-to-back calls are allocation-free.
 */
export function toCanonical(
  captureBuf: Buffer,
  captureW: number,
  captureH: number,
  cw: number,
  ch: number
): Buffer {
  const canonical = getScratch(cw * ch * 4);
  resizeBGRANearest(captureBuf, captureW, captureH, canonical, cw, ch);
  return canonical;
}

export interface ScreenAssessment {
  match: boolean;
  minScore: number;
  failedRois: string[];
  scores: Array<{ id: string; score: number }>;
  /** The canonical 1280×720 BGRA buffer produced during assessment. */
  canonical: Buffer;
}

/**
 * Validate that a captured frame is on the profile's target screen, and return
 * the canonical 1280×720 BGRA buffer (also used downstream by stat/rank scan).
 * This means stat/rank code can consume `canonical` directly without re-resizing.
 */
export function assessScreen(
  captureBuf: Buffer,
  captureW: number,
  captureH: number,
  profile: ScreenProfile
): ScreenAssessment {
  const cw = profile.canonicalSize.width;
  const ch = profile.canonicalSize.height;
  const canonical = getScratch(cw * ch * 4);
  resizeBGRANearest(captureBuf, captureW, captureH, canonical, cw, ch);

  const bins = profile.histogramFormat.binsPerChannel;
  const threshold = profile.matching.threshold;

  const scores: Array<{ id: string; score: number }> = [];
  const failedRois: string[] = [];
  let minScore = 1;

  for (const roi of profile.rois) {
    const [nx, ny, nw, nh] = roi.bbox;
    const rx = Math.round(nx * cw);
    const ry = Math.round(ny * ch);
    const rw = Math.max(1, Math.round(nw * cw));
    const rh = Math.max(1, Math.round(nh * ch));
    if (rx < 0 || ry < 0 || rx + rw > cw || ry + rh > ch) {
      failedRois.push(roi.id);
      scores.push({ id: roi.id, score: 0 });
      minScore = 0;
      continue;
    }
    const hist = computeHistogram(canonical, cw, rx, ry, rw, rh, bins);
    const score = compareHistograms(hist, roi.histogram);
    scores.push({ id: roi.id, score });
    if (score < minScore) minScore = score;
    if (score < threshold) failedRois.push(roi.id);
  }

  return { match: failedRois.length === 0, minScore, failedRois, scores, canonical };
}
