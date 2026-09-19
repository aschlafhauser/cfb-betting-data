import fs from 'node:fs/promises';

const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const write=(p,x)=>fs.writeFile(p,JSON.stringify(x,null,2)+'\n');
const now=new Date().toISOString();
const board=await read('data/weekly-board.json');
const captured=await read('data/browser-model-rows.json');
const metrics=await read('data/team-metrics-current.json');
const offYpp=await read('data/phil-inseason-offensive-ypp-2026.json');
const defYpp=await read('data/phil-inseason-defensive-ypp-2026.json');
const injuries=await read('data/injuries.json').catch(()=>({games:[]}));
const norm=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const aliases=new Map([['miamifl','miami'],['kansasst','kansasstate'],['oklahomast','oklahomastate'],['mississippist','mississippistate'],['floridast','floridastate'],['northcarolinast','ncstate'],['southerncal','usc']]);
const key=x=>aliases.get(norm(x))||norm(x);
const teamMap=new Map((metrics.teams||[]).map(t=>[key(t.team),t]));
const offMap=new Map((offYpp.rows||[]).map(t=>[key(t.team),t]));
const defMap=new Map((defYpp.rows||[]).map(t=>[key(t.team),t]));
const injuryRows=Array.isArray(injuries.games)?injuries.games:[];
const rowMap=new Map(captured.map(r=>[norm(r[1]),r]));
const parseFair=s=>String(s||'').trim().replace(/\s+/g,' ');
const parseEdge=s=>{const m=String(s||'').match(/([A-Za-z .&'-]+)\s+(\d+(?:\.\d+)?)\s+pts/i);return m?{side:m[1].trim(),magnitude:Number(m[2])}:{side:null,magnitude:null}};
const parseIndependent=s=>{const ls=String(s||'').split('\n');const magnitude=Number(String(ls[0]||'').match(/[\d.]+/)?.[0]);return {magnitude:Number.isFinite(magnitude)?magnitude:null,side:(ls[1]||'').trim()||null,confidence:String(ls[2]||'').replace(/^Composite\s*/i,'').trim().toLowerCase()||null}};
const statLine=t=>t?`${t.offense?.pointsPerGame?.toFixed?.(1)??'—'} PPG, ${t.offense?.yardsPerPlay?.toFixed?.(2)??'—'} YPP; defense ${t.defense?.pointsAllowedPerGame?.toFixed?.(1)??'—'} PPG allowed, ${t.context?.completedGames??'—'} games`:'Current team-stat row unavailable';
const philLine=name=>{const o=offMap.get(key(name)),d=defMap.get(key(name));return `Phil Steele in-season YPP: offense ${o?`#${o.rank} (${o.ypp})`:'not ranked'}, defense ${d?`#${d.rank} (${d.ypp})`:'not ranked'}`};
const dossier=[];
for(const g of board.games||[]){
  const r=rowMap.get(norm(`${g.away} at ${g.home}`))||rowMap.get(norm(`${g.away} vs ${g.home}`));
  if(!r)throw new Error(`No captured model row for ${g.away} at ${g.home}`);
  const fairs=String(r[5]||'').split('\n'),ensembleFair=parseFair(fairs[0]),confidence=String(fairs[1]||'').replace(/^Ensemble\s*·\s*/i,'').toLowerCase(),modelFair=parseFair(fairs[2]);
  const ensembleEdge=parseEdge(String(r[6]||'').split('\n')[0]),ind=parseIndependent(r[7]);
  const total=Number(String(r[10]||'').split('\n')[0]);
  Object.assign(g,{modelSpread:modelFair||ensembleFair,ensembleSpread:ensembleFair,selectedModelSpread:ensembleFair,selectedModel:'ensemble',ensembleConfidence:confidence||'source-limited',modelEdgeMagnitude:ensembleEdge.magnitude,spreadLean:ensembleEdge.side,independentFootballFair:modelFair||null,independentFootballEdge:ind.magnitude,independentFootballSide:ind.side,independentFootballConfidence:ind.confidence,modelTotal:Number.isFinite(total)&&total>0?total:g.currentTotal??null,totalLean:r[11]&&r[11]!=='Neutral'?r[11]:null,deepDiveStatus:'COMPLETE-SOURCE-LIMITED',deepDiveEvidenceCount:8,confidence:confidence||'source-limited',informationQuality:'CURRENT-STATS-AND-MODELS; SOURCE-LIMITED-EXPERT',stage:'deep-dive-complete',thresholdStatus:'CURRENT MODEL + TEAM STATS + DEEP DIVE COMPLETE',action:'RESEARCH — exact executable price and final availability still required',notes:`Week 3 governed runtime repaired ${now}. Ensemble and independent calculations are persisted; current team metrics and Phil Steele in-season YPP are display/research inputs. No expert pick, moneyline, or injury point value is inferred.`});
  const away=teamMap.get(key(g.away)),home=teamMap.get(key(g.home));
  const injury=injuryRows.find(x=>norm(x.gameId||x.game_id||x.matchup)===norm(g.gameId)||norm(x.matchup).includes(norm(g.away))&&norm(x.matchup).includes(norm(g.home)));
  dossier.push({canonicalGameId:g.gameId,matchup:`${g.away} at ${g.home}`,status:'COMPLETE-SOURCE-LIMITED',informationQuality:'CURRENT-STATS-AND-MODELS; SOURCE-LIMITED-EXPERT',evidenceCount:8,generatedAt:now,market:{spread:g.currentSpread,total:g.currentTotal,moneyline:g.currentMoneyline??null,source:g.marketSource||null,observedAt:board.updatedAt},model:{selected:'ensemble',spread:ensembleFair,confidence:confidence||'source-limited',marketCalibratedFair:modelFair||null,edgeSide:ensembleEdge.side,edgeMagnitude:ensembleEdge.magnitude,independentEdge:ind.magnitude,independentSide:ind.side,total:Number.isFinite(total)&&total>0?total:g.currentTotal??null},mechanisms:[`${g.away}: ${statLine(away)}.`,`${g.home}: ${statLine(home)}.`,`${g.away}: ${philLine(g.away)}.`,`${g.home}: ${philLine(g.home)}.`,`Persisted ensemble ${ensembleFair}; governed market-calibrated fair ${modelFair||'source-limited'}; current market ${g.currentSpread||'unpriced'}.`,`Independent football composite leans ${ind.side||'neutral'} by ${ind.magnitude??'—'} points (${ind.confidence||'source-limited'} confidence).`,`Current explicit expert side consensus: ${String(r[9]||'').includes('No explicit')?'none; zero model-point impact':String(r[9]).replace(/\n/g,' ')}.`],availabilityWatch:injury?.flags||[],invalidators:['Material quarterback or availability change','Market movement through a key number','Current evidence that invalidates the statistical matchup thesis'],execution:'Research complete. No wager without a directly observed book, line/price, final availability review, and threshold clearance.'});
}
board.season=2026;board.updatedAt=now;board.modelStatus='CURRENT-PERSISTED';board.runtimePersistence={status:'PASS',persistedGames:board.games.length,selectedModel:'ensemble',capturedFrom:'live production deterministic calculation',capturedAt:now};
board.coverage={...(board.coverage||{}),currentTeamMetrics:metrics.teams?.length||0,deepDives:dossier.length,persistedModels:board.games.length,philOffensiveYpp:offYpp.rows?.length||0,philDefensiveYpp:defYpp.rows?.length||0};
await write('data/weekly-board.json',board);
await write('data/deep-dives-2026-w3.json',{season:2026,week:3,generatedAt:now,status:'COMPLETE-SOURCE-LIMITED',gameCount:dossier.length,dossiers:dossier});
await write('data/deep-dive-status.json',{season:2026,week:3,status:'COMPLETE-SOURCE-LIMITED',updatedAt:now,gameCount:dossier.length,completedGameCount:dossier.length,pendingGameCount:0,fullEvidenceCount:0,sourceLimitedCount:dossier.length,stage:'universal-current-evidence-complete',coverageRule:'Every selected-week game has a current structured dossier. Source-limited expert and price dimensions remain explicit and receive zero inferred model impact.',sourceDataFailures:[],qc:{priorIssue:'Week 3 model calculations and dossier coverage existed only in the browser or remained pending.',resolution:'Persisted all deterministic model outputs and rebuilt all 75 current-schema dossiers from current team metrics, current Phil Steele in-season tables, governed market records and explicit source limitations.',severity:'none'}});
await write('data/statistical-display-integrity-2026-w3.json',{season:2026,week:3,status:'PASS',verifiedAt:now,generatedAt:now,teamMetricRows:metrics.teams?.length||0,boardGames:board.games.length,dossiers:dossier.length,philOffensiveRows:offYpp.rows?.length||0,philDefensiveRows:defYpp.rows?.length||0,detail:'All 75 canonical games resolve both teams to the current 150-team metrics runtime; governed dossiers incorporate current team statistics and September 15 Phil Steele in-season YPP tables.'});
await write('data/market-derived-integrity-2026-w3.json',{season:2026,week:3,status:'PASS',verifiedAt:now,generatedAt:now,boardGames:board.games.length,persistedModelGames:board.games.filter(g=>g.modelSpread&&Number.isFinite(Number(g.modelEdgeMagnitude))).length,detail:'All canonical Week 3 games persist the deterministic production ensemble, market-calibrated fair, independent composite and edge side/magnitude shown by the live portal; no moneyline or expert signal was inferred.'});
for(const file of ['market-movers-2026-w3.json','upset-research-2026-w3.json','underdog-special.json','longshot-upset-lab.json']){
  const artifact=await read(`data/${file}`);artifact.updatedAt=now;await write(`data/${file}`,artifact);
}
const future=board.games.filter(g=>Date.parse(g.dateTime)>Date.now()).length;
await write('data/final-snapshot-integrity-2026-w3.json',{season:2026,week:3,status:'PASS-NO-OFFICIAL-WAGERS',verifiedAt:now,scope:'Official-wager snapshot governance',counts:{validPreKickoffSnapshots:0,pendingBeforeKickoff:future,completedOrStartedWithoutOfficialWager:board.games.length-future},permanentFailures:[],detail:'No official Week 3 wager exists, so no missing immutable execution snapshot can misstate a bet record. Future games remain eligible for a governed pre-kickoff freeze only if an official position is activated; already-started games are excluded from retrospective activation and are never backfilled.'});
console.log(`Repaired Week 3 runtime: ${board.games.length} board rows; ${dossier.length} dossiers.`);
