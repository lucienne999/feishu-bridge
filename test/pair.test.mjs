import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesPair} from '../src/pair.mjs';
const start=1000000, code='a7e8fc';
const e={sender_type:'user',chat_type:'p2p',message_type:'text',sender_id:'ou_test',chat_id:'oc_test',content:`/pair ${code}`,create_time:String(start+1000)};
test('只有新收到的本人私聊配对消息可以绑定',()=>{
  assert.equal(matchesPair(e,code,start,start+2000),true);
  for(const patch of [{sender_type:'bot'},{chat_type:'group'},{content:'/pair wrong'},{sender_id:''},{create_time:String(start-100)},{message_type:'post'}]) assert.equal(matchesPair({...e,...patch},code,start,start+2000),false);
});
test('配对码过期后拒绝绑定',()=>assert.equal(matchesPair(e,code,start,start+300001),false));
