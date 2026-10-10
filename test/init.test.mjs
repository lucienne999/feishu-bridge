import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseInitArgs,
  botAvailable,
  resolveBot,
  checkPrerequisites,
  init,
} from '../src/init.mjs';

test('parseInitArgs 解析自定义 BOT、跳过配对、全量与 agents', () => {
  assert.deepEqual(parseInitArgs(['--app-id', 'cli_abc', '--app-secret-stdin', '--skip-pair', '--full', '--agents', 'codex,cursor']), {
    appId: 'cli_abc', appSecretStdin: true, skipPair: true, full: true, internal: false, agentsFlag: 'codex,cursor',
  });
  assert.equal(parseInitArgs([]).full, false);
  assert.equal(parseInitArgs([]).agentsFlag, '');
  assert.throws(() => parseInitArgs(['--app-secret-stdin']), /--app-id/);
  assert.throws(() => parseInitArgs(['--agents']), /--agents/);
});

test('init 默认只装 Codex 并做登录；--full 安装全部且可选择登录 Agent', async () => {
  const batches = [];
  const authBatches = [];
  const deps = {
    check: () => ({ok: true, notes: ['Node：可用'], env: {PATH: 'x'}}),
    resolve: () => ({source: 'lark-cli', info: null, status: {appId: 'cli_abc'}}),
    connectFn: () => ({appId: 'cli_abc', eventSubscriptionReady: true}),
    pairFn: async () => {},
    exists: () => true,
    log: () => {},
    ensureAuth: (_agents, _env) => {
      authBatches.push([..._agents]);
      return {ok: true, notes: ['Codex 登录：已就绪，跳过'], agents: _agents};
    },
  };
  await init('/root', {PATH: 'x'}, {skipPair: true}, {
    ...deps,
    checkTools: (_env, opts) => {
      batches.push(opts.names);
      return {env: {PATH: 'x'}, notes: ['Codex：已安装，跳过'], ok: true};
    },
    pickAuthAgents: async () => ['codex'],
  });
  await init('/root', {PATH: 'x'}, {full: true, skipPair: true, agentsFlag: 'cursor,qoder'}, {
    ...deps,
    checkTools: (_env, opts) => {
      batches.push(opts.names);
      return {env: {PATH: 'x'}, notes: ['Codex：安装成功'], ok: true};
    },
    pickAuthAgents: async ({agentsFlag}) => agentsFlag.split(','),
  });
  assert.deepEqual(batches, [
    ['codex'],
    ['codex', 'cursor', 'qoder', 'opencode'],
  ]);
  assert.deepEqual(authBatches, [
    ['codex'],
    ['cursor', 'qoder'],
  ]);
});

test('botAvailable 要求飞书品牌、应用 ID 与机器人身份', () => {
  assert.equal(botAvailable({
    appId: 'cli_abc', brand: 'feishu', identities: {bot: {available: true}},
  }), true);
  assert.equal(botAvailable({
    appId: 'cli_abc', brand: 'lark', identities: {bot: {available: true}},
  }), false);
  assert.equal(botAvailable({appId: 'cli_abc', brand: 'feishu', identities: {}}), false);
});

test('未指定 BOT 时复用 Lark CLI 已配置机器人', () => {
  const status = {appId: 'cli_abc123', brand: 'feishu', identities: {bot: {available: true}}};
  const result = resolveBot('/root', {}, {}, {
    readStatus: () => status,
    switchBotFn: () => { throw Error('不应写入自定义 BOT'); },
    assertStopped: () => {},
  });
  assert.equal(result.source, 'lark-cli');
  assert.equal(result.status.appId, 'cli_abc123');
});

test('指定 App ID/Secret 时写入自定义 BOT', () => {
  let switched = null;
  const result = resolveBot('/root', {PATH: 'x'}, {appId: 'cli_custom', appSecret: 'secretsecret'}, {
    readStatus: () => ({appId: 'cli_custom', brand: 'feishu', identities: {bot: {available: true}}}),
    switchBotFn: (_r, _e, cred) => {
      switched = cred;
      return {appId: 'cli_custom', botName: 'Custom'};
    },
    assertStopped: () => {},
  });
  assert.equal(result.source, 'custom');
  assert.deepEqual(switched, {appId: 'cli_custom', appSecret: 'secretsecret'});
  assert.equal(result.info.botName, 'Custom');
});

test('Lark CLI 无 BOT 时标记 missing', () => {
  const result = resolveBot('/root', {}, {}, {
    readStatus: () => null,
    switchBotFn: () => { throw Error('no'); },
    assertStopped: () => {},
  });
  assert.equal(result.source, 'missing');
});

test('checkPrerequisites 在 Lark CLI 缺失时失败', () => {
  const result = checkPrerequisites('/root', {}, {
    cursorBin: () => 'cursor-agent',
    loggedIn: () => true,
    exec: (bin) => {
      if (bin === 'lark-cli') { const e = Error('missing'); e.code = 'ENOENT'; throw e; }
      return 'ok';
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.notes.some(n => n.includes('Lark CLI') && n.includes('npm install -g @larksuite/cli')));
});

test('init 复用 Lark CLI BOT、完成 connect，已有配置时跳过配对', async () => {
  const logs = [];
  let paired = false;
  const status = {appId: 'cli_abc', brand: 'feishu', identities: {bot: {available: true}}};
  const connection = {appId: 'cli_abc', botName: 'Bridge', eventSubscriptionReady: true};
  await init('/root', {}, {skipPair: false}, {
    checkTools: () => ({env: {}, notes: ['Codex：已安装，跳过'], ok: true}),
    ensureAuth: () => ({ok: true, notes: ['Codex 登录：已就绪，跳过'], agents: ['codex']}),
    pickAuthAgents: async () => ['codex'],
    check: () => ({ok: true, notes: ['Node：可用', 'Lark CLI：可用']}),
    resolve: () => ({source: 'lark-cli', info: null, status}),
    connectFn: () => connection,
    pairFn: async () => { paired = true; },
    exists: (p) => p.endsWith('config.json'),
    log: (m) => logs.push(m),
  });
  assert.equal(paired, false);
  assert.ok(logs.some(l => /Lark CLI 已配置/.test(l)));
  assert.ok(logs.some(l => /跳过配对/.test(l)));
});

test('init 无 BOT 且非交互时给出明确指引', async () => {
  await assert.rejects(
    () => init('/root', {}, {}, {
      checkTools: () => ({env: {}, notes: ['Codex：已安装，跳过'], ok: true}),
      ensureAuth: () => ({ok: true, notes: [], agents: ['codex']}),
      pickAuthAgents: async () => ['codex'],
      check: () => ({ok: true, notes: []}),
      resolve: () => ({source: 'missing', info: null, status: null}),
      connectFn: () => { throw Error('no'); },
      pairFn: async () => {},
      exists: () => false,
      log: () => {},
    }),
    /飞书机器人未配置/,
  );
});
