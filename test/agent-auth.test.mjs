import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAgentsFlag,
  ensureAgentAuth,
  resolveAuthAgents,
} from '../src/agent-auth.mjs';

test('parseAgentsFlag 支持编号、名称与全部', () => {
  assert.deepEqual(parseAgentsFlag('all'), ['codex', 'cursor', 'qoder', 'opencode']);
  assert.deepEqual(parseAgentsFlag('1,3'), ['codex', 'qoder']);
  assert.deepEqual(parseAgentsFlag('codex, cursor'), ['codex', 'cursor']);
  assert.throws(() => parseAgentsFlag('foo'), /未知 Agent/);
});

test('ensureAgentAuth 已登录则跳过，未登录则触发 login', () => {
  const logged = new Set(['codex']);
  const logins = [];
  const {ok, notes} = ensureAgentAuth(['codex', 'cursor'], {}, {
    loggedIn: (name) => logged.has(name),
    login: (name) => {
      logins.push(name);
      logged.add(name);
    },
    log: () => {},
  });
  assert.equal(ok, true);
  assert.deepEqual(logins, ['cursor']);
  assert.ok(notes.some(n => /Codex 登录：已就绪/.test(n)));
  assert.ok(notes.some(n => /Cursor 登录：成功/.test(n)));
});

test('ensureAgentAuth 登录后仍失败则 ok=false', () => {
  const {ok} = ensureAgentAuth(['codex'], {}, {
    loggedIn: () => false,
    login: () => {},
    log: () => {},
  });
  assert.equal(ok, false);
});

test('resolveAuthAgents：默认只选 Codex；full 可交互或多选', async () => {
  assert.deepEqual(await resolveAuthAgents({full: false}), ['codex']);
  assert.deepEqual(await resolveAuthAgents({full: true, agentsFlag: '2,4'}), ['cursor', 'opencode']);
  assert.deepEqual(
    await resolveAuthAgents({full: true}, {ask: async () => 'codex', log: () => {}}),
    ['codex'],
  );
  assert.deepEqual(
    await resolveAuthAgents({full: true}, {ask: async () => '', log: () => {}}),
    ['codex', 'cursor', 'qoder', 'opencode'],
  );
});
