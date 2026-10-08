import {spawn, spawnSync, execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertApp} from './connect.mjs';
import {ensureDataLayout, packageRootFrom, resolveDataRoot} from './paths.mjs';

export function matchesPair(e, code, startedAt, now=Date.now()) {
  const created=Number(e.create_time);
  return now-startedAt < 300000 && e.sender_type === 'user' && e.chat_type === 'p2p' &&
    e.message_type === 'text' && /^ou_[a-zA-Z0-9]+$/.test(e.sender_id || '') &&
    /^oc_[a-zA-Z0-9]+$/.test(e.chat_id || '') &&
    e.content?.trim() === `/pair ${code}` && Number.isFinite(created) &&
    created >= startedAt && created <= now+60000;
}

export async function pair(root) {
  const path=join(root,'config.json');
  if(existsSync(path)) throw Error('白名单配置已存在，不会覆盖。请先在本机检查 config.json。');
  const env={...process.env,LARKSUITE_CLI_NO_UPDATE_NOTIFIER:'1',LARKSUITE_CLI_NO_SKILLS_NOTIFIER:'1'};
  const connection=JSON.parse(readFileSync(join(root,'connection.json'),'utf8'));
  function verify() {
    const status=JSON.parse(execFileSync('lark-cli',['auth','status','--json'],{cwd:root,env,timeout:15000,stdio:['ignore','pipe','pipe'],encoding:'utf8'}));
    assertApp(status,connection);
  }
  verify();
  const code=randomBytes(6).toString('hex');
  const p=spawn('lark-cli',['event','consume','im.message.receive_v1','--as','bot','--timeout','5m'],{cwd:root,env,stdio:['pipe','pipe','pipe']});
  let ready=false, done=false, paired=false, startedAt=0, closed=false;
  const output=createInterface({input:p.stdout});
  output.pause();
  let forceKill=null, abandon=null, release=null;
  // Closing stdin is the CLI's supported graceful shutdown; escalate if it hangs after stop.
  const stop=()=>{
    try {p.stdin.end();} catch {}
    try {p.kill('SIGTERM');} catch {}
    if(!forceKill) forceKill=setTimeout(()=>{try {p.kill('SIGKILL');} catch {}},2000);
    if(!abandon) abandon=setTimeout(()=>{ if(!closed && release) {closed=true; release();}},5000);
  };
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  const startup=setTimeout(()=>{console.error('事件连接启动超时；未修改白名单。');stop();},30000);
  const errors=createInterface({input:p.stderr});
  errors.on('line',line=>{
    if(!ready && line.includes('[event] ready event_key=im.message.receive_v1')) {
      ready=true;clearTimeout(startup);startedAt=Date.now();
      const text=`/pair ${code}`;
      console.log(`机器人：${connection.botName}\n聊天入口：${connection.chatUrl}\n请在上述入口私聊发送（五分钟内有效）：\n${text}`);
      if(process.platform === 'darwin') spawnSync('/usr/bin/pbcopy',[],{input:text,timeout:3000});
      output.resume();
    }
  });
  output.on('line',line=>{
    if(!ready || done) return;
    let e;try {e=JSON.parse(line);} catch {return;}
    if(!matchesPair(e,code,startedAt)) return;
    done=true;
    try {
      verify();
      const config={workspace:join(root,'demo'),allowedUsers:[e.sender_id],sandbox:'read-only',defaultMode:'codex',timeoutSeconds:600};
      writeFileSync(path,JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'});
      paired=true;
      console.log('绑定成功，账号已保存；正在启动服务…');
    } catch {
      console.error('写入白名单失败：可能已有配置、目录权限不足或应用身份已变化。未覆盖已有配置。');
      process.exitCode=1;
    }
    stop();
  });
  await new Promise((resolve,reject)=>{
    release=resolve;
    p.once('error',reject);
    p.once('close',()=>{closed=true; resolve();});
  }).finally(()=>{
    clearTimeout(startup);
    if(forceKill) clearTimeout(forceKill);
    if(abandon) clearTimeout(abandon);
    output.close();errors.close();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
  });
  if(!paired) throw Error(ready ? '配对未完成；白名单未修改。' : '无法连接飞书事件，请检查应用订阅、网络和钥匙串访问。');
}

if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const packageRoot = packageRootFrom(import.meta.url);
    const root = resolveDataRoot(packageRoot);
    ensureDataLayout(root, packageRoot);
    await pair(root);
  } catch {console.error('配对未完成。请检查连接或重新运行 feishu-bridge init / npm run pair；不会自动放行其他账号。');process.exitCode=1;}
}
