import fs from 'node:fs/promises';
const p='data/team-metrics-current.json';
const data=JSON.parse(await fs.readFile(p,'utf8'));
const season=Number(data.season||2026), teams=data.teams||[];
const BASE='https://site.api.espn.com/apis/site/v2/sports/football/college-football';
const H={'user-agent':'cfb-team-metrics/1.0','accept':'application/json'};
const num=v=>{if(v==null||v==='')return null;const m=String(v).match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):null};
async function get(url){const r=await fetch(url,{headers:H});if(!r.ok)throw new Error(`${r.status} ${url}`);return r.json()}
function completeEvents(s){return (s?.events||[]).filter(e=>{const t=e?.status?.type||e?.competitions?.[0]?.status?.type||{};return !!t.completed||String(t.state||'').toLowerCase()==='post'||/final/i.test(String(t.name||t.description||t.detail||''))}).map(e=>String(e.id||e?.competitions?.[0]?.id||'')).filter(Boolean)}
function statMap(side){const m=new Map();for(const s of side?.statistics||[]){const k=String(s.name||s.abbreviation||s.displayName||'').toLowerCase().replace(/[^a-z0-9]/g,'');if(k)m.set(k,s.displayValue??s.value??null)}return m}
function pick(m,names){for(const n of names){const k=n.toLowerCase().replace(/[^a-z0-9]/g,'');if(m.has(k))return m.get(k)}return null}
const selected=new Set(teams.map(t=>String(t.espnTeamId)));
const schedules=new Map();
await Promise.all(teams.map(async t=>{try{schedules.set(String(t.espnTeamId),await get(`${BASE}/teams/${t.espnTeamId}/schedule?season=${season}&seasontype=2`))}catch{schedules.set(String(t.espnTeamId),{events:[]})}}));
const events=[...new Set([...schedules.values()].flatMap(completeEvents))], sums=new Map();
for(let i=0;i<events.length;i+=12)await Promise.all(events.slice(i,i+12).map(async id=>{try{sums.set(id,await get(`${BASE}/summary?event=${id}`))}catch{}}));
const agg=new Map([...selected].map(id=>[id,{games:0,points:0,yards:0,pass:0,rush:0,plays:0,thirdMade:0,thirdAtt:0,haveYards:0,havePass:0,haveRush:0,havePlays:0,haveThird:0}]));
for(const s of sums.values()){
  const comps=s?.header?.competitions?.[0]?.competitors||[], box=s?.boxscore?.teams||[]; if(comps.length<2)continue;
  for(const c of comps){const id=String(c?.team?.id||'');if(!agg.has(id))continue;const opp=comps.find(x=>String(x?.team?.id||'')!==id);if(!opp)continue;const om=statMap(box.find(x=>String(x?.team?.id||'')===String(opp?.team?.id||''))),a=agg.get(id);a.games++;const ps=num(opp.score);if(ps!=null)a.points+=ps;const y=num(pick(om,['totalYards','totalOffense']));if(y!=null){a.yards+=y;a.haveYards++}const py=num(pick(om,['netPassingYards','passingYards']));if(py!=null){a.pass+=py;a.havePass++}const ry=num(pick(om,['rushingYards']));if(ry!=null){a.rush+=ry;a.haveRush++}const pl=num(pick(om,['totalPlays','offensivePlays']));if(pl!=null){a.plays+=pl;a.havePlays++}const third=String(pick(om,['thirdDownEff','thirdDownEfficiency','thirdDownConversions'])||'').match(/(\d+)\s*[-/]\s*(\d+)/);if(third){a.thirdMade+=Number(third[1]);a.thirdAtt+=Number(third[2]);a.haveThird++}}
}
for(const t of teams){const a=agg.get(String(t.espnTeamId));if(!a?.games)continue;t.defense=t.defense||{};t.defense.pointsAllowedPerGame=a.points/a.games;if(a.haveYards)t.defense.yardsAllowedPerGame=a.yards/a.haveYards;if(a.havePass)t.defense.passingYardsAllowedPerGame=a.pass/a.havePass;if(a.haveRush)t.defense.rushingYardsAllowedPerGame=a.rush/a.haveRush;if(a.haveYards&&a.havePlays&&a.plays)t.defense.yardsPerPlayAllowed=a.yards/a.plays;if(a.haveThird&&a.thirdAtt)t.defense.thirdDownRateAllowed=a.thirdMade/a.thirdAtt;t.context=t.context||{};t.context.defenseBoxscoreGames=a.games;}
data.source=data.source||{};data.source.defense='Derived from opponent ESPN completed-game box scores; missing values remain null.';data.updatedAt=new Date().toISOString();await fs.writeFile(p,JSON.stringify(data,null,2)+'\n');console.log(`Defense metrics enriched from ${sums.size} ESPN game summaries for ${teams.filter(t=>t.context?.defenseBoxscoreGames).length}/${teams.length} teams.`);
