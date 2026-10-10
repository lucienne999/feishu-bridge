import {execFileSync, spawnSync} from 'node:child_process';
import {cursorBinary, qoderBinary, opencodeBinary, providerLabel} from './providers.mjs';
import {withLocalBinPath} from './tools-install.mjs';

export const AUTH_AGENTS = ['codex', 'cursor', 'qoder', 'opencode'];

function agentBin(name) {
  if (name === 'codex') return 'codex';
  if (name === 'cursor') return cursorBinary();
  if (name === 'qoder') return qoderBinary();
  if (name === 'opencode') return opencodeBinary();
  throw Error(`未知 Agent：${name}`);
}

function statusArgs(name) {
  if (name === 'codex') return ['login', 'status'];
  if (name === 'cursor' || name === 'qoder') return ['status'];
  if (name === 'opencode') return ['auth', 'list'];
  throw Error(`未知 Agent：${name}`);
}

function loginArgs(name) {
  if (name === 'codex') return ['login'];
  if (name === 'cursor' || name === 'qoder') return ['login'];
  if (name === 'opencode') return ['auth', 'login'];
  throw Error(`未知 Agent：${name}`);
}

export function parseAgentsFlag(raw) {
  const text = String(raw || '').trim().toLowerCase();
  if (!text || text === 'all' || text === '全部') return [...AUTH_AGENTS];
  const parts = text.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
  const out = [];
  for (const part of parts) {
    if (/^[1-4]$/.test(part)) {
      out.push(AUTH_AGENTS[Number(part) - 1]);
      continue;
    }
    if (!AUTH_AGENTS.includes(part)) throw Error(`未知 Agent：${part}。可选：${AUTH_AGENTS.join(', ')}`);
    out.push(part);
  }
  return [...new Set(out)];
}

export function agentLoggedIn(name, env, {
  exec = execFileSync,
} = {}) {
  const e = withLocalBinPath(env);
  try {
    exec(agentBin(name), statusArgs(name), {
      env: e, encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

export function runAgentLogin(name, env, {
  spawn = spawnSync,
} = {}) {
  const e = withLocalBinPath(env);
  const result = spawn(agentBin(name), loginArgs(name), {
    env: e,
    stdio: 'inherit',
    timeout: 600000,
  });
  if (result.error?.code === 'ENOENT') {
    throw Error(`${providerLabel(name)} 命令不可用，请先安装对应 CLI。`);
  }
  if (result.status !== 0) {
    throw Error(`${providerLabel(name)} 登录未完成（退出码 ${result.status ?? 'unknown'}）。`);
  }
}

/**
 * Ensure selected agents are authenticated. Already-logged agents are skipped.
 * Interactive login uses inherited stdio (browser / device code flows).
 */
export function ensureAgentAuth(names, env, {
  loggedIn = agentLoggedIn,
  login = runAgentLogin,
  log = console.log,
} = {}) {
  const notes = [];
  const list = [...new Set(names)];
  for (const name of list) {
    if (!AUTH_AGENTS.includes(name)) throw Error(`未知 Agent：${name}`);
    const label = providerLabel(name);
    if (loggedIn(name, env)) {
      notes.push(`${label} 登录：已就绪，跳过`);
      continue;
    }
    log(`开始 ${label} 登录初始化（按终端提示完成浏览器或设备码流程）…`);
    try {
      login(name, env);
    } catch (e) {
      notes.push(`${label} 登录：失败（${e.message}）`);
      continue;
    }
    if (loggedIn(name, env)) notes.push(`${label} 登录：成功`);
    else notes.push(`${label} 登录：命令已结束，但状态仍未通过；请手动运行对应 login 后重试`);
  }
  const ok = list.every(name => loggedIn(name, env));
  return {notes, ok, agents: list};
}

export async function resolveAuthAgents({full = false, agentsFlag = ''} = {}, {
  ask,
  log = console.log,
} = {}) {
  if (!full) return ['codex'];
  if (agentsFlag) return parseAgentsFlag(agentsFlag);
  if (!ask) {
    log('非交互全量模式：未指定 --agents，默认对全部已安装 Agent 做登录初始化。');
    return [...AUTH_AGENTS];
  }
  log('选择要做登录初始化的 Agent（可多选）：');
  log('  1) Codex');
  log('  2) Cursor');
  log('  3) Qoder');
  log('  4) OpenCode');
  const answer = (await ask('输入编号或名称，逗号分隔；直接回车 = 全部：')).trim();
  return parseAgentsFlag(answer || 'all');
}
