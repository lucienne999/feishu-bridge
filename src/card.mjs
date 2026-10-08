import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const SOFT_LIMIT = 24000;
const MD_LIMIT = 3500;
const TITLE_LIMIT = 40;
const SUMMARY_LIMIT = 80;
const CELL_LIMIT = 80;
const HEADER_LIMIT = 20;
const MAX_TABLE_ROWS = 50;
const MAX_TABLE_COLS = 4;
const MAX_IMAGES = 3;
const MAX_TOOLS = 16;
const MAX_LINKS = 8;
const MAX_URL_BUTTONS = 4;

const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'message-templates', 'agent-card');

/** Load canonical example/skeleton from src/message-templates/agent-card. */
export function loadTemplate(name) {
  return structuredClone(JSON.parse(readFileSync(join(TEMPLATE_DIR, `${name}.json`), 'utf8')));
}

export function clip(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  return t.slice(0, Math.max(0, n - 1)) + '…';
}

export function stripMarkdown(s) {
  return String(s || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~>#-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Conclusion title: prefer first # heading, else first non-meta sentence. */
export function conclusionTitle(text) {
  const lines = String(text || '').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^\|/.test(line) || /^[-:| ]+$/.test(line)) continue;
    if (/^\*{0,2}结论\*{0,2}\s*[:：]?$/.test(line)) continue;
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) return clip(stripMarkdown(heading[1]), TITLE_LIMIT);
    const plain = stripMarkdown(line);
    if (plain) return clip(plain, TITLE_LIMIT);
  }
  return '完成';
}

export function firstSummary(text) {
  return clip(conclusionTitle(text), SUMMARY_LIMIT);
}

function isPipeTableLine(line) {
  return /^\s*\|.+\|\s*$/.test(line);
}
function isPipeSep(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

/** Split agent body into markdown / table segments. */
export function parseSegments(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const segments = [];
  let buf = [];
  const flushMd = () => {
    const content = buf.join('\n').trim();
    buf = [];
    if (content) segments.push({type: 'markdown', content});
  };
  for (let i = 0; i < lines.length;) {
    if (isPipeTableLine(lines[i]) && i + 1 < lines.length && isPipeSep(lines[i + 1])) {
      flushMd();
      const table = [lines[i], lines[i + 1]];
      i += 2;
      while (i < lines.length && isPipeTableLine(lines[i])) {
        table.push(lines[i]);
        i += 1;
      }
      segments.push({type: 'table', content: table.join('\n')});
      continue;
    }
    buf.push(lines[i]);
    i += 1;
  }
  flushMd();
  return segments.length ? segments : [{type: 'markdown', content: String(text || '').trim() || '（无文字结果）'}];
}

function splitCells(line) {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return t.split('|').map(c => clip(c.trim(), CELL_LIMIT));
}

function rebuildWideTables(headers, normalized, idBase) {
  const width = headers.length;
  const elements = [];
  let start = 0;
  let part = 0;
  while (start < width) {
    const idxs = start === 0
      ? Array.from({length: Math.min(MAX_TABLE_COLS, width)}, (_, i) => i)
      : [0, ...Array.from({length: Math.min(MAX_TABLE_COLS - 1, width - start)}, (_, i) => start + i)];
    const element_id = (part === 0 ? idBase : `${idBase}p${part}`).slice(0, 20);
    elements.push({
      tag: 'table',
      element_id,
      page_size: 5,
      row_height: 'low',
      freeze_first_column: true,
      header_style: {background_style: 'grey', bold: true, text_align: 'left'},
      columns: idxs.map((src, i) => ({
        name: `c${i}`,
        display_name: headers[src] || `列${src + 1}`,
        width: i === 0 ? '120px' : 'auto',
        data_type: 'text',
        horizontal_align: 'left'
      })),
      rows: normalized.map(r => Object.fromEntries(idxs.map((src, i) => [`c${i}`, r[src] || ''])))
    });
    if (start === 0) start = idxs.length;
    else start += idxs.length - 1;
    part += 1;
    if (idxs.length <= 1) break;
  }
  return elements;
}

export function pipeTableToElements(md, idBase = 'el_t0') {
  const rows = String(md).trim().split('\n').filter(Boolean);
  if (rows.length < 2) return [{tag: 'markdown', element_id: idBase, content: md, text_align: 'left', margin: '0px 0px 4px 0px'}];
  const headers = splitCells(rows[0]).map(h => clip(h || '列', HEADER_LIMIT));
  const data = rows.slice(2, 2 + MAX_TABLE_ROWS).map(splitCells);
  const width = Math.max(headers.length, ...data.map(r => r.length), 1);
  while (headers.length < width) headers.push(`列${headers.length + 1}`);
  const normalized = data.map(r => {
    const out = r.slice(0, width);
    while (out.length < width) out.push('');
    return out;
  });
  return rebuildWideTables(headers, normalized, idBase);
}

function mdBlock(id, content, margin = '0px 0px 4px 0px') {
  return {tag: 'markdown', element_id: id, content: content || ' ', text_align: 'left', margin};
}

function chunkMarkdown(text, limit = MD_LIMIT) {
  const s = String(text || '');
  if (s.length <= limit) return [s];
  const parts = [];
  let rest = s;
  while (rest.length > limit && parts.length < 9) {
    let cut = rest.lastIndexOf('\n\n', limit);
    if (cut < limit * 0.4) cut = rest.lastIndexOf('\n', limit);
    if (cut < limit * 0.4) cut = limit;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest.slice(0, limit));
  return parts.filter(Boolean);
}

function processMarkdown(steps, max = 50) {
  const list = (steps || []).map(s => String(s).trim()).filter(Boolean);
  const kept = list.slice(-max);
  const omitted = list.length - kept.length;
  const body = kept.map(s => `- ${s.replace(/^\s*-\s*/, '')}`).join('\n');
  return omitted > 0 ? `**过程**\n\n更早 ${omitted} 条省略\n${body}` : `**过程**\n\n${body || '- （无过程记录）'}`;
}

function header(title, subtitle, template, tagText, tagColor) {
  return {
    title: {tag: 'plain_text', content: clip(title, TITLE_LIMIT) || '任务'},
    subtitle: {tag: 'plain_text', content: clip(subtitle, TITLE_LIMIT)},
    template,
    text_tag_list: [{tag: 'text_tag', text: {tag: 'plain_text', content: tagText}, color: tagColor}]
  };
}

function footer(parts) {
  return mdBlock('el_foot', `<font color='grey'>${parts.filter(Boolean).join(' · ')}</font>`, '8px 0px 0px 0px');
}

function collapsible(id, title, innerId, content) {
  return {
    tag: 'collapsible_panel',
    element_id: id,
    expanded: false,
    header: {
      title: {tag: 'markdown', content: title},
      vertical_align: 'center',
      icon: {tag: 'standard_icon', token: 'down-small-ccm_outlined'},
      icon_position: 'right',
      icon_expanded_angle: -180
    },
    border: {color: 'grey', corner_radius: '6px'},
    padding: '8px 8px 8px 8px',
    elements: [mdBlock(innerId, content)]
  };
}

/** Extract https links from agent text (markdown + bare URLs), max 8. */
export function extractLinks(text) {
  const found = [];
  const push = (u) => {
    const url = String(u || '').replace(/[),.;]+$/, '');
    if (/^https?:\/\//i.test(url) && !found.includes(url)) found.push(url);
  };
  for (const m of String(text || '').matchAll(/\[[^\]]*]\((https?:\/\/[^)\s]+)\)/gi)) push(m[1]);
  for (const m of String(text || '').matchAll(/https?:\/\/[^\s|<)>\]"']+/gi)) push(m[0]);
  return found.slice(0, MAX_LINKS);
}

/** Format evidence panel like the final.json template. */
export function formatEvidence({tools = [], links = []} = {}) {
  const toolLines = tools.map(t => String(t).trim()).filter(Boolean).slice(0, MAX_TOOLS);
  const linkLines = links.map(l => String(l).trim()).filter(Boolean).slice(0, MAX_LINKS);
  if (!toolLines.length && !linkLines.length) return '';
  const parts = [];
  if (toolLines.length) parts.push('**工具**\n' + toolLines.map(t => `- ${t}`).join('\n'));
  if (linkLines.length) parts.push('**链接**\n' + linkLines.map(l => `- ${l}`).join('\n'));
  return parts.join('\n\n');
}

function imageElements(images = []) {
  return images
    .map(k => String(k || '').trim())
    .filter(k => /^img_/.test(k))
    .slice(0, MAX_IMAGES)
    .map((img_key, i) => ({
      tag: 'img',
      element_id: `el_img${i}`,
      img_key,
      preview: true,
      scale_type: 'fit_horizontal',
      corner_radius: '8px'
    }));
}

function actionButtons({links = []} = {}) {
  // New-session is /new in chat (keeps executor mode). No card callback button.
  const columns = [];
  for (const item of links.slice(0, MAX_URL_BUTTONS)) {
    const url = typeof item === 'string' ? item : item?.url;
    const label = typeof item === 'string' ? clip(item.replace(/^https?:\/\//, ''), 12) : clip(item?.label || '链接', 12);
    if (!/^https?:\/\//i.test(url || '')) continue;
    columns.push({
      tag: 'column',
      width: 'auto',
      elements: [{
        tag: 'button',
        text: {tag: 'plain_text', content: label || '打开'},
        type: 'primary',
        width: 'default',
        behaviors: [{type: 'open_url', default_url: url}]
      }]
    });
  }
  if (!columns.length) return null;
  return {tag: 'column_set', flex_mode: 'flow', background_style: 'default', columns};
}

function conclusionElements(result) {
  const segments = parseSegments(result);
  const elements = [];
  let mdIndex = 0;
  let tableIndex = 0;
  let mdBlocks = 0;
  for (const seg of segments) {
    if (seg.type === 'table') {
      elements.push(...pipeTableToElements(seg.content, `el_t${tableIndex++}`));
      continue;
    }
    const chunks = chunkMarkdown(seg.content);
    for (let i = 0; i < chunks.length; i++) {
      const id = `el_b${mdIndex++}`.slice(0, 20);
      const prefix = mdBlocks === 0 && i === 0 && !/^\*{0,2}结论\*{0,2}/.test(chunks[i].trim())
        ? `**结论**\n\n${chunks[i]}`
        : chunks[i];
      if (mdBlocks < 2) elements.push(mdBlock(id, prefix));
      else elements.push(collapsible(`el_bx${mdIndex}`.slice(0, 20), `**结论续 ${mdBlocks - 1}**`, id, prefix));
      mdBlocks += 1;
      if (mdBlocks >= 10) break;
    }
    if (mdBlocks >= 10) break;
  }
  if (!elements.length) elements.push(mdBlock('el_b0', '**结论**\n\n执行结束，未返回文字结果。'));
  return elements;
}

export function buildStreamCard({question, subtitle = '正在执行', process = [], draft = '正在处理…', label = 'Agent'} = {}) {
  const base = loadTemplate('stream');
  const q = clip(question, TITLE_LIMIT) || '任务';
  base.config.summary = {content: clip(`处理中 · ${q}`, SUMMARY_LIMIT)};
  base.header = header(q, subtitle, 'blue', '处理中', 'blue');
  base.body.elements = [
    mdBlock('el_sub', `<font color='grey'>${clip(subtitle, 80)}</font>`),
    mdBlock('el_proc', processMarkdown(process)),
    mdBlock('el_body', `**结论**\n\n${draft}`),
    mdBlock('el_evi', ' '),
    footer([label, '处理中'])
  ];
  return base;
}

/**
 * Final card order matches final.json:
 * 结论(+表) → 图 → 过程折叠 → 依据折叠 → 可选链接按钮 → 底栏
 */
export function buildFinalCard({
  question, result, process = [], label = 'Agent', seconds,
  tools = [], links, images = [], urlButtons = []
} = {}) {
  const base = loadTemplate('final');
  const title = conclusionTitle(result);
  const q = clip(question, TITLE_LIMIT) || '任务';
  const autoLinks = links ?? extractLinks(result);
  const evidence = formatEvidence({tools, links: autoLinks});
  const elements = [
    ...conclusionElements(result || '执行结束，未返回文字结果。'),
    ...imageElements(images),
    collapsible('el_proc_box', `**过程 · ${Math.max((process || []).length, 1)} 步**`, 'el_proc', processMarkdown(process)),
  ];
  if (evidence) elements.push(collapsible('el_panel', '**依据**', 'el_evi', evidence));
  const buttons = actionButtons({links: urlButtons});
  if (buttons) elements.push(buttons);
  const sec = Number.isFinite(seconds) ? `${Math.max(0, Math.round(seconds))}s` : undefined;
  elements.push(footer([label, sec, '完成']));
  base.config = {update_multi: true, width_mode: base.config.width_mode || 'fill', summary: {content: firstSummary(result)}};
  base.header = header(title, q, 'green', '完成', 'green');
  base.body = {direction: 'vertical', padding: '12px 12px 12px 12px', elements};
  return fitCard(base);
}

export function buildStoppedCard({question, reason = '任务已中断', label = 'Agent'} = {}) {
  const base = loadTemplate('stopped');
  const q = clip(question, TITLE_LIMIT) || '任务';
  base.config.summary = {content: '已停止'};
  base.header = header(q, '任务已中断', 'orange', '已停止', 'orange');
  base.body.elements = [
    mdBlock('el_b0', `**结论**\n\n（已停止：${clip(reason, 200)}）`),
    footer([label, '已停止'])
  ];
  return base;
}

export function buildErrorCard({question, message, label = 'Agent'} = {}) {
  const base = loadTemplate('error');
  const q = clip(question, TITLE_LIMIT) || '任务';
  base.config.summary = {content: clip(message || '出错', SUMMARY_LIMIT)};
  base.header = header(q, '执行失败', 'red', '出错', 'red');
  base.body.elements = [
    mdBlock('el_b0', `**结论**\n\n${clip(message || '未能完成调用', MD_LIMIT)}`),
    footer([label, '出错'])
  ];
  return base;
}

function cardBytes(card) {
  return Buffer.byteLength(JSON.stringify(card), 'utf8');
}

function tablesToMarkdown(elements) {
  return elements.flatMap(el => {
    if (el.tag !== 'table') return [el];
    const headers = el.columns.map(c => c.display_name);
    const lines = [
      `| ${headers.join(' | ')} |`,
      `| ${headers.map(() => '---').join(' | ')} |`,
      ...el.rows.map(r => `| ${el.columns.map(c => r[c.name] || '').join(' | ')} |`)
    ];
    return [mdBlock(el.element_id, lines.join('\n'))];
  });
}

function trimProcessInElements(elements, keep) {
  return elements.map(el => {
    if (el.element_id === 'el_proc_box' && el.elements?.[0]) {
      const inner = el.elements[0];
      const lines = String(inner.content || '').split('\n').filter(l => l.startsWith('- '));
      const kept = lines.slice(-keep);
      const content = `**过程**\n\n${kept.join('\n') || '- （已压缩）'}`;
      return {...el, header: {...el.header, title: {tag: 'markdown', content: `**过程 · ${kept.length} 步**`}}, elements: [{...inner, content}]};
    }
    if (el.element_id === 'el_proc' && el.tag === 'markdown') {
      const lines = String(el.content || '').split('\n').filter(l => l.startsWith('- '));
      return {...el, content: `**过程**\n\n${lines.slice(-keep).join('\n') || '- （已压缩）'}`};
    }
    return el;
  });
}

/** Shrink card under soft 24KB limit per agent-card diet order. */
export function fitCard(card) {
  let out = structuredClone(card);
  if (cardBytes(out) <= SOFT_LIMIT) return out;
  out.body.elements = out.body.elements.filter(el => el.element_id !== 'el_panel');
  out.body.elements = trimProcessInElements(out.body.elements, 8);
  if (cardBytes(out) <= SOFT_LIMIT) return out;
  out.body.elements = tablesToMarkdown(out.body.elements);
  out.body.elements = trimProcessInElements(out.body.elements, 4);
  if (cardBytes(out) <= SOFT_LIMIT) return out;
  out.body.elements = out.body.elements.filter(el => el.tag !== 'column_set' && el.tag !== 'button' && !String(el.element_id || '').startsWith('el_img'));
  out.body.elements = trimProcessInElements(out.body.elements, 2);
  if (cardBytes(out) <= SOFT_LIMIT) return out;
  return buildStoppedCard({
    question: out.header?.subtitle?.content || out.header?.title?.content,
    reason: '结果过长，请缩小问题后重发'
  });
}

export function cardJson(card) {
  return JSON.stringify(fitCard(card));
}
