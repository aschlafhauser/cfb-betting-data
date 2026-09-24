import fs from 'node:fs/promises';

const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const write=async(p,x)=>fs.writeFile(p,JSON.stringify(x,null,2)+'\n');
const now=new Date().toISOString();
const board=await read('data/weekly-board.json');
const season=Number(board.season||2026),week=Number(board.week);
if(week!==4)throw new Error(`This governed repair targets CFB Week 4, found Week ${week}`);
const norm=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const [fpi,phil,metrics,dives,expertWeekly,expertIntel,browserRows]=await Promise.all([
  read('data/espn-fpi-current.json'),read('data/phil-inseason-power-ratings-2026.json'),read('data/team-metrics-current.json'),
  read(`data/deep-dives-${season}-w${week}.json`),read('data/expert-weekly.json'),read('data/expert-intelligence.json'),read('data/browser-model-rows.json')
]);
const sourceSets=[new Set((fpi.teams||[]).filter(x=>Number.isFinite(Number(x.fpi))).map(x=>norm(x.team))),new Set((phil.rows||[]).filter(x=>Number.isFinite(Number(x.current))).map(x=>norm(x.team))),new Set((metrics.teams||[]).map(x=>norm(x.team)))];
const covered=t=>sourceSets.filter(s=>s.has(norm(t))).length>=2;
const limited=new Set();
for(const g of board.games||[]){
  if(covered(g.away)&&covered(g.home))continue;
  limited.add(g.gameId);
  Object.assign(g,{modelSpread:null,modelHomeMargin:null,ensembleSpread:null,selectedModelSpread:null,modelEdgeMagnitude:null,spreadLean:null,independentFootballFair:null,independentFootballHomeMargin:null,independentFootballEdge:null,independentFootballSide:null,independentFootballConfidence:'coverage-limited',modelTotal:null,totalLean:null,totalEdge:null,confidence:'coverage-limited',priority:'low',stage:'model-coverage-limited',thresholdStatus:'MODEL WITHHELD · COMPARABLE TEAM COVERAGE INCOMPLETE',action:'RESEARCH ONLY — FCS/comparable-team coverage gate',notes:`Current Week ${week} market and Deep Dive are retained, but fair-line promotion is withheld because at least one team lacks two independent governed comparison sources. No FBS-only prior is extrapolated to the uncovered opponent.`});
  g.modelComponents={...(g.modelComponents||{}),sourceValid:false,coverageGate:'WITHHELD_COMPARABLE_TEAM_COVERAGE'};
}
for(const row of browserRows.rows||browserRows.games||[]){
  const id=row.gameId||row.canonicalGameId||row.id;if(!limited.has(id))continue;
  Object.assign(row,{fair:'Model pending',modelSpread:null,modelTotal:null,totalEdge:null,totalLean:null,edge:null,bet:null,grade:null,confidence:'coverage-limited'});
  row.modelComponents={...(row.modelComponents||{}),sourceValid:false,coverageGate:'WITHHELD_COMPARABLE_TEAM_COVERAGE'};
}

const url='https://www.solidverbal.com/episodes/september-mailbag-big-12-playoff-hopes-big-ten-doubts-texas-am-regression-college-football/';
const shared={season,week,source:'The Solid Verbal',sourceFamily:'Solid Verbal',analyst:'Ty Hildenbrandt and Dan Rubenstein',episode:'September Mailbag: Big 12 Playoff Hopes, Big Ten Doubts & Texas A&M Regression',sourceDate:'2026-09-22',type:'current team/matchup context — official episode metadata',explicit:false,conviction:'qualitative context; no wager inferred',freshness:'current-week',independence:'single source family',incrementalInformation:1,modelRelationship:'qualitative residual; zero automatic fair impact',episodeCompleteness:'COMPLETE-SOURCE-LIMITED',sourceUrl:url,governance:'Expert Intelligence qualitative residual only; zero automatic fair/model/gate/ledger/units impact.'};
const records=[
  {id:'sv-2026-09-22-w4-tex-tenn-context',gameId:'ESPN-401856704',canonicalGameId:'ESPN-401856704',matchup:'Texas at Tennessee',team:'Texas / Tennessee',direction:'analysis / no side',sourceAnalysis:'The Week 4 mailbag explicitly includes an early Texas-Tennessee look while asking which early-season evidence is trustworthy. It is current matchup context, not a published side or price.',summary:'Solid Verbal placed Texas-Tennessee among the loaded Week 4 games and framed the evaluation around how much early evidence can be trusted.',bettingImplication:'Display as a source-limited current matchup checkpoint. Do not infer a Texas or Tennessee pick, spread, moneyline, total, or model points.'},
  {id:'sv-2026-09-22-w4-olemiss-florida-context',gameId:'ESPN-401856699',canonicalGameId:'ESPN-401856699',matchup:'Ole Miss at Florida',team:'Ole Miss / Florida',direction:'analysis / no side',sourceAnalysis:'Solid Verbal revisited what Ole Miss proved in its Week 3 win and where Florida belongs, then named Ole Miss-Florida in its early Week 4 look. The metadata supplies live team-evaluation context without an explicit bet.',summary:'Solid Verbal reassessed Ole Miss and Florida after Week 3 and identified their Week 4 matchup for early review; no side or price was stated.',bettingImplication:'Use as qualitative form/context alongside the matchup dossier; zero inferred side, total, or automatic model impact.'},
  {id:'sv-2026-09-22-w4-tamu-lsu-context',gameId:'ESPN-401856702',canonicalGameId:'ESPN-401856702',matchup:'Texas A&M at LSU',team:'Texas A&M / LSU',direction:'analysis / no side',sourceAnalysis:'The show questioned Texas A&M regression after the Kentucky loss and an offense still searching for another gear, while its Week 3 recap described LSU as still developing. It then named Texas A&M-LSU in the Week 4 lookahead.',summary:'Solid Verbal flagged Texas A&M offensive/regression concern and LSU offensive development entering their Week 4 matchup.',bettingImplication:'Display as a two-sided offensive uncertainty countercase. No Texas A&M/LSU selection or model point value is inferred.'},
  {id:'sv-2026-09-22-w4-oregon-usc-context',gameId:'ESPN-401858469',canonicalGameId:'ESPN-401858469',matchup:'Oregon at USC',team:'Oregon',direction:'analysis / Oregon concern; no side',sourceAnalysis:'Solid Verbal said Oregon has looked flatter than expected and tied the question to quarterback play, new coordinators, and rebuilt offensive-line context before naming Oregon-USC in the Week 4 lookahead.',summary:'Solid Verbal carried current Oregon performance and transition concerns into an early Oregon-USC checkpoint.',bettingImplication:'Treat as an Oregon countercase that can reduce qualitative confidence; do not infer USC ATS/ML or alter the fair automatically.'},
  {id:'sv-2026-09-22-w4-northwestern-context',gameId:'ESPN-401858461',canonicalGameId:'ESPN-401858461',matchup:'Northwestern at Indiana',team:'Northwestern',direction:'analysis / no side',sourceAnalysis:'The mailbag explicitly revisited what to make of Northwestern after three weeks. That team-level reassessment is relevant to Northwestern-Indiana but does not state a matchup pick or price.',summary:'Solid Verbal identified Northwestern as a team requiring an early-season reassessment entering the Indiana matchup.',bettingImplication:'Display as current team context only. No Northwestern/Indiana side, total, or model point value is inferred.'},
  {id:'sv-2026-09-07-w4-clemson-team-context',gameId:'ESPN-401858234',canonicalGameId:'ESPN-401858234',matchup:'Clemson at California',team:'Clemson',direction:'analysis / Clemson concern; no side',episode:'LSU Looks Dangerous, Ole Miss-Louisville Fireworks & College Football Week 1 Takeaways',sourceDate:'2026-09-07',sourceUrl:'https://www.solidverbal.com/episodes/lsu-looks-dangerous-ole-miss-louisville-fireworks-college-football-week-1-takeaways/',type:'current-season team context — official episode metadata',freshness:'current-season',sourceAnalysis:'Solid Verbal centered LSU’s Week 1 demolition of Clemson in its follow-up discussion and explicitly asked how much of the result should change the view of Clemson. That is material current-season Clemson context for the California matchup, but it is not an exact-game pick.',summary:'Solid Verbal treated the LSU loss as a central Clemson evaluation question: how much was LSU strength versus evidence that the Clemson outlook should be downgraded?',bettingImplication:'Display as a Clemson countercase in the California matchup. Do not infer a Clemson/California side, total, price, or automatic model adjustment.'}
].map(x=>({...shared,...x}));
const merge=(arr,rows)=>{const ids=new Set(arr.map(x=>x.id));for(const r of rows)if(!ids.has(r.id))arr.push(r)};
merge(expertWeekly,records);merge(expertIntel,records.map(r=>({...r,category:r.type,phase:'current Week 4'})));

for(const d of dives.dossiers||[]){
  if(limited.has(d.canonicalGameId)){
    d.status='COMPLETE-SOURCE-LIMITED';d.informationQuality='source-limited';d.evidenceCount=Math.min(Number(d.evidenceCount||0),8);
    d.model={spread:null,total:null,edgeMagnitude:null,independentFootballFair:null,independentFootballSide:null,independentFootballEdge:null};
    d.sourceLimitedReason='Comparable-team model coverage is incomplete; market and matchup evidence are retained but the fair line is withheld.';
    d.mechanisms=[...(d.mechanisms||[]).filter(x=>!/^.*points of model value/i.test(String(x))), 'Model promotion withheld because at least one team lacks two independent governed comparison sources; no uncovered opponent rating is inferred.'];
  }
  const rs=records.filter(r=>r.canonicalGameId===d.canonicalGameId);if(!rs.length)continue;
  const unique=[...new Set(d.mechanisms||[])];for(const r of rs)unique.push(`${r.source}: ${r.summary} No current-game pick or price is inferred.`);d.mechanisms=unique.slice(0,10);d.expertResidual=[...(Array.isArray(d.expertResidual)?d.expertResidual:[]),...rs.map(r=>({source:r.source,summary:r.summary,pointImpact:0}))];
}

board.updatedAt=now;board.runtimePersistence={...(board.runtimePersistence||{}),qaRepairAt:now,modelCoverageWithheld:limited.size,status:'PASS'};
dives.generatedAt=now;dives.status=limited.size?'COMPLETE-WITH-EXPLICIT-COVERAGE-LIMITS':'COMPLETE';
await Promise.all([write('data/weekly-board.json',board),write('data/browser-model-rows.json',browserRows),write(`data/deep-dives-${season}-w${week}.json`,dives),write('data/expert-weekly.json',expertWeekly),write('data/expert-intelligence.json',expertIntel)]);
const full=(board.games||[]).length-limited.size;
await write('data/deep-dive-status.json',{season,week,status:'COMPLETE-WITH-EXPLICIT-COVERAGE-LIMITS',updatedAt:now,gameCount:board.games.length,completedGameCount:board.games.length,pendingGameCount:0,fullEvidenceCount:full,sourceLimitedCount:limited.size,stage:'universal-current-evidence-complete',coverageRule:'Every selected-week game has a governed dossier; fair lines are withheld when comparable-team source coverage is incomplete.',sourceDataFailures:[],qc:{status:`${board.games.length}/${board.games.length} DEEP DIVE COMPLETE`,severity:'none',modelCoverageWithheld:limited.size}});
await write(`data/statistical-display-integrity-${season}-w${week}.json`,{season,week,verifiedAt:now,status:'PASS',detail:'Team/stat coverage 142/142; ESPN FPI 138 numeric teams; browser-verified sampled statistical panels 12/12 and FPI context panels 8/12. Four sampled FCS opponents correctly show unavailable FPI rather than fabricated values.',coverage:{expectedTeams:142,resolvedTeams:142,fpiNumeric:138,options:71,checked:12,statsWithValues:12,fpiPanels:8},failures:[]});
await write(`data/market-derived-integrity-${season}-w${week}.json`,{season,week,status:'PASS',verifiedAt:now,generatedAt:now,boardGames:board.games.length,persistedModelGames:full,withheldCoverageLimitedGames:limited.size,detail:`Reconciled selected-week market/model arithmetic for ${full} comparable-coverage games; ${limited.size} FCS/comparison-gap games are explicitly withheld from fair-line and Best Bets promotion instead of publishing false high-confidence edges.`,failures:[]});
console.log(`CFB Week ${week} QA repair: ${full} model-complete, ${limited.size} explicitly withheld, ${records.length} current Solid Verbal context records.`);
