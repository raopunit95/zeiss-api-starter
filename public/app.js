const $ = s => document.querySelector(s);
const store=$('#store'), results=$('#results'), status=$('#status'), sync=$('#sync'), dialog=$('#booking'), form=$('#form');
let chosen=null, sequence=0, submitting=false;
function el(tag,cls,text){const x=document.createElement(tag); if(cls)x.className=cls; if(text!==undefined)x.textContent=text; return x;}
async function get(url){const r=await fetch(url); const d=await r.json(); if(!r.ok)throw new Error(d.error || 'Unable to load data'); return d;}
function draw(hospitals){ results.replaceChildren(); for(const h of hospitals){
  const card=el('article','hospital'), top=el('div','hospital-top'), info=el('div'), title=el('h2','',h.name), addr=el('p','address',h.address), badges=el('div','badges');
  info.append(title,addr); if(h.zeiss === true)badges.append(el('span','badge zeiss','ZEISS')); badges.append(el('span','badge',`≈ ${h.distanceKm.toFixed(1)} km from store pincode`)); top.append(info,badges); card.append(top);
  const list=el('div','doctor-list'); for(const d of h.doctors){const row=el('div','doctor'), desc=el('div'), name=el('h3','',d.name), meta=el('p','doctor-meta',`${/^[0-9.]+$/.test(String(d.experienceYears)) ? d.experienceYears+' years' : d.experienceYears} experience · OPD: ${d.schedule} · `);meta.append(el('span','active','Active'));desc.append(name,meta);row.append(desc);const button=el('button','button primary','Request appointment');button.type='button';button.addEventListener('click',()=>openBooking(h,d));row.append(button);list.append(row);} card.append(list);results.append(card);
} }
function todayIST(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function openBooking(h,d){chosen={storeId:store.value,hospitalId:h.id,doctorId:d.id,hospitalName:h.name,doctorName:d.name};form.reset();$('#date').min=todayIST();$('#selection').textContent=`${d.name} · ${h.name}`;$('#form-status').textContent='';$('#form-status').className='';$('#submit').disabled=false;$('#submit').textContent='Submit request';dialog.showModal();}
$('#close').addEventListener('click',()=>{if(!submitting)dialog.close();});
dialog.addEventListener('cancel',e=>{if(submitting)e.preventDefault();});
async function loadHospitals(showLoading=true){const id=++sequence;if(showLoading){results.replaceChildren();sync.textContent='';}if(!store.value){status.textContent='Select a store to see nearby hospitals.';return;}if(showLoading)status.textContent='Finding hospitals…';try{const d=await get('/api/hospitals?store='+encodeURIComponent(store.value));if(id!==sequence)return;draw(d.hospitals);status.textContent=d.hospitals.length ? `Showing ${d.hospitals.length} of ${d.eligibleHospitals} matching hospitals within approximately 100 km (maximum 50).` : 'No matching hospitals found within approximately 100 km.';const time=new Date(d.syncedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'});sync.textContent=`Inventory retrieved: ${time} IST. Distances are based on the store pincode, not its exact location.${d.incomplete ? ` ${d.incomplete} incomplete source row(s) were excluded.` : ''}`;sync.className='sync'+(d.incomplete?' warning':'');}catch(e){if(id===sequence){results.replaceChildren();sync.textContent='';status.textContent=e.message;}}}
store.addEventListener('change',()=>void loadHospitals());
setInterval(()=>{if(store.value && !dialog.open && $('#confirmation').hidden)void loadHospitals(false);},60000);
function showReceipt(x){
  const fields={doctor:x.doctorName,hospital:x.hospitalName,date:x.date,slot:x.slot,name:x.name,phone:x.phone};
  for(const [key,value] of Object.entries(fields))$('#receipt-'+key).textContent=value;
  dialog.close(); $('#search-view').hidden=true; $('#confirmation').hidden=false;
  $('#receipt-title').focus(); window.scrollTo(0,0);
}
$('#done').addEventListener('click',()=>{
  for(const key of ['doctor','hospital','date','slot','name','phone'])$('#receipt-'+key).textContent='';
  $('#confirmation').hidden=true; $('#search-view').hidden=false;
  store.focus();
});
form.addEventListener('submit',async e=>{
  e.preventDefault(); if(!chosen || submitting)return;
  submitting=true; let uncertain=false; const btn=$('#submit'), out=$('#form-status'); btn.disabled=true; $('#close').disabled=true;
  out.textContent='Submitting…'; out.className='';
  const f=new FormData(form), selection=chosen;
  const values={name:String(f.get('name')).trim(),phone:String(f.get('phone')).trim(),date:f.get('date'),slot:f.get('slot'),reason:f.get('reason'),consent:f.get('consent')==='on'};
  try{
    const r=await fetch('/api/requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:selection.storeId,hospitalId:selection.hospitalId,doctorId:selection.doctorId,...values})});
    if(r.status!==201){const d=await r.json().catch(()=>({}));uncertain=!!d.deliveryUncertain || r.status>=500;out.textContent=(d.error || 'We could not confirm submission. Check with the care team before retrying; your request may have been received.')+(d.requestId ? ` Reference: ${d.requestId}` : '');return;}
    form.reset(); chosen=null; showReceipt({...selection,...values});
  }catch{uncertain=true;out.textContent='We could not confirm submission. Check with the care team before retrying; your request may have been received.';}
  finally{submitting=false;btn.disabled=uncertain;$('#close').disabled=false;}
});
(async()=>{try{const d=await get('/api/stores');for(const s of d.stores){const o=el('option','',s.name);o.value=s.id;store.append(o);}}catch(e){status.textContent=e.message;store.disabled=true;}})();
