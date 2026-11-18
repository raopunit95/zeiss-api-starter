import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fetchInventory,projectHospitals,validateStores,toPublicHospital,toDoctors,extractRows,fetchDoctorsOfHospital,createDoctorEnricher} from '../inventory.js';
const record=(id,p={})=>({id,Name_of_the_Hospital:'Hospital '+id,City:'Bengaluru',Locality:'Area',Address:'1 Main Rd, Bengaluru - 560001',Pincode:'560001',State:'Karnataka',Speciality:'Ophthalmology',Doctor:'Doctor '+id,Years_of_Experience:'8',OPD_Schedule:'Mon 10-12',Status:'Active',Doctor_Surgeries_Count:0,Distance:1,...p});
const opts={source:'s',xpi:'x',pincode:'560100'};
const response=items=>({ok:true,json:async()=>({isSuccess:true,totalHospitals:100,hospitals:items})});

test('fetches all pages, ignores total and fails closed on duplicate, cap and malformed results',async()=>{
  const offsets=[];const rows=await fetchInventory({...opts,fetchFn:async url=>{const o=Number(url.searchParams.get('offset'));offsets.push(o);return response(o===0?Array.from({length:100},(_,i)=>record(i)):[record(100)]);}});
  assert.equal(rows.length,101);assert.deepEqual(offsets,[0,100]);
  await assert.rejects(fetchInventory({...opts,fetchFn:async()=>response([record(1),record(1)])}),/duplicate/i);
  await assert.rejects(fetchInventory({...opts,maxPages:1,fetchFn:async()=>response(Array.from({length:100},(_,i)=>record(i)))}),/incomplete/i);
  await assert.rejects(fetchInventory({...opts,fetchFn:async()=>({ok:true,json:async()=>({isSuccess:false})})}),/Invalid/);
});
test('50 hospitals after grouping and Zeiss ordering; preserves all listed doctors; no private fields',()=>{
  const rows=Array.from({length:60},(_,i)=>record(i,{Distance:i+1,internal_revenue:'PRIVATE'}));rows.push(record(1000,{Name_of_the_Hospital:'Hospital 55',Distance:56,Doctor_Surgeries_Count:'1'}));rows.push(record(2000,{Name_of_the_Hospital:'Hospital 55',Distance:56}));rows.push(record(3000,{Distance:100.1}));rows.push(record(3001,{Distance:2,Locality:''}));
  const {hospitals,eligibleHospitals,incomplete}=projectHospitals(rows);
  assert.equal(eligibleHospitals,60);assert.equal(hospitals.length,50);assert.equal(hospitals[0].name,'Hospital 55');assert.equal(hospitals[0].doctors.length,3);assert.equal(incomplete,1);
  assert.ok(!JSON.stringify(hospitals.map(toPublicHospital)).includes('PRIVATE'));
});
test('inclusive 100km and exact flag; absent distance not counted as zero',()=>{const x=projectHospitals([record(1,{Distance:100,Doctor_Surgeries_Count:'1.0'}),record(2,{Distance:100.01,Doctor_Surgeries_Count:'1'}),record(3,{Distance:''}),record(4,{Distance:20,Doctor_Surgeries_Count:'10'})]);assert.equal(x.hospitals.length,2);assert.equal(x.hospitals[0].zeiss,true);assert.equal(x.hospitals[1].zeiss,false);assert.equal(x.incomplete,1);});
test('hospital keeps exact lookup fields server-side, one per distinct address, and hides them publicly',()=>{
  const [h]=projectHospitals([record(1,{Pincode:560001})]).hospitals;
  assert.deepEqual(h.lookups,[{Name_of_the_Hospital:'Hospital 1',Address:'1 Main Rd, Bengaluru - 560001',Speciality:'Ophthalmology',Pincode:'560001',State:'Karnataka',City:'Bengaluru'}]);
  assert.equal(h.address,'1 Main Rd, Bengaluru - 560001');assert.equal('lookups' in toPublicHospital(h),false);
  const g=projectHospitals([record(1,{Name_of_the_Hospital:'Same',Address:'No 50, 100 Feet Rd'}),record(2,{Name_of_the_Hospital:'Same',Address:'No.50, 100 Ft Road'}),record(3,{Name_of_the_Hospital:'Same',Address:'No 50, 100 Feet Rd'})]).hospitals;
  assert.equal(g.length,1);assert.equal(g[0].lookups.length,2);assert.equal(g[0].doctors.length,3);
});

const lookup={Name_of_the_Hospital:"Dr. Agarwal's Eye Hospital",Address:'9 Church Rd, Bangalore - 560005',Speciality:'Ophthalmology',Pincode:'560005',State:'Karnataka',City:'Bengaluru'};
test('doctor API: POSTs the exact hospital fields as JSON',async()=>{
  let seen;const rows=await fetchDoctorsOfHospital(lookup,{fetchFn:async(u,o)=>{seen={u,o};return {ok:true,json:async()=>[{Doctor:'A'}]};}});
  assert.equal(String(seen.u),'https://surgery-retool.medibuddy.in/doctor/getDoctorsOfHospital');assert.equal(seen.o.method,'POST');assert.equal(seen.o.headers['content-type'],'application/json');
  assert.deepEqual(JSON.parse(seen.o.body),lookup);assert.equal(rows.length,1);
  await assert.rejects(fetchDoctorsOfHospital({...lookup,Pincode:''},{fetchFn:async()=>{throw Error('should not call');}}),/incomplete/i);
  await assert.rejects(fetchDoctorsOfHospital(lookup,{fetchFn:async()=>({ok:false,status:500})}),e=>e.status===500);
});
test('doctor API: accepts array or wrapped responses; skips inactive and unnamed; dedupes; stable ids',()=>{
  assert.equal(extractRows([{a:1}]).length,1);assert.equal(extractRows({isSuccess:true,doctors:[{a:1},{a:2}]}).length,2);assert.equal(extractRows({data:{rows:[{a:1}]}}).length,1);assert.equal(extractRows({x:1}),null);
  const rows=[{Doctor:'Dr A',Years_of_Experience:'10',OPD_Schedule:'Mon'},{Doctor:'Dr A',OPD_Schedule:'Mon'},{Doctor:'Dr B',Status:'Inactive'},{Years_of_Experience:'3'},{Doctor:'Dr C',Status:'active'}];
  const a=toDoctors(rows,'ref'),b=toDoctors(rows,'ref');
  assert.deepEqual(a.map(d=>d.name),['Dr A','Dr C']);assert.equal(a[0].experienceYears,'10');assert.equal(a[1].schedule,'Not provided');assert.deepEqual(a,b);assert.notEqual(toDoctors(rows,'other')[0].id,a[0].id);
});
test('enricher: merges every address in a group, caches, and falls back safely on failure',async()=>{
  const result=projectHospitals([record(1,{Name_of_the_Hospital:'Hospital 1',Address:'Addr A'}),record(2,{Name_of_the_Hospital:'Hospital 1',Address:'Addr B'}),record(3,{Name_of_the_Hospital:'Other',Locality:'Elsewhere'})]);const logs=[];let calls=0;
  const fetchFn=async(u,o)=>{calls++;const b=JSON.parse(o.body);if(b.Name_of_the_Hospital==='Other')return {ok:false,status:503};
    const docs=b.Address==='Addr A'?[{Doctor:'Dr One'},{Doctor:'Dr Shared'}]:[{Doctor:'Dr Two'},{Doctor:'dr shared'},{Doctor:'Dr Three'}];return {ok:true,json:async()=>({doctors:docs})};};
  const enrich=createDoctorEnricher({fetchFn,log:m=>logs.push(m)});
  let out=await enrich(result);const full=out.hospitals.find(h=>h.name==='Hospital 1'),partial=out.hospitals.find(h=>h.name==='Other');
  assert.deepEqual(full.doctors.map(d=>d.name),['Dr One','Dr Shared','Dr Two','Dr Three']);
  assert.equal(partial.doctors.length,1);assert.equal(logs.length,1);assert.match(logs[0],/1 of 2/);
  const before=calls;out=await enrich(result);assert.equal(calls,before);
});
test('enricher: if one address fails, doctors that did load are kept together with the list-API doctors',async()=>{
  const result=projectHospitals([record(1,{Name_of_the_Hospital:'H',Address:'Addr A'}),record(2,{Name_of_the_Hospital:'H',Address:'Addr B'})]);const logs=[];
  const fetchFn=async(u,o)=>JSON.parse(o.body).Address==='Addr A'?{ok:true,json:async()=>({doctors:[{Doctor:'Dr Loaded'}]})}:{ok:false,status:500};
  const out=await createDoctorEnricher({fetchFn,log:m=>logs.push(m)})(result);
  assert.deepEqual(out.hospitals[0].doctors.map(d=>d.name).sort(),['Doctor 1','Doctor 2','Dr Loaded']);assert.equal(logs.length,1);
});
