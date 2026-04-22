/**
 * Segment-fill rank scan. Each of the 4 To-Be rows has a 4-segment progress
 * bar; a segment is "filled" iff its mean color is the yellow highlight
 * (R ≳ 254, G ≳ 206, B ≳ 71). Filled count per row is the row's rank (0–4).
 *
 * The layout constants below mirror read-rank.ps1 and the PowerShell skill,
 * so any game-UI pixel shift requires updating both places (extract later if
 * that becomes painful).
 */

export const RANK_OPTION_NY = [0.3365, 0.4254, 0.5144, 0.6033] as const;
export const RANK_SEGMENT_NX = [0.7387, 0.7902, 0.8417, 0.8924] as const;
export const RANK_SEGMENT_NW = 0.0453;
export const RANK_SEGMENT_NH = 0.0055;
/** A segment is considered filled iff mean R is ≥ this. */
export const FILL_MIN_R = 150;
/** …AND mean (R − B) is ≥ this (to reject near-gray bright pixels). */
export const FILL_R_MINUS_B = 40;

/**
 * Scan all 4 rows' rank bars on a canonical 1280×720 BGRA buffer.
 * Returns [rank0..rank3], each 0–4.
 */
export function scanRanks(canonical: Buffer, CW: number, CH: number): number[] {
  const ranks: number[] = [];
  for (let optIdx = 0; optIdx < 4; optIdx++) {
    const ny = RANK_OPTION_NY[optIdx];
    let filled = 0;
    for (let segIdx = 0; segIdx < 4; segIdx++) {
      const nx = RANK_SEGMENT_NX[segIdx];
      const rx = Math.round(nx * CW);
      const ry = Math.round(ny * CH);
      const rw = Math.round(RANK_SEGMENT_NW * CW);
      const rh = Math.max(1, Math.round(RANK_SEGMENT_NH * CH));
      let sumR = 0;
      let sumB = 0;
      let cnt = 0;
      for (let y = ry; y < ry + rh; y++) {
        const rowBase = y * CW * 4;
        for (let x = rx; x < rx + rw; x++) {
          const i = rowBase + x * 4;
          sumB += canonical[i];
          sumR += canonical[i + 2];
          cnt++;
        }
      }
      if (cnt === 0) continue;
      const mR = (sumR / cnt) | 0;
      const mB = (sumB / cnt) | 0;
      if (mR >= FILL_MIN_R && mR - mB >= FILL_R_MINUS_B) filled++;
    }
    ranks.push(filled);
  }
  return ranks;
}
