import * as fsp from 'fs/promises';
import * as path from 'path';
import { emptyState, type SessionState } from './types.js';

/**
 * Persist session state (attempts / hits / streak) across runs. Schema is
 * small and stable; atomic write-then-rename guards against partial files if
 * the process is killed mid-write.
 *
 * On shape mismatch we discard the file silently and start fresh — this state
 * is a UX convenience, not load-bearing data, so tolerating corruption is
 * preferable to blocking the user with an error dialog.
 */
export async function loadState(filePath: string): Promise<SessionState> {
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyState();
    return {
      totalAttempts: Number(parsed.totalAttempts) || 0,
      totalHits: Number(parsed.totalHits) || 0,
      currentStreak: Number(parsed.currentStreak) || 0,
      longestStreak: Number(parsed.longestStreak) || 0,
      lastHitAt: typeof parsed.lastHitAt === 'string' ? parsed.lastHitAt : null,
    };
  } catch {
    return emptyState();
  }
}

export async function saveState(filePath: string, state: SessionState): Promise<void> {
  const dir = path.dirname(filePath);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  await fsp.rename(tmp, filePath);
}

/** Mutate state for one completed attempt (hit or miss). */
export function registerAttempt(state: SessionState, isHit: boolean): void {
  state.totalAttempts += 1;
  if (isHit) {
    state.totalHits += 1;
    state.currentStreak = 0;
    state.lastHitAt = new Date().toISOString();
  } else {
    state.currentStreak += 1;
    if (state.currentStreak > state.longestStreak) {
      state.longestStreak = state.currentStreak;
    }
  }
}
