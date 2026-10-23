#!/usr/bin/env python3
"""Research replay using only saved pregame board components; not revised historical performance."""
import json,subprocess,statistics,datetime,pathlib
root=pathlib.Path(__file__).resolve().parents[1]
r=json.load(open(root/'data/season-performance-2026.json'))
cache={};rows=[]
def clip(v,a,b):return max(a,min(b,v))
def stats(rs,k):
 e=[x[k]-x['actual'] for x in rs];w=l=p=0
 for x in rs:
  edge=x[k]-x['market'];cover=(x['actual']-x['market'])*(1 if edge>0 else -1)
  if abs(edge)<1e-8:continue
  if cover>1e-8:w+=1
  elif cover< -1e-8:l+=1
  else:p+=1
 return {'n':len(e),'mae':round(statistics.mean(map(abs,e)),4) if e else None,'wins':w,'losses':l,'pushes':p,'atsPct':round(100*w/(w+l),2) if w+l else None}
for g in r['commonGames']:
 sha=g['sourceCommit']
 if sha not in cache:cache[sha]=json.loads(subprocess.check_output(['git','show',sha+':data/weekly-board.json'],cwd=root))
 old=next((x for x in cache[sha]['games'] if x['gameId']==g['gameId']),None)
 if not old:continue
 c=old.get('modelComponents') or {};ph=c.get('philInseason') or {}
 if not all(isinstance(c.get(k),(int,float)) for k in ('power','units')):continue
 pre=g['marketMargin']+c['power']+c['units']
 pa=clip((ph['powerMargin']-pre)*.30,-2,2) if isinstance(ph.get('powerMargin'),(int,float)) else 0
 adjustment=clip(pa+(ph.get('profileAdj') or 0)+(ph.get('matchupAdj') or 0),-.85,.85)
 fixed=pre+adjustment;ind=g['models']['independent'];market=g['marketMargin']
 agree=(fixed-market)*(ind-market)>0 and abs(fixed-market)>=.5 and abs(ind-market)>=.5
 wi=.60 if agree else .55
 rows.append({'gameId':g['gameId'],'week':g['week'],'away':g['away'],'home':g['home'],'market':market,'actual':g['result']['actualMargin'],'originalMarketModel':g['models']['market'],'originalEnsemble':g['models']['ensemble'],'correctedMarketAnchorCandidate':fixed,'correctedEnsembleCandidate':wi*ind+(1-wi)*fixed,'savedPowerResidual':c['power'],'savedUnitResidual':c['units'],'savedPhilProfileResidual':ph.get('profileAdj'),'savedPhilMatchupResidual':ph.get('matchupAdj'),'sourceCommit':sha})
parts={}
for label,test in [('all-recoverable',lambda x:True),('earlier-weeks-4-5',lambda x:x['week'] in [4,5]),('later-weeks-6-7',lambda x:x['week'] in [6,7]),('market-spread-21-plus',lambda x:abs(x['market'])>=21)]:
 rs=[x for x in rows if test(x)];parts[label]={k:stats(rs,k) for k in ['market','originalMarketModel','originalEnsemble','correctedMarketAnchorCandidate','correctedEnsembleCandidate']}
out={'asOf':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourcePerformanceAsOf':r['asOf'],'purpose':'Calculation-integrity diagnosis and counterfactual research only. These candidate predictions were not issued before kickoff. Original season results remain unchanged.','method':'Use saved market, power and unit residuals, and Phil power/profile/matchup components from the same pregame board; replace recycled selected-output base with market anchor; apply existing 0.30 power residual, 2-point component cap, 0.85 combined Phil cap and 55/60% Independent ensemble weight. No coefficient fitted or future ratings used.','limitations':['A historical counterfactual is not a prospective validation or official betting record.','Separate conservative Independent rating scales remain unchanged and unvalidated.','Missing comparable numeric FPI/Phil inputs are withheld prospectively, never filled with zero.'],'segments':parts,'games':rows}
(root/'data/model-input-diagnosis-2026.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(parts,indent=2))
