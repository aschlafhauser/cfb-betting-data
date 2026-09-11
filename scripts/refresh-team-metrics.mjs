import fs from 'node:fs/promises';

const board=JSON.parse(await fs.readFile('data/weekly-board.json','utf8'));
const season=Number(board.season||2026);
const games=Array.isArray(board.games)?board.games:[];
const selectedNames=[...new Set(games.flatMap(g=>[g.away,g.home]).filter(Boolean))];
const now=new Date().toISOString();
const BASE='https://site.api.espn.com/apis/site/v2/sports/football/college-football';
const UA={'user-agent':'cfb-betting-intelligence-team-metrics/1.0','accept':'application/json'};
const normRaw=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const alias=n=>({pittsburgh:'pitt',pittsburghpanthers:'pitt',connecticut:'uconn',southflorida:'usf',floridainternationaluniversity:'floridainternational'})[n]||n;
const norm=s=>alias(normRaw(s));
const num=v=>{if(v==null||v==='')return null;const n=Number(String(v).replace(/[%,$]/g,''));return Number.isFinite(n)?n:null};
async function get(url){const r=await fetch(url,{headers:UA});if(!r.ok)throw new Error(`${r.status} ${r.statusText} ${url}`);return r.json()}

function directoryTeams(payload){
  const a=payload?.sports?.[0]?.leagues?.[0]?.teams||payload?.teams||[];
  return a.map(x=>x.team||x).filter(Boolean);
}
function labels(t){return [t.displayName,t.shortDisplayName,t.location,t.nickname,t.name,t.abbreviation,t.slug].filter(Boolean)}
function findTeam(dir,name){const q=norm(name);return dir.find(t=>labels(t).some(x=>norm(x)===q))||dir.find(t=>labels(t).some(x=>norm(x).includes(q)||q.includes(norm(x))))||null}

function flattenStats(root){
  const found=[];const seen=new Set();
  const walk=(x,path='')=>{if(!x||typeof x!=='object'||seen.has(x))return;seen.add(x);if(!Array.isArray(x)){
      const name=x.name||x.abbreviation||x.shortDisplayName||x.displayName;
      const value=x.value??x.displayValue??x.perGameValue??x.avg;
      if(name&&value!==undefined&&value!==null&&typeof value!=='object')found.push({path,name:String(name),displayName:String(x.displayName||x.shortDisplayName||name),value,raw:x});
      for(const [k,v] of Object.entries(x))walk(v,path?`${path}.${k}`:k);
    }else x.forEach((v,i)=>walk(v,`${path}[${i}]`));};
  walk(root);return found;
}
function statIndex(payload){const rows=flattenStats(payload),map=new Map();for(const r of rows){for(const k of [r.name,r.displayName]){const nk=normRaw(k);if(nk&&!map.has(nk))map.set(nk,r)}}return {rows,map}}
function pick(idx,names){for(const name of names){const k=normRaw(name);if(idx.map.has(k)){const r=idx.map.get(k),v=num(r.value);if(v!=null)return v}}for(const r of idx.rows){const rn=normRaw(r.name+' '+r.displayName);for(const name of names){const k=normRaw(name);if(k&&rn.includes(k)){const v=num(r.value);if(v!=null)return v}}}return null}

function standardMetrics(payload){
  const idx=statIndex(payload);
  const plays=pick(idx,['offensivePlays','totalOffensivePlays','plays']);
  const totalYards=pick(idx,['totalYards','totalOffense','offensiveYards']);
  const passYards=pick(idx,['passingYards','netPassingYards']);
  const passAtt=pick(idx,['passingAttempts','passAttempts']);
  const rushYards=pick(idx,['rushingYards']);
  const rushAtt=pick(idx,['rushingAttempts','rushAttempts']);
  const firstDowns=pick(idx,['firstDowns']);
  const turnovers=pick(idx,['turnovers','totalTurnovers']);
  const ppg=pick(idx,['pointsPerGame','avgPointsPerGame']);
  const ypg=pick(idx,['yardsPerGame','totalYardsPerGame','totalOffenseYardsPerGame']);
  const passYpg=pick(idx,['passingYardsPerGame','netPassingYardsPerGame']);
  const rushYpg=pick(idx,['rushingYardsPerGame']);
  const third=pick(idx,['thirdDownConversionPct','thirdDownPct','thirdDownConversionPercentage']);
  const rz=pick(idx,['redZonePct','redZonePercentage','redZoneEfficiency']);
  const sacksAllowed=pick(idx,['sacksAllowed']);
  const sacks=pick(idx,['sacks']);
  const oppPpg=pick(idx,['opponentPointsPerGame','pointsAllowedPerGame']);
  const oppYpg=pick(idx,['opponentYardsPerGame','yardsAllowedPerGame']);
  const offense={
    pointsPerGame:ppg,yardsPerGame:ypg,passingYardsPerGame:passYpg,rushingYardsPerGame:rushYpg,
    yardsPerPlay:plays&&totalYards!=null?totalYards/plays:null,
    yardsPerPassAttempt:passAtt&&passYards!=null?passYards/passAtt:null,
    yardsPerRush:rushAtt&&rushYards!=null?rushYards/rushAtt:null,
    thirdDownRate:third==null?null:(third>1?third/100:third),redZoneRate:rz==null?null:(rz>1?rz/100:rz),firstDowns,turnovers,sacksAllowed
  };
  const defense={pointsAllowedPerGame:oppPpg,yardsAllowedPerGame:oppYpg,sacks};
  return {offense,defense,rawStatCount:idx.rows.length};
}

function classifyPlay(p){const txt=String(p?.type?.text||p?.text||p?.shortText||'').toLowerCase();if(/punt|field goal|kickoff|extra point|penalty|timeout|end of|kneel|spike/.test(txt))return null;if(/sack/.test(txt))return 'pass';if(/pass|completion|incomplete|interception/.test(txt))return 'pass';if(/rush|run /.test(txt))return 'rush';return null}
function playYards(p){const v=num(p?.statYardage);if(v!=null)return v;const txt=String(p?.text||'');const m=txt.match(/for (-?\d+) yard/i);return m?Number(m[1]):null}
function isSuccess(p,yards){const down=num(p?.start?.down??p?.down),dist=num(p?.start?.distance??p?.distance);if(down==null||dist==null||yards==null||dist<=0)return null;if(down===1)return yards>=0.5*dist;if(down===2)return yards>=0.7*dist;return yards>=dist}
function playTeamId(p){return String(p?.team?.id||p?.teamId||'')||null}
function completedEvents(schedule){const ev=schedule?.events||schedule?.team?.events||[];return ev.filter(e=>e?.status?.type?.completed||String(e?.status?.type?.state||'').toLowerCase()==='post').map(e=>String(e.id)).filter(Boolean)}
function summaryPlays(s){return s?.plays||s?.drives?.previous?.flatMap?.(d=>d.plays||[])||s?.drives?.flatMap?.(d=>d.plays||[])||[]}

const directory=directoryTeams(await get(`${BASE}/teams?limit=1000`));
const selected=[];const unresolved=[];
for(const name of selectedNames){const t=findTeam(directory,name);if(t)selected.push({name,id:String(t.id),abbr:t.abbreviation||null,displayName:t.displayName||name});else unresolved.push(name)}

const statResults=new Map();
await Promise.all(selected.map(async t=>{try{const payload=await get(`${BASE}/teams/${t.id}/statistics`);statResults.set(t.id,standardMetrics(payload))}catch(e){statResults.set(t.id,{error:String(e.message),offense:{},defense:{},rawStatCount:0})}}));

const schedules=new Map();
await Promise.all(selected.map(async t=>{try{schedules.set(t.id,await get(`${BASE}/teams/${t.id}/schedule?season=${season}&seasontype=2`))}catch(e){schedules.set(t.id,{events:[],error:String(e.message)})}}));
const eventIds=[...new Set([...schedules.values()].flatMap(completedEvents))];
const summaries=new Map();
for(let i=0;i<eventIds.length;i+=10){await Promise.all(eventIds.slice(i,i+10).map(async id=>{try{summaries.set(id,await get(`${BASE}/summary?event=${id}`))}catch(e){summaries.set(id,{error:String(e.message)})}}))}

const advancedByTeam=new Map(selected.map(t=>[t.id,{plays:0,passPlays:0,rushPlays:0,successes:0,successEligible:0,explosivePass:0,explosiveRush:0,sacksAllowed:0,defPlays:0,defSuccesses:0,defSuccessEligible:0,explosivePassAllowed:0,explosiveRushAllowed:0,sacks:0}]));
for(const summary of summaries.values()){
  const plays=summaryPlays(summary);if(!Array.isArray(plays))continue;
  for(const p of plays){const type=classifyPlay(p),teamId=playTeamId(p);if(!type||!teamId)continue;const off=advancedByTeam.get(teamId);if(!off)continue;const yards=playYards(p),succ=isSuccess(p,yards);off.plays++;if(type==='pass')off.passPlays++;else off.rushPlays++;if(succ!=null){off.successEligible++;if(succ)off.successes++}if(type==='pass'&&yards!=null&&yards>=15)off.explosivePass++;if(type==='rush'&&yards!=null&&yards>=10)off.explosiveRush++;if(/sack/i.test(String(p?.type?.text||p?.text||'')))off.sacksAllowed++;
    for(const [defId,def] of advancedByTeam){if(defId===teamId)continue;const competitors=summary?.header?.competitions?.[0]?.competitors||[];if(competitors.some(c=>String(c?.team?.id)===defId)&&competitors.some(c=>String(c?.team?.id)===teamId)){def.defPlays++;if(succ!=null){def.defSuccessEligible++;if(succ)def.defSuccesses++}if(type==='pass'&&yards!=null&&yards>=15)def.explosivePassAllowed++;if(type==='rush'&&yards!=null&&yards>=10)def.explosiveRushAllowed++;if(/sack/i.test(String(p?.type?.text||p?.text||'')))def.sacks++;break;}}
  }
}

const outTeams=selected.map(t=>{const st=statResults.get(t.id)||{offense:{},defense:{}},a=advancedByTeam.get(t.id)||{};const advOff={successRate:a.successEligible?a.successes/a.successEligible:null,explosivePassRate:a.passPlays?a.explosivePass/a.passPlays:null,explosiveRushRate:a.rushPlays?a.explosiveRush/a.rushPlays:null,sackRateAllowed:a.passPlays?a.sacksAllowed/a.passPlays:null};const advDef={successRateAllowed:a.defSuccessEligible?a.defSuccesses/a.defSuccessEligible:null,explosivePassRateAllowed:a.defPlays?a.explosivePassAllowed/a.defPlays:null,explosiveRushRateAllowed:a.defPlays?a.explosiveRushAllowed/a.defPlays:null,sackRate:a.defPlays?a.sacks/a.defPlays:null};return {team:t.name,espnTeamId:t.id,abbr:t.abbr,displayName:t.displayName,offense:{...st.offense,...advOff},defense:{...st.defense,...advDef},units:{QB:{successRate:advOff.successRate,sackRate:advOff.sackRateAllowed},RB:{successRate:advOff.successRate,explosiveRate:advOff.explosiveRushRate},'WR/TE':{explosiveRate:advOff.explosivePassRate},OL:{sackRateAllowed:advOff.sackRateAllowed},DL:{sackRate:advDef.sackRate},LB:{runSuccessRateAllowed:advDef.successRateAllowed},DB:{explosiveRateAllowed:advDef.explosivePassRateAllowed}},context:{plays:a.plays||0,completedGames:completedEvents(schedules.get(t.id)).length},sourceStatus:st.error?'PARTIAL':'ESPN_STANDARD_PLUS_PLAY_DERIVED',error:st.error||null}});
const output={season,week:Number(board.week),updatedAt:now,source:{standard:'ESPN team statistics endpoint',advanced:'Derived from ESPN completed-game play-by-play where available',note:'Success rate uses 50%/70%/100% yards-to-go thresholds by down; explosive pass >=15 yards; explosive rush >=10 yards. EPA/pressure/CPOE are not inferred.'},governance:'Display/research metrics only. No automatic production-fair impact unless separately validated.',coverage:{requestedTeams:selectedNames.length,resolvedTeams:selected.length,unresolvedTeams:unresolved,completedEvents:eventIds.length},teams:outTeams};
await fs.writeFile('data/team-metrics-current.json',JSON.stringify(output,null,2)+'\n');
console.log(`CFB team metrics refreshed: ${selected.length}/${selectedNames.length} teams, ${eventIds.length} completed events, unresolved=${unresolved.length}`);
