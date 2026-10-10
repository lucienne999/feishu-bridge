import {execFileSync, spawnSync} from 'node:child_process';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {delimiter} from 'node:path';
import {cursorBinary, qoderBinary, opencodeBinary} from './providers.mjs';

export const INSTALL_HINTS = {
  lark: {
    label: 'Lark CLI',
    installCmd: 'npm install -g @larksuite/cli',
  },
  codex: {
    label: 'Codex',
    installCmd: 'npm install -g @openai/codex 或 curl -fsSL https://chatgpt.com/codex/install.sh | sh',
  },
  cursor: {
    label: 'Cursor CLI',
    installCmd: 'curl -fsSL https://cursor.com/install | bash',
  },
  qoder: {
    label: 'Qoder CLI',
    installCmd: 'curl -fsSL https://qoder.com/install | bash',
  },
  opencode: {
    label: 'OpenCode',
    installCmd: 'curl -fsSL https://opencode.ai/v2/install | bash',
  },
};

export const INTERNAL_MODULES = ['tjob', 'skillctl'];
export const DR_INSTALL_URL = 'https://webfile.deeproute.cn/dr-cli-core/prod/latest';

export function installInternalTools({
  platform = process.platform,
  env = process.env,
  exec = execFileSync,
  spawn = spawnSync,
  log = console.log,
} = {}) {
  const nextEnv = withLocalBinPath(env);
  try {
    exec('dr', ['version'], {
      env: nextEnv, encoding: 'utf8', timeout: 20000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    log('dr CLI：已安装，跳过');
  } catch {
    const isWindows = platform === 'win32';
    const command = isWindows
      ? `irm ${DR_INSTALL_URL}/install.ps1 | iex`
      : `curl -fsSL ${DR_INSTALL_URL}/install.sh | bash`;
    const shell = isWindows ? 'powershell.exe' : 'bash';
    const args = isWindows
      ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command]
      : ['-lc', command];
    const result = spawn(shell, args, {
      env: nextEnv, stdio: 'inherit', timeout: 600000,
    });
    let installed = false;
    try {
      exec('dr', ['version'], {
        env: nextEnv, encoding: 'utf8', timeout: 20000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      installed = true;
    } catch {}
    if (result.error || (!installed && result.status !== 0)) {
      throw Error(`dr CLI 安装失败，请手动执行：${command}`);
    }
    if (result.status !== 0) log('dr CLI：已安装，但自动认证询问未完成；稍后可手动运行 dr auth login。');
    else log('dr CLI：安装完成');
  }

  for (const module of INTERNAL_MODULES) {
    try {
      exec('dr', ['module', 'install', module], {
        env: nextEnv, encoding: 'utf8', timeout: 600000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      log(`dr 模块 ${module}：安装完成`);
    } catch {
      throw Error(`dr 模块 ${module} 安装失败，请手动执行：dr module install ${module}`);
    }
  }
  return {env: nextEnv, modules: [...INTERNAL_MODULES]};
}

export function withLocalBinPath(env = process.env) {
  const extras = [
    join(homedir(), '.local', 'bin'),
    join(homedir(), '.opencode', 'bin'),
    join(homedir(), 'bin'),
  ];
  const path = env.PATH || '';
  const parts = path.split(delimiter).filter(Boolean);
  const prefix = extras.filter(dir => !parts.includes(dir));
  if (!prefix.length) return {...env};
  return {...env, PATH: [...prefix, ...parts].join(delimiter)};
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
  if (name === 'lark') return versionOk('lark-cli', e, exec);
  if (name === 'codex') return versionOk('codex', e, exec);
  if (name === 'cursor') return versionOk(cursorBin(), e, exec);
  if (name === 'qoder') return versionOk(qoderBin(), e, exec);
  if (name === 'opencode') return versionOk(opencodeBin(), e, exec);
  throw Error(`未知工具：${name}`);
}

/**
 * Check agent CLIs are present. Read-only: prints install hints instead of
 * running installers, so init never blocks on network downloads.
 */
export function checkAgentTools(env, {
  names = ['codex', 'cursor', 'qoder', 'opencode'],
  installed = toolInstalled,
} = {}) {
  const nextEnv = withLocalBinPath(env);
  const notes = [];
  for (const name of names) {
    const meta = INSTALL_HINTS[name];
    if (!meta) throw Error(`未知工具：${name}`);
    if (installed(name, nextEnv)) {
      notes.push(`${meta.label}：已安装，跳过`);
      continue;
    }
    notes.push(`${meta.label}：未安装；安装：${meta.installCmd}`);
  }
  return {env: nextEnv, notes, ok: names.every(n => installed(n, nextEnv))};
}
