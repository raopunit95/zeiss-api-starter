import crypto from 'node:crypto';

const clean = v => String(v ?? '').trim();
const normalize = v => clean(v).normalize('NFKC').replace(/\s+/g,' ').toLocaleLowerCase('en');
const sourceId = r => clean(r.id);
const pick = (r,keys) => { for (const k of keys) { const v = clean(r?.[k]); if (v !== '') return v; } return ''; };
const sha = parts => crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');

const HOSPITAL_URL = 'https://surgery-retool.medibuddy.in/hospital';
const DOCTORS_URL = 'https://surgery-retool.medibuddy.in/doctor/getDoctorsOfHospital';

export function validateStores(input) {
  if (!Array.isArray(input) || !input.length) throw Error('A store list is required');
  const seen = new Set();
  return input.map(x => {
    const id=clean(x.id), name=clean(x.name), pincode=clean(x.pincode);
    if (!id || !name || id.length>100 || name.length>200 || !/^\d{6}$/.test(pincode) || seen.has(id)) throw Error('Invalid store configuration');
    seen.add(id); return {id,name,pincode};
  });
}

// Step 1: hospitals near a pincode (paged list API).
export async function fetchInventory({pincode,source,xpi,fetchFn=fetch,maxPages=20}) {
  if (!/^\d{6}$/.test(pincode)) throw Error('Invalid pincode');
  if (!source || !xpi || /[\r\n]/.test(source+xpi)) throw Error('Inventory credentials missing');
  if (!Number.isInteger(maxPages) || maxPages<1 || maxPages>100) throw Error('Invalid page limit');
  const rows=[], ids=new Set();
  for (let page=0;page<maxPages;page++) {
    const u=new URL(HOSPITAL_URL);
    u.search=new URLSearchParams({city:'null',insurance:'A',limit:'100',offset:String(page*100),pincode,speciality:'Ophthalmology',state:''}).toString();
    const r=await fetchFn(u,{headers:{source,xpi,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!r.ok) throw Error('Inventory unavailable');
    const body=await r.json();
    if(body?.isSuccess!==true || !Array.isArray(body.hospitals) || body.hospitals.length>100) throw Error('Invalid inventory response');
    for(const row of body.hospitals){
      const id=sourceId(row ?? {});
      if (!id || id.length>200 || ids.has(id)) throw Error('Missing or duplicate inventory row reference');
      ids.add(id); rows.push(row);
    }
    if(body.hospitals.length<100) return rows;
  }
  throw Error('Inventory page cap reached; results incomplete');
}

// Names + city + locality are only a provisional grouping, never a canonical provider ID.
export function projectHospitals(rows) {
  const groups=new Map(), seenLookups=new Set(); let incomplete=0;
  for(const r of rows) {
    if(normalize(r.Status)!=='active') continue;
    const name=clean(r.Name_of_the_Hospital),city=clean(r.City),locality=clean(r.Locality),doctor=clean(r.Doctor),id=sourceId(r);
    const rawDistance=clean(r.Distance), distance=rawDistance===''?NaN:Number(rawDistance);
    if(!id || !name || !doctor || !city || !locality || !Number.isFinite(distance) || distance<0) { incomplete++; continue; }
    if(distance>100) continue;
    const key=JSON.stringify([normalize(name),normalize(city),normalize(locality)]);
    const ref=crypto.createHash('sha256').update(key).digest('hex');
    let h=groups.get(key);
    if(!h){
      h={id:ref,name,city,locality,address:clean(r.Address)||[locality,city].filter(Boolean).join(', '),distanceKm:distance,zeiss:false,doctors:[],lookups:[]};
      groups.set(key,h);
    }
    // One full-doctor lookup per distinct address in the group (the list API can hold several
    // records for one hospital name/locality). Server-side only; removed by toPublicHospital().
    const lookup={Name_of_the_Hospital:name,Address:clean(r.Address),Speciality:clean(r.Speciality)||'Ophthalmology',Pincode:clean(r.Pincode),State:clean(r.State),City:city};
    const lk=JSON.stringify([key,normalize(lookup.Address),lookup.Pincode,normalize(lookup.State)]);
    if(!seenLookups.has(lk)){seenLookups.add(lk);h.lookups.push(lookup);}
    h.distanceKm=Math.min(h.distanceKm,distance);
    if(clean(r.Doctor_Surgeries_Count)!=='' && Number(r.Doctor_Surgeries_Count)===1) h.zeiss=true;
    h.doctors.push({id,name:doctor,experienceYears:clean(r.Years_of_Experience)||'Not provided',schedule:clean(r.OPD_Schedule)||'Not provided'});
  }
  const hospitals=[...groups.values()].sort((a,b)=>Number(b.zeiss)-Number(a.zeiss)||a.distanceKm-b.distanceKm||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
  return {hospitals:hospitals.slice(0,50),eligibleHospitals:hospitals.length,incomplete};
}

export const toPublicHospital = ({lookups,...h}) => h;

// Step 2: the full doctor list for one hospital.
const LOOKUP_REQUIRED=['Name_of_the_Hospital','Address','Pincode','State','City'];

// The response may be a bare array or wrapped in an object; find the array of doctor rows.
export function extractRows(body,depth=0) {
  if (Array.isArray(body)) return body;
  if (!body || typeof body!=='object' || depth>2) return null;
  for (const k of ['doctors','Doctors','data','result','results','hospitals']) {
    const found=extractRows(body[k],depth+1); if (found) return found;
  }
  for (const v of Object.values(body)) { const found=extractRows(v,depth+1); if (found) return found; }
  return null;
}

export function toDoctors(rows,hospitalRef) {
  const out=[], seen=new Set();
  for (const r of rows) {
    if (!r || typeof r!=='object') continue;
    const status=clean(r.Status); if (status && normalize(status)!=='active') continue;
    const name=pick(r,['Doctor','Doctor_Name','doctor_name','Name_of_the_Doctor','Name']); if (!name) continue;
    const schedule=pick(r,['OPD_Schedule','Schedule']);
    const id=sha([hospitalRef,clean(r.id),normalize(name),normalize(schedule)]);
    if (seen.has(id)) continue; seen.add(id);
    out.push({id,name,experienceYears:pick(r,['Years_of_Experience','Experience'])||'Not provided',schedule:schedule||'Not provided'});
  }
  return out;
}

export async function fetchDoctorsOfHospital(lookup,{fetchFn=fetch}={}) {
  if (LOOKUP_REQUIRED.some(k=>!clean(lookup?.[k]))) throw Error('Hospital details incomplete for doctor lookup');
  const r=await fetchFn(DOCTORS_URL,{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify(lookup),redirect:'error',signal:AbortSignal.timeout(20000)});
  if (!r.ok) { const e=Error('Doctor lookup unavailable'); e.status=r.status; throw e; }
  const rows=extractRows(await r.json());
  if (!rows) throw Error('Unrecognised doctor response');
  return rows;
}

const dedupeByName = list => { const seen=new Set(); return list.filter(d=>{const k=normalize(d.name); if(seen.has(k))return false; seen.add(k); return true;}); };

// Replaces each hospital's doctor list with the full list from the doctor API (one call per
// distinct address, merged). If any lookup fails, the hospital keeps the doctors from the list
// API plus whatever did load, and the failure is logged once per request.
export function createDoctorEnricher({fetchFn=fetch,ttlMs=300000,failTtlMs=60000,concurrency=5,log=console.warn}={}) {
  const cache=new Map();
  const forLookup=async(lookup,ref)=>{
    const key=sha([ref,lookup]), hit=cache.get(key); if (hit && hit.until>Date.now()) return hit;
    let entry;
    try {
      const doctors=toDoctors(await fetchDoctorsOfHospital(lookup,{fetchFn}),ref);
      if (!doctors.length) throw Error('No doctors returned');
      entry={doctors,until:Date.now()+ttlMs};
    } catch(e) { entry={doctors:null,reason:e?.status??e?.message,until:Date.now()+failTtlMs}; }
    cache.set(key,entry); return entry;
  };
  const forHospital=async h=>{
    const entries=await Promise.all(h.lookups.map(l=>forLookup(l,h.id)));
    const ok=entries.filter(e=>e.doctors), bad=entries.filter(e=>!e.doctors);
    const merged=dedupeByName(ok.flatMap(e=>e.doctors));
    if (!bad.length && merged.length) return {doctors:merged};
    return {doctors:dedupeByName([...merged,...h.doctors]),failed:bad[0]?.reason??'no lookup'};
  };
  return async result=>{
    if (cache.size>2000) for (const [k,v] of cache) if (v.until<Date.now()) cache.delete(k);
    const hospitals=result.hospitals.slice(); let next=0, failed=0, reason;
    const worker=async()=>{ while (next<hospitals.length) {
      const i=next++, r=await forHospital(hospitals[i]);
      hospitals[i]={...hospitals[i],doctors:r.doctors}; if (r.failed!==undefined) { failed++; reason=r.failed; }
    } };
    await Promise.all(Array.from({length:Math.min(concurrency,hospitals.length)},worker));
    if (failed) log(`Full doctor list unavailable for ${failed} of ${hospitals.length} hospitals (${reason}); showing partial lists for those.`);
    return {...result,hospitals};
  };
}
