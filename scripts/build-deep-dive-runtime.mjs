import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const portal=process.env.CFB_PORTAL_URL||'https://cfb-betting-intelligence.netlify.app/';
const boardPath='data/weekly-board.json';
const board=JSON.parse(await fs.readFile(boardPath,'utf8'));
const week=Number(board.week||2), expected=Number(board.scheduleCoverage?.slateCount||board.games?.length||0);
const dossierPath=`data/deep-dives-2026-w${week}.json`;
const existing=await fs.readFile(dossierPath,'utf8').then(JSON.parse).catch(()=>({dossiers:[]}));
const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const key=(a,h)=>`${norm(a)}__${norm(h)}`;
const parseTeams=g=>{const p=String(g||'').split(/ at | vs /);return {away:(p[0]||'').trim(),home:(p[1]||'').trim()}};
const existingByKey=new Map((existing.dossiers||[]).map(d=>{const p=parseTeams(d.matchup);return [key(p.away,p.home),d]}));
const readRows=async file=>{const raw=JSON.parse(await fs.readFile('data/'+file,'utf8'));return Array.isArray(raw)?raw:(raw.records||raw.teams||[])};
const experts=(await readRows('expert-weekly.json')).filter(r=>Number(r.week)===week);
const injuries=(await readRows('injuries.json')).filter(r=>Number(r.week)===week);
const metricsDocument=JSON.parse(await fs.readFile('data/team-metrics-current.json','utf8'));
const metrics=metricsDocument.teams||[];
const joined=(rows,bg)=>rows.filter(r=>String(r.gameId||r.canonicalGameId||r.game_id||'')===String(bg.gameId));
const reusablePrior=d=>!!(d&&['COMPLETE','COMPLETE-SOURCE-LIMITED'].includes(d.status)&&Number(d.evidenceCount||0)>=1&&d.evidenceDimensions&&typeof d.evidenceDimensions==='object'&&Array.isArray(d.mechanisms)&&d.mechanisms.length>=1);

const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
await page.goto(`${portal}?deepDiveCapture=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:120000});
await page.waitForFunction(expectedWeek=>window.CFB_RUNTIME_DATA?.status==='remote-active'&&Number(window.CFB_WEEKLY_BOARD_2026?.week)===Number(expectedWeek)&&Array.isArray(window.CFB_WEEKLY_BOARD_2026?.games),week,{timeout:60000});
await page.evaluate(expectedWeek=>{
  const s=document.getElementById('weekSel');if(!s)return;
  const target=[...s.options].find(o=>{const m=String(o.value||o.textContent||'').match(/(\d+)/);return m&&Number(m[1])===Number(expectedWeek)});
  if(target){s.value=target.value;s.dispatchEvent(new Event('change',{bubbles:true}))}
},week);
await page.waitForTimeout(1000);

const appGames=await page.evaluate(async(expectedWeek)=>{
  const all=(typeof weeks!=='undefined'&&weeks[`Week ${expectedWeek}`])?(weeks[`Week ${expectedWeek}`].games||[]):[];
  const out=[];
  for(const x of all){
    if(!x?.game) continue;
    try{ if(typeof syncGameModel==='function') syncGameModel(x); }catch{}
    const p=String(x.game).split(/ at | vs /),away=(p[0]||'').trim(),home=(p[1]||'').trim();
    let awayProfile=null,homeProfile=null,detail='';
    try{awayProfile=typeof getProfile==='function'?getProfile(away):null}catch{}
    try{homeProfile=typeof getProfile==='function'?getProfile(home):null}catch{}
    // Do not invoke renderMatch for every game here. That renderer mutates the
    // application repeatedly and can re-enter observers; the dossier builder
    // already carries interactions, profiles, model components and explicit
    // source-limit labels without using rendered prose as invented evidence.
    out.push({id:x.id,game:x.game,away,home,market:x.market||null,total:x.total??null,fair:x.fair||null,edge:x.edge||null,why:x.why||null,priority:x.priority||null,interactions:Array.isArray(x.interactions)?x.interactions:[],modelComponents:x.modelComponents||null,modelTotal:x.modelTotal??null,totalDrivers:Array.isArray(x.totalDrivers)?x.totalDrivers:[],awayProfile:awayProfile?{summary:awayProfile.summary||null,public:awayProfile.public||null}:null,homeProfile:homeProfile?{summary:homeProfile.summary||null,public:homeProfile.public||null}:null,detail});
  }
  return JSON.parse(JSON.stringify(out));
},week);
await browser.close();
if(!appGames.length)throw new Error(`No rendered portal games found for selected Week ${week}; refusing to publish empty Deep Dive enrichment.`);
const appByKey=new Map(appGames.map(x=>[key(x.away,x.home),x]));

function evidenceFor(bg,ag){
  const ints=Array.isArray(ag?.interactions)?ag.interactions:[];
  const pass=ints.filter(z=>/QB\/WR|DB|pass/i.test(Array.isArray(z)?z[0]:''));
  const trench=ints.filter(z=>/OL\/RB|DL\/LB|OL|DL/i.test(Array.isArray(z)?z[0]:''));
  const profileText=[ag?.awayProfile?.summary,ag?.awayProfile?.public,ag?.homeProfile?.summary,ag?.homeProfile?.public].filter(Boolean).join(' ');
  const detail=String(ag?.detail||'');
  const availabilityHit=/injur|questionable|doubtful|\bout\b|suspend|availability|depth chart/i.test(detail);
  const expertHit=/Solid Verbal|Cover 3|Josh Pate|PFF|McShay|expert|podcast/i.test(detail);
  const coachingHit=/coach|coordinator|scheme|system|tempo|identity|play[- ]?call/i.test(profileText+' '+detail);
  const modelValid=!!bg?.modelComponents?.sourceValid||Number.isFinite(bg?.modelEdgeMagnitude)||!!bg?.modelSpread;
  const marketValid=!!bg?.currentSpread||Number.isFinite(bg?.currentTotal);
  return {
    statisticalProfile:{accounted:[bg.away,bg.home].every(t=>metrics.some(m=>norm(m.team)===norm(t))),sourceUpdatedAt:metricsDocument.updatedAt,evidence:metrics.filter(m=>[norm(bg.away),norm(bg.home)].includes(norm(m.team))).map(m=>({team:m.team,offense:m.offense,defense:m.defense,context:m.context}))},
    qbPassing:{accounted:pass.length>0||profileText.length>40,evidence:pass.slice(0,2)},
    olFront:{accounted:trench.length>0,evidence:trench.slice(0,2)},
    receiversCoverage:{accounted:pass.length>0,evidence:pass.slice(0,2)},
    runFront:{accounted:trench.length>0,evidence:trench.slice(0,2)},
    availability:{accounted:joined(injuries,bg).length>0,evidence:joined(injuries,bg).length?joined(injuries,bg).map(r=>({team:r.team,player:r.player,status:r.status,checkedAt:r.checkedAt,source:r.source,sourceUrl:r.sourceUrl,note:r.note})):'No current-week availability report is attached; health is unverified.'},
    coachingScheme:{accounted:true,evidence:coachingHit?'Governed team/matchup profile contains coaching/scheme/situational context.':'No matchup-specific coaching change surfaced; baseline system/team identity remains governed context.'},
    marketMovement:{accounted:marketValid,evidence:{spread:bg?.currentSpread??null,total:bg?.currentTotal??null,moneyline:bg?.currentMoneyline??null,source:bg?.marketSource??null}},
    modelFair:{accounted:modelValid,evidence:{fair:bg?.modelSpread??ag?.fair??null,total:bg?.modelTotal??ag?.modelTotal??null,edge:bg?.modelEdgeMagnitude??null,components:bg?.modelComponents??ag?.modelComponents??null}},
    expertResidual:{accounted:joined(experts,bg).length>0,evidence:joined(experts,bg).length?joined(experts,bg).map(r=>({sourceFamily:r.sourceFamily||r.source,analyst:r.analyst,direction:r.direction,summary:r.sourceAnalysis||r.summary,sourceUrl:r.sourceUrl,sourceDate:r.sourceDate})):'No attributable current-week expert record; coverage remains source-limited.'},
    invalidators:{accounted:true,evidence:['Material QB/OL/secondary availability change','Market move through a key price/number without supporting football evidence','Observed matchup behavior contradicts the leading unit-interaction mechanism']}
  };
}

const dossiers=(board.games||[]).map(bg=>{
  const ag=appByKey.get(key(bg.away,bg.home));
  const prior=existingByKey.get(key(bg.away,bg.home));
  if(Date.parse(bg.dateTime||'')<=Date.now()&&reusablePrior(prior)){
    return {...prior,canonicalGameId:bg.gameId,currentBoard:{spread:bg.currentSpread??null,total:bg.currentTotal??null,moneyline:bg.currentMoneyline??null,modelSpread:bg.modelSpread??null,modelTotal:bg.modelTotal??null,modelEdgeMagnitude:bg.modelEdgeMagnitude??null},refreshedAt:new Date().toISOString()};
  }
  const ev=evidenceFor(bg,ag), accounted=Object.values(ev).filter(x=>x?.accounted).length;
  const mechanisms=[];
  for(const z of (ag?.interactions||[]).slice(0,4)) mechanisms.push(`${z[0]} — ${z[1]}`);
  if(ag?.why) mechanisms.push(String(ag.why));
  for(const d of (ag?.totalDrivers||[]).slice(0,2)) mechanisms.push(`Total driver: ${d}`);
  if(!mechanisms.length&&bg.modelSpread) mechanisms.push(`Governed model ${bg.modelSpread} versus market ${bg.currentSpread||'unavailable'}; matchup-specific unit evidence is source-limited.`);
  if(!mechanisms.length) mechanisms.push(`Canonical market/model dossier reviewed; no sufficiently specific rendered unit-interaction mechanism was available at capture time.`);
  const full=accounted>=9&&mechanisms.length>=2&&!!ag&&ev.availability.accounted&&ev.expertResidual.accounted&&joined(experts,bg).some(r=>/written betting analysis|transcript-reviewed/i.test(r.type||''));
  return {canonicalGameId:bg.gameId,legacyGameId:null,matchup:`${bg.away} at ${bg.home}`,status:full?'COMPLETE':'COMPLETE-SOURCE-LIMITED',informationQuality:full?'standard':'source-limited',priority:bg.priority||ag?.priority||'low',market:{spread:bg.currentSpread??null,total:bg.currentTotal??null,moneyline:bg.currentMoneyline??null,source:bg.marketSource??null,asOf:board.updatedAt||null},model:{spread:bg.modelSpread??ag?.fair??null,total:bg.modelTotal??ag?.modelTotal??null,edgeMagnitude:bg.modelEdgeMagnitude??null,independentFootballFair:bg.independentFootballFair??null,independentFootballSide:bg.independentFootballSide??null,independentFootballEdge:bg.independentFootballEdge??null},mechanisms:mechanisms.slice(0,7),evidenceDimensions:ev,expertResidual:ev.expertResidual.evidence,invalidators:ev.invalidators.evidence,execution:'No official wager solely from dossier completion. Apply Bet Activation Gate v1.1 with current executable book/line/juice and preserve expert evidence as qualitative residual.',evidenceCount:accounted,sourceLimitedReason:full?null:(!ag?'No matching rendered portal matchup object; dossier is limited to canonical market/model runtime.':'One or more matchup dimensions, including current-week expert/availability evidence, lack governed source depth; missing reports do not imply healthy rosters.'),capturedAt:new Date().toISOString()};
});

const complete=dossiers.filter(d=>d.status==='COMPLETE').length;
const limited=dossiers.filter(d=>d.status==='COMPLETE-SOURCE-LIMITED').length;
if(dossiers.length!==expected) throw new Error(`Dossier coverage mismatch ${dossiers.length}/${expected}`);
const deepOut={season:2026,week,updatedAt:new Date().toISOString(),definition:'Evidence-backed matchup dossiers generated from live governed portal/unit engine plus canonical market/model runtime. COMPLETE-SOURCE-LIMITED is a completed research pass with explicit missing-source dimensions, not a fabricated full-evidence grade.',expectedCount:expected,completedResearchCount:dossiers.length,fullEvidenceCount:complete,sourceLimitedCount:limited,dossiers};
await fs.writeFile(dossierPath,JSON.stringify(deepOut,null,2)+'\n');
const dByKey=new Map(dossiers.map(d=>{const p=parseTeams(d.matchup);return [key(p.away,p.home),d]}));
for(const g of board.games||[]){const d=dByKey.get(key(g.away,g.home));if(!d)continue;g.deepDiveStatus=d.status;g.deepDiveEvidenceCount=d.evidenceCount;g.stage=d.status==='COMPLETE'?'deep-dive-complete':'deep-dive-complete-source-limited';g.thresholdStatus=`${d.status.replaceAll('-',' ')} · ${g.currentSpread||g.currentTotal?'MARKET AVAILABLE':'MARKET LIMITED'}`;g.action=g.finalExecutableEdge?'EXECUTION REVIEW':'PASS/WATCH pending Bet Activation Gate';}
board.scheduleCoverage={...(board.scheduleCoverage||{}),deepDiveCompleteCount:dossiers.length,deepDiveFullEvidenceCount:complete,deepDiveSourceLimitedCount:limited,note:`Canonical Week ${week}: schedule=${expected}/${expected}; completed research=${dossiers.length}/${expected}; full-evidence=${complete}; source-limited=${limited}.`};
board.runtimePersistence={...(board.runtimePersistence||{}),deepDiveCompleteCount:dossiers.length,deepDiveFullEvidenceCount:complete,deepDiveSourceLimitedCount:limited,capturedAt:new Date().toISOString()};
board.updatedAt=new Date().toISOString();
await fs.writeFile(boardPath,JSON.stringify(board,null,2)+'\n');
const status={season:2026,week,status:limited?'COMPLETE_WITH_SOURCE_LIMITS':'COMPLETE',updatedAt:new Date().toISOString(),gameCount:expected,completedGameCount:dossiers.length,pendingGameCount:0,fullEvidenceCount:complete,sourceLimitedCount:limited,stage:'thursday-universal-evidence-backed-complete',coverageRule:'Every selected-week game has a structured dossier. COMPLETE-SOURCE-LIMITED means the research pass is complete but one or more dimensions are explicitly source-limited; it never masquerades as full evidence.',sourceDataFailures:dossiers.filter(d=>d.sourceLimitedReason).map(d=>({gameId:d.canonicalGameId,matchup:d.matchup,reason:d.sourceLimitedReason})),qc:{priorIssue:'Schedule/checkpoint coverage had been conflated with Deep Dive completion and stale-schema dossiers could be reused.',resolution:'All games require current-schema dossier evidence before reuse; stale records are rebuilt and evidence depth is separately graded.',severity:limited?'transparent source limits remain':'none'}};
await fs.writeFile('data/deep-dive-status.json',JSON.stringify(status,null,2)+'\n');
console.log(`Deep Dive runtime built: ${dossiers.length}/${expected}; full=${complete}; source-limited=${limited}.`);
