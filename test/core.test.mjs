import test from 'node:test';
import assert from 'node:assert/strict';
import {eligible, codexArgs, sessionKey, xml, resolveDirectory, failureMessage} from '../src/core.mjs';
import {mkdtempSync,mkdirSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const now=Date.now(), c={allowedUsers:['ou_owner']};
const event={sender_type:'user',sender_id:'ou_owner',chat_type:'p2p',chat_id:'oc_1',message_id:'om_1',message_type:'text',content:'帮我检查项目',create_time:String(now)};
test('允许白名单私聊；拒绝其他用户、群聊、机器人和过期指令',()=>{
  assert.ok(eligible(event,c,now));
  for(const patch of [{sender_id:'ou_other'},{sender_type:'bot'},{chat_type:'group'},{message_type:'image'},{create_time:String(now-600000)},{message_id:''}]) assert.equal(eligible({...event,...patch},c,now),false);
});
test('会话按用户及聊天隔离',()=>assert.notEqual(sessionKey(event),sessionKey({...event,chat_id:'oc_2'})));
test('执行参数保留沙箱与明确会话，不把用户消息拼接成 shell',()=>{
  const a=codexArgs('thread-1','read-only');
  assert.ok(a.includes('sandbox_mode="read-only"'));
  assert.ok(a.includes('approval_policy="never"'));
  assert.deepEqual(a.slice(-3),['resume','thread-1','-']);
  assert.ok(!a.includes('--last'));
});
test('LaunchAgent 路径正确转义',()=>assert.equal(xml('/a&b/<x>'),'/a&amp;b/&lt;x&gt;'));
test('切换目录拒绝无效路径，并解析符号链接验证允许范围',()=>{
  const base=mkdtempSync(join(tmpdir(),'bridge-test-'));
  try {
    mkdirSync(join(base,'allowed'));mkdirSync(join(base,'outside'));
    symlinkSync(join(base,'outside'),join(base,'allowed','link'));
    assert.ok(resolveDirectory(join(base,'allowed')).endsWith('/allowed'));
    assert.throws(()=>resolveDirectory('relative/path'));
    assert.throws(()=>resolveDirectory(join(base,'missing')));
    assert.throws(()=>resolveDirectory(join(base,'allowed','link'),[join(base,'allowed')]));
  }finally {rmSync(base,{recursive:true});}
});
test('失败消息说明失败阶段，并不回传原始诊断中的凭据',()=>{
  assert.match(failureMessage('Codex 启动',{code:'ENOENT'}),/找不到/);
  assert.match(failureMessage('Codex 执行',{message:'401 auth sk-secret'}),/认证失效/);
  assert.ok(!failureMessage('Codex 执行',{message:'401 auth sk-secret'}).includes('sk-secret'));
  assert.match(failureMessage('Codex 执行',{message:'connection failed'}),/网络/);
  assert.match(failureMessage('Cursor 执行',{message:'Workspace Trust Required\nPass --trust'}),/尚未信任/);
});
