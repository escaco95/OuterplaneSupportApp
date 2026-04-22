/**
 * Copies renderer static assets (HTML, CSS) from src/renderer/ to dist/renderer/.
 *
 * Why: tsc only emits .js files — HTML/CSS that the renderer BrowserWindow
 * loads alongside the compiled renderer.js need to land next to it in dist/
 * so main.ts's `loadFile(dist/renderer/*.html)` resolves, and so electron-builder
 * picks them up from dist/** during packaging.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'src', 'renderer');
const DST = path.resolve(__dirname, '..', 'dist', 'renderer');
const EXTS = new Set(['.html', '.css']);

fs.mkdirSync(DST, { recursive: true });

let copied = 0;
for (const entry of fs.readdirSync(SRC, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  if (!EXTS.has(path.extname(entry.name))) continue;
  fs.copyFileSync(path.join(SRC, entry.name), path.join(DST, entry.name));
  copied++;
}
console.log(`  • copy-renderer-assets: ${copied} file(s) → dist/renderer/`);
