import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const read=async p=>JSON.parse(await fs.readFile('data/'+p,'utf8'));
const board=await read('weekly-board.json');
const research=await read(`upset-research-${board.season}-w${board.week}.json`);
const records=[...research.underdogSpecial,...research.upsetLab,...research.intermediate];
let modelChecks=0,rankChecks=0,sourceLimitedRankChecks=0;
for(const r of records){
 const g=board.games.find(g=>g.gameId===r.canonicalGameId);
 assert(g,`${r.team}: missing canonical matchup`);
 for(const [field,signal] of [['modelSpread','productionWinProbability'],['independentFootballFair','independentWinProbability']]){
  if(!g[field])continue;
  const p=r.signals[signal];
  assert.equal(typeof p,'number',`${r.team}: ${field} exists but ${signal} is missing`);
  assert(p>0&&p<1,`${r.team}: invalid probability ${p}`);
  modelChecks++;
 }
 // Require ranks exactly when the governed Phil component exists for the
 // selected canonical matchup. FCS/source-limited teams absent from Phil's
 // FBS tables must remain null rather than receiving a fabricated rank.
 const side=r.team===g.home?'home':r.team===g.away?'away':null;
 assert(side,`${r.team}: does not reconcile to canonical matchup teams`);
 const other=side==='home'?'away':'home';
 const phil=g.modelComponents?.philInseason;
 const rankSources=[
  ['teamOffenseYppRank',phil?.[side]?.offYpp],
  ['teamAggregateRank',phil?.[side]?.agg],
  ['teamDefensiveYppRank',phil?.[side]?.defYpp],
  ['opponentPassDefenseRank',phil?.[other]?.passD]
 ];
 for(const [signal,sourceRow] of rankSources){
  const value=r.signals[signal];
  if(sourceRow){
   assert(Number.isInteger(value)&&value>=1&&value<=138,`${r.team}: current ${signal} missing`);
   rankChecks++;
  }else{
   assert(value==null,`${r.team}: ${signal} must remain null when governed Phil source is absent`);
   const sourceLimited=/source-limited/i.test(String(r.informationQuality||'')+' '+String(r.deepDiveStatus||''));
   assert(sourceLimited,`${r.team}: missing ${signal} is not explicitly source-limited`);
   sourceLimitedRankChecks++;
  }
 }
 assert(Object.values(r.components).every(v=>Number.isFinite(v)&&v>=0),`${r.team}: invalid component`);
 assert(r.score25>=0&&r.score25<=25,`${r.team}: invalid total`);
}
const norm=s=>String(s||'').replace(/\bSt\.?$/i,'State').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const aliases={af:'airforce',buf:'buffalo',fiu:'floridainternational',fau:'floridaatlantic',wku:'westernkentucky',usf:'southflorida',mtsu:'middletennessee',ulm:'ulmonroe',mississippi:'olemiss',armywestpoint:'army',connecticut:'uconn',appalachianst:'appstate',appalachianstate:'appstate',miamifla:'miami',miamifl:'miami',ohiost:'ohiostate',pennst:'pennstate',floridast:'floridastate',mississippist:'mississippistate',michiganst:'michiganstate',sanjosest:'sanjosestate',coloradost:'coloradostate',kansasst:'kansasstate',arizonast:'arizonastate',iowast:'iowastate',oklahomast:'oklahomastate',boisest:'boisestate',oregonst:'oregonstate',utahst:'utahstate',kentst:'kentstate',massachusetts:'umass',centmichigan:'centralmichigan',samhoustonstate:'samhouston',kennesaw:'kennesawstate',wkentucky:'westernkentucky',emichigan:'easternmichigan',wmichigan:'westernmichigan'};
const canon=s=>aliases[norm(s)]||norm(s);
const priced=board.games.map(g=>({g,m:String(g.currentSpread||'').match(/^(.+?)\s+(-?\d+(?:\.\d+)?)/)})).filter(x=>x.m);
const resolvable=priced.filter(({g,m})=>[g.away,g.home].some(t=>canon(t)===canon(m[1])));
const unresolved=priced.filter(({g,m})=>![g.away,g.home].some(t=>canon(t)===canon(m[1])));
const marketIntegrity=await read(`market-derived-integrity-${board.season}-w${board.week}.json`);
for(const {g} of unresolved){
 const documented=(marketIntegrity.checks?.sourceLimitedExclusions||[]).some(x=>String(x).startsWith(g.gameId+':'));
 assert(documented,`${g.gameId}: unresolved market identity is not documented as coverage-limited`);
 assert(/source-limited/i.test(String(g.deepDiveStatus||g.stage||'')),`${g.gameId}: unresolved market identity lacks an explicit source-limited record`);
}
assert.equal(records.length,resolvable.length,'Incomplete resolvable underdog evidence universe');
assert(Object.values(research.isolation).every(v=>v===0),'Upset research changed production decisions');
console.log(`Upset input integrity PASS: ${records.length} resolvable matchups, ${unresolved.length} documented identity-limited exclusions, ${modelChecks} probability, ${rankChecks} current Phil rank and ${sourceLimitedRankChecks} explicit source-limited rank checks; production impact zero.`);
