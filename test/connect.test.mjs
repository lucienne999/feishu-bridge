import test from 'node:test';
import assert from 'node:assert/strict';
import {connectionInfo, assertApp} from '../src/connect.mjs';
const s={appId:'cli_abc',brand:'feishu',identities:{bot:{available:true}}};
const b={ok:true,data:{activate_status:2,app_name:'Bridge',open_id:'ou_bot'}};
test('只保存机器人身份和入口，不复制登录凭据',()=>{
  const info=connectionInfo({...s,secret:'do-not-copy'},b);
  assert.equal(info.chatUrl,'https://applink.feishu.cn/client/bot/open?appId=cli_abc');
  assert.equal(info.botName,'Bridge');assert.ok(!JSON.stringify(info).includes('do-not-copy'));
});
test('未启用的机器人、无效身份和未知品牌不返回成功入口',()=>{
  assert.throws(()=>connectionInfo({...s,identities:{}},b));
  assert.throws(()=>connectionInfo(s,{...b,data:{...b.data,activate_status:1}}));
  assert.throws(()=>connectionInfo({...s,brand:'lark'},b));
  assert.throws(()=>connectionInfo(s,{ok:false}));
});
test('应用更换后拒绝静默使用其他机器人',()=>{
  const info=connectionInfo(s,b); assert.doesNotThrow(()=>assertApp(s,info));
  assert.throws(()=>assertApp({...s,appId:'cli_other'},info));
});
