import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const read=async p=>JSON.parse(await fs.readFile('data/'+p,'utf8'));
const board=await read('weekly-board.json');
const research=await read(`upset-research-${board.season}-w${board.week}.json`);
const records=[...research.underdogSpecial,...research.upsetLab,...research.intermediate];
let modelChecks=0,rankChecks=0;
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
 // A named current Phil team must retain actual table ranks, never silently
 // fall back to a dossier that omitted its Phil component copy.
 for(const signal of ['teamOffenseYppRank','teamAggregateRank','teamDefensiveYppRank','opponentPassDefenseRank']){
  assert(Number.isInteger(r.signals[signal])&&r.signals[signal]>=1&&r.signals[signal]<=138,`${r.team}: current ${signal} missing`);
  rankChecks++;
 }
 assert(Object.values(r.components).every(v=>Number.isFinite(v)&&v>=0),`${r.team}: invalid component`);
 assert(r.score25>=0&&r.score25<=25,`${r.team}: invalid total`);
}
assert.equal(records.length,board.games.filter(g=>g.currentSpread).length,'Incomplete underdog evidence universe');
assert(Object.values(research.isolation).every(v=>v===0),'Upset research changed production decisions');
console.log(`Upset input integrity PASS: ${records.length} matchups, ${modelChecks} probability and ${rankChecks} current Phil rank checks; production impact zero.`);
