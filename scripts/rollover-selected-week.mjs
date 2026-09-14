import fs from 'node:fs/promises';

const boardPath='data/weekly-board.json';
const board=JSON.parse(await fs.readFile(boardPath,'utf8'));
const season=Number(board.season||2026), currentWeek=Number(board.week);
if(!Number.isFinite(currentWeek))throw new Error('weekly-board.json has no selected week');

const now=Date.now();
const games=Array.isArray(board.games)?board.games:[];
const allStarted=games.length>0&&games.every(g=>{const t=Date.parse(g.dateTime||'');return Number.isFinite(t)&&t<=now});
if(!allStarted){console.log(`CFB rollover not due: Week ${currentWeek} still has unstarted games.`);process.exit(0)}

const nextWeek=currentWeek+1;
const url=`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${season}&seasontype=2&week=${nextWeek}&limit=200&groups=80`;
const r=await fetch(url,{headers:{accept:'application/json,text/plain,*/*','user-agent':'cfb-governed-week-rollover/1.0'}});
if(!r.ok)throw new Error(`ESPN Week ${nextWeek} schedule fetch failed: HTTP ${r.status}`);
const j=await r.json();
const events=Array.isArray(j.events)?j.events:[];
if(!events.length){console.log(`CFB rollover not due: ESPN Week ${nextWeek} slate is empty.`);process.exit(0)}
const future=events.filter(e=>{const t=Date.parse(e.date||e?.competitions?.[0]?.date||'');return Number.isFinite(t)&&t>now});
if(!future.length){console.log(`CFB rollover not due: Week ${nextWeek} has no future kickoffs.`);process.exit(0)}

const teamLabel=c=>c?.team?.location||c?.team?.shortDisplayName||c?.team?.displayName||c?.team?.name||null;
const ml=v=>{const n=Number(v);return Number.isFinite(n)?(n>0?`+${n}`:String(n)):null};
function spread(o,a,h,al,hl){const d=String(o?.details||'').trim();if(!d)return null;const m=d.match(/^([^\s]+)\s+(-?\d+(?:\.\d+)?)/);if(!m)return d;const t=m[1].toUpperCase(),line=m[2];if(t===String(a?.team?.abbreviation||'').toUpperCase())return `${al} ${line}`;if(t===String(h?.team?.abbreviation||'').toUpperCase())return `${hl} ${line}`;return d}
function row(ev){const c=ev?.competitions?.[0]||{},cs=c.competitors||[],a=cs.find(x=>x.homeAway==='away'),h=cs.find(x=>x.homeAway==='home');if(!a||!h)return null;const al=teamLabel(a)||'Away',hl=teamLabel(h)||'Home',o=Array.isArray(c.odds)?c.odds[0]:null,ou=Number(o?.overUnder),am=ml(o?.awayTeamOdds?.moneyLine),hm=ml(o?.homeTeamOdds?.moneyLine);return {gameId:`ESPN-${ev.id}`,dateTime:ev.date||c.date||null,away:al,home:hl,neutral:!!c.neutralSite,tv:(c.broadcasts||[]).flatMap(b=>b.names||[])[0]||null,currentSpread:spread(o,a,h,al,hl),currentTotal:Number.isFinite(ou)&&ou>0?ou:null,currentMoneyline:am||hm?`${al} ${am||'—'} / ${hl} ${hm||'—'}`:null,marketSource:o?.provider?.name?`ESPN ${o.provider.name}`:(o?'ESPN odds feed':null),modelSpread:null,modelTotal:null,modelEdgeMagnitude:null,finalExecutableEdge:null,independentFootballFair:null,independentFootballHomeMargin:null,independentFootballEdge:null,independentFootballSide:null,independentFootballConfidence:null,priority:'low',stage:'deep-dive-pending',deepDiveStatus:'PENDING',deepDiveEvidenceCount:0,confidence:'pending',informationQuality:o?'market-available':'source-limited',thresholdStatus:o?'MARKET AVAILABLE · DEEP DIVE PENDING':'MARKET/EXECUTION PENDING · DEEP DIVE PENDING',action:'RESEARCH — Deep Dive not yet evidence-complete',notes:`Canonical Week ${nextWeek} schedule row. No prior-week model, expert, injury or execution state carried forward.`}}
const nextGames=events.map(row).filter(Boolean).sort((a,b)=>new Date(a.dateTime||0)-new Date(b.dateTime||0));
if(!nextGames.length)throw new Error(`ESPN Week ${nextWeek} produced no canonical games`);
const updated={...board,week:nextWeek,updatedAt:new Date().toISOString(),games:nextGames,scheduleCoverage:{completeSlate:true,slateCount:nextGames.length,renderedSlateCount:nextGames.length,runtimeSource:'ESPN selected-week rollover bootstrap',scheduleHydration:'ROLLED-FORWARD',scheduleHydrationError:null,marketGameCount:nextGames.filter(g=>g.currentSpread||Number.isFinite(g.currentTotal)).length,deepDiveCompleteCount:0,note:`Governed rollover from Week ${currentWeek} to Week ${nextWeek}. Prior-week immutable audit debt remains in prior-week artifacts and is not backfilled.`},runtimePersistence:{status:'ROLLOVER-BOOTSTRAP',source:'ESPN selected-week schedule',renderedRowCount:0,deepDiveCompleteCount:0,capturedAt:new Date().toISOString()}};
await fs.writeFile(boardPath,JSON.stringify(updated,null,2)+'\n');
console.log(`CFB selected week rolled from ${currentWeek} to ${nextWeek}; ${nextGames.length} canonical games bootstrapped.`);
