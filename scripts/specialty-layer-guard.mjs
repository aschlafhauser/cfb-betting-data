import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const board = JSON.parse(await fs.readFile('data/weekly-board.json','utf8'));
const season = Number(board.season || 2026);
const week = Number(board.week);
const now = new Date().toISOString();

function run(script, {allowFailure=false}={}) {
  const r = spawnSync(process.execPath, [script], {stdio:'inherit', env:process.env});
  if (r.status !== 0 && !allowFailure) throw new Error(`${script} failed with exit ${r.status}`);
  return r.status === 0;
}
function norm(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'')}
function parseSpread(s){const m=String(s||'').match(/^(.+?)\s+(-?\d+(?:\.\d+)?)/);return m?{fav:m[1].trim(),line:Math.abs(Number(m[2]))}:null}
function dogFor(g){const p=parseSpread(g.currentSpread);if(!p)return null;const fav=norm(p.fav);if(fav===norm(g.away))return {team:g.home,opponent:g.away,spread:p.line};if(fav===norm(g.home))return {team:g.away,opponent:g.home,spread:p.line};return null}

const deepDivePath = `data/deep-dives-${season}-w${week}.json`;
try {
  await fs.access(deepDivePath);
} catch {
  await fs.writeFile(deepDivePath, JSON.stringify({
    season, week, updatedAt: now, status:'BOOTSTRAP-PENDING', dossiers:[],
    note:'Created by specialty-layer guard so selected-week upset research can populate before browser Deep Dive enrichment completes.'
  }, null, 2) + '\n');
}

run('scripts/build-upset-research.mjs');
run('scripts/build-specialty-layers.mjs');
run('scripts/refresh-free-moneylines.mjs', {allowFailure:true});
run('scripts/apply-free-moneylines.mjs', {allowFailure:true});
run('scripts/apply-longshot-v2.mjs', {allowFailure:true});

const underdog = JSON.parse(await fs.readFile('data/underdog-special.json','utf8'));
const longshot = JSON.parse(await fs.readFile('data/longshot-upset-lab.json','utf8'));
const expectedSpecial = [];
const expectedLongshot = [];
for (const g of board.games || []) {
  const d = dogFor(g); if (!d) continue;
  if (d.spread >= 3.5 && d.spread <= 7) expectedSpecial.push({gameId:g.gameId,...d});
  if (d.spread >= 9.5) expectedLongshot.push({gameId:g.gameId,...d});
}
const currentSpecial = (underdog.candidates||[]).filter(c=>Number(c.week)===week);
const currentLongshot = (longshot.candidates||[]).filter(c=>Number(c.week)===week);
const specialIds = new Set(currentSpecial.map(c=>String(c.canonicalGameId||c.gameId)));
const longshotIds = new Set(currentLongshot.map(c=>String(c.canonicalGameId||c.gameId)));
const missingSpecial = expectedSpecial.filter(x=>!specialIds.has(String(x.gameId)));
const missingLongshot = expectedLongshot.filter(x=>!longshotIds.has(String(x.gameId)));
const incompleteSpecial = currentSpecial.filter(c=>{
  const q=c.qualifiers||{};
  return c.criterionAssessmentStatus!=='COMPLETE' || !['rest','nonExplosive','qbYpa'].every(k=>q[k]&&typeof q[k].qualifies==='boolean'&&String(q[k].reason||'').trim());
});
const incompleteLongshot = currentLongshot.filter(c=>{
  const comps=c.researchComponents||{};
  const narrative=c.narrative||{};
  const scoreOk=Number.isFinite(Number(c.score))&&Number(c.score)>=0&&Number(c.score)<=25;
  const componentsOk=['qbStability','trenchResistance','explosivePath','compression','havocVolatility','coachingSituational','availability','productionModel','independentModel'].every(k=>Number.isFinite(Number(comps[k])));
  const narrativeOk=String(narrative.upsetCase||'').trim()&&String(narrative.whyItCouldFail||'').trim()&&Array.isArray(narrative.keyThingsToWatch)&&narrative.keyThingsToWatch.length>0;
  const evidenceOk=Array.isArray(narrative.evidence)&&narrative.evidence.length>0;
  const researchStateOk=!['PENDING',''].includes(String(c.deepDiveStatus||'').toUpperCase())&&!['unknown',''].includes(String(c.informationQuality||'').toLowerCase());
  const priceOk=!!String(c.priceStatus||'').trim();
  return !(scoreOk&&componentsOk&&narrativeOk&&evidenceOk&&researchStateOk&&priceOk);
});

const report = {
  season, week, updatedAt: now,
  status: missingSpecial.length || missingLongshot.length || incompleteSpecial.length || incompleteLongshot.length ? 'FAIL' : 'PASS',
  expected: {underdogSpecial: expectedSpecial.length, longshotUpsetLab: expectedLongshot.length},
  populated: {underdogSpecial: currentSpecial.length, longshotUpsetLab: currentLongshot.length},
  missing: {underdogSpecial: missingSpecial, longshotUpsetLab: missingLongshot},
  incomplete: {underdogSpecial: incompleteSpecial.map(x=>({gameId:x.canonicalGameId,team:x.team})), longshotUpsetLab: incompleteLongshot.map(x=>({gameId:x.canonicalGameId,team:x.team,deepDiveStatus:x.deepDiveStatus,informationQuality:x.informationQuality}))},
  governance: 'Specialty layers must be selected-week complete independent of browser/model-capture success. Population is independent of browser/model capture, but PASS requires governed research completeness. A browser failure may produce SOURCE-LIMITED records with explicit evidence; it may never certify PENDING/unknown/empty-evidence specialty candidates.'
};
await fs.writeFile(`data/specialty-layer-guard-${season}-w${week}.json`, JSON.stringify(report,null,2)+'\n');
console.log(`Specialty guard Week ${week}: underdog ${currentSpecial.length}/${expectedSpecial.length}; longshot ${currentLongshot.length}/${expectedLongshot.length}`);
if (report.status !== 'PASS') process.exit(1);
