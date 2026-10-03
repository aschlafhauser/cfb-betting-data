import fs from 'node:fs/promises';
const board=JSON.parse(await fs.readFile('data/weekly-board.json','utf8'));
const week=Number(board.week||2), now=new Date().toISOString();
const research=JSON.parse(await fs.readFile(`data/upset-research-2026-w${week}.json`,'utf8'));
const byId=new Map((research.upsetLab||[]).map(x=>[String(x.canonicalGameId),x]));
const ls=JSON.parse(await fs.readFile('data/longshot-upset-lab.json','utf8'));
let updated=0,missing=0;
for(const c of ls.candidates||[]){
  const r=byId.get(String(c.canonicalGameId));
  if(!r){missing++;continue;}
  c.score=Number.isFinite(Number(r.score25))?Number(r.score25):Number(r.profileScore);
  c.score25=c.score;
  c.scoreMax=25;
  c.unifiedProfileScore=c.score;
  c.researchTier=r.tier||null;
  c.researchComponents=r.components||null;
  c.componentEvidence=r.componentEvidence||null;
  c.scoringSignals=r.signals||null;
  c.estimatedWinProbability=r.estimatedWinProbability??null;
  c.marketWinProbability=r.marketWinProbability??null;
  c.upsetPriceStatus=r.priceStatus||'NO_EXECUTABLE_MONEYLINE';
  c.researchFlags=r.researchFlags||null;
  c.scoreAudit=r.scoreAudit||null;
  c.narrative=r.narrative||null;
  c.upsetCase=r.narrative?.upsetCase||null;
  c.whyItCouldFail=r.narrative?.whyItCouldFail||null;
  c.keyThingsToWatch=r.narrative?.keyThingsToWatch||[];
  c.classification=r.tier?`25PT ${r.tier}`:'25PT';
  updated++;
}
ls.version='3.0-25pt-evidence-capped';
ls.updatedAt=now;
ls.scoreMax=25;
ls.scoreWeights={qbStability:4,trenchResistance:4,explosivePath:3,compression:3,havocVolatility:3,coachingSituational:2,availability:2,productionModel:2,independentModel:2};
ls.classifications={priorityResearch:'19+',liveResearch:'16-18.9',watch:'13-15.9',pass:'<13'};
ls.coverage={...(ls.coverage||{}),scoreFramework:'25-point evidence-capped v3',narrativeCandidates:(ls.candidates||[]).filter(x=>x.upsetCase&&x.whyItCouldFail).length,scoreSyncMissing:missing};
await fs.writeFile('data/longshot-upset-lab.json',JSON.stringify(ls,null,2)+'\n');
if(missing) throw new Error(`Longshot v2 sync missing ${missing} governed upset-research records`);
console.log(`Longshot v2 applied: ${updated}/${(ls.candidates||[]).length} candidates, 25-point scores + narratives.`);
