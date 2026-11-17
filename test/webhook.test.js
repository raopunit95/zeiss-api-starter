import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWebhookSender} from '../webhook.js';
const N8N='https://n8n-public.medibuddy.in/webhook/131ecb05-d003-4ae9-ad78-db23a916793d';

test('direct n8n: refused unless explicitly allowed',()=>{
  assert.throws(()=>createWebhookSender({url:N8N}),/approved/i);
});
test('direct n8n: posts JSON once, no gateway key, optional header omitted',async()=>{
  let seen;const send=createWebhookSender({url:N8N,allowDirectN8n:true,fetchFn:async(u,o)=>{seen={u,o};return {ok:true,status:200};}});
  const r=await send({patient_name:'Synthetic Person'},'id-1');
  assert.equal(r.status,200);assert.equal(seen.o.method,'POST');assert.equal(seen.o.redirect,'error');
  assert.equal(seen.o.headers['X-Gateway-Key'],undefined);assert.equal(seen.o.headers['Content-Type'],'application/json');
  const b=JSON.parse(seen.o.body);assert.equal(b.request_id,'id-1');assert.equal(b.schema_version,'1');assert.equal(b.patient_name,'Synthetic Person');
});
test('direct n8n: optional header auth is sent when configured',async()=>{
  let seen;const send=createWebhookSender({url:N8N,allowDirectN8n:true,authHeader:'X-Api-Key',authValue:'s3cret',fetchFn:async(u,o)=>{seen=o;return {ok:true,status:200};}});
  await send({},'id-2');assert.equal(seen.headers['X-Api-Key'],'s3cret');
});
test('direct n8n: /webhook-test/ accepted; wrong host, path, http and ports rejected',()=>{
  const ok=u=>createWebhookSender({url:u,allowDirectN8n:true});
  ok('https://n8n-public.medibuddy.in/webhook-test/131ecb05-d003-4ae9-ad78-db23a916793d');
  for(const u of ['http://n8n-public.medibuddy.in/webhook/131ecb05-d003-4ae9-ad78-db23a916793d','https://evil.example/webhook/131ecb05-d003-4ae9-ad78-db23a916793d','https://n8n-public.medibuddy.in/rest/x','https://n8n-public.medibuddy.in:8443/webhook/131ecb05-d003-4ae9-ad78-db23a916793d','https://n8n-public.medibuddy.in/webhook/not-a-uuid'])assert.throws(()=>ok(u),u);
});
test('non-2xx surfaces status for debugging and does not retry',async()=>{
  let calls=0;const send=createWebhookSender({url:N8N,allowDirectN8n:true,fetchFn:async()=>{calls++;return {ok:false,status:404};}});
  await assert.rejects(send({},'id-3'),e=>e.status===404);assert.equal(calls,1);
});
test('gateway mode still requires both credentials',()=>{
  const u='https://api-external.medibuddy.in/w/synthetic';
  assert.throws(()=>createWebhookSender({url:u,allowDirectN8n:true}));
  createWebhookSender({url:u,gatewayKey:'k',authHeader:'Authorization',authValue:'Bearer x'});
});
