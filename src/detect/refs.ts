import * as fsp from 'fs/promises';
import type { ScreenProfile } from '../profile.js';
import type { StatReferences } from './types.js';

/**
 * UTF-8 file read + JSON parse. Explicit encoding matters on Windows: PowerShell
 * 5.1 reads BOM-less UTF-8 as CP949, mangling Korean strings. Our JSON files
 * are BOM-less UTF-8 (written by the register/reroll scripts), and Node reads
 * them cleanly via the 'utf8' encoding — but leaving this helper central makes
 * it a single point to audit.
 */
async function readJson<T>(filePath: string): Promise<T> {
  const raw = await fsp.readFile(filePath, 'utf8');
  return JSON.parse(raw) as T;
}

export async function loadScreenProfile(filePath: string): Promise<ScreenProfile> {
  const parsed = await readJson<ScreenProfile>(filePath);
  if (!parsed || !Array.isArray(parsed.rois)) {
    throw new Error(`Invalid screen profile at ${filePath}`);
  }
  return parsed;
}

export async function loadStatReferences(filePath: string): Promise<StatReferences> {
  const parsed = await readJson<StatReferences>(filePath);
  if (!parsed || !Array.isArray(parsed.stats) || !Array.isArray(parsed.percentMarkers)) {
    throw new Error(`Invalid stat references at ${filePath}`);
  }
  if (!parsed.rois || !parsed.rois.name || !parsed.rois.percent) {
    throw new Error(`Stat references missing rois.name / rois.percent at ${filePath}`);
  }
  return parsed;
}
