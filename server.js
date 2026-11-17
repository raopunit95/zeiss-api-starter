import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createWebhookSender} from './webhook.js';
import {fetchInventory,projectHospitals,validateStores} from './inventory.js';
const root=path.dirname(fileURLToPath(import.meta.url));
const clean=(v,max)=>{if(typeof v!=='string')throw Error('Invalid form fields'); const x=v.trim(); if(x.length>max||/[\x00-\x1f\x7f]/.test(x))throw Error('Invalid form fields'); return x;};
export function validateRequest(body,stores,result,now=new Date()){
  if(!body || typeof body!=='object' || Array.isArray(body))throw Error('Invalid request');
  const storeId=clean(body.storeId,100), hospitalId=clean(body.hospitalId,100), doctorId=clean(body.doctorId,200),name=clean(body.name,100),phone=clean(body.phone,20),date=clean(body.date,10),slot=clean(body.slot,20),reason=clean(body.reason ?? '',500);
  if(name.length<2) throw Error('Enter a name of at least 2 characters');
  if(!/^(?:\+91[ -]?)?[6-9]\d{9}$/.test(phone)) throw Error('Enter a valid Indian mobile number');
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Invalid date');
  const parsed=new Date(date+'T00:00:00Z'); if(!Number.isFinite(parsed.valueOf())||parsed.toISOString().slice(0,10)!==date||date<today)throw Error('Choose a valid date today or later');
  if(!['Morning','Afternoon','Evening'].includes(slot)||body.consent!==true)throw Error('Choose a preferred time and provide consent');
  const store=stores.find(s=>s.id===storeId),hospital=result.hospitals.find(h=>h.id===hospitalId),doctor=hospital?.doctors.find(d=>d.id===doctorId);
  if(!store || !hospital || !doctor)throw Error('Selected doctor is no longer available in this list');
  return {submitted_at_utc:now.toISOString(),store_id:store.id,store_name:store.name,store_pincode:store.pincode,hospital_group_ref:hospital.id,hospital_name:hospital.name,hospital_city:hospital.city,hospital_locality:hospital.locality,doctor_source_row_ref:doctor.id,doctor_name:doctor.name,patient_name:name,phone,preferred_date:date,preferred_slot:slot,reason,consent:'Yes'};
}
export function createApp({stores,loadInventory,appendDemo,sendWebhook,mode='api-preview'}){
  const app=express();app.disable('x-powered-by');
  app.use((req,res,next)=>{res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; img-src 'self' https://views.medibuddy.in; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'Cache-Control':'no-store'});next();});
  app.use(express.json({limit:'8kb',strict:true}));
  app.get('/api/stores',(req,res)=>res.json({mode,bookingEnabled:['api-demo','api-webhook'].includes(mode),stores:stores.map(({id,name})=>({id,name}))}));
  app.get('/api/hospitals',async(req,res)=>{const store=stores.find(s=>s.id===req.query.store);if(!store)return res.status(400).json({error:'Choose a valid store.'});try{const result=projectHospitals(await loadInventory(store));return res.json({...result,syncedAt:new Date().toISOString(),mode});}catch{return res.status(503).json({error:'Inventory unavailable or incomplete. Please try later.'});}});
  const attempts=new Map();
  app.post('/api/requests',async(req,res)=>{
    if(!['api-demo','api-webhook'].includes(mode))return res.status(403).json({error:'Requests are disabled in read-only preview.'});
    const now=Date.now(),key=req.ip;for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);const x=attempts.get(key);if(x?.count>=10)return res.status(429).json({error:'Too many requests. Try later.'});attempts.set(key,x&&x.until>now?{...x,count:x.count+1}:{count:1,until:now+600000});
    const store=stores.find(s=>s.id===req.body?.storeId);if(!store)return res.status(400).json({error:'Choose a valid store.'});
    let result;try{result=projectHospitals(await loadInventory(store));}catch{return res.status(503).json({error:'Inventory unavailable or incomplete; request not submitted.'});}
    let record;try{record=validateRequest(req.body,stores,result);}catch(e){return res.status(400).json({error:e.message});}
    if(mode==='api-demo'){
      try{await appendDemo(record);return res.status(201).json({message:'Demo request saved locally. Not a confirmed appointment.'});}catch{return res.status(503).json({error:'Local demo save could not be confirmed. Please check before retrying.'});}
    }
    const requestId=randomUUID();
    try{await sendWebhook(record,requestId);return res.status(201).json({message:'Request endpoint acknowledged receipt; downstream processing and appointment are not confirmed.',requestId});}
    catch(err){console.error('Webhook delivery not confirmed:',err?.status??err?.name??'unknown error');return res.status(502).json({error:'Delivery could not be confirmed and the request may have been received. Contact the workflow owner before retrying.',requestId,deliveryUncertain:true});}
  });
  app.use(express.static(path.join(root,'public'),{dotfiles:'deny'}));
  app.use((err,req,res,next)=>res.status(err.type==='entity.too.large'?413:400).json({error:'Invalid request.'}));return app;
}
export async function start(){
  const mode=process.env.APP_MODE||'api-preview';if(!['api-preview','api-demo','api-webhook'].includes(mode))throw Error('Invalid mode');
  const stores=validateStores(JSON.parse(await fs.readFile(path.resolve(process.env.STORES_FILE||path.join(root,'config/stores.json')),'utf8')));
  const source=process.env.INVENTORY_SOURCE,xpi=process.env.INVENTORY_XPI;
  if(!source||!xpi)throw Error('Inventory credentials missing');
  const loadInventory=s=>fetchInventory({pincode:s.pincode,source,xpi});
  const outfile=path.resolve(process.env.DEMO_REQUESTS_FILE||path.join(root,'data/demo-requests.jsonl'));
  const appendDemo=async r=>{await fs.mkdir(path.dirname(outfile),{recursive:true,mode:0o700});await fs.appendFile(outfile,JSON.stringify(r)+'\n',{encoding:'utf8',mode:0o600});};
  let sendWebhook;
  if(mode==='api-webhook'){
    if(process.env.WEBHOOK_SYNTHETIC_ONLY!=='true')throw Error('Webhook mode requires synthetic test acknowledgement');
    sendWebhook=createWebhookSender({url:process.env.WEBHOOK_URL,gatewayKey:process.env.WEBHOOK_GATEWAY_KEY,authHeader:process.env.WEBHOOK_AUTH_HEADER,authValue:process.env.WEBHOOK_AUTH_VALUE,allowDirectN8n:process.env.WEBHOOK_ALLOW_DIRECT_N8N==='true'});
  }
  const app=createApp({stores,loadInventory,appendDemo,sendWebhook,mode});return app.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log('Started '+mode+'. Never use real patient data in this starter.'));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))start().catch(e=>{console.error('Startup failed:',e?.message||'check mode, stores and server-side environment.');process.exit(1);});
