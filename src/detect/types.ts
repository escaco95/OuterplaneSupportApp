/**
 * Shared types for the detect pipeline. A single `ScanResult` consolidates
 * everything downstream consumers need from one captured frame: screen
 * validity, per-row stat+rank info, and the canonical 1280×720 BGRA buffer
 * (kept around for diagnostic save / UI preview crop).
 */

export type RowIndex = 1 | 2 | 3 | 4;

export interface ScanRow {
  row: RowIndex;
  /** Canonical stat string (e.g. "치명 피해%") — null means UNKNOWN. */
  stat: string | null;
  /** Progress bar segments filled, 0–4. */
  rank: number;
  /** IoU of the best name mask match. */
  nameScore: number;
  /** Second-best name score (used for margin check). */
  nameSecondScore: number;
  /** IoU of the chosen pct marker (yes or no). */
  pctScore: number;
  /** Which pct type the detector settled on. */
  pctType: 'yes' | 'no';
  /** True iff name passed confidence+margin AND pct is resolved. */
  complete: boolean;
}

export interface ScanResult {
  /** Screen-profile histogram validation passed. */
  screenValid: boolean;
  /** If screenValid is false, which ROI ids fell below threshold. */
  screenFailedRois: string[];
  /** Per-row scan outputs, always 4 entries. */
  rows: ScanRow[];
  /** Canonical 1280×720 BGRA buffer (reference — do not mutate). */
  canonical: Buffer;
}

/** Binary mask entry keyed by (stat name, row). Stored in stat-references.json. */
export interface StatMaskEntry {
  name: string;
  row: RowIndex;
  mask: number[];
}

/** Pct marker entry keyed by (row, type). */
export interface PctMaskEntry {
  row: RowIndex;
  type: 'yes' | 'no';
  mask: number[];
}

export interface RoiLayout {
  nx: number;
  nw: number;
  nh: number;
  ny: [number, number, number, number];
}

export interface StatReferences {
  rois: {
    name: RoiLayout;
    percent: RoiLayout;
  };
  storage: { type: 'binary-mask'; threshold: number; keyedBy: string };
  matching: { metric: 'iou'; threshold: number };
  stats: StatMaskEntry[];
  percentMarkers: PctMaskEntry[];
}

export interface ScanThresholds {
  /** Min IoU for a name to be accepted. */
  nameMinConf: number;
  /** Min (best − second) margin for name. */
  nameMinMargin: number;
  /** Min IoU for pct to be "yes" (defaults to "no" otherwise). */
  pctYesMinConf: number;
}

/**
 * Tuned against resize-induced drift: nearest-neighbor 1280×720 normalization
 * introduces subpixel sampling differences across source resolutions, which
 * can drop a correct name IoU from ~0.99 to ~0.85 without the stat actually
 * changing. 2nd-place scores drift much less (they're "noise floor") so the
 * margin tightens disproportionately. These thresholds give ~0.10 headroom
 * on both axes so same-stat shifts across window sizes stay accepted.
 */
export const DEFAULT_THRESHOLDS: ScanThresholds = {
  nameMinConf: 0.75,
  nameMinMargin: 0.1,
  pctYesMinConf: 0.6,
};
