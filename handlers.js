import {randomUUID} from 'node:crypto';
import {projectHospitals,toPublicHospital} from './inventory.js';
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

// Request logic as plain functions (no Express), so it can be unit-tested directly.
export function createHandlers({stores,loadInventory,enrichDoctors=async r=>r,sendWebhook,now=()=>new Date()}){
  const load=async store=>enrichDoctors(projectHospitals(await loadInventory(store)));
  const attempts=new Map();
  return {
    stores:()=>({status:200,body:{stores:stores.map(({id,name})=>({id,name}))}}),
    async hospitals(storeId){
      const store=stores.find(s=>s.id===storeId);if(!store)return {status:400,body:{error:'Choose a valid store.'}};
      try{const r=await load(store);return {status:200,body:{...r,hospitals:r.hospitals.map(toPublicHospital),syncedAt:now().toISOString()}};}
      catch{return {status:503,body:{error:'Hospital data is unavailable or incomplete. Please try again later.'}};}
    },
    async submit(body,ip){
      const t=Date.now();for(const [k,v] of attempts)if(v.until<t)attempts.delete(k);
      const x=attempts.get(ip);if(x?.count>=10)return {status:429,body:{error:'Too many requests. Please try again later.'}};
      attempts.set(ip,x&&x.until>t?{...x,count:x.count+1}:{count:1,until:t+600000});
      const store=stores.find(s=>s.id===body?.storeId);if(!store)return {status:400,body:{error:'Choose a valid store.'}};
      let result;try{result=await load(store);}catch{return {status:503,body:{error:'Hospital data is unavailable; request not submitted.'}};}
      let record;try{record=validateRequest(body,stores,result,now());}catch(e){return {status:400,body:{error:e.message}};}
      const requestId=randomUUID();
      try{await sendWebhook(record,requestId);return {status:201,body:{message:'Your request has been submitted. It is not a confirmed appointment until confirmed by the care team.',requestId}};}
      catch(err){console.error('Request delivery not confirmed:',err?.status??err?.name??'unknown error');return {status:502,body:{error:'We could not confirm that your request was received. It may have been received, so please check before submitting again.',requestId,deliveryUncertain:true}};}
    }
  };
}

