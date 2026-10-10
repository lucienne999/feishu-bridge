import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {codexArgs} from './core.mjs';

export const AGENT_MODES = ['codex', 'cursor', 'qoder', 'opencode'];
const PROVIDERS = AGENT_MODES;

export function normalizeDefaultMode(value) {
  if (value == null || value === '') return 'codex';
  if (!AGENT_MODES.includes(value)) throw Error('无效的 defaultMode 配置，应为 codex、cursor、qoder 或 opencode');
  return value;
}

export function cursorBinary() {
  const local = join(homedir(), '.local', 'bin', 'cursor-agent');
  return existsSync(local) ? local : 'cursor-agent';
}

export function qoderBinary() {
  const candidates = [
    join(homedir(), '.local', 'bin', 'qoder'),
    join(homedir(), '.local', 'bin', 'qodercli'),
    join(homedir(), '.qoder', 'bin', 'qoder'),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return 'qoder';
}

export function opencodeBinary() {
  const candidates = [
    join(homedir(), '.opencode', 'bin', 'opencode'),
    join(homedir(), '.local', 'bin', 'opencode'),
    join(homedir(), 'bin', 'opencode'),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return 'opencode';
}

export function providerLabel(provider) {
  return {codex: 'Codex', cursor: 'Cursor', qoder: 'Qoder', opencode: 'OpenCode'}[provider] || provider;
}

export function providerSessionKey(key, provider) {
  return provider === 'codex' ? key : `${key}:${provider}`;
}

export function providerSessionIds(key) {
  return PROVIDERS.map(p => providerSessionKey(key, p));
}

export function providerSpec(provider, session, sandbox, prompt, model) {
  if (provider === 'codex') return {bin: 'codex', args: codexArgs(session, sandbox, model), label: 'Codex', passPromptOnStdin: true};
  if (provider === 'cursor') {
    // --trust: headless only; skips interactive workspace-trust prompt (not --force/--yolo).
    const args = ['--print', '--output-format', 'stream-json', '--sandbox', 'enabled', '--trust'];
    if (sandbox !== 'read-only' && sandbox !== 'workspace-write') throw Error('不支持的权限模式');
    if (model) args.push('--model', model);
    if (session) args.push('--resume', session);
    return {bin: cursorBinary(), args, label: 'Cursor', passPromptOnStdin: true};
  }
  if (provider === 'qoder') {
    // Qoder CLI headless: https://docs.qoder.com/cli/cli-reference
    const args = ['--print', '--output-format', 'stream-json'];
    if (sandbox === 'read-only') args.push('--permission-mode', 'plan');
    else if (sandbox === 'workspace-write') args.push('--permission-mode', 'accept_edits');
    else throw Error('不支持的权限模式');
    if (model) args.push('--model', model);
    if (session) args.push('--resume', session);
    if (prompt) args.push(prompt);
    return {bin: qoderBinary(), args, label: 'Qoder', passPromptOnStdin: false};
  }
  if (provider !== 'opencode') throw Error('不支持的执行器');
  // OpenCode headless: https://opencode.ai/docs/cli/
  const args = ['run', '--format', 'json'];
  if (sandbox === 'read-only') args.push('--agent', 'plan');
  else if (sandbox === 'workspace-write') args.push('--agent', 'build', '--auto');
  else throw Error('不支持的权限模式');
  if (model) args.push('--model', model);
  if (session) args.push('--session', session);
  if (prompt) args.push(prompt);
  return {bin: opencodeBinary(), args, label: 'OpenCode', passPromptOnStdin: false};
}

export function providerEvent(provider, event) {
  if (provider === 'opencode') {
    const reason = event.part?.reason;
    return {
      session: event.sessionID || event.part?.sessionID,
      text: event.type === 'text' ? (event.part?.text ?? event.text) : undefined,
      append: event.type === 'text',
      complete: event.type === 'step_finish' && reason !== 'tool-calls',
      failed: event.type === 'error',
      error: event.error?.data?.message || event.error?.message || event.message,
    };
  }
  if (provider === 'cursor' || provider === 'qoder') return {
    session: (event.type === 'system' && event.subtype === 'init') || event.type === 'result' ? event.session_id : undefined,
    text: event.type === 'result' ? event.result : undefined,
    complete: event.type === 'result' && event.is_error === false && event.subtype === 'success',
    failed: event.type === 'error' || (event.type === 'result' && (event.is_error !== false || event.subtype !== 'success')),
    error: event.error?.message || event.message,
  };
  return {
    session: event.type === 'thread.started' ? event.thread_id : undefined,
    text: event.type === 'item.completed' && event.item?.type === 'agent_message' ? event.item.text : undefined,
    complete: event.type === 'turn.completed',
    failed: event.type === 'error' || event.type === 'turn.failed',
    error: event.error?.message || event.message,
  };
}
