// Full-runtime rerun marker: corrected Week 12 governance gates.
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
const exceptionLedger=await read('data/final-snapshot-exceptions.json').catch(()=>({exceptions:[]}));
const acknowledgedIds=new Set((exceptionLedger.exceptions||[])
  .filter(item=>Number(item.season)===season&&Number(item.week)===week&&item.acknowledged===true)
  .map(item=>item.canonicalGameId));
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

const games=(board.games||[]).map(game=>{
  const canonicalGameId=game.gameId||game.canonicalGameId;
  const kickoffMs=Date.parse(game.dateTime||game.kickoff||'');
  const snapshot=byGameId.get(canonicalGameId);
  const kickoffYear=Number.isFinite(kickoffMs)?new Date(kickoffMs).getUTCFullYear():null;
  const validKickoffProvenance=kickoffYear===season;
  let status='PENDING';
  if(snapshot?.valid)status='PASS';
  else if(!validKickoffProvenance)status='INVALID_KICKOFF_PROVENANCE';
  else if(kickoffMs<=asOf.getTime())status='FINAL_SNAPSHOT_MISSING';
  else if(snapshot&&!snapshot.valid)status='INVALID_PRE_KICKOFF_SNAPSHOT';
  return {canonicalGameId,game:`${game.away} at ${game.home}`,kickoff:Number.isFinite(kickoffMs)?new Date(kickoffMs).toISOString():null,status,snapshotFile:snapshot?.file||null,frozenAt:snapshot?.frozenAt||null};
});

// A malformed date parse must never manufacture an irreversible historical failure.
// Retain every genuine prior miss, but discard only prior rows whose recorded kickoff
// was outside the selected season while the same canonical game is currently governed
// as a valid future selected-week event.
const currentById=new Map(games.map(g=>[g.canonicalGameId,g]));
const clearedMalformedLegacyFailures=[];
const retainedPriorFailures=(previous?.permanentFailures||[]).filter(f=>{
  const current=currentById.get(f.canonicalGameId);
  const priorMs=Date.parse(f.kickoff||'');
  const priorYear=Number.isFinite(priorMs)?new Date(priorMs).getUTCFullYear():null;
  const currentMs=Date.parse(current?.kickoff||'');
  const currentIsValidFuture=current?.status==='PENDING'&&Number.isFinite(currentMs)&&new Date(currentMs).getUTCFullYear()===season&&currentMs>asOf.getTime();
  const clear=priorYear!==season&&currentIsValidFuture;
  if(clear)clearedMalformedLegacyFailures.push({...f,clearedReason:'Recorded kickoff was outside the selected season while the same canonical game remained a valid future selected-week event.'});
  return !clear;
});
const priorFailures=new Map(retainedPriorFailures.map(f=>[f.canonicalGameId,f]));

for(const game of games){
  if(game.status==='FINAL_SNAPSHOT_MISSING'||game.status==='INVALID_PRE_KICKOFF_SNAPSHOT'){
    priorFailures.set(game.canonicalGameId,{...priorFailures.get(game.canonicalGameId),...game,firstDetectedAt:priorFailures.get(game.canonicalGameId)?.firstDetectedAt||asOf.toISOString(),immutable:true,remediation:'Historical pre-kickoff state may not be backfilled after kickoff.'});
  }
}
const permanentFailures=[...priorFailures.values()].sort((a,b)=>String(a.kickoff).localeCompare(String(b.kickoff)));
const acknowledgedFailures=permanentFailures.filter(item=>acknowledgedIds.has(item.canonicalGameId));
const unacknowledgedFailures=permanentFailures.filter(item=>!acknowledgedIds.has(item.canonicalGameId));
const passedGames=games.filter(game=>game.status==='PASS');
const pendingGames=games.filter(game=>game.status==='PENDING');
const invalidKickoffGames=games.filter(game=>game.status==='INVALID_KICKOFF_PROVENANCE');
const artifact={
  schemaVersion:'cfb-final-snapshot-integrity-v2',sport:'CFB',season,week,verifiedAt:asOf.toISOString(),
  status:unacknowledgedFailures.length||invalidKickoffGames.length?'FAIL':acknowledgedFailures.length?'PASS-WITH-PERMANENT-EXCEPTION':pendingGames.length?'IN_PROGRESS':'PASS',
  blocking:unacknowledgedFailures.length>0||invalidKickoffGames.length>0,
  counts:{selectedWeekGames:games.length,validPreKickoffSnapshots:passedGames.length,pendingBeforeKickoff:pendingGames.length,invalidKickoffProvenance:invalidKickoffGames.length,permanentFailures:permanentFailures.length,acknowledgedPermanentExceptions:acknowledgedFailures.length,unacknowledgedPermanentFailures:unacknowledgedFailures.length},
  permanentFailures,acknowledgedFailures,unacknowledgedFailures,invalidKickoffGames,pendingGames,passedGames,clearedMalformedLegacyFailures,
  exceptionLedger:'data/final-snapshot-exceptions.json',
  governance:'A missed or invalid pre-kickoff snapshot is never reconstructed or backfilled. A specifically acknowledged historical exception remains permanently visible in this audit but does not keep the current decision system in a false failed state. Any new, unacknowledged miss remains a blocking failure. A prior failure may be cleared only when its recorded kickoff is demonstrably malformed outside the governed season and the canonical kickoff was still in the future when the false failure was first detected.'
};
await fs.writeFile(artifactPath,JSON.stringify(artifact,null,2)+'\n');
console.log(`Final snapshot integrity ${artifact.status}: ${passedGames.length} valid, ${pendingGames.length} pending, ${invalidKickoffGames.length} invalid kickoff provenance, ${acknowledgedFailures.length} acknowledged exceptions, ${unacknowledgedFailures.length} blocking failures`);
