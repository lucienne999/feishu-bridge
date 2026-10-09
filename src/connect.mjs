import {execFileSync, spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';

export function connectionInfo(status, response) {
  if(!status.identities?.bot?.available) throw Error('飞书机器人未配置，请先在本机终端运行 lark-cli config init。');
  if(!/^cli_[a-zA-Z0-9]+$/.test(status.appId || '')) throw Error('飞书 CLI 未返回有效的应用 ID。');
  if(status.brand !== 'feishu') throw Error('本版 connect 仅验证了飞书品牌，暂不生成 Lark 国际版入口。');
  if(response.ok !== true) throw Error('获取机器人信息失败。');
  const bot=response.data?.bot || response.data;
  if(!bot?.open_id || !bot.app_name) throw Error('机器人信息缺失，请确认应用已启用机器人能力。');
  if(bot.activate_status !== 2) throw Error('当前机器人未启用，请检查应用发布、安装和启用状态。');
  return {
    appId:status.appId, botOpenId:bot.open_id, botName:bot.app_name,
    chatUrl:`https://applink.feishu.cn/client/bot/open?appId=${status.appId}`,
    transport:'lark-cli-events', checkedAt:new Date().toISOString()
  };
}
export function assertApp(status, connection) {
  if(status.appId !== connection.appId || !status.identities?.bot?.available) throw Error('当前飞书 CLI 应用与已连接的机器人不一致或不可用。请检查 CLI 配置，再运行 npm run connect 确认入口。');
}
export function connect(root, env, {brief = false} = {}) {
  function read(args) {
    let out='';
    try {out=execFileSync('lark-cli',args,{cwd:root,env,encoding:'utf8',timeout:20000,stdio:['ignore','pipe','pipe']});}
    catch (e) {
      out=String(e.stdout || e.stderr || '');
      try {
        const body=JSON.parse(out);
        if (body?.error?.subtype === 'invalid_client' || body?.error?.code === 20048) {
          throw Error('当前 lark-cli 的 App ID / App Secret 无效。请在本机运行 npm run bindbot，填入开放平台真实凭证后重试。');
        }
      } catch (parsed) { if (parsed.message?.includes('npm run bindbot')) throw parsed; }
      throw Error('飞书连接检查失败：请在本机终端运行 lark-cli auth status，检查应用配置、网络和凭据访问。');
    }
    const body=JSON.parse(out);
    if (body?.ok === false && (body?.error?.subtype === 'invalid_client' || body?.error?.code === 20048)) {
      throw Error('当前 lark-cli 的 App ID / App Secret 无效。请在本机运行 npm run bindbot，填入开放平台真实凭证后重试。');
    }
    return body;
  }
  const status=read(['auth','status','--json']);
  const info=connectionInfo(status,read(['api','GET','/open-apis/bot/v3/info','--as','bot']));
  // Check again before saving, to catch CLI profile changes during discovery.
  assertApp(read(['auth','status','--json']),info);
  const probe=spawnSync('lark-cli',['event','consume','im.message.receive_v1','--as','bot','--timeout','3s'],{cwd:root,env,encoding:'utf8',timeout:15000,stdio:['ignore','pipe','pipe']});
  info.eventSubscriptionReady=probe.status === 0 && (probe.stderr || '').includes('[event] ready event_key=im.message.receive_v1');
  // Never persist credentials or incoming messages from the read-only probe.
  writeFileSync(join(root,'connection.json'),JSON.stringify(info,null,2),{mode:0o600});
  if (!brief) {
    console.log(`机器人：${info.botName}\n应用：${info.appId}\n聊天入口：${info.chatUrl}`);
    console.log(info.eventSubscriptionReady ? '接收事件检查：已就绪。' : '接收事件检查失败：请确认长连接、im.message.receive_v1 订阅及接收权限；若已有监听进程，先停止后重试。');
    console.log('下一步：npm start（首次会配对白名单）；在飞书入口发送 /status 验证。');
  } else if (!info.eventSubscriptionReady) {
    console.log('接收事件检查失败：请确认长连接、im.message.receive_v1 订阅及接收权限；若已有监听进程，先停止后重试。');
  }
  if(!info.eventSubscriptionReady) process.exitCode=1;
  return info;
}
