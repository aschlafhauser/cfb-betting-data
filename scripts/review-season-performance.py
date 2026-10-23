#!/usr/bin/env python3
"""Audit saved predictions only; never rerun today's model on historical games."""
import argparse, collections, concurrent.futures, datetime as dt, hashlib, json, math, os, pathlib, re, statistics, subprocess, time, urllib.request

ROOT=pathlib.Path(__file__).resolve().parents[1]
UTC=dt.timezone.utc
MODELS=('market','independent','ensemble')
LABELS={'market':'Market-Calibrated','independent':'Football Independent','ensemble':'Ensemble'}
def stamp(s):
    try:return dt.datetime.fromisoformat(str(s).replace('Z','+00:00')).astimezone(UTC)
    except (ValueError,TypeError):return None
def iso(d):return d.isoformat().replace('+00:00','Z') if d else None
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT).decode()
def finite(v):return isinstance(v,(float,int)) and not isinstance(v,bool) and math.isfinite(v)
ALIASES={'cal':'california','miamifl':'miami','miamifla':'miami','miamiohio':'miamioh','pitt':'pittsburgh','olemiss':'mississippi','connecticut':'uconn','fiu':'floridainternational','fau':'floridaatlantic','usf':'southflorida','wku':'westernkentucky','appstate':'appalachianstate','appalachianst':'appalachianstate','louisianalafayette':'louisiana','ulmonroe':'louisianamonroe','lamonroe':'louisianamonroe','umass':'massachusetts','samhoustonstate':'samhouston','texassanelpaso':'utep','texassanantonio':'utsa','ncstate':'northcarolinastate','northcarolinaampt':'northcarolinaat'}
def key(s):
    s=re.sub('[^a-z0-9]','',str(s).lower().replace('&amp;','&'))
    return ALIASES.get(s,s)
def margin(text,away,home):
    if finite(text):return float(text)
    if not text:return None
    if re.match(r'^\s*(pick|pk|even)\b',str(text),re.I):return 0.
    m=re.match(r'^\s*(.+?)\s+([+-]?\d+(?:\.\d+)?)',str(text))
    if not m:return None
    team,line=key(m[1]),float(m[2])
    if team==key(home):return -line
    if team==key(away):return line
    return None
def read_json(p):
    try:return json.loads(pathlib.Path(p).read_text())
    except (OSError,ValueError):return None
def get_json(url,cache):
    if cache.exists():
        saved=read_json(cache);competition=((saved or {}).get('header',{}).get('competitions') or [{}])[0]
        if competition.get('status',{}).get('type',{}).get('completed') or time.time()-cache.stat().st_mtime<300:return saved
    error=None
    for attempt in range(3):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':'CFB-Performance-Audit/1.0'})
            with urllib.request.urlopen(req,timeout=22) as r:data=json.load(r)
            cache.parent.mkdir(parents=True,exist_ok=True);cache.write_text(json.dumps(data));return data
        except Exception as e:error=str(e)
    return {'fetchError':error,'url':url}
def extract_history(asof,cache):
    observations=[];inventory={};bad=collections.Counter()
    history=git('log','--format=%H|%cI','--','data/weekly-board.json').splitlines()
    for i,line in enumerate(history):
        sha,when=line.split('|');committed=stamp(when)
        if committed>asof:continue
        try:board=json.loads(git('show',sha+':data/weekly-board.json'))
        except (ValueError,subprocess.CalledProcessError):continue
        times=[committed,stamp(board.get('updatedAt')),stamp((board.get('runtimePersistence') or {}).get('capturedAt'))]
        recorded=max(x for x in times if x)
        for g in board.get('games',[]):
            gid=g.get('gameId') or g.get('canonicalGameId');away=g.get('away');home=g.get('home');kick=stamp(g.get('dateTime') or g.get('kickoff'))
            if not (gid and away and home and kick):continue
            ident={'gameId':gid,'away':away,'home':home,'week':g.get('week',board.get('week')),'kickoff':iso(kick),'neutral':bool(g.get('neutral'))}
            inventory.setdefault(gid,ident)
            mm=g.get('multiModel') or {};models={};conf={}
            for m in MODELS:
                v=mm.get(m) or {};p=v.get('homeMargin');fair=v.get('fair')
                if not finite(p):p=margin(fair,away,home)
                if p is not None:models[m]=float(p);conf[m]=v.get('confidence')
            for m,field in [('governed','modelSpread'),('independent','independentFootballFair'),('ensemble','ensembleFair')]:
                if m not in models:
                    p=margin(g.get(field),away,home)
                    if p is not None:models[m]=p
            if not models:continue
            inventory[gid]['everModeled']=True
            if recorded>=kick:bad['postKickoffBoardRows']+=1;continue
            if recorded>asof:continue
            if (kick-recorded).total_seconds()>7*86400:bad['olderThanSevenDaysBoardRows']+=1;continue
            if g.get('modelStatus') in ['pending','unavailable']:continue
            market=margin(g.get('currentSpread'),away,home)
            total=g.get('modelTotal');mt=g.get('currentTotal')
            observations.append({**ident,'recordedAt':iso(recorded),'source':'git-board','sourceCommit':sha,'sourcePath':'data/weekly-board.json','models':models,'confidence':conf,'marketMargin':market,'marketSpread':g.get('currentSpread'),'marketTotal':mt if finite(mt) else None,'modelTotal':total if finite(total) else None,'minutesBeforeKickoff':round((kick-recorded).total_seconds()/60,1),'action':g.get('action'),'informationQuality':g.get('informationQuality'),'selectedModel':g.get('selectedModel'),'philAdjustment':(g.get('modelComponents') or {}).get('philInseason',{}).get('adjustment')})
        if i%70==0:print(f'History {i+1}/{len(history)}; prospective observations {len(observations)}',flush=True)
    # Immutable files are additional evidence. Validate actual first publication, not just the claimed clock.
    paths=['data/model-snapshots.json']+[str(p.relative_to(ROOT)) for p in sorted((ROOT/'data/final-snapshots').glob('*.json'))]
    for path in paths:
        raw=read_json(ROOT/path)
        if not raw:continue
        if raw.get('snapshotType') not in (None,'frozen-pre-kickoff') and 'snapshots' not in raw:continue
        if 'audit' in path.lower() or 'postgame' in path.lower():continue
        sha=git('log','--diff-filter=A','--format=%H','--',path).strip().splitlines()
        if not sha:continue
        sha=sha[-1];published=stamp(git('show','-s','--format=%cI',sha).strip())
        group_publications={}
        if path=='data/model-snapshots.json':
            for entry in reversed(git('log','--format=%H|%cI','--',path).splitlines()):
                commit,when=entry.split('|')
                try:version=json.loads(git('show',commit+':'+path))
                except (ValueError,subprocess.CalledProcessError):continue
                if not isinstance(version,dict):continue
                for block in version.get('snapshots',[]):
                    for item in block.get('games',[]):
                        fingerprint=(item.get('gameId'),item.get('frozenAt') or block.get('frozenAt'),item.get('modelSpread'),item.get('modelTotal'))
                        group_publications.setdefault(fingerprint,(commit,stamp(when)))
        groups=raw.get('snapshots',[raw])
        for group in groups:
            for g in group.get('games',[group]):
                gid=g.get('gameId') or g.get('canonicalGameId');ident=inventory.get(gid,{})
                label=g.get('matchup') or g.get('game') or '';parts=re.split(r' at | vs ',label)
                away=g.get('away') or ident.get('away') or (parts[0] if len(parts)==2 else None)
                home=g.get('home') or ident.get('home') or (parts[1] if len(parts)==2 else None)
                kick=stamp(g.get('kickoff') or ident.get('kickoff'));frozen=stamp(g.get('frozenAt') or group.get('frozenAt'))
                if not (gid and away and home and kick and frozen):bad['snapshotMissingIdentityOrKickoff']+=1;continue
                publication=(sha,published)
                if group_publications:
                    fingerprint=(gid,g.get('frozenAt') or group.get('frozenAt'),g.get('modelSpread'),g.get('modelTotal'))
                    publication=group_publications.get(fingerprint)
                    if not publication:bad['snapshotPublicationUnverified']+=1;continue
                row_sha,row_published=publication
                recorded=max(frozen,row_published)
                if recorded>=kick:bad['snapshotPublishedAfterKickoff']+=1;continue
                if recorded>asof:continue
                ident={'gameId':gid,'away':away,'home':home,'week':g.get('week',group.get('week')),'kickoff':iso(kick),'neutral':bool(g.get('neutral',ident.get('neutral')))}
                mm=g.get('models') or {};models={}
                # The historical writer copied selected modelSpread into marketCalibratedFair.
                # Preserve that ambiguous forecast separately instead of mislabelling it as market.
                market_name='market' if g.get('schemaVersion')=='cfb-frozen-pre-kickoff-v2' else 'governed'
                for m,field in [(market_name,'marketCalibratedFair'),('independent','independentFair'),('ensemble','ensembleFair')]:
                    number_field={'market':'marketCalibratedHomeMargin','independent':'independentHomeMargin','ensemble':'ensembleHomeMargin'}.get(m)
                    p=mm.get(number_field) if number_field and finite(mm.get(number_field)) else margin(mm.get(field),away,home)
                    if p is not None:models[m]=p
                p=margin(g.get('modelSpread'),away,home)
                if p is not None and not mm:models['legacy']=p
                if not models:bad['snapshotWithoutPrediction']+=1;continue
                market=g.get('market') or {};ms=market.get('spread') or g.get('marketSpread')
                observations.append({**ident,'recordedAt':iso(recorded),'claimedFrozenAt':iso(frozen),'source':'immutable-snapshot','sourceCommit':row_sha,'sourcePath':path,'models':models,'confidence':{},'marketMargin':margin(ms,away,home),'marketSpread':ms,'marketTotal':market.get('total',g.get('marketTotal')),'modelTotal':g.get('modelTotal',mm.get('governedTotal')),'minutesBeforeKickoff':round((kick-recorded).total_seconds()/60,1)})
                inventory.setdefault(gid,ident)['everModeled']=True
    cache.mkdir(parents=True,exist_ok=True)
    (cache/'observations.json').write_text(json.dumps(observations))
    (cache/'inventory.json').write_text(json.dumps(inventory))
    (cache/'extraction.json').write_text(json.dumps({'historyCommits':len(history),'exclusions':dict(bad)}))
    return observations,inventory

def fetch_results(inventory,cache,asof):
    existing={r.get('gameId'):r for r in (read_json(ROOT/'data/results-2026.json') or [])}
    def one(item):
        gid,ident=item
        match=re.fullmatch(r'ESPN-(\d+)',gid)
        if not match or stamp(ident['kickoff'])>=asof:return gid,None
        saved=existing.get(gid)
        if saved and finite(saved.get('homeScore')) and finite(saved.get('awayScore')):
            hs=saved['homeScore'];aws=saved['awayScore']
            return gid,{'status':'final','gameId':gid,'home':ident['home'],'away':ident['away'],'homeScore':hs,'awayScore':aws,'actualMargin':hs-aws,'actualTotal':hs+aws,'source':saved.get('source'),'retrievedAt':saved.get('resultObservedAt'),'sourceType':'persisted-verified-final'}
        eid=match[1];url=f'https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event={eid}'
        raw=get_json(url,cache/'espn'/f'{eid}.json')
        c=(raw.get('header',{}).get('competitions') or [{}])[0]
        if not c.get('status',{}).get('type',{}).get('completed'):return gid,{'status':'unresolved','fetchError':raw.get('fetchError'),'source':url}
        teams={r.get('homeAway'):r for r in c.get('competitors',[])}
        try:
            home=teams['home'];away=teams['away'];hs=int(home['score']);aws=int(away['score'])
        except (KeyError,ValueError,TypeError):return gid,{'status':'unresolved','source':url}
        # IDs alone are insufficient if the historical board accidentally attached the wrong game.
        hn=home.get('team',{}).get('location') or home.get('team',{}).get('shortDisplayName');an=away.get('team',{}).get('location') or away.get('team',{}).get('shortDisplayName')
        if key(hn)!=key(ident['home']) or key(an)!=key(ident['away']):
            return gid,{'status':'identity-mismatch','source':url,'sourceHome':hn,'sourceAway':an,'homeScore':hs,'awayScore':aws}
        return gid,{'status':'final','gameId':gid,'home':ident['home'],'away':ident['away'],'homeScore':hs,'awayScore':aws,'actualMargin':hs-aws,'actualTotal':hs+aws,'source':url,'retrievedAt':iso(asof),'sourceKickoff':c.get('date')}
    results={};items=list(inventory.items())
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        for i,(gid,r) in enumerate(pool.map(one,items)):
            if r:results[gid]=r
            if i%60==0:print(f'Results {i+1}/{len(items)}; finals {sum(x.get("status")=="final" for x in results.values())}',flush=True)
    return results

def append_verified_results(results,inventory,asof):
    path=ROOT/'data/results-2026.json';rows=read_json(path) or [];seen={r['gameId'] for r in rows}
    for gid,r in sorted(results.items()):
        if gid in seen or r.get('status')!='final':continue
        i=inventory.get(gid,{})
        rows.append({'gameId':gid,'week':i.get('week'),'date':i.get('kickoff','')[:10],'away':r['away'],'home':r['home'],'neutral':i.get('neutral',False),'awayScore':r['awayScore'],'homeScore':r['homeScore'],'closingSpread':None,'closingTotal':None,'officialBet':False,'source':r.get('source'),'resultObservedAt':iso(asof),'notes':'Verified final result for model measurement. No retrospective official bet, closing price, or CLV is inferred.'})
    path.write_text(json.dumps(rows,indent=2)+'\n')

def wilson(w,n):
    if not n:return [None,None]
    z=1.96;p=w/n;d=1+z*z/n;c=(p+z*z/(2*n))/d;r=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d
    return [round(100*(c-r),2),round(100*(c+r),2)]
def summarize(rows,model):
    valid=[r for r in rows if model in r['models'] and r.get('result',{}).get('status')=='final']
    errors=[r['models'][model]-r['result']['actualMargin'] for r in valid]
    outcomes=[];outright=[]
    for r in valid:
        p=r['models'][model];a=r['result']['actualMargin'];m=r.get('marketMargin')
        if p and a:outright.append(p*a>0)
        if m is None or abs(p-m)<1e-8:continue
        cover=(a-m)*(1 if p>m else -1)
        outcomes.append('W' if cover>1e-8 else 'L' if cover< -1e-8 else 'P')
    c=collections.Counter(outcomes);w,l,p=c['W'],c['L'],c['P'];n=w+l
    return {'n':len(valid),'mae':round(statistics.mean(map(abs,errors)),4) if errors else None,'rmse':round(math.sqrt(statistics.mean(e*e for e in errors)),4) if errors else None,'homeMarginBias':round(statistics.mean(errors),4) if errors else None,'wins':w,'losses':l,'pushes':p,'atsDecisions':n,'atsWinPct':round(100*w/n,2) if n else None,'ats95PctInterval':wilson(w,n),'hypotheticalRoiAtMinus110Pct':round(100*(w*100/110-l)/(n+p),2) if n+p else None,'outrightWinnerAccuracyPct':round(100*sum(outright)/len(outright),2) if outright else None}

def analyze(observations,inventory,results,asof,cache):
    for gid,r in (read_json(cache/'legacy-results.json') or {}).items():results[gid]=r
    # Resolve legacy aliases only when both teams and kickoff match an already resolved canonical game.
    pairs=collections.defaultdict(list)
    for gid,i in inventory.items():
        if gid.startswith('ESPN-') and results.get(gid,{}).get('status')=='final':pairs[(key(i['away']),key(i['home']))].append((gid,i))
    aliases={}
    for gid,i in inventory.items():
        if gid.startswith('ESPN-'):continue
        matches=[(c,j) for c,j in pairs[(key(i['away']),key(i['home']))] if abs((stamp(i['kickoff'])-stamp(j['kickoff'])).total_seconds())<=86400]
        if len(matches)==1:aliases[gid]=matches[0][0]
    # Original published finals support legacy rows; they do not confer prospective status on predictions.
    for r in read_json(ROOT/'data/results-2026.json') or []:
        gid=r['gameId']
        if gid not in aliases and finite(r.get('homeScore')) and finite(r.get('awayScore')):
            results[gid]={'status':'final','gameId':gid,'home':r['home'],'away':r['away'],'homeScore':r['homeScore'],'awayScore':r['awayScore'],'actualMargin':r['homeScore']-r['awayScore'],'actualTotal':r['homeScore']+r['awayScore'],'source':r.get('source'),'sourceType':'existing-published-results','retrievedAt':iso(asof)}
    bygame=collections.defaultdict(list)
    for o in observations:
        gid=aliases.get(o['gameId'],o['gameId']);o={**o,'gameId':gid}
        if results.get(gid,{}).get('status')=='final':
            actual_kickoff=stamp(results[gid].get('sourceKickoff'))
            if actual_kickoff and stamp(o['recordedAt'])>=actual_kickoff:continue
            o['result']=results[gid]
        bygame[gid].append(o)
    common=[];native={m:[] for m in (*MODELS,'governed','legacy')};allgames=[]
    for gid,obs in bygame.items():
        obs.sort(key=lambda x:x['recordedAt'],reverse=True)
        identity={k:obs[0].get(k) for k in ('gameId','week','away','home','kickoff','neutral')}
        result=results.get(gid,{'status':'pending' if stamp(identity['kickoff'])>=asof else 'unresolved'})
        allgames.append({**identity,'result':result,'modelsAvailable':sorted(set(m for o in obs for m in o['models']))})
        for m in native:
            candidates=[x for x in obs if m in x['models']]
            if candidates:
                # Keep a same-time market when possible; never attach a later line.
                priced=[x for x in candidates if x.get('marketMargin') is not None]
                native[m].append((priced or candidates)[0])
        candidates=[x for x in obs if all(m in x['models'] for m in MODELS) and x.get('marketMargin') is not None]
        if candidates:common.append(candidates[0])
    graded=[x for x in common if x.get('result',{}).get('status')=='final']
    baseline=[{**r,'models':{'baseline':r['marketMargin']}} for r in graded]
    byweek=[]
    for w in sorted(set(int(r['week']) for r in graded)):
        rows=[r for r in graded if int(r['week'])==w]
        byweek.append({'week':w,'completeWeek':w<8,'models':{m:summarize(rows,m) for m in MODELS},'marketBaseline':summarize([{**r,'models':{'baseline':r['marketMargin']}} for r in rows],'baseline')})
    segments={}
    for name,criterion in [('market-spread-under-7',lambda r:abs(r['marketMargin'])<7),('market-spread-7-to-14',lambda r:7<=abs(r['marketMargin'])<14),('market-spread-14-to-21',lambda r:14<=abs(r['marketMargin'])<21),('market-spread-21-plus',lambda r:abs(r['marketMargin'])>=21),('forecast-within-24h',lambda r:r['minutesBeforeKickoff']<=1440),('source-limited',lambda r:r.get('informationQuality')=='source-limited'),('full-evidence',lambda r:r.get('informationQuality')=='full-evidence')]:
        rows=[r for r in graded if criterion(r)]
        segments[name]={'models':{m:summarize(rows,m) for m in MODELS},'marketBaseline':summarize([{**r,'models':{'baseline':r['marketMargin']}} for r in rows],'baseline')}
    buckets={}
    for m in MODELS:
        buckets[m]=[]
        for lo,hi in [(0,.5),(.5,1),(1,2),(2,3),(3,5),(5,1000)]:
            rows=[r for r in graded if lo<=abs(r['models'][m]-r['marketMargin'])<hi]
            buckets[m].append({'edgeMin':lo,'edgeMax':hi if hi<1000 else None,**summarize(rows,m)})
    # Chronological research tests. W4-5 train; W6-7 validation; partial W8 excluded.
    train=[r for r in graded if int(r['week']) in (4,5)];test=[r for r in graded if int(r['week']) in (6,7)]
    tests=[]
    if train and test:
        for family in ('blend-independent-market','blend-independent-line'):
            def candidate(rows,w):
                return [{**r,'models':{'candidate':w*r['models']['independent']+(1-w)*(r['models']['market'] if family.endswith('-market') else r['marketMargin'])}} for r in rows]
            scored=[(summarize(candidate(train,k/10),'candidate')['mae'],k/10) for k in range(11)]
            _,weight=min(scored)
            tests.append({'test':family,'trainWeeks':[4,5],'validationWeeks':[6,7],'independentWeight':weight,'train':summarize(candidate(train,weight),'candidate'),'validation':summarize(candidate(test,weight),'candidate')})
        for m in MODELS:
            bias=statistics.mean(r['models'][m]-r['result']['actualMargin'] for r in train);correction=max(-3,min(3,bias))
            rows=[{**r,'models':{'candidate':r['models'][m]-correction}} for r in test]
            tests.append({'test':m+'-home-bias-correction','trainWeeks':[4,5],'validationWeeks':[6,7],'subtractFromHomeMargin':round(correction,4),'validation':summarize(rows,'candidate'),'originalValidation':summarize(test,m)})
    totals=[]
    for obs in bygame.values():
        rows=[r for r in obs if finite(r.get('modelTotal')) and finite(r.get('marketTotal')) and r.get('result',{}).get('status')=='final']
        if rows:totals.append(rows[0])
    totalerrors=[r['modelTotal']-r['result']['actualTotal'] for r in totals]
    totalout=[]
    for r in totals:
        edge=r['modelTotal']-r['marketTotal'];actual=r['result']['actualTotal']-r['marketTotal']
        if abs(edge)<1e-8:continue
        v=edge*actual;totalout.append('W' if v>0 else 'L' if v<0 else 'P')
    tc=collections.Counter(totalout)
    completed=[g for g in allgames if g['result']['status']=='final']
    exclusions=read_json(cache/'extraction.json')
    report={'schemaVersion':'cfb-season-performance-v1','asOf':iso(asof),'season':2026,'sourceCommit':git('rev-parse','HEAD').strip(),'methodology':{'scope':'All recoverable genuinely pregame modeled games, including passes; no retrospective wagers.','predictionSelection':'Latest published pre-kickoff board/snapshot within 7 days; use same-time priced record where available. All-three comparison uses one common saved board and market per game.','timestampRule':'Both original Git commit publication and embedded observation time must precede scheduled kickoff.','precision':'Original numeric home margins when saved; otherwise original displayed half-point fair lines.','marketBenchmark':'Market spread saved with the prediction; this is NOT a verified closing-line benchmark.','hypotheticalRoi':'One unit risked per directional signal at assumed -110; excludes zero-edge passes. Not actual betting returns.','bias':'Prediction minus actual home margin; positive means overrating home teams.','legacy':'Single-model pre-three-model forecasts are kept separate. No missing Ensemble fair is inferred.','calibration':'Research only; train W4-5, validate W6-7; partial W8 excluded; no production weights changed.','completeSeasonClaim':False},'coverage':{'distinctGamesWithPregamePredictions':len(allgames),'completedGamesWithPregamePredictions':len(completed),'completedThreeModelCommonPricedGames':len(graded),'futureGames':sum(g['result']['status']=='pending' for g in allgames),'unresolvedGames':sum(g['result']['status'] not in ('final','pending') for g in allgames),'originalSnapshotFiles':len(list((ROOT/'data/final-snapshots').glob('*.json'))),'historyCommitsInspected':exclusions['historyCommits'],'aliasesMerged':aliases,'commonMedianMinutesBeforeKickoff':statistics.median(r['minutesBeforeKickoff'] for r in graded) if graded else None,'commonMoreThan24hOld':sum(r['minutesBeforeKickoff']>1440 for r in graded)},'exclusions':exclusions['exclusions'],'models':{m:summarize(graded,m) for m in MODELS},'marketBaseline':summarize(baseline,'baseline'),'nativeCoverage':{m:summarize(rows,m) for m,rows in native.items()},'byWeek':byweek,'edgeBuckets':buckets,'calibrationTests':tests,'totals':{'n':len(totals),'modelMae':statistics.mean(map(abs,totalerrors)) if totalerrors else None,'marketMae':statistics.mean(abs(r['marketTotal']-r['result']['actualTotal']) for r in totals) if totals else None,'bias':statistics.mean(totalerrors) if totalerrors else None,'wins':tc['W'],'losses':tc['L'],'pushes':tc['P'],'note':'Legacy/governed total forecasts only; not three separate total models.'},'games':sorted(allgames,key=lambda g:(int(g.get('week') or 0),g['kickoff'],g['gameId'])),'commonGames':sorted(graded,key=lambda r:(int(r['week']),r['kickoff'],r['gameId'])),'individualModelGames':native}
    report['segments']=segments
    covered={g['gameId'] for g in allgames}
    report['missingPregamePredictions']=[{**i,'gameId':gid,'reason':'No trustworthy pre-kickoff forecast was preserved; excluded from model performance.' if i.get('everModeled') else 'No usable model forecast / quarantined game.'} for gid,i in inventory.items() if aliases.get(gid,gid) not in covered]
    report['coverage']['modeledGamesWithoutValidPregameForecast']=sum(bool(g.get('everModeled')) for g in report['missingPregamePredictions'])
    report['coverage']['quarantinedOrUnmodeledGames']=sum(not g.get('everModeled') for g in report['missingPregamePredictions'])
    report['nativeByWeek']=[{'week':w,'models':{m:summarize([r for r in rows if int(r.get('week') or 0)==w],m) for m,rows in native.items()}} for w in sorted(set(int(r.get('week') or 0) for rows in native.values() for r in rows))]
    report['dataIntegrityFindings']=[{'issue':'ensemble-omitted-from-immutable-snapshot','detail':'Historical snapshot writer read game.ensembleFair instead of game.multiModel.ensemble.fair. Missing Ensemble forecasts were recovered only from contemporaneous board history.'},{'issue':'selected-model-mislabelled-as-market','detail':'Historical snapshot writer labelled game.modelSpread as marketCalibratedFair although modelSpread could contain the selected Ensemble. Such snapshot values are now classified as governed/ambiguous and excluded from named Market-Calibrated comparisons.'},{'issue':'result-pipeline-stopped-at-week-one','detail':'Original results-2026.json was not a current season scorecard. Canonical completed games were matched to ESPN final scores.'}]
    game_rows=[]
    native_by_id={m:{r['gameId']:r for r in rows} for m,rows in native.items()}
    common_by_id={r['gameId']:r for r in graded}
    for g in report['games']:
        item={**g,'predictions':{},'commonComparison':g['gameId'] in common_by_id}
        for m,by_id in native_by_id.items():
            r=by_id.get(g['gameId'])
            if r:item['predictions'][m]={k:r.get(k) for k in ('recordedAt','source','sourceCommit','sourcePath','marketMargin','minutesBeforeKickoff','confidence')};item['predictions'][m]['homeMargin']=r['models'][m]
        shared=common_by_id.get(g['gameId'])
        if shared:
            item['commonPredictions']={m:{**{k:shared.get(k) for k in ('recordedAt','source','sourceCommit','sourcePath','marketMargin','minutesBeforeKickoff')},'homeMargin':shared['models'][m]} for m in MODELS}
        game_rows.append(item)
    target=ROOT/'data/season-performance-2026.json';target.write_text(json.dumps(report,indent=2)+'\n')
    summary={k:v for k,v in report.items() if k not in ('games','commonGames','individualModelGames')};summary['gameRows']=game_rows
    (ROOT/'data/season-performance-summary-2026.json').write_text(json.dumps(summary,separators=(',',':'))+'\n')
    (cache/'resolved-results.json').write_text(json.dumps(results,indent=2))
    print(json.dumps({k:report[k] for k in ('coverage','models','marketBaseline','nativeCoverage','byWeek','calibrationTests','totals')},indent=2),flush=True)
    return report

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--cache',default=str(ROOT.parent/'audit-cache'));parser.add_argument('--as-of');parser.add_argument('--extract-only',action='store_true');args=parser.parse_args()
    asof=stamp(args.as_of) if args.as_of else dt.datetime.now(UTC);cache=pathlib.Path(args.cache)
    observations,inventory=extract_history(asof,cache)
    if args.extract_only:return
    results=fetch_results(inventory,cache,asof);(cache/'results.json').write_text(json.dumps(results,indent=2))
    print('RESULT STATUS',collections.Counter(x['status'] for x in results.values()),flush=True)
    analyze(observations,inventory,results,asof,cache)
    append_verified_results(read_json(cache/'resolved-results.json'),inventory,asof)

if __name__=='__main__':main()
