import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const portal=process.env.CFB_PORTAL_URL||'https://cfb-betting-intelligence.netlify.app/';
const board=JSON.parse(await fs.readFile('data/weekly-board.json','utf8'));
const longshot=JSON.parse(await fs.readFile('data/longshot-upset-lab.json','utf8'));
const underdog=JSON.parse(await fs.readFile('data/underdog-special.json','utf8'));
const week=Number(board.week),failures=[],results=[];
const longshotCount=(longshot.candidates||[]).filter(c=>Number(c.week||longshot.week)===week).length;
const underdogRows=(underdog.candidates||[]).filter(c=>Number(c.week||underdog.week)===week);
const models=[['ensemble','Ensemble'],['independent','Football Independent'],['market','Market-Calibrated']];
const viewports=[['desktop',{width:1440,height:1100}],['mobile',{width:390,height:844}]];
const browser=await chromium.launch({headless:true});

for(const [viewportName,viewport] of viewports){
  const page=await browser.newPage({viewport});
  const browserErrors=[];page.on('pageerror',e=>browserErrors.push(e.message));
  await page.goto(`${portal}?stability=${Date.now()}-${viewportName}`,{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(()=>window.CFB_RUNTIME_DATA?.status==='remote-active'&&window.CFB_MULTI_MODEL?.state?.ready===true,{timeout:60000});
  await page.waitForTimeout(1000);
  for(const [model,label] of models){
    const out=await page.evaluate(async({model,label,longshotCount,underdogCount,week})=>{
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const click=async id=>{const b=document.querySelector(`nav button[data-tab="${id}"]`);if(!b)return false;b.click();await sleep(250);return document.getElementById(id)?.classList.contains('active')===true};
      window.CFB_MULTI_MODEL.setModel(model);await sleep(500);
      const bestActive=await click('best'),states=[];
      for(let i=0;i<68;i++){const body=document.getElementById('betsRows');states.push(JSON.stringify({html:(body?.innerHTML||'').replace(/\s+/g,' ').trim(),owner:body?.dataset.modelOwner||null,selected:body?.dataset.selectedModel||null,selector:document.getElementById('modelSel')?.value||null,title:document.getElementById('betsTitle')?.textContent?.trim()||'',active:document.getElementById('best')?.classList.contains('active')||false,rowModels:[...document.querySelectorAll('#betsRows tr[data-model-candidate]')].map(x=>x.dataset.modelCandidate)}));await sleep(75)}
      const unique=[...new Set(states)],stable=JSON.parse(states.at(-1));
      const longshotActive=await click('longshots');window.CFB_MULTI_MODEL.setModel(model);await sleep(300);
      const ls={active:document.getElementById('longshots')?.classList.contains('active')||false,scope:document.getElementById('longshots')?.dataset.specialtyScope||null,cards:document.querySelectorAll('#lsCards .ls-candidate-card').length,score25:/\/\s*25/.test(document.querySelector('#lsDetail .ls-total-score')?.textContent||''),components:document.querySelectorAll('#lsDetail .ls-score-component').length,narratives:!!document.querySelector('#lsDetail .ls-upset-case')&&!!document.querySelector('#lsDetail .ls-fail-case')&&!!document.querySelector('#lsDetail .ls-watch-panel'),priceProvenance:!!document.querySelector('#lsDetail .ls-price-status')&&!!document.querySelector('#lsDetail .ls-source')};
      const underdogActive=await click('underdog');window.CFB_MULTI_MODEL.setModel(model);await sleep(300);
      const cards=[...document.querySelectorAll('#udSpecials .ud-candidate')],criteria=[...document.querySelectorAll('#udSpecials .ud-criterion')];
      const ud={active:document.getElementById('underdog')?.classList.contains('active')||false,scope:document.getElementById('underdog')?.dataset.specialtyScope||null,cards:cards.length,wrongWeek:cards.filter(x=>Number(x.dataset.week)!==week).length,criteria:criteria.length,pending:criteria.filter(x=>x.dataset.status==='PENDING').length,badStatus:criteria.filter(x=>!['PASS','FAIL','PENDING'].includes(x.dataset.status)).length,badLabels:cards.filter(card=>{const labels=[...card.querySelectorAll('.ud-criterion b')].map(x=>(x.textContent||'').toLowerCase());return !['rest / schedule','non-explosive efficiency','qb efficiency / ypa'].every(x=>labels.some(y=>y.includes(x)));}).length,missingReason:criteria.filter(x=>!(x.querySelector('.small.muted')?.textContent||'').trim()).length};
      return{model,label,bestActive,uniqueStates:unique.length,stable,longshotActive,ls,underdogActive,ud,expected:{longshotCount,underdogCount}};
    },{model,label,longshotCount,underdogCount:underdogRows.length,week});
    results.push({viewport:viewportName,...out});
    if(!out.bestActive||out.uniqueStates!==1)failures.push(`${viewportName}/${model}: Best Bets changed across 68 samples at 75ms over 5.1s`);
    if(out.stable.owner!=='selected-model'||out.stable.selected!==model||out.stable.selector!==model||!out.stable.active)failures.push(`${viewportName}/${model}: Best Bets model ownership/selection lost`);
    if(!out.stable.title.includes(out.label))failures.push(`${viewportName}/${model}: Best Bets title is not synchronized`);
    if(out.stable.rowModels.some(x=>x!==model))failures.push(`${viewportName}/${model}: legacy or wrong-model Best Bet row rendered`);
    if(!out.longshotActive||!out.ls.active||out.ls.scope!=='model-independent'||out.ls.cards!==longshotCount)failures.push(`${viewportName}/${model}: Longshot visibility/population/scope mismatch`);
    if(longshotCount&&(!out.ls.score25||out.ls.components!==9||!out.ls.narratives||!out.ls.priceProvenance))failures.push(`${viewportName}/${model}: Longshot rubric, narrative or price provenance incomplete`);
    if(!out.underdogActive||!out.ud.active||out.ud.scope!=='model-independent'||out.ud.cards!==underdogRows.length||out.ud.wrongWeek)failures.push(`${viewportName}/${model}: Underdog visibility/population/scope/week mismatch`);
    if(out.ud.criteria!==underdogRows.length*3||out.ud.badStatus||out.ud.badLabels||out.ud.missingReason)failures.push(`${viewportName}/${model}: Underdog three-criterion evidence contract incomplete`);
    if(out.ud.pending)failures.push(`${viewportName}/${model}: Underdog has ${out.ud.pending} PENDING criteria`);
  }
  failures.push(...browserErrors.map(x=>`${viewportName}: browser pageerror: ${x}`));
  await page.close();
}
await browser.close();
console.log(JSON.stringify({week,checkedAt:new Date().toISOString(),sampleIntervalMs:75,sampleDurationMs:5100,results,failures},null,2));
if(failures.length)throw new Error(`CFB MODEL/SPECIALTY STABILITY FAIL: ${failures.join(' | ')}`);
console.log('CFB MODEL/SPECIALTY STABILITY PASS — desktop/mobile, all three models, stable Best Bets ownership and complete model-independent specialty layers.');
