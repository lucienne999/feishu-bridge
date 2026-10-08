#!/usr/bin/env node
import {spawn, execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync, existsSync, realpathSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import {createInterface as prompts} from 'node:readline/promises';
import {DatabaseSync} from 'node:sqlite';
import {eligible, sessionKey, codexArgs, xml, resolveDirectory, failureMessage, helpMessage} from './core.mjs';
import {connect, assertApp} from './connect.mjs';
import {pair} from './pair.mjs';
import {assertServiceStopped, switchBot} from './bot.mjs';
import {parseInitArgs, init} from './init.mjs';
import {AGENT_MODES, cursorBinary, qoderBinary, opencodeBinary, providerSpec, providerEvent, providerSessionKey, providerSessionIds, providerLabel, normalizeDefaultMode} from './providers.mjs';
import {parseModelCommand, resolveModelProvider, listModels, formatModelList, assertKnownModel} from './models.mjs';
import {withLocalBinPath} from './tools-install.mjs';
import {buildStreamCard, buildFinalCard, buildStoppedCard, buildErrorCard, cardJson} from './card.mjs';
import {cliEntryPath, ensureDataLayout, packageRootFrom, resolveDataRoot} from './paths.mjs';
function clearProviderSessions(db, key) {
  const ids = providerSessionIds(key);
  db.prepare(`DELETE FROM sessions WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
}
function getProviderModel(db, key, provider) {
  return db.prepare('SELECT model FROM models WHERE id=?').get(providerSessionKey(key, provider))?.model || null;
}
function setProviderModel(db, key, provider, model) {
  const id = providerSessionKey(key, provider);
  if (!model) db.prepare('DELETE FROM models WHERE id=?').run(id);
  else db.prepare('INSERT OR REPLACE INTO models VALUES (?,?)').run(id, model);
}

const packageRoot = packageRootFrom(import.meta.url);
const root = resolveDataRoot(packageRoot);
ensureDataLayout(root, packageRoot);
const cliPath = cliEntryPath(import.meta.url);
const configPath = join(root, 'config.json');
const env = withLocalBinPath({...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER:'1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER:'1'});
const command = process.argv[2] || 'doctor';
const LARK_CLI_INSTALL = 'npx @larksuite/cli@latest install';
function run(bin, args) { return execFileSync(bin, args, {encoding:'utf8', env, timeout:15000, stdio:['ignore','pipe','pipe']}); }
function requireLarkCli() {
  try { run('lark-cli', ['--version']); }
  catch (e) {
    if (e?.code === 'ENOENT') throw Error(`未检测到 Lark CLI（lark-cli）。请先安装：\n${LARK_CLI_INSTALL}\n安装完成后重新运行 feishu-bridge start（或 npm start）。`);
  }
}
function load() {
  const c = JSON.parse(readFileSync(configPath, 'utf8'));
  if (!c.allowedUsers?.length || c.allowedUsers.some(x => !/^ou_[a-zA-Z0-9]+$/.test(x))) throw Error('请先运行 feishu-bridge init（或 npm run setup）配置允许的飞书用户。');
  if (!['read-only','workspace-write'].includes(c.sandbox)) throw Error('无效的 sandbox 配置');
  c.defaultMode = normalizeDefaultMode(c.defaultMode);
  c.workspace = realpathSync(c.workspace);
  return c;
}
async function setup() {
  if (existsSync(configPath)) throw Error('配置已存在，请编辑 config.json；不会覆盖原配置。');
  const ui = prompts({input:process.stdin, output:process.stdout});
  try {
    const workspace = realpathSync((await ui.question('初始目录（留空使用 demo；飞书里可用 /cd 切换）：')).trim() || join(root,'demo'));
    const user = (await ui.question('你的飞书 open_id（ou_ 开头，仅此人可使用）：')).trim();
    if (!/^ou_[a-zA-Z0-9]+$/.test(user)) throw Error('open_id 格式不正确');
    const mode = (await ui.question('允许修改 /cd 选中的项目？输入 yes，否则只读：')).trim();
    writeFileSync(configPath, JSON.stringify({workspace, allowedUsers:[user], sandbox:mode === 'yes' ? 'workspace-write':'read-only', defaultMode:'codex', timeoutSeconds:600}, null, 2), {mode:0o600, flag:'wx'});
    console.log(`配置完成（${configPath}）。运行 feishu-bridge doctor，再运行 feishu-bridge start。`);
  } finally { ui.close(); }
}
function readHiddenLine(label) {
  return new Promise((resolve, reject) => {
    process.stdout.write(label);
    if (!process.stdin.isTTY) {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => { data += chunk; });
      process.stdin.on('end', () => resolve(data.replace(/\r?\n$/, '')));
      process.stdin.on('error', reject);
      return;
    }
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const finish = (fn, arg) => {
      stdin.off('data', onData);
      stdin.setRawMode(!!wasRaw);
      stdin.pause();
      process.stdout.write('\n');
      fn(arg);
    };
    const onData = (ch) => {
      if (ch === '\n' || ch === '\r' || ch === '\u0004') return finish(resolve, value);
      if (ch === '\u0003') return finish(reject, Error('已取消'));
      if (ch === '\u007f' || ch === '\b') { value = value.slice(0, -1); return; }
      value += ch;
    };
    stdin.on('data', onData);
  });
}
async function bindbot() {
  requireLarkCli();
  assertServiceStopped(root);
  const args = process.argv.slice(3);
  const idFlag = args.indexOf('--app-id');
  let appId = idFlag >= 0 ? args[idFlag + 1] : '';
  let appSecret = '';
  if (args.includes('--app-secret-stdin')) {
    if (!appId) throw Error('使用 --app-secret-stdin 时需同时提供 --app-id。');
    appSecret = readFileSync(0, 'utf8').replace(/\r?\n$/, '');
  } else {
    console.log('绑定飞书应用机器人：填写 App ID 与 App Secret（开放平台凭证，不是公私钥）。');
    console.log('bot open_id 会在配置后自动拉取，无需手填；密钥只写入本机 lark-cli 钥匙串，不会存进本工具配置或飞书聊天。');
    const remembered = existsSync(join(root, 'connection.json'))
      ? JSON.parse(readFileSync(join(root, 'connection.json'), 'utf8')).appId
      : '';
    const ui = prompts({input: process.stdin, output: process.stdout});
    try {
      if (!appId) {
        const hint = remembered ? '（cli_xxx；直接回车沿用已记录的应用）' : '（cli_xxx）';
        appId = (await ui.question(`App ID${hint}：`)).trim() || remembered;
      }
    } finally { ui.close(); }
    appSecret = await readHiddenLine('App Secret（输入不回显）：');
  }
  const info = switchBot(root, env, {appId, appSecret});
  console.log(`已绑定：${info.botName}（${info.appId}）`);
  console.log(process.exitCode
    ? '事件订阅未就绪，请先修好长连接/权限后再运行 npm start。'
    : '完成。请运行 npm start 重新配对，然后在飞书里发 /status。');
  if (process.stdin.isTTY) process.stdin.pause();
}
async function runInit() {
  const opts = parseInitArgs(process.argv.slice(3));
  const ui = process.stdin.isTTY ? prompts({input: process.stdin, output: process.stdout}) : null;
  try {
    await init(root, env, opts, {
      ask: ui ? (q) => ui.question(q) : undefined,
      readHidden: ui ? readHiddenLine : undefined,
    });
  } finally {
    ui?.close();
    if (process.stdin.isTTY) process.stdin.pause();
  }
}
function doctor() {
  try {run(cursorBinary(),['--version']);console.log('Cursor CLI：已安装（登录请运行 npm run cursor:login）');}
  catch {console.log('Cursor CLI：未安装或不可用；可用 npm run init -- --full 安装。');}
  try {run(qoderBinary(),['--version']);console.log('Qoder CLI：已安装（登录请运行 npm run qcoder:login）');}
  catch {console.log('Qoder CLI：未安装或不可用；可用 npm run init -- --full 安装。');}
  try {run(opencodeBinary(),['--version']);console.log('OpenCode：已安装（登录请运行 npm run opencode:login）');}
  catch {console.log('OpenCode：未安装或不可用；可用 npm run init -- --full 安装。');}
  let larkInstalled=true;
  try {run('lark-cli',['--version']);console.log('Lark CLI：已安装');}
  catch (e) {
    larkInstalled=false;
    console.log(e?.code === 'ENOENT'
      ? `Lark CLI：未安装。请先执行：${LARK_CLI_INSTALL}`
      : 'Lark CLI：检查失败，请在终端确认 lark-cli 是否可用。');
    process.exitCode=1;
  }
  for (const [bin,args,label] of [['node',['--version'],'Node'],['codex',['--version'],'Codex'],['codex',['login','status'],'Codex 登录'],...(larkInstalled?[['lark-cli',['auth','status','--json'],'飞书配置']]:[])]) {
    try {
      const out = run(bin,args);
      if (bin === 'lark-cli') {
        const s = JSON.parse(out);
        if (!s.identities?.bot?.available) throw Error('bot unavailable');
        console.log(`${label}：机器人已配置（还需实测事件订阅和回复权限）`);
      } else console.log(`${label}：可用`);
    } catch { console.log(`${label}：检查失败，请在终端检查登录、安装或钥匙串访问。`); process.exitCode=1; }
  }
  console.log(`数据目录：${root}`);
  try { const c = load(); console.log(`项目：${c.workspace}\n沙箱：${c.sandbox}\n默认执行器：${c.defaultMode}`); }
  catch { console.log('本工具配置：未完成，运行 feishu-bridge init（或 npm run init / setup / pair）。'); process.exitCode=1; }
}
function launchagent() {
  load();
  const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
  <key>Label</key><string>local.mac-feishu-bridge</string>
  <key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(cliPath)}</string><string>start</string></array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(process.env.PATH)}</string><key>FEISHU_BRIDGE_HOME</key><string>${xml(root)}</string></dict>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>${xml(join(root,'service.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(join(root,'service-error.log'))}</string>
  </dict></plist>`;
  const plistPath = join(root,'local.launchagent.plist');
  writeFileSync(plistPath, plist, {mode:0o600});
  console.log(`已生成 ${plistPath}；安装步骤见 README。尚未注册或启动后台服务。`);
}
async function start() {
  requireLarkCli();
  if(!existsSync(configPath)) {
    connect(root, env, {brief: true});
    if(process.exitCode) throw Error('飞书事件连接尚未就绪，请根据上方提示修复后再运行 feishu-bridge start。');
    await pair(root);
  }
  const c = load();
  if(existsSync(join(root,'connection.json'))) assertApp(JSON.parse(run('lark-cli',['auth','status','--json'])),JSON.parse(readFileSync(join(root,'connection.json'),'utf8')));
  const lock = join(root,'state.lock');
  if(existsSync(lock)) {
    const pid=Number(readFileSync(lock,'utf8'));
    if(!Number.isSafeInteger(pid) || pid <= 0) throw Error('无效的 state.lock，请先检查是否已有服务运行。');
    let alive=true;
    try {process.kill(pid,0);} catch(e) {if(e.code === 'ESRCH') alive=false;}
    if(alive) throw Error('已有本地服务运行，请勿重复启动。');
    unlinkSync(lock);
  }
  writeFileSync(lock,String(process.pid),{flag:'wx',mode:0o600});
  process.on('exit',()=>{try {unlinkSync(lock);} catch {}});
  const db = new DatabaseSync(join(root,'state.sqlite'));
  db.exec('CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, status TEXT); CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, thread TEXT); CREATE TABLE IF NOT EXISTS contexts(id TEXT PRIMARY KEY, cwd TEXT, mode TEXT); CREATE TABLE IF NOT EXISTS models(id TEXT PRIMARY KEY, model TEXT);');
  db.exec("UPDATE messages SET status='interrupted' WHERE status='running'");
  let active = null;
  function runCli(args, timeoutMs = 15000) {
    return new Promise((resolve,reject) => {
      const p = spawn('lark-cli', args, {env, stdio:['ignore','pipe','pipe']});
      let out=''; p.stdout.on('data',b=>out+=b);
      p.stderr.resume();
      const timer=setTimeout(()=>p.kill('SIGTERM'),timeoutMs);
      p.on('error',reject);
      p.on('close',code=>{clearTimeout(timer); resolve({code, out});});
    });
  }
  function parseOk(out) {
    try { return JSON.parse(out); } catch { return null; }
  }
  function extractMessageId(payload) {
    return payload?.data?.message_id || payload?.data?.message?.message_id || payload?.message_id;
  }
  async function send(e, text) {
    const {code, out} = await runCli(['im','+messages-reply','--message-id',e.message_id,'--text',text.slice(0,7000),'--as','bot']);
    const payload = parseOk(out);
    if (code || !payload?.ok) throw Error('飞书回复失败，请检查发消息权限；任务不会因此重新执行。');
  }
  async function replyCard(e, card) {
    const {code, out} = await runCli(['im','+messages-reply','--message-id',e.message_id,'--msg-type','interactive','--content',cardJson(card),'--as','bot'], 20000);
    const payload = parseOk(out);
    const messageId = extractMessageId(payload);
    if (code || !payload?.ok || !messageId) throw Error('飞书卡片回复失败，请检查发消息与卡片权限；任务不会因此重新执行。');
    return messageId;
  }
  async function patchCard(messageId, card) {
    const data = JSON.stringify({content: cardJson(card)});
    const {code, out} = await runCli(['im','messages','patch','--message-id',messageId,'--data',data,'--as','bot'], 20000);
    const payload = parseOk(out);
    if (code || (payload && payload.ok === false)) throw Error('飞书卡片更新失败，请检查 im:message:update 权限。');
  }
  async function updateJobCard(job, card) {
    if (!job.cardId) {
      job.cardId = await replyCard(job.event, card);
      return;
    }
    try { await patchCard(job.cardId, card); }
    catch {
      // Patch failed (permissions / size): fall back to a new reply once.
      job.cardId = await replyCard(job.event, card);
    }
  }
  function stopJob(job) {
    job.cancelled=true;
    if(!job.child?.pid) return;
    try { process.kill(-job.child.pid,'SIGTERM'); } catch {}
    const timer=setTimeout(()=>{try {process.kill(-job.child.pid,'SIGKILL');} catch {}},5000);
    job.child.once('close',()=>clearTimeout(timer));
  }
  async function handle(e) {
    if (!eligible(e,c)) return;
    const id=e.message_id, key=sessionKey(e); let text=e.content.trim();
    if (!db.prepare('INSERT OR IGNORE INTO messages VALUES (?,?)').run(id,'received').changes) return;
    let ctx=db.prepare('SELECT cwd, mode FROM contexts WHERE id=?').get(key) || {cwd:c.workspace, mode:c.defaultMode};
    const saveContext=()=>db.prepare('INSERT OR REPLACE INTO contexts VALUES (?,?,?)').run(key,ctx.cwd,ctx.mode);
    if (text === '/help' || text === '/?') return send(e, helpMessage());
    if (text === '/status') {
      const provider = resolveModelProvider(ctx.mode, c.defaultMode);
      const modeLine = AGENT_MODES.includes(ctx.mode)
        ? providerLabel(ctx.mode)
        : `命令（默认 ${providerLabel(c.defaultMode)}）`;
      const model = getProviderModel(db, key, provider);
      return send(e, `Mac 在线\n目录：${ctx.cwd}\n模式：${modeLine}\n模型：${model || '默认'}\n${active ? '有任务正在执行':'空闲'}`);
    }
    if (/^\/(?:bot|bindbot)$/i.test(text)) {
      return send(e, '绑定/更换机器人请在 Mac 终端运行：npm run bindbot\n只需填写开放平台的 App ID 与 App Secret；不要在聊天里发送密钥。');
    }
    if (text === '/cancel') {
      if (active?.key === key) { stopJob(active); return send(e,'已请求取消，等待执行进程退出。'); }
      return send(e,'当前对话没有正在执行的任务。');
    }
    if (active) return send(e,'当前有任务执行中，请完成后重发；可用 /status 查询或 /cancel 取消。');
    if (text === '/cd' || text.startsWith('/cd ')) {
      try {ctx.cwd=resolveDirectory(text.slice(3),c.allowedRoots);}
      catch(err) {return send(e, `切换目录失败：${err.code === 'ENOENT' ? '目录不存在' : err.code === 'EACCES' ? '没有目录访问权限' : err.message}。当前目录保持不变。`);}
      if (!AGENT_MODES.includes(ctx.mode)) ctx.mode = c.defaultMode;
      saveContext(); clearProviderSessions(db, key);
      return send(e,`目录已切换到：${ctx.cwd}\n旧会话已解除绑定。当前 ${providerLabel(ctx.mode)}，直接发任务即可。`);
    }
    if (text === '/exit') {ctx.mode='commands';saveContext();return send(e,`已退出执行模式。会话保留；直接发任务会用默认 ${providerLabel(c.defaultMode)}，或发 /codex、/cursor、/qcoder、/opencode 切换。`);}
    if (text === '/new') {
      if (AGENT_MODES.includes(ctx.mode)) {
        db.prepare('DELETE FROM sessions WHERE id=?').run(providerSessionKey(key, ctx.mode));
        return send(e, `已开新会话（仍在 ${providerLabel(ctx.mode)} 模式）。直接发任务即可，无需再 /${ctx.mode}。`);
      }
      clearProviderSessions(db, key);
      return send(e, `已清除当前对话绑定。直接发任务会用默认 ${providerLabel(c.defaultMode)}。`);
    }
    const selected=/^\/(codex|cursor|qcoder|opencode)(?:\s|$)/.exec(text);
    if(selected) {
      ctx.mode=selected[1];saveContext();text=text.slice(selected[1].length+1).trim();
      if(!text) return send(e,`已进入 ${providerLabel(ctx.mode)} 模式\n目录：${ctx.cwd}\n请发送任务描述；/exit 退出。`);
    }
    try {
      const modelCmd = parseModelCommand(text);
      if (modelCmd) {
        const provider = resolveModelProvider(ctx.mode, c.defaultMode);
        if (modelCmd.action === 'clear') {
          setProviderModel(db, key, provider, null);
          return send(e, `${providerLabel(provider)} 已恢复默认模型。`);
        }
        if (modelCmd.action === 'list') {
          const models = listModels(provider, {env});
          return send(e, formatModelList(provider, models, getProviderModel(db, key, provider)));
        }
        const models = listModels(provider, {env});
        const model = assertKnownModel(models, modelCmd.model);
        setProviderModel(db, key, provider, model);
        return send(e, `${providerLabel(provider)} 模型已设为：${model}\n后续任务使用此模型；/model clear 可恢复默认。`);
      }
    } catch (err) {
      if (/^\/model/i.test(text)) return send(e, err.message);
      throw err;
    }
    if (!text || text.startsWith('/')) return send(e, helpMessage());
    if(!AGENT_MODES.includes(ctx.mode)) { ctx.mode = c.defaultMode; saveContext(); }
    const provider=ctx.mode, label=providerLabel(provider), providerKey=providerSessionKey(key,provider);
    const model=getProviderModel(db, key, provider);
    const job={key, child:null, cancelled:false, event:e, cardId:null}; active=job;
    const startedAt=Date.now();
    const processSteps=['已接收任务'];
    db.prepare('UPDATE messages SET status=? WHERE id=?').run('running',id);
    try {
      await updateJobCard(job, buildStreamCard({question:text, subtitle: model ? `正在本机执行 · ${model}` : '正在本机执行', process:processSteps, label}));
      if (job.cancelled) throw Error('cancelled');
      const thread = db.prepare('SELECT thread FROM sessions WHERE id=?').get(providerKey)?.thread;
      const spec=providerSpec(provider,thread,c.sandbox,text,model);
      const p=spawn(spec.bin,spec.args,{cwd:ctx.cwd,env,detached:true,stdio:['pipe','pipe','pipe']});
      job.child=p;
      p.stdin.on('error',()=>{});
      p.stdin.end(spec.passPromptOnStdin === false ? '' : text);
      let diagnostic='';p.stderr.on('data',b=>{diagnostic=(diagnostic+b.toString()).slice(-12000);});
      let result='', failed=false, complete=false, apiError='';
      const lines=createInterface({input:p.stdout});
      lines.on('line',line=>{
        try {
          const event=providerEvent(provider,JSON.parse(line));
          if(event.session) db.prepare('INSERT OR REPLACE INTO sessions VALUES (?,?)').run(providerKey,event.session);
          if(typeof event.text === 'string') result = event.append && result ? `${result}\n${event.text}` : event.text;
          if(event.complete) complete=true;
          if(event.failed) {failed=true;apiError=String(event.error || '');}
        } catch { failed=true; }
      });
      const timer=setTimeout(()=>{job.timedOut=true;stopJob(job);},Math.min(c.timeoutSeconds || 600,3600)*1000);
      let code;
      try { code=await new Promise((resolve,reject)=>{p.once('error',reject);p.once('close',resolve);}); }
      finally {clearTimeout(timer);lines.close();}
      const seconds=(Date.now()-startedAt)/1000;
      const status=job.cancelled ? 'cancelled' : (code || failed || !complete) ? 'failed':'completed';
      db.prepare('UPDATE messages SET status=? WHERE id=?').run(status,id);
      if (status === 'completed') {
        processSteps.push('执行完成');
        await updateJobCard(job, buildFinalCard({question:text, result: result || '执行结束，未返回文字结果。', process:processSteps, label, seconds}));
      } else if (status === 'cancelled') {
        const reason = job.timedOut ? '执行超时，已终止任务' : '任务已取消';
        processSteps.push(reason);
        await updateJobCard(job, buildStoppedCard({question:text, reason, label}));
      } else {
        const message = failureMessage(`${label} 执行`,{message:apiError+' '+diagnostic},code);
        processSteps.push('执行失败');
        await updateJobCard(job, buildErrorCard({question:text, message, label}));
      }
    } catch(err) {
      const cancelled = job.cancelled || err?.message === 'cancelled';
      db.prepare('UPDATE messages SET status=? WHERE id=?').run(cancelled ? 'cancelled' : 'failed',id);
      try {
        if (cancelled) {
          await updateJobCard(job, buildStoppedCard({question:text, reason: job.timedOut ? '执行超时，已终止任务' : '任务已取消', label}));
        } else {
          const message = failureMessage(job.child ? `${label} 调用` : `${label} 启动`, err);
          await updateJobCard(job, buildErrorCard({question:text, message, label}));
        }
      } catch {console.error('飞书回传失败：无法向飞书报告本次错误。');}
      console.error('任务未完成或结果未送达；详见本地任务状态。');
    } finally {active=null;}
  }
  function parseActionValue(raw) {
    if (raw && typeof raw === 'object') return raw;
    try { return JSON.parse(String(raw || '')); } catch { return null; }
  }
  async function handleCardAction(e) {
    // Legacy cards may still show「新会话」; keep callback so old messages work.
    if (!c.allowedUsers.includes(e.operator_id)) return;
    const value = parseActionValue(e.action_value);
    if (!value || value.action !== 'new') return;
    const key = String(value.key || '');
    if (key !== `${e.operator_id}:${e.chat_id}`) return;
    const ctx = db.prepare('SELECT cwd, mode FROM contexts WHERE id=?').get(key) || {mode: c.defaultMode};
    if (AGENT_MODES.includes(ctx.mode)) {
      db.prepare('DELETE FROM sessions WHERE id=?').run(providerSessionKey(key, ctx.mode));
    } else {
      clearProviderSessions(db, key);
    }
    if (!e.token) return;
    const modeNote = AGENT_MODES.includes(ctx.mode)
      ? `仍在 ${providerLabel(ctx.mode)} 模式，直接发下一条任务即可。`
      : `直接发任务会用默认 ${providerLabel(c.defaultMode)}。`;
    const notice = buildFinalCard({
      question: '新会话',
      result: `**结论**\n\n已开新会话。${modeNote}`,
      process: ['点击了「新会话」'],
      label: 'Bridge',
      seconds: 0
    });
    try {
      await runCli(['api','POST','/open-apis/interactive/v1/card/update','--as','bot','--data',JSON.stringify({token:e.token, card: notice})], 15000);
    } catch { /* session already cleared */ }
  }
  const listener=spawn('lark-cli',['event','consume','im.message.receive_v1','--as','bot'],{env,stdio:['pipe','pipe','pipe']});
  const cardListener=spawn('lark-cli',['event','consume','card.action.trigger','--as','bot'],{env,stdio:['pipe','pipe','pipe']});
  // Keep stdin open: lark-cli interprets EOF as shutdown.
  let ready=false;
  createInterface({input:listener.stderr}).on('line',line=>{
    if(line.includes('[event] ready')) {ready=true; console.log('飞书订阅已就绪，等待白名单用户私聊。');}
    else if (line.includes('WARN')) console.error('飞书订阅警告，请检查事件连接。');
  });
  createInterface({input:listener.stdout}).on('line',line=>{try { const e=JSON.parse(line); handle(e).catch(()=>console.error('消息处理失败。')); } catch { console.error('收到无法解析的事件。'); }});
  createInterface({input:cardListener.stdout}).on('line',line=>{try { const e=JSON.parse(line); handleCardAction(e).catch(()=>console.error('卡片回调处理失败。')); } catch { console.error('收到无法解析的卡片回调。'); }});
  cardListener.stderr.resume();
  listener.on('error',()=>{console.error('无法启动飞书 CLI');process.exitCode=1;});
  listener.on('close',code=>{
    console.error(`飞书订阅已退出（${code}），${ready ? '请重新启动。':'请检查飞书应用配置、订阅权限和钥匙串访问。'}`);
    try {cardListener.stdin.end();} catch {}
    if(active?.child) stopJob(active);
    process.exitCode=1;
  });
  for(const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>{listener.stdin.end(); try {cardListener.stdin.end();} catch {} if(active?.child) stopJob(active);});
}
try {
  if(command === 'connect') { requireLarkCli(); connect(root,env); }
  else if(command === 'setup') await setup();
  else if(command === 'doctor') doctor();
  else if(command === 'launchagent') launchagent();
  else if(command === 'bindbot') await bindbot();
  else if(command === 'init') await runInit();
  else if(command === 'start') await start();
  else throw Error('支持 init / connect / setup / doctor / start / launchagent / bindbot');
} catch(e) {console.error(e.message);process.exitCode=1;}
