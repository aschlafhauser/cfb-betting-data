// Persist governed portal emissions into the public runtime repository.
// Week 2 schedule hydration runs server-side to avoid ESPN browser CORS. The exact
// groups=80 selected-week feed is supplied to the portal's canonical runtime loader
// from its first weekly-board.json request, eliminating the prior 14-game overwrite race.
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const portal = process.env.CFB_PORTAL_URL || 'https://cfb-betting-intelligence.netlify.app/';
const boardPath = 'data/weekly-board.json';
const oldBoard = JSON.parse(await fs.readFile(boardPath, 'utf8'));
const week = Number(oldBoard.week || 2);
const season = 2026;
const expected = Number(oldBoard.scheduleCoverage?.slateCount || 86);
const scheduleUrl = `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${season}&seasontype=2&week=${week}&limit=200&groups=80`;

const norm = x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const key = g => `${norm(g.away)}__${norm(g.home)}`;
const teamLabel = c => c?.team?.location || c?.team?.shortDisplayName || c?.team?.displayName || c?.team?.name || null;
const mlText = v => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n > 0 ? `+${n}` : String(n);
};
function spreadFromOdds(odds, away, home, awayLabel, homeLabel) {
  const details = String(odds?.details || '').trim();
  if (!details) return null;
  const m = details.match(/^([^\s]+)\s+(-?\d+(?:\.\d+)?)/);
  if (!m) return details;
  const token = m[1].toUpperCase();
  const line = m[2];
  const awayAbbr = String(away?.team?.abbreviation || '').toUpperCase();
  const homeAbbr = String(home?.team?.abbreviation || '').toUpperCase();
  if (token === awayAbbr) return `${awayLabel} ${line}`;
  if (token === homeAbbr) return `${homeLabel} ${line}`;
  return details;
}

function scheduleRow(ev) {
  const comp = ev?.competitions?.[0] || {};
  const cs = comp.competitors || [];
  const away = cs.find(c => c.homeAway === 'away');
  const home = cs.find(c => c.homeAway === 'home');
  if (!away || !home) return null;
  const awayLabel = teamLabel(away) || 'Away';
  const homeLabel = teamLabel(home) || 'Home';
  const broadcasts = (comp.broadcasts || []).flatMap(b => b.names || []);
  const odds = Array.isArray(comp.odds) ? comp.odds[0] : null;
  const awayMl = mlText(odds?.awayTeamOdds?.moneyLine);
  const homeMl = mlText(odds?.homeTeamOdds?.moneyLine);
  const overUnder = Number(odds?.overUnder);
  return {
    gameId: `ESPN-${ev.id}`,
    dateTime: ev.date || comp.date || null,
    away: awayLabel,
    home: homeLabel,
    neutral: !!comp.neutralSite,
    tv: broadcasts[0] || null,
    currentSpread: spreadFromOdds(odds, away, home, awayLabel, homeLabel),
    currentTotal: Number.isFinite(overUnder) && overUnder > 0 ? overUnder : null,
    currentMoneyline: awayMl || homeMl ? `${awayLabel} ${awayMl || '—'} / ${homeLabel} ${homeMl || '—'}` : null,
    marketSource: odds?.provider?.name ? `ESPN ${odds.provider.name}` : (odds ? 'ESPN odds feed' : null),
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
    informationQuality: odds ? 'market-available' : 'source-limited',
    thresholdStatus: odds ? 'DEEP DIVE COMPLETE · MARKET AVAILABLE' : 'DEEP DIVE COMPLETE · MARKET/EXECUTION PENDING',
    action: 'PASS until governed edge and execution gate clear',
    notes: 'Universal Week 2 selected-slate row. Model outputs populate only when genuinely emitted by the governed production engine.'
  };
}

async function buildFullSlate() {
  const response = await fetch(scheduleUrl, {
    headers: { 'accept': 'application/json,text/plain,*/*', 'user-agent': 'cfb-governed-runtime-capture/1.0' }
  });
  if (!response.ok) throw new Error(`ESPN schedule fetch failed: HTTP ${response.status}`);
  const json = await response.json();
  const schedule = (json.events || []).map(scheduleRow).filter(Boolean);
  console.log(`ESPN groups=80 selected-week events=${schedule.length}; expected=${expected}.`);
  if (schedule.length !== expected) throw new Error(`Canonical selected-week slate mismatch: ${schedule.length}/${expected}`);

  const overlayByKey = new Map((oldBoard.games || []).map(g => [key(g), g]));
  const overlayById = new Map((oldBoard.games || []).filter(g => g.gameId).map(g => [String(g.gameId), g]));
  const games = schedule.map(g => {
    const prior = overlayById.get(String(g.gameId)) || overlayByKey.get(key(g));
    const merged = prior ? { ...prior, ...g, priority: prior.priority || g.priority, stage: prior.stage || g.stage } : g;
    // Never carry a previous browser fallback model emission forward as source data.
    merged.modelSpread = null;
    merged.modelTotal = null;
    merged.modelEdgeMagnitude = null;
    merged.independentFootballFair = null;
    merged.independentFootballHomeMargin = null;
    merged.independentFootballEdge = null;
    merged.independentFootballSide = null;
    merged.independentFootballConfidence = null;
    return merged;
  }).sort((a, b) => new Date(a.dateTime || 0) - new Date(b.dateTime || 0));

  const marketCount = games.filter(g => g.currentSpread || Number.isFinite(g.currentTotal)).length;
  console.log(`Canonical identity normalized; ESPN market coverage=${marketCount}/${games.length}.`);

  return {
    ...oldBoard,
    games,
    scheduleCoverage: {
      ...(oldBoard.scheduleCoverage || {}),
      completeSlate: true,
      slateCount: expected,
      renderedSlateCount: expected,
      runtimeSource: 'GitHub Node ESPN groups=80 selected-week schedule + governed overlay',
      scheduleHydration: 'SERVER-SIDE COMPLETE — canonical model team names + ESPN market fields',
      scheduleHydrationError: null,
      marketGameCount: marketCount
    }
  };
}

const hydratedBoard = await buildFullSlate();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', msg => console.log(`[browser:${msg.type()}] ${msg.text()}`));
page.on('pageerror', err => console.error(`[browser:pageerror] ${err.message}`));

// Force the canonical runtime loader to receive the full slate on its first fetch.
await page.route('**/weekly-board.json*', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(hydratedBoard)
}));

await page.goto(portal, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.CFB_RUNTIME_DATA && ['remote-active','local-fallback'].includes(window.CFB_RUNTIME_DATA.status), null, { timeout: 60000 });

try {
  await page.waitForFunction(expectedCount => {
    const src = window.CFB_WEEKLY_BOARD_2026;
    const rt = window.CFB_RUNTIME_DATA;
    const rows = document.querySelectorAll('#scheduleRows tr').length;
    return Array.isArray(src?.games) && src.games.length === expectedCount && rows === expectedCount &&
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

await page.evaluate(() => {
  try { if (typeof window.CFB_RUNTIME_PROMOTE_GOVERNED_MODEL_OUTPUTS === 'function') window.CFB_RUNTIME_PROMOTE_GOVERNED_MODEL_OUTPUTS(); } catch (e) {}
  try { if (typeof window.renderBoard === 'function') window.renderBoard(); } catch (e) {}
});
await page.waitForTimeout(500);

const emitted = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('#scheduleRows tr'));
  const meaningfulFairCells = rows.filter(r => {
    const text = r.children?.[5]?.textContent?.trim() || '';
    return text && !/pending|—/i.test(text) && !/^Pick(?:power|\s|$)/i.test(text);
  }).length;
  const marketCells = rows.filter(r => {
    const spread = r.children?.[3]?.textContent?.trim() || '';
    const total = r.children?.[4]?.textContent?.trim() || '';
    return (spread && spread !== '—') || (total && total !== '—');
  }).length;
  return JSON.parse(JSON.stringify({
    board: window.CFB_WEEKLY_BOARD_2026,
    runtime: window.CFB_RUNTIME_DATA,
    renderedRows: rows.length,
    meaningfulFairCells,
    marketCells
  }));
});
await browser.close();

if (Number(emitted.board?.week) !== week) throw new Error(`Runtime week mismatch: portal=${emitted.board?.week} repo=${week}`);
if (emitted.board.games.length !== expected) throw new Error(`Universal runtime coverage incomplete: ${emitted.board.games.length}/${expected}`);
if (emitted.renderedRows !== expected) throw new Error(`Rendered Weekly Board incomplete: ${emitted.renderedRows}/${expected}`);
if (emitted.runtime?.modelPromotion?.status !== 'browser-governed-model-active') throw new Error('Governed model promotion inactive');

const oldByKey = new Map((oldBoard.games || []).map(g => [key(g), g]));
const mergedGames = emitted.board.games.map(g => {
  const prior = oldByKey.get(key(g)) || {};
  return {
    ...prior,
    ...g,
    modelSpread: g.modelSpread ?? null,
    modelTotal: Number.isFinite(g.modelTotal) && g.modelTotal > 0 ? g.modelTotal : null,
    modelEdgeMagnitude: Number.isFinite(g.modelEdgeMagnitude) ? g.modelEdgeMagnitude : null,
    independentFootballFair: g.independentFootballFair ?? null,
    independentFootballHomeMargin: Number.isFinite(g.independentFootballHomeMargin) ? g.independentFootballHomeMargin : null,
    independentFootballEdge: Number.isFinite(g.independentFootballEdge) ? g.independentFootballEdge : null,
    independentFootballSide: g.independentFootballSide ?? null,
    independentFootballConfidence: g.independentFootballConfidence ?? null,
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
    runtimeSource: 'Server-side exact selected-week hydration + production governed model capture',
    scheduleHydration: 'SERVER-SIDE COMPLETE — canonical model team names + ESPN market fields',
    scheduleHydrationError: null,
    marketGameCount: emitted.marketCells,
    note: `Canonical Week ${week} runtime persists all ${expected} selected games; placeholder model outputs are not treated as valid coverage.`
  },
  modelStatus: {
    ...(oldBoard.modelStatus || {}),
    productionFairRecompute: 'ACTIVE — source-valid governed portal emissions only',
    reason: 'Canonical team identity is aligned to model inputs. Zero-information Pick/0.0 fallbacks are rejected rather than persisted.',
    independentFootball: 'ACTIVE only when genuinely emitted with source coverage by Independent Composite v2.2.',
    finalExecutableEdge: 'Remains null unless Bet Activation Gate v1.1 has exact executable book/line/juice and all veto checks are satisfied.'
  },
  runtimePersistence: {
    status: 'ACTIVE',
    source: portal,
    hydration: 'server-side exact selected-week feed',
    promotedGameCount: emitted.runtime.modelPromotion.promotedGameCount,
    independentGameCount: emitted.runtime.modelPromotion.independentGameCount,
    renderedRowCount: emitted.renderedRows,
    meaningfulFairCellCount: emitted.meaningfulFairCells,
    marketCellCount: emitted.marketCells,
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
console.log(`Persisted ${mergedGames.length} games; rendered=${emitted.renderedRows}; markets=${emitted.marketCells}; meaningful fairs=${emitted.meaningfulFairCells}; production=${emitted.runtime.modelPromotion.promotedGameCount}; independent=${emitted.runtime.modelPromotion.independentGameCount}.`);
