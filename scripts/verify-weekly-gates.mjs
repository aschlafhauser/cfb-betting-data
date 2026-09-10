import fs from 'node:fs/promises';

const season = Number(process.env.CFB_SEASON || 2026);
const week = Number(process.env.CFB_WEEK || 2);
const manifestPath = `data/weekly-manifest-${season}-w${week}.json`;
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const board = JSON.parse(await fs.readFile('data/weekly-board.json', 'utf8'));
const deep = JSON.parse(await fs.readFile('data/deep-dive-status.json', 'utf8'));

const failures = [];
const expected = Number(manifest?.gates?.canonicalSchedule?.expectedGames || 0);
if (Number(board.week) !== week) failures.push(`Weekly Board week ${board.week} != expected ${week}`);
if (!Array.isArray(board.games) || board.games.length !== expected) failures.push(`Canonical schedule ${board.games?.length || 0}/${expected}`);
if (Number(deep.week) !== week) failures.push(`Deep Dive status week ${deep.week} != expected ${week}`);
if (Number(deep.completedGameCount || 0) > Number(deep.gameCount || 0)) failures.push('Deep Dive completed count exceeds game count');
if (Number(deep.completedGameCount || 0) === Number(deep.gameCount || 0) && !Array.isArray(deep.evidenceBackedCompleteGames)) failures.push('Deep Dive 100% claimed without evidence-backed game inventory');

for (const [name, gate] of Object.entries(manifest.gates || {})) {
  if (String(gate.status || '').toUpperCase() === 'FAIL') failures.push(`${name}: ${gate.detail || 'failed'}`);
}

const result = {
  season,
  week,
  checkedAt: new Date().toISOString(),
  scheduleGames: board.games?.length || 0,
  deepDiveComplete: deep.completedGameCount || 0,
  deepDivePending: deep.pendingGameCount || 0,
  status: failures.length ? 'FAIL' : 'PASS',
  failures
};
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exit(1);
