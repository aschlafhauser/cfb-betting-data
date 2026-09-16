import fs from 'node:fs/promises';
const livePath='data/live-team-stats.json';
const metricsPath='data/team-metrics-current.json';
const boardPath='data/weekly-board.json';
const [live,metrics,board]=await Promise.all([livePath,metricsPath,boardPath].map(async p=>JSON.parse(await fs.readFile(p,'utf8'))));
const liveTs=Date.parse(live.updatedAt||''),metricsTs=Date.parse(metrics.updatedAt||'');
const week=Number(board.week),metricWeek=Number(metrics.week);
const stale=!Number.isFinite(liveTs)||!Number.isFinite(metricsTs)||liveTs<metricsTs-6*3600000||metricWeek!==week;
if(stale){
  for(const t of live.teams||[]){
    if(t.ratingDelta!=null)t.historicalRatingDelta=t.ratingDelta;
    if(t.unitDeltas&&Object.keys(t.unitDeltas).length)t.historicalUnitDeltas=t.unitDeltas;
    t.ratingDelta=0;
    t.unitDeltas={};
    t.modelEligible=false;
    t.freshnessNote=`Stale prior-week live adjustment suppressed for Week ${week}; current raw/team metrics and ESPN FPI refresh independently.`;
  }
  live.governance=`${live.governance||''} Stale opponent/context-adjusted deltas are automatically neutralized until a same-week governed refresh exists.`.trim();
  live.selectedWeek=week;
  live.freshnessStatus='STALE_NEUTRALIZED';
  live.freshnessCheckedAt=new Date().toISOString();
  await fs.writeFile(livePath,JSON.stringify(live,null,2)+'\n');
  console.log(`Neutralized stale CFB live adjustments: live=${live.updatedAt||'missing'} metrics=${metrics.updatedAt||'missing'} selectedWeek=${week} metricWeek=${metricWeek}`);
}else{
  live.selectedWeek=week;live.freshnessStatus='CURRENT';live.freshnessCheckedAt=new Date().toISOString();
  await fs.writeFile(livePath,JSON.stringify(live,null,2)+'\n');
  console.log(`CFB live adjustment freshness PASS for Week ${week}.`);
}
