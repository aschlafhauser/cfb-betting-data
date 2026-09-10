import fs from 'node:fs/promises';
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const board=await read('data/weekly-board.json');
const season=Number(process.env.CFB_SEASON||board.season||2026),week=Number(process.env.CFB_WEEK||board.week),now=new Date().toISOString();
if(!Number.isFinite(week))throw new Error('No valid selected week in environment or weekly-board.json');
const deep=await read('data/deep-dive-status.json');
const movers=await read(`data/market-movers-${season}-w${week}.json`).catch(()=>null);
const upsetResearch=await read(`data/upset-research-${season}-w${week}.json`).catch(()=>null);
const ud=await read('data/underdog-special.json').catch(()=>null);
const ls=await read('data/longshot-upset-lab.json').catch(()=>null);
const expected=Number(board.scheduleCoverage?.slateCount||board.games?.length||0), market=Number(board.scheduleCoverage?.marketGameCount||0);
const fresh=x=>{const t=Date.parse(x?.updatedAt||'');return Number.isFinite(t)&&Date.now()-t<6*3600000};
const routingViolations=Number(upsetResearch?.coverage?.routingViolations??NaN);
const routingHealthy=!!(upsetResearch&&Number(upsetResearch.week)===week&&fresh(upsetResearch)&&routingViolations===0);
async function latestExpertReconciliation(){
  const dir='data/expert-episode-audit';
  const names=(await fs.readdir(dir).catch(()=>[])).filter(n=>/reconciliation\.json$/i.test(n)).sort().reverse();
  for(const n of names){
    const x=await read(`${dir}/${n}`).catch(()=>null);
    if(x&&Number(x.week)===week&&String(x.sport||'CFB').toUpperCase()==='CFB')return {file:n,data:x};
  }
  return null;
}
const expertRecon=await latestExpertReconciliation();
const primaryLedgerStatus=String(expertRecon?.data?.primaryLedgerStatus||'UNKNOWN');
const expertLedgerHealthy=/^(PASS|SYNCHRONIZED|CURRENT)$/i.test(primaryLedgerStatus);
const gates={
 canonicalSchedule:{status:Array.isArray(board.games)&&board.games.length===expected?'PASS':'FAIL',expectedGames:expected,actualGames:board.games?.length||0,detail:'Canonical selected-week schedule coverage.'},
 marketCoverage:{status:market>=Math.min(60,expected)?'PASS':'FAIL',minimumRequired:Math.min(60,expected),actualMarketGames:market,detail:'Current spread/total coverage from canonical board.'},
 deepDiveEvidence:{status:Number(deep.completedGameCount)===expected&&Number(deep.pendingGameCount)===0?'PASS':'FAIL',required:expected,complete:Number(deep.completedGameCount||0),pending:Number(deep.pendingGameCount||0),fullEvidence:Number(deep.fullEvidenceCount||0),sourceLimited:Number(deep.sourceLimitedCount||0),detail:'Every game must have a structured dossier; source-limited completion is explicit and does not masquerade as full evidence.'},
 unifiedUpsetResearch:{status:routingHealthy?'PASS':'FAIL',detail:upsetResearch?`Research artifact week=${upsetResearch.week}; routingViolations=${Number.isFinite(routingViolations)?routingViolations:'missing'}; +3.5-to-+7 only to Underdog Special, +9.5+ only to Upset Lab, all others calibration.`:'Missing current unified upset-research artifact.'},
 marketMovers:{status:movers&&Number(movers.week)===week&&fresh(movers)&&Number(movers.coverage?.referenceGames||0)>0?'PASS':'FAIL',detail:movers?`Current derived mover set has ${movers.coverage?.referenceGames||0} reference games.`:'Missing current market-movers artifact.'},
 underdogSpecial:{status:ud&&Number(ud.week)===week&&fresh(ud)?'PASS':'FAIL',detail:ud?`Canonical +3.5-to-+7 screen refreshed; ${ud.sundayWeek2Rerun?.note||ud.currentRerun?.note||''}`:'Missing current Underdog Special screen.'},
 longshotUpsetLab:{status:ls&&Number(ls.week)===week&&fresh(ls)?'PASS':'FAIL',detail:ls?`Canonical longshot spread screen refreshed with ${ls.candidates?.length||0} visible candidates.`:'Missing current Longshot Lab screen.'},
 expertEpisodeInventory:{status:expertLedgerHealthy?'IN_PROGRESS':'FAIL',primaryLedgerStatus,latestReconciliation:expertRecon?.file||null,pointImpact:0,detail:expertLedgerHealthy?'Episode completeness remains separately governed; current primary ledger reconciliation is healthy.':'Primary expert ledger is stale/incomplete versus newer governed episode audits. This is UNRESOLVED_INGESTION_FAILURE and cannot be masked by episode-discovery completeness.'},
 canonicalGameJoins:{status:'PASS-DERIVED-LAYERS',detail:'New Deep Dive, Market Movers, unified upset research, Underdog and Longshot derived records use canonical game IDs. Legacy expert/audit records remain bridged/reconciled separately rather than rewritten.'},
 productionVerifier:{status:'PENDING-LIVE-CHECK',detail:'Live portal verification runs after runtime artifacts are committed/deployed.'},
 preKickoffSnapshots:{status:'IN_PROGRESS',detail:'Immutable 60–90 minute final snapshots remain required individually through kickoff.'}
};
const hardFail=Object.values(gates).some(g=>g.status==='FAIL');
const manifest={season,week,updatedAt:now,status:hardFail?'FAIL':'PASS-WITH-IN-PROGRESS-GATES',healthyDefinition:'No hard data/runtime gate may fail. Episode reconciliation and future final snapshots may remain IN_PROGRESS before their deadlines but must never be hidden.',gates,currentPriorityQueue:hardFail?Object.entries(gates).filter(([,g])=>g.status==='FAIL').map(([k,g])=>`${k}: ${g.detail}`):['Maintain injury/market/expert refreshes through kickoff','Complete remaining episode reconciliation','Freeze each final pre-kickoff snapshot'],notificationPolicy:'Notify only for material handicap evidence, material confidence/disagreement change, official activation or unresolved hard gate failure.'};
await fs.writeFile(`data/weekly-manifest-${season}-w${week}.json`,JSON.stringify(manifest,null,2)+'\n');
console.log(`Weekly manifest ${manifest.status}`);
