import {copyFileSync, existsSync, mkdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const LEGACY_MARKERS = ['config.json', 'connection.json', 'state.sqlite'];

/** Package install / clone root (code + bundled demo templates). */
export function packageRootFrom(moduleUrl = import.meta.url) {
  return resolve(dirname(fileURLToPath(moduleUrl)), '..');
}

/**
 * Runtime data directory for config / state / logs.
 * Priority: FEISHU_BRIDGE_HOME → existing local clone data → ~/.feishu-bridge
 */
export function resolveDataRoot(packageRoot, {
  env = process.env,
  home = homedir(),
  exists = existsSync,
} = {}) {
  const override = String(env.FEISHU_BRIDGE_HOME || '').trim();
  if (override) return resolve(override);
  if (LEGACY_MARKERS.some(name => exists(join(packageRoot, name)))) return packageRoot;
  return join(home, '.feishu-bridge');
}

/** Ensure data dir exists; seed demo/ from the package when missing. */
export function ensureDataLayout(dataRoot, packageRoot, {
  mkdir = mkdirSync,
  exists = existsSync,
  copyFile = copyFileSync,
} = {}) {
  mkdir(dataRoot, {recursive: true, mode: 0o700});
  const demoDir = join(dataRoot, 'demo');
  mkdir(demoDir, {recursive: true, mode: 0o700});
  const demoReadme = join(demoDir, 'README.md');
  const bundled = join(packageRoot, 'demo', 'README.md');
  if (!exists(demoReadme) && exists(bundled)) copyFile(bundled, demoReadme);
  return {demoDir};
}

export function cliEntryPath(moduleUrl = import.meta.url) {
  return fileURLToPath(moduleUrl);
}
