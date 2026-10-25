// Persist governed selected-week multi-model outputs into the public CFB runtime.
// Runtime-created weeks initialize auditable Market-Calibrated anchors from the first selected-week quote.
// Browser DOM completeness is certified later by dedicated live-portal QA; this capture
// must not block stats/FPI/research refresh merely because a renderer is temporarily stale.
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const portal=process.env.CFB_PORTAL_URL||'https://cfb-betting-intelligence.netlify.app/';
const boardPath='data/weekly-board.json';
const board=JSON.parse(await fs.readFile(boardPath,'utf8'));
const week=Number(board.week),expected=Number(board.scheduleCoverage?.slateCount||board.games?.length||0);
if(!Number.isFinite(week)||!Number.isFinite(expected)||expected<=0)throw new Error('Invalid selected-week CFB board metadata');

const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100}});
const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
if(process.env.CFB_CAPTURE_APP_DIR){await page.route('https://capture.test/**',async route=>{const u=new URL(route.request().url()),name=u.pathname==='/'?'/index.html':u.pathname;try{const body=await fs.readFile(process.env.CFB_CAPTURE_APP_DIR+name);const contentType=name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':'text/html';return route.fulfill({status:200,contentType,body})}catch{return route.fulfill({status:404,body:''})}})}
await page.route('**/weekly-board.json*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(board)}));
if(process.env.CFB_CAPTURE_INPUTS_DIR){await page.route('**/cfb-betting-data/main/data/*',async route=>{const name=new URL(route.request().url()).pathname.split('/').at(-1);if(name==='weekly-board.json')return route.fallback();try{const body=await fs.readFile(`${process.env.CFB_CAPTURE_INPUTS_DIR}/${name}`,'utf8');return route.fulfill({status:200,contentType:'application/json',body})}catch{return route.continue()}})}
let stage='navigation';const mark=s=>{stage=s;console.log(`Governed portal capture stage: ${s}`)};
async function run(){
  mark('navigation');await page.goto(`${portal}?capture=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:120000});
  mark('runtime-board-ready');await page.waitForFunction(n=>Array.isArray(window.CFB_WEEKLY_BOARD_2026?.games)&&window.CFB_WEEKLY_BOARD_2026.games.length===n,expected,{timeout:60000});
  mark('multi-model-ready');await page.waitForFunction(()=>window.CFB_MULTI_MODEL?.state?.ready===true&&window.CFB_MULTI_MODEL?.version==='1.2-input-integrity'&&typeof window.CFB_MULTI_MODEL?.calculate==='function',null,{timeout:60000});
  mark('all-model-inputs-ready');await page.waitForFunction(()=>window.CFB_PHIL_INSEASON?.ready===true&&window.CFB_RUNTIME_DATA?.status==='remote-active'&&window.CFB_MULTI_MODEL?.state?.fpi&&window.CFB_MULTI_MODEL?.state?.metrics,null,{timeout:60000});
  mark('model-promotion');
  const out=await page.evaluate(()=>{
    const rt=window.CFB_WEEKLY_BOARD_2026,api=window.CFB_MULTI_MODEL;if(!rt||!api)throw new Error('Selected-week runtime or CFB_MULTI_MODEL unavailable');
    const L=`Week ${Number(rt.week)}`;const legacy=(typeof weeks!=='undefined'&&Array.isArray(weeks?.[L]?.games))?weeks[L].games:[];
    const norm=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]/g,'');const pair=(a,h)=>`${norm(a)}__${norm(h)}`;
    const byId=new Map(legacy.map(x=>[String(x.gameId||x.id||''),x]));const byPair=new Map(legacy.map(x=>{const p=String(x.game||'').split(/ at | vs /);return[pair((p[0]||'').trim(),(p[1]||'').trim()),x]}));
    let marketCount=0,independentCount=0,ensembleCount=0,rejected=0;
    for(const g of rt.games||[]){
      const kickoff=Date.parse(g.dateTime||'');
      if(Number.isFinite(kickoff)&&kickoff<=Date.now()){if(g.multiModel?.market)marketCount++;if(g.multiModel?.independent)independentCount++;if(g.multiModel?.ensemble)ensembleCount++;continue}
      const x=byId.get(String(g.gameId||''))||byPair.get(pair(g.away,g.home));if(!x){rejected++;continue}
      const market=api.calculate(x,'market'),independent=api.calculate(x,'independent'),ensemble=api.calculate(x,'ensemble');if(market)marketCount++;if(independent)independentCount++;if(ensemble)ensembleCount++;
      const namedAnchor=window.CFB_GOVERNED_MARKET_MODEL?.anchorFromRuntime?.(g);if(namedAnchor)g.marketModelAnchor=namedAnchor;
      const selected=ensemble||independent||market;if(selected){g.modelSpread=selected.fair||null;g.modelHomeMargin=selected.homeMargin!==null&&Number.isFinite(Number(selected.homeMargin))?Number(selected.homeMargin):null;g.modelEdgeMagnitude=selected.edge!==null&&Number.isFinite(Number(selected.edge))?Number(selected.edge):null;g.spreadLean=selected.side||null;g.confidence=selected.confidence||g.confidence;g.selectedModel=ensemble?'ensemble':independent?'independent':'market'}
      if(independent){g.independentFootballFair=independent.fair||null;g.independentFootballHomeMargin=independent.homeMargin!==null&&Number.isFinite(Number(independent.homeMargin))?Number(independent.homeMargin):null;g.independentFootballEdge=independent.edge!==null&&Number.isFinite(Number(independent.edge))?Number(independent.edge):null;g.independentFootballSide=independent.side||null;g.independentFootballConfidence=independent.confidence||null}
      if(!selected){g.modelSpread=null;g.modelHomeMargin=null;g.modelEdgeMagnitude=null;g.spreadLean=null;g.confidence='coverage-limited';g.independentFootballFair=null;g.independentFootballHomeMargin=null;g.independentFootballEdge=null;g.independentFootballSide=null;g.independentFootballConfidence=null}
      const dates={fpi:api.state.fpi?.updatedAt??null,phil:api.state.phil?.updatedAt??null,metrics:api.state.metrics?.updatedAt??null,live:api.state.live?.updatedAt??null};
      const candidate=window.CFB_GOVERNED_MARKET_MODEL?.calculate?.({...x,market:g.currentSpread??'—'},{anchor:'market-shadow'});
      g.shadowModels=null;
      if(candidate&&independent&&api.comparisonCoverage?.({away:g.away,home:g.home})===true){
        const margin=candidate.homeMargin,mkt=candidate.components.base,ind=independent.homeMargin;
        const agree=(margin-mkt)*(ind-mkt)>0&&Math.abs(margin-mkt)>=.5&&Math.abs(ind-mkt)>=.5,wi=agree?.60:.55;
        g.shadowModels={version:'market-anchor-candidate-v1',researchOnly:true,promoted:false,inputDates:dates,computedAt:new Date().toISOString(),marketAnchorCandidate:{homeMargin:margin},ensembleAnchorCandidate:{homeMargin:wi*ind+(1-wi)*margin}};
      }
      g.modelComputation={version:api.version,computedAt:new Date().toISOString(),inputDates:dates,marketAnchorSource:market?.components?.anchorSource??null,comparableCoverage:api.comparisonCoverage?.({away:g.away,home:g.home})??null};
      g.marketCalibratedFair=market?.fair??null;g.marketCalibratedHomeMargin=market?.homeMargin??null;
      g.multiModel={market:market?{fair:market.fair,homeMargin:market.homeMargin,edge:market.edge,side:market.side,confidence:market.confidence,modelVersion:api.version,components:{base:market.components?.base,power:market.components?.power,units:market.components?.units,anchorSource:market.components?.anchorSource,philInseason:market.components?.philInseason?Object.fromEntries(['adjustment','powerMargin','powerAdj','profileAdj','matchupAdj','cap','sourceDate'].map(k=>[k,market.components.philInseason[k]])):null}}:null,independent:independent?{fair:independent.fair,homeMargin:independent.homeMargin,edge:independent.edge,side:independent.side,confidence:independent.confidence,modelVersion:api.version,components:{sources:independent.components?.sources??null,opponentAdjustedLive:independent.components?.opponentAdjustedLive??null}}:null,ensemble:ensemble?{fair:ensemble.fair,homeMargin:ensemble.homeMargin,edge:ensemble.edge,side:ensemble.side,confidence:ensemble.confidence,modelVersion:api.version,components:ensemble.components,tags:ensemble.tags||[],decisionScore:ensemble.decisionScore}:null};
    }
    try{window.CFB_CANONICAL_SELECTED_WEEK_RENDER?.()}catch{}try{window.CFB_MULTI_MODEL?.refresh?.()}catch{}
    return{board:JSON.parse(JSON.stringify(rt)),promotion:{marketCount,independentCount,ensembleCount,rejected},renderedRows:document.querySelectorAll('#scheduleRows tr').length,selectedWeek:window.currentWeek||null};
  });
  await page.waitForTimeout(750);out.renderedRows=await page.locator('#scheduleRows tr').count();return out;
}
let result,timer;try{result=await Promise.race([run(),new Promise((_,rej)=>{timer=setTimeout(()=>rej(new Error(`Governed portal capture exceeded 150 seconds during ${stage}`)),150000)})])}finally{clearTimeout(timer);await browser.close().catch(()=>{})}
const totalModelCount=result.promotion.marketCount+result.promotion.independentCount+result.promotion.ensembleCount;if(totalModelCount===0)throw new Error(`No governed model outputs captured; rejected=${result.promotion.rejected}`);
if(result.renderedRows!==expected)console.warn(`DOM row count ${result.renderedRows}/${expected}; data capture continues and dedicated browser QA remains blocking.`);
if(pageErrors.length)console.warn(`Browser pageerrors observed during non-certifying capture: ${pageErrors.join(' | ')}`);
const oldById=new Map((board.games||[]).map(g=>[String(g.gameId),g]));const games=(result.board.games||[]).map(g=>({...oldById.get(String(g.gameId)),...g}));
const deepDiveCompleteCount=games.filter(g=>g.deepDiveStatus==='COMPLETE'&&Number(g.deepDiveEvidenceCount)>0).length;
const next={...board,...result.board,week,games,updatedAt:new Date().toISOString(),scheduleCoverage:{...(board.scheduleCoverage||{}),...(result.board.scheduleCoverage||{}),slateCount:expected,renderedSlateCount:result.renderedRows,deepDiveCompleteCount,note:`Selected-week model capture complete. DOM rendering is independently certified later; Deep Dive complete=${deepDiveCompleteCount}/${expected}.`},runtimePersistence:{status:'ACTIVE',source:portal,capturedAt:new Date().toISOString(),selectedWeek:result.selectedWeek,modelPromotion:result.promotion,renderedRowCount:result.renderedRows}};
await fs.writeFile(boardPath,JSON.stringify(next,null,2)+'\n');
console.log(`Persisted CFB Week ${week}: ${games.length} games; model captures market=${result.promotion.marketCount}, independent=${result.promotion.independentCount}, ensemble=${result.promotion.ensembleCount}; renderedRows=${result.renderedRows}/${expected}.`);
