/**
 * Console dry-run harness for AutoRerollController. Mirrors how the PS skill
 * is invoked (single LDPlayer instance, loads stat-references/screen-profile,
 * prints iteration logs) so output can be compared 1:1.
 *
 * Purpose: verify the TS pipeline works end-to-end against the live game
 * BEFORE we wrap it in UI + IPC. If anything diverges from the skill, catch
 * it here where the call stack is shallow.
 *
 * Usage:
 *   npm run craft:console
 *
 * State is persisted to .temp/auto-reroll-state.json (same path as the PS
 * skill) so the runner picks up cumulative attempts / hits across sessions.
 */

import * as path from 'path';
import { findLdplayerWindows } from '../ldplayer.js';
import { loadScreenProfile, loadStatReferences } from '../detect/index.js';
import { AutoRerollController } from './controller.js';
import { computeLuck } from './luck.js';
import { loadState } from './state-store.js';
import type { CraftConfig, CraftEvent, Template } from './types.js';

// --- Config: edit these, re-run. Kept inline so this file is self-contained. ---
const CONFIG: CraftConfig = {
  valuable: ['속도', '방어력%', '받는 피해 감소%', '효과 저항%'],
  template: [3, 3, 3, 0] as Template,
  maxIter: 50,
  assumedHitRate: 0.002,
};

const REPO_ROOT = process.cwd();
const SCREEN_PROFILE_PATH = path.join(REPO_ROOT, 'assets', 'profiles', 'precision-craft.json');
const STAT_REFS_PATH = path.join(REPO_ROOT, 'assets', 'profiles', 'stat-references.json');
const STATE_PATH = path.join(REPO_ROOT, '.temp', 'auto-reroll-state.json');

async function main(): Promise<void> {
  const windows = findLdplayerWindows();
  if (windows.length === 0) {
    console.log('FAIL: No LDPlayer window');
    process.exit(1);
  }
  if (windows.length > 1) {
    console.log(`FAIL: Multiple LDPlayer windows (${windows.length}); single instance required`);
    process.exit(1);
  }
  const windowKey = windows[0].key;

  const screenProfile = await loadScreenProfile(SCREEN_PROFILE_PATH);
  const statRefs = await loadStatReferences(STAT_REFS_PATH);
  const state = await loadState(STATE_PATH);

  console.log(`[start] LDPlayer pid=${windows[0].pid} title="${windows[0].title}"`);
  console.log(`[start] template=[${CONFIG.template.join(',')}] max=${CONFIG.maxIter}`);
  console.log(`[start] valuable={${CONFIG.valuable.join(', ')}}`);
  console.log(
    `[start] cumulative: ${state.totalAttempts} attempts, ${state.totalHits} hits, ` +
      `current streak ${state.currentStreak} (longest ${state.longestStreak})`
  );
  const preLuck = computeLuck(state.currentStreak, CONFIG.assumedHitRate);
  if (state.currentStreak > 0) {
    console.log(
      `[luck] p=${(CONFIG.assumedHitRate * 100).toFixed(1)}% 가정, streak ${state.currentStreak}: ` +
        `하위 ${preLuck.percentBottom.toFixed(2)}%`
    );
  }

  const controller = new AutoRerollController();

  // Ctrl+C → clean cancel (controller finishes current iter, saves state, exits).
  let stopping = false;
  const onSigint = () => {
    if (stopping) return;
    stopping = true;
    console.log('\n[user] SIGINT — cancelling after current iteration');
    controller.stop();
  };
  process.on('SIGINT', onSigint);

  controller.on('event', (e: CraftEvent) => {
    switch (e.type) {
      case 'iteration':
        console.log(e.logLine);
        break;
      case 'settled':
        // Silent in normal case; uncomment for settle-tuning runs.
        if (e.timedOut) console.log(`  [settle] TIMEOUT (${e.settleMs}ms cap hit)`);
        break;
      case 'hit': {
        const luck = computeLuck(e.state.longestStreak, CONFIG.assumedHitRate);
        console.log(`STOP: HIT at iteration ${e.iter}`);
        console.log(`  elapsed: ${(e.elapsedMs / 1000).toFixed(1)}s`);
        console.log(
          `  cumulative: ${e.state.totalAttempts} attempts, ${e.state.totalHits} hits ` +
            `(longest streak was ${e.state.longestStreak}, reset to 0)`
        );
        console.log(
          `  [luck] streak ${e.state.longestStreak} at p=${(CONFIG.assumedHitRate * 100).toFixed(1)}%: ` +
            `하위 ${luck.percentBottom.toFixed(2)}%`
        );
        break;
      }
      case 'detection-failure':
        console.log(`STOP: DETECTION FAILURE at iteration ${e.iter}`);
        console.log(`  failed rows: [${e.failedRows.join(',')}]`);
        break;
      case 'limit': {
        const luck = computeLuck(e.state.currentStreak, CONFIG.assumedHitRate);
        console.log(`STOP: LIMIT (${CONFIG.maxIter} iterations) — no hit`);
        console.log(`  elapsed: ${(e.elapsedMs / 1000).toFixed(1)}s`);
        console.log(
          `  cumulative: ${e.state.totalAttempts} attempts, ${e.state.totalHits} hits, ` +
            `current streak ${e.state.currentStreak} (longest ${e.state.longestStreak})`
        );
        console.log(
          `  [luck] streak ${e.state.currentStreak} at p=${(CONFIG.assumedHitRate * 100).toFixed(1)}%: ` +
            `하위 ${luck.percentBottom.toFixed(2)}%`
        );
        break;
      }
      case 'fail':
        console.log(`FAIL: ${e.reason}`);
        if (e.screenFailedRois?.length) {
          console.log(`  screen ROIs failed: ${e.screenFailedRois.join(', ')}`);
        }
        break;
      case 'done':
        // No extra output; the preceding event already summarized.
        break;
    }
  });

  await controller.start({
    windowKey,
    config: CONFIG,
    screenProfile,
    statRefs,
    state,
    statePath: STATE_PATH,
  });

  process.off('SIGINT', onSigint);
}

main().catch((err) => {
  console.error('runner error:', err);
  process.exit(2);
});
