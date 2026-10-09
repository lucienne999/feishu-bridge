import test from 'node:test';
import assert from 'node:assert/strict';
import {nodeVersionError} from '../src/check-node.mjs';

test('nodeVersionError 通过 22.13 及以上版本', () => {
  assert.equal(nodeVersionError('22.13.0'), null);
  assert.equal(nodeVersionError('22.14.1'), null);
  assert.equal(nodeVersionError('23.0.0'), null);
  assert.equal(nodeVersionError('24.11.1'), null);
  assert.equal(nodeVersionError('22.13.0-nightly.20250101.abc'), null);
});

test('nodeVersionError 拒绝 22.12 及以下并提示版本要求', () => {
  for (const v of ['12.22.9', '18.20.4', '20.18.0', '22.12.9']) {
    const err = nodeVersionError(v);
    assert.ok(err instanceof Error, v);
    assert.ok(err.message.includes(v), v);
    assert.ok(err.message.includes('22.13'), v);
    assert.ok(err.message.includes('nvm install 22'), v);
    assert.ok(err.message.includes('nvm-sh/nvm'), v);
  }
});

test('nodeVersionError 缺省检查当前运行时', () => {
  assert.equal(nodeVersionError(), null);
});
