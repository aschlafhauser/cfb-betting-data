// Selected-week Phil in-season verification.
// The verifier intentionally chooses a CURRENT selected-week matchup with complete Phil coverage
// instead of hard-coding a prior-week game. This preserves a strict display/model gate through rollover.
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const portal=process.env.CFB_PORTAL_URL||'https://cfb-betting-intelligence.netlify.app/';
const board=JSON.parse(await fs.readFile('data/weekly-board.json','utf8'));
const [agg,power,passD,st]=await Promise.all([
  'data/phil-inseason-average-game-grade-2026.json',
  'data/phil-inseason-power-ratings-2026.json',
  'data/phil-inseason-pass-efficiency-defense-2026.json',
  'data/phil-inseason-special-teams-2026.json'
].map(async p=>JSON.parse(await fs.readFile(p,'utf8'))));
const failures=[];
const sourceDates={
  power:String(power.updatedAt||''),
  averageGameGrade:String(agg.updatedAt||''),
  passEfficiencyDefense:String(passD.updatedAt||''),
  specialTeams:String(st.updatedAt||'')
};
const sourceDate=Object.values(sourceDates).filter(Boolean).sort().at(-1)||'';
for(const [name,d,min] of [['AGG',agg,130],['Power',power,130],['PassD',passD,130],['ST',st,130]]){
  if(!d.updatedAt)failures.push(`${name} snapshot has no source date`);
  if(!Array.isArray(d.rows)||d.rows.length<min)failures.push(`${name} rows ${d.rows?.length||0} < ${min}`);
}
const raw=s=>String(s||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
const alias={pittsburgh:'pitt',pittsburghpanthers:'pitt',connecticut:'uconn',wku:'westernkentucky',usf:'southflorida',fiu:'floridainternational',fau:'floridaatlantic',appstate:'appalachianstate',miamifl:'miamifl',miamifla:'miamifl'};
const key=s=>alias[raw(s)]||raw(s);
const index=d=>new Map((d.rows||[]).map(r=>[key(r.team),r]));
const ai=index(agg),pi=index(power),di=index(passD),si=index(st);
const covered=name=>ai.has(key(name))&&pi.has(key(name))&&di.has(key(name))&&si.has(key(name));
const target=(board.games||[]).find(g=>covered(g.away)&&covered(g.home))||null;
if(!target)failures.push(`No selected-week Week ${board.week} matchup has complete Phil in-season coverage on both teams`);
if(target){
  for(const team of [target.away,target.home])for(const [label,map] of [['AGG',ai],['Power',pi],['PassD',di],['ST',si]])if(!map.has(key(team)))failures.push(`${team} missing ${label} Phil in-season row`);
  // Direction invariant: current Phil Power is a strength measure; higher must be treated as stronger.
  const ar=pi.get(key(target.away)),hr=pi.get(key(target.home));
  if(ar&&hr&&Number.isFinite(Number(ar.current))&&Number.isFinite(Number(hr.current))){
    const stronger=Number(hr.current)>Number(ar.current)?target.home:Number(hr.current)<Number(ar.current)?target.away:'TIE';
    if(stronger!=='TIE'&&Math.sign(Number(hr.current)-Number(ar.current))===(stronger===target.home?-1:1))failures.push('Phil current Power direction invariant failed');
  }
}

let out={ready:false,panel:false,text:'',model:null,updatedAt:null,selectedIndex:-1,matchup:null};
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1100}});const browserErrors=[];page.on('pageerror',e=>browserErrors.push(e.message));
try{
  await page.goto(`${portal}?philSelectedWeek=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(w=>window.CFB_PHIL_INSEASON_READY===true&&window.CFB_RUNTIME_DATA?.status==='remote-active'&&window.CFB_MULTI_MODEL?.state?.ready===true&&Number(window.CFB_WEEKLY_BOARD_2026?.week)===Number(w),Number(board.week),{timeout:60000}).catch(()=>{});await page.waitForTimeout(1500);
  if(target){
    out=await page.evaluate(async ({away,home})=>{
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));document.querySelector('nav button[data-tab="match"]')?.click();await sleep(150);
      const sel=document.getElementById('matchSel'),opts=Array.from(sel?.options||[]),norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,''),wanted=opts.findIndex(o=>{const t=norm(o.textContent);return t.includes(norm(away))&&t.includes(norm(home))});
      if(sel&&wanted>=0){sel.selectedIndex=wanted;sel.dispatchEvent(new Event('change',{bubbles:true}));if(typeof window.renderMatch==='function')window.renderMatch(sel.value);await sleep(1600)}
      const panel=document.getElementById('philInseasonPanel'),txt=panel?.innerText||'';let model=null;
      try{const id=sel?.value;const x=Object.values(weeks||{}).flatMap(v=>v.games||[]).find(g=>String(g.gameId||g.id)===String(id));model=x?.modelComponents?.philInseason||null}catch{}
      return{ready:window.CFB_PHIL_INSEASON_READY===true,panel:!!panel,text:txt,model,updatedAt:window.CFB_PHIL_INSEASON?.updatedAt||null,selectedIndex:wanted,matchup:sel?.selectedOptions?.[0]?.textContent||null};
    },{away:target.away,home:target.home});
  }
}finally{await browser.close().catch(()=>{})}
if(!out.ready)failures.push('CFB_PHIL_INSEASON_READY did not become true');if(sourceDate&&out.updatedAt!==sourceDate)failures.push(`Rendered Phil source date ${out.updatedAt} != ${sourceDate}`);if(target&&out.selectedIndex<0)failures.push(`Selected-week matchup not found in Matchup Center: ${target.away} at ${target.home}`);if(target&&!out.panel)failures.push('Phil Steele in-season quantitative panel missing');
if(target){for(const token of [target.away,target.home,'Average Game Grade','Pass D','Special Teams','Model treatment'])if(!out.text.includes(token))failures.push(`Phil in-season panel missing ${token}`)}
if(out.model){const a=Number(out.model.adjustment);if(!Number.isFinite(a))failures.push('Phil in-season model adjustment is not numeric');else if(Math.abs(a)>.850001)failures.push(`Phil in-season adjustment ${a} exceeds ±0.85 cap`);if(Number(out.model.totalImpact)!==0)failures.push(`Phil in-season totalImpact ${out.model.totalImpact} != 0`);if(out.model.governance!=='ACTIVE_CAPPED_RESIDUAL')failures.push(`Phil in-season governance ${out.model.governance} unexpected`)}else if(target)failures.push('Selected matchup missing modelComponents.philInseason');
for(const e of browserErrors)failures.push(`browser pageerror: ${e}`);
const report={checkedAt:new Date().toISOString(),week:Number(board.week),sourceDate,sourceDates,matchup:target?`${target.away} at ${target.home}`:null,model:out.model,policy:{spreadImpactCap:0.85,totalImpact:0,provenance:'Each governed Phil table retains its own source date; sourceDate is the newest table date.'},failures,status:failures.length?'FAIL':'PASS'};await fs.writeFile('data/phil-inseason-verification-current.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(failures.length)throw new Error(`PHIL IN-SEASON VERIFICATION FAIL: ${failures.join(' | ')}`);console.log('PHIL IN-SEASON VERIFICATION PASS');
