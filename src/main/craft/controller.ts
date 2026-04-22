import { EventEmitter } from 'events';
import type { ScreenProfile } from '../profile.js';
import { captureRender, clickRender } from '../ldplayer.js';
import { scan, type ScanResult, type StatReferences } from '../detect/index.js';
import { fingerprint, matches } from './match.js';
import { registerAttempt, saveState } from './state-store.js';
import { waitForSettle } from './settle.js';
import {
  DEFAULT_SETTLE,
  type CraftConfig,
  type CraftEvent,
  type SessionState,
  type SettleTuning,
} from './types.js';

/**
 * Normalized position of the "확정 옵션 변경" button inside the RenderWindow.
 * Hardcoded since it doesn't change without a game UI overhaul — if it does,
 * update here and in the reroll-option skill in lockstep.
 */
const CLICK_NX = 0.6045;
const CLICK_NY = 0.9207;

/** Gap between WM_LBUTTONDOWN and WM_LBUTTONUP — 10ms is enough for the game. */
const CLICK_GAP_MS = 10;

export interface StartArgs {
  windowKey: string;
  config: CraftConfig;
  screenProfile: ScreenProfile;
  statRefs: StatReferences;
  /** Persisted state. Mutated in place during the run; saved on exit. */
  state: SessionState;
  /** File path for atomic state persistence on each exit path. */
  statePath: string;
  /** Override settle tuning if needed (tests, tuning runs). */
  settleTuning?: SettleTuning;
}

/**
 * EventEmitter-based auto-reroll orchestrator.
 *
 *   const c = new AutoRerollController();
 *   c.on('event', (e) => ...);
 *   await c.start({ ... });
 *
 * The Promise returned by start() resolves when the loop finishes (hit, limit,
 * detection-failure, fail, or cancel). It never rejects — all terminal states
 * are communicated via events AND a final 'done' event.
 *
 * stop() flips a cancel flag. The loop checks it between iterations and before
 * long waits. Currently-in-flight capture/scan completes before exiting; the
 * resulting data is discarded.
 */
export class AutoRerollController extends EventEmitter {
  private cancelled = false;

  /** Subscribe to the typed event stream. */
  override on(event: 'event', listener: (e: CraftEvent) => void): this;
  override on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  stop(): void {
    this.cancelled = true;
  }

  async start(args: StartArgs): Promise<void> {
    const { windowKey, config, screenProfile, statRefs, state, statePath, settleTuning } = args;
    const tuning = settleTuning ?? DEFAULT_SETTLE;
    const valuable = new Set(config.valuable);

    const startedAt = Date.now();
    const elapsed = () => Date.now() - startedAt;
    const emit = (e: CraftEvent) => this.emit('event', e);

    // First iteration: full capture + validate.
    const firstCap = captureRender(windowKey);
    if (!firstCap) {
      emit({ type: 'fail', reason: 'LDPlayer RenderWindow not available' });
      emit({ type: 'done', state, elapsedMs: elapsed() });
      await saveState(statePath, state);
      return;
    }

    let result: ScanResult;
    try {
      result = scan(
        firstCap.buffer,
        firstCap.width,
        firstCap.height,
        screenProfile,
        statRefs,
        undefined,
        { skipValidation: false }
      );
    } catch (err) {
      emit({ type: 'fail', reason: `initial scan threw: ${(err as Error).message}` });
      emit({ type: 'done', state, elapsedMs: elapsed() });
      await saveState(statePath, state);
      return;
    }
    if (!result.screenValid) {
      emit({
        type: 'fail',
        reason: 'Not on the precision-craft screen',
        screenFailedRois: result.screenFailedRois,
      });
      emit({ type: 'done', state, elapsedMs: elapsed() });
      await saveState(statePath, state);
      return;
    }

    for (let iter = 1; iter <= config.maxIter; iter++) {
      if (this.cancelled) {
        emit({ type: 'fail', reason: 'cancelled by user' });
        emit({ type: 'done', state, elapsedMs: elapsed() });
        await saveState(statePath, state);
        return;
      }

      emit({
        type: 'iteration',
        iter,
        maxIter: config.maxIter,
        rows: result.rows,
        logLine: formatLogLine(iter, config.maxIter, result),
      });

      // Detection failure → production halt, hand off to support flow.
      const failedRows: number[] = [];
      for (const row of result.rows) {
        if (!row.complete) failedRows.push(row.row);
      }
      if (failedRows.length > 0) {
        emit({
          type: 'detection-failure',
          iter,
          rows: result.rows,
          canonical: result.canonical,
          canonicalSize: {
            width: screenProfile.canonicalSize.width,
            height: screenProfile.canonicalSize.height,
          },
          failedRows,
        });
        emit({ type: 'done', state, elapsedMs: elapsed() });
        await saveState(statePath, state);
        return;
      }

      // Pattern match / miss → mutate state, possibly terminate on hit.
      // OR semantics across templates: any match wins.
      const hit = config.templates.some((t) => matches(result.rows, t, valuable));
      registerAttempt(state, hit);
      if (hit) {
        emit({ type: 'hit', iter, rows: result.rows, state, elapsedMs: elapsed() });
        emit({ type: 'done', state, elapsedMs: elapsed() });
        await saveState(statePath, state);
        return;
      }

      // Not terminal and not at limit — click reroll + wait for settle.
      if (iter < config.maxIter) {
        const preFp = fingerprint(result.rows);
        const clicked = await clickRender(windowKey, CLICK_NX, CLICK_NY, CLICK_GAP_MS);
        if (!clicked) {
          emit({ type: 'fail', reason: 'click injection failed (window gone?)' });
          emit({ type: 'done', state, elapsedMs: elapsed() });
          await saveState(statePath, state);
          return;
        }
        if (this.cancelled) {
          emit({ type: 'fail', reason: 'cancelled by user' });
          emit({ type: 'done', state, elapsedMs: elapsed() });
          await saveState(statePath, state);
          return;
        }

        const settled = await waitForSettle(
          windowKey,
          screenProfile,
          statRefs,
          preFp,
          tuning
        );
        if (!settled) {
          emit({ type: 'fail', reason: 'settle failed (window gone?)' });
          emit({ type: 'done', state, elapsedMs: elapsed() });
          await saveState(statePath, state);
          return;
        }
        emit({ type: 'settled', settleMs: settled.settleMs, timedOut: settled.timedOut });
        result = settled.scan;
      }
    }

    emit({ type: 'limit', state, elapsedMs: elapsed() });
    emit({ type: 'done', state, elapsedMs: elapsed() });
    await saveState(statePath, state);
  }
}

/** Skill-format log line: "[N/M] ranks=[a,b,c,d] stats=[A | B | C | D]" */
function formatLogLine(iter: number, maxIter: number, r: ScanResult): string {
  const ranks = r.rows.map((row) => row.rank).join(',');
  const stats = r.rows.map((row) => row.stat ?? 'UNKNOWN').join(' | ');
  return `[${iter}/${maxIter}] ranks=[${ranks}] stats=[${stats}]`;
}
