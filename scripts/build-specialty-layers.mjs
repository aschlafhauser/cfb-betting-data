import fs from 'node:fs/promises';
const board=JSON.parse(await fs.readFile('data/weekly-board.json','utf8'));
const week=Number(board.week||2), now=new Date().toISOString();
const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const key=(a,h)=>`${norm(a)}__${norm(h)}`;
function parseSpread(s){const m=String(s||'').match(/^(.+?)\s+(-?\d+(?:\.\d+)?)/);return m?{fav:m[1].trim(),line:Math.abs(Number(m[2]))}:null}
function dogFor(g){const p=parseSpread(g.currentSpread);if(!p)return null;const fav=norm(p.fav),away=norm(g.away),home=norm(g.home);if(fav===away)return {team:g.home,opponent:g.away,spread:p.line};if(fav===home)return {team:g.away,opponent:g.home,spread:p.line};return null}
function parseML(text,team){const s=String(text||'');if(!s)return null;const idx=s.toLowerCase().indexOf(String(team).toLowerCase());if(idx<0)return null;const tail=s.slice(idx+String(team).length);const m=tail.match(/([+-]\d+)/);return m?Number(m[1]):null}
const boardByKey=new Map((board.games||[]).map(g=>[key(g.away,g.home),g]));
const LEGACY_MATCHUPS={
 '2026-W2-RUT-BC':['Rutgers','Boston College'],
 '2026-W2-MIZZ-KAN':['Missouri','Kansas'],
 '2026-W2-OKLA-MICH':['Oklahoma','Michigan'],
 '2026-W2-ORE-OKST':['Oregon','Oklahoma State'],
 '2026-W2-ASU-TAMU':['Arizona State','Texas A&M'],
 '2026-W2-ILL-DUKE':['Illinois','Duke'],
 '2026-W2-OHST-TEX':['Ohio State','Texas'],
 '2026-W2-TTU-ORST':['Texas Tech','Oregon State'],
 '2026-W2-ARK-UTAH':['Arkansas','Utah']
};

let sunday={observations:[]};
try{sunday=JSON.parse(await fs.readFile(`data/timing-observations/2026-W${week}-sunday-open.json`,'utf8'))}catch{}
const movers=[];
for(const o of sunday.observations||[]){
  let g=null;
  if(o.away&&o.home)g=boardByKey.get(key(o.away,o.home))||null;
  const mapped=LEGACY_MATCHUPS[o.gameId];if(!g&&mapped)g=boardByKey.get(key(mapped[0],mapped[1]))||null;
  if(!g)continue;
  movers.push({canonicalGameId:g.gameId,legacyGameId:o.gameId||null,matchup:`${g.away} at ${g.home}`,reference:{spread:o.marketSpread??null,total:o.marketTotal??null,moneyline:o.marketMoneyline??null,timestamp:sunday.timestamp||null,stage:o.stage||sunday.stage||'sunday-open'},current:{spread:g.currentSpread??null,total:g.currentTotal??null,moneyline:g.currentMoneyline??null,timestamp:board.updatedAt||now,source:g.marketSource||null},model:{spread:g.modelSpread??null,total:g.modelTotal??null,edgeMagnitude:g.modelEdgeMagnitude??null,independentFootballFair:g.independentFootballFair??null,independentFootballSide:g.independentFootballSide??null,independentFootballEdge:g.independentFootballEdge??null},deepDiveStatus:g.deepDiveStatus||'PENDING',classification:'RECONCILE',note:'Movement is descriptive only; direction never activates a bet without governed fair and execution gate.'});
}
await fs.writeFile(`data/market-movers-2026-w${week}.json`,JSON.stringify({season:2026,week,updatedAt:now,status:'CURRENT',coverage:{referenceGames:movers.length,expectedReferenceGames:(sunday.observations||[]).length,currentBoardGames:(board.games||[]).length,unmatchedReferenceGames:(sunday.observations||[]).length-movers.length},movers},null,2)+'\n');

let priorUD={candidates:[]};try{priorUD=JSON.parse(await fs.readFile('data/underdog-special.json','utf8'))}catch{}
const priorUdByTeam=new Map((priorUD.candidates||[]).map(c=>[norm(c.team+' '+c.opponent),c]));
const ud=[];
for(const g of board.games||[]){const d=dogFor(g);if(!d||d.spread<3.5||d.spread>7)continue;const prior=priorUdByTeam.get(norm(d.team+' '+d.opponent));const ml=parseML(g.currentMoneyline,d.team);const priceCurrent=Number.isFinite(ml);ud.push({week,canonicalGameId:g.gameId,legacyGameId:prior?.gameId||null,team:d.team,opponent:d.opponent,currentSpread:`+${d.spread}`,currentMoneyline:priceCurrent?(ml>0?`+${ml}`:`${ml}`):null,moneylineStatus:priceCurrent?'CURRENT':'PRICE-RECHECK-REQUIRED',qualifiers:prior?.qualifiers||null,qualifierCount:Number.isFinite(prior?.qualifierCount)?prior.qualifierCount:null,profileQualifies:prior?.profileQualifies??null,mlValueQualifies:priceCurrent?(prior?.fairMl!=null?ml>Number(prior.fairMl):null):null,deepDiveStatus:g.deepDiveStatus||'PENDING',status:priceCurrent?'CURRENT-SCREEN':'CURRENT-SCREEN-PRICE-PENDING',action:priceCurrent?'Evaluate existing v1.1 football-profile and fair-ML gates.':'Do not declare NO QUALIFIER until a current executable moneyline is verified.',note:'Current-week screen generated from canonical Weekly Board. Missing price is a visible execution limitation, not an empty result.'});}
priorUD.week=week;priorUD.updatedAt=now;priorUD.sundayWeek2Rerun={timestamp:now,result:ud.some(x=>x.status==='CURRENT-SCREEN')?'CURRENT SCREEN COMPLETE':'CURRENT SCREEN / PRICE VERIFICATION REQUIRED',note:`Canonical board produced ${ud.length} +3.5-to-+7 underdogs. Current ML availability is evaluated separately; no wager is inferred.`};priorUD.candidates=[...(priorUD.candidates||[]).filter(c=>Number(c.week)!==week),...ud];
await fs.writeFile('data/underdog-special.json',JSON.stringify(priorUD,null,2)+'\n');

let priorLS={candidates:[]};try{priorLS=JSON.parse(await fs.readFile('data/longshot-upset-lab.json','utf8'))}catch{}
const priorLsByTeam=new Map((priorLS.candidates||[]).map(c=>[norm(c.team+' '+c.opponent),c]));
const ls=[];
for(const g of board.games||[]){
  const d=dogFor(g);if(!d||d.spread<9.5)continue;
  const prior=priorLsByTeam.get(norm(d.team+' '+d.opponent));
  // Keep the primary lab focused on games with both-team independent-model coverage or an existing governed longshot record; this removes most FCS/buy-game noise.
  const hasFbsCoverage=!!g.independentFootballFair||!!prior;
  if(!hasFbsCoverage)continue;
  const ml=parseML(g.currentMoneyline,d.team),priceCurrent=Number.isFinite(ml),qualifiesPrice=priceCurrent&&ml>=300,priorPrice=prior?.moneyline||null;
  ls.push({canonicalGameId:g.gameId,legacyGameId:prior?.gameId||null,team:d.team,opponent:d.opponent,currentSpread:`+${d.spread}`,currentMoneyline:priceCurrent?(ml>0?`+${ml}`:`${ml}`):null,priorMoneyline:priorPrice,priceStatus:priceCurrent?'CURRENT':'PRICE-RECHECK-REQUIRED',screenEligibility:qualifiesPrice?'VERIFIED +300+':(priceCurrent?'CURRENT BELOW +300':'LIKELY LONGSHOT / ML PENDING'),score:prior?.score??null,classification:prior?.classification||'WATCH / PRICE PENDING',informationQuality:prior?.informationQuality||'standard',qbThesis:prior?.qbThesis||null,compressionThesis:prior?.compressionThesis||null,personnel:prior?.personnel||null,deepDiveStatus:g.deepDiveStatus||'PENDING',action:qualifiesPrice?'Reconcile mechanism and governed value; classification alone never activates a wager.':'Keep visible until current moneyline is verified.',note:'Primary Longshot Lab is restricted to games with both-team governed football coverage or an existing governed longshot record; cross-level/buy-game dogs are not allowed to swamp the screen.'});
}
priorLS.week=week;priorLS.updatedAt=now;priorLS.status='prospective-live-current-screen';priorLS.coverage={...(priorLS.coverage||{}),eligibilityUniverse:`complete ${(board.games||[]).length}-game canonical selected-week schedule; primary display filtered to both-team football coverage/existing governed candidates`,thursdayScreenComplete:true,lastCanonicalRefresh:now};priorLS.candidates=ls;
await fs.writeFile('data/longshot-upset-lab.json',JSON.stringify(priorLS,null,2)+'\n');
console.log(`Specialty layers refreshed: movers=${movers.length}/${(sunday.observations||[]).length}, underdog-band=${ud.length}, longshot-primary=${ls.length}.`);
