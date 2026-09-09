// Persist governed portal emissions into the public runtime repository.
// Schedule hydration is server-side to avoid ESPN browser CORS. The portal receives
// the complete FBS-vs-FBS board from its first weekly-board.json request so no async
// runtime loader can overwrite it with the compact operating overlay.
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const portal = process.env.CFB_PORTAL_URL || 'https://cfb-betting-intelligence.netlify.app/';
const boardPath = 'data/weekly-board.json';
const oldBoard = JSON.parse(await fs.readFile(boardPath, 'utf8'));
const week = Number(oldBoard.week || 2);
const season = 2026;
const expected = Number(oldBoard.scheduleCoverage?.slateCount || 86);
const scheduleUrl = `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${season}&seasontype=2&week=${week}&limit=200&groups=80`;
const teamsUrl = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams?limit=300&groups=80';

const norm = x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const key = g => `${norm(g.away)}__${norm(g.home)}`;
const headers = { 'accept': 'application/json,text/plain,*/*', 'user-agent': 'cfb-governed-runtime-capture/1.0' };

async function fetchJson(url, label) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${label} fetch failed: HTTP ${response.status}`);
  return response.json();
}

function collectFbsTeamIds(json) {
  const entries = json?.sports?.[0]?.leagues?.[0]?.teams || [];
  return new Set(entries.map(x => String(x?.team?.id || x?.id || '')).filter(Boolean));
}

function eventTeams(ev) {
  const comp = ev?.competitions?.[0] || {};
  const competitors = comp.competitors || [];
  const away = competitors.find(c => c.homeAway === 'away');
  const home = competitors.find(c => c.homeAway === 'home');
  return { comp, away, home };
}

function scheduleRow(ev) {
  const { comp, away, home } = eventTeams(ev);
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
    notes: 'Universal Week 2 FBS-vs-FBS row. Model outputs populate only when genuinely emitted by the governed production engine.'
  };
}

async function buildFullSlate() {
  const [scheduleJson, teamsJson] = await Promise.all([
    fetchJson(scheduleUrl, 'ESPN schedule'),
    fetchJson(teamsUrl, 'ESPN FBS teams')
  ]);
  const fbsIds = collectFbsTeamIds(teamsJson);
  if (fbsIds.size < 120) throw new Error(`FBS team universe unexpectedly small: ${fbsIds.size}`);

  const rawEvents = scheduleJson.events || [];
  const fbsVsFbsEvents = rawEvents.filter(ev => {
    const { away, home } = eventTeams(ev);
    return away && home && fbsIds.has(String(away.team?.id || '')) && fbsIds.has(String(home.team?.id || ''));
  });
  const schedule = fbsVsFbsEvents.map(scheduleRow).filter(Boolean);
  console.log(`ESPN groups=80 raw=${rawEvents.length}; FBS teams=${fbsIds.size}; FBS-vs-FBS=${schedule.length}; expected=${expected}.`);
  if (schedule.length !== expected) {
    throw new Error(`Canonical FBS-vs-FBS slate mismatch: ${schedule.length}/${expected}`);
  }

  const overlay = new Map((oldBoard.games || []).map(g => [key(g), g]));
  const merged = schedule.map(g => {
    const prior = overlay.get(key(g));
    return prior ? { ...g, ...prior, gameId: prior.gameId || g.gameId, tv: prior.tv || g.tv || null } : g;
  });
  merged.sort((a, b) => new Date(a.dateTime || 0) - new Date(b.dateTime || 0));

  return {
    ...oldBoard,
    games: merged,
    scheduleCoverage: {
      ...(oldBoard.scheduleCoverage || {}),
      completeSlate: true,
      slateCount: expected,
      renderedSlateCount: expected,
      runtimeSource: 'GitHub Node ESPN groups=80 FBS-vs-FBS + governed overlay',
      scheduleHydration: 'SERVER-SIDE COMPLETE — exact selected-week universe',
      scheduleHydrationError: null
    }
  };
}

const hydratedBoard = await buildFullSlate();
console.log(`Server-side canonical slate hydrated: ${hydratedBoard.games.length} games.`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', msg => console.log(`[browser:${msg.type()}] ${msg.text()}`));
page.on('pageerror', err => console.error(`[browser:pageerror] ${err.message}`));

// Make the production runtime loader consume the complete canonical board from its
// first request. This eliminates the race where a later remote fetch restored 14 games.
await page.route('**/weekly-board.json*', async route => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(hydratedBoard) });
});

await page.goto(portal, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.CFB_RUNTIME_DATA && ['remote-active','local-fallback'].includes(window.CFB_RUNTIME_DATA.status), null, { timeout: 60000 });

try {
  await page.waitForFunction(expectedCount => {
    const src = window.CFB_WEEKLY_BOARD_2026;
    const rt = window.CFB_RUNTIME_DATA;
    return Array.isArray(src?.games) && src.games.length === expectedCount &&
      rt?.modelPromotion?.status === 'browser-governed-model-active';
  }, expected, { timeout: 30000 });
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
  throw new Error(`Governed full-slate promotion timed out: ${JSON.stringify(diag)}`);
}

// Re-render once after promotion and allow DOM to settle.
await page.evaluate(() => {
  try { if (typeof window.renderBoard === 'function') window.renderBoard(); } catch (e) {}
  try {
    if (typeof window.CFB_RUNTIME_PROMOTE_GOVERNED_MODEL_OUTPUTS === 'function') {
      window.CFB_RUNTIME_PROMOTE_GOVERNED_MODEL_OUTPUTS();
    }
  } catch (e) {}
  try { if (typeof window.renderBoard === 'function') window.renderBoard(); } catch (e) {}
});
await page.waitForTimeout(500);

const emitted = await page.evaluate(() => {
  const src = window.CFB_WEEKLY_BOARD_2026;
  const rt = window.CFB_RUNTIME_DATA;
  if (!src || !Array.isArray(src.games)) throw new Error('CFB_WEEKLY_BOARD_2026 missing');
  const rows = Array.from(document.querySelectorAll('#scheduleRows tr'));
  return JSON.parse(JSON.stringify({
    board: src,
    runtime: rt,
    renderedRows: rows.length,
    renderedFairCells: rows.filter(r => {
      const cell = r.children?.[5];
      const text = cell?.textContent?.trim() || '';
      return text && !/pending|—/i.test(text);
    }).length
  }));
});
await browser.close();

if (Number(emitted.board.week) !== week) throw new Error(`Runtime week mismatch: portal=${emitted.board?.week} repo=${week}`);
if (emitted.board.games.length !== expected) throw new Error(`Universal runtime coverage incomplete: ${emitted.board.games.length}/${expected}`);
if (emitted.renderedRows !== expected) throw new Error(`Rendered Weekly Board incomplete: ${emitted.renderedRows}/${expected}`);
if (emitted.runtime?.modelPromotion?.status !== 'browser-governed-model-active') {
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
    finalExecutableEdge: prior.finalExecutableEdge ?? g.finalExecutableEdge ?? null
  };
});

const candidate = {
  ...oldBoard,
  games: mergedGames,
  scheduleCoverage: {
    ...(oldBoard.scheduleCoverage || {}),
    completeSlate: true,
    slateCount: expected,
    renderedSlateCount: emitted.renderedRows,
    runtimeSource: 'Server-side exact FBS-vs-FBS hydration + production governed model capture',
    scheduleHydration: 'SERVER-SIDE COMPLETE — browser ESPN dependency removed',
    scheduleHydrationError: null,
    note: `Canonical Week ${week} runtime persists all ${expected} selected games and governed production model emissions.`
  },
  modelStatus: {
    ...(oldBoard.modelStatus || {}),
    productionFairRecompute: 'ACTIVE — governed portal runtime emission persisted',
    reason: 'The exact selected-week schedule is hydrated server-side and supplied to the canonical production loader before model synchronization. No market-derived fair is manufactured.',
    independentFootball: 'ACTIVE when genuinely emitted by Independent Composite v2.2; values are persisted exactly from the portal engine.',
    finalExecutableEdge: 'Remains null unless Bet Activation Gate v1.1 has exact executable book/line/juice and all veto checks are satisfied.'
  },
  runtimePersistence: {
    status: 'ACTIVE',
    source: portal,
    hydration: 'server-side exact FBS-vs-FBS',
    promotedGameCount: emitted.runtime.modelPromotion.promotedGameCount,
    independentGameCount: emitted.runtime.modelPromotion.independentGameCount,
    renderedRowCount: emitted.renderedRows,
    renderedFairCellCount: emitted.renderedFairCells,
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
console.log(`Persisted ${mergedGames.length} games; rendered=${emitted.renderedRows}; fair cells=${emitted.renderedFairCells}; production fairs=${emitted.runtime.modelPromotion.promotedGameCount}; independent=${emitted.runtime.modelPromotion.independentGameCount}.`);
