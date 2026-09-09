// Verify the real production portal after the persisted runtime board has been pushed.
// No request interception is used here: this is the same Netlify -> raw GitHub runtime
// path a normal user receives. Placeholder Pick/0.0 outputs explicitly fail validation.
import { chromium } from 'playwright';

const portal = process.env.CFB_PORTAL_URL || 'https://cfb-betting-intelligence.netlify.app/';
const expected = Number(process.env.CFB_EXPECTED_GAMES || 86);
const minMeaningfulModels = Number(process.env.CFB_MIN_MEANINGFUL_MODELS || 40);
const minMarketGames = Number(process.env.CFB_MIN_MARKET_GAMES || 60);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', msg => {
  if (['error','warning'].includes(msg.type())) console.log(`[browser:${msg.type()}] ${msg.text()}`);
});
page.on('pageerror', err => console.error(`[browser:pageerror] ${err.message}`));

function good(diag){
  return diag.sourceGames===expected && diag.renderedRows===expected &&
    diag.meaningfulModelCells>=minMeaningfulModels && diag.marketGames>=minMarketGames &&
    diag.placeholderPickCells===0 && diag.zeroModelTotalCells===0 &&
    Number(diag.modelPromotion?.rejectedFallbackCount||0)>=0;
}

let finalDiag = null;
for (let attempt = 1; attempt <= 6; attempt++) {
  await page.goto(`${portal}?verify=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  try {
    await page.waitForFunction(({ expected, minMeaningfulModels, minMarketGames }) => {
      const src=window.CFB_WEEKLY_BOARD_2026;
      const rows=Array.from(document.querySelectorAll('#scheduleRows tr'));
      const meaningful=rows.filter(r=>{
        const t=r.children?.[5]?.textContent?.trim()||'';
        return t&&!/pending|—/i.test(t)&&!/^Pick(?:power|\s|$)/i.test(t);
      }).length;
      const markets=rows.filter(r=>{
        const s=r.children?.[3]?.textContent?.trim()||'',t=r.children?.[4]?.textContent?.trim()||'';
        return (s&&s!=='—')||(t&&t!=='—');
      }).length;
      const picks=rows.filter(r=>/^Pick(?:power|\s|$)/i.test(r.children?.[5]?.textContent?.trim()||'')).length;
      const zeroTotals=rows.filter(r=>/^0\.0(?:pre-weather|\s|$)/i.test(r.children?.[10]?.textContent?.trim()||'')).length;
      return Array.isArray(src?.games)&&src.games.length===expected&&rows.length===expected&&meaningful>=minMeaningfulModels&&markets>=minMarketGames&&picks===0&&zeroTotals===0;
    }, { expected, minMeaningfulModels, minMarketGames }, { timeout: 15000 });
  } catch (e) {}

  finalDiag = await page.evaluate(() => {
    const rows=Array.from(document.querySelectorAll('#scheduleRows tr'));
    const meaningfulModelCells=rows.filter(r=>{
      const t=r.children?.[5]?.textContent?.trim()||'';
      return t&&!/pending|—/i.test(t)&&!/^Pick(?:power|\s|$)/i.test(t);
    }).length;
    const placeholderPickCells=rows.filter(r=>/^Pick(?:power|\s|$)/i.test(r.children?.[5]?.textContent?.trim()||'')).length;
    const zeroModelTotalCells=rows.filter(r=>/^0\.0(?:pre-weather|\s|$)/i.test(r.children?.[10]?.textContent?.trim()||'')).length;
    const marketGames=rows.filter(r=>{
      const s=r.children?.[3]?.textContent?.trim()||'',t=r.children?.[4]?.textContent?.trim()||'';
      return (s&&s!=='—')||(t&&t!=='—');
    }).length;
    const sample=rows.slice(0,8).map(r=>({
      game:r.children?.[1]?.textContent?.trim()||'',market:r.children?.[3]?.textContent?.trim()||'',total:r.children?.[4]?.textContent?.trim()||'',fair:r.children?.[5]?.textContent?.trim()||'',modelTotal:r.children?.[10]?.textContent?.trim()||''
    }));
    return {
      runtimeStatus:window.CFB_RUNTIME_DATA?.status||null,
      loadedFiles:window.CFB_RUNTIME_DATA?.loaded||[],
      failedFiles:window.CFB_RUNTIME_DATA?.failed||[],
      modelPromotion:window.CFB_RUNTIME_DATA?.modelPromotion||null,
      sourceGames:window.CFB_WEEKLY_BOARD_2026?.games?.length||0,
      scheduleCoverage:window.CFB_WEEKLY_BOARD_2026?.scheduleCoverage||null,
      renderedRows:rows.length,
      marketGames,meaningfulModelCells,placeholderPickCells,zeroModelTotalCells,sample
    };
  });

  console.log(`Live verification attempt ${attempt}: ${JSON.stringify(finalDiag)}`);
  if(good(finalDiag)){
    await browser.close();
    console.log(`LIVE PORTAL VERIFIED: ${expected}/${expected} rows; markets=${finalDiag.marketGames}; meaningful models=${finalDiag.meaningfulModelCells}; placeholder Pick=${finalDiag.placeholderPickCells}; zero totals=${finalDiag.zeroModelTotalCells}.`);
    process.exit(0);
  }
  await page.waitForTimeout(5000);
}

await browser.close();
throw new Error(`Live production portal verification failed meaningful-data gate: ${JSON.stringify(finalDiag)}`);
