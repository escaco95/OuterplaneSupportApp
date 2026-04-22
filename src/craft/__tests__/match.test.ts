import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import type { ScanRow } from '../../detect/types.js';
import { fingerprint, isJunkState, matches } from '../match.js';
import type { Template } from '../types.js';

function row(rowIndex: 1 | 2 | 3 | 4, stat: string | null, rank: number): ScanRow {
  return {
    row: rowIndex,
    stat,
    rank,
    nameScore: stat ? 1 : 0,
    nameSecondScore: 0,
    pctScore: 1,
    pctType: stat?.endsWith('%') ? 'yes' : 'no',
    complete: stat !== null,
  };
}

const VALUABLE = new Set(['체력%', '치명 피해%', '치명 확률%', '속도']);

test('matches: template [3,3,3,0] with 3 valuable rank-3 + 1 non-valuable → true', () => {
  const rows = [
    row(1, '치명 확률%', 3),
    row(2, '치명 피해%', 3),
    row(3, '피해 증가%', 3), // not valuable
    row(4, '체력%', 3),
  ];
  const t: Template = [3, 3, 3, 0];
  assert.equal(matches(rows, t, VALUABLE), true);
});

test('matches: template [3,3,3,0] with only 2 valuable rank-3 → false', () => {
  const rows = [
    row(1, '치명 확률%', 3),
    row(2, '치명 피해%', 3),
    row(3, '피해 증가%', 3),
    row(4, '공격력', 1),
  ];
  const t: Template = [3, 3, 3, 0];
  assert.equal(matches(rows, t, VALUABLE), false);
});

test('matches: position-agnostic — [3,1,3,3] layout with 3 valuable rank-3 → true', () => {
  const rows = [
    row(1, '체력%', 3),
    row(2, '공격력', 1),
    row(3, '치명 피해%', 3),
    row(4, '속도', 3),
  ];
  const t: Template = [3, 3, 3, 0];
  assert.equal(matches(rows, t, VALUABLE), true);
});

test('matches: template [3,3,2,2] all valuable at [3,3,2,2] → true', () => {
  const rows = [
    row(1, '체력%', 3),
    row(2, '치명 피해%', 3),
    row(3, '속도', 2),
    row(4, '치명 확률%', 2),
  ];
  const t: Template = [3, 3, 2, 2];
  assert.equal(matches(rows, t, VALUABLE), true);
});

test('matches: template [3,3,2,2] with only 3 valuable → false', () => {
  const rows = [
    row(1, '체력%', 3),
    row(2, '치명 피해%', 3),
    row(3, '속도', 2),
    row(4, '공격력', 2), // not valuable
  ];
  const t: Template = [3, 3, 2, 2];
  assert.equal(matches(rows, t, VALUABLE), false);
});

test('matches: rank 4 generously satisfies rank-3 requirement', () => {
  const rows = [
    row(1, '체력%', 4),
    row(2, '치명 피해%', 4),
    row(3, '속도', 4),
    row(4, '공격력', 1),
  ];
  const t: Template = [3, 3, 3, 0];
  assert.equal(matches(rows, t, VALUABLE), true);
});

test('matches: all-zero template trivially matches anything', () => {
  const rows = [row(1, null, 0), row(2, null, 0), row(3, null, 0), row(4, null, 0)];
  const t: Template = [0, 0, 0, 0];
  assert.equal(matches(rows, t, VALUABLE), true);
});

test('matches: UNKNOWN row never counts as valuable', () => {
  const rows = [
    row(1, null, 3),
    row(2, '치명 피해%', 3),
    row(3, '속도', 3),
    row(4, '공격력', 1),
  ];
  const t: Template = [3, 3, 3, 0];
  assert.equal(matches(rows, t, VALUABLE), false);
});

test('fingerprint: encodes stat+rank per row', () => {
  const rows = [
    row(1, '체력%', 3),
    row(2, '공격력', 1),
    row(3, null, 0),
    row(4, '속도', 2),
  ];
  assert.equal(fingerprint(rows), '체력%#3|공격력#1|UNKNOWN#0|속도#2');
});

test('fingerprint: two equal scans produce equal strings', () => {
  const a = [row(1, '체력%', 3), row(2, '공격력', 2), row(3, '속도', 1), row(4, '치명 피해%', 3)];
  const b = [row(1, '체력%', 3), row(2, '공격력', 2), row(3, '속도', 1), row(4, '치명 피해%', 3)];
  assert.equal(fingerprint(a), fingerprint(b));
});

test('isJunkState: all ranks zero → true (burst plateau)', () => {
  const rows = [row(1, null, 0), row(2, null, 0), row(3, null, 0), row(4, null, 0)];
  assert.equal(isJunkState(rows), true);
});

test('isJunkState: partial fade-in (one row non-zero, rest zero) → true', () => {
  const rows = [row(1, null, 0), row(2, null, 0), row(3, null, 1), row(4, null, 0)];
  assert.equal(isJunkState(rows), true);
});

test('isJunkState: any row with rank=0 is junk', () => {
  const rows = [row(1, '체력%', 3), row(2, '속도', 2), row(3, null, 0), row(4, '치명 피해%', 3)];
  assert.equal(isJunkState(rows), true);
});

test('isJunkState: all rows rank ≥ 1 → false (legitimate state)', () => {
  const rows = [
    row(1, '체력%', 1),
    row(2, '공격력', 2),
    row(3, '속도', 3),
    row(4, '치명 피해%', 1),
  ];
  assert.equal(isJunkState(rows), false);
});
