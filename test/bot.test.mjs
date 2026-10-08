import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBotCredentials, assertServiceStopped, switchBot} from '../src/bot.mjs';

test('只接受 App ID 与 App Secret，格式校验失败时拒绝', () => {
  assert.deepEqual(parseBotCredentials(' cli_abc123 ', ' secretsecret '), {appId: 'cli_abc123', appSecret: 'secretsecret'});
  assert.throws(() => parseBotCredentials('bad', 'secretsecret'), /App ID/);
  assert.throws(() => parseBotCredentials('cli_abc', 'short'), /App Secret/);
});

test('本地服务运行中时拒绝换机器人', () => {
  assert.throws(
    () => assertServiceStopped('/tmp', {exists: () => true, read: () => '12345', kill: () => {}}),
    /仍在运行/,
  );
  assert.doesNotThrow(() => assertServiceStopped('/tmp', {
    exists: () => true, read: () => '12345', kill: () => { const e = Error('gone'); e.code = 'ESRCH'; throw e; },
  }));
});

test('换机器人写入 CLI 配置、清除白名单，并刷新入口；不落盘 Secret', () => {
  const calls = [];
  const unlinked = [];
  const info = switchBot('/root', {PATH: 'x'}, {appId: 'cli_newapp', appSecret: 'supersecret'}, {
    assertStopped: () => {},
    exists: (p) => p.endsWith('config.json'),
    unlink: (p) => unlinked.push(p),
    connectFn: (_root, _env, opts) => {
      assert.equal(opts?.brief, true);
      return {appId: 'cli_newapp', botOpenId: 'ou_bot', botName: 'New'};
    },
    exec: (bin, args, opts) => {
      calls.push({bin, args, input: opts?.input});
      if (args[0] === 'auth') return JSON.stringify({appId: 'cli_newapp', identities: {bot: {available: true}}});
      return 'OK';
    },
  });
  assert.equal(info.botName, 'New');
  assert.ok(calls.some(c => c.args.includes('--app-secret-stdin') && c.input.includes('supersecret')));
  assert.deepEqual(unlinked, ['/root/config.json']);
  assert.ok(!JSON.stringify(info).includes('supersecret'));
});
