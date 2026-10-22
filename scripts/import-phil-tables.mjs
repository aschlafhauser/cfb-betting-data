// Usage: node scripts/import-phil-tables.mjs /absolute/path/to/browser-capture.json
// Capture: {power,pass,agg,st,off,def,offavg,defavg}, each {url,header?,tables:[rows]}.
// Rows contain cell innerText. AGG table 0 is full-season; table 1 is L4W.
// Keep raw authenticated-page captures outside the public repository.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
assert(process.argv[2],'Provide the browser table capture JSON path');
const raw=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const names={power:'power-ratings',pass:'pass-efficiency-defense',agg:'average-game-grade',st:'special-teams',off:'offensive-ypp',def:'defensive-ypp',offavg:'off-yards-vs-opp-avg',defavg:'def-yards-vs-opp-avg'};
const key=s=>String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const extra={army:'Army West Point',middletenn:'Middle Tennessee',ndakotast:'North Dakota St',nillinois:'Northern Illinois',samhouston:'Sam Houston St',floridaatlantic:'FAU',floridainternational:'FIU',louisianalft:'Louisiana',applalachianst:'Appalachian St',smississippi:'Southern Miss',missst:'Mississippi St',deleware:'Delaware'};
const previous={},globalNames=new Map();
for(const [k,n] of Object.entries(names)){
 const path=`data/phil-inseason-${n}-2026.json`,data=JSON.parse(await fs.readFile(path,'utf8'));previous[k]={path,data};
 for(const r of data.rows)for(const s of [r.team,r.sourceTeam].filter(Boolean))globalNames.set(key(s),r.team);
}
const num=s=>{assert(typeof s==='string'&&/^[+-]?\d+(?:\.\d+)?%?$/.test(s.trim()),`Invalid numeric cell: ${s}`);return Number(s.replace('%',''));};
const rank=s=>/^\d+\.?$/.test(s||'');
const result=[],now=new Date().toISOString();
for(const [k] of Object.entries(names)){
 const capture=raw[k];assert(capture&&capture.tables?.length,`Missing ${k} capture`);
 assert.equal(capture.url,previous[k].data.sourceUrl,`Unexpected ${k} source URL`);
 const head=(capture.header||'')+' '+capture.tables.flat(2).join(' ');
 const date=head.match(/Updated:?\s*(\d{1,2})\/(\d{1,2})\/(\d{2})/i);assert(date,`Missing published date: ${k}`);
 const sourceDate=`20${date[3]}-${date[1].padStart(2,'0')}-${date[2].padStart(2,'0')}`;
 assert(sourceDate>=previous[k].data.updatedAt,`Stale ${k} source`);
 const localNames=new Map(previous[k].data.rows.flatMap(r=>[r.team,r.sourceTeam].filter(Boolean).map(s=>[key(s),r.team])));
 const resolve=s=>localNames.get(key(s))||localNames.get(key(extra[key(s)]||''))||globalNames.get(key(extra[key(s)]||s));
 const rows=[];
 const add=(sourceTeam,fields)=>{const team=resolve(sourceTeam);assert(team,`Unresolved ${k} team: ${sourceTeam}`);rows.push({...fields,team,...(key(sourceTeam)!==key(team)?{sourceTeam}:{})});};
 if(k==='power'){
  for(const r of capture.tables[1])for(const i of [0,4,8])if(r[i]&&/^\d+$/.test(r[i+1]||'')&&/^\d+$/.test(r[i+2]||'')){const start=num(r[i+1]),current=num(r[i+2]);add(r[i],{start,current,delta:current-start});}
 }else if(k==='agg'){
  for(const r of capture.tables[0])for(const i of [0,4])if(rank(r[i]))add(r[i+1],{rank:num(r[i]),agg:num(r[i+2])});
 }else{
  const width=k==='st'?17:k==='pass'?10:k.endsWith('avg')?3:6;
  const tables=capture.tables.filter(t=>t.some(r=>r.length===width&&(k.endsWith('avg')?rank(r[1]):rank(r[0]))));assert.equal(tables.length,1,`Ambiguous ${k} table`);
  for(const r of tables[0]){
   if(k.endsWith('avg')){if(rank(r[1]))add(r[0],{rank:num(r[1]),average:num(r[2])});continue;}
   if(!rank(r[0]))continue;assert.equal(r.length,width,`${k} row width`);
   const fields=k==='pass'?['yards','att','comp','compPct','td','int','grade','opp']:k==='st'?['stIncK','netPunts','prOff','oppNetP','krOff','oppNetKo','netKo','td','stRating','stRank','kickerRating','kickerRank','fgTotal','fgPct','fg50Plus']:['rushAtt','passAtt','yards','ypp'];
   const row={rank:num(r[0].replace('.',''))};fields.forEach((f,i)=>row[f]=['fgTotal','fg50Plus'].includes(f)?r[i+2]:num(r[i+2]));add(r[1],row);
  }
 }
 assert.equal(rows.length,138,`${k} coverage`);assert.equal(new Set(rows.map(r=>key(r.team))).size,138,`${k} duplicate team`);
 assert.deepEqual(new Set(rows.map(r=>key(r.team))),new Set(previous[k].data.rows.map(r=>key(r.team))),`${k} team coverage changed`);
 if(k!=='power'){
  const ordered=[...rows].sort((a,b)=>a.rank-b.rank);
  for(let i=0;i<ordered.length;i++){
   const r=ordered[i],p=ordered[i-1];
   // Source competition ranks may tie only when their displayed metric also ties.
   assert(r.rank===i+1||(k.endsWith('avg')&&p&&r.rank===p.rank&&r.average===p.average),`${k} rank coverage at ${r.team}`);
  }
 }
 for(const r of rows){
  if(k==='power')assert(r.start>=50&&r.start<=180&&r.current>=50&&r.current<=180,`Power outlier: ${r.team}`);
  if(k==='agg')assert(r.agg>0&&r.agg<200,`AGG outlier: ${r.team}`);
  if(k==='off'||k==='def')assert(r.ypp>0&&r.ypp<15&&Math.abs(r.yards/(r.rushAtt+r.passAtt)-r.ypp)<=0.055,`YPP arithmetic: ${r.team}`);
  if(k==='pass')assert(r.comp<=r.att&&r.compPct>=0&&r.compPct<=100&&Math.abs(100*r.comp/r.att-r.compPct)<=0.055,`Pass arithmetic: ${r.team}`);
  if(k.endsWith('avg'))assert(Math.abs(r.average)<500,`Opponent average outlier: ${r.team}`);
 }
 result.push({path:previous[k].path,data:{...previous[k].data,updatedAt:sourceDate,retrievedAt:now,rows}});
 console.log(`${k}: PASS — ${rows.length} unique teams, source ${sourceDate}`);
}
// Validate all eight before writing any dataset.
for(const {path,data} of result)await fs.writeFile(path,JSON.stringify(data)+'\n');
console.log('Eight tables imported. Publish and run governed-runtime/live Phil verification.');
