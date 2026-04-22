import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PNG } from 'pngjs';

import { loadScreenProfile, loadStatReferences } from '../refs.js';
import { scan } from '../index.js';

/**
 * Regression test: the TS scan pipeline must produce identical stat/rank
 * labels to the PowerShell skill on the same canonical frame. If this fails,
 * either the TS port diverged or the fixture labels in expected.json are
 * stale — investigate BEFORE changing thresholds.
 */

// npm test runs from project root, so fixtures live at this stable path.
const REPO_ROOT = process.cwd();
const FIXTURE_DIR = path.join(REPO_ROOT, 'src', 'detect', '__tests__', 'fixtures');
const SCREEN_PROFILE_PATH = path.join(REPO_ROOT, 'assets', 'profiles', 'precision-craft.json');
const STAT_REFS_PATH = path.join(REPO_ROOT, 'assets', 'profiles', 'stat-references.json');

interface ExpectedFixture {
  screenValid: boolean;
  stats?: string[];
  ranks?: number[];
}
interface ExpectedFile {
  fixtures: Record<string, ExpectedFixture>;
}

/**
 * Decode PNG → BGRA buffer (Windows GDI ordering). pngjs returns RGBA, so we
 * swap R↔B channels. The pipeline was built against PrintWindow output which
 * is natively BGRA; feeding it RGBA would invert text/icon color detection.
 */
function decodePngToBGRA(filePath: string): { buffer: Buffer; width: number; height: number } {
  const raw = fs.readFileSync(filePath);
  const png = PNG.sync.read(raw);
  const n = png.width * png.height;
  const bgra = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    bgra[j] = png.data[j + 2]; // B <- R
    bgra[j + 1] = png.data[j + 1]; // G
    bgra[j + 2] = png.data[j]; // R <- B
    bgra[j + 3] = png.data[j + 3]; // A
  }
  return { buffer: bgra, width: png.width, height: png.height };
}

test('scan: last-scan.png matches skill-labeled expected output', async () => {
  const expected: ExpectedFile = JSON.parse(
    fs.readFileSync(path.join(FIXTURE_DIR, 'expected.json'), 'utf8')
  );
  const label = expected.fixtures['last-scan.png'];
  assert.ok(label, 'expected.json missing last-scan.png entry');

  const screenProfile = await loadScreenProfile(SCREEN_PROFILE_PATH);
  const statRefs = await loadStatReferences(STAT_REFS_PATH);

  const cap = decodePngToBGRA(path.join(FIXTURE_DIR, 'last-scan.png'));
  const result = scan(cap.buffer, cap.width, cap.height, screenProfile, statRefs);

  assert.equal(result.screenValid, label.screenValid, 'screen validity mismatch');

  if (label.ranks) {
    const actualRanks = result.rows.map((r) => r.rank);
    assert.deepEqual(actualRanks, label.ranks, 'rank mismatch');
  }
  if (label.stats) {
    const actualStats = result.rows.map((r) => r.stat);
    assert.deepEqual(actualStats, label.stats, 'stat mismatch');
  }
});

test('scan: clean precision-craft capture passes screen validation', async () => {
  const expected: ExpectedFile = JSON.parse(
    fs.readFileSync(path.join(FIXTURE_DIR, 'expected.json'), 'utf8')
  );
  const label = expected.fixtures['ldplayer-capture.png'];
  assert.ok(label);

  const screenProfile = await loadScreenProfile(SCREEN_PROFILE_PATH);
  const statRefs = await loadStatReferences(STAT_REFS_PATH);

  const cap = decodePngToBGRA(path.join(FIXTURE_DIR, 'ldplayer-capture.png'));
  const result = scan(cap.buffer, cap.width, cap.height, screenProfile, statRefs);

  assert.equal(
    result.screenValid,
    label.screenValid,
    `screen validity mismatch; failed ROIs: ${result.screenFailedRois.join(',') || '(none)'}`
  );
});

test('scan: screen validation tolerates incidental overlays outside ROI regions', async () => {
  const expected: ExpectedFile = JSON.parse(
    fs.readFileSync(path.join(FIXTURE_DIR, 'expected.json'), 'utf8')
  );
  const label = expected.fixtures['ldplayer-capture-roi.png'];
  assert.ok(label);

  const screenProfile = await loadScreenProfile(SCREEN_PROFILE_PATH);
  const statRefs = await loadStatReferences(STAT_REFS_PATH);

  const cap = decodePngToBGRA(path.join(FIXTURE_DIR, 'ldplayer-capture-roi.png'));
  const result = scan(cap.buffer, cap.width, cap.height, screenProfile, statRefs);

  assert.equal(
    result.screenValid,
    label.screenValid,
    `screen validity mismatch; failed ROIs: ${result.screenFailedRois.join(',') || '(none)'}`
  );
});
