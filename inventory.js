import crypto from 'node:crypto';

const clean = v => String(v ?? '').trim();
const normalize = v => clean(v).normalize('NFKC').replace(/\s+/g,' ').toLocaleLowerCase('en');
const sourceId = r => clean(r.id);

export function validateStores(input) {
  if (!Array.isArray(input) || !input.length) throw Error('A store list is required');
  const seen = new Set();
  return input.map(x => {
    const id=clean(x.id), name=clean(x.name), pincode=clean(x.pincode);
    if (!id || !name || id.length>100 || name.length>200 || !/^\d{6}$/.test(pincode) || seen.has(id)) throw Error('Invalid store configuration');
    seen.add(id); return {id,name,pincode};
  });
}

export async function fetchInventory({pincode,source,xpi,fetchFn=fetch,maxPages=20}) {
  if (!/^\d{6}$/.test(pincode)) throw Error('Invalid pincode');
  if (!source || !xpi || /[\r\n]/.test(source+xpi)) throw Error('Inventory credentials missing');
  if (!Number.isInteger(maxPages) || maxPages<1 || maxPages>100) throw Error('Invalid page limit');
  const rows=[], ids=new Set();
  for (let page=0;page<maxPages;page++) {
    const u=new URL('https://surgery-retool.medibuddy.in/hospital');
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
  const groups=new Map(); let incomplete=0;
  for(const r of rows) {
    if(normalize(r.Status)!=='active') continue;
    const name=clean(r.Name_of_the_Hospital),city=clean(r.City),locality=clean(r.Locality),doctor=clean(r.Doctor),id=sourceId(r);
    const rawDistance=clean(r.Distance), distance=rawDistance===''?NaN:Number(rawDistance);
    if(!id || !name || !doctor || !city || !locality || !Number.isFinite(distance) || distance<0) { incomplete++; continue; }
    if(distance>100) continue;
    const key=JSON.stringify([normalize(name),normalize(city),normalize(locality)]);
    const ref=crypto.createHash('sha256').update(key).digest('hex');
    let h=groups.get(key);
    if(!h){h={id:ref,name,city,locality,address:[locality,city].filter(Boolean).join(', '),distanceKm:distance,zeiss:false,doctors:[]};groups.set(key,h);}
    h.distanceKm=Math.min(h.distanceKm,distance);
    if(clean(r.Doctor_Surgeries_Count)!=='' && Number(r.Doctor_Surgeries_Count)===1) h.zeiss=true;
    h.doctors.push({id,name:doctor,experienceYears:clean(r.Years_of_Experience)||'Not provided',schedule:clean(r.OPD_Schedule)||'Not provided'});
  }
  const hospitals=[...groups.values()].sort((a,b)=>Number(b.zeiss)-Number(a.zeiss)||a.distanceKm-b.distanceKm||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
  return {hospitals:hospitals.slice(0,50),eligibleHospitals:hospitals.length,incomplete};
}
