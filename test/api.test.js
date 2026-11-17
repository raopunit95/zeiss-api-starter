import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fetchInventory,projectHospitals,validateStores} from '../inventory.js';
import {createApp} from '../server.js';
import {createWebhookSender} from '../webhook.js';
const record=(id,p={})=>({id,Name_of_the_Hospital:'Hospital '+id,City:'Bengaluru',Locality:'Area',Doctor:'Doctor '+id,Years_of_Experience:'8',OPD_Schedule:'Mon 10-12',Status:'Active',Doctor_Surgeries_Count:0,Distance:1,...p});
const opts={source:'test',xpi:'test',pincode:'560100'};
const response=items=>({ok:true,json:async()=>({isSuccess:true,totalHospitals:100,hospitals:items})});
const store=validateStores([{id:'s',name:'Sample',pincode:'560100'}]);
test('fetches all pages, ignores total and fails closed on duplicate, cap and malformed results',async()=>{
  let offsets=[];const rows=await fetchInventory({...opts,fetchFn:async url=>{const o=Number(url.searchParams.get('offset'));offsets.push(o);return response(o===0?Array.from({length:100},(_,i)=>record(i)):[record(100)]);}});assert.equal(rows.length,101);assert.deepEqual(offsets,[0,100]);
  await assert.rejects(fetchInventory({...opts,fetchFn:async()=>response([record(1),record(1)])}),/duplicate/i);
  await assert.rejects(fetchInventory({...opts,maxPages:1,fetchFn:async()=>response(Array.from({length:100},(_,i)=>record(i)))}),/incomplete/i);
  await assert.rejects(fetchInventory({...opts,fetchFn:async()=>({ok:true,json:async()=>({isSuccess:false})})}),/Invalid/);
});
test('50 hospitals after grouping and Zeiss ordering; preserves all doctors; no private fields',()=>{
  const rows=Array.from({length:60},(_,i)=>record(i,{Distance:i+1,internal_revenue:'SECRET'}));rows.push(record(1000,{Name_of_the_Hospital:'Hospital 55',Distance:56,Doctor_Surgeries_Count:'1'}));rows.push(record(2000,{Name_of_the_Hospital:'Hospital 55',Distance:56}));rows.push(record(3000,{Distance:100.1}));rows.push(record(3001,{Distance:2,Locality:''}));
  const {hospitals,eligibleHospitals,incomplete}=projectHospitals(rows);assert.equal(eligibleHospitals,60);assert.equal(hospitals.length,50);assert.equal(hospitals[0].name,'Hospital 55');assert.equal(hospitals[0].doctors.length,3);assert.equal(incomplete,1);assert.ok(!JSON.stringify(hospitals).includes('SECRET'));
});
test('inclusive 100km and exact flag; absent distance not counted as zero',()=>{const x=projectHospitals([record(1,{Distance:100,Doctor_Surgeries_Count:'1.0'}),record(2,{Distance:100.01,Doctor_Surgeries_Count:'1'}),record(3,{Distance:''}),record(4,{Distance:20,Doctor_Surgeries_Count:'10'})]);assert.equal(x.hospitals.length,2);assert.equal(x.hospitals[0].zeiss,true);assert.equal(x.hospitals[1].zeiss,false);assert.equal(x.incomplete,1);});
test('preview blocks submissions; demo revalidates selection, saves locally and reports non-confirmation',async()=>{
  let rows=[record(1)],writes=[];const loadInventory=async()=>rows; const setup=mode=>createApp({stores:store,loadInventory,mode,appendDemo:async b=>writes.push(b)}).listen(0,'127.0.0.1');
  for(const mode of ['api-preview','api-demo']) {const server=setup(mode);await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;try{
    let r=await fetch(base+'/api/stores');assert.equal((await r.json()).bookingEnabled,mode==='api-demo');r=await fetch(base+'/api/hospitals?store=s');const h=(await r.json()).hospitals[0];
    const payload={storeId:'s',hospitalId:h.id,doctorId:h.doctors[0].id,name:'Synthetic Person',phone:'9876543210',date:'2099-01-01',slot:'Morning',reason:'',consent:true};
    const post=b=>fetch(base+'/api/requests',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});
    r=await post(payload);if(mode==='api-preview'){assert.equal(r.status,403);assert.equal(writes.length,0);}else{assert.equal(r.status,201);assert.match((await r.json()).message,/Not a confirmed appointment/);assert.equal(writes[0].doctor_source_row_ref,'1');rows=[];r=await post(payload);assert.equal(r.status,400);assert.equal(writes.length,1);rows=[record(1)];}
  }finally{await new Promise(r=>server.close(r));}}
});
test('webhook sends synthetic JSON and both auth layers without network',async()=>{
  let observed; const send=createWebhookSender({url:'https://api-external.medibuddy.in/w/synthetic',gatewayKey:'gateway-test-secret',authHeader:'Authorization',authValue:'Bearer route-test-secret',fetchFn:async(url,o)=>{observed={url,o};return {ok:true};}});
  const ack=await send({patient_name:'Synthetic Person',phone:'9876543210'},'stable-test-id');assert.equal(ack.requestId,'stable-test-id');assert.equal(observed.o.headers['X-Gateway-Key'],'gateway-test-secret');assert.equal(observed.o.headers.Authorization,'Bearer route-test-secret');assert.equal(JSON.parse(observed.o.body).request_id,'stable-test-id');assert.equal(observed.o.redirect,'error');
  assert.throws(()=>createWebhookSender({url:'http://example.invalid',gatewayKey:'x',authHeader:'Authorization',authValue:'y'}));
  assert.throws(()=>createWebhookSender({url:'https://api-external.medibuddy.in/w/synthetic',gatewayKey:'x',authHeader:'X-Gateway-Key',authValue:'y'}));
});
test('webhook mode sends once, returns acknowledgement only, and marks errors uncertain',async()=>{
  let writes=[];let fail=false;const sendWebhook=async(b,id)=>{writes.push({b,id});if(fail)throw Error('network uncertain');};const server=createApp({stores:store,loadInventory:async()=>[record(1)],mode:'api-webhook',sendWebhook}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
  try{let r=await fetch(base+'/api/stores');assert.equal((await r.json()).bookingEnabled,true);r=await fetch(base+'/api/hospitals?store=s');const h=(await r.json()).hospitals[0];const payload={storeId:'s',hospitalId:h.id,doctorId:h.doctors[0].id,name:'Synthetic Person',phone:'9876543210',date:'2099-01-01',slot:'Morning',reason:'',consent:true};const post=()=>fetch(base+'/api/requests',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
    r=await post();let d=await r.json();assert.equal(r.status,201);assert.match(d.message,/not confirmed/);assert.equal(d.requestId,writes[0].id);assert.equal(writes.length,1);assert.equal(writes[0].b.patient_name,'Synthetic Person');
    fail=true;r=await post();d=await r.json();assert.equal(r.status,502);assert.equal(d.deliveryUncertain,true);assert.equal(d.requestId,writes[1].id);assert.equal(writes.length,2);
  }finally{await new Promise(r=>server.close(r));}
});
