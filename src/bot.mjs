import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {connect} from './connect.mjs';

export function parseBotCredentials(appId, appSecret) {
  const id = String(appId || '').trim();
  const secret = String(appSecret || '').trim();
  if (!/^cli_[a-zA-Z0-9]+$/.test(id)) throw Error('App ID 格式不正确，应为飞书开放平台的 cli_ 开头应用 ID。');
  if (secret.length < 8) throw Error('App Secret 无效或过短。');
  return {appId: id, appSecret: secret};
}

export function assertServiceStopped(root, {
  exists = existsSync,
  read = readFileSync,
  kill = (pid, signal) => process.kill(pid, signal),
} = {}) {
  const lock = join(root, 'state.lock');
  if (!exists(lock)) return;
  const pid = Number(read(lock, 'utf8'));
  if (!Number.isSafeInteger(pid) || pid <= 0) throw Error('无效的 state.lock，请先检查是否已有服务运行。');
  try { kill(pid, 0); }
  catch (e) { if (e.code === 'ESRCH') return; throw e; }
  throw Error('本地服务仍在运行。请先停止前台实例，或卸载 LaunchAgent 后再换机器人。');
}

export function switchBot(root, env, credentials, {
  exec = execFileSync,
  connectFn = connect,
  exists = existsSync,
  unlink = unlinkSync,
  assertStopped = assertServiceStopped,
} = {}) {
  const {appId, appSecret} = parseBotCredentials(credentials.appId, credentials.appSecret);
  assertStopped(root);
  try {
    exec('lark-cli', ['config', 'init', '--app-id', appId, '--app-secret-stdin', '--brand', 'feishu'], {
      cwd: root, env, input: `${appSecret}\n`, encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    throw Error('写入飞书 CLI 应用配置失败。请确认 App ID / App Secret 正确，并检查钥匙串访问。');
  }
  let status;
  try {
    status = JSON.parse(exec('lark-cli', ['auth', 'status', '--json'], {
      cwd: root, env, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'],
    }));
  } catch {
    throw Error('配置已写入，但无法验证。请运行 lark-cli auth status 检查。');
  }
  if (status.appId !== appId) throw Error('配置后的应用 ID 与输入不一致，请重试 npm run bindbot。');
  if (!status.identities?.bot?.available) throw Error('机器人身份不可用。请确认应用已启用机器人能力并完成发布。');
  const configPath = join(root, 'config.json');
  if (exists(configPath)) unlink(configPath);
  return connectFn(root, env, {brief: true});
}
