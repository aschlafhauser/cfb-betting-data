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
const expectedUnderdogUniverse=board.games.filter(g=>/^(.+?)\s+(-?\d+(?:\.\d+)?)/.test(String(g.currentSpread||''))).length;
assert.equal(records.length,expectedUnderdogUniverse,'Incomplete underdog evidence universe');
assert(Object.values(research.isolation).every(v=>v===0),'Upset research changed production decisions');
console.log(`Upset input integrity PASS: ${records.length} matchups, ${modelChecks} probability, ${rankChecks} current Phil rank and ${sourceLimitedRankChecks} explicit source-limited rank checks; production impact zero.`);
