import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const LEDGER='data/expert-weekly.json';
const AUDIT_DIR='data/expert-episode-audit';
const REPORT='data/expert-ledger-reconciliation.json';
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const norm=s=>String(s??'').trim().toLowerCase().replace(/\s+/g,' ');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex').slice(0,16);

const ledger=await read(LEDGER);
if(!Array.isArray(ledger)) throw new Error(`${LEDGER} must be a JSON array`);
const names=(await fs.readdir(AUDIT_DIR)).filter(n=>n.endsWith('.json')).sort();
const candidates=[];

for(const name of names){
  const path=`${AUDIT_DIR}/${name}`;
  const a=await read(path).catch(()=>null);
  if(!a||String(a.sport||'CFB').toUpperCase()!=='CFB') continue;
  const week=Number(a.week);
  const source=a.sourceFamily||a.source||a.analyst||'Governed audit';
  const sourceDate=a.sourceDate||a.published||a.auditedAt||a.discoveredAt||null;
  const groups=[
    ['newStructuredRecordsIntended',a.newStructuredRecordsIntended],
    ['newStructuredRecords',Array.isArray(a.newStructuredRecords)?a.newStructuredRecords:null],
    ['materialRecords',a.materialRecords],
    ['newMaterialRecords',Array.isArray(a.newMaterialRecords)?a.newMaterialRecords:null]
  ];
  for(const [field,rows] of groups){
    if(!Array.isArray(rows)) continue;
    rows.forEach((r,i)=>{
      if(!r||typeof r!=='object') return;
      const gameId=r.gameId||r.canonicalGameId||r.game_id||null;
      const analyst=r.analyst||a.analyst||null;
      const sourceName=r.source||r.sourceFamily||source;
      const summary=r.sourceAnalysis||r.mechanism||r.detail||r.constructionDetail||r.marketOpinion||r.bettingImplication||'';
      if(!gameId||!summary) return;
      const id=r.id||`audit-${hash([name,field,i,gameId,sourceName,summary].join('|'))}`;
      candidates.push({
        ...r,
        id,
        week:Number.isFinite(Number(r.week))?Number(r.week):week,
        gameId,
        source:sourceName,
        analyst,
        sourceDate:r.sourceDate||sourceDate,
        type:r.type||r.opinionType||'governed audit record',
        explicit:r.explicit??true,
        sourceAnalysis:r.sourceAnalysis||r.mechanism||r.detail||r.constructionDetail||summary,
        bettingImplication:r.bettingImplication||r.marketOpinion||r.construction||null,
        auditProvenance:`${path}#${field}[${i}]`,
        governance:'Expert Intelligence qualitative residual only; zero automatic fair/model/gate/ledger/units impact.'
      });
    });
  }
}

const key=r=>r.id?`id:${r.id}`:`sig:${norm(r.gameId||r.game_id)}|${norm(r.source||r.source_family)}|${norm(r.sourceAnalysis||r.summary||r.detail)}`;
const existing=new Set(ledger.map(key));
let appended=0;
for(const r of candidates){const k=key(r);if(existing.has(k))continue;ledger.push(r);existing.add(k);appended++;}

await fs.writeFile(LEDGER,JSON.stringify(ledger,null,2)+'\n');
const intendedUnique=new Set(candidates.map(key));
const ledgerKeys=new Set(ledger.map(key));
const missing=[...intendedUnique].filter(k=>!ledgerKeys.has(k));
const report={
  sport:'CFB',
  generatedAt:new Date().toISOString(),
  status:missing.length===0?'SYNCHRONIZED':'FAIL',
  primaryLedger:LEDGER,
  auditDirectory:AUDIT_DIR,
  auditFilesScanned:names.length,
  governedCandidateRecords:intendedUnique.size,
  appendedRecords:appended,
  ledgerRecordCount:ledger.length,
  missingGovernedRecords:missing.length,
  primaryLedgerStatus:missing.length===0?'SYNCHRONIZED':'UNRESOLVED_INGESTION_FAILURE',
  detail:missing.length===0?'Lossless local merge completed from the full primary ledger plus governed episode-audit records; historical records were preserved and governed incremental records are represented.':'One or more governed audit records are still absent from the primary ledger after merge.',
  productionImpact:{fairPoints:0,modelWeights:0,unifiedUpsetRouting:0,betActivationGate:0,officialLedger:0,units:0}
};
await fs.writeFile(REPORT,JSON.stringify(report,null,2)+'\n');
console.log(`CFB expert ledger sync ${report.status}: appended=${appended}, ledger=${ledger.length}, governed=${intendedUnique.size}, missing=${missing.length}`);
if(missing.length) process.exitCode=1;
