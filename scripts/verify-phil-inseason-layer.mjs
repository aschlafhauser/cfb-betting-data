import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const portal=process.env.CFB_PORTAL_URL||'https://cfb-betting-intelligence.netlify.app/';
const expectedDate='2026-09-09';
const [agg,power,passD,st]=await Promise.all([
  'data/phil-inseason-average-game-grade-2026.json',
  'data/phil-inseason-power-ratings-2026.json',
  'data/phil-inseason-pass-efficiency-defense-2026.json',
  'data/phil-inseason-special-teams-2026.json'
].map(async p=>JSON.parse(await fs.readFile(p,'utf8'))));
const failures=[];
for(const [name,d,min] of [['AGG',agg,130],['Power',power,130],['PassD',passD,130],['ST',st,130]]){
  if(d.updatedAt!==expectedDate)failures.push(`${name} snapshot date ${d.updatedAt} != ${expectedDate}`);
  if(!Array.isArray(d.rows)||d.rows.length<min)failures.push(`${name} rows ${d.rows?.length||0} < ${min}`);
}
const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const find=(d,...names)=>d.rows.find(r=>names.some(n=>norm(r.team)===norm(n)));
const pitt={agg:find(agg,'Pittsburgh','Pitt'),power:find(power,'Pittsburgh','Pitt'),passD:find(passD,'Pittsburgh','Pitt'),st:find(st,'Pittsburgh','Pitt')};
const ucf={agg:find(agg,'UCF'),power:find(power,'UCF'),passD:find(passD,'UCF'),st:find(st,'UCF')};
for(const [team,x] of Object.entries({Pittsburgh:pitt,UCF:ucf}))for(const [k,v] of Object.entries(x))if(!v)failures.push(`${team} missing ${k} Phil in-season row`);
if(pitt.agg&&Math.abs(Number(pitt.agg.agg)-130.41)>.001)failures.push(`Pittsburgh AGG ${pitt.agg.agg} != 130.41`);
if(ucf.agg&&Math.abs(Number(ucf.agg.agg)-116.71)>.001)failures.push(`UCF AGG ${ucf.agg.agg} != 116.71`);
if(pitt.power&&Number(pitt.power.current)!==130)failures.push(`Pittsburgh current Phil power ${pitt.power.current} != 130`);
if(ucf.power&&Number(ucf.power.current)!==127)failures.push(`UCF current Phil power ${ucf.power.current} != 127`);

const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100}});const browserErrors=[];page.on('pageerror',e=>browserErrors.push(e.message));
await page.goto(`${portal}?philInseason=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:120000});
await page.waitForFunction(()=>window.CFB_RUNTIME_DATA&&window.CFB_PHIL_INSEASON_READY===true,{timeout:60000}).catch(()=>{});
await page.waitForTimeout(1200);
const out=await page.evaluate(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const matchBtn=document.querySelector('nav button[data-tab="match"]');if(matchBtn)matchBtn.click();await sleep(150);
  const sel=document.getElementById('matchSel');let idx=-1;if(sel)idx=Array.from(sel.options).findIndex(o=>/UCF.*Pittsburgh|UCF.*Pitt|Pittsburgh.*UCF|Pitt.*UCF/i.test(o.textContent||''));
  if(idx>=0){sel.selectedIndex=idx;sel.dispatchEvent(new Event('change',{bubbles:true}));if(typeof window.renderMatch==='function')window.renderMatch(sel.value);await sleep(500)}
  const panel=document.getElementById('philInseasonPanel');const txt=panel?.innerText||'';
  let model=null;try{const id=sel?.value;const x=Object.values(weeks||{}).flatMap(v=>v.games||[]).find(g=>g.id===id);model=x?.modelComponents?.philInseason||null}catch{}
  return {ready:window.CFB_PHIL_INSEASON_READY===true,selectedIndex:idx,panel:!!panel,text:txt,model,updatedAt:window.CFB_PHIL_INSEASON?.updatedAt||null};
});
await browser.close();
if(!out.ready)failures.push('CFB_PHIL_INSEASON_READY did not become true');
if(out.updatedAt!==expectedDate)failures.push(`Rendered Phil in-season date ${out.updatedAt} != ${expectedDate}`);
if(out.selectedIndex<0)failures.push('UCF-Pittsburgh matchup not found in Matchup Center');
if(!out.panel)failures.push('Phil Steele in-season quantitative panel missing');
for(const token of ['Pittsburgh','UCF','Average Game Grade','Pass D','Special Teams','Model treatment'])if(!out.text.includes(token))failures.push(`Phil in-season panel missing ${token}`);
if(out.model){
  const a=Number(out.model.adjustment);if(!Number.isFinite(a))failures.push('Phil in-season model adjustment is not numeric');else if(Math.abs(a)>.850001)failures.push(`Phil in-season adjustment ${a} exceeds ±0.85 cap`);
  if(Number(out.model.totalImpact)!==0)failures.push(`Phil in-season totalImpact ${out.model.totalImpact} != 0`);
  if(out.model.governance!=='ACTIVE_CAPPED_RESIDUAL')failures.push(`Phil in-season governance ${out.model.governance} unexpected`);
}else failures.push('Selected matchup missing modelComponents.philInseason');
for(const e of browserErrors)failures.push(`browser pageerror: ${e}`);
const report={checkedAt:new Date().toISOString(),sourceDate:expectedDate,matchup:'UCF at Pittsburgh',model:out.model,failures,status:failures.length?'FAIL':'PASS'};
await fs.writeFile('data/phil-inseason-verification-current.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));if(failures.length)throw new Error(`PHIL IN-SEASON VERIFICATION FAIL: ${failures.join(' | ')}`);console.log('PHIL IN-SEASON VERIFICATION PASS');
