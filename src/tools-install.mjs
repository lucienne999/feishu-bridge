import {spawnSync, execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {cursorBinary, qoderBinary, opencodeBinary} from './providers.mjs';

export const INSTALL_SCRIPTS = {
  codex: {
    label: 'Codex',
    url: 'https://chatgpt.com/codex/install.sh',
    checkBin: 'codex',
  },
  cursor: {
    label: 'Cursor CLI',
    url: 'https://cursor.com/install',
    checkBin: 'cursor-agent',
  },
  qcoder: {
    label: 'Qoder CLI',
    url: 'https://qoder.com/install',
    checkBin: 'qoder',
  },
  opencode: {
    label: 'OpenCode',
    url: 'https://opencode.ai/v2/install',
    checkBin: 'opencode',
  },
};

export function withLocalBinPath(env = process.env) {
  const extras = [
    join(homedir(), '.local', 'bin'),
    join(homedir(), '.opencode', 'bin'),
    join(homedir(), 'bin'),
  ];
  const path = env.PATH || '';
  const parts = path.split(':').filter(Boolean);
  const prefix = extras.filter(dir => !parts.includes(dir));
  if (!prefix.length) return {...env};
  return {...env, PATH: [...prefix, ...parts].join(':')};
}

function versionOk(bin, env, exec) {
  try {
    exec(bin, ['--version'], {env, encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe']});
    return true;
  } catch {
    return false;
  }
}

export function toolInstalled(name, env, {
  exec = execFileSync,
  cursorBin = cursorBinary,
  qoderBin = qoderBinary,
  opencodeBin = opencodeBinary,
} = {}) {
  const e = withLocalBinPath(env);
  if (name === 'codex') return versionOk('codex', e, exec);
  if (name === 'cursor') return versionOk(cursorBin(), e, exec);
  if (name === 'qcoder') return versionOk(qoderBin(), e, exec);
  if (name === 'opencode') return versionOk(opencodeBin(), e, exec);
  throw Error(`未知工具：${name}`);
}

export function runInstallScript(url, env, {
  spawn = spawnSync,
} = {}) {
  // Official one-liners: curl -fsSL <url> | bash
  const result = spawn('bash', ['-lc', `curl -fsSL ${JSON.stringify(url)} | bash`], {
    env: withLocalBinPath(env),
    encoding: 'utf8',
    timeout: 300000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim().slice(-500);
    throw Error(detail || `安装脚本失败（退出码 ${result.status}）`);
  }
  return result;
}

/**
 * Ensure agent CLIs are present. Installs missing ones via official scripts.
 * Returns notes and an env with common bin dirs prepended for subsequent checks.
 */
export function ensureAgentTools(env, {
  names = ['codex', 'cursor', 'qcoder', 'opencode'],
  installed = toolInstalled,
  install = runInstallScript,
  log = console.log,
} = {}) {
  const nextEnv = withLocalBinPath(env);
  const notes = [];
  for (const name of names) {
    const meta = INSTALL_SCRIPTS[name];
    if (!meta) throw Error(`未知工具：${name}`);
    if (installed(name, nextEnv)) {
      notes.push(`${meta.label}：已安装，跳过`);
      continue;
    }
    log(`正在安装 ${meta.label}…`);
    try {
      install(meta.url, nextEnv);
    } catch (e) {
      notes.push(`${meta.label}：安装失败（${e.message}）`);
      continue;
    }
    if (installed(name, nextEnv)) notes.push(`${meta.label}：安装成功`);
    else notes.push(`${meta.label}：安装脚本已跑完，但命令仍不可用；请确认 PATH 含 ~/.local/bin 与 ~/.opencode/bin 后重开终端`);
  }
  return {env: nextEnv, notes, ok: names.every(n => installed(n, nextEnv))};
}
