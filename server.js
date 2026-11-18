import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createWebhookSender} from './webhook.js';
import {fetchInventory,validateStores,createDoctorEnricher} from './inventory.js';
import {createHandlers} from './handlers.js';
export {validateRequest,createHandlers} from './handlers.js';
const root=path.dirname(fileURLToPath(import.meta.url));
export function createApp(deps,{trustProxy}={}){
  const h=createHandlers(deps);
  const app=express();app.disable('x-powered-by');
  if(trustProxy!==undefined)app.set('trust proxy',trustProxy);
  app.use((req,res,next)=>{res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; img-src 'self' https://views.medibuddy.in; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'Cache-Control':'no-store'});next();});
  app.use(express.json({limit:'8kb',strict:true}));
  const send=(res,r)=>res.status(r.status).json(r.body);
  app.get('/api/stores',(req,res)=>send(res,h.stores()));
  app.get('/api/hospitals',async(req,res)=>send(res,await h.hospitals(req.query.store)));
  app.post('/api/requests',async(req,res)=>send(res,await h.submit(req.body,req.ip)));
  app.use(express.static(path.join(root,'public'),{dotfiles:'deny'}));
  app.use((err,req,res,next)=>res.status(err.type==='entity.too.large'?413:400).json({error:'Invalid request.'}));return app;
}

export async function start(){
  const stores=validateStores(JSON.parse(await fs.readFile(path.resolve(process.env.STORES_FILE||path.join(root,'config/stores.json')),'utf8')));
  const source=process.env.INVENTORY_SOURCE,xpi=process.env.INVENTORY_XPI;
  if(!source||!xpi)throw Error('Inventory credentials missing');
  const loadInventory=s=>fetchInventory({pincode:s.pincode,source,xpi});
  const sendWebhook=createWebhookSender({url:process.env.WEBHOOK_URL,gatewayKey:process.env.WEBHOOK_GATEWAY_KEY,authHeader:process.env.WEBHOOK_AUTH_HEADER,authValue:process.env.WEBHOOK_AUTH_VALUE,allowDirectN8n:process.env.WEBHOOK_ALLOW_DIRECT_N8N==='true'});
  // Behind a load balancer/reverse proxy set TRUST_PROXY to the number of proxy hops (usually 1) so rate limiting sees real client IPs.
  const trustProxy=process.env.TRUST_PROXY?Number(process.env.TRUST_PROXY):undefined;
  const app=createApp({stores,loadInventory,enrichDoctors:createDoctorEnricher(),sendWebhook},{trustProxy});
  const port=Number(process.env.PORT||3000),host=process.env.HOST||'127.0.0.1';
  return app.listen(port,host,()=>console.log(`Listening on http://${host}:${port}`));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))start().catch(e=>{console.error('Startup failed:',e?.message||'check stores and server-side environment.');process.exit(1);});
