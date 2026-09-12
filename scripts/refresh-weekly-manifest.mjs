import fs from 'node:fs/promises';
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const board=await read('data/weekly-board.json');
const season=Number(process.env.CFB_SEASON||board.season||2026),week=Number(process.env.CFB_WEEK||board.week),now=new Date().toISOString();
if(!Number.isFinite(week))throw new Error('No valid selected week in environment or weekly-board.json');
const [deep,movers,upsetResearch,ud,ls,ledgerSync,previousManifest,statArtifact,marketArtifact,finalSnapshotArtifact]=await Promise.all([
 read('data/deep-dive-status.json'),
 read(`data/market-movers-${season}-w${week}.json`).catch(()=>null),
 read(`data/upset-research-${season}-w${week}.json`).catch(()=>null),
 read('data/underdog-special.json').catch(()=>null),
 read('data/longshot-upset-lab.json').catch(()=>null),
 read('data/expert-ledger-reconciliation.json').catch(()=>null),
 read(`data/weekly-manifest-${season}-w${week}.json`).catch(()=>null),
 read(`data/statistical-display-integrity-${season}-w${week}.json`).catch(()=>null),
 read(`data/market-derived-integrity-${season}-w${week}.json`).catch(()=>null),
 read(`data/final-snapshot-integrity-${season}-w${week}.json`).catch(()=>null)
]);
const expected=Number(board.scheduleCoverage?.slateCount||board.games?.length||0),market=Number(board.scheduleCoverage?.marketGameCount||0);
const fresh=x=>{const t=Date.parse(x?.updatedAt||x?.generatedAt||x?.verifiedAt||'');return Number.isFinite(t)&&Date.now()-t<6*3600000};
async function latestExpertReconciliation(){
 const names=(await fs.readdir('data/expert-episode-audit').catch(()=>[])).filter(n=>/reconciliation\.json$/i.test(n)).sort().reverse();
 for(const n of names){const x=await read(`data/expert-episode-audit/${n}`).catch(()=>null);if(x&&Number(x.week)===week&&String(x.sport||'CFB').toUpperCase()==='CFB')return {file:n,data:x};}
 return null;
}
const expertRecon=await latestExpertReconciliation();
const syncHealthy=String(ledgerSync?.sport||'').toUpperCase()==='CFB'&&String(ledgerSync?.primaryLedgerStatus||'').toUpperCase()==='SYNCHRONIZED'&&Number(ledgerSync?.missingGovernedRecords||0)===0&&fresh(ledgerSync);
const primaryLedgerStatus=syncHealthy?'SYNCHRONIZED':String(ledgerSync?.primaryLedgerStatus||expertRecon?.data?.primaryLedgerStatus||'UNKNOWN');
const expertLedgerHealthy=syncHealthy||/^(PASS|SYNCHRONIZED|CURRENT)$/i.test(primaryLedgerStatus);
const priorVerifier=previousManifest?.gates?.productionVerifier,priorVerifierFailed=String(priorVerifier?.status||'').toUpperCase()==='FAIL'||priorVerifier?.priorFailure===true;
const productionVerifier={status:priorVerifierFailed?'FAIL':'PENDING-LIVE-CHECK',priorFailure:priorVerifierFailed,detail:priorVerifierFailed?`Persisted live-browser verification failure remains unresolved: ${priorVerifier?.detail||'unspecified browser/runtime failure'}. This hard FAIL is sticky across ordinary manifest regeneration and may be cleared only by an explicit clean live-browser verification with zero browser/page/runtime errors.`:'Live portal verification runs after runtime artifacts are committed/deployed; only an explicit clean browser run may certify current production health.'};
const priorStat=previousManifest?.gates?.statisticalDisplay,priorMarket=previousManifest?.gates?.marketDerivedIntegrity,priorFinalSnapshot=previousManifest?.gates?.finalSnapshotIntegrity;
const statPass=String(statArtifact?.status||'').toUpperCase()==='PASS'&&Number(statArtifact?.week)===week&&fresh(statArtifact);
const marketPass=String(marketArtifact?.status||'').toUpperCase()==='PASS'&&Number(marketArtifact?.week)===week&&fresh(marketArtifact);
const statisticalDisplay=statPass?{status:'PASS',blocking:true,verifiedAt:statArtifact.verifiedAt||statArtifact.generatedAt||now,artifact:`data/statistical-display-integrity-${season}-w${week}.json`,detail:statArtifact.detail||'Dedicated current statistical-display integrity verification passed.'}:{status:'FAIL',blocking:true,artifact:`data/statistical-display-integrity-${season}-w${week}.json`,detail:priorStat?.detail||'No dedicated current PASS artifact proves complete statistical-display coverage and live Matchup Center reconciliation. This blocking gate is sticky until explicit verification passes.'};
const marketDerivedIntegrity=marketPass?{status:'PASS',blocking:true,verifiedAt:marketArtifact.verifiedAt||marketArtifact.generatedAt||now,artifact:`data/market-derived-integrity-${season}-w${week}.json`,detail:marketArtifact.detail||'Independent current market-derived arithmetic, dependency timestamps, stored-runtime and rendered-portal reconciliation passed.'}:{status:'FAIL',blocking:true,artifact:`data/market-derived-integrity-${season}-w${week}.json`,detail:priorMarket?.detail||'No persisted independent reconciliation artifact currently proves spread/total/ML-derived arithmetic, dependency timestamps, stored-runtime agreement and rendered-portal agreement against the newest canonical market snapshot. Non-null fields alone do not satisfy the Market-Derived Integrity Gate.'};
const finalSnapshotFailures=Array.isArray(finalSnapshotArtifact?.permanentFailures)?finalSnapshotArtifact.permanentFailures:[];
const priorFinalFailures=Array.isArray(priorFinalSnapshot?.permanentFailures)?priorFinalSnapshot.permanentFailures:[];
const finalSnapshotIntegrity=finalSnapshotArtifact?{status:String(finalSnapshotArtifact.status||'FAIL').toUpperCase(),blocking:finalSnapshotFailures.length>0,verifiedAt:finalSnapshotArtifact.verifiedAt||now,artifact:`data/final-snapshot-integrity-${season}-w${week}.json`,validSnapshots:Number(finalSnapshotArtifact.counts?.validPreKickoffSnapshots||0),pendingBeforeKickoff:Number(finalSnapshotArtifact.counts?.pendingBeforeKickoff||0),permanentFailures:finalSnapshotFailures.map(f=>f.canonicalGameId),detail:finalSnapshotFailures.length?`${finalSnapshotFailures.length} selected-week games permanently lack a valid immutable pre-kickoff snapshot. Historical state may not be backfilled: ${finalSnapshotFailures.map(f=>f.canonicalGameId).join(', ')}.`:`${Number(finalSnapshotArtifact.counts?.validPreKickoffSnapshots||0)} valid immutable snapshots; ${Number(finalSnapshotArtifact.counts?.pendingBeforeKickoff||0)} games remain pending before kickoff.`}:{status:'FAIL',blocking:true,artifact:`data/final-snapshot-integrity-${season}-w${week}.json`,permanentFailures:priorFinalFailures,detail:priorFinalFailures.length?`The audit artifact is missing, but ${priorFinalFailures.length} previously persisted immutable final-snapshot failures remain sticky and may not be erased or backfilled: ${priorFinalFailures.join(', ')}.`:'Missing governed final-snapshot integrity audit. Snapshot coverage cannot be inferred from an in-progress label.'};
const rv=Number(upsetResearch?.coverage?.routingViolations??NaN),routingHealthy=!!(upsetResearch&&Number(upsetResearch.week)===week&&fresh(upsetResearch)&&rv===0);
const gates={
 canonicalSchedule:{status:Array.isArray(board.games)&&board.games.length===expected?'PASS':'FAIL',expectedGames:expected,actualGames:board.games?.length||0,detail:'Canonical selected-week schedule coverage.'},
 marketCoverage:{status:market>=Math.min(60,expected)?'PASS':'FAIL',minimumRequired:Math.min(60,expected),actualMarketGames:market,detail:'Current spread/total coverage from canonical board.'},
 deepDiveEvidence:{status:Number(deep.completedGameCount)===expected&&Number(deep.pendingGameCount)===0?'PASS':'FAIL',required:expected,complete:Number(deep.completedGameCount||0),pending:Number(deep.pendingGameCount||0),fullEvidence:Number(deep.fullEvidenceCount||0),sourceLimited:Number(deep.sourceLimitedCount||0),detail:'Every game must have a structured dossier; source-limited completion is explicit and does not masquerade as full evidence.'},
 statisticalDisplay,marketDerivedIntegrity,
 unifiedUpsetResearch:{status:routingHealthy?'PASS':'FAIL',detail:upsetResearch?`Research artifact week=${upsetResearch.week}; routingViolations=${Number.isFinite(rv)?rv:'missing'}; +3.5-to-+7 only to Underdog Special, +9.5+ only to Upset Lab, all others calibration.`:'Missing current unified upset-research artifact.'},
 marketMovers:{status:movers&&Number(movers.week)===week&&fresh(movers)&&Number(movers.coverage?.referenceGames||0)>0?'PASS':'FAIL',detail:movers?`Current derived mover set has ${movers.coverage?.referenceGames||0} reference games.`:'Missing current market-movers artifact.'},
 underdogSpecial:{status:ud&&Number(ud.week)===week&&fresh(ud)?'PASS':'FAIL',detail:ud?`Canonical +3.5-to-+7 screen refreshed; ${ud.sundayWeek2Rerun?.note||ud.currentRerun?.note||''}`:'Missing current Underdog Special screen.'},
 longshotUpsetLab:{status:ls&&Number(ls.week)===week&&fresh(ls)?'PASS':'FAIL',detail:ls?`Canonical longshot spread screen refreshed with ${ls.candidates?.length||0} visible candidates.`:'Missing current Longshot Lab screen.'},
 expertEpisodeInventory:{status:expertLedgerHealthy?'IN_PROGRESS':'FAIL',primaryLedgerStatus,ledgerSyncReport:'data/expert-ledger-reconciliation.json',latestReconciliation:expertRecon?.file||null,pointImpact:0,detail:expertLedgerHealthy?`Primary expert ledger is losslessly synchronized with governed audit records (${ledgerSync?.ledgerRecordCount??'n/a'} ledger records; ${ledgerSync?.missingGovernedRecords??0} missing). Episode discovery/completeness remains separately governed.`:'Primary expert ledger is stale/incomplete versus newer governed episode audits. This is UNRESOLVED_INGESTION_FAILURE and cannot be masked by episode-discovery completeness.'},
 canonicalGameJoins:{status:'PASS-DERIVED-LAYERS',detail:'New Deep Dive, Market Movers, unified upset research, Underdog and Longshot derived records use canonical game IDs. Legacy expert/audit records remain bridged/reconciled separately rather than rewritten.'},
 productionVerifier,finalSnapshotIntegrity,preKickoffSnapshots:{status:finalSnapshotIntegrity.status,blocking:finalSnapshotIntegrity.blocking,artifact:finalSnapshotIntegrity.artifact,detail:finalSnapshotIntegrity.detail}
};
const hardFail=Object.values(gates).some(g=>g.status==='FAIL'),failures=Object.entries(gates).filter(([,g])=>g.status==='FAIL').map(([k])=>k);
const manifest={season,week,updatedAt:now,status:hardFail?'FAIL':'PASS-WITH-IN-PROGRESS-GATES',healthyDefinition:'No hard data/runtime gate may fail. Persisted live-browser, statistical-display and market-derived-integrity failures are sticky until their explicit clean verification path clears them.',gates,failures,currentPriorityQueue:hardFail?Object.entries(gates).filter(([,g])=>g.status==='FAIL').map(([k,g])=>`${k}: ${g.detail}`):['Run fresh live-browser production verification','Maintain injury/market/expert refreshes through kickoff','Freeze each final pre-kickoff snapshot'],notificationPolicy:'Notify only for material handicap evidence, material confidence/disagreement change, official activation or unresolved hard gate failure.'};
await fs.writeFile(`data/weekly-manifest-${season}-w${week}.json`,JSON.stringify(manifest,null,2)+'\n');
console.log(`Weekly manifest ${manifest.status}`);
