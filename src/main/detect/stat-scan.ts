import { extractBinaryMask, iou } from './binary-mask.js';
import {
  DEFAULT_THRESHOLDS,
  type RowIndex,
  type ScanRow,
  type ScanThresholds,
  type StatReferences,
} from './types.js';

/**
 * Per-row stat name + pct marker scan on a canonical 1280×720 BGRA buffer.
 *
 * Matching rules (align with the PowerShell skill so both produce identical
 * output on the same capture):
 *   name: pick highest-IoU reference *for this row*. Accept iff
 *         best >= nameMinConf AND (best - second) >= nameMinMargin.
 *   pct : default "no"; promote to "yes" iff yesScore >= pctYesMinConf.
 *         The "no" reference is captured from arbitrary digits and doesn't
 *         generalize, so it's used only for pctScore reporting, not decision.
 *
 * Row-keyed references are required — matching against all rows at once
 * produced alignment-noise false positives (same stat scored ~0.88 against
 * the "wrong" row's reference due to nearest-neighbor pixel shifts).
 */
export function scanStats(
  canonical: Buffer,
  CW: number,
  CH: number,
  refs: StatReferences,
  thresholds: ScanThresholds = DEFAULT_THRESHOLDS
): ScanRow[] {
  const rows: ScanRow[] = [];

  const nameRoi = refs.rois.name;
  const pctRoi = refs.rois.percent;

  for (let i = 0; i < 4; i++) {
    const rowNum = (i + 1) as RowIndex;

    // Name ROI
    const nrx = Math.round(nameRoi.nx * CW);
    const nry = Math.round(nameRoi.ny[i] * CH);
    const nrw = Math.round(nameRoi.nw * CW);
    const nrh = Math.round(nameRoi.nh * CH);
    const namePix = extractBinaryMask(canonical, CW, nrx, nry, nrw, nrh);

    // Pct ROI
    const prx = Math.round(pctRoi.nx * CW);
    const pry = Math.round(pctRoi.ny[i] * CH);
    const prw = Math.max(1, Math.round(pctRoi.nw * CW));
    const prh = Math.max(1, Math.round(pctRoi.nh * CH));
    const pctPix = extractBinaryMask(canonical, CW, prx, pry, prw, prh);

    // Name match (row-keyed): track best + second for margin check.
    let bestName: string | null = null;
    let bestNameScore = 0;
    let secondScore = 0;
    for (const entry of refs.stats) {
      if (entry.row !== rowNum) continue;
      if (!entry.mask || entry.mask.length !== namePix.length) continue;
      const sc = iou(namePix, entry.mask);
      if (sc > bestNameScore) {
        secondScore = bestNameScore;
        bestNameScore = sc;
        bestName = entry.name;
      } else if (sc > secondScore) {
        secondScore = sc;
      }
    }

    // Pct match: yes requires absolute confidence, else default no.
    let yesScore = 0;
    let noScore = 0;
    for (const entry of refs.percentMarkers) {
      if (entry.row !== rowNum) continue;
      if (!entry.mask || entry.mask.length !== pctPix.length) continue;
      const sc = iou(pctPix, entry.mask);
      if (entry.type === 'yes') yesScore = sc;
      else if (entry.type === 'no') noScore = sc;
    }
    const pctIsYes = yesScore >= thresholds.pctYesMinConf;
    const pctType: 'yes' | 'no' = pctIsYes ? 'yes' : 'no';
    const pctScore = pctIsYes ? yesScore : noScore;

    // Canonical display string assembly.
    const nameOk =
      bestName !== null &&
      bestNameScore >= thresholds.nameMinConf &&
      bestNameScore - secondScore >= thresholds.nameMinMargin;
    const stat = nameOk ? (pctType === 'yes' ? `${bestName}%` : bestName) : null;

    rows.push({
      row: rowNum,
      stat,
      rank: 0, // populated by scanRanks
      nameScore: bestNameScore,
      nameSecondScore: secondScore,
      pctScore,
      pctType,
      complete: nameOk,
    });
  }

  return rows;
}
