import test from 'node:test';
import assert from 'node:assert/strict';
import {providerSpec, providerEvent, providerSessionKey, providerSessionIds, providerLabel, normalizeDefaultMode} from '../src/providers.mjs';

test('Cursor 使用默认 Agent 模式和沙箱，信任工作区，不自动放开执行或 MCP', () => {
  const spec = providerSpec('cursor', 'cursor-session', 'read-only');
  assert.deepEqual(spec.args, ['--print', '--output-format', 'stream-json', '--sandbox', 'enabled', '--trust', '--resume', 'cursor-session']);
  assert.ok(!spec.args.includes('--mode'));
  const ww = providerSpec('cursor', null, 'workspace-write');
  assert.ok(ww.args.includes('--trust'));
  assert.ok(!ww.args.includes('--force'));
  assert.ok(!ww.args.includes('--yolo'));
  assert.ok(!ww.args.includes('--mode'));
  const withModel = providerSpec('cursor', null, 'read-only', null, 'gpt-5.3-codex');
  assert.ok(withModel.args.includes('--model') && withModel.args.includes('gpt-5.3-codex'));
});

test('Qoder 使用 print/stream-json，只读为 plan，可写为 accept_edits', () => {
  const ro = providerSpec('qoder', 'q-session', 'read-only', '解释 README');
  assert.equal(ro.label, 'Qoder');
  assert.equal(ro.passPromptOnStdin, false);
  assert.deepEqual(ro.args, [
    '--print', '--output-format', 'stream-json',
    '--permission-mode', 'plan',
    '--resume', 'q-session',
    '解释 README',
  ]);
  const ww = providerSpec('qoder', null, 'workspace-write', '改代码');
  assert.ok(ww.args.includes('accept_edits'));
  assert.ok(!ww.args.includes('--yolo'));
});

test('OpenCode 使用 run --format json，只读 plan，可写 build --auto', () => {
  const ro = providerSpec('opencode', 'ses_abc', 'read-only', '解释 README');
  assert.equal(ro.label, 'OpenCode');
  assert.equal(ro.passPromptOnStdin, false);
  assert.deepEqual(ro.args, ['run', '--format', 'json', '--agent', 'plan', '--session', 'ses_abc', '解释 README']);
  const ww = providerSpec('opencode', null, 'workspace-write', '改代码');
  assert.ok(ww.args.includes('build') && ww.args.includes('--auto'));
});

test('defaultMode 缺省为 Codex，非法值拒绝', () => {
  assert.equal(normalizeDefaultMode(undefined), 'codex');
  assert.equal(normalizeDefaultMode(''), 'codex');
  assert.equal(normalizeDefaultMode('cursor'), 'cursor');
  assert.throws(() => normalizeDefaultMode('gpt'), /无效的 defaultMode/);
});

test('四种执行器会话隔离并保留原 Codex key', () => {
  assert.equal(providerSessionKey('chat', 'codex'), 'chat');
  assert.notEqual(providerSessionKey('chat', 'cursor'), providerSessionKey('chat', 'codex'));
  assert.notEqual(providerSessionKey('chat', 'qoder'), providerSessionKey('chat', 'cursor'));
  assert.notEqual(providerSessionKey('chat', 'opencode'), providerSessionKey('chat', 'qoder'));
  assert.deepEqual(providerSessionIds('chat'), ['chat', 'chat:cursor', 'chat:qoder', 'chat:opencode']);
  assert.equal(providerLabel('opencode'), 'OpenCode');
});

test('Cursor / Qoder 成功、失败与缺失终止事件不会混淆', () => {
  for (const provider of ['cursor', 'qoder']) {
    assert.equal(providerEvent(provider, {type: 'system', subtype: 'init', session_id: 's'}).session, 's');
    const final = providerEvent(provider, {type: 'result', subtype: 'success', is_error: false, result: 'OK', session_id: 's'});
    assert.equal(final.text, 'OK');
    assert.equal(final.complete, true);
    assert.equal(providerEvent(provider, {type: 'result', is_error: true}).failed, true);
    assert.equal(providerEvent(provider, {type: 'assistant', message: {}}).complete, false);
  }
});

test('OpenCode JSONL 事件：累积 text、step_finish 完成、忽略 tool-calls', () => {
  assert.equal(providerEvent('opencode', {type: 'step_start', sessionID: 'ses_1'}).session, 'ses_1');
  const text = providerEvent('opencode', {type: 'text', sessionID: 'ses_1', part: {text: 'hello'}});
  assert.equal(text.text, 'hello');
  assert.equal(text.append, true);
  assert.equal(providerEvent('opencode', {type: 'step_finish', part: {reason: 'tool-calls'}}).complete, false);
  assert.equal(providerEvent('opencode', {type: 'step_finish', part: {reason: 'stop'}}).complete, true);
  assert.equal(providerEvent('opencode', {type: 'error', error: {data: {message: 'boom'}}}).failed, true);
});

test('Codex 事件适配保持兼容', () => {
  assert.equal(providerEvent('codex', {type: 'thread.started', thread_id: 'c'}).session, 'c');
  assert.equal(providerEvent('codex', {type: 'turn.completed'}).complete, true);
  assert.equal(providerEvent('codex', {type: 'turn.failed'}).failed, true);
});
