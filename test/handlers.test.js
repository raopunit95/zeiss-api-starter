import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHandlers,validateRequest} from '../handlers.js';
import {validateStores,toPublicHospital} from '../inventory.js';
const stores=validateStores([{id:'s',name:'Store One',pincode:'560100'}]);
const row=(id,p={})=>({id,Name_of_the_Hospital:'Hospital',City:'Bengaluru',Locality:'Area',Doctor:'Doctor '+id,Years_of_Experience:'8',OPD_Schedule:'Mon 10-12',Status:'Active',Distance:1,...p});
const payload=(h,extra={})=>({storeId:'s',hospitalId:h.id,doctorId:h.doctors[0].id,name:'Asha Rao',phone:'9876543210',date:'2099-01-01',slot:'Morning',reason:'',consent:true,...extra});

test('hospitals endpoint returns public shape; unknown store is rejected; failures return 503',async()=>{
  let fail=false;const h=createHandlers({stores,loadInventory:async()=>{if(fail)throw Error('x');return [row(1)];},sendWebhook:async()=>{}});
  assert.equal((await h.hospitals('nope')).status,400);
  const r=await h.hospitals('s');assert.equal(r.status,200);assert.equal('lookups' in r.body.hospitals[0],false);assert.ok(r.body.syncedAt);
  fail=true;assert.equal((await h.hospitals('s')).status,503);
});
test('a doctor only present in the full list can be requested',async()=>{
  const sent=[];const enrichDoctors=async r=>({...r,hospitals:r.hospitals.map(x=>({...x,doctors:[{id:'full-1',name:'Full Doctor',experienceYears:'5',schedule:'Tue'}]}))});
  const h=createHandlers({stores,loadInventory:async()=>[row(1)],enrichDoctors,sendWebhook:async(rec,id)=>sent.push({rec,id})});
  const hosp=(await h.hospitals('s')).body.hospitals[0];assert.equal(hosp.doctors[0].name,'Full Doctor');
  const r=await h.submit(payload(hosp),'ip1');assert.equal(r.status,201);assert.equal(sent[0].rec.doctor_name,'Full Doctor');assert.equal(sent[0].rec.doctor_source_row_ref,'full-1');assert.equal(r.body.requestId,sent[0].id);
});
test('submit validates, sends once, and marks delivery failures as uncertain',async()=>{
  const sent=[];let fail=false;const h=createHandlers({stores,loadInventory:async()=>[row(1)],sendWebhook:async(rec,id)=>{sent.push(id);if(fail)throw Error('network');}});
  const hosp=(await h.hospitals('s')).body.hospitals[0];
  assert.equal((await h.submit(payload(hosp,{phone:'123'}),'ip2')).status,400);assert.equal((await h.submit(payload(hosp,{consent:false}),'ip2')).status,400);assert.equal(sent.length,0);
  assert.equal((await h.submit(payload(hosp,{doctorId:'unknown'}),'ip2')).status,400);
  assert.equal((await h.submit(payload(hosp),'ip2')).status,201);assert.equal(sent.length,1);
  fail=true;const r=await h.submit(payload(hosp),'ip2');assert.equal(r.status,502);assert.equal(r.body.deliveryUncertain,true);assert.equal(sent.length,2);
});
test('rate limit: 11th request from one address in the window is refused',async()=>{
  const h=createHandlers({stores,loadInventory:async()=>[row(1)],sendWebhook:async()=>{}});let last;
  for(let i=0;i<11;i++)last=await h.submit({storeId:'nope'},'ip3');assert.equal(last.status,429);assert.equal((await h.submit({storeId:'nope'},'ip4')).status,400);
});
test('request validation rejects past dates and malformed input',()=>{
  const result={hospitals:[{id:'h',name:'H',city:'C',locality:'L',doctors:[{id:'d',name:'D'}]}]};const ok={storeId:'s',hospitalId:'h',doctorId:'d',name:'Asha Rao',phone:'+91 9876543210',date:'2099-01-01',slot:'Evening',consent:true};
  assert.equal(validateRequest(ok,stores,result).preferred_slot,'Evening');
  for(const bad of [{date:'2000-01-01'},{date:'2099-02-30'},{slot:'Night'},{name:'A'},{reason:'x'.repeat(501)},{name:5}])assert.throws(()=>validateRequest({...ok,...bad},stores,result),/./);
});
