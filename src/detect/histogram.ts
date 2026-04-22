import type { Histogram } from '../profile.js';

/**
 * Nearest-neighbor resize of a BGRA buffer into a provided destination.
 * Both src and dst are tightly packed (stride = width * 4). Integer math,
 * no allocations, no interpolation — fast enough for histogram-level use.
 *
 * Sampling matches GDI+ `InterpolationMode.NearestNeighbor` with
 * `PixelOffsetMode.Half`: each destination pixel maps from the source pixel
 * containing its center. The skill captures reference masks via System.Drawing
 * with exactly these modes, so using the same sampling here keeps binary-mask
 * IoU pixel-perfect across PS and TS pipelines. Corner-sampling would shift
 * by 1 source pixel at boundaries and drop stat-name IoU below threshold.
 */
export function resizeBGRANearest(
  src: Buffer,
  sw: number,
  sh: number,
  dst: Buffer,
  dw: number,
  dh: number
): void {
  if (sw === dw && sh === dh) {
    src.copy(dst);
    return;
  }
  const maxSy = sh - 1;
  const maxSx = sw - 1;
  for (let y = 0; y < dh; y++) {
    let sy = (((y + 0.5) * sh) / dh) | 0;
    if (sy > maxSy) sy = maxSy;
    const srcRow = sy * sw * 4;
    const dstRow = y * dw * 4;
    for (let x = 0; x < dw; x++) {
      let sx = (((x + 0.5) * sw) / dw) | 0;
      if (sx > maxSx) sx = maxSx;
      const si = srcRow + (sx << 2);
      const di = dstRow + (x << 2);
      dst[di] = src[si];
      dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2];
      dst[di + 3] = src[si + 3];
    }
  }
}

/** Compute normalized RGB histogram (bins per channel) over a rect region. */
export function computeHistogram(
  src: Buffer,
  sw: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  bins: number
): Histogram {
  const r = new Array(bins).fill(0);
  const g = new Array(bins).fill(0);
  const b = new Array(bins).fill(0);
  const total = rw * rh;
  if (total <= 0) return { r, g, b };
  const scale = bins / 256;
  for (let y = ry; y < ry + rh; y++) {
    const rowBase = y * sw * 4;
    for (let x = rx; x < rx + rw; x++) {
      const i = rowBase + x * 4;
      const B = src[i];
      const G = src[i + 1];
      const R = src[i + 2];
      r[Math.min(bins - 1, Math.floor(R * scale))]++;
      g[Math.min(bins - 1, Math.floor(G * scale))]++;
      b[Math.min(bins - 1, Math.floor(B * scale))]++;
    }
  }
  for (let i = 0; i < bins; i++) {
    r[i] /= total;
    g[i] /= total;
    b[i] /= total;
  }
  return { r, g, b };
}

/** Pearson correlation between two equal-length distributions. */
export function correlate(a: number[], b: number[]): number {
  const n = a.length;
  if (n === 0 || n !== b.length) return 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma;
    const xb = b[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  if (da === 0 && db === 0) return 1;
  if (da === 0 || db === 0) return 0;
  return num / Math.sqrt(da * db);
}

/** Mean per-channel Pearson correlation between two RGB histograms. */
export function compareHistograms(h1: Histogram, h2: Histogram): number {
  const cr = correlate(h1.r, h2.r);
  const cg = correlate(h1.g, h2.g);
  const cb = correlate(h1.b, h2.b);
  return (cr + cg + cb) / 3;
}
