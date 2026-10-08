import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  clip, conclusionTitle, parseSegments, pipeTableToElements, extractLinks, formatEvidence,
  loadTemplate, buildStreamCard, buildFinalCard, buildStoppedCard, buildErrorCard, fitCard, cardJson
} from '../src/card.mjs';

const templateDir = join(dirname(fileURLToPath(import.meta.url)), '../src/message-templates/agent-card');

test('模板目录包含四种状态 JSON', () => {
  for (const name of ['stream', 'final', 'stopped', 'error']) {
    assert.ok(existsSync(join(templateDir, `${name}.json`)), name);
    const t = loadTemplate(name);
    assert.equal(t.schema, '2.0');
    assert.equal(t.config.update_multi, true);
  }
});

test('结论标题优先取一级标题，否则取首句', () => {
  assert.equal(conclusionTitle('# 配置结论\n\n细节'), '配置结论');
  assert.equal(conclusionTitle('**结论**\n\n三阶段共用 configs'), '三阶段共用 configs');
  assert.ok(clip('abcdefghijklmnopqrstuvwxyz0123456789EXTRA', 10).endsWith('…'));
});

test('管道表与 markdown 交替切开，宽表按首列拆分', () => {
  const md = [
    '说明一段',
    '',
    '| 项 | A | B | C | D | E |',
    '| --- | --- | --- | --- | --- | --- |',
    '| x | 1 | 2 | 3 | 4 | 5 |',
    '',
    '结尾'
  ].join('\n');
  const segs = parseSegments(md);
  assert.equal(segs[0].type, 'markdown');
  assert.equal(segs[1].type, 'table');
  assert.equal(segs[2].type, 'markdown');
  const tables = pipeTableToElements(segs[1].content, 'el_t0');
  assert.ok(tables.length >= 2);
  assert.equal(tables[0].tag, 'table');
  assert.equal(tables[0].columns.length, 4);
  assert.equal(tables[1].columns[0].display_name, '项');
});

test('终卡顺序对齐 final.json：结论/表 → 图 → 过程 → 依据 → 可选链接按钮 → 底栏', () => {
  const final = buildFinalCard({
    question: 'stage1 / stage2 训练配置比较',
    result: '**结论**\n\nSFT 和 Stage2 Pre 是同一份 cfg\n\n| 项 | Stage1 |\n| --- | --- |\n| epoch | 1 |\n\n详见 https://open.feishu.cn/document/feishu-cards/card-json-v2-structure',
    process: ['读了三份入口脚本', '对照 variants'],
    tools: ['read variants.py'],
    images: ['img_v3_demo'],
    urlButtons: ['https://open.feishu.cn/document/feishu-cards/card-json-v2-structure'],
    label: 'Codex',
    seconds: 48
  });
  const ids = final.body.elements.map(el => el.element_id || el.tag);
  assert.ok(ids.includes('el_b0'));
  assert.ok(final.body.elements.some(el => el.tag === 'table'));
  assert.ok(ids.includes('el_img0'));
  assert.ok(ids.includes('el_proc_box'));
  assert.ok(ids.includes('el_panel'));
  assert.ok(final.body.elements.some(el => el.tag === 'column_set'));
  assert.ok(!JSON.stringify(final).includes('新会话'));
  assert.ok(ids.includes('el_foot'));
  const order = ['el_b0', 'table', 'el_img0', 'el_proc_box', 'el_panel', 'column_set', 'el_foot'];
  let at = -1;
  for (const key of order) {
    const idx = final.body.elements.findIndex(el => el.element_id === key || el.tag === key);
    assert.ok(idx > at, key);
    at = idx;
  }
  assert.equal(final.header.template, 'green');
  assert.deepEqual(extractLinks('见 [文档](https://open.feishu.cn/x) 与 https://example.com/a'), [
    'https://open.feishu.cn/x',
    'https://example.com/a'
  ]);
  assert.match(formatEvidence({tools: ['read a'], links: ['https://example.com']}), /\*\*工具\*\*/);
  assert.match(formatEvidence({tools: ['read a'], links: ['https://example.com']}), /\*\*链接\*\*/);
  const panel = final.body.elements.find(el => el.element_id === 'el_panel');
  assert.match(panel.elements[0].content, /variants\.py/);
  assert.match(panel.elements[0].content, /open\.feishu\.cn/);
});

test('处理中 / 停止 / 出错卡从模板骨架生成', () => {
  const stream = buildStreamCard({question: 'q', subtitle: '读脚本', process: ['a'], label: 'Codex'});
  assert.equal(stream.config.streaming_mode, true);
  assert.equal(stream.header.template, 'blue');
  assert.equal(buildStoppedCard({question: 'q'}).header.template, 'orange');
  assert.equal(buildErrorCard({question: 'q', message: '网络不可用'}).header.template, 'red');
});

test('超大卡会按规范减肥，最终不超过软上限', () => {
  const huge = '字'.repeat(20000);
  const card = buildFinalCard({question: '大结果', result: huge, process: Array.from({length: 40}, (_, i) => `step ${i}`), label: 'Cursor', seconds: 1});
  assert.ok(Buffer.byteLength(cardJson(card), 'utf8') <= 24000);
  assert.equal(fitCard(card).schema, '2.0');
});
