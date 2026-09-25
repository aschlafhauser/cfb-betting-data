import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const portal=process.env.CFB_PORTAL_URL||'https://cfb-betting-intelligence.netlify.app/';
const board=JSON.parse(await fs.readFile('data/weekly-board.json','utf8'));
const metrics=JSON.parse(await fs.readFile('data/team-metrics-current.json','utf8'));
const fpi=JSON.parse(await fs.readFile('data/espn-fpi-current.json','utf8'));
const season=Number(board.season||2026),week=Number(board.week);
const norm=v=>String(v||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
const expectedTeams=new Set((board.games||[]).flatMap(g=>[g.away,g.home]).filter(Boolean)).size;
const fpiTeams=new Set((fpi.teams||[]).filter(x=>Number.isFinite(Number(x.fpi))).map(x=>norm(x.team)));
const allSample=(board.games||[]).slice(0,12).map(g=>({id:g.gameId,away:g.away,home:g.home}));
const fpiSample=(board.games||[]).filter(g=>fpiTeams.has(norm(g.away))&&fpiTeams.has(norm(g.home))).slice(0,12).map(g=>({id:g.gameId,away:g.away,home:g.home}));
const failures=[];

if(Number(metrics.week)!==week)failures.push(`team metrics week ${metrics.week} != ${week}`);
if((metrics.coverage?.resolvedTeams||0)!==expectedTeams)failures.push(`team metrics coverage ${metrics.coverage?.resolvedTeams||0}/${expectedTeams}`);
if((metrics.coverage?.unresolvedTeams||[]).length)failures.push(`unresolved stat teams: ${metrics.coverage.unresolvedTeams.join(', ')}`);
if(fpiTeams.size<100)failures.push('ESPN FPI numeric coverage < 100 teams');
const updated=Date.parse(metrics.updatedAt||''),fpiUpdated=Date.parse(fpi.updatedAt||'');
if(!Number.isFinite(updated)||Date.now()-updated>6*3600000)failures.push('team metrics artifact stale >6h');
if(!Number.isFinite(fpiUpdated)||Date.now()-fpiUpdated>6*3600000)failures.push('ESPN FPI artifact stale >6h');

const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(`${portal}?statIntegrity=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:120000});
await page.waitForFunction(()=>window.CFB_RUNTIME_DATA?.status==='remote-active'&&window.CFB_MULTI_MODEL?.state?.ready===true,{timeout:60000});
await page.waitForTimeout(2000);
const live=await page.evaluate(async({allSample,fpiSample})=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  document.querySelector('nav button[data-tab="match"]')?.click();await sleep(100);
  const sel=document.getElementById('matchSel');
  const choose=g=>{
    const opts=[...(sel?.options||[])];
    const byId=opts.findIndex(o=>String(o.value)===String(g.id));
    if(byId>=0)return byId;
    return opts.findIndex(o=>{const t=(o.textContent||'').toLowerCase();return t.includes(String(g.away).toLowerCase())&&t.includes(String(g.home).toLowerCase())});
  };
  const render=async g=>{const i=choose(g);if(i<0)return false;sel.selectedIndex=i;sel.dispatchEvent(new Event('change',{bubbles:true}));if(typeof window.renderMatch==='function')window.renderMatch(sel.value);await sleep(650);return true};
  let checked=0,statsWithValues=0,fpiChecked=0,fpiPanels=0;
  for(const g of allSample){if(!await render(g))continue;const p=document.getElementById('cfbMatchupStatsPanel');if(p){checked++;const t=p.innerText||'';if(/Yds\/play|Success|Explosive|PPG|YPG/i.test(t)&&/\d/.test(t))statsWithValues++;}}
  for(const g of fpiSample){if(!await render(g))continue;fpiChecked++;const m=document.getElementById('cfbMatchupStatsPanel');if(m&&/ESPN FPI/.test(m.innerText||'')&&/FPI\s+-?\d/i.test(m.innerText||''))fpiPanels++;}
  return{options:sel?.options?.length||0,checked,statsWithValues,fpiChecked,fpiPanels};
},{allSample,fpiSample});
await browser.close();

if(live.options!==Number(board.scheduleCoverage?.slateCount||board.games?.length))failures.push(`matchup selector ${live.options} != expected slate`);
if(live.checked<Math.min(10,allSample.length))failures.push(`statistical panel rendered only ${live.checked} sampled matchups`);
if(live.statsWithValues<Math.min(8,live.checked))failures.push(`too few sampled matchup panels expose numeric stats: ${live.statsWithValues}/${live.checked}`);
if(live.fpiChecked<Math.min(8,fpiSample.length))failures.push(`too few FPI-eligible matchups were selectable: ${live.fpiChecked}/${fpiSample.length}`);
if(live.fpiPanels<Math.min(8,live.fpiChecked))failures.push(`too few FPI-eligible matchup panels expose ESPN FPI context: ${live.fpiPanels}/${live.fpiChecked}`);
for(const e of errors)failures.push(`browser pageerror: ${e}`);
const report={season,week,verifiedAt:new Date().toISOString(),status:failures.length?'FAIL':'PASS',detail:`Team/stat coverage ${metrics.coverage?.resolvedTeams||0}/${expectedTeams}; ESPN FPI ${fpiTeams.size} numeric teams; sampled rendered statistical panels ${live.statsWithValues}/${live.checked}; FPI-eligible panels ${live.fpiPanels}/${live.fpiChecked}.`,coverage:{expectedTeams,resolvedTeams:metrics.coverage?.resolvedTeams||0,fpiNumeric:fpiTeams.size,...live},failures};
await fs.writeFile(`data/statistical-display-integrity-${season}-w${week}.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(failures.length)throw new Error(`STATISTICAL DISPLAY INTEGRITY FAIL: ${failures.join(' | ')}`);
console.log('CFB STATISTICAL DISPLAY INTEGRITY PASS');
