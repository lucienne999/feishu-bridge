export function eligible(e, config, now = Date.now()) {
  return e.sender_type === 'user' && e.chat_type === 'p2p' &&
    e.message_type === 'text' && typeof e.content === 'string' &&
    /^om_/.test(e.message_id || '') && /^oc_/.test(e.chat_id || '') &&
    config.allowedUsers.includes(e.sender_id) &&
    Number(e.create_time) <= now + 60000 && Number(e.create_time) >= now - 300000;
}
export function sessionKey(e) { return `${e.sender_id}:${e.chat_id}`; }
export function codexArgs(session, sandbox, model) {
  const args = ['exec', '--ignore-user-config', '--ignore-rules', '-c', `sandbox_mode="${sandbox}"`, '-c', 'approval_policy="never"', '--json', '--skip-git-repo-check'];
  if (model) args.push('-m', model);
  return session ? [...args, 'resume', session, '-'] : [...args, '-'];
}
export function xml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
}
import {realpathSync, statSync} from 'node:fs';
import {isAbsolute, resolve, relative, sep} from 'node:path';
import {homedir} from 'node:os';

export function resolveDirectory(input, roots) {
  let value=input.trim();
  if(value === '~' || value.startsWith('~/')) value=homedir()+value.slice(1);
  if(!isAbsolute(value)) throw Error('请使用绝对路径，例如 /cd /Users/你的名字/projects/demo');
  const path=realpathSync(value);
  if(!statSync(path).isDirectory()) throw Error('目标不是目录');
  if(roots?.length && !roots.some(root=>{const r=relative(realpathSync(root),path);return r === '' || (!isAbsolute(r) && r !== '..' && !r.startsWith('..'+sep));})) throw Error('此目录不在安装者配置的允许范围内');
  return path;
}

export function helpMessage() {
  return [
    '飞书命令：',
    '/help — 显示本帮助',
    '/status — 在线状态、目录、执行器、模型、是否忙碌',
    '/cd 绝对路径 — 切换工作目录（支持 ~/）',
    '/codex|/cursor|/qcoder|/opencode [任务] — 进入对应执行器',
    '/model — 列出当前执行器可用模型',
    '/model 模型名 — 设置模型；/model clear 恢复默认',
    '/exit — 退出执行器，再发任务走 defaultMode',
    '/new — 开新会话（执行器内只清当前模式）',
    '/cancel — 取消当前任务',
    '/bindbot — 提示到本机换机器人（勿在聊天发密钥）',
    '未进执行器时可直接发任务（默认 Codex）。仅处理私聊文字。',
  ].join('\n');
}

export function failureMessage(stage, error, code) {
  if(error?.code === 'ENOENT') return `${stage}失败：找不到程序或目录，请在本机检查安装与路径。`;
  if(error?.code === 'EACCES' || error?.code === 'EPERM') return `${stage}失败：没有访问权限，请在本机检查文件权限或系统授权。`;
  const s=String(error?.message || '');
  if(/auth|unauthori[sz]ed|login|401|token.*expired/i.test(s)) return `${stage}失败：登录或认证失效，请在本机重新登录对应执行器。`;
  if(/workspace trust|pass --trust/i.test(s)) return `${stage}失败：目录尚未信任，非交互模式需 --trust；请更新本工具后重试。`;
  if(/rate.limit|quota|429|usage.limit/i.test(s)) return `${stage}失败：调用额度不足或触发频率限制，请稍后再试并检查账户额度。`;
  if(/network|connection|connect|dns|fetch|502|503/i.test(s)) return `${stage}失败：网络或远端服务不可用，请检查本机联网后重试。`;
  return `${stage}失败${Number.isInteger(code) ? `（退出码 ${code}）` : ''}：未能完成调用，请在本机检查对应执行器状态、网络及项目权限。`;
}
