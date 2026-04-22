import { app, BrowserWindow, ipcMain, shell, net, screen } from 'electron';
import * as path from 'path';
import * as fsp from 'fs/promises';
import * as crypto from 'crypto';
import {
  findLdplayerWindows,
  getWindowBounds,
  getRenderBounds,
  getWindowTitle,
  isWindowAlive,
  isWindowMinimized,
  captureRender,
  NativeRect,
} from './ldplayer.js';
import { loadProfile, ScreenProfile } from './profile.js';
import {
  assessScreen,
  loadStatReferences,
  ScreenAssessment,
  STAT_CATALOG,
  type StatReferences,
} from './detect/index.js';
import { AutoRerollController } from './craft/controller.js';
import { loadState } from './craft/state-store.js';
import type { CraftConfig, CraftEvent, SessionState, Template } from './craft/types.js';

const FAVICON_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const faviconDir = (): string => path.join(app.getPath('userData'), 'favicons');

interface DownloadResult {
  buf: Buffer;
  contentType: string;
}

function download(url: string): Promise<DownloadResult> {
  return new Promise((resolve, reject) => {
    const req = net.request(url);
    req.on('response', (res) => {
      const status = res.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        reject(new Error(`HTTP ${status}`));
        return;
      }
      const ct = res.headers['content-type'];
      const contentType = Array.isArray(ct) ? ct[0] : ct || '';
      if (!contentType.startsWith('image/')) {
        reject(new Error(`Not image: ${contentType}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ buf: Buffer.concat(chunks), contentType }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchFavicon(host: string): Promise<DownloadResult> {
  try {
    return await download(`https://${host}/favicon.ico`);
  } catch {}
  return await download(`https://www.google.com/s2/favicons?domain=${host}&sz=64`);
}

async function getFavicon(url: unknown): Promise<string | null> {
  if (typeof url !== 'string') return null;
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    host = u.hostname;
  } catch {
    return null;
  }

  const hash = crypto.createHash('sha1').update(host).digest('hex').slice(0, 16);
  const dir = faviconDir();
  const file = path.join(dir, hash);

  try {
    const stat = await fsp.stat(file);
    if (Date.now() - stat.mtimeMs < FAVICON_TTL_MS) {
      return await fsp.readFile(file, 'utf8');
    }
  } catch {}

  try {
    const { buf, contentType } = await fetchFavicon(host);
    const dataUrl = `data:${contentType};base64,${buf.toString('base64')}`;
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(file, dataUrl, 'utf8');
    return dataUrl;
  } catch {
    return null;
  }
}

async function resetAppData(): Promise<void> {
  try {
    await fsp.rm(faviconDir(), { recursive: true, force: true });
  } catch {}
}

let mainWindow: BrowserWindow | null = null;

const GLOW_PAD = 24;
const TRACK_INTERVAL_MS = 33;

function physicalToDipRect(physical: NativeRect): {
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  if (!mainWindow) return null;
  const nativeRect = {
    x: physical.left,
    y: physical.top,
    width: physical.right - physical.left,
    height: physical.bottom - physical.top,
  };
  if (nativeRect.width <= 0 || nativeRect.height <= 0) return null;
  const dip = screen.screenToDipRect(mainWindow, nativeRect);
  return {
    x: Math.round(dip.x),
    y: Math.round(dip.y),
    width: Math.round(dip.width),
    height: Math.round(dip.height),
  };
}

interface ActivePicker {
  resolve: (key: string | null) => void;
  backdrop: BrowserWindow;
  overlays: BrowserWindow[];
}

let activePicker: ActivePicker | null = null;

function totalScreenBounds(): { x: number; y: number; width: number; height: number } {
  const displays = screen.getAllDisplays();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const d of displays) {
    minX = Math.min(minX, d.bounds.x);
    minY = Math.min(minY, d.bounds.y);
    maxX = Math.max(maxX, d.bounds.x + d.bounds.width);
    maxY = Math.max(maxY, d.bounds.y + d.bounds.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function createBackdrop(): BrowserWindow {
  const b = totalScreenBounds();
  const backdrop = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'picker-preload.js'),
      contextIsolation: true,
    },
  });
  backdrop.setAlwaysOnTop(true, 'floating');
  backdrop.loadFile(path.join(__dirname, '..', 'picker-backdrop.html'));
  backdrop.once('ready-to-show', () => backdrop.showInactive());
  return backdrop;
}

function createPickerOverlay(physical: NativeRect, key: string): BrowserWindow | null {
  const dip = physicalToDipRect(physical);
  if (!dip) return null;

  const overlay = new BrowserWindow({
    x: dip.x,
    y: dip.y,
    width: dip.width,
    height: dip.height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'picker-preload.js'),
      contextIsolation: true,
    },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.loadFile(path.join(__dirname, '..', 'picker-overlay.html'), {
    query: { key },
  });
  overlay.once('ready-to-show', () => overlay.showInactive());
  return overlay;
}

function endPicker(key: string | null): void {
  if (!activePicker) return;
  const { resolve, backdrop, overlays } = activePicker;
  activePicker = null;
  for (const o of overlays) if (!o.isDestroyed()) o.close();
  if (!backdrop.isDestroyed()) backdrop.close();
  resolve(key);
  if (key !== null) startGlow(key);
}

interface GlowState {
  ok: boolean;
  reason?: string;
}

interface Tracker {
  key: string;
  overlay: BrowserWindow;
  interval: NodeJS.Timeout;
  contentInterval: NodeJS.Timeout | null;
  visible: boolean;
  lastBoundsKey: string;
  lastValidation: GlowState | null;
  lastSizeState: GlowState;
  lastContent: ScreenAssessment | null;
  /**
   * Consecutive-failure counter for the content (precision-craft) check.
   * Hysteresis — the reroll burst animation briefly obscures the screen
   * profile ROIs and a single scan can fail. Only after this counter reaches
   * INVALID_CONTENT_HYSTERESIS do we commit "invalid" to lastContent, so
   * transient ~1-2s animations don't flash the "screen changed" warning.
   */
  pendingInvalidContentCount: number;
}

let precisionProfile: ScreenProfile | null = null;
let statRefs: StatReferences | null = null;

function profilesDir(): string {
  return path.join(__dirname, '..', 'assets', 'profiles');
}

function craftStatePath(): string {
  return path.join(app.getPath('userData'), 'auto-reroll-state.json');
}

function loadPrecisionProfile(): void {
  loadProfile(path.join(profilesDir(), 'precision-craft.json'))
    .then((p) => {
      precisionProfile = p;
    })
    .catch((err) => {
      console.error('Failed to load precision-craft profile:', err);
    });
}

function loadStatRefs(): void {
  loadStatReferences(path.join(profilesDir(), 'stat-references.json'))
    .then((r) => {
      statRefs = r;
    })
    .catch((err) => {
      console.error('Failed to load stat-references:', err);
    });
}

/**
 * Strip the 1280×720 BGRA buffer from detection-failure events before IPC
 * send — Electron can serialize Buffer, but 3.6MB per event is wasteful.
 * A diagnostic PNG save is a future enhancement; for now the renderer works
 * off failedRows + row metadata (enough for the "인식 실패" production UX).
 */
function toIpcEvent(e: CraftEvent): unknown {
  if (e.type === 'detection-failure') {
    const { canonical: _c, canonicalSize: _s, ...rest } = e;
    return rest;
  }
  return e;
}

let craftController: AutoRerollController | null = null;

async function startCraft(config: CraftConfig): Promise<{ ok: boolean; reason?: string }> {
  if (craftController) return { ok: false, reason: 'already running' };
  if (!precisionProfile) return { ok: false, reason: 'precision profile not loaded' };
  if (!statRefs) return { ok: false, reason: 'stat references not loaded' };
  if (!tracker) return { ok: false, reason: '선택된 LDPlayer 창이 없습니다' };

  const statePath = craftStatePath();
  const state = await loadState(statePath);

  const controller = new AutoRerollController();
  controller.on('event', (e: CraftEvent) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('craft:event', toIpcEvent(e));
  });
  craftController = controller;

  controller
    .start({
      windowKey: tracker.key,
      config,
      screenProfile: precisionProfile,
      statRefs,
      state,
      statePath,
    })
    .finally(() => {
      if (craftController === controller) craftController = null;
    });

  return { ok: true };
}

function stopCraft(): void {
  craftController?.stop();
}

const CONTENT_CHECK_INTERVAL_MS = 1000;

const MIN_W = 1280;
const MIN_H = 720;
// Upper bound: +2% of canonical. Beyond this, the nearest-neighbor downscale
// to 1280×720 accumulates enough subpixel drift that the same stat renders
// measurably different pixels than our registered reference masks, tanking
// IoU below detection thresholds. +2% stays in the sweet spot where the
// resize is effectively identity. Bigger windows need explicit app support
// (multi-sample references) which is out of scope for now.
const MAX_W = Math.floor(MIN_W * 1.02); // 1305
const MAX_H = Math.floor(MIN_H * 1.02); // 734
const TARGET_RATIO = 16 / 9;
const RATIO_TOLERANCE = 0.015;

function validateRender(rect: NativeRect): GlowState {
  const w = rect.right - rect.left;
  const h = rect.bottom - rect.top;
  if (w < MIN_W || h < MIN_H) {
    return {
      ok: false,
      reason: `해상도 부족\n현재 ${w}×${h}\n최소 ${MIN_W}×${MIN_H} 필요`,
    };
  }
  if (w > MAX_W || h > MAX_H) {
    return {
      ok: false,
      reason: `해상도 초과\n현재 ${w}×${h}\n최대 ${MAX_W}×${MAX_H}\n(1280×720 +2%)`,
    };
  }
  const ratio = w / h;
  if (Math.abs(ratio - TARGET_RATIO) > TARGET_RATIO * RATIO_TOLERANCE) {
    return {
      ok: false,
      reason: `화면비 부적합\n현재 ${ratio.toFixed(3)}\n16:9 (1.778) 필요`,
    };
  }
  return { ok: true };
}

function sameGlowState(a: GlowState | null, b: GlowState): boolean {
  if (!a) return false;
  return a.ok === b.ok && a.reason === b.reason;
}

function sendGlowState(state: GlowState): void {
  if (!tracker) return;
  if (tracker.overlay.isDestroyed()) return;
  tracker.overlay.webContents.send('glow:state', state);
}

let tracker: Tracker | null = null;

export interface TrackedInfo {
  key: string;
  title: string;
}

function notifyTrackingChange(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const info: TrackedInfo | null = tracker
    ? { key: tracker.key, title: getWindowTitle(tracker.key) ?? '' }
    : null;
  mainWindow.webContents.send('ldplayer:tracked-change', info);
}

function applyGlowBounds(overlay: BrowserWindow, physical: NativeRect): string | null {
  const dip = physicalToDipRect(physical);
  if (!dip) return null;
  overlay.setBounds({
    x: dip.x - GLOW_PAD,
    y: dip.y - GLOW_PAD,
    width: dip.width + GLOW_PAD * 2,
    height: dip.height + GLOW_PAD * 2,
  });
  return `${dip.x},${dip.y},${dip.width},${dip.height}`;
}

function stopGlow(): void {
  if (!tracker) return;
  clearInterval(tracker.interval);
  if (tracker.contentInterval) clearInterval(tracker.contentInterval);
  if (!tracker.overlay.isDestroyed()) tracker.overlay.close();
  tracker = null;
  notifyTrackingChange();
}

function getGlowTargetBounds(key: string): NativeRect | null {
  return getRenderBounds(key) ?? getWindowBounds(key);
}

function combineGlowState(size: GlowState, content: ScreenAssessment | null): GlowState {
  if (!size.ok) return size;
  if (content && !content.match) {
    return {
      ok: false,
      reason: '정밀 제작\n서브 옵션 선택 중이 아닙니다',
    };
  }
  return { ok: true };
}

/**
 * N consecutive failed content checks required before flipping the glow to
 * invalid. At CONTENT_CHECK_INTERVAL_MS=1000 this is ~3s of sustained
 * mismatch — long enough to ignore reroll/option-change animations (≤2s)
 * but short enough that real screen navigation is caught quickly.
 */
const INVALID_CONTENT_HYSTERESIS = 3;

function runContentCheck(): void {
  if (!tracker) return;
  if (!precisionProfile) return;
  const cap = captureRender(tracker.key);
  if (!cap) return;
  const result = assessScreen(cap.buffer, cap.width, cap.height, precisionProfile);

  if (result.match) {
    // Recovery is instant — one good check clears the pending counter and
    // commits valid content state.
    tracker.pendingInvalidContentCount = 0;
    tracker.lastContent = result;
  } else {
    tracker.pendingInvalidContentCount += 1;
    if (tracker.pendingInvalidContentCount >= INVALID_CONTENT_HYSTERESIS) {
      tracker.lastContent = result;
    }
    // Else: keep lastContent unchanged; the transient failure is suppressed.
  }

  const combined = combineGlowState(tracker.lastSizeState, tracker.lastContent);
  if (!sameGlowState(tracker.lastValidation, combined)) {
    tracker.lastValidation = combined;
    sendGlowState(combined);
  }
}

function startGlow(key: string): void {
  stopGlow();
  const rect = getGlowTargetBounds(key);
  if (!rect) return;

  const overlay = new BrowserWindow({
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'glow-preload.js'),
      contextIsolation: true,
    },
  });
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.setAlwaysOnTop(true, 'floating');
  overlay.loadFile(path.join(__dirname, '..', 'glow.html'));

  const initialBoundsKey = applyGlowBounds(overlay, rect) ?? '';
  const initialSizeState = validateRender(rect);
  const initialCombined = combineGlowState(initialSizeState, null);

  overlay.once('ready-to-show', () => {
    overlay.showInactive();
    if (tracker && !overlay.isDestroyed() && tracker.lastValidation) {
      overlay.webContents.send('glow:state', tracker.lastValidation);
    }
  });

  const interval = setInterval(() => {
    if (!tracker) return;
    if (!isWindowAlive(tracker.key)) {
      stopGlow();
      return;
    }
    if (isWindowMinimized(tracker.key)) {
      if (tracker.visible) {
        tracker.overlay.hide();
        tracker.visible = false;
      }
      return;
    }
    const r = getGlowTargetBounds(tracker.key);
    if (!r) return;
    const newKey = applyGlowBounds(tracker.overlay, r);
    if (newKey !== null && newKey !== tracker.lastBoundsKey) {
      tracker.lastBoundsKey = newKey;
    }
    const sizeState = validateRender(r);
    tracker.lastSizeState = sizeState;
    const combined = combineGlowState(sizeState, tracker.lastContent);
    if (!sameGlowState(tracker.lastValidation, combined)) {
      tracker.lastValidation = combined;
      sendGlowState(combined);
    }
    if (!tracker.visible) {
      tracker.overlay.showInactive();
      tracker.visible = true;
    }
  }, TRACK_INTERVAL_MS);

  const contentInterval = setInterval(runContentCheck, CONTENT_CHECK_INTERVAL_MS);

  tracker = {
    key,
    overlay,
    interval,
    contentInterval,
    visible: true,
    lastBoundsKey: initialBoundsKey,
    lastValidation: initialCombined,
    lastSizeState: initialSizeState,
    lastContent: null,
    pendingInvalidContentCount: 0,
  };
  notifyTrackingChange();
}

function startPicker(): Promise<string | null> {
  stopGlow();
  if (activePicker) endPicker(null);
  const wins = findLdplayerWindows();
  if (wins.length === 0) return Promise.resolve(null);

  const backdrop = createBackdrop();
  const overlays: BrowserWindow[] = [];
  for (const w of wins) {
    const rect = getWindowBounds(w.key);
    if (!rect) continue;
    const overlay = createPickerOverlay(rect, w.key);
    if (overlay) overlays.push(overlay);
  }

  if (overlays.length === 0) {
    if (!backdrop.isDestroyed()) backdrop.close();
    return Promise.resolve(null);
  }

  return new Promise<string | null>((resolve) => {
    activePicker = { resolve, backdrop, overlays };
  });
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 720,
    height: 480,
    minWidth: 720,
    minHeight: 480,
    frame: false,
    backgroundColor: '#f7f7f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
    stopGlow();
  });

  ipcMain.on('window:minimize', () => win.minimize());
  ipcMain.on('window:toggle-maximize', () => {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('window:close', () => win.close());

  ipcMain.on('links:open', (_e, url: unknown) => {
    if (typeof url !== 'string') return;
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
      shell.openExternal(url);
    } catch {}
  });

  ipcMain.handle('favicon:get', (_e, url: unknown) => getFavicon(url));
  ipcMain.handle('app:reset-data', () => resetAppData());

  ipcMain.handle('ldplayer:find', () => findLdplayerWindows());
  ipcMain.handle('ldplayer:pick', () => startPicker());
  ipcMain.handle('ldplayer:stop-tracking', () => stopGlow());
  ipcMain.handle('ldplayer:get-tracked', (): TrackedInfo | null =>
    tracker ? { key: tracker.key, title: getWindowTitle(tracker.key) ?? '' } : null
  );
  ipcMain.on('ldplayer:picker-pick', (_e, key: unknown) => {
    if (typeof key === 'string') endPicker(key);
  });
  ipcMain.on('ldplayer:picker-cancel', () => endPicker(null));

  ipcMain.handle('craft:get-catalog', () => Array.from(STAT_CATALOG));
  ipcMain.handle(
    'craft:get-initial-state',
    async (): Promise<SessionState> => loadState(craftStatePath())
  );
  ipcMain.handle('craft:start', async (_e, raw: unknown) => {
    const config = coerceConfig(raw);
    if (!config) return { ok: false, reason: 'invalid config' };
    return startCraft(config);
  });
  ipcMain.handle('craft:stop', () => {
    stopCraft();
    return { ok: true };
  });

  win.on('maximize', () => win.webContents.send('window:maximized', true));
  win.on('unmaximize', () => win.webContents.send('window:maximized', false));

  win.loadFile(path.join(__dirname, '..', 'index.html'));
}

/**
 * Validate + coerce renderer-supplied config. IPC data is `unknown`; we don't
 * trust the renderer enough to skip validation here, and bad values would
 * otherwise propagate into the controller / matching logic.
 */
function coerceConfig(raw: unknown): CraftConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const valuable = Array.isArray(r.valuable)
    ? r.valuable.filter((v): v is string => typeof v === 'string')
    : null;
  const coerceTemplate = (raw: unknown): Template | null => {
    if (!Array.isArray(raw) || raw.length !== 4) return null;
    const nums: number[] = [];
    for (const t of raw) {
      const n = Number(t);
      if (!Number.isInteger(n) || n < 0 || n > 4) return null;
      nums.push(n);
    }
    return nums as unknown as Template;
  };
  const templates = Array.isArray(r.templates) && r.templates.length >= 1 && r.templates.length <= 2
    ? r.templates.map(coerceTemplate)
    : null;
  if (!valuable || !templates || templates.some((t) => t === null)) return null;
  const maxIter = Number(r.maxIter);
  if (!Number.isFinite(maxIter) || maxIter < 1 || maxIter > 1000) return null;
  return {
    valuable,
    templates: templates as Template[],
    maxIter: Math.floor(maxIter),
  };
}

app.whenReady().then(() => {
  loadPrecisionProfile();
  loadStatRefs();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopGlow();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopGlow();
});
