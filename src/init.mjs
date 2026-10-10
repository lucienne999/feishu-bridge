import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {connect} from './connect.mjs';
import {pair} from './pair.mjs';
import {assertServiceStopped, switchBot} from './bot.mjs';
import {cursorBinary, qoderBinary, opencodeBinary, providerLabel} from './providers.mjs';
import {INSTALL_HINTS, checkAgentTools, installInternalTools, withLocalBinPath} from './tools-install.mjs';
import {ensureAgentAuth, resolveAuthAgents, agentLoggedIn, AUTH_AGENTS} from './agent-auth.mjs';
import {nodeVersionError} from './check-node.mjs';

export function parseInitArgs(argv) {
  const args = [...argv];
  const idFlag = args.indexOf('--app-id');
  const appId = idFlag >= 0 ? String(args[idFlag + 1] || '').trim() : '';
  const agentsFlagIndex = args.indexOf('--agents');
  const agentsFlag = agentsFlagIndex >= 0 ? String(args[agentsFlagIndex + 1] || '').trim() : '';
  const appSecretStdin = args.includes('--app-secret-stdin');
  const skipPair = args.includes('--skip-pair');
  const full = args.includes('--full');
  const internal = args.includes('--internal');
  if (appSecretStdin && !appId) throw Error('使用 --app-secret-stdin 时需同时提供 --app-id。');
  if (agentsFlagIndex >= 0 && !agentsFlag) throw Error('使用 --agents 时需提供值，例如 --agents codex,cursor 或 --agents all。');
  return {appId, appSecretStdin, skipPair, full, internal, agentsFlag};
}

export function readAuthStatus(root, env, {
  exec = execFileSync,
} = {}) {
  try {
    return JSON.parse(exec('lark-cli', ['auth', 'status', '--json'], {
      cwd: root, env, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'],
    }));
  } catch {
    return null;
  }
}

export function botAvailable(status) {
  return Boolean(status?.identities?.bot?.available && /^cli_[a-zA-Z0-9]+$/.test(status.appId || '') && status.brand === 'feishu');
}

export function checkPrerequisites(root, env, {
  exec = execFileSync,
  cursorBin = cursorBinary,
  qoderBin = qoderBinary,
  opencodeBin = opencodeBinary,
  requireOptionalAgents = false,
  requireLoginFor = ['codex'],
  loggedIn = agentLoggedIn,
} = {}) {
  const notes = [];
  let ok = true;
  const e = withLocalBinPath(env);
  const loginSet = new Set(requireLoginFor);
  const check = (label, fn, {optional = false} = {}) => {
    try {
      fn();
      notes.push(`${label}：可用`);
    } catch (err) {
      if (!optional) ok = false;
      notes.push(`${label}：${err.message || '检查失败'}${optional ? '（可选）' : ''}`);
    }
  };
  check('Node', () => {
    const err = nodeVersionError();
    if (err) throw err;
  });
  check('Lark CLI', () => {
    try { exec('lark-cli', ['--version'], {cwd: root, env: e, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe']}); }
    catch (err) {
      if (err?.code === 'ENOENT') throw Error(`未安装。请先执行：${INSTALL_HINTS.lark.installCmd}`);
      throw Error('不可用，请在终端确认 lark-cli');
    }
  });
  check('Codex', () => {
    try { exec('codex', ['--version'], {cwd: root, env: e, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe']}); }
    catch { throw Error(`未安装；安装：${INSTALL_HINTS.codex.installCmd}`); }
  });
  check('Codex 登录', () => {
    if (!loggedIn('codex', e)) throw Error('未登录，请先完成 Codex 登录初始化');
  }, {optional: !loginSet.has('codex')});
  check('Cursor CLI', () => {
    try { exec(cursorBin(), ['--version'], {cwd: root, env: e, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe']}); }
    catch { throw Error(`未安装；安装：${INSTALL_HINTS.cursor.installCmd}`); }
  }, {optional: !requireOptionalAgents && !loginSet.has('cursor')});
  check('Cursor 登录', () => {
    if (!loggedIn('cursor', e)) throw Error('未登录');
  }, {optional: !loginSet.has('cursor')});
  check('Qoder CLI', () => {
    try { exec(qoderBin(), ['--version'], {cwd: root, env: e, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe']}); }
    catch { throw Error(`未安装；安装：${INSTALL_HINTS.qoder.installCmd}`); }
  }, {optional: !requireOptionalAgents && !loginSet.has('qoder')});
  check('Qoder 登录', () => {
    if (!loggedIn('qoder', e)) throw Error('未登录');
  }, {optional: !loginSet.has('qoder')});
  check('OpenCode', () => {
    try { exec(opencodeBin(), ['--version'], {cwd: root, env: e, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe']}); }
    catch { throw Error(`未安装；安装：${INSTALL_HINTS.opencode.installCmd}`); }
  }, {optional: !requireOptionalAgents && !loginSet.has('opencode')});
  check('OpenCode 登录', () => {
    if (!loggedIn('opencode', e)) throw Error('未登录');
  }, {optional: !loginSet.has('opencode')});
  return {ok, notes, env: e};
}

/**
 * Resolve which Feishu bot to use.
 * - Custom credentials → write into lark-cli via switchBot
 * - Otherwise reuse the bot already configured in Lark CLI
 */
export function resolveBot(root, env, {appId = '', appSecret = ''} = {}, {
  readStatus = readAuthStatus,
  switchBotFn = switchBot,
  assertStopped = assertServiceStopped,
} = {}) {
  if (appId || appSecret) {
    assertStopped(root);
    const info = switchBotFn(root, env, {appId, appSecret});
    return {source: 'custom', info, status: readStatus(root, env)};
  }
  const status = readStatus(root, env);
  if (botAvailable(status)) {
    return {source: 'lark-cli', info: null, status};
  }
  return {source: 'missing', info: null, status};
}

export async function init(root, env, options = {}, {
  check = checkPrerequisites,
  resolve = resolveBot,
  connectFn = connect,
  pairFn = pair,
  checkTools = checkAgentTools,
  installInternal = installInternalTools,
  ensureAuth = ensureAgentAuth,
  pickAuthAgents = resolveAuthAgents,
  exists = existsSync,
  read = readFileSync,
  readHidden,
  ask,
  log = console.log,
} = {}) {
  const {
    appId = '',
    appSecret = '',
    appSecretStdin = false,
    skipPair = false,
    full = false,
    internal = false,
    agentsFlag = '',
  } = options;

  let runtimeEnv = withLocalBinPath(env);
  if (internal) {
    log('安装公司内部工具：dr CLI、tjob、skillctl。');
    const installed = installInternal({env: runtimeEnv, log});
    runtimeEnv = installed.env;
  }
  const toolNames = full
    ? [...AUTH_AGENTS]
    : ['codex'];
  log(full
    ? '初始化（全量）：检查全部 Agent CLI 的安装与登录状态，并让你选择要做登录初始化的 Agent。'
    : '初始化：检查 Codex CLI 与登录状态，再配置飞书（通常只需执行一次）。');

  const tools = checkTools(runtimeEnv, {names: toolNames});
  runtimeEnv = tools.env;
  for (const line of tools.notes) log(line);
  if (!tools.ok) {
    throw Error(full
      ? 'Agent CLI 未就绪。请按上方提示安装后重新运行 npm run init -- --full。'
      : 'Codex CLI 未就绪。请按上方提示安装后重新运行 npm run init；需要 Cursor/Qoder/OpenCode 时用 npm run init -- --full。');
  }

  const authAgents = await pickAuthAgents({full, agentsFlag}, {ask, log});
  log(`将对以下 Agent 做登录初始化：${authAgents.map(providerLabel).join('、')}`);
  const auth = ensureAuth(authAgents, runtimeEnv, {log});
  for (const line of auth.notes) log(line);
  if (!auth.ok) {
    throw Error(`Agent 登录未完成（${authAgents.map(providerLabel).join('、')}）。请按提示重试，或手动运行对应 login 命令。`);
  }

  const prereq = check(root, runtimeEnv, {
    requireOptionalAgents: full,
    requireLoginFor: authAgents,
  });
  for (const line of prereq.notes) log(line);
  if (!prereq.ok) throw Error('依赖未就绪。请按上方提示修复后重新运行 npm run init。');
  runtimeEnv = prereq.env || runtimeEnv;

  let credentials = {appId, appSecret};
  if (appSecretStdin && !appSecret) {
    credentials.appSecret = read(0, 'utf8').replace(/\r?\n$/, '');
  }

  let resolved = resolve(root, runtimeEnv, credentials);
  if (resolved.source === 'missing') {
    if (!ask || !readHidden) {
      throw Error(`飞书机器人未配置。可任选其一：\n1) 直接回车前先运行 lark-cli config init --new\n2) 再运行 npm run init\n3) 或：npm run init -- --app-id cli_xxx --app-secret-stdin\n也可单独运行 npm run bindbot。`);
    }
    log('未检测到 Lark CLI 中的机器人配置。');
    log('直接填写 App ID / App Secret 绑定自定义机器人；若已在其他终端配置好，请 Ctrl+C 后先完成 lark-cli config init，再重新 init。');
    const remembered = exists(join(root, 'connection.json'))
      ? JSON.parse(read(join(root, 'connection.json'), 'utf8')).appId
      : '';
    const hint = remembered ? '（cli_xxx；直接回车沿用已记录的应用）' : '（cli_xxx）';
    const typedId = (await ask(`App ID${hint}：`)).trim() || remembered;
    const typedSecret = await readHidden('App Secret（输入不回显）：');
    if (!typedId || !typedSecret) {
      throw Error('未提供机器人凭证，且 Lark CLI 中也没有可用 BOT。请先 lark-cli config init 或提供 App ID / App Secret。');
    }
    resolved = resolve(root, runtimeEnv, {appId: typedId, appSecret: typedSecret});
  }

  if (resolved.source === 'lark-cli') {
    log(`使用 Lark CLI 已配置的机器人（${resolved.status.appId}）。`);
  } else if (resolved.source === 'custom') {
    log(`已写入自定义机器人：${resolved.info?.botName || resolved.status?.appId}`);
  }

  let connection = resolved.info;
  if (!connection) {
    connection = connectFn(root, runtimeEnv, {brief: true});
  }
  if (process.exitCode) {
    throw Error('飞书事件连接尚未就绪。请确认长连接与 im.message.receive_v1 订阅后重新运行 npm run init。');
  }

  const configPath = join(root, 'config.json');
  if (exists(configPath)) {
    log('白名单配置已存在，跳过配对。');
  } else if (skipPair) {
    log('已跳过配对（--skip-pair）。请稍后运行 npm run pair 或 npm start 完成白名单绑定。');
  } else {
    log('开始白名单配对（一次性）。');
    await pairFn(root);
  }

  log('初始化完成。运行 npm start 启动服务，在飞书私聊发送 /status 验证。');
  log('常用命令：/status、/cd、/codex|/cursor|/qoder|/opencode、/model、/new、/cancel、/exit；完整列表见 README「飞书命令」。');
  return {connection, source: resolved.source, env: runtimeEnv, authAgents};
}
