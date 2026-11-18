// Diagnostic: shows what the two upstream APIs return, so field names can be verified.
// Usage: npm run check:doctors -- 560008
import {fetchInventory,projectHospitals,fetchDoctorsOfHospital,toDoctors} from '../inventory.js';
const pincode=process.argv[2]||'560008';
const rows=await fetchInventory({pincode,source:process.env.INVENTORY_SOURCE,xpi:process.env.INVENTORY_XPI});
console.log(`List API: ${rows.length} rows. Fields on first row:`,Object.keys(rows[0]??{}).join(', '));
const {hospitals}=projectHospitals(rows);
const h=hospitals[0]; if(!h){console.log('No eligible hospitals for this pincode.');process.exit(0);}
console.log('\nFirst hospital:',h.name,'| doctors from list API:',h.doctors.length);
console.log('Lookups sent:',h.lookups.length,JSON.stringify(h.lookups[0]));
try{
  const body=await fetchDoctorsOfHospital(h.lookups[0]);
  const doctors=toDoctors(body,h.id);
  console.log('\nDoctor API rows:',body.length,'| fields on first row:',Object.keys(body[0]??{}).join(', '));
  console.log('Doctors parsed:',doctors.length);
  for(const d of doctors.slice(0,5))console.log(' -',d.name,'|',d.experienceYears,'|',d.schedule);
}catch(e){console.error('\nDoctor API failed:',e.message,e.status?`(HTTP ${e.status})`:'');process.exit(1);}
