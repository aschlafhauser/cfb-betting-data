import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const portal=process.env.CFB_PORTAL_URL||'https://cfb-betting-intelligence.netlify.app/';
const fpi=JSON.parse(await fs.readFile('data/espn-fpi-current.json','utf8'));
const failures=[];
if(!Array.isArray(fpi.teams)||fpi.teams.length<100)failures.push(`FPI coverage ${fpi.teams?.length||0} < 100`);
if((fpi.teams||[]).filter(x=>Number.isFinite(Number(x.fpi))).length<100)failures.push('FPI numeric coverage < 100 teams');

const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(`${portal}?multiModel=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:120000});
await page.waitForFunction(()=>window.CFB_MULTI_MODEL?.state?.ready===true,{timeout:60000});await page.waitForTimeout(1200);
let out;
try {
  out=await Promise.race([page.evaluate(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const sel=document.getElementById('modelSel');const options=Array.from(sel?.options||[]).map(o=>o.value);
  const games=typeof weeks!=='undefined'?(weeks[currentWeek]?.games||[]):[];
  const x=games.find(g=>{const m=String(g.market||'').match(/-?\d+(?:\.\d+)?/);return m&&Math.abs(Number(m[0]))<=10})||games[0];
  let independence=null;
  if(x){
    const before=window.CFB_MULTI_MODEL.calculate(x,'independent');
    const p=String(x.game||'').split(/ at | vs /),away=p[0]?.trim(),home=p[1]?.trim();
    const rt=(window.CFB_WEEKLY_BOARD_2026?.games||[]).find(g=>String(g.away)===away&&String(g.home)===home);
    if(rt){const old=rt.currentSpread;rt.currentSpread=home+' -41.5';const after=window.CFB_MULTI_MODEL.calculate(x,'independent');rt.currentSpread=old;independence={before:before?.homeMargin,after:after?.homeMargin}}
  }
  if(sel){sel.value='independent';sel.dispatchEvent(new Event('change',{bubbles:true}));for(let i=0;i<20&&window.CFB_MULTI_MODEL?.state?.selected!=='independent';i++)await sleep(100);await sleep(300)}
  const independentTitle=document.getElementById('betsTitle')?.innerText||'';
  const boardSelected=document.querySelector('#scheduleRows tr')?.dataset?.selectedModel||null;
  const bestRows=document.querySelectorAll('#betsRows tr[data-model-candidate="independent"]').length;
  const matchBtn=document.querySelector('nav button[data-tab="match"]');matchBtn?.click();await sleep(120);const ms=document.getElementById('matchSel');const realOption=Array.from(ms?.options||[]).find(o=>String(o.value||'').trim()&&o.value===x?.id)||Array.from(ms?.options||[]).find(o=>String(o.value||'').trim());if(ms&&realOption){ms.value=realOption.value;ms.dispatchEvent(new Event('change',{bubbles:true}));if(typeof window.renderMatch==='function')window.renderMatch(ms.value);await sleep(900)}
  const panel=document.getElementById('multiModelMatchupPanel'),visible=document.querySelector('#matchupCenterV2 .mc2-models');const text=`${visible?.textContent||''} ${panel?.textContent||''}`;
  return{options,independence,selectedState:window.CFB_MULTI_MODEL?.state?.selected||null,independentTitle,boardSelected,bestRows,matchupValue:ms?.value||null,panel:!!visible,sourcePanel:!!panel,text,fpiUpdatedAt:window.CFB_MULTI_MODEL?.state?.fpi?.updatedAt||null};
  }),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Multi-model browser evaluation exceeded 45 seconds')),45000))]);
} catch (error) {
  failures.push(`browser verification timeout/error: ${error.message}`);
  out={options:[],independence:null,independentTitle:'',boardSelected:null,bestRows:0,panel:false,sourcePanel:false,text:'',fpiUpdatedAt:null};
} finally {
  await browser.close().catch(()=>{});
}
for(const m of ['ensemble','independent','market'])if(!out.options.includes(m))failures.push(`model selector missing ${m}`);
if(!out.independence||!Number.isFinite(out.independence.before)||Math.abs(out.independence.before-out.independence.after)>.000001)failures.push(`Football Independent fair changed when market was mutated: ${JSON.stringify(out.independence)}`);
if(!/Football Independent/.test(out.independentTitle))failures.push('Best Bets did not switch to Football Independent');
if(out.boardSelected!=='independent')failures.push(`Weekly Board selected model=${out.boardSelected}`);
if(!out.panel)failures.push('Matchup Center multi-model panel missing');
for(const t of ['Football Independent','Market-Calibrated','Ensemble','ESPN FPI','higher is better'])if(!out.text.includes(t))failures.push(`Matchup panel missing ${t}`);
for(const e of errors)failures.push(`pageerror: ${e}`);
const report={checkedAt:new Date().toISOString(),fpiUpdatedAt:out.fpiUpdatedAt,selector:out.options,selectedState:out.selectedState,matchupValue:out.matchupValue,sourcePanel:out.sourcePanel??false,independence:out.independence,bestRows:out.bestRows,status:failures.length?'FAIL':'PASS',failures};await fs.writeFile('data/multi-model-verification-current.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(failures.length)throw new Error(`MULTI MODEL VERIFICATION FAIL: ${failures.join(' | ')}`);console.log('CFB MULTI MODEL VERIFICATION PASS');

// These are blocking production gates, not informational checks. Run them immediately after
// the model-selection/independence test so refresh-weekly-manifest.mjs can consume fresh PASS artifacts.
await import('./verify-statistical-display.mjs');
await import('./verify-market-derived-integrity.mjs');
