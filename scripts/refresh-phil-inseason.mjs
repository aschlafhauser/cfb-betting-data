import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const season=2026;
const specs={
 power:{slug:'power-ratings',url:'https://plus.philsteele.com/fbsinfo/2026/26_Power_Ratings.html'},
 agg:{slug:'average-game-grade',url:'https://plus.philsteele.com/fbsinfo/2026/2026_Average_Game_Grade_Rank.html'},
 pass:{slug:'pass-efficiency-defense',url:'https://plus.philsteele.com/fbsinfo/2026/26_Pass_Eff_Def.html'},
 st:{slug:'special-teams',url:'https://plus.philsteele.com/fbsinfo/2026/2026_Special_Teams.html'}
};
const key=s=>{const k=String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');return k==='sanjosest'?'sanjosestate':k};
const extra={army:'Army West Point',middletenn:'Middle Tennessee',ndakotast:'North Dakota St',nillinois:'Northern Illinois',samhouston:'Sam Houston St',floridaatlantic:'FAU',floridainternational:'FIU',louisianalft:'Louisiana',applalachianst:'Appalachian St',smississippi:'Southern Miss',missst:'Mississippi St',deleware:'Delaware'};
const decode=s=>String(s||'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<br\s*\/?\s*>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/\s+/g,' ').trim();
const tables=html=>[...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(t=>[...t[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(r=>[...r[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(c=>decode(c[1]))));
const num=s=>{assert(/^[+-]?\d+(?:\.\d+)?%?$/.test(String(s||'').trim()),`Invalid numeric cell: ${s}`);return Number(String(s).replace('%',''))};
const rank=s=>/^\d+\.?$/.test(String(s||'').trim());
const previous={},globalNames=new Map();
for(const [k,s] of Object.entries(specs)){
 const path=`data/phil-inseason-${s.slug}-${season}.json`,data=JSON.parse(await fs.readFile(path,'utf8'));
 previous[k]={path,data};
 for(const r of data.rows)for(const n of [r.team,r.sourceTeam].filter(Boolean))globalNames.set(key(n),r.team);
}
const staged=[],retrievedAt=new Date().toISOString();
for(const [k,spec] of Object.entries(specs)){
 const response=await fetch(spec.url,{headers:{'user-agent':'cfb-governed-phil-refresh/1.0'}});
 assert(response.ok,`${k} source HTTP ${response.status}`);
 const html=await response.text(),plain=decode(html),m=plain.match(/Updated:?\s*(\d{1,2})\/(\d{1,2})\/(\d{2})/i);
 assert(m,`Missing published date: ${k}`);
 const sourceDate=`20${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
 assert(sourceDate>=previous[k].data.updatedAt,`Stale ${k} source ${sourceDate}`);
 if(sourceDate===previous[k].data.updatedAt){console.log(`${k}: retained current governed snapshot ${sourceDate}`);continue}
 const parsed=tables(html),local=new Map(previous[k].data.rows.flatMap(r=>[r.team,r.sourceTeam].filter(Boolean).map(n=>[key(n),r.team])));
 const resolve=n=>local.get(key(n))||local.get(key(extra[key(n)]||''))||globalNames.get(key(extra[key(n)]||n));
 const rows=[],seen=new Set();
 const add=(sourceTeam,fields)=>{const resolved=resolve(sourceTeam);assert(resolved,`Unresolved ${k} team: ${sourceTeam}`);const team=key(resolved)==='sanjosestate'?'San José State':resolved;if(seen.has(key(team)))return;seen.add(key(team));rows.push({...fields,team,...(key(sourceTeam)!==key(team)||team!==resolved?{sourceTeam}:{})})};
 if(k==='power'){
   const table=parsed.find(t=>t.some(r=>r.includes('Georgia')&&r.includes('Indiana')));assert(table,'Power table missing');
   for(const r of table)for(const i of [0,4,8])if(r[i]&&/^\d+$/.test(r[i+1]||'')&&/^\d+$/.test(r[i+2]||'')){const start=num(r[i+1]),current=num(r[i+2]);add(r[i],{start,current,delta:current-start})}
 }else if(k==='agg'){
   const table=parsed.find(t=>t.some(r=>r[0]==='1'&&r[1]));assert(table,'AGG table missing');
   for(const r of table)for(const i of [0,4])if(rank(r[i]))add(r[i+1],{rank:num(r[i]),agg:num(r[i+2])});
 }else{
   const width=k==='st'?17:10,table=parsed.find(t=>t.filter(r=>r.length===width&&rank(r[0])).length>=130);assert(table,`${k} table missing`);
   for(const r of table){if(r.length!==width||!rank(r[0]))continue;const fields=k==='pass'?['yards','att','comp','compPct','td','int','grade','opp']:['stIncK','netPunts','prOff','oppNetP','krOff','oppNetKo','netKo','td','stRating','stRank','kickerRating','kickerRank','fgTotal','fgPct','fg50Plus'];const row={rank:num(r[0].replace('.',''))};fields.forEach((f,i)=>row[f]=['fgTotal','fg50Plus'].includes(f)?r[i+2]:num(r[i+2]));add(r[1],row)}
 }
 assert.equal(rows.length,138,`${k} coverage`);assert.equal(seen.size,138,`${k} unique coverage`);
 assert.deepEqual(new Set(rows.map(r=>key(r.team))),new Set(previous[k].data.rows.map(r=>key(r.team))),`${k} team namespace changed`);
 for(const r of rows){if(k==='power')assert(r.start>=50&&r.start<=180&&r.current>=50&&r.current<=180,`Power outlier ${r.team}`);if(k==='agg')assert(r.agg>0&&r.agg<200,`AGG outlier ${r.team}`);if(k==='pass')assert(r.comp<=r.att&&r.compPct>=0&&r.compPct<=100&&Math.abs(100*r.comp/r.att-r.compPct)<=.055,`Pass arithmetic ${r.team}`)}
 staged.push({path:previous[k].path,data:{...previous[k].data,updatedAt:sourceDate,retrievedAt,source:'Phil Steele governed current-season public Plus table',sourceUrl:spec.url,rows}});
 console.log(`${k}: staged ${rows.length} teams from ${sourceDate}`);
}
for(const x of staged)await fs.writeFile(x.path,JSON.stringify(x.data)+'\n');
console.log(`Phil in-season refresh complete: ${staged.length} newer table(s) ingested`);
