import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureAgentTools, withLocalBinPath} from '../src/tools-install.mjs';

test('withLocalBinPath 将 ~/.local/bin 前置到 PATH', () => {
  const env = withLocalBinPath({PATH: '/usr/bin'});
  assert.match(env.PATH, /\.local\/bin:/);
  assert.ok(env.PATH.endsWith('/usr/bin') || env.PATH.includes(':/usr/bin'));
});

test('ensureAgentTools 跳过已安装项，只安装缺失项', () => {
  const installed = new Set(['codex']);
  const urls = [];
  const logs = [];
  const {ok, notes} = ensureAgentTools({PATH: '/usr/bin'}, {
    log: (m) => logs.push(m),
    installed: (name) => installed.has(name),
    install: (url) => {
      urls.push(url);
      if (url.includes('cursor.com')) installed.add('cursor');
      if (url.includes('qoder.com')) installed.add('qcoder');
      if (url.includes('opencode.ai')) installed.add('opencode');
    },
  });
  assert.equal(ok, true);
  assert.deepEqual(urls, [
    'https://cursor.com/install',
    'https://qoder.com/install',
    'https://opencode.ai/v2/install',
  ]);
  assert.ok(notes.some(n => /Codex：已安装/.test(n)));
  assert.ok(logs.some(l => /Cursor CLI/.test(l)));
});

test('withLocalBinPath 包含 OpenCode 默认安装目录', () => {
  const env = withLocalBinPath({PATH: '/usr/bin'});
  assert.match(env.PATH, /\.opencode\/bin/);
});

test('ensureAgentTools 安装失败时 ok 为 false', () => {
  const {ok, notes} = ensureAgentTools({}, {
    log: () => {},
    installed: () => false,
    install: () => { throw Error('network'); },
  });
  assert.equal(ok, false);
  assert.ok(notes.every(n => /安装失败/.test(n)));
});
