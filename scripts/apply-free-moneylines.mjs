import fs from 'node:fs/promises';
const board=JSON.parse(await fs.readFile('data/weekly-board.json','utf8'));
const week=Number(board.week||2), now=new Date().toISOString();
let overlay={prices:[]};try{overlay=JSON.parse(await fs.readFile(`data/free-moneylines-2026-w${week}.json`,'utf8'))}catch{console.log('No free moneyline overlay; nothing to apply.');process.exit(0)}
const byId=new Map((overlay.prices||[]).map(x=>[String(x.canonicalGameId),x]));
function mlNum(v){const m=String(v||'').match(/([+-]\d+)/);return m?Number(m[1]):null}
let changed=0;
let ls=JSON.parse(await fs.readFile('data/longshot-upset-lab.json','utf8'));
for(const c of ls.candidates||[]){
 if(c.priceStatus==='CURRENT')continue;
 const p=byId.get(String(c.canonicalGameId));if(!p)continue;
 const n=mlNum(p.moneyline);if(!Number.isFinite(n))continue;
 c.currentMoneyline=p.moneyline;c.priceStatus='CURRENT-FREE-SOURCE / EXECUTION-RECHECK';c.moneylineTimestamp=p.observedAt||overlay.updatedAt||now;c.moneylineSource=p.source;c.screenEligibility=n>=300?'CURRENT FREE-SOURCE +300+ / EXECUTION RECHECK':'CURRENT FREE-SOURCE BELOW +300';c.action='Use for research/screening only; re-verify an executable sportsbook price before any official decision.';changed++;
}
ls.updatedAt=now;ls.coverage={...(ls.coverage||{}),pricedCandidates:(ls.candidates||[]).filter(x=>x.currentMoneyline).length,currentPricedCandidates:(ls.candidates||[]).filter(x=>x.priceStatus==='CURRENT').length,freeSourcePricedCandidates:(ls.candidates||[]).filter(x=>String(x.priceStatus).startsWith('CURRENT-FREE-SOURCE')).length,freeMoneylineOverlayUpdatedAt:overlay.updatedAt||null};
await fs.writeFile('data/longshot-upset-lab.json',JSON.stringify(ls,null,2)+'\n');
let ud=JSON.parse(await fs.readFile('data/underdog-special.json','utf8'));
for(const c of ud.candidates||[]){if(Number(c.week)!==week||c.currentMoneyline)continue;const p=byId.get(String(c.canonicalGameId));if(!p)continue;c.currentMoneyline=p.moneyline;c.moneylineStatus='CURRENT-FREE-SOURCE / EXECUTION-RECHECK';c.status='CURRENT-SCREEN';c.moneylineSource=p.source;c.moneylineTimestamp=p.observedAt||overlay.updatedAt||now;c.action='Research/screen price only; re-verify executable sportsbook price before activation.';changed++}
ud.updatedAt=now;await fs.writeFile('data/underdog-special.json',JSON.stringify(ud,null,2)+'\n');
console.log(`Applied governed free-moneyline overlay: ${changed} specialty records enriched.`);
