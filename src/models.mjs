import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {cursorBinary, qoderBinary, opencodeBinary, providerLabel, AGENT_MODES} from './providers.mjs';

const LIST_LIMIT = 40;

export function parseModelCommand(text) {
  const m = /^\/model(?:\s+(.*))?$/i.exec(String(text || '').trim());
  if (!m) return null;
  const arg = (m[1] || '').trim();
  if (!arg) return {action: 'list'};
  if (/^(clear|default|reset|默认)$/i.test(arg)) return {action: 'clear'};
  if (!/^[\w./:@#+-]+$/.test(arg)) throw Error('模型名格式无效。请先 /model 查看列表，再发送 /model 模型名。');
  return {action: 'set', model: arg};
}

export function resolveModelProvider(mode, defaultMode) {
  return AGENT_MODES.includes(mode) ? mode : defaultMode;
}

export function parseModelLines(provider, out) {
  const lines = String(out || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const models = [];
  const seen = new Set();
  for (const line of lines) {
    if (/^available models$/i.test(line) || /^usage:/i.test(line) || /^error/i.test(line) || /^not logged/i.test(line)) continue;
    let id = '', label = '';
    if (provider === 'opencode') {
      if (!line.includes('/')) continue;
      id = line.split(/\s+/)[0];
      label = id;
    } else {
      const m = /^(\S+)\s+-\s+(.+)$/.exec(line);
      if (m) { id = m[1]; label = m[2]; }
      else if (/^[\w./:@#+-]+$/.test(line)) { id = line; label = line; }
      else continue;
    }
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({id, label});
  }
  return models;
}

export function listCodexModelsFromCache({home = homedir(), read = readFileSync, exists = existsSync} = {}) {
  const path = join(home, '.codex', 'models_cache.json');
  if (!exists(path)) return [];
  let body;
  try { body = JSON.parse(read(path, 'utf8')); }
  catch { return []; }
  const rows = Array.isArray(body?.models) ? body.models : [];
  return rows
    .filter(m => m?.slug && (m.visibility === 'list' || m.supported_in_api !== false))
    .map(m => ({id: String(m.slug), label: String(m.display_name || m.slug)}));
}

export function listModels(provider, {
  exec = execFileSync,
  env = process.env,
  home = homedir(),
  read = readFileSync,
  exists = existsSync,
  timeout = 20000,
} = {}) {
  if (provider === 'codex') {
    const models = listCodexModelsFromCache({home, read, exists});
    if (!models.length) throw Error('未找到 Codex 模型列表。请先在本机运行一次 codex，生成 ~/.codex/models_cache.json。');
    return models;
  }
  let bin, args;
  if (provider === 'cursor') { bin = cursorBinary(); args = ['models']; }
  else if (provider === 'qcoder') { bin = qoderBinary(); args = ['--list-models']; }
  else if (provider === 'opencode') { bin = opencodeBinary(); args = ['models']; }
  else throw Error('不支持的执行器');
  let out = '';
  try {
    out = exec(bin, args, {encoding: 'utf8', env, timeout, stdio: ['ignore', 'pipe', 'pipe']});
  } catch (e) {
    out = String(e.stdout || '') + '\n' + String(e.stderr || '');
    if (!out.trim()) throw Error(`${providerLabel(provider)} 模型列表获取失败：请确认已安装并登录对应 CLI。`);
  }
  const models = parseModelLines(provider, out);
  if (!models.length) throw Error(`${providerLabel(provider)} 未返回可用模型。请确认已登录对应 CLI。`);
  return models;
}

export function formatModelList(provider, models, current, {limit = LIST_LIMIT} = {}) {
  const cur = current ? `当前模型：${current}` : '当前模型：默认（未指定）';
  const head = `执行器：${providerLabel(provider)}\n${cur}\n可用模型${models.length > limit ? `（前 ${limit} / 共 ${models.length}）` : `（${models.length}）`}：`;
  const body = models.slice(0, limit).map(m => m.label && m.label !== m.id ? `${m.id} — ${m.label}` : m.id).join('\n');
  return `${head}\n${body}\n\n发送 /model 模型名 设置；/model clear 恢复默认。`;
}

export function assertKnownModel(models, model) {
  if (models.some(m => m.id === model)) return model;
  const hit = models.find(m => m.id.toLowerCase() === model.toLowerCase());
  if (hit) return hit.id;
  throw Error(`未知模型：${model}\n请先发送 /model 查看可用列表。`);
}
