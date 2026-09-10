import fs from 'node:fs/promises';
import { chromium } from 'playwright';
const board=JSON.parse(await fs.readFile('data/weekly-board.json','utf8'));
const week=Number(board.week), now=new Date().toISOString();
const norm=s=>String(s||'').toLowerCase().replace(/\([^)]*\)/g,'').replace(/[^a-z0-9]/g,'');
const alias=s=>norm(s).replace(/state/g,'st').replace(/western/g,'w').replace(/eastern/g,'e').replace(/southern/g,'s').replace(/northern/g,'n').replace(/floridaatlantic/g,'fau').replace(/texasam/g,'tam');
const longshots=[];
for(const g of board.games||[]){const m=String(g.currentSpread||'').match(/^(.+?)\s+(-?\d+(?:\.\d+)?)/);if(!m)continue;const fav=m[1].trim(),line=Math.abs(+m[2]);if(line<9.5)continue;const dog=alias(fav)===alias(g.away)?g.home:g.away;longshots.push({game:g,team:dog});}
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1600}});
const urls=[
 `https://www.cbssports.com/college-football/odds/top25/2026/regular/week-${week}/`,
 `https://www.cbssports.com/college-football/odds/ACC/2026/regular/week-${week}/`,
 `https://www.cbssports.com/college-football/odds/BIG10/2026/regular/week-${week}/`,
 `https://www.cbssports.com/college-football/odds/BIG12/2026/regular/week-${week}/`,
 `https://www.cbssports.com/college-football/odds/SEC/2026/regular/week-${week}/`,
 `https://www.cbssports.com/college-football/odds/USA/2026/regular/week-${week}/`,
 `https://www.cbssports.com/college-football/odds/AAC/2026/regular/week-${week}/`,
 `https://www.cbssports.com/college-football/odds/MAC/2026/regular/week-${week}/`,
 `https://www.cbssports.com/college-football/odds/MWC/2026/regular/week-${week}/`,
 `https://www.cbssports.com/college-football/odds/SUNBELT/2026/regular/week-${week}/`,
 `https://www.cbssports.com/college-football/odds/IND/2026/regular/week-${week}/`,
 `https://www.cbssports.com/college-football/odds/SWAC/2026/regular/week-${week}/`,
 `https://www.cbssports.com/college-football/odds/MEAC/2026/regular/week-${week}/`,
 `https://www.cbssports.com/college-football/odds/MVC/2026/regular/week-${week}/`
];
const rows=[];
for(const url of urls){try{await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});await page.waitForTimeout(700);const got=await page.evaluate(()=>Array.from(document.querySelectorAll('tr')).map(tr=>Array.from(tr.querySelectorAll('th,td')).map(x=>(x.innerText||'').trim()).filter(Boolean)).filter(r=>r.length));for(const r of got)rows.push({url,cells:r})}catch(e){console.warn('CBS page failed',url,e.message)}}
await browser.close();
function teamMatch(cell,team){const a=alias(cell),b=alias(team);if(!a||!b)return false;return a.includes(b)||b.includes(a)||a.endsWith(b.slice(-Math.min(8,b.length)))||b.endsWith(a.slice(-Math.min(8,a.length)))}
function mlFromCells(cells){for(const c of cells){const t=String(c).replace(/,/g,'');const m=t.match(/(^|\s)([+]\d{3,6})(\s|$)/);if(m)return m[2]}return null}
const found=[];
for(const {game,team} of longshots){let hit=null;for(const r of rows){const joined=r.cells.join(' ');if(!r.cells.some(c=>teamMatch(c,team)))continue;const ml=mlFromCells(r.cells);if(ml){hit={canonicalGameId:game.gameId,team,opponent:team===game.away?game.home:game.away,moneyline:ml,source:'CBS Sports Week '+week+' odds',sourceUrl:r.url,observedAt:now,freshness:'CURRENT-OBSERVED'};break}}
 if(hit)found.push(hit);
}
// Preserve existing directly observed non-CBS prices only when today's automated sweep did not replace them.
let prior={prices:[]};try{prior=JSON.parse(await fs.readFile(`data/free-moneylines-2026-w${week}.json`,'utf8'))}catch{}
const byId=new Map(found.map(x=>[String(x.canonicalGameId),x]));
for(const p of prior.prices||[]){if(!byId.has(String(p.canonicalGameId))&&String(p.freshness||'').includes('CURRENT'))byId.set(String(p.canonicalGameId),p)}
const prices=[...byId.values()].sort((a,b)=>String(a.canonicalGameId).localeCompare(String(b.canonicalGameId)));
const out={version:'FREE-ML-v3-auto',season:2026,week,updatedAt:now,status:'CURRENT-FREE-SOURCE-SWEEP',policy:'ESPN remains canonical identity/schedule source. CBS Sports is automatically swept for current moneylines; previously governed directly observed secondary-source prices may be retained when CBS has no quote. All free-source prices are research/screen prices and require execution re-verification.',sources:[{name:'CBS Sports',role:'automated primary free moneyline enrichment'},{name:'Sportsbook Review',role:'retained governed secondary cross-check where directly observed'}],coverage:{longshotCandidates:longshots.length,pricesFound:prices.length,stillPending:Math.max(0,longshots.length-prices.length)},prices};
await fs.writeFile(`data/free-moneylines-2026-w${week}.json`,JSON.stringify(out,null,2)+'\n');
console.log(`Free ML refresh: longshots=${longshots.length}, found=${prices.length}, pending=${out.coverage.stillPending}`);
