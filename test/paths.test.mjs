import assert from 'node:assert/strict';
import {join} from 'node:path';
import test from 'node:test';
import {ensureDataLayout, resolveDataRoot} from '../src/paths.mjs';

test('resolveDataRoot prefers FEISHU_BRIDGE_HOME', () => {
  assert.equal(
    resolveDataRoot('/pkg', {env: {FEISHU_BRIDGE_HOME: '/custom/data'}, home: '/Users/x', exists: () => false}),
    '/custom/data',
  );
});

test('resolveDataRoot keeps local clone when config already present', () => {
  assert.equal(
    resolveDataRoot('/pkg', {
      env: {},
      home: '/Users/x',
      exists: (p) => p === join('/pkg', 'config.json'),
    }),
    '/pkg',
  );
});

test('resolveDataRoot defaults to ~/.feishu-bridge for fresh npx', () => {
  assert.equal(
    resolveDataRoot('/npm/_npx/cache/pkg', {env: {}, home: '/Users/x', exists: () => false}),
    join('/Users/x', '.feishu-bridge'),
  );
});

test('ensureDataLayout seeds demo README from package', () => {
  const made = [];
  const copied = [];
  const {demoDir} = ensureDataLayout('/data', '/pkg', {
    mkdir: (p) => { made.push(p); },
    exists: (p) => p === join('/pkg', 'demo', 'README.md'),
    copyFile: (from, to) => { copied.push([from, to]); },
  });
  assert.equal(demoDir, join('/data', 'demo'));
  assert.ok(made.includes('/data'));
  assert.deepEqual(copied, [[join('/pkg', 'demo', 'README.md'), join('/data', 'demo', 'README.md')]]);
});
