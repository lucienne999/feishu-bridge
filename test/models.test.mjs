import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseModelCommand, resolveModelProvider, parseModelLines,
  listCodexModelsFromCache, formatModelList, assertKnownModel, listModels,
} from '../src/models.mjs';

test('/model 命令：列表、清空、设置与非法名', () => {
  assert.deepEqual(parseModelCommand('/model'), {action: 'list'});
  assert.deepEqual(parseModelCommand('/model clear'), {action: 'clear'});
  assert.deepEqual(parseModelCommand('/model gpt-5.3-codex'), {action: 'set', model: 'gpt-5.3-codex'});
  assert.throws(() => parseModelCommand('/model bad name'), /模型名格式无效/);
  assert.equal(parseModelCommand('/status'), null);
});

test('模型作用在当前执行器，命令模式回落到 defaultMode', () => {
  assert.equal(resolveModelProvider('cursor', 'codex'), 'cursor');
  assert.equal(resolveModelProvider('commands', 'codex'), 'codex');
});

test('解析 Cursor / OpenCode 模型列表行', () => {
  const cursor = parseModelLines('cursor', 'Available models\nauto - Auto (default)\ngpt-5.3-codex - Codex 5.3\n');
  assert.deepEqual(cursor.map(m => m.id), ['auto', 'gpt-5.3-codex']);
  const oc = parseModelLines('opencode', 'opencode/big-pickle\nxai/grok-4.7\n');
  assert.deepEqual(oc.map(m => m.id), ['opencode/big-pickle', 'xai/grok-4.7']);
});

test('Codex 从本地 models_cache 读取，且设置时必须命中列表', () => {
  const models = listCodexModelsFromCache({
    home: '/tmp',
    exists: () => true,
    read: () => JSON.stringify({models: [
      {slug: 'gpt-6-astra', display_name: 'Astra', visibility: 'list'},
      {slug: 'hidden', display_name: 'Hidden', visibility: 'hidden', supported_in_api: false},
    ]}),
  });
  assert.deepEqual(models, [{id: 'gpt-6-astra', label: 'Astra'}]);
  assert.equal(assertKnownModel(models, 'GPT-6-ASTRA'), 'gpt-6-astra');
  assert.throws(() => assertKnownModel(models, 'nope'), /未知模型/);
});

test('列表文案包含当前模型与设置提示', () => {
  const text = formatModelList('cursor', [{id: 'auto', label: 'Auto'}], 'auto', {limit: 10});
  assert.match(text, /Cursor/);
  assert.match(text, /当前模型：auto/);
  assert.match(text, /\/model clear/);
});

test('listModels 在 CLI 失败且无输出时给出可读错误', () => {
  assert.throws(() => listModels('cursor', {
    exec: () => { const e = Error('fail'); e.stdout = ''; e.stderr = ''; throw e; },
  }), /模型列表获取失败/);
});
