/**
 * electron-builder afterPack hook.
 *
 * Why: we keep `signAndEditExecutable: false` in the build config because the
 * winCodeSign tarball that electron-builder auto-downloads contains macOS
 * dylibs stored as symlinks — extracting those on Windows without Developer
 * Mode / admin fails with "privilege not held" and aborts the whole build.
 *
 * But `signAndEditExecutable: false` also skips rcedit, which is what normally
 * embeds our icon into the exe resource. So we run rcedit ourselves here,
 * after the app-outdir is populated and before the target packager (zip) bundles
 * it. The `rcedit` npm package ships its own binary so nothing else to fetch.
 *
 * Invoked per target platform. We no-op on anything but Windows since the
 * other platforms use different packaging tools anyway.
 */
const path = require('path');
// rcedit v5 exports as { rcedit: fn } not a default-function.
const { rcedit } = require('rcedit');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const productFilename = context.packager.appInfo.productFilename;
  const exePath = path.join(context.appOutDir, `${productFilename}.exe`);
  const iconPath = path.resolve(__dirname, '..', 'assets', 'icon.ico');

  await rcedit(exePath, { icon: iconPath });
  // eslint-disable-next-line no-console
  console.log(`  • afterPack: embedded ${path.relative(process.cwd(), iconPath)} into ${path.relative(process.cwd(), exePath)}`);
};
