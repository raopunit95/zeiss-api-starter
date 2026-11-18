import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.js';
import {validateStores} from '../inventory.js';
const stores=validateStores([{id:'s',name:'Store One',pincode:'560100'}]);
const row={id:'1',Name_of_the_Hospital:'Hospital',City:'Bengaluru',Locality:'Area',Doctor:'Doctor One',Years_of_Experience:'8',OPD_Schedule:'Mon 10-12',Status:'Active',Distance:1};

test('HTTP routes: stores, hospitals, request submission, bad input and security headers',async()=>{
  const sent=[];const server=createApp({stores,loadInventory:async()=>[row],sendWebhook:async(rec,id)=>sent.push({rec,id})}).listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
  try{
    let r=await fetch(base+'/api/stores');assert.equal(r.status,200);assert.equal((await r.json()).stores[0].name,'Store One');assert.equal(r.headers.get('x-content-type-options'),'nosniff');
    r=await fetch(base+'/api/hospitals?store=s');const h=(await r.json()).hospitals[0];assert.equal(h.doctors.length,1);assert.equal('lookups' in h,false);
    const post=b=>fetch(base+'/api/requests',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});
    const good={storeId:'s',hospitalId:h.id,doctorId:h.doctors[0].id,name:'Asha Rao',phone:'9876543210',date:'2099-01-01',slot:'Morning',reason:'',consent:true};
    r=await post(good);assert.equal(r.status,201);assert.equal(sent.length,1);
    r=await post({...good,phone:'1'});assert.equal(r.status,400);
    r=await fetch(base+'/api/requests',{method:'POST',headers:{'content-type':'application/json'},body:'{bad'});assert.equal(r.status,400);
    r=await fetch(base+'/');assert.equal(r.status,200);
  }finally{await new Promise(r=>server.close(r));}
});
