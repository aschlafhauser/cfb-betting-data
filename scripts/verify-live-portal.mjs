// Verify production as a decision system, not merely as a rendered table.
import { chromium } from 'playwright';
const portal=process.env.CFB_PORTAL_URL||'https://cfb-betting-intelligence.netlify.app/';
const expected=Number(process.env.CFB_EXPECTED_GAMES||86),minModels=Number(process.env.CFB_MIN_MEANINGFUL_MODELS||40),minMarkets=Number(process.env.CFB_MIN_MARKET_GAMES||60);
const browser=await chromium.launch({headless:true}),page=await browser.newPage();let diag=null;
let browserErrors=[];
page.on('pageerror',err=>browserErrors.push(String(err?.message||err)));
for(let attempt=1;attempt<=8;attempt++){
 browserErrors=[];
 await page.goto(`${portal}?verify=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:120000});
 try{await page.waitForFunction(n=>Array.isArray(window.CFB_WEEKLY_BOARD_2026?.games)&&window.CFB_WEEKLY_BOARD_2026.games.length===n&&Array.isArray(window.CFB_DEEP_DIVES_CURRENT?.dossiers)&&window.CFB_DEEP_DIVES_CURRENT.dossiers.length===n&&window.CFB_MARKET_MOVERS_CURRENT&&window.CFB_WEEKLY_MANIFEST_CURRENT&&window.CFB_LONGSHOT_UPSET_LAB_2026&&window.CFB_UNDERDOG_SPECIAL_2026,n,{timeout:12000})}catch{}
 try{await page.waitForFunction(()=>typeof window.renderLongshotUpsetLab==='function'&&typeof window.renderUnderdogSpecial==='function',{timeout:8000})}catch{}
 await page.waitForTimeout(1500);
 for(const tab of ['match','longshots','underdog']){try{await page.locator(`nav button[data-tab="${tab}"]`).click({timeout:3000});await page.waitForTimeout(150)}catch{}}
 diag=await page.evaluate(()=>{
  const rows=Array.from(document.querySelectorAll('#scheduleRows tr')),games=window.CFB_WEEKLY_BOARD_2026?.games||[];
  const legacyGames=(()=>{try{return Object.values(window.weeks||weeks||{}).flatMap(w=>w?.games||[])}catch{return[]}})();
  const legacyById=new Map(legacyGames.map(g=>[String(g.id||g.gameId||''),g]));
  const pickRows=[];
  const isLegitPick=r=>{
    const text=r.children?.[5]?.textContent?.trim()||'';
    if(!/^Pick(?:power|\s|$)/i.test(text))return false;
    const id=String(r.dataset?.gameId||'');
    const x=legacyById.get(id);
    const c=x?.modelComponents||{};
    const evidence=[c.base,c.power,c.units].filter(Number.isFinite);
    const hasModelEvidence=Boolean(x?._curatedFair)||evidence.some(v=>Math.abs(Number(v))>0.0001);
    pickRows.push({gameId:id,game:x?.game||null,fair:x?.fair||null,curatedFair:x?._curatedFair||null,modelComponents:c,legitimate:hasModelEvidence});
    return hasModelEvidence;
  };
  const meaningful=rows.filter(r=>{const t=r.children?.[5]?.textContent?.trim()||'';if(!t||/pending|—/i.test(t))return false;if(/^Pick(?:power|\s|$)/i.test(t))return isLegitPick(r);return true}).length;
  const markets=rows.filter(r=>{const s=r.children?.[3]?.textContent?.trim()||'',t=r.children?.[4]?.textContent?.trim()||'';return(s&&s!=='—')||(t&&t!=='—')}).length;
  const picks=rows.filter(r=>/^Pick(?:power|\s|$)/i.test(r.children?.[5]?.textContent?.trim()||'')).length;
  // Ensure every Pick row is audited even if meaningful() already evaluated it.
  for(const r of rows){const t=r.children?.[5]?.textContent?.trim()||'';if(/^Pick(?:power|\s|$)/i.test(t)&&!pickRows.some(x=>x.gameId===String(r.dataset?.gameId||'')))isLegitPick(r)}
  const fakePicks=pickRows.filter(x=>!x.legitimate).length;
  const deepDiveComplete=games.filter(g=>['COMPLETE','COMPLETE-SOURCE-LIMITED'].includes(g.deepDiveStatus)&&Number(g.deepDiveEvidenceCount)>0).length;
  const falseDeepDive=games.filter(g=>/deep-dive-complete/i.test(g.stage||'')&&!(['COMPLETE','COMPLETE-SOURCE-LIMITED'].includes(g.deepDiveStatus)&&Number(g.deepDiveEvidenceCount)>0)).length;
  const integrity=document.getElementById('runtimeIntegrity')?.textContent?.trim()||'',dossiers=window.CFB_DEEP_DIVES_CURRENT?.dossiers||[],movers=window.CFB_MARKET_MOVERS_CURRENT?.movers||[];
  let matchPanel=false;try{const s=document.getElementById('matchSel');if(s&&s.options.length){s.selectedIndex=0;s.dispatchEvent(new Event('change',{bubbles:true}));if(typeof window.renderMatch==='function')window.renderMatch();}}catch{}matchPanel=!!document.getElementById('governedDeepDivePanel');
  try{if(typeof window.renderLongshotUpsetLab==='function')window.renderLongshotUpsetLab()}catch{}
  try{if(typeof window.renderUnderdogSpecial==='function')window.renderUnderdogSpecial()}catch{}
  const longshotRuntime=(window.CFB_LONGSHOT_UPSET_LAB_2026?.candidates||[]).length;
  const longshotRendered=document.querySelectorAll('#lsCards .ls-candidate-card').length;
  const longshotComponents=document.querySelectorAll('#lsDetail .ls-score-component').length;
  const longshotNarrative=!!document.querySelector('#lsDetail .ls-upset-case')&&!!document.querySelector('#lsDetail .ls-fail-case')&&!!document.querySelector('#lsDetail .ls-watch-panel');
  const longshotScore25=/\/\s*25/.test(document.querySelector('#lsDetail .ls-total-score')?.textContent||'');
  const underdogData=window.CFB_UNDERDOG_SPECIAL_2026||{},underdogRuntime=(underdogData.candidates||underdogData.games||underdogData.items||[]).length,underdogSection=document.getElementById('underdog'),underdogRendered=underdogSection?underdogSection.querySelectorAll('.card,[data-candidate],tr').length:0;
  const longshotVisibleOk=longshotRuntime===0||(longshotRendered===longshotRuntime&&longshotComponents===9&&longshotNarrative&&longshotScore25);
  const underdogVisibleOk=underdogRuntime===0||underdogRendered>0;
  return{sourceGames:games.length,renderedRows:rows.length,meaningful,markets,picks,fakePicks,pickRows,deepDiveComplete,falseDeepDive,dossierCount:dossiers.length,moverCount:movers.length,integrity,matchPanel,longshotRuntime,longshotRendered,longshotComponents,longshotNarrative,longshotScore25,longshotVisibleOk,underdogRuntime,underdogRendered,underdogVisibleOk,runtime:window.CFB_RUNTIME_DATA||null};
 });
 diag.browserErrors=[...browserErrors];
 console.log(`Live verification attempt ${attempt}: ${JSON.stringify(diag)}`);
 const structural=diag.sourceGames===expected&&diag.renderedRows===expected&&diag.meaningful>=minModels&&diag.markets>=minMarkets&&diag.fakePicks===0&&diag.falseDeepDive===0;
 const decisionLayers=diag.dossierCount===expected&&diag.deepDiveComplete===expected&&diag.moverCount>0&&diag.matchPanel;
 // Current browser exceptions are authoritative. A previously persisted productionVerifier
 // failure may appear in stale manifest text during a recheck, but it cannot deadlock the
 // recheck itself. Any pageerror in this run still fails immediately.
 const specialty=browserErrors.length===0&&diag.longshotVisibleOk&&diag.underdogVisibleOk;
 if(structural&&decisionLayers&&specialty){await browser.close();console.log(`LIVE PORTAL VERIFIED: rows=${expected}; markets=${diag.markets}; meaningful models=${diag.meaningful}; legitimate Pick fairs=${diag.picks-diag.fakePicks}; fake Pick placeholders=${diag.fakePicks}; Deep Dives=${diag.deepDiveComplete}/${expected}; dossiers=${diag.dossierCount}; movers=${diag.moverCount}; Matchup Center=YES; Longshot ${diag.longshotRendered}/${diag.longshotRuntime}, selected detail 9 components, /25 score + narratives=YES; Underdog visible=${diag.underdogVisibleOk}; browserErrors=0.`);process.exit(0)}
 await page.waitForTimeout(4000);
}
await browser.close();throw new Error(`Live production verification failed decision-system gate: ${JSON.stringify(diag)}`);
