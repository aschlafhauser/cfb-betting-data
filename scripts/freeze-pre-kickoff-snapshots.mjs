import fs from 'node:fs/promises';
import path from 'node:path';

const board=JSON.parse(await fs.readFile('data/weekly-board.json','utf8'));
const season=Number(process.env.CFB_SEASON||board.season||2026),week=Number(process.env.CFB_WEEK||board.week);
const now=new Date(process.env.CFB_AS_OF||Date.now());
const lookaheadMinutes=Number(process.env.CFB_SNAPSHOT_LOOKAHEAD_MINUTES||90);
if(!Number.isFinite(week)||Number.isNaN(now.getTime()))throw new Error('Valid selected week and snapshot time are required');
await fs.mkdir('data/final-snapshots',{recursive:true});

const safe=s=>String(s||'game').replace(/[^a-zA-Z0-9._-]+/g,'-');
let frozen=0,existing=0,notDue=0;
for(const game of board.games||[]){
  const id=game.gameId||game.canonicalGameId,kickoff=Date.parse(game.dateTime||game.kickoff||'');
  if(!id||!Number.isFinite(kickoff)){notDue++;continue}
  const delta=(kickoff-now.getTime())/60000;
  if(delta<=0||delta>lookaheadMinutes){notDue++;continue}
  const file=path.join('data/final-snapshots',`${season}-w${week}-${safe(id)}.json`);
  try{await fs.access(file);existing++;continue}catch{}
  const snapshot={schemaVersion:'cfb-frozen-pre-kickoff-v1',snapshotType:'frozen-pre-kickoff',sport:'CFB',season,week,canonicalGameId:id,matchup:`${game.away} at ${game.home}`,kickoff:new Date(kickoff).toISOString(),frozenAt:now.toISOString(),minutesBeforeKickoff:Number(delta.toFixed(1)),immutable:true,market:{spread:game.currentSpread??null,total:game.currentTotal??null,moneyline:game.currentMoneyline??null,source:game.marketSource??null,observedAt:game.marketObservedAt??board.updatedAt??null},models:{marketCalibratedFair:game.modelSpread??null,marketCalibratedEdge:game.modelEdgeMagnitude??null,independentFair:game.independentFootballFair??null,independentEdge:game.independentFootballEdge??null,independentSide:game.independentFootballSide??null,ensembleFair:game.ensembleFair??null,ensembleEdge:game.ensembleEdge??null},decision:{stage:game.stage??null,priority:game.priority??null,action:game.action??null,thresholdStatus:game.thresholdStatus??null,finalExecutableEdge:game.finalExecutableEdge??null},availability:{injuryStatus:game.injuryStatus??null,weather:game.weather??null},provenance:{boardUpdatedAt:board.updatedAt??null,runtimePersistence:board.runtimePersistence??null},governance:'Immutable prospective snapshot written before kickoff. Never overwrite or reconstruct after kickoff.'};
  try{await fs.writeFile(file,JSON.stringify(snapshot,null,2)+'\n',{flag:'wx'});frozen++;console.log(`Frozen ${id} at ${snapshot.minutesBeforeKickoff} minutes pre-kickoff.`)}catch(e){if(e?.code==='EEXIST')existing++;else throw e}
}
console.log(`Pre-kickoff freeze complete: ${frozen} new, ${existing} already frozen, ${notDue} not due.`);
