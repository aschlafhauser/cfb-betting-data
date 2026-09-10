import fs from 'node:fs/promises';
const board=JSON.parse(await fs.readFile('data/weekly-board.json','utf8'));
const dives=JSON.parse(await fs.readFile(`data/deep-dives-2026-w${board.week}.json`,'utf8'));
const now=new Date().toISOString(), norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const byId=new Map((dives.dossiers||[]).map(d=>[d.canonicalGameId,d]));
function spread(s){const m=String(s||'').match(/^(.+?)\s+(-?\d+(?:\.\d+)?)/);return m?{fav:m[1].trim(),n:Math.abs(+m[2])}:null}
function dog(g){const p=spread(g.currentSpread);if(!p)return null;if(norm(p.fav)===norm(g.away))return {team:g.home,opp:g.away,line:p.n};if(norm(p.fav)===norm(g.home))return {team:g.away,opp:g.home,line:p.n};return null}
function n(v){return Number.isFinite(Number(v))?Number(v):null}
function modelDogEdge(g,d){const e=n(g.modelEdgeMagnitude);if(e==null)return 0;const side=norm(g.modelSide||g.modelLean||'');return side.includes(norm(d.team))?Math.min(2,e/2):0}
function independentDogEdge(g,d){const e=n(g.independentFootballEdge);return e!=null&&norm(g.independentFootballSide).includes(norm(d.team))?Math.min(2,e/2):0}
function routeBand(line){if(line>=3.5&&line<=7)return 'UNDERDOG-SPECIAL';if(line>=9.5)return 'UPSET-LAB';return 'INTERMEDIATE'}
function directionalEvidence(dd,dimension,team){
 const ev=dd?.evidenceDimensions?.[dimension]?.evidence||[];let pos=0,neg=0;
 for(const row of ev){const verdict=Array.isArray(row)?String(row[1]||''):String(row||'');const v=norm(verdict),t=norm(team);if(!v)continue;if(v.includes(t))pos++;else if(/\+\+|advantage|edge|favors|favours/.test(verdict.toLowerCase()))neg++}
 if(pos===0)return 0;return neg===0?1:Math.max(0.25,pos/(pos+neg));
}
function explicitDogText(dd,team,words){
 const t=JSON.stringify(dd||{}).toLowerCase(),name=String(team).toLowerCase();
 return words.some(w=>{const i=t.indexOf(w);if(i<0)return false;const window=t.slice(Math.max(0,i-120),i+180);return window.includes(name)&&(window.includes('advantage')||window.includes('++')||window.includes('favors')||window.includes('edge'));})?1:0;
}
const records=[];
for(const g of board.games||[]){
 const d=dog(g);if(!d)continue;const dd=byId.get(g.gameId);const total=n(g.currentTotal??dd?.market?.total);
 const components={};
 // Every qualitative point must now be directional to the underdog. Mere mention of QB/injury/coaching no longer earns credit.
 components.qbStability=directionalEvidence(dd,'qbPassing',d.team);
 components.trenchResistance=directionalEvidence(dd,'olFront',d.team);
 components.explosivePath=directionalEvidence(dd,'receiversCoverage',d.team);
 // Low totals mechanically compress possessions/scoring margin; high totals receive no compression credit.
 components.compression=total!=null?(total<=48?1:total<=55?0.5:0):0;
 components.havocVolatility=explicitDogText(dd,d.team,['havoc','turnover','pressure','sack','blitz']);
 components.coachingSituational=explicitDogText(dd,d.team,['coaching','scheme','situational','special teams']);
 components.availability=explicitDogText(dd,d.team,['availability','injury','questionable','return','healthy']);
 components.productionModel=modelDogEdge(g,d);
 components.independentModel=independentDogEdge(g,d);
 const raw=Object.values(components).reduce((a,b)=>a+b,0),max=12;
 const profileScore=Math.round(raw/max*100);
 const tier=profileScore>=65?'A':profileScore>=50?'B':profileScore>=35?'C':'D';
 records.push({week:board.week,canonicalGameId:g.gameId,team:d.team,opponent:d.opp,currentSpread:`+${d.line}`,band:routeBand(d.line),profileScore,tier,components,deepDiveStatus:dd?.status||g.deepDiveStatus||'PENDING',informationQuality:dd?.informationQuality||'unknown',researchFlags:{highProfile:profileScore>=50,modelSupport:components.productionModel>0||components.independentModel>0,volatilityPath:components.explosivePath+components.havocVolatility+components.compression>=2},scoreAudit:{version:'v1.2-directional',rule:'Qualitative components require explicit underdog-favorable evidence; keyword presence alone earns zero. Compression is total-based. Model components remain directional.'},governance:'RESEARCH-ONLY — cannot alter production fair, model weights, Bet Activation Gate, official ledger, units or historical snapshots.'});
}
records.sort((a,b)=>b.profileScore-a.profileScore);
const underdog=records.filter(r=>r.band==='UNDERDOG-SPECIAL'),upset=records.filter(r=>r.band==='UPSET-LAB'),intermediate=records.filter(r=>r.band==='INTERMEDIATE');
const routingViolations=records.filter(r=>(r.band==='UNDERDOG-SPECIAL'&&!(parseFloat(r.currentSpread.slice(1))>=3.5&&parseFloat(r.currentSpread.slice(1))<=7))||(r.band==='UPSET-LAB'&&parseFloat(r.currentSpread.slice(1))<9.5));
if(routingViolations.length)throw new Error(`Governed upset routing violation: ${routingViolations.map(r=>`${r.team} ${r.currentSpread} -> ${r.band}`).join(', ')}`);
const out={version:'1.2-directional-research',season:2026,week:board.week,updatedAt:now,status:'PROSPECTIVE-RESEARCH-ONLY',isolation:{productionFairImpact:0,modelWeightImpact:0,betActivationImpact:0,ledgerImpact:0},methodology:{purpose:'Rank underdogs using directional governed evidence. A dossier mentioning a category is not evidence for the underdog.',routing:{underdogSpecial:'+3.5 through +7 inclusive',upsetLab:'+9.5 or longer',intermediate:'all other current underdogs; calibration only'},components:['QB stability/path','trench resistance','explosive path','game compression','havoc/volatility','coaching/situational','availability','production-model support','Independent Football support'],scoring:'Qualitative dimensions score only when evidence explicitly favors the underdog. Compression uses current total. Model support is directional. No generic keyword-presence points.',validationPlan:['preserve weekly prospective scores','compare outright win rate to market-implied probability within price buckets','track CLV','track Brier/log loss when executable ML exists','measure lift versus comparable-price dogs','promote no component into production without holdout validation']},coverage:{allUnderdogs:records.length,underdogSpecial:underdog.length,upsetLab:upset.length,intermediate:intermediate.length,routingViolations:0},underdogSpecial:underdog,upsetLab:upset,intermediate};
await fs.writeFile(`data/upset-research-2026-w${board.week}.json`,JSON.stringify(out,null,2)+'\n');
console.log(`Unified upset research v1.2 directional: all=${records.length}, special=${underdog.length}, upset=${upset.length}, intermediate=${intermediate.length}; production impact=0.`);
