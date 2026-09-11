import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const portal=process.env.CFB_PORTAL_URL||'https://cfb-betting-intelligence.netlify.app/';
const board=JSON.parse(await fs.readFile('data/weekly-board.json','utf8'));
const metrics=JSON.parse(await fs.readFile('data/team-metrics-current.json','utf8').catch(()=>'{"teams":[]}'));
const registry=await fetch(`${portal.replace(/\/$/,'')}/data/team-identity-registry.json?v=${Date.now()}`,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`registry ${r.status}`);return r.json()});
const raw=s=>String(s||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
const aliasToCanonical=new Map(), canonicalToRecord=new Map(), ambiguous=[];
for(const rec of registry.teams||[]){
  canonicalToRecord.set(raw(rec.canonical),rec);
  for(const a of [rec.canonical,...(rec.aliases||[])]){
    const k=raw(a),prior=aliasToCanonical.get(k);
    if(prior&&prior!==rec.canonical)ambiguous.push({alias:a,canonical:[prior,rec.canonical]});
    aliasToCanonical.set(k,rec.canonical);
  }
}
const canon=s=>aliasToCanonical.get(raw(s))||String(s||'').trim();
const ckey=s=>raw(canon(s));
const boardTeams=[...new Set((board.games||[]).flatMap(g=>[g.away,g.home]).filter(Boolean))];
const statsByCanon=new Map();
for(const t of metrics.teams||[]){const k=ckey(t.team);if(!statsByCanon.has(k))statsByCanon.set(k,[]);statsByCanon.get(k).push(t)}

const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const browserErrors=[];page.on('pageerror',e=>browserErrors.push(e.message));
await page.goto(`${portal}?identity=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:120000});
await page.waitForFunction(()=>window.CFB_TEAM_IDENTITY&&window.CFB_TEAM_IDENTITY.status!=='bootstrap',{timeout:30000}).catch(()=>{});
await page.waitForTimeout(500);
const portalState=await page.evaluate(()=>{
  const groups=['QB','RB','WR/TE','OL','DL','LB','DB','ST'];
  const all=typeof allTeams!=='undefined'&&Array.isArray(allTeams)?allTeams.slice():[];
  const keys={};
  for(const name of ['publicContinuity','philPowerPoll2026','philReturningStarterPoints2026','philAllConferencePoints2026','teamProfiles','teamNotes']){
    try{const obj=eval(name);keys[name]=obj&&typeof obj==='object'?Object.keys(obj):[]}catch{keys[name]=[]}
  }
  const probe=name=>{
    let ranked=[];try{if(typeof philUnitRank==='function')ranked=groups.map(g=>[g,philUnitRank(name,g)]).filter(([,r])=>r!=null)}catch{}
    let profile=null;try{if(typeof philNationalProfile==='function')profile=philNationalProfile(name)||null}catch{}
    return {ranked,hasProfile:!!profile};
  };
  return {allTeams:all,keys,identityStatus:window.CFB_TEAM_IDENTITY?.status||'missing',registryVersion:window.CFB_TEAM_IDENTITY?.registry?.version||null,probes:Object.fromEntries(all.map(n=>[n,probe(n)]))};
});
await browser.close();

const fbsByCanon=new Map();
for(const n of portalState.allTeams||[]){const k=ckey(n);if(!fbsByCanon.has(k))fbsByCanon.set(k,[]);fbsByCanon.get(k).push(n)}
const philKeyUniverse=[...new Set(Object.values(portalState.keys||{}).flat())];
const philKeyByCanon=new Map();for(const n of philKeyUniverse){const k=ckey(n);if(!philKeyByCanon.has(k))philKeyByCanon.set(k,[]);philKeyByCanon.get(k).push(n)}

function tokenSet(s){return new Set(String(s||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(x=>x.length>2&&!['university','state','college','the'].includes(x)))}
function aliasCandidates(name,pool){const a=tokenSet(name),out=[];for(const p of pool){const b=tokenSet(p),inter=[...a].filter(x=>b.has(x)).length,den=Math.max(a.size,b.size,1),score=inter/den;if(score>=0.5&&score>0)out.push({name:p,score:Number(score.toFixed(2))})}return out.sort((x,y)=>y.score-x.score).slice(0,4)}

const rows=[],failures=[];
for(const team of boardTeams){
  const key=ckey(team),rec=canonicalToRecord.get(key)||null,stats=statsByCanon.get(key)||[],fbs=fbsByCanon.get(key)||[],philKeys=philKeyByCanon.get(key)||[];
  const explicitPhil=rec?.sources?.phil||null;
  const probeNames=[...new Set([...fbs,explicitPhil,team].filter(Boolean))];
  let rankedUnits=[];let hasProfile=false;
  for(const n of probeNames){const p=portalState.probes?.[n];if(p){rankedUnits.push(...(p.ranked||[]));hasProfile=hasProfile||p.hasProfile}}
  const isPhilApplicable=fbs.length>0||!!explicitPhil||philKeys.length>0;
  const status={team,canonical:canon(team),registry:!!rec,statsMatches:stats.length,fbsMatches:fbs,philKeys,philApplicable:isPhilApplicable,rankedUnitCount:new Set(rankedUnits.map(x=>x[0])).size,hasPhilProfile:hasProfile};
  if(stats.length!==1){status.statsStatus=stats.length===0?'UNRESOLVED':'AMBIGUOUS';failures.push(`TEAM_IDENTITY_${status.statsStatus}: ${team} -> ESPN stats (${stats.length})`)}else status.statsStatus='PASS';
  if(isPhilApplicable){
    const philResolved=fbs.length===1||philKeys.length>0||!!explicitPhil;
    if(!philResolved){status.philStatus='UNRESOLVED';failures.push(`TEAM_IDENTITY_UNRESOLVED: ${team} -> Phil`)}else status.philStatus='PASS';
  }else status.philStatus='NOT_APPLICABLE';
  if(!rec&&fbs.length===0){const candidates=aliasCandidates(team,portalState.allTeams||[]);if(candidates.length){status.unregisteredAliasCandidates=candidates;failures.push(`TEAM_IDENTITY_UNREGISTERED_ALIAS_CANDIDATE: ${team} -> ${candidates.map(x=>x.name).join(', ')}`)}}
  if(fbs.length>1){status.fbsStatus='AMBIGUOUS';failures.push(`TEAM_IDENTITY_AMBIGUOUS: ${team} -> portal FBS universe (${fbs.join(', ')})`)}else status.fbsStatus=fbs.length?'PASS':'NOT_APPLICABLE';
  rows.push(status);
}
for(const a of ambiguous)failures.push(`TEAM_IDENTITY_REGISTRY_AMBIGUOUS: ${a.alias} -> ${a.canonical.join(' / ')}`);
for(const e of browserErrors)failures.push(`TEAM_IDENTITY_BROWSER_ERROR: ${e}`);
const report={season:board.season||2026,week:board.week,checkedAt:new Date().toISOString(),registryVersion:registry.version,portalIdentityStatus:portalState.identityStatus,boardTeamCount:boardTeams.length,statsCoverage:{resolved:rows.filter(r=>r.statsStatus==='PASS').length,total:rows.length},philCoverage:{applicable:rows.filter(r=>r.philApplicable).length,resolved:rows.filter(r=>r.philApplicable&&r.philStatus==='PASS').length},ambiguousRegistryAliases:ambiguous,failures,teams:rows,status:failures.length?'FAIL':'PASS'};
await fs.writeFile('data/team-identity-audit-current.json',JSON.stringify(report,null,2)+'\n');
console.log(`CFB identity audit ${report.status}: teams=${rows.length}, stats=${report.statsCoverage.resolved}/${rows.length}, Phil=${report.philCoverage.resolved}/${report.philCoverage.applicable}, failures=${failures.length}`);
if(failures.length){console.error(failures.join('\n'));process.exit(1)}
