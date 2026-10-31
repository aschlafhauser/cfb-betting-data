// Fresh, indicative fallback when ESPN omits an upcoming game's market.
// No cached quotes, model values or execution eligibility are carried forward.
export const sourceUrl='https://www.cbssports.com/college-football/odds/';
const decode=s=>s.replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&#([0-9]+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&quot;/g,'"').replace(/&#39;|&#039;/g,"'").replace(/&amp;/g,'&').replace(/&nbsp;/g,' ');
const text=s=>decode(s.replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
const norm=s=>{const n=s.toLowerCase().replace(/[^a-z0-9]/g,'');return ({charlestonso:'charlestonsouthern',citadel:'thecitadel',texasaandm:'texasam'})[n]||n};
const dateKey=stamp=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp)).replace(/-/g,'');
export function parseMarkets(html){
  const quotes=[];
  for(const table of html.matchAll(/<table\b[^>]*data-game-abbrev=["\']?NCAAF_(\d{8})_[^\s>"\']+["\']?[^>]*>([\s\S]*?)<\/table>/g)){
    const rows=[...table[2].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(x=>x[1]).filter(x=>x.includes('OddsBlock-teamText--long'));
    if(rows.length!==2)continue;
    const sides=rows.map(row=>{
      const name=row.match(/<span[^>]*class="[^"]*OddsBlock-teamText--long[^"]*"[^>]*>([\s\S]*?)<\/span>/)?.[1];
      const configs=[...row.matchAll(/data-config=(?:"([^"]+)"|([^\s>]+))/g)].flatMap(m=>{try{return [JSON.parse(decode(m[1]||m[2]))]}catch{return []}});
      return {name:name?text(name):'',configs};
    });
    const homeSpread=sides[1].configs.find(c=>c.marketName==='Spread');
    if(!homeSpread)continue;
    const book=homeSpread.operatorName;
    const awaySpread=sides[0].configs.find(c=>c.marketName==='Spread'&&c.operatorName===book);
    const total=sides[0].configs.find(c=>c.marketName==='Total'&&c.operatorName===book);
    const homeTotal=sides[1].configs.find(c=>c.marketName==='Total'&&c.operatorName===book);
    const hs=Number(homeSpread.line),as=Number(awaySpread?.line),ou=Number(total?.line);
    if(!book||!awaySpread||!total||!homeTotal||!Number.isFinite(hs)||!Number.isFinite(as)||Math.abs(hs+as)>0.001||!(ou>0)||ou!==Number(homeTotal.line))continue;
    const moneyline=side=>{const m=side.configs.find(c=>/money\s*line/i.test(c.marketName||'')&&c.operatorName===book);const n=Number(m?.odds);return Number.isFinite(n)&&Math.abs(n)>=100?n:null};
    quotes.push({awayMoneyline:moneyline(sides[0]),homeMoneyline:moneyline(sides[1]),date:table[1],away:norm(sides[0].name),home:norm(sides[1].name),homeSpread:hs,total:ou,book,spreadPrices:{away:Number(awaySpread.odds),home:Number(homeSpread.odds)},totalPrices:{over:Number(total.odds),under:Number(homeTotal.odds)}});
  }
  return quotes;
}
export function applyMarkets(games,quotes,observedAt){
  const now=Date.parse(observedAt);
  return games.map(g=>{
    if(!(Date.parse(g.dateTime)>now)||(g.currentSpread&&Number.isFinite(g.currentTotal)))return g;
    const matches=quotes.filter(q=>q.date===dateKey(g.dateTime)&&q.away===norm(g.away)&&q.home===norm(g.home));
    if(matches.length!==1)return g;
    const q=matches[0],homeLine=q.homeSpread;
    // Keep each snapshot from one book; never blend a partial ESPN quote with it.
    return {...g,currentSpread:homeLine===0?'Pick':`${homeLine<0?g.home:g.away} -${Math.abs(homeLine)}`,currentTotal:q.total,currentMoneyline:null,marketSource:`CBS Sports / ${q.book} (indicative)`,marketUpdatedAt:observedAt,marketProvenance:{sourceUrl,observedAt,book:q.book,quoteType:'indicative',executionVerified:false,spreadPrices:q.spreadPrices,totalPrices:q.totalPrices}};
  });
}
export async function refreshSecondaryMarkets(games,observedAt=new Date().toISOString()){
  if(!games.some(g=>Date.parse(g.dateTime)>Date.parse(observedAt)&&(!g.currentSpread||!Number.isFinite(g.currentTotal))))return games;
  try{
    const r=await fetch(sourceUrl,{signal:AbortSignal.timeout(20000),headers:{'user-agent':'cfb-market-coverage/1.0'}});
    if(!r.ok)throw Error(`HTTP ${r.status}`);
    return applyMarkets(games,parseMarkets(await r.text()),observedAt);
  }catch(e){console.warn(`Secondary market source unavailable; missing quotes remain null: ${e.message}`);return games;}
}
