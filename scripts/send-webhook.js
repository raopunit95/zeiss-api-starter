// One-shot SYNTHETIC test: POSTs a fake record to WEBHOOK_URL using the same sender the server uses.
// Run:  node --env-file=.env scripts/send-webhook.js
import {randomUUID} from 'node:crypto';
import {createWebhookSender} from '../webhook.js';

if(process.env.WEBHOOK_SYNTHETIC_ONLY!=='true'){console.error('Set WEBHOOK_SYNTHETIC_ONLY=true (synthetic data only).');process.exit(1);}
const send=createWebhookSender({url:process.env.WEBHOOK_URL,gatewayKey:process.env.WEBHOOK_GATEWAY_KEY,authHeader:process.env.WEBHOOK_AUTH_HEADER,authValue:process.env.WEBHOOK_AUTH_VALUE,allowDirectN8n:process.env.WEBHOOK_ALLOW_DIRECT_N8N==='true'});
const record={submitted_at_utc:new Date().toISOString(),store_id:'sample-store',store_name:'Sample Store - Electronic City (example)',store_pincode:'560100',hospital_group_ref:'synthetic-hospital-ref',hospital_name:'SYNTHETIC TEST HOSPITAL',hospital_city:'Bengaluru',hospital_locality:'Test Locality',doctor_source_row_ref:'synthetic-row-1',doctor_name:'SYNTHETIC TEST DOCTOR',patient_name:'Synthetic Person',phone:'9876543210',preferred_date:'2099-01-01',preferred_slot:'Morning',reason:'synthetic webhook test',consent:'Yes'};
const id=randomUUID();
try{const r=await send(record,id);console.log('OK - HTTP '+r.status+' - request_id '+r.requestId);}
catch(e){console.error('FAILED -',e.message,e.status?('(HTTP '+e.status+')'):('('+(e.cause?.code||e.name)+')'));process.exit(1);}
