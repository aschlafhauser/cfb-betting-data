import fs from 'node:fs/promises';
import path from 'node:path';

const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const board=await read('data/weekly-board.json');
const season=Number(process.env.CFB_SEASON||board.season||2026);
const week=Number(process.env.CFB_WEEK||board.week);
const asOf=new Date(process.env.CFB_AS_OF||Date.now());
if(!Number.isFinite(week)||Number.isNaN(asOf.getTime()))throw new Error('Valid selected week and audit time are required');

const artifactPath=`data/final-snapshot-integrity-${season}-w${week}.json`;
const previous=await read(artifactPath).catch(()=>null);
const files=(await fs.readdir('data/final-snapshots').catch(()=>[])).filter(name=>name.endsWith('.json'));
const snapshots=[];
for(const name of files){
  const value=await read(path.join('data/final-snapshots',name)).catch(()=>null);
  const records=Array.isArray(value)?value:[value];
  for(const snapshot of records){
    if(snapshot&&Number(snapshot.season)===season&&Number(snapshot.week)===week&&snapshot.canonicalGameId){
      snapshots.push({file:`data/final-snapshots/${name}`,snapshot});
    }
  }
}

const byGameId=new Map();
for(const record of snapshots){
  const kickoff=Date.parse(record.snapshot.kickoff||'');
  const frozenAt=Date.parse(record.snapshot.frozenAt||'');
  const valid=record.snapshot.snapshotType==='frozen-pre-kickoff'&&Number.isFinite(kickoff)&&Number.isFinite(frozenAt)&&frozenAt<kickoff;
  const current=byGameId.get(record.snapshot.canonicalGameId);
  if(!current||(!current.valid&&valid))byGameId.set(record.snapshot.canonicalGameId,{...record,valid,frozenAt:record.snapshot.frozenAt||null,kickoff:record.snapshot.kickoff||null});
}

const priorFailures=new Map((previous?.permanentFailures||[]).map(f=>[f.canonicalGameId,f]));
const games=(board.games||[]).map(game=>{
  const canonicalGameId=game.gameId||game.canonicalGameId;
  const kickoffMs=Date.parse(game.dateTime||game.kickoff||'');
  const snapshot=byGameId.get(canonicalGameId);
  let status='PENDING';
  if(snapshot?.valid)status='PASS';
  else if(Number.isFinite(kickoffMs)&&kickoffMs<=asOf.getTime())status='FINAL_SNAPSHOT_MISSING';
  else if(snapshot&&!snapshot.valid)status='INVALID_PRE_KICKOFF_SNAPSHOT';
  return {canonicalGameId,game:`${game.away} at ${game.home}`,kickoff:Number.isFinite(kickoffMs)?new Date(kickoffMs).toISOString():null,status,snapshotFile:snapshot?.file||null,frozenAt:snapshot?.frozenAt||null};
});

for(const game of games){
  if(game.status==='FINAL_SNAPSHOT_MISSING'||game.status==='INVALID_PRE_KICKOFF_SNAPSHOT'){
    priorFailures.set(game.canonicalGameId,{...priorFailures.get(game.canonicalGameId),...game,firstDetectedAt:priorFailures.get(game.canonicalGameId)?.firstDetectedAt||asOf.toISOString(),immutable:true,remediation:'Historical pre-kickoff state may not be backfilled after kickoff.'});
  }
}
const permanentFailures=[...priorFailures.values()].sort((a,b)=>String(a.kickoff).localeCompare(String(b.kickoff)));
const passedGames=games.filter(game=>game.status==='PASS');
const pendingGames=games.filter(game=>game.status==='PENDING');
const artifact={
  schemaVersion:'cfb-final-snapshot-integrity-v1',sport:'CFB',season,week,verifiedAt:asOf.toISOString(),status:permanentFailures.length?'FAIL':pendingGames.length?'IN_PROGRESS':'PASS',blocking:permanentFailures.length>0,
  counts:{selectedWeekGames:games.length,validPreKickoffSnapshots:passedGames.length,pendingBeforeKickoff:pendingGames.length,permanentFailures:permanentFailures.length},
  permanentFailures,pendingGames,passedGames,
  governance:'A missed or invalid pre-kickoff snapshot becomes a permanent hard failure after kickoff. Never reconstruct or backfill historical market, model, personnel, recommendation or ledger state from results or later observations.'
};
await fs.writeFile(artifactPath,JSON.stringify(artifact,null,2)+'\n');
console.log(`Final snapshot integrity ${artifact.status}: ${passedGames.length} valid, ${pendingGames.length} pending, ${permanentFailures.length} permanent failures`);

