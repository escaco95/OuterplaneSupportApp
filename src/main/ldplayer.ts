import * as koffi from 'koffi';
import { randomUUID } from 'crypto';

const user32 = koffi.load('user32.dll');
const gdi32 = koffi.load('gdi32.dll');

const RECT = koffi.struct('RECT', {
  left: 'int32',
  top: 'int32',
  right: 'int32',
  bottom: 'int32',
});

const BITMAPINFOHEADER = koffi.struct('BITMAPINFOHEADER', {
  biSize: 'uint32',
  biWidth: 'int32',
  biHeight: 'int32',
  biPlanes: 'uint16',
  biBitCount: 'uint16',
  biCompression: 'uint32',
  biSizeImage: 'uint32',
  biXPelsPerMeter: 'int32',
  biYPelsPerMeter: 'int32',
  biClrUsed: 'uint32',
  biClrImportant: 'uint32',
});
const BITMAPINFO = koffi.struct('BITMAPINFO', {
  bmiHeader: BITMAPINFOHEADER,
  bmiColors: koffi.array('uint32', 1),
});

const SetProcessDPIAware = user32.func('int __stdcall SetProcessDPIAware()');

// Mark this process DPI-aware so GetWindowRect/PrintWindow report physical
// pixels. Electron's main process is already DPI-aware via its manifest;
// this call is idempotent there but essential for plain-Node entry points
// (e.g. src/craft/runner-console.ts). Without it, capture dimensions can
// come back as virtual coords on HiDPI displays, silently corrupting scan.
SetProcessDPIAware();

const EnumWindowsProc = koffi.proto('int __stdcall EnumWindowsProc(void* hwnd, intptr lParam)');

const EnumWindows = user32.func(
  'int __stdcall EnumWindows(EnumWindowsProc* proc, intptr lParam)'
);
const GetClassNameW = user32.func(
  'int __stdcall GetClassNameW(void* hWnd, _Out_ uint16_t* lpClassName, int nMaxCount)'
);
const GetWindowTextW = user32.func(
  'int __stdcall GetWindowTextW(void* hWnd, _Out_ uint16_t* lpString, int nMaxCount)'
);
const IsWindowVisible = user32.func('int __stdcall IsWindowVisible(void* hWnd)');
const IsWindow = user32.func('int __stdcall IsWindow(void* hWnd)');
const IsIconic = user32.func('int __stdcall IsIconic(void* hWnd)');
const GetWindowThreadProcessId = user32.func(
  'uint32 __stdcall GetWindowThreadProcessId(void* hWnd, _Out_ uint32* lpdwProcessId)'
);
const GetWindowRect = user32.func(
  'int __stdcall GetWindowRect(void* hWnd, _Out_ RECT* lpRect)'
);
const FindWindowExW = user32.func(
  'void* __stdcall FindWindowExW(void* hWndParent, void* hWndChildAfter, str16 lpszClass, str16 lpszWindow)'
);
const GetDC = user32.func('void* __stdcall GetDC(void* hWnd)');
const ReleaseDC = user32.func('int __stdcall ReleaseDC(void* hWnd, void* hDC)');
const PrintWindow = user32.func(
  'int __stdcall PrintWindow(void* hWnd, void* hdcBlt, uint32 nFlags)'
);
const PostMessageW = user32.func(
  'int __stdcall PostMessageW(void* hWnd, uint32 Msg, intptr wParam, intptr lParam)'
);

const CreateCompatibleDC = gdi32.func('void* __stdcall CreateCompatibleDC(void* hdc)');
const DeleteDC = gdi32.func('int __stdcall DeleteDC(void* hdc)');
const CreateCompatibleBitmap = gdi32.func(
  'void* __stdcall CreateCompatibleBitmap(void* hdc, int cx, int cy)'
);
const SelectObject = gdi32.func('void* __stdcall SelectObject(void* hdc, void* h)');
const DeleteObject = gdi32.func('int __stdcall DeleteObject(void* ho)');
const GetDIBits = gdi32.func(
  'int __stdcall GetDIBits(void* hdc, void* hbm, uint32 start, uint32 cLines, _Inout_ void* lpvBits, _Inout_ BITMAPINFO* lpbmi, uint32 usage)'
);

const TARGET_CLASS = 'LDPlayerMainFrame';

export interface LdplayerWindowInfo {
  key: string;
  pid: number;
  title: string;
}

export interface NativeRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const windowCache = new Map<string, unknown>();

function decodeU16(buf: Uint16Array, len: number): string {
  let s = '';
  for (let i = 0; i < len && buf[i] !== 0; i++) {
    s += String.fromCharCode(buf[i]);
  }
  return s;
}

export function findLdplayerWindows(): LdplayerWindowInfo[] {
  windowCache.clear();
  const out: LdplayerWindowInfo[] = [];

  const cb = koffi.register(
    (hwnd: unknown, _lp: unknown): number => {
      if (!IsWindowVisible(hwnd)) return 1;

      const classBuf = new Uint16Array(256);
      const classLen = GetClassNameW(hwnd, classBuf, classBuf.length);
      const className = decodeU16(classBuf, classLen);
      if (className !== TARGET_CLASS) return 1;

      const titleBuf = new Uint16Array(256);
      const titleLen = GetWindowTextW(hwnd, titleBuf, titleBuf.length);
      const title = decodeU16(titleBuf, titleLen);

      const pidOut: [number] = [0];
      GetWindowThreadProcessId(hwnd, pidOut);

      const key = randomUUID();
      windowCache.set(key, hwnd);
      out.push({ key, pid: pidOut[0], title });
      return 1;
    },
    koffi.pointer(EnumWindowsProc)
  );

  try {
    EnumWindows(cb, 0);
  } finally {
    koffi.unregister(cb);
  }

  return out;
}

export function getWindowBounds(key: string): NativeRect | null {
  const hwnd = windowCache.get(key);
  if (hwnd === undefined) return null;
  const rect: NativeRect = { left: 0, top: 0, right: 0, bottom: 0 };
  if (!GetWindowRect(hwnd, rect)) return null;
  return rect;
}

export function getRenderBounds(key: string): NativeRect | null {
  const mainHwnd = windowCache.get(key);
  if (mainHwnd === undefined) return null;
  const renderHwnd = FindWindowExW(mainHwnd, null, 'RenderWindow', null);
  if (!renderHwnd) return null;
  const rect: NativeRect = { left: 0, top: 0, right: 0, bottom: 0 };
  if (!GetWindowRect(renderHwnd, rect)) return null;
  return rect;
}

export function isWindowAlive(key: string): boolean {
  const hwnd = windowCache.get(key);
  if (hwnd === undefined) return false;
  return Boolean(IsWindow(hwnd));
}

export function isWindowMinimized(key: string): boolean {
  const hwnd = windowCache.get(key);
  if (hwnd === undefined) return false;
  return Boolean(IsIconic(hwnd));
}

export function getWindowTitle(key: string): string | null {
  const hwnd = windowCache.get(key);
  if (hwnd === undefined) return null;
  if (!IsWindow(hwnd)) return null;
  const buf = new Uint16Array(256);
  const len = GetWindowTextW(hwnd, buf, buf.length);
  return decodeU16(buf, len);
}

export interface Capture {
  buffer: Buffer;
  width: number;
  height: number;
}

const WM_LBUTTONDOWN = 0x0201;
const WM_LBUTTONUP = 0x0202;
const MK_LBUTTON = 1;

/**
 * Inject a left-click into the LDPlayer RenderWindow at normalized
 * coordinates (0..1). Uses PostMessageW(WM_LBUTTONDOWN/UP) so the real
 * mouse cursor is never moved — user can keep doing whatever they're doing
 * in other windows while this fires.
 *
 * `gapMs` controls the down→up delay. 10ms is empirically enough for the
 * game's input handler to register it as a full click; 30ms was the original
 * PS skill value but we shortened it since 10ms works reliably.
 *
 * Returns false if the window/handle is gone, true if both messages posted.
 */
export function clickRender(
  key: string,
  nx: number,
  ny: number,
  gapMs = 10
): Promise<boolean> {
  return new Promise((resolve) => {
    const mainHwnd = windowCache.get(key);
    if (mainHwnd === undefined) {
      resolve(false);
      return;
    }
    const renderHwnd = FindWindowExW(mainHwnd, null, 'RenderWindow', null);
    if (!renderHwnd) {
      resolve(false);
      return;
    }
    const rect: NativeRect = { left: 0, top: 0, right: 0, bottom: 0 };
    if (!GetWindowRect(renderHwnd, rect)) {
      resolve(false);
      return;
    }
    const w = rect.right - rect.left;
    const h = rect.bottom - rect.top;
    if (w <= 0 || h <= 0) {
      resolve(false);
      return;
    }
    const cx = Math.max(0, Math.min(w - 1, Math.round(nx * w)));
    const cy = Math.max(0, Math.min(h - 1, Math.round(ny * h)));
    // lParam packs client coords: high word = y, low word = x.
    const lParam = ((cy & 0xffff) << 16) | (cx & 0xffff);
    PostMessageW(renderHwnd, WM_LBUTTONDOWN, MK_LBUTTON, lParam);
    setTimeout(() => {
      PostMessageW(renderHwnd, WM_LBUTTONUP, 0, lParam);
      resolve(true);
    }, gapMs);
  });
}

/**
 * Capture the LDPlayer RenderWindow via PrintWindow(PW_RENDERFULLCONTENT).
 * Returns BGRA pixel buffer (top-down) or null on failure.
 */
export function captureRender(key: string): Capture | null {
  const mainHwnd = windowCache.get(key);
  if (mainHwnd === undefined) return null;
  const renderHwnd = FindWindowExW(mainHwnd, null, 'RenderWindow', null);
  if (!renderHwnd) return null;

  const rect: NativeRect = { left: 0, top: 0, right: 0, bottom: 0 };
  if (!GetWindowRect(renderHwnd, rect)) return null;
  const w = rect.right - rect.left;
  const h = rect.bottom - rect.top;
  if (w <= 0 || h <= 0) return null;

  const srcDC = GetDC(renderHwnd);
  if (!srcDC) return null;

  let memDC: unknown = null;
  let bitmap: unknown = null;
  let oldBitmap: unknown = null;
  try {
    memDC = CreateCompatibleDC(srcDC);
    if (!memDC) return null;
    bitmap = CreateCompatibleBitmap(srcDC, w, h);
    if (!bitmap) return null;
    oldBitmap = SelectObject(memDC, bitmap);

    // PW_RENDERFULLCONTENT = 2
    PrintWindow(renderHwnd, memDC, 2);

    const bi = {
      bmiHeader: {
        biSize: 40,
        biWidth: w,
        biHeight: -h, // negative = top-down
        biPlanes: 1,
        biBitCount: 32,
        biCompression: 0, // BI_RGB
        biSizeImage: 0,
        biXPelsPerMeter: 0,
        biYPelsPerMeter: 0,
        biClrUsed: 0,
        biClrImportant: 0,
      },
      bmiColors: [0],
    };

    const pixels = Buffer.alloc(w * h * 4);
    const ok = GetDIBits(memDC, bitmap, 0, h, pixels, bi, 0); // DIB_RGB_COLORS = 0
    if (!ok) return null;
    return { buffer: pixels, width: w, height: h };
  } finally {
    if (oldBitmap && memDC) SelectObject(memDC, oldBitmap);
    if (bitmap) DeleteObject(bitmap);
    if (memDC) DeleteDC(memDC);
    ReleaseDC(renderHwnd, srcDC);
  }
}
