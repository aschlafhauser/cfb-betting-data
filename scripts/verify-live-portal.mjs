// Verify the real production portal after the persisted runtime board has been pushed.
// No request interception is used here: this is the same Netlify -> raw GitHub runtime
// path a normal user receives.
import { chromium } from 'playwright';

const portal = process.env.CFB_PORTAL_URL || 'https://cfb-betting-intelligence.netlify.app/';
const expected = Number(process.env.CFB_EXPECTED_GAMES || 86);
const minFairCells = Number(process.env.CFB_MIN_FAIR_CELLS || expected);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', msg => {
  if (['error','warning'].includes(msg.type())) console.log(`[browser:${msg.type()}] ${msg.text()}`);
});
page.on('pageerror', err => console.error(`[browser:pageerror] ${err.message}`));

let finalDiag = null;
for (let attempt = 1; attempt <= 6; attempt++) {
  await page.goto(`${portal}?verify=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  try {
    await page.waitForFunction(({ expected, minFairCells }) => {
      const src = window.CFB_WEEKLY_BOARD_2026;
      const rows = Array.from(document.querySelectorAll('#scheduleRows tr'));
      const fairCells = rows.filter(r => {
        const text = r.children?.[5]?.textContent?.trim() || '';
        return text && !/pending|—/i.test(text);
      }).length;
      return Array.isArray(src?.games) && src.games.length === expected && rows.length === expected && fairCells >= minFairCells;
    }, { expected, minFairCells }, { timeout: 15000 });
  } catch (e) {}

  finalDiag = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#scheduleRows tr'));
    const fairCells = rows.filter(r => {
      const text = r.children?.[5]?.textContent?.trim() || '';
      return text && !/pending|—/i.test(text);
    }).length;
    const modelCells = rows.slice(0, 5).map(r => ({
      game: r.children?.[1]?.textContent?.trim() || '',
      fair: r.children?.[5]?.textContent?.trim() || '',
      edge: r.children?.[6]?.textContent?.trim() || ''
    }));
    return {
      runtimeStatus: window.CFB_RUNTIME_DATA?.status || null,
      loadedFiles: window.CFB_RUNTIME_DATA?.loaded || [],
      failedFiles: window.CFB_RUNTIME_DATA?.failed || [],
      modelPromotion: window.CFB_RUNTIME_DATA?.modelPromotion || null,
      sourceGames: window.CFB_WEEKLY_BOARD_2026?.games?.length || 0,
      scheduleCoverage: window.CFB_WEEKLY_BOARD_2026?.scheduleCoverage || null,
      renderedRows: rows.length,
      fairCells,
      sample: modelCells
    };
  });

  console.log(`Live verification attempt ${attempt}: ${JSON.stringify(finalDiag)}`);
  if (finalDiag.sourceGames === expected && finalDiag.renderedRows === expected && finalDiag.fairCells >= minFairCells) {
    await browser.close();
    console.log(`LIVE PORTAL VERIFIED: ${expected}/${expected} rows; ${finalDiag.fairCells} populated fair cells.`);
    process.exit(0);
  }
  await page.waitForTimeout(5000);
}

await browser.close();
throw new Error(`Live production portal verification failed: ${JSON.stringify(finalDiag)}`);
