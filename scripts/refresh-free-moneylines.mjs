import fs from 'node:fs/promises';
import {parseMarkets,sourceUrl as cbsUrl} from './secondary-markets.mjs';
import {americanMoneyline} from './espn-market-fields.mjs';
const board=JSON.parse(await fs.readFile('data/weekly-board.json','utf8'));
const week=Number(board.week),now=new Date().toISOString();
const key=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const dateKey=stamp=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date(stamp)).replace(/-/g,'');
const targets=[];
for(const game of board.games||[]){
 const m=String(game.currentSpread||'').match(/^(.+?)\s+(-?\d+(?:\.\d+)?)/);if(!m)continue;
 const line=Math.abs(Number(m[2]));if(!(line>=9.5||line>=3.5&&line<=7))continue;
 const favorite=key(m[1]);if(![key(game.away),key(game.home)].includes(favorite))continue;
 const team=favorite===key(game.away)?game.home:game.away;
 targets.push({game,team,opponent:team===game.away?game.home:game.away});
}
const prices=new Map();
for(const {game,team,opponent} of targets){
 const part=String(game.currentMoneyline||'').split(' / ').find(s=>s.startsWith(team+' '));
 const ml=part?americanMoneyline(part.slice(team.length).trim()):null;
 if(ml)prices.set(game.gameId,{canonicalGameId:game.gameId,team,opponent,moneyline:ml,source:game.marketSource||'ESPN canonical moneyline',sourceUrl:'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates='+board.season+'&seasontype=2&week='+week+'&limit=200&groups=80',observedAt:game.marketUpdatedAt||board.updatedAt||now,freshness:'CURRENT-OBSERVED',quoteType:'indicative; sportsbook execution recheck required'});
}
// Both team identities and event date are mandatory. Similar Carolina names
// must never borrow one another's odds.
if(prices.size<targets.length){
 try{
  const response=await fetch(cbsUrl,{signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('HTTP '+response.status);
  const quotes=parseMarkets(await response.text());
  for(const {game,team,opponent} of targets){
   if(prices.has(game.gameId))continue;
   const matches=quotes.filter(q=>q.date===dateKey(game.dateTime)&&q.away===key(game.away)&&q.home===key(game.home));
   if(matches.length!==1)continue;
   const quote=matches[0],ml=americanMoneyline(team===game.away?quote.awayMoneyline:quote.homeMoneyline);
   if(ml)prices.set(game.gameId,{canonicalGameId:game.gameId,team,opponent,moneyline:ml,source:'CBS Sports / '+quote.book+' (indicative)',sourceUrl:cbsUrl,observedAt:now,freshness:'CURRENT-OBSERVED',quoteType:'indicative; sportsbook execution recheck required'});
  }
 }catch(error){console.warn('Exact-identity CBS moneylines unavailable:',error.message)}
}
const path='data/free-moneylines-'+board.season+'-w'+week+'.json';
const prior=JSON.parse(await fs.readFile(path,'utf8').catch(()=>'{"prices":[]}'));
for(const p of prior.prices||[]){
 if(prices.has(p.canonicalGameId)||/^CBS Sports/.test(p.source||''))continue;
 const t=targets.find(t=>t.game.gameId===p.canonicalGameId&&key(t.team)===key(p.team)&&key(t.opponent)===key(p.opponent));
 const age=Date.now()-Date.parse(p.observedAt||'');
 if(t&&americanMoneyline(p.moneyline)&&age>=-300000&&age<24*3600000&&p.freshness==='CURRENT-OBSERVED')prices.set(p.canonicalGameId,p);
}
const out={version:'FREE-ML-v5-exact-canonical-identity',season:board.season,week,updatedAt:now,status:'CURRENT-FREE-SOURCE-SWEEP',policy:'Canonical ESPN current moneylines first; CBS fallback requires exact date and both-team identity. Previously fuzzy-matched CBS quotes are discarded. Quotes remain indicative and require sportsbook re-verification.',sources:[{name:'ESPN',role:'canonical event-ID-bound current moneylines'},{name:'CBS Sports',role:'exact date and opponent-pair fallback'}],coverage:{specialtyCandidates:targets.length,pricesFound:prices.size,stillPending:targets.length-prices.size},prices:[...prices.values()]};
await fs.writeFile(path,JSON.stringify(out,null,2)+'\n');
console.log('Exact-identity ML refresh: candidates='+targets.length+', found='+prices.size+', pending='+(targets.length-prices.size));
