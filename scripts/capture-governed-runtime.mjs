// Persist governed portal emissions into the public runtime repository.
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const portal = process.env.CFB_PORTAL_URL || 'https://cfb-betting-intelligence.netlify.app/';
const boardPath = 'data/weekly-board.json';

const norm = x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const key = g => `${norm(g.away)}__${norm(g.home)}`;
const oldBoard = JSON.parse(await fs.readFile(boardPath, 'utf8'));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', msg => console.log(`[browser:${msg.type()}] ${msg.text()}`));
page.on('pageerror', err => console.error(`[browser:pageerror] ${err.message}`));
await page.goto(portal, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.CFB_RUNTIME_DATA && ['remote-active','local-fallback'].includes(window.CFB_RUNTIME_DATA.status), null, { timeout: 60000 });

try {
  await page.waitForFunction(() => {
    const src = window.CFB_WEEKLY_BOARD_2026;
    const rt = window.CFB_RUNTIME_DATA;
    return Array.isArray(src?.games) && src.games.length >= 80 && rt?.modelPromotion?.status === 'browser-governed-model-active';
  }, null, { timeout: 60000 });
} catch (e) {
  const diag = await page.evaluate(() => ({
    runtime: window.CFB_RUNTIME_DATA || null,
    gameCount: window.CFB_WEEKLY_BOARD_2026?.games?.length || 0,
    scheduleCoverage: window.CFB_WEEKLY_BOARD_2026?.scheduleCoverage || null,
    compatLoaded: !!window.CFB_WEEK2_COMPAT,
    weekGameCount: typeof weeks !== 'undefined' && weeks['Week 2']?.games?.length || 0
  }));
  await browser.close();
  throw new Error(`Full-slate hydration/model promotion timed out: ${JSON.stringify(diag)}`);
}

const emitted = await page.evaluate(() => {
  const src = window.CFB_WEEKLY_BOARD_2026;
  const rt = window.CFB_RUNTIME_DATA;
  if (!src || !Array.isArray(src.games)) throw new Error('CFB_WEEKLY_BOARD_2026 missing');
  return JSON.parse(JSON.stringify({ board: src, runtime: rt }));
});
await browser.close();

if (!emitted.board || Number(emitted.board.week) !== Number(oldBoard.week)) {
  throw new Error(`Runtime week mismatch: portal=${emitted.board?.week} repo=${oldBoard.week}`);
}
if (!Array.isArray(emitted.board.games) || emitted.board.games.length < 80) {
  throw new Error(`Universal runtime coverage incomplete: ${emitted.board.games?.length || 0} games`);
}
if (!emitted.runtime?.modelPromotion || emitted.runtime.modelPromotion.status !== 'browser-governed-model-active') {
  throw new Error(`Governed model promotion inactive: ${JSON.stringify(emitted.runtime?.modelPromotion || null)}`);
}

const oldByKey = new Map((oldBoard.games || []).map(g => [key(g), g]));
const mergedGames = emitted.board.games.map(g => {
  const prior = oldByKey.get(key(g)) || {};
  return {
    ...prior,
    ...g,
    modelSpread: g.modelSpread ?? prior.modelSpread ?? null,
    modelTotal: Number.isFinite(g.modelTotal) ? g.modelTotal : (prior.modelTotal ?? null),
    modelEdgeMagnitude: Number.isFinite(g.modelEdgeMagnitude) ? g.modelEdgeMagnitude : (prior.modelEdgeMagnitude ?? null),
    independentFootballFair: g.independentFootballFair ?? prior.independentFootballFair ?? null,
    independentFootballHomeMargin: Number.isFinite(g.independentFootballHomeMargin) ? g.independentFootballHomeMargin : (prior.independentFootballHomeMargin ?? null),
    independentFootballEdge: Number.isFinite(g.independentFootballEdge) ? g.independentFootballEdge : (prior.independentFootballEdge ?? null),
    independentFootballSide: g.independentFootballSide ?? prior.independentFootballSide ?? null,
    independentFootballConfidence: g.independentFootballConfidence ?? prior.independentFootballConfidence ?? null,
    /* finalExecutableEdge remains governed by exact executable price + veto checks. */
    finalExecutableEdge: prior.finalExecutableEdge ?? g.finalExecutableEdge ?? null
  };
});

const candidate = {
  ...oldBoard,
  games: mergedGames,
  scheduleCoverage: {
    ...(oldBoard.scheduleCoverage || {}),
    completeSlate: true,
    slateCount: mergedGames.length,
    runtimeSource: 'Production portal governed runtime capture',
    note: `Canonical Week ${oldBoard.week} runtime now persists the universal portal slate and governed model emissions.`
  },
  modelStatus: {
    ...(oldBoard.modelStatus || {}),
    productionFairRecompute: 'ACTIVE — governed portal runtime emission persisted',
    reason: 'Production fair/total values are captured from the existing synchronized portal engine after universal runtime hydration. No market-derived or externally reconstructed fair is created by this workflow.',
    independentFootball: 'ACTIVE when genuinely emitted by Independent Composite v2.2; values are persisted exactly from the portal engine.',
    finalExecutableEdge: 'Remains null unless Bet Activation Gate v1.1 has exact executable book/line/juice and all veto checks are satisfied.'
  },
  runtimePersistence: {
    status: 'ACTIVE',
    source: portal,
    promotedGameCount: emitted.runtime.modelPromotion.promotedGameCount,
    independentGameCount: emitted.runtime.modelPromotion.independentGameCount,
    capturedAt: new Date().toISOString()
  }
};

function stable(v) {
  const x = structuredClone(v);
  delete x.updatedAt;
  if (x.runtimePersistence) delete x.runtimePersistence.capturedAt;
  if (x.modelRuntime) delete x.modelRuntime.generatedAt;
  return JSON.stringify(x);
}

if (stable(candidate) === stable(oldBoard)) {
  console.log('No governed runtime changes; leaving weekly-board.json unchanged.');
  process.exit(0);
}

candidate.updatedAt = new Date().toISOString();
await fs.writeFile(boardPath, JSON.stringify(candidate, null, 2) + '\n');
console.log(`Persisted ${mergedGames.length} games; production fairs=${emitted.runtime.modelPromotion.promotedGameCount}; independent=${emitted.runtime.modelPromotion.independentGameCount}.`);
