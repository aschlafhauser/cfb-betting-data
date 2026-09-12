import fs from 'node:fs/promises';
const board=JSON.parse(await fs.readFile('data/weekly-board.json','utf8'));
const week=Number(board.week||2), now=new Date().toISOString();
const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const key=(a,h)=>`${norm(a)}__${norm(h)}`;
function parseSpread(s){const m=String(s||'').match(/^(.+?)\s+(-?\d+(?:\.\d+)?)/);return m?{fav:m[1].trim(),line:Math.abs(Number(m[2]))}:null}
function dogFor(g){const p=parseSpread(g.currentSpread);if(!p)return null;const fav=norm(p.fav),away=norm(g.away),home=norm(g.home);if(fav===away)return {team:g.home,opponent:g.away,spread:p.line};if(fav===home)return {team:g.away,opponent:g.home,spread:p.line};return null}
function parseML(text,team){const s=String(text||'');if(!s)return null;const idx=s.toLowerCase().indexOf(String(team).toLowerCase());if(idx<0)return null;const tail=s.slice(idx+String(team).length);const m=tail.match(/([+-]\d+)/);return m?Number(m[1]):null}
function numericML(text){const m=String(text||'').match(/([+]\d+)/);return m?Number(m[1]):null}
const boardByKey=new Map((board.games||[]).map(g=>[key(g.away,g.home),g]));
const LEGACY_MATCHUPS={
 '2026-W2-RUT-BC':['Rutgers','Boston College'],
 '2026-W2-MIZZ-KAN':['Missouri','Kansas'],
 '2026-W2-OKLA-MICH':['Oklahoma','Michigan'],
 '2026-W2-ORE-OKST':['Oregon','Oklahoma State'],
 '2026-W2-ASU-TAMU':['Arizona State','Texas A&M'],
 '2026-W2-ILL-DUKE':['Illinois','Duke'],
 '2026-W2-OHST-TEX':['Ohio State','Texas'],
 '2026-W2-TTU-ORST':['Texas Tech','Oregon State'],
 '2026-W2-ARK-UTAH':['Arkansas','Utah']
};

// Pull the unified research score into specialty views. This is display/research-only and has zero production impact.
let upsetResearch={upsetLab:[],underdogSpecial:[]};
try{upsetResearch=JSON.parse(await fs.readFile(`data/upset-research-2026-w${week}.json`,'utf8'))}catch{}
const upsetById=new Map([...(upsetResearch.upsetLab||[]),...(upsetResearch.underdogSpecial||[])].map(x=>[String(x.canonicalGameId),x]));

// Preserve the newest governed moneyline evidence even when the current ESPN schedule feed omits ML.
// Older values remain explicitly timestamped/stale rather than being mislabeled as current executable prices.
const governedMlByPair=new Map();
try{
  const files=(await fs.readdir('data')).filter(f=>/^weekday-intel-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  for(const f of files){
    let doc;try{doc=JSON.parse(await fs.readFile(`data/${f}`,'utf8'))}catch{continue}
    if(Number(doc.week)!==week)continue;
    const ts=doc.timestamp||doc.updatedAt||null;
    for(const c of doc.longshotScreen?.verifiedMondayCandidates||[]){
      const k=norm(c.team+' '+c.opponent); if(c.moneyline) governedMlByPair.set(k,{moneyline:c.moneyline,timestamp:ts,source:`${f} longshotScreen`});
    }
    for(const c of doc.longshotScreen?.verifiedCandidates||[]){
      const k=norm(c.team+' '+c.opponent); if(c.moneyline) governedMlByPair.set(k,{moneyline:c.moneyline,timestamp:ts,source:`${f} longshotScreen`});
    }
  }
}catch{}

let sunday={observations:[]};
try{sunday=JSON.parse(await fs.readFile(`data/timing-observations/2026-W${week}-sunday-open.json`,'utf8'))}catch{}
const movers=[];
for(const o of sunday.observations||[]){
  let g=null;
  if(o.away&&o.home)g=boardByKey.get(key(o.away,o.home))||null;
  const mapped=LEGACY_MATCHUPS[o.gameId];if(!g&&mapped)g=boardByKey.get(key(mapped[0],mapped[1]))||null;
  if(!g)continue;
  movers.push({canonicalGameId:g.gameId,legacyGameId:o.gameId||null,matchup:`${g.away} at ${g.home}`,reference:{spread:o.marketSpread??null,total:o.marketTotal??null,moneyline:o.marketMoneyline??null,timestamp:sunday.timestamp||null,stage:o.stage||sunday.stage||'sunday-open'},current:{spread:g.currentSpread??null,total:g.currentTotal??null,moneyline:g.currentMoneyline??null,timestamp:board.updatedAt||now,source:g.marketSource||null},model:{spread:g.modelSpread??null,total:g.modelTotal??null,edgeMagnitude:g.modelEdgeMagnitude??null,independentFootballFair:g.independentFootballFair??null,independentFootballSide:g.independentFootballSide??null,independentFootballEdge:g.independentFootballEdge??null},deepDiveStatus:g.deepDiveStatus||'PENDING',classification:'RECONCILE',note:'Movement is descriptive only; direction never activates a bet without governed fair and execution gate.'});
}
await fs.writeFile(`data/market-movers-2026-w${week}.json`,JSON.stringify({season:2026,week,updatedAt:now,status:'CURRENT',coverage:{referenceGames:movers.length,expectedReferenceGames:(sunday.observations||[]).length,currentBoardGames:(board.games||[]).length,unmatchedReferenceGames:(sunday.observations||[]).length-movers.length},movers},null,2)+'\n');

let priorUD={candidates:[]};try{priorUD=JSON.parse(await fs.readFile('data/underdog-special.json','utf8'))}catch{}
const priorUdByTeam=new Map((priorUD.candidates||[]).map(c=>[norm(c.team+' '+c.opponent),c]));
const ud=[];
let teamMetrics={teams:[]},espnFpi={teams:[]};
try{teamMetrics=JSON.parse(await fs.readFile('data/team-metrics-current.json','utf8'))}catch{}
try{espnFpi=JSON.parse(await fs.readFile('data/espn-fpi-current.json','utf8'))}catch{}
const teamMetricByName=new Map((teamMetrics.teams||[]).map(x=>[norm(x.team),x]));
const fpiByName=new Map((espnFpi.teams||[]).filter(x=>x.team).map(x=>[norm(x.team),x]));
const finite=v=>Number.isFinite(Number(v));
const one=v=>finite(v)?Number(v).toFixed(1):'unavailable';
function assessUnderdogCriteria(team,opponent,gameId){
 const dogMetric=teamMetricByName.get(norm(team)),oppMetric=teamMetricByName.get(norm(opponent));
 const dogFpi=fpiByName.get(norm(team)),oppFpi=fpiByName.get(norm(opponent));
 const research=upsetById.get(String(gameId));
 const dogSos=dogFpi?.stats?.avgsosrank?.value,oppSos=oppFpi?.stats?.avgsosrank?.value;
 const restPass=finite(dogSos)&&finite(oppSos)&&Number(dogSos)+10<=Number(oppSos);
 const dogTotal=dogFpi?.stats?.totefficiency?.value,oppTotal=oppFpi?.stats?.totefficiency?.value;
 const nonPass=finite(dogTotal)&&finite(oppTotal)&&Number(dogTotal)>Number(oppTotal);
 const dogYpa=dogMetric?.offense?.yardsPerPassAttempt,oppYpa=oppMetric?.offense?.yardsPerPassAttempt;
 const qbPath=Number(research?.components?.qbStability||0)>=4;
 const qbPass=qbPath||(finite(dogYpa)&&finite(oppYpa)&&Number(dogYpa)>=Number(oppYpa)+0.5);
 const restReason=finite(dogSos)&&finite(oppSos)?`${restPass?'Material schedule edge':'No material schedule/rest edge'}: ESPN FPI prior-schedule rank ${Math.round(Number(dogSos))} vs ${Math.round(Number(oppSos))}; PASS requires the underdog's prior schedule to be at least 10 ranks stronger (lower rank).`:'No governed rest/schedule advantage is demonstrated; a comparable ESPN FPI prior-schedule row is unavailable for the opponent, so the criterion does not pass.';
 const nonReason=finite(dogTotal)&&finite(oppTotal)?`${nonPass?'Advantage':'No advantage'}: ESPN opponent-adjusted total per-play efficiency ${one(dogTotal)} vs ${one(oppTotal)}.`:'No governed opponent-adjusted per-play comparison is available for both teams, so the non-explosive efficiency criterion does not pass.';
 const qbReason=qbPath?`PASS: the completed Unified Upset Deep Dive identifies a credible underdog QB/passing path (QB-stability component ${Number(research.components.qbStability)}/4); raw current YPA is ${one(dogYpa)} vs ${one(oppYpa)}.`:`${qbPass?'PASS':'FAIL'}: governed current passing YPA is ${one(dogYpa)} vs ${one(oppYpa)}; PASS requires at least a +0.5 YPA edge when the Deep Dive does not identify a directional QB advantage.`;
 const qualifiers={rest:{qualifies:restPass,reason:restReason,source:'ESPN FPI prior schedule-strength rank',sourceUpdatedAt:espnFpi.updatedAt||null},nonExplosive:{qualifies:nonPass,reason:nonReason,source:'ESPN opponent-adjusted total efficiency',sourceUpdatedAt:espnFpi.updatedAt||null},qbYpa:{qualifies:qbPass,reason:qbReason,source:qbPath?'Unified Upset Deep Dive plus ESPN team metrics':'ESPN team metrics yards per pass attempt',sourceUpdatedAt:qbPath?(upsetResearch.updatedAt||teamMetrics.updatedAt||null):(teamMetrics.updatedAt||null)}};
 const count=Object.values(qualifiers).filter(x=>x.qualifies).length;
 return{qualifiers,count,profileQualifies:count>=2};
}
for(const g of board.games||[]){
 const d=dogFor(g);if(!d||d.spread<3.5||d.spread>7)continue;
 const prior=priorUdByTeam.get(norm(d.team+' '+d.opponent));const ml=parseML(g.currentMoneyline,d.team);const priceCurrent=Number.isFinite(ml);const research=upsetById.get(String(g.gameId));
 const assessment=assessUnderdogCriteria(d.team,d.opponent,g.gameId);
 const action=assessment.profileQualifies?(priceCurrent?'Football profile qualifies; evaluate the separate fair-ML value gate at the current governed price.':'Football profile qualifies; verify a current executable moneyline and then apply the separate fair-ML value gate.'):`No Special: football profile clears ${assessment.count}/3 criteria; retain as an in-band watchlist candidate.`;
 ud.push({week,canonicalGameId:g.gameId,legacyGameId:prior?.gameId||null,team:d.team,opponent:d.opponent,currentSpread:`+${d.spread}`,currentMoneyline:priceCurrent?(ml>0?`+${ml}`:`${ml}`):null,moneylineStatus:priceCurrent?'CURRENT':'PRICE-RECHECK-REQUIRED',profileScore:Number.isFinite(research?.profileScore)?research.profileScore:null,researchTier:research?.tier||null,qualifiers:assessment.qualifiers,qualifierCount:assessment.count,profileQualifies:assessment.profileQualifies,criterionAssessmentStatus:'COMPLETE',criterionAssessmentVersion:'v1.1-governed-2026-09-12',criterionAssessedAt:now,mlValueQualifies:priceCurrent?(prior?.fairMl!=null?ml>Number(prior.fairMl):null):null,deepDiveStatus:g.deepDiveStatus||'PENDING',status:priceCurrent?'CURRENT-SCREEN':'CURRENT-SCREEN-PRICE-PENDING',action,note:'All three football-profile criteria are explicitly assessed from governed schedule, opponent-adjusted efficiency, QB/YPA and completed Deep Dive evidence. Price remains a separate execution gate.'});
}

priorUD.research=priorUD.research||{};
priorUD.research.criterionAssessment={version:'v1.1-governed-2026-09-12',status:'COMPLETE',assessedAt:now,timing:'Complete during Sunday kickoff / Monday early-week screen; refresh after material schedule, statistical, QB or availability changes.',methods:{rest:`PASS when ESPN FPI prior-schedule rank shows the underdog faced a schedule at least 10 ranks stronger (lower rank). Otherwise FAIL; absence of a comparable opponent row cannot create a pass.`,nonExplosive:`PASS when the underdog's ESPN opponent-adjusted total per-play efficiency exceeds the opponent's.`,qbYpa:`PASS when the Unified Upset Deep Dive supplies a full directional QB/passing-path score or governed current YPA is at least 0.5 higher than the opponent's.`},provenance:['data/espn-fpi-current.json','data/team-metrics-current.json',`data/upset-research-2026-w${week}.json`]};
priorUD.week=week;priorUD.updatedAt=now;priorUD.sundayWeek2Rerun={timestamp:now,result:'CURRENT SCREEN + CRITERIA COMPLETE',criterionAssessment:`${ud.filter(x=>x.criterionAssessmentStatus==='COMPLETE').length}/${ud.length} candidates fully assessed`,note:`Canonical board produced ${ud.length} +3.5-to-+7 underdogs. All three football-profile criteria are governed and complete; moneyline availability/value remains a separate gate.`};priorUD.candidates=[...(priorUD.candidates||[]).filter(c=>Number(c.week)!==week),...ud];
await fs.writeFile('data/underdog-special.json',JSON.stringify(priorUD,null,2)+'\n');

let priorLS={candidates:[]};try{priorLS=JSON.parse(await fs.readFile('data/longshot-upset-lab.json','utf8'))}catch{}
const priorLsByTeam=new Map((priorLS.candidates||[]).map(c=>[norm(c.team+' '+c.opponent),c]));
const ls=[];
for(const g of board.games||[]){
  const d=dogFor(g);if(!d||d.spread<9.5)continue;
  const prior=priorLsByTeam.get(norm(d.team+' '+d.opponent));
  const research=upsetById.get(String(g.gameId));
  // Keep the primary lab focused on games with both-team independent-model coverage, unified upset research, or an existing governed longshot record.
  const hasFbsCoverage=!!g.independentFootballFair||!!research||!!prior;
  if(!hasFbsCoverage)continue;
  const currentMl=parseML(g.currentMoneyline,d.team),pairEvidence=governedMlByPair.get(norm(d.team+' '+d.opponent));
  const currentPrice=Number.isFinite(currentMl);
  const evidenceText=currentPrice?(currentMl>0?`+${currentMl}`:`${currentMl}`):(pairEvidence?.moneyline||null);
  const evidenceNumeric=currentPrice?currentMl:numericML(evidenceText);
  const hasEvidence=Number.isFinite(evidenceNumeric);
  const qualifiesPrice=hasEvidence&&evidenceNumeric>=300;
  const score=Number.isFinite(research?.profileScore)?research.profileScore:(Number.isFinite(prior?.score)?prior.score:null);
  const classification=research?.tier?(`UNIFIED ${research.tier}`):(prior?.classification||'WATCH / PRICE PENDING');
  ls.push({week,canonicalGameId:g.gameId,legacyGameId:prior?.gameId||null,team:d.team,opponent:d.opponent,currentSpread:`+${d.spread}`,currentMoneyline:evidenceText,priorMoneyline:prior?.currentMoneyline||prior?.moneyline||null,priceStatus:currentPrice?'CURRENT':(hasEvidence?'LAST-GOVERNED-PRICE / RECHECK REQUIRED':'PRICE-RECHECK-REQUIRED'),moneylineTimestamp:currentPrice?(board.updatedAt||now):(pairEvidence?.timestamp||null),moneylineSource:currentPrice?(g.marketSource||'canonical weekly board'):(pairEvidence?.source||null),screenEligibility:qualifiesPrice?(currentPrice?'VERIFIED CURRENT +300+':'LAST-GOVERNED +300+ / CURRENT RECHECK'):(hasEvidence?'LAST-GOVERNED BELOW +300 / CURRENT RECHECK':'LIKELY LONGSHOT / ML PENDING'),score,unifiedProfileScore:Number.isFinite(research?.profileScore)?research.profileScore:null,researchTier:research?.tier||null,researchComponents:research?.components||null,researchFlags:research?.researchFlags||null,classification,informationQuality:research?.informationQuality||prior?.informationQuality||'standard',qbThesis:prior?.qbThesis||null,compressionThesis:prior?.compressionThesis||null,personnel:prior?.personnel||null,deepDiveStatus:g.deepDiveStatus||'PENDING',action:currentPrice&&qualifiesPrice?'Reconcile mechanism and governed value; classification alone never activates a wager.':(hasEvidence?'Historical governed ML is displayed for context only; re-verify current executable price before any decision.':'Keep visible until current moneyline is verified.'),note:'Unified upset score is research-only with zero production impact. Non-current moneylines are visibly labeled and may not be used for execution.'});
}
priorLS.week=week;priorLS.updatedAt=now;priorLS.status='prospective-live-current-screen';priorLS.coverage={...(priorLS.coverage||{}),eligibilityUniverse:`complete ${(board.games||[]).length}-game canonical selected-week schedule; primary display filtered to governed football coverage/unified upset research`,thursdayScreenComplete:true,lastCanonicalRefresh:now,scoredCandidates:ls.filter(x=>Number.isFinite(x.score)).length,pricedCandidates:ls.filter(x=>x.currentMoneyline).length,currentPricedCandidates:ls.filter(x=>x.priceStatus==='CURRENT').length};priorLS.candidates=ls;
await fs.writeFile('data/longshot-upset-lab.json',JSON.stringify(priorLS,null,2)+'\n');
console.log(`Specialty layers refreshed: movers=${movers.length}/${(sunday.observations||[]).length}, underdog-band=${ud.length}, longshot-primary=${ls.length}, longshot-scored=${ls.filter(x=>Number.isFinite(x.score)).length}, longshot-priced=${ls.filter(x=>x.currentMoneyline).length}.`);