// Persist governed portal emissions into the public runtime repository.
// Full-slate schedule hydration runs in Node (not the browser) to avoid ESPN CORS.
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const portal = process.env.CFB_PORTAL_URL || 'https://cfb-betting-intelligence.netlify.app/';
const boardPath = 'data/weekly-board.json';
const oldBoard = JSON.parse(await fs.readFile(boardPath, 'utf8'));
const week = Number(oldBoard.week || 2);
const season = 2026;
const espnSchedule = `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${season}&seasontype=2&week=${week}&limit=200`;

const norm = x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const key = g => `${norm(g.away)}__${norm(g.home)}`;

function scheduleRow(ev) {
  const comp = ev?.competitions?.[0] || {};
  const competitors = comp.competitors || [];
  const away = competitors.find(c => c.homeAway === 'away');
  const home = competitors.find(c => c.homeAway === 'home');
  if (!away || !home) return null;
  const broadcasts = (comp.broadcasts || []).flatMap(b => b.names || []);
  return {
    gameId: `ESPN-${ev.id}`,
    dateTime: ev.date || comp.date || null,
    away: away.team?.displayName || away.team?.shortDisplayName || away.team?.name || 'Away',
    home: home.team?.displayName || home.team?.shortDisplayName || home.team?.name || 'Home',
    neutral: !!comp.neutralSite,
    tv: broadcasts[0] || null,
    currentSpread: null,
    currentTotal: null,
    currentMoneyline: null,
    modelSpread: null,
    modelTotal: null,
    modelEdgeMagnitude: null,
    finalExecutableEdge: null,
    independentFootballFair: null,
    independentFootballHomeMargin: null,
    independentFootballEdge: null,
    independentFootballSide: null,
    independentFootballConfidence: null,
    priority: 'low',
    stage: 'universal-deep-dive-complete',
    confidence: 'pending',
    informationQuality: 'pending',
    thresholdStatus: 'DEEP DIVE COMPLETE · MARKET/EXECUTION PENDING',
    action: 'PASS until verified executable market and governed edge',
    notes: 'Universal Week 2 schedule row. Model outputs are populated only when genuinely emitted by the governed production engine.'
  };
}

async function buildFullSlate() {
  const response = await fetch(espnSchedule, {
    headers: {
      'accept': 'application/json,text/plain,*/*',
      'user-agent': 'cfb-governed-runtime-capture/1.0'
    }
  });
  if (!response.ok) throw new Error(`Server-side ESPN schedule fetch failed: HTTP ${response.status}`);
  const json = await response.json();
  const schedule = (json.events || []).map(scheduleRow).filter(Boolean);
  if (schedule.length < 80) throw new Error(`Server-side ESPN schedule returned only ${schedule.length} games`);

  const overlay = new Map((oldBoard.games || []).map(g => [key(g), g]));
  const merged = schedule.map(g => {
    const prior = overlay.get(key(g));
    return prior ? { ...g, ...prior, gameId: prior.gameId || g.gameId, tv: prior.tv || g.tv || null } : g;
  });
  const seen = new Set(merged.map(key));
  for (const prior of oldBoard.games || []) {
    if (!seen.has(key(prior))) merged.push(prior);
  }
  merged.sort((a, b) => new Date(a.dateTime || 0) - new Date(b.dateTime || 0));

  const expected = Number(oldBoard.scheduleCoverage?.slateCount || 86);
  if (merged.length < Math.min(80, expected)) throw new Error(`Merged server-side slate incomplete: ${merged.length}/${expected}`);

  return {
    ...oldBoard,
    games: merged,
    scheduleCoverage: {
      ...(oldBoard.scheduleCoverage || {}),
      completeSlate: true,
      slateCount: merged.length,
      renderedSlateCount: merged.length,
      runtimeSource: 'GitHub Node server-side ESPN Week 2 schedule + governed overlay',
      scheduleHydration: 'SERVER-SIDE COMPLETE — browser CORS bypassed',
      scheduleHydrationError: null
    }
  };
}

const hydratedBoard = await buildFullSlate();
console.log(`Server-side slate hydrated: ${hydratedBoard.games.length} games.`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', msg => console.log(`[browser:${msg.type()}] ${msg.text()}`));
page.on('pageerror', err => console.error(`[browser:pageerror] ${err.message}`));
await page.goto(portal, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.CFB_RUNTIME_DATA && ['remote-active','local-fallback'].includes(window.CFB_RUNTIME_DATA.status), null, { timeout: 60000 });

// Replace the browser's compact 14-game operating overlay with the server-side complete slate.
await page.evaluate(async board => {
  window.CFB_WEEKLY_BOARD_2026 = board;
  if (window.CFB_RUNTIME_DATA) window.CFB_RUNTIME_DATA.serverSideHydration = { status: 'ACTIVE', gameCount: board.games.length };

  try {
    if (window.CFB_SEASON_BOARD_BRIDGE && typeof window.CFB_SEASON_BOARD_BRIDGE.apply === 'function') {
      window.CFB_SEASON_BOARD_BRIDGE.apply();
    }
  } catch (e) {}

  try {
    if (window.CFB_WEEK2_COMPAT && typeof window.CFB_WEEK2_COMPAT.render === 'function') {
      await window.CFB_WEEK2_COMPAT.render();
    }
  } catch (e) {}

  try { if (typeof window.renderBoard === 'function') window.renderBoard(); } catch (e) {}
  try {
    if (typeof window.CFB_RUNTIME_PROMOTE_GOVERNED_MODEL_OUTPUTS === 'function') {
      window.CFB_RUNTIME_PROMOTE_GOVERNED_MODEL_OUTPUTS();
    }
  } catch (e) {}
  try { if (typeof window.renderBoard === 'function') window.renderBoard(); } catch (e) {}
}, hydratedBoard);

try {
  await page.waitForFunction(() => {
    const src = window.CFB_WEEKLY_BOARD_2026;
    const rt = window.CFB_RUNTIME_DATA;
    return Array.isArray(src?.games) && src.games.length >= 80 && rt?.modelPromotion?.status === 'browser-governed-model-active';
  }, null, { timeout: 30000 });
} catch (e) {
  const diag = await page.evaluate(() => ({
    runtime: window.CFB_RUNTIME_DATA || null,
    gameCount: window.CFB_WEEKLY_BOARD_2026?.games?.length || 0,
    scheduleCoverage: window.CFB_WEEKLY_BOARD_2026?.scheduleCoverage || null,
    compatLoaded: !!window.CFB_WEEK2_COMPAT,
    renderedRows: document.querySelectorAll('#scheduleRows tr').length,
    weekGameCount: typeof weeks !== 'undefined' && weeks[`Week ${window.CFB_WEEKLY_BOARD_2026?.week}`]?.games?.length || 0
  }));
  await browser.close();
  throw new Error(`Governed full-slate promotion timed out after server-side hydration: ${JSON.stringify(diag)}`);
}

const emitted = await page.evaluate(() => {
  const src = window.CFB_WEEKLY_BOARD_2026;
  const rt = window.CFB_RUNTIME_DATA;
  if (!src || !Array.isArray(src.games)) throw new Error('CFB_WEEKLY_BOARD_2026 missing');
  return JSON.parse(JSON.stringify({
    board: src,
    runtime: rt,
    renderedRows: document.querySelectorAll('#scheduleRows tr').length
  }));
});
await browser.close();

if (!emitted.board || Number(emitted.board.week) !== Number(oldBoard.week)) {
  throw new Error(`Runtime week mismatch: portal=${emitted.board?.week} repo=${oldBoard.week}`);
}
if (!Array.isArray(emitted.board.games) || emitted.board.games.length < 80) {
  throw new Error(`Universal runtime coverage incomplete after injection: ${emitted.board.games?.length || 0} games`);
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
    // finalExecutableEdge remains governed by exact executable price + veto checks.
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
    renderedSlateCount: emitted.renderedRows,
    runtimeSource: 'GitHub Node server-side schedule hydration + production portal governed model capture',
    scheduleHydration: 'SERVER-SIDE COMPLETE — no browser ESPN dependency',
    scheduleHydrationError: null,
    note: `Canonical Week ${oldBoard.week} runtime persists the universal slate and governed production model emissions.`
  },
  modelStatus: {
    ...(oldBoard.modelStatus || {}),
    productionFairRecompute: 'ACTIVE — governed portal runtime emission persisted',
    reason: 'Schedule hydration is server-side; production fair/total values are captured from the existing synchronized portal engine across the hydrated slate. No market-derived fair is manufactured.',
    independentFootball: 'ACTIVE when genuinely emitted by Independent Composite v2.2; values are persisted exactly from the portal engine.',
    finalExecutableEdge: 'Remains null unless Bet Activation Gate v1.1 has exact executable book/line/juice and all veto checks are satisfied.'
  },
  runtimePersistence: {
    status: 'ACTIVE',
    source: portal,
    hydration: 'server-side ESPN',
    promotedGameCount: emitted.runtime.modelPromotion.promotedGameCount,
    independentGameCount: emitted.runtime.modelPromotion.independentGameCount,
    renderedRowCount: emitted.renderedRows,
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
console.log(`Persisted ${mergedGames.length} games; rendered=${emitted.renderedRows}; production fairs=${emitted.runtime.modelPromotion.promotedGameCount}; independent=${emitted.runtime.modelPromotion.independentGameCount}.`);
