import fs from 'node:fs/promises';
const board=JSON.parse(await fs.readFile('data/weekly-board.json','utf8'));
const dives=JSON.parse(await fs.readFile(`data/deep-dives-2026-w${board.week}.json`,'utf8'));
const live=JSON.parse(await fs.readFile('data/live-team-stats.json','utf8').catch(()=>'{"teams":[]}'));
const phil=JSON.parse(await fs.readFile('data/phil-inseason-power-ratings-2026.json','utf8').catch(()=>'{"rows":[]}'));
const now=new Date().toISOString(), norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const byId=new Map((dives.dossiers||[]).map(d=>[d.canonicalGameId,d]));
const aliases={miamifl:'miami',ohiost:'ohiostate',pennst:'pennstate',floridast:'floridastate',mississippist:'mississippistate',michiganst:'michiganstate',sanjosest:'sanjosestate',coloradost:'coloradostate',kansasst:'kansasstate',arizonast:'arizonastate',iowast:'iowastate',oklahomast:'oklahomastate',boisest:'boisestate',oregonst:'oregonstate',utahst:'utahstate',kentst:'kentstate'};
const canon=s=>aliases[norm(s)]||norm(s);
const liveByTeam=new Map((live.teams||[]).map(x=>[canon(x.team),x]));
const philByTeam=new Map((phil.rows||[]).map(x=>[canon(x.team),x]));
function currentEvidence(team){
 const x=liveByTeam.get(canon(team)),u=x?.unitDeltas||{};
 const vals=needles=>Object.entries(u).filter(([k])=>needles.some(n=>k.toLowerCase().includes(n))).map(([,v])=>Number(v)||0);
 const pos=a=>Math.max(0,...a,0);
 return {qbStability:Math.min(4,+(pos(vals(['qb','passoffense']))*4).toFixed(1)),trenchResistance:Math.min(4,+(pos(vals(['defensivefront','runoffense','overallexecution']))*3).toFixed(1)),explosivePath:Math.min(3,+(pos(vals(['passoffense','offenseyardage','offense']))*2.5).toFixed(1)),havocVolatility:Math.min(3,+(pos(vals(['takeaway','defense']))*1.5).toFixed(1)),evidence:x?.evidence||null};
}
function philDogSupport(team,opp,line){
 const a=philByTeam.get(canon(team)),b=philByTeam.get(canon(opp));if(!a||!b)return 0;
 const gap=Number(b.current)-Number(a.current),cushion=Number(line)-gap;
 if(cushion>=8)return 2;if(cushion>=5)return 1.5;if(cushion>=3)return 1;if(cushion>=1.5)return .5;return 0;
}
function spread(s){const m=String(s||'').match(/^(.+?)\s+(-?\d+(?:\.\d+)?)/);return m?{fav:m[1].trim(),n:Math.abs(+m[2])}:null}
function dog(g){const p=spread(g.currentSpread);if(!p)return null;if(norm(p.fav)===norm(g.away))return {team:g.home,opp:g.away,line:p.n};if(norm(p.fav)===norm(g.home))return {team:g.away,opp:g.home,line:p.n};return null}
function n(v){return Number.isFinite(Number(v))?Number(v):null}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function modelDogEdge(g,d,max=2){const e=n(g.modelEdgeMagnitude);if(e==null)return 0;const side=norm(g.modelSide||g.modelLean||'');return side.includes(norm(d.team))?clamp(e/2,0,max):0}
function independentDogEdge(g,d,max=2){const e=n(g.independentFootballEdge);return e!=null&&norm(g.independentFootballSide).includes(norm(d.team))?clamp(e/2,0,max):0}
function routeBand(line){if(line>=3.5&&line<=7)return 'UNDERDOG-SPECIAL';if(line>=9.5)return 'UPSET-LAB';return 'INTERMEDIATE'}
function directionalEvidence(dd,dimension,team){const ev=dd?.evidenceDimensions?.[dimension]?.evidence||[];let pos=0,neg=0;for(const row of ev){const verdict=Array.isArray(row)?String(row[1]||''):String(row||'');const v=norm(verdict),t=norm(team);if(!v)continue;if(v.includes(t))pos++;else if(/\+\+|advantage|edge|favors|favours/.test(verdict.toLowerCase()))neg++}if(pos===0)return 0;return neg===0?1:clamp(pos/(pos+neg),.25,1)}
function explicitDogText(dd,team,words){const t=JSON.stringify(dd||{}).toLowerCase(),name=String(team).toLowerCase();return words.some(w=>{const i=t.indexOf(w);if(i<0)return false;const z=t.slice(Math.max(0,i-140),i+220);return z.includes(name)&&(z.includes('advantage')||z.includes('++')||z.includes('favors')||z.includes('edge')||z.includes('strength'));})?1:0}
function snippets(dd,team){const out=[];for(const m of dd?.mechanisms||[]){const s=String(m||'').trim();if(s&&s.toLowerCase().includes(String(team).toLowerCase())&&!out.includes(s))out.push(s)}return out.slice(0,3)}
// Research-only scoring: observable production first, matchup adjustments second.
// Missing advanced statistics never receive assumed positive credit.
function numeric(v){return v===null||v===undefined||v===''?null:n(v)}
function observed(g,dd,side,field){return numeric(dd?.model?.components?.philInseason?.[side]?.[field]??dd?.evidenceDimensions?.modelFair?.evidence?.components?.philInseason?.[side]?.[field])}
function rankScore(rank,max=1){return rank==null?null:+(clamp((135-rank)/110,0,1)*max).toFixed(2)}
function perspective(g,d,dd){return canon(d.team)===canon(g.home)?'home':'away'}
function point(v){return +clamp(v,0,25).toFixed(1)}
function evidenceFlag(v){return v==null?'MISSING':'OBSERVED'}
function winProb(margin){return 1/(1+Math.exp(-margin/13.5))}
function fairMargin(g,d,field){const x=String(g[field]||'');const m=x.match(/^(.*?)\\s+(-?\\d+(?:\\.\\d+)?)/);if(!m)return null;const val=Math.abs(Number(m[2]));return canon(m[1])===canon(d.team)?val:-val}
function score25(g,d,dd){
 const total=numeric(g.currentTotal??dd?.market?.total),side=perspective(g,d,dd),other=side==='home'?'away':'home';
 const qbMatch=directionalEvidence(dd,'qbPassing',d.team),trMatch=directionalEvidence(dd,'olFront',d.team),exMatch=directionalEvidence(dd,'receiversCoverage',d.team);
 const teamYppRank=observed(g,dd,side,'offYpp')==null?numeric(dd?.evidenceDimensions?.modelFair?.evidence?.components?.philInseason?.[side]?.offYpp?.rank):null;
 const homeUnits=dd?.evidenceDimensions?.modelFair?.evidence?.components?.philInseason;
 const team=homeUnits?.[side]||{},opp=homeUnits?.[other]||{};
 const offense=rankScore(numeric(team.offYpp?.rank),1.5),oppDefense=rankScore(numeric(opp.defYpp?.rank),1);
 const passDefenseWeakness=opp.passD?.rank==null?null:clamp((Number(opp.passD.rank)-40)/95,0,1);
 const qbSeason=numeric(liveByTeam.get(canon(d.team))?.quarterback?.adjustedEpaPerDropback);
 const qbRecent=numeric(liveByTeam.get(canon(d.team))?.quarterback?.recentAdjustedEpaPerDropback);
 const qbStarter=liveByTeam.get(canon(d.team))?.quarterback?.confirmedStarter===true;
 const qbEfficiency=qbSeason==null?0:clamp((qbSeason+0.20)/0.4,0,1)*1.5;
 const qbTrend=qbRecent==null?0:clamp((qbRecent+0.20)/0.4,0,1);
 const qbMatchPoints=passDefenseWeakness==null?0:qbMatch*passDefenseWeakness;
 const qbScore=qbEfficiency+qbTrend+(qbStarter?0.5:0)+qbMatchPoints;
 const qbCap=qbSeason==null?1:qbSeason<0?2:4;
 const frontEvidence=team.offYpp?.rank!=null||team.agg?.rank!=null||opp.offYpp?.rank!=null;
 const trenchProduction=rankScore(numeric(team.agg?.rank),1.4)??0;
 const trenchDefense=rankScore(numeric(team.defYpp?.rank),1.2)??0;
 const trenchScore=frontEvidence?clamp(trenchProduction+trenchDefense+trMatch*.8,0,4):Math.min(1,trMatch);
 const explosiveBase=offense??0;
 const explosiveMatch=passDefenseWeakness==null?0:exMatch*passDefenseWeakness*.8;
 const explosiveScore=clamp(explosiveBase+explosiveMatch,0,offense==null?1:3);
 const pace=numeric(liveByTeam.get(canon(d.team))?.neutralPacePossessions);
 const drive=numeric(liveByTeam.get(canon(d.team))?.offense?.driveSuccessRate);
 const lowTotal=total==null?0:total<=45?1.25:total<=50?1:total<=55?.65:total<=60?.25:0;
 const compression=clamp(lowTotal+(pace!=null&&pace<=11?.85:0)+(drive!=null&&drive>=.65?.75:0),0,3);
 const havocRate=numeric(liveByTeam.get(canon(d.team))?.defense?.opponentAdjustedHavocRate);
 const opponentMistakes=numeric(liveByTeam.get(canon(d.opp))?.offense?.turnoverWorthyPlayRate);
 const havoc=clamp((havocRate==null?0:clamp(havocRate/.2,0,1)*1.8)+(opponentMistakes==null?0:clamp(opponentMistakes/.05,0,1)*1.2),0,3);
 const coaching=0; // Unstructured prose is not measurable situational evidence.
 const injury=liveByTeam.get(canon(d.team))?.availability?.verifiedNetImpactPoints;
 const availability=injury==null?0:clamp(Number(injury),0,2);
 // ATS edges alone do not establish outright-win value. Keep these distinct.
 const productionFair=fairMargin(g,d,'modelSpread');
 const independentFair=fairMargin(g,d,'independentFootballFair');
 const marketMargin=-d.line;
 const marketProbability=winProb(marketMargin);
 const prodProbability=productionFair==null?null:winProb(productionFair);
 const independentProbability=independentFair==null?null:winProb(independentFair);
 const pricedML=numeric(g.currentMoneyline?.underdog??g.currentMoneyline);
 const priceProbability=pricedML==null?null:(pricedML>0?100/(pricedML+100):-pricedML/(-pricedML+100));
 const target=priceProbability??marketProbability;
 const productionModel=prodProbability==null?0:clamp((prodProbability-target-.03)*6,0,2);
 // Correlated independent model inputs receive no duplicate full credit.
 const independentModel=independentProbability==null?0:clamp((independentProbability-target-.03)*3,0,1);
 const c={qbStability:point(Math.min(qbCap,qbScore)),trenchResistance:point(trenchScore),explosivePath:point(explosiveScore),compression:point(compression),havocVolatility:point(havoc),coachingSituational:coaching,availability:point(availability),productionModel:point(productionModel),independentModel:point(independentModel)};
 const signals={qbSeasonEpa:qbSeason,qbRecentEpa:qbRecent,qbStarterConfirmed:qbStarter,opponentPassDefenseRank:numeric(opp.passD?.rank),teamOffenseYppRank:numeric(team.offYpp?.rank),teamAggregateRank:numeric(team.agg?.rank),teamDefensiveYppRank:numeric(team.defYpp?.rank),marketTotal:total,neutralPacePossessions:pace,driveSuccessRate:drive,havocRate,opponentTurnoverWorthyRate:opponentMistakes,verifiedAvailabilityImpact:injury,marketWinProbability:target,productionWinProbability:prodProbability,independentWinProbability:independentProbability};
 const componentEvidence={
  qbStability:{quality:qbSeason==null?'LIMITED':'OBSERVED',reason:qbSeason==null?'Season QB EPA missing: capped at 1/4 despite matchup opportunity.':'Season efficiency, recent form, starter status and matchup separately assessed.'},
  trenchResistance:{quality:frontEvidence?'PARTIAL':'LIMITED',reason:'Team aggregate and defensive production with capped trench matchup adjustment; line-specific metrics pending.'},
  explosivePath:{quality:offense==null?'LIMITED':'PARTIAL',reason:'Observed offensive YPP and opposing pass defense; explosive-play rate unavailable.'},
  compression:{quality:pace==null||drive==null?'PARTIAL':'OBSERVED',reason:'Market total alone capped at 1.25/3; possession and drive evidence required for maximum.'},
  havocVolatility:{quality:havocRate==null||opponentMistakes==null?'LIMITED':'OBSERVED',reason:'Requires observed opponent-adjusted havoc and opponent turnover-worthy rate; no prose-only points.'},
  coachingSituational:{quality:'MISSING',reason:'No verified quantified situational advantage; neutral.'},
  availability:{quality:injury==null?'MISSING':'OBSERVED',reason:'Verified net impact only; unknown is neutral.'},
  productionModel:{quality:prodProbability==null?'MISSING':'ESTIMATED',reason:'Outright-win probability relative to implied benchmark, not ATS edge.'},
  independentModel:{quality:independentProbability==null?'MISSING':'ESTIMATED-CORRELATED',reason:'Win-probability corroboration with shared-input credit capped at 1/2.'}
 };
 const score=point(Object.values(c).reduce((x,y)=>x+y,0));
 return {components:c,componentEvidence,signals,score,total,priceStatus:priceProbability==null?'NO_EXECUTABLE_MONEYLINE':'PRICE_AVAILABLE',estimatedWinProbability:prodProbability,marketWinProbability:target};
}
function narrative(g,d,dd,s){const ce=currentEvidence(d.team);const favorable=snippets(dd,d.team).filter(x=>!/(?:\\s|^)\\+/.test(x.split('—').at(-1)||'')||x.toLowerCase().includes(d.team.toLowerCase())&&x.split('—').at(-1)?.toLowerCase().includes(d.team.toLowerCase()));if(ce.evidence){const rows=Array.isArray(ce.evidence)?ce.evidence:[ce.evidence];for(const row of rows){const txt=typeof row==='string'?row:JSON.stringify(row);if(txt&&!favorable.includes(txt))favorable.push(txt)}}const philA=philByTeam.get(canon(d.team)),philB=philByTeam.get(canon(d.opp));if(philA&&philB)favorable.push(`Phil Steele current power rating: ${d.team} ${philA.current} vs ${d.opp} ${philB.current}.`);favorable.push(`Canonical selected-week market: ${d.team} +${d.line}${g.currentTotal!=null?`, total ${g.currentTotal}`:''}; production model ${g.modelSide||g.modelLean||'no directional support'}${g.modelEdgeMagnitude!=null?` edge ${g.modelEdgeMagnitude}`:''}; Football Independent ${g.independentFootballSide||'no directional support'}${g.independentFootballEdge!=null?` edge ${g.independentFootballEdge}`:''}.`);const strengths=[];if(s.components.qbStability)strengths.push('a credible quarterback/passing path');if(s.components.trenchResistance)strengths.push('enough trench resistance to avoid a one-sided game');if(s.components.explosivePath)strengths.push('an explosive-play matchup path');if(s.components.compression>=1.5)strengths.push('a lower-total environment that can compress possessions');if(s.components.havocVolatility)strengths.push('havoc/turnover volatility');if(s.components.coachingSituational)strengths.push('a situational or coaching angle');if(s.components.productionModel||s.components.independentModel)strengths.push('support from at least one independent pricing view');const caseText=strengths.length?`${d.team} has an upset path built around ${strengths.slice(0,3).join(', ')}. ${favorable[0]||''}`:`${d.team} is a market longshot, but the governed matchup evidence does not currently show enough directional advantages to call the upset path strong.`;const risks=[];if(!s.components.qbStability)risks.push('no clear QB/passing advantage');if(!s.components.trenchResistance)risks.push('the trenches do not clearly favor the underdog');if(!s.components.productionModel&&!s.components.independentModel)risks.push('neither pricing model currently supports the underdog');if(s.total!=null&&s.total>60)risks.push('a high-total script increases the favorite’s separation ceiling');const failText=`The case can fail if ${risks.slice(0,3).join(', ')||'the favorite’s talent and depth advantages dominate the matchup'}.`;
 const watch=[];if(s.components.qbStability)watch.push(`${d.team} QB efficiency and early-down success`);if(s.components.trenchResistance)watch.push('pressure rate and line-of-scrimmage control');if(s.components.havocVolatility)watch.push('turnovers, sacks and short fields');watch.push('game pace / possession count');watch.push('late availability and inactives');return {upsetCase:caseText.replace(/\s+/g,' ').trim(),whyItCouldFail:failText,keyThingsToWatch:[...new Set(watch)].slice(0,4),evidence:favorable};}
const records=[];
for(const g of board.games||[]){const d=dog(g);if(!d)continue;const dd=byId.get(g.gameId),s=score25(g,d,dd),nar=narrative(g,d,dd,s);const tier=s.score>=19?'A':s.score>=16?'B':s.score>=13?'C':'D';records.push({week:board.week,canonicalGameId:g.gameId,team:d.team,opponent:d.opp,currentSpread:`+${d.line}`,band:routeBand(d.line),profileScore:s.score,score25:s.score,scoreMax:25,tier,components:s.components,componentEvidence:s.componentEvidence,signals:s.signals,priceStatus:s.priceStatus,estimatedWinProbability:s.estimatedWinProbability,marketWinProbability:s.marketWinProbability,narrative:nar,deepDiveStatus:(dd?.status&&String(dd.status).toUpperCase()!=='PENDING')?dd.status:((nar.evidence||[]).length?'SOURCE-LIMITED':'PENDING'),informationQuality:(dd?.informationQuality&&String(dd.informationQuality).toLowerCase()!=='unknown')?dd.informationQuality:((nar.evidence||[]).length?'governed-source-limited':'unknown'),researchFlags:{highProfile:s.score>=16,modelSupport:s.components.productionModel>0||s.components.independentModel>0,volatilityPath:s.components.explosivePath+s.components.havocVolatility+s.components.compression>=4},scoreAudit:{version:'v3.0-25pt-evidence-capped',rule:'25-point directional rubric. Qualitative credit requires underdog-favorable evidence; model support is directional; no keyword-presence points.'},governance:'RESEARCH-ONLY — cannot alter production fair, model weights, Bet Activation Gate, official ledger, units or historical snapshots.'})}
if(records.length&&records.every(r=>Number(r.score25)===0))throw new Error('Upset research regression: every 25-point score collapsed to zero');
records.sort((a,b)=>b.profileScore-a.profileScore);const underdog=records.filter(r=>r.band==='UNDERDOG-SPECIAL'),upset=records.filter(r=>r.band==='UPSET-LAB'),intermediate=records.filter(r=>r.band==='INTERMEDIATE');const routingViolations=records.filter(r=>(r.band==='UNDERDOG-SPECIAL'&&!(parseFloat(r.currentSpread.slice(1))>=3.5&&parseFloat(r.currentSpread.slice(1))<=7))||(r.band==='UPSET-LAB'&&parseFloat(r.currentSpread.slice(1))<9.5));if(routingViolations.length)throw new Error(`Governed upset routing violation: ${routingViolations.map(r=>`${r.team} ${r.currentSpread} -> ${r.band}`).join(', ')}`);
const out={version:'3.0-25pt-evidence-capped-research',season:2026,week:board.week,updatedAt:now,status:'PROSPECTIVE-RESEARCH-ONLY',isolation:{productionFairImpact:0,modelWeightImpact:0,betActivationImpact:0,ledgerImpact:0},methodology:{purpose:'Rank underdogs on a transparent 25-point directional football rubric and explain the actual upset mechanism.',routing:{underdogSpecial:'+3.5 through +7 inclusive',upsetLab:'+9.5 or longer',intermediate:'all other current underdogs; calibration only'},scoreMax:25,components:{qbStability:4,trenchResistance:4,explosivePath:3,compression:3,havocVolatility:3,coachingSituational:2,availability:2,productionModel:2,independentModel:2},scoring:'Only evidence that directionally helps the underdog earns qualitative points. Compression requires possession evidence for full credit. Model support is based on estimated outright-win probability; shared-input independent support is capped. Every candidate receives an Upset Case, Why It Could Fail and Key Things to Watch.',validationPlan:['preserve weekly prospective scores','compare outright win rate to market-implied probability within price buckets','track CLV','track Brier/log loss when executable ML exists','measure lift versus comparable-price dogs','promote no component into production without holdout validation']},coverage:{allUnderdogs:records.length,underdogSpecial:underdog.length,upsetLab:upset.length,intermediate:intermediate.length,routingViolations:0},underdogSpecial:underdog,upsetLab:upset,intermediate};await fs.writeFile(`data/upset-research-2026-w${board.week}.json`,JSON.stringify(out,null,2)+'\n');console.log(`Unified upset research v2 25-point: all=${records.length}, special=${underdog.length}, upset=${upset.length}, intermediate=${intermediate.length}; production impact=0.`);
