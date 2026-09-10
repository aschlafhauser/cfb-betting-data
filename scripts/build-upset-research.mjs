import fs from 'node:fs/promises';
const board=JSON.parse(await fs.readFile('data/weekly-board.json','utf8'));
const dives=JSON.parse(await fs.readFile(`data/deep-dives-2026-w${board.week}.json`,'utf8'));
const now=new Date().toISOString(), norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const byId=new Map((dives.dossiers||[]).map(d=>[d.canonicalGameId,d]));
function spread(s){const m=String(s||'').match(/^(.+?)\s+(-?\d+(?:\.\d+)?)/);return m?{fav:m[1].trim(),n:Math.abs(+m[2])}:null}
function dog(g){const p=spread(g.currentSpread);if(!p)return null; if(norm(p.fav)===norm(g.away))return {team:g.home,opp:g.away,line:p.n}; if(norm(p.fav)===norm(g.home))return {team:g.away,opp:g.home,line:p.n}; return null}
function n(v){return Number.isFinite(Number(v))?Number(v):null}
function modelDogEdge(g,d){const e=n(g.modelEdgeMagnitude); if(e==null)return 0; const side=norm(g.modelSide||g.modelLean||''); return side.includes(norm(d.team))?Math.min(2,e/2):0}
function independentDogEdge(g,d){const e=n(g.independentFootballEdge);return e!=null&&norm(g.independentFootballSide).includes(norm(d.team))?Math.min(2,e/2):0}
function text(d){return JSON.stringify(d||{}).toLowerCase()}
function flag(t,words){return words.some(w=>t.includes(w))}
const records=[];
for(const g of board.games||[]){const d=dog(g);if(!d)continue;const dd=byId.get(g.gameId),t=text(dd);let components={};
 components.qbStability=flag(t,['qb advantage','qb/','quarterback','passing'])?1:0;
 components.trenchResistance=flag(t,['ol/','pass rush','front','dl/lb'])?1:0;
 components.explosivePath=flag(t,['explosive','qb/wr','receivers','coverage'])?1:0;
 components.compression=flag(t,['pace','compression','run game','run blocking','total driver'])?1:0;
 components.havocVolatility=flag(t,['pressure','havoc','turnover','sack','blitz'])?1:0;
 components.coachingSituational=flag(t,['coaching','scheme','situational','special teams'])?1:0;
 components.availability=flag(t,['injury','availability','depth','out','questionable'])?1:0;
 components.productionModel=modelDogEdge(g,d);
 components.independentModel=independentDogEdge(g,d);
 const raw=Object.values(components).reduce((a,b)=>a+b,0), max=12;
 const profileScore=Math.round(raw/max*100);
 const tier=profileScore>=65?'A':profileScore>=50?'B':profileScore>=35?'C':'D';
 records.push({week:board.week,canonicalGameId:g.gameId,team:d.team,opponent:d.opp,currentSpread:`+${d.line}`,band:d.line<=7?'UNDERDOG-SPECIAL':d.line>=9.5?'UPSET-LAB':'INTERMEDIATE',profileScore,tier,components,deepDiveStatus:dd?.status||g.deepDiveStatus||'PENDING',informationQuality:dd?.informationQuality||'unknown',researchFlags:{highProfile:profileScore>=50,modelSupport:components.productionModel>0||components.independentModel>0,volatilityPath:components.explosivePath+components.havocVolatility+components.compression>=2},governance:'RESEARCH-ONLY — cannot alter production fair, model weights, Bet Activation Gate, official ledger, units or historical snapshots.'});
}
records.sort((a,b)=>b.profileScore-a.profileScore);
const underdog=records.filter(r=>r.band==='UNDERDOG-SPECIAL'), upset=records.filter(r=>r.band==='UPSET-LAB');
const out={version:'1.0-research',season:2026,week:board.week,updatedAt:now,status:'PROSPECTIVE-RESEARCH-ONLY',isolation:{productionFairImpact:0,modelWeightImpact:0,betActivationImpact:0,ledgerImpact:0},methodology:{purpose:'Rank underdogs relative to comparable current spread bands using governed dossier evidence and existing model disagreement without changing production pricing.',components:['QB stability/path','trench resistance','explosive path','game compression','havoc/volatility','coaching/situational','availability','production-model support','Independent Football support'],validationPlan:['preserve weekly prospective scores','compare outright win rate to market-implied probability within price buckets','track CLV','track Brier/log loss when executable ML exists','measure lift versus comparable-price dogs','promote no component into production without holdout validation']},coverage:{allUnderdogs:records.length,underdogSpecial:underdog.length,upsetLab:upset.length},underdogSpecial:underdog,upsetLab:upset,intermediate:records.filter(r=>r.band==='INTERMEDIATE')};
await fs.writeFile(`data/upset-research-2026-w${board.week}.json`,JSON.stringify(out,null,2)+'\n');
console.log(`Unified upset research: all=${records.length}, special=${underdog.length}, upset=${upset.length}; production impact=0.`);
