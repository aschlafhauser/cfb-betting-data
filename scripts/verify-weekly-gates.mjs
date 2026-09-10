import fs from 'node:fs/promises';

const board=JSON.parse(await fs.readFile('data/weekly-board.json','utf8'));
const season=Number(process.env.CFB_SEASON||board.season||2026),week=Number(process.env.CFB_WEEK||board.week);
if(!Number.isFinite(week))throw new Error('No valid selected week');
const manifest=JSON.parse(await fs.readFile(`data/weekly-manifest-${season}-w${week}.json`,'utf8'));
const deep=JSON.parse(await fs.readFile('data/deep-dive-status.json','utf8'));
const dossiers=JSON.parse(await fs.readFile(`data/deep-dives-${season}-w${week}.json`,'utf8'));
const upset=JSON.parse(await fs.readFile(`data/upset-research-${season}-w${week}.json`,'utf8'));
const failures=[];
const expected=Number(manifest?.gates?.canonicalSchedule?.expectedGames||board.scheduleCoverage?.slateCount||0);
if(Number(board.week)!==week)failures.push(`Weekly Board week ${board.week} != expected ${week}`);
if(!Array.isArray(board.games)||board.games.length!==expected)failures.push(`Canonical schedule ${board.games?.length||0}/${expected}`);
if(Number(deep.week)!==week)failures.push(`Deep Dive status week ${deep.week} != expected ${week}`);
if(Number(deep.completedGameCount||0)!==expected||Number(deep.pendingGameCount||0)!==0)failures.push(`Deep Dive completion ${deep.completedGameCount||0}/${expected}, pending=${deep.pendingGameCount||0}`);
const ds=Array.isArray(dossiers.dossiers)?dossiers.dossiers:[];
if(ds.length!==expected)failures.push(`Dossier inventory ${ds.length}/${expected}`);
const ids=ds.map(d=>d.canonicalGameId).filter(Boolean),unique=new Set(ids);
if(ids.length!==expected||unique.size!==expected)failures.push(`Canonical dossier IDs not unique/complete (${unique.size}/${expected})`);
const invalid=ds.filter(d=>!['COMPLETE','COMPLETE-SOURCE-LIMITED'].includes(d.status)||Number(d.evidenceCount||0)<1||!Array.isArray(d.mechanisms)||d.mechanisms.length<1);
if(invalid.length)failures.push(`${invalid.length} dossiers fail minimum evidence/status schema`);
const boardStatus=(board.games||[]).filter(g=>!['COMPLETE','COMPLETE-SOURCE-LIMITED'].includes(g.deepDiveStatus)||Number(g.deepDiveEvidenceCount||0)<1);
if(boardStatus.length)failures.push(`${boardStatus.length} Weekly Board rows are not joined to completed dossier state`);

// Unified upset research routing is independently revalidated here; manifest text alone is insufficient.
const all=[...(upset.underdogSpecial||[]),...(upset.upsetLab||[]),...(upset.intermediate||[])];
const lineOf=r=>Number(String(r.currentSpread||'').replace('+',''));
const routingViolations=all.filter(r=>{
  const line=lineOf(r);if(!Number.isFinite(line))return true;
  if(r.band==='UNDERDOG-SPECIAL')return !(line>=3.5&&line<=7);
  if(r.band==='UPSET-LAB')return line<9.5;
  if(r.band==='INTERMEDIATE')return (line>=3.5&&line<=7)||line>=9.5;
  return true;
});
if(Number(upset.week)!==week)failures.push(`Unified upset research week ${upset.week} != expected ${week}`);
if(Number(upset?.coverage?.routingViolations)!==0)failures.push(`Unified upset research reports routingViolations=${upset?.coverage?.routingViolations}`);
if(routingViolations.length)failures.push(`Unified upset routing has ${routingViolations.length} invalid records: ${routingViolations.slice(0,5).map(r=>`${r.team} ${r.currentSpread} -> ${r.band}`).join('; ')}`);

for(const [name,gate] of Object.entries(manifest.gates||{}))if(String(gate.status||'').toUpperCase()==='FAIL')failures.push(`${name}: ${gate.detail||'failed'}`);
const result={season,week,checkedAt:new Date().toISOString(),scheduleGames:board.games?.length||0,deepDiveComplete:deep.completedGameCount||0,deepDivePending:deep.pendingGameCount||0,fullEvidence:deep.fullEvidenceCount||0,sourceLimited:deep.sourceLimitedCount||0,dossierInventory:ds.length,upsetResearchRecords:all.length,upsetRoutingViolations:routingViolations.length,status:failures.length?'FAIL':'PASS',failures};
console.log(JSON.stringify(result,null,2));if(failures.length)process.exit(1);
