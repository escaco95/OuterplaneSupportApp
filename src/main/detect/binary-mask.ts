/**
 * Binary-mask extraction + IoU comparison. This is the matching primitive used
 * for stat name / pct marker recognition: each reference is stored as a
 * {0,1} array, and scan-time ROI pixels are binarized via a simple max-channel
 * threshold. IoU is asymmetric-friendly — black-black pixels contribute 0 to
 * both intersection and union, so only white-presence drives the score.
 */

/**
 * Binarize a rectangular ROI of a BGRA buffer by thresholding max(R,G,B).
 * Returns a packed 0/1 array of length rw*rh in row-major order.
 *
 * Rationale: the game's UI text / icons are rendered light-on-dark. A single
 * threshold on max-channel captures the foreground reliably across anti-alias
 * edges without needing per-channel rules.
 */
export function extractBinaryMask(
  src: Buffer,
  sw: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  threshold = 128
): number[] {
  const mask = new Array(rw * rh);
  let p = 0;
  for (let y = ry; y < ry + rh; y++) {
    const rowBase = y * sw * 4;
    for (let x = rx; x < rx + rw; x++) {
      const i = rowBase + x * 4;
      const b = src[i];
      const g = src[i + 1];
      const r = src[i + 2];
      mask[p++] = r > threshold || g > threshold || b > threshold ? 1 : 0;
    }
  }
  return mask;
}

/**
 * Intersection-over-union on two binary masks of equal length.
 * Both empty returns 1.0 (degenerate — caller usually filters this out).
 */
export function iou(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let inter = 0;
  let uni = 0;
  for (let i = 0; i < a.length; i++) {
    const aOn = a[i] !== 0;
    const bOn = b[i] !== 0;
    if (aOn && bOn) inter++;
    if (aOn || bOn) uni++;
  }
  return uni === 0 ? 1 : inter / uni;
}
