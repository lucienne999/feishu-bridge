import test from 'node:test';
import assert from 'node:assert/strict';
import {DR_INSTALL_URL, INSTALL_HINTS, checkAgentTools, installInternalTools, toolInstalled, withLocalBinPath} from '../src/tools-install.mjs';

test('集中维护 Lark CLI 安装提示并支持安装检测', () => {
  assert.equal(INSTALL_HINTS.lark.installCmd, 'npm install -g @larksuite/cli');
  assert.equal(toolInstalled('lark', {PATH: '/usr/bin'}, {
    exec: (bin) => {
      assert.equal(bin, 'lark-cli');
      return 'lark-cli 1.0.0';
    },
  }), true);
});

test('withLocalBinPath 将 ~/.local/bin 前置到 PATH', () => {
  const env = withLocalBinPath({PATH: '/usr/bin'});
  assert.match(env.PATH, /\.local\/bin:/);
  assert.ok(env.PATH.endsWith('/usr/bin') || env.PATH.includes(':/usr/bin'));
});

test('checkAgentTools 跳过已安装项，未装项仅提示安装方式', () => {
  const installed = new Set(['codex']);
  const {ok, notes} = checkAgentTools({PATH: '/usr/bin'}, {
    installed: (name) => installed.has(name),
  });
  assert.equal(ok, false);
  assert.ok(notes.some(n => /Codex：已安装/.test(n)));
  assert.ok(notes.some(n => /Cursor CLI：未安装；安装：curl -fsSL https:\/\/cursor.com\/install/.test(n)));
  assert.ok(notes.some(n => /Qoder CLI：未安装/.test(n)));
  assert.ok(notes.some(n => /OpenCode：未安装/.test(n)));
});

test('checkAgentTools 全部已装时 ok 为 true 且不产生未装提示', () => {
  const {ok, notes} = checkAgentTools({}, {installed: () => true});
  assert.equal(ok, true);
  assert.equal(notes.length, 4);
  assert.ok(notes.every(n => /已安装/.test(n)));
});

test('withLocalBinPath 包含 OpenCode 默认安装目录', () => {
  const env = withLocalBinPath({PATH: '/usr/bin'});
  assert.match(env.PATH, /\.opencode\/bin/);
});

test('checkAgentTools 存在未装项时 ok 为 false', () => {
  const {ok, notes} = checkAgentTools({}, {
    installed: () => false,
  });
  assert.equal(ok, false);
  assert.ok(notes.every(n => /未安装；安装：/.test(n)));
  assert.ok(notes.some(n => /npm install -g @openai\/codex/.test(n)));
});

test('installInternalTools 安装 dr 后顺序安装两个内部模块', () => {
  const calls = [];
  const logs = [];
  const result = installInternalTools({
    platform: 'linux',
    env: {PATH: '/usr/bin'},
    exec: (bin, args) => {
      calls.push([bin, args]);
      if (bin === 'dr' && args[0] === 'version') {
        const error = new Error('missing');
        error.code = 'ENOENT';
        throw error;
      }
      return 'ok';
    },
    spawn: (bin, args) => {
      calls.push([bin, args]);
      return {status: 0};
    },
    log: (line) => logs.push(line),
  });
  assert.deepEqual(result.modules, ['tjob', 'skillctl']);
  assert.deepEqual(calls[0], ['dr', ['version']]);
  assert.equal(calls[1][0], 'bash');
  assert.match(calls[1][1][1], new RegExp(DR_INSTALL_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.deepEqual(calls.slice(3).map(([, args]) => args), [
    ['module', 'install', 'tjob'],
    ['module', 'install', 'skillctl'],
  ]);
  assert.equal(logs.length, 3);
});

test('installInternalTools Windows 使用 PowerShell 安装脚本', () => {
  const calls = [];
  installInternalTools({
    platform: 'win32',
    env: {Path: 'C:\\Windows\\System32'},
    exec: (bin, args) => {
      if (bin === 'dr' && args[0] === 'version') {
        const error = new Error('missing');
        error.code = 'ENOENT';
        throw error;
      }
      calls.push([bin, args]);
      return 'ok';
    },
    spawn: (bin, args) => {
      calls.push([bin, args]);
      return {status: 0};
    },
    log: () => {},
  });
  assert.equal(calls[0][0], 'powershell.exe');
  assert.equal(calls[0][1][0], '-NoProfile');
  assert.match(calls[0][1][4], /irm .*install\.ps1 \| iex/);
});
