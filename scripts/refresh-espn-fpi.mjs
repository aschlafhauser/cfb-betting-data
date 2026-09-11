import fs from 'node:fs/promises';

const board=JSON.parse(await fs.readFile('data/weekly-board.json','utf8'));
const metrics=JSON.parse(await fs.readFile('data/team-metrics-current.json','utf8'));
const season=Number(board.season||2026);
const url=`https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/${season}/powerindex?limit=250&lang=en&region=us`;
const headers={'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36','accept':'application/json,text/plain,*/*','origin':'https://www.espn.com','referer':'https://www.espn.com/'};
const r=await fetch(url,{headers});
if(!r.ok)throw new Error(`ESPN FPI fetch failed: HTTP ${r.status}`);
const payload=await r.json();
const nameById=new Map((metrics.teams||[]).map(t=>[String(t.espnTeamId),{team:t.team,abbr:t.abbr,displayName:t.displayName}]));
const val=(arr,names)=>{for(const x of arr||[]){if(names.includes(String(x?.name||'').toLowerCase())){const z=Number(x.value);return Number.isFinite(z)?z:null}}return null};
const display=(arr,names)=>{for(const x of arr||[]){if(names.includes(String(x?.name||'').toLowerCase()))return x.displayValue??null}return null};
const allRows=[];
for(const it of payload.items||[]){
  const teamRef=it?.team?.$ref||'';
  const teamId=(teamRef.match(/\/teams\/(\d+)/)||[])[1]||null;
  if(!teamId)continue;
  const meta=nameById.get(String(teamId))||{};
  const predictive=Array.isArray(it.predictives)?it.predictives:[];
  const efficiency=Array.isArray(it.efficiencies)?it.efficiencies:[];
  const flat=[...predictive,...efficiency];
  const stats={};
  for(const s of flat){if(!s?.name)continue;stats[s.name]={value:Number.isFinite(Number(s.value))?Number(s.value):null,displayValue:s.displayValue??null,displayName:s.displayName??s.name,description:s.description??null,group:predictive.includes(s)?'predictive':'efficiency'}}
  allRows.push({
    teamId:String(teamId),team:meta.team||null,abbr:meta.abbr||null,displayName:meta.displayName||null,
    fpi:val(predictive,['fpi']),fpiDisplay:display(predictive,['fpi']),
    offenseEfficiency:val(efficiency,['offefficiency','offensiveefficiency','offenseefficiency']),
    defenseEfficiency:val(efficiency,['defefficiency','defensiveefficiency','defenseefficiency']),
    specialTeamsEfficiency:val(efficiency,['stefficiency','specialteamsefficiency','specialteamsefficiency']),
    stats
  });
}
if(allRows.length<100)throw new Error(`ESPN FPI coverage unexpectedly low: ${allRows.length}`);
const named=allRows.filter(x=>x.team).length;
const output={season,week:Number(board.week),updatedAt:new Date().toISOString(),source:{provider:'ESPN',name:'College Football Power Index',endpoint:url,description:'ESPN FPI and published efficiency components. FPI is on a points-above/below-average scale; ESPN efficiency components are opponent-adjusted inputs to the FPI system.'},governance:'Independent model/display input. Market spread is never used to construct FPI. Missing values remain null.',coverage:{rows:allRows.length,namedRows:named},teams:allRows};
await fs.writeFile('data/espn-fpi-current.json',JSON.stringify(output,null,2)+'\n');
console.log(`ESPN FPI refreshed: ${allRows.length} teams, ${named} joined to selected-week team directory.`);
