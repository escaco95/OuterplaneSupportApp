import * as fsp from 'fs/promises';

export interface Histogram {
  r: number[];
  g: number[];
  b: number[];
}

export interface RoiDefinition {
  id: string;
  name: string;
  /** Normalized bbox on canonical canvas: [nx, ny, nw, nh], each in [0, 1] */
  bbox: [number, number, number, number];
  histogram: Histogram;
}

export interface CanonicalSize {
  width: number;
  height: number;
}

export interface HistogramFormat {
  colorSpace: 'rgb' | 'hsv' | 'gray';
  channels: number;
  binsPerChannel: number;
}

export interface MatchingConfig {
  metric: 'correlation' | 'bhattacharyya' | 'intersection' | 'chi-square';
  threshold: number;
}

export interface ScreenProfile {
  name: string;
  displayName: string;
  canonicalSize: CanonicalSize;
  histogramFormat: HistogramFormat;
  matching: MatchingConfig;
  rois: RoiDefinition[];
}

export async function loadProfile(filePath: string): Promise<ScreenProfile> {
  const raw = await fsp.readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  assertValidProfile(parsed);
  return parsed;
}

function assertValidProfile(p: unknown): asserts p is ScreenProfile {
  if (!p || typeof p !== 'object') throw new Error('Profile must be an object');
  const o = p as Record<string, unknown>;
  if (typeof o.name !== 'string') throw new Error('Profile.name must be a string');
  if (typeof o.displayName !== 'string') throw new Error('Profile.displayName must be a string');
  if (!Array.isArray(o.rois)) throw new Error('Profile.rois must be an array');
  for (const r of o.rois as unknown[]) {
    if (!r || typeof r !== 'object') throw new Error('ROI must be an object');
    const ro = r as Record<string, unknown>;
    if (typeof ro.id !== 'string') throw new Error('ROI.id must be a string');
    if (!Array.isArray(ro.bbox) || ro.bbox.length !== 4) {
      throw new Error('ROI.bbox must be a 4-tuple');
    }
    if (!ro.histogram || typeof ro.histogram !== 'object') {
      throw new Error('ROI.histogram must be an object');
    }
  }
}
