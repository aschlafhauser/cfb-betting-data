// Verify production as a decision system, not merely as a rendered table.
import { chromium } from 'playwright';
const portal=process.env.CFB_PORTAL_URL||'https://cfb-betting-intelligence.netlify.app/';
const expected=Number(process.env.CFB_EXPECTED_GAMES||86),minModels=Number(process.env.CFB_MIN_MEANINGFUL_MODELS||40),minMarkets=Number(process.env.CFB_MIN_MARKET_GAMES||60);
const browser=await chromium.launch({headless:true}),page=await browser.newPage();
let diag=null;
for(let attempt=1;attempt<=8;attempt++){
 await page.goto(`${portal}?verify=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:120000});
 try{await page.waitForFunction(n=>Array.isArray(window.CFB_WEEKLY_BOARD_2026?.games)&&window.CFB_WEEKLY_BOARD_2026.games.length===n&&Array.isArray(window.CFB_DEEP_DIVES_CURRENT?.dossiers)&&window.CFB_DEEP_DIVES_CURRENT.dossiers.length===n&&window.CFB_MARKET_MOVERS_CURRENT&&window.CFB_WEEKLY_MANIFEST_CURRENT,n,{timeout:12000})}catch{}
 await page.waitForTimeout(1500);
 diag=await page.evaluate(()=>{const rows=Array.from(document.querySelectorAll('#scheduleRows tr')),games=window.CFB_WEEKLY_BOARD_2026?.games||[],meaningful=rows.filter(r=>{const t=r.children?.[5]?.textContent?.trim()||'';return t&&!/pending|—/i.test(t)&&!/^Pick(?:power|\s|$)/i.test(t)}).length,markets=rows.filter(r=>{const s=r.children?.[3]?.textContent?.trim()||'',t=r.children?.[4]?.textContent?.trim()||'';return(s&&s!=='—')||(t&&t!=='—')}).length,picks=rows.filter(r=>/^Pick(?:power|\s|$)/i.test(r.children?.[5]?.textContent?.trim()||'')).length,deepDiveComplete=games.filter(g=>['COMPLETE','COMPLETE-SOURCE-LIMITED'].includes(g.deepDiveStatus)&&Number(g.deepDiveEvidenceCount)>0).length,falseDeepDive=games.filter(g=>/deep-dive-complete/i.test(g.stage||'')&&!(['COMPLETE','COMPLETE-SOURCE-LIMITED'].includes(g.deepDiveStatus)&&Number(g.deepDiveEvidenceCount)>0)).length,integrity=document.getElementById('runtimeIntegrity')?.textContent?.trim()||'',manifest=document.getElementById('weeklyManifestStrip')?.textContent?.trim()||'',dossiers=window.CFB_DEEP_DIVES_CURRENT?.dossiers||[],movers=window.CFB_MARKET_MOVERS_CURRENT?.movers||[];let matchPanel=false;try{const s=document.getElementById('matchSel');if(s&&s.options.length){s.selectedIndex=0;s.dispatchEvent(new Event('change',{bubbles:true}))}}catch{}matchPanel=!!document.getElementById('governedDeepDivePanel');return{sourceGames:games.length,renderedRows:rows.length,meaningful,markets,picks,deepDiveComplete,falseDeepDive,dossierCount:dossiers.length,moverCount:movers.length,integrity,manifest,matchPanel,runtime:window.CFB_RUNTIME_DATA||null}});
 console.log(`Live verification attempt ${attempt}: ${JSON.stringify(diag)}`);
 const structural=diag.sourceGames===expected&&diag.renderedRows===expected&&diag.meaningful>=minModels&&diag.markets>=minMarkets&&diag.picks===0&&diag.falseDeepDive===0;
 const decisionLayers=diag.dossierCount===expected&&diag.deepDiveComplete===expected&&diag.moverCount>0&&diag.matchPanel;
 const specialty=!/Runtime integrity:\s*FAIL/i.test(diag.integrity);
 if(structural&&decisionLayers&&specialty){await browser.close();console.log(`LIVE PORTAL VERIFIED: rows=${expected}; markets=${diag.markets}; meaningful models=${diag.meaningful}; Deep Dives=${diag.deepDiveComplete}/${expected}; dossiers=${diag.dossierCount}; movers=${diag.moverCount}; Matchup Center governed panel=YES; specialty integrity PASS.`);process.exit(0)}
 await page.waitForTimeout(4000);
}
await browser.close();throw new Error(`Live production verification failed decision-system gate: ${JSON.stringify(diag)}`);
