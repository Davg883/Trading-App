"""Independent recovery validation and fixed-capital staged-entry research.

Observed, synthetic and forward records remain distinct. No network access,
recommendation, live broker authority or paper-ledger mutation is provided.
"""
import argparse
import copy
import json
import math
import re
import sys
from datetime import datetime,timezone
from pathlib import Path

from worker.analyst_consensus import strict,seq,finite,instant,integer,string,enum,boolean,currency,url,money,parse_consensus_case,freeze_consensus_case,MAX_SAFE,DAY

VERSION='recovery-006-v1'
CRITERIA_VERSION='recovery-confirmation-v1'
HORIZONS=(1,5,20,60)
MODES=('retrospective','synthetic','forward')
CRITERIA=dict(version=CRITERIA_VERSION,completeSessions=20,persistenceSessions=5,minimumPositiveSessions=3,minimumBreadthPopulation=30,minimumSectorPopulation=5,developingFiveSessionReturn=0,confirmedFiveSessionReturn=.02,confirmedTwentySessionReturn=0,confirmedBreadth=.55,confirmedSectorParticipation=.6,maximumVix=25,maximumVixFiveSessionIncrease=2,maximumCreditFiveSessionIncreaseBps=20,maximumTreasuryFiveSessionIncreasePercentagePoints=.5,invalidationFiveSessionReturn=-.05,invalidationTwentySessionReturn=-.10,invalidationVix=35,invalidationCreditIncreaseBps=50,maximumIndicatorAgeDays=4)


def common(row):
    for key in ('id','instrumentId','seriesId','adjustmentVersion','cashInstrumentId'):
        if key in row:row[key]=string(row[key],240)
    for key in ('title','name','description','provider','permittedUse','populationDefinition','costAssumptionsNote'):
        if key in row and row[key] is not None:row[key]=string(row[key],15000)
    for key in ('sourceUrl','url'):
        if key in row:url(row[key])
    for key in ('publishedAt','receivedAt','eventAt','measurementAt'):
        if key in row and row[key] is not None:instant(row[key])
    if 'mode' in row:enum(row['mode'],MODES)
    if 'sourceIds' in row:
        for ref in seq(row['sourceIds'],100,1):string(ref,240)


def date_field(value):
    if value is not None and (not isinstance(value,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',value)):raise ValueError('Publication date must retain date precision')


def parse_recovery_case(value):
    data=copy.deepcopy(value)
    if isinstance(data,dict) and 'contextRecords' not in data:data['contextRecords']=[]
    strict(data,'version id name mode anchorAt sources instruments calendar prices fx breadth sectorParticipation indicators electionHeadlines contextRecords analystConsensusSnapshot plans','recovery case')
    if data['version']!=VERSION:raise ValueError('Unsupported recovery version')
    data['id']=string(data['id'],240);data['name']=string(data['name'],15000);enum(data['mode'],MODES);instant(data['anchorAt'])
    limits=dict(sources=1000,instruments=100,prices=30000,fx=30000,breadth=10000,sectorParticipation=10000,indicators=30000,electionHeadlines=1000,contextRecords=1000,plans=20)
    for field,maximum in limits.items():seq(data[field],maximum)
    for s in data['sources']:
        strict(s,'id title url kind publishedAt publicationDate publicationBasis receivedAt verified usage permittedUse mode role');common(s);date_field(s['publicationDate']);enum(s['kind'],('official_market','economic','company','news','licensed_provider'));enum(s['publicationBasis'],('exact','date_upper_bound','retrieval_upper_bound'));boolean(s['verified']);enum(s['usage'],('licensed','public_reference','unknown'));enum(s['role'],('evidence','outcome','headline'))
        if s['publishedAt'] is not None and s['publishedAt']>s['receivedAt']:raise ValueError('Source publication follows receipt')
        if s['publicationBasis']=='exact' and s['publishedAt'] is None:raise ValueError('Exact publication needs a timestamp')
    for i in data['instruments']:
        strict(i,'id name symbol product currency sourceIds sourceUrl globalDiversificationVerified leverageFactor researchApproved publishedAt receivedAt mode');common(i);i['symbol']=string(i['symbol'],240);enum(i['product'],('index','equity','etf','cash'));currency(i['currency']);boolean(i['globalDiversificationVerified']);boolean(i['researchApproved'])
        if isinstance(i['leverageFactor'],bool) or i['leverageFactor']!=1:raise ValueError('No leverage permitted')
        if i['publishedAt']>i['receivedAt']:raise ValueError('Instrument receipt precedes publication')
    for p in data['prices']:
        strict(p,'id instrumentId provider sourceIds sourceUrl eventAt publishedAt receivedAt currency close priceBasis adjustmentVersion session corporateActionsReviewed licensed permittedUse usage mode supersedes');common(p);currency(p['currency']);finite(p['close'],0,MAX_SAFE)
        if p['close']==0:raise ValueError('Positive close required')
        enum(p['priceBasis'],('index-level','unadjusted_close','total-return','split-adjusted'));enum(p['session'],('regular',));boolean(p['corporateActionsReviewed']);boolean(p['licensed']);enum(p['usage'],('licensed','public_reference','unknown'))
        if p['supersedes'] is not None:p['supersedes']=string(p['supersedes'],240)
        if p['eventAt']>p['receivedAt'] or p['publishedAt'] is not None and not p['eventAt']<=p['publishedAt']<=p['receivedAt']:raise ValueError('Price event and receipt dates invalid')
    for r in data['breadth']:
        strict(r,'id populationInstrumentId populationDefinition eventAt publishedAt receivedAt advancing declining unchanged eligiblePopulation coverageComplete licensed sourceIds mode');common(r);enum(r['populationInstrumentId'],('COMP','NDX','SOX'))
        for field in ('advancing','declining','unchanged'):integer(r[field])
        integer(r['eligiblePopulation'],1);boolean(r['coverageComplete']);boolean(r['licensed'])
        if r['advancing']+r['declining']+r['unchanged']!=r['eligiblePopulation'] or r['eventAt']>r['receivedAt'] or r['publishedAt'] is not None and r['publishedAt']>r['receivedAt']:raise ValueError('Breadth population or timestamps invalid')
    for r in data['sectorParticipation']:
        strict(r,'id populationDefinition eventAt publishedAt receivedAt positiveSectors totalSectors coverageComplete licensed sourceIds mode');common(r);integer(r['positiveSectors']);integer(r['totalSectors'],1);boolean(r['coverageComplete']);boolean(r['licensed'])
        if r['positiveSectors']>r['totalSectors'] or r['eventAt']>r['receivedAt'] or r['publishedAt'] is not None and r['publishedAt']>r['receivedAt']:raise ValueError('Sector population or timestamps invalid')
    for r in data['indicators']:
        strict(r,'id metric seriesId populationDefinition value unit measurementAt publishedAt receivedAt sourceIds mode');common(r);enum(r['metric'],('vix','treasury_10y','credit_spread'));enum(r['unit'],('index_points','percent','basis_points'));finite(r['value'],-MAX_SAFE,MAX_SAFE)
        if r['measurementAt']>r['receivedAt'] or r['publishedAt'] is not None and not r['measurementAt']<=r['publishedAt']<=r['receivedAt']:raise ValueError('Indicator measurement or receipt dates invalid')
        if r['metric']=='vix' and r['unit']!='index_points' or r['metric']=='treasury_10y' and r['unit']!='percent' or r['metric']=='credit_spread' and r['unit'] not in ('percent','basis_points'):raise ValueError('Indicator unit does not match its economic measurement')
    for h in data['electionHeadlines']:
        strict(h,'id title description eventAt publishedAt receivedAt sourceIds mode');common(h)
    for p in data['plans']:
        strict(p,'id name kind initialCapitalGbp basket schedule cashInstrumentId entryFeePerLegGbp exitFeePerLegGbp spreadBps slippageBps fxFeeBps annualAdditionalFeeBps cashAnnualRate costAssumptionsNote mode');common(p);enum(p['kind'],('immediate','staged','diversified'))
        if isinstance(p['initialCapitalGbp'],bool) or p['initialCapitalGbp']!=500:raise ValueError('Every recovery portfolio requires identical 500 GBP initial capital')
        for a in seq(p['basket'],100,1):
            strict(a,'instrumentId weight');a['instrumentId']=string(a['instrumentId'],240);finite(a['weight'],0,1)
            if a['weight']==0:raise ValueError('Positive basket weights required')
        for s in seq(p['schedule'],20,1):
            strict(s,'offsetSessions fraction');integer(s['offsetSessions'],0,60);finite(s['fraction'],0,1)
            if s['fraction']==0:raise ValueError('Positive entry fraction required')
        for field in ('entryFeePerLegGbp','exitFeePerLegGbp','spreadBps','slippageBps','fxFeeBps','annualAdditionalFeeBps'):
            if p[field] is not None:money(p[field])
        if p['cashAnnualRate'] is not None:finite(p['cashAnnualRate'],-1,1)
        if abs(sum(a['weight'] for a in p['basket'])-1)>=1e-10 or abs(sum(s['fraction'] for s in p['schedule'])-1)>=1e-10 or len({a['instrumentId'] for a in p['basket']})!=len(p['basket']) or any(s['offsetSessions']<=p['schedule'][j-1]['offsetSessions'] for j,s in enumerate(p['schedule']) if j):raise ValueError('Plan weights and ordered schedule must reconcile to 100%')
    skeleton=dict(version='analyst-consensus-001-v1',id='shared-validation',name='Shared source conventions',mode=data['mode'],providers=[],recommendations=[],headlines=[],webClaims=[],contextRecords=data['contextRecords'],instruments=[],portfolios=[],calendar=data['calendar'],prices=[],fx=data['fx'],ablations=[])
    shared=parse_consensus_case(skeleton);data['calendar']=shared['calendar'];data['fx']=shared['fx'];data['contextRecords']=shared['contextRecords']
    snapshot=data['analystConsensusSnapshot']
    if snapshot is not None:
        strict(snapshot,'caseId cutoff receivedAt recordJson mode');snapshot['caseId']=string(snapshot['caseId'],240);instant(snapshot['cutoff']);instant(snapshot['receivedAt']);enum(snapshot['mode'],MODES)
        if not isinstance(snapshot['recordJson'],str) or not 2<=len(snapshot['recordJson'])<=700000:raise ValueError('Structured analyst snapshot required')
        parsed=json.loads(snapshot['recordJson'])
        if not isinstance(parsed,(dict,list)) and parsed is not None:raise ValueError('Structured analyst snapshot required')
    for field in limits:
        if len({r['id'] for r in data[field]})!=len(data[field]):raise ValueError('Recovery register IDs must be unique')
    rows=[r for field in limits for r in data[field]]+([data['calendar']] if data['calendar'] else [])+([snapshot] if snapshot else [])
    if any(r['mode']!=data['mode'] for r in rows):raise ValueError('Synthetic, retrospective and forward evidence cannot be combined')
    source_ids={s['id'] for s in data['sources']};instruments={i['id']:i for i in data['instruments']}
    for row in data['instruments']+data['prices']+data['breadth']+data['sectorParticipation']+data['indicators']+data['electionHeadlines']:
        if any(id not in source_ids for id in row['sourceIds']):raise ValueError('Recovery source reference missing')
    for symbol,product in [('COMP','index'),('NDX','index'),('SOX','index'),('QQQ','etf')]:
        i=instruments.get(symbol)
        if i and (i['id']!=i['symbol'] or i['product']!=product):raise ValueError('COMP, NDX, SOX and QQQ are distinct instruments and cannot be aliases')
    for p in data['prices']:
        i=instruments.get(p['instrumentId'])
        if not i or i['currency']!=p['currency'] or i['product']=='index' and p['priceBasis']!='index-level' or i['product']!='index' and p['priceBasis']=='index-level':raise ValueError('Price identity, currency and index/ETF basis incompatible')
    for plan in data['plans']:
        cash=instruments.get(plan['cashInstrumentId'])
        if not cash or cash['product']!='cash' or cash['currency']!='GBP':raise ValueError('Recovery experiments need an explicit GBP cash reserve')
        if any(not instruments.get(a['instrumentId']) or instruments[a['instrumentId']]['product']=='index' or not instruments[a['instrumentId']]['researchApproved'] for a in plan['basket']):raise ValueError('Indices are research signals and cannot be allocated or paper-traded')
        symbols=[instruments[a['instrumentId']]['symbol'] for a in plan['basket']]
        if plan['kind']!='diversified' and (len(symbols)!=3 or set(symbols)!={'NVDA','MSFT','AAPL'} or any(abs(a['weight']-1/3)>1e-10 for a in plan['basket'])):raise ValueError('Immediate and staged plans require the equal NVDA/MSFT/AAPL basket')
        if plan['kind'] in ('immediate','diversified') and (len(plan['schedule'])!=1 or plan['schedule'][0]['offsetSessions']!=0) or plan['kind']=='staged' and (len(plan['schedule'])!=3 or any(s['offsetSessions']!=[0,5,20][j] or abs(s['fraction']-1/3)>1e-10 for j,s in enumerate(plan['schedule']))):raise ValueError('Entry schedule is fixed in version recovery-006-v1')
        if plan['kind']=='diversified' and (len(plan['basket'])!=2 or any(abs(a['weight']-.5)>1e-10 for a in plan['basket']) or not any(a['instrumentId']==plan['cashInstrumentId'] for a in plan['basket']) or not any(instruments[a['instrumentId']]['product']=='etf' and instruments[a['instrumentId']]['globalDiversificationVerified'] for a in plan['basket'])):raise ValueError('Diversified control is 50% sourced global ETF and 50% GBP cash')
    prices={p['id']:p for p in data['prices']}
    for p in data['prices']:
        seen={p['id']};r=p
        while r['supersedes']:
            prior=prices.get(r['supersedes'])
            if not prior or prior['id'] in seen or prior['instrumentId']!=p['instrumentId'] or prior['eventAt']!=p['eventAt'] or prior['receivedAt']>r['receivedAt']:raise ValueError('Price revisions must preserve instrument, session and ordered receipt')
            seen.add(prior['id']);r=prior
    reserved=dict(COMP='index',NDX='index',SOX='index',QQQ='etf')
    for i in data['instruments']:
        if i['symbol'] in reserved and (i['id']!=i['symbol'] or i['product']!=reserved[i['symbol']]):raise ValueError('Reserved index and ETF symbols cannot be aliased')
    if snapshot:
        raw=json.loads(snapshot['recordJson']);nested=parse_consensus_case(raw.get('case',raw) if isinstance(raw,dict) else raw)
        if snapshot['cutoff']>snapshot['receivedAt'] or nested['id']!=snapshot['caseId'] or nested['mode']!=snapshot['mode'] or isinstance(raw,dict) and 'cutoff' in raw and raw['cutoff']!=snapshot['cutoff'] or freeze_consensus_case(nested,snapshot['cutoff'])['case']!=nested:raise ValueError('Analyst context must be an eligible strict frozen consensus snapshot, without late or unlicensed web annotations')
    return data


def date_upper_bound(date):
    try:return datetime.fromisoformat(date).replace(tzinfo=timezone.utc).timestamp()*1000+32*3600000-1
    except (TypeError,ValueError):return None


def recovery_source_bound(source):
    if source['publishedAt'] is not None:return source['publishedAt']
    return source['receivedAt'] if source['publicationBasis']=='retrieval_upper_bound' else date_upper_bound(source['publicationDate']) if source['publicationDate'] else None


def eligible_source(source,cutoff,outcome=False):
    bound=recovery_source_bound(source)
    return source['verified'] and bound is not None and math.isfinite(bound) and bound<=cutoff and source['receivedAt']<=cutoff and (source['role']=='evidence' or outcome and source['role']=='outcome')


def row_available(row,cutoff):return (row['publishedAt'] if row['publishedAt'] is not None else row['receivedAt'])<=cutoff and row['receivedAt']<=cutoff


def source_rows_available(data,ids,cutoff,outcome=False):
    sources={s['id']:s for s in data['sources']}
    return all(id in sources and eligible_source(sources[id],cutoff,outcome) for id in ids)


def freeze_recovery_case(value,cutoff):
    data=parse_recovery_case(value);instant(cutoff);excluded=[];sources=[]
    for s in data['sources']:
        bound=recovery_source_bound(s)
        if eligible_source(s,cutoff) or s['role']=='headline' and s['verified'] and s['receivedAt']<=cutoff and bound is not None and bound<=cutoff:sources.append(s)
        else:excluded.append(dict(id=s['id'],reason='Outcome source cannot enter an earlier research snapshot' if s['role']=='outcome' else 'Source publication, actual receipt or verification unavailable at cutoff'))
    ids={s['id'] for s in sources};source_map={s['id']:s for s in data['sources']}
    def select(rows,numeric=True):
        result=[]
        for r in rows:
            ok=row_available(r,cutoff) and all(id in ids for id in r['sourceIds']) and (not numeric or all(source_map[id]['role']=='evidence' and source_map[id]['kind']!='news' for id in r['sourceIds']))
            if ok:result.append(r)
            else:excluded.append(dict(id=r['id'],reason='Record unavailable or source is not suitable numerical evidence'))
        return result
    instruments=select(data['instruments']);instrument_ids={i['id'] for i in instruments}
    context=[r for r in data['contextRecords'] if r['receivedAt']<=cutoff and (r['publishedAt'] if r['publishedAt'] is not None else date_upper_bound(r['publicationDate']) if r['publicationDate'] else math.inf) is not None and (r['publishedAt'] if r['publishedAt'] is not None else date_upper_bound(r['publicationDate']) if r['publicationDate'] else math.inf)<=cutoff]
    c=data['calendar'];calendar=c if c and c['publishedAt']<=cutoff and c['receivedAt']<=cutoff else None
    a=data['analystConsensusSnapshot'];analyst=a if a and a['cutoff']<=cutoff and a['receivedAt']<=cutoff else None
    frozen={**data,'sources':sources,'instruments':instruments,'calendar':calendar,'prices':[p for p in select(data['prices']) if p['eventAt']<=cutoff and p['instrumentId'] in instrument_ids],'fx':[r for r in data['fx'] if r['eventAt']<=cutoff and row_available(r,cutoff)],'breadth':[r for r in select(data['breadth']) if r['eventAt']<=cutoff],'sectorParticipation':[r for r in select(data['sectorParticipation']) if r['eventAt']<=cutoff],'indicators':[r for r in select(data['indicators']) if r['measurementAt']<=cutoff],'electionHeadlines':select(data['electionHeadlines'],False),'contextRecords':context,'analystConsensusSnapshot':analyst,'plans':[p for p in data['plans'] if all(a['instrumentId'] in instrument_ids for a in p['basket']) and p['cashInstrumentId'] in instrument_ids]}
    return dict(version=VERSION,cutoff=cutoff,case=frozen,excluded=excluded,executionAuthority='none')


def price_at(data,instrument_id,event_at,cutoff,licensed_only=False):
    sources={s['id']:s for s in data['sources']}
    matches=[p for p in data['prices'] if p['instrumentId']==instrument_id and p['eventAt']==event_at and row_available(p,cutoff) and source_rows_available(data,p['sourceIds'],cutoff,licensed_only) and all(sources[id]['kind']!='news' for id in p['sourceIds']) and (p['licensed'] and p['usage']=='licensed' and p['permittedUse'] is not None and all(sources[id]['usage']=='licensed' and sources[id]['permittedUse'] is not None for id in p['sourceIds']) if licensed_only else p['usage']!='unknown')]
    superseded={p['supersedes'] for p in matches};active=[p for p in matches if p['id'] not in superseded]
    if len(active)!=1:raise ValueError('One eligible identified price per instrument and session is required')
    return active[0]


def recovery_momentum(value,instrument_id,cutoff,end_at=None):
    data=parse_recovery_case(value);instant(cutoff);instrument=next((i for i in data['instruments'] if i['id']==instrument_id),None);calendar=data['calendar']
    def missing(reason):return dict(version=VERSION,instrumentId=instrument_id,instrument=instrument,latest=None,windows=[dict(sessions=n,startAt=None,endAt=None,**{'return':None},drawdownFromHigh=None,maximumDrawdown=None,positiveSessions=None,status='unavailable',reason=reason,sourceIds=[]) for n in (1,5,20)],mode=data['mode'],executionAuthority='none')
    if not instrument or not calendar or not calendar['verified'] or calendar['publishedAt']>cutoff or calendar['receivedAt']>cutoff:return missing('Sourced instrument and verified eligible calendar required')
    latest=None
    for at in reversed([t for t in calendar['sessionCloses'] if t<=cutoff and (end_at is None or t<=end_at)]):
        try:latest=price_at(data,instrument_id,at,cutoff);break
        except ValueError:pass
    if latest is None:return missing('No eligible source observation; indicative values and news moves are not closing prices')
    end=latest['eventAt'];index=calendar['sessionCloses'].index(end);windows=[]
    for n in (1,5,20):
        try:
            if index<n:raise ValueError('Insufficient complete session history')
            times=calendar['sessionCloses'][index-n:index+1];bars=[price_at(data,instrument_id,t,cutoff) for t in times]
            if any(any(p[k]!=latest[k] for k in ('currency','priceBasis','adjustmentVersion','provider')) or not p['corporateActionsReviewed'] for p in bars):raise ValueError('History currency, provider, basis or corporate-action treatment differs')
            values=[p['close'] for p in bars];peak=values[0];dd=0;positive=0
            for j,v in enumerate(values):
                peak=max(peak,v);dd=min(dd,v/peak-1)
                if j and v>values[j-1]:positive+=1
            windows.append(dict(sessions=n,startAt=times[0],endAt=end,**{'return':values[-1]/values[0]-1},drawdownFromHigh=values[-1]/max(values)-1,maximumDrawdown=dd,positiveSessions=positive,status='available',reason=None,sourceIds=[b['id'] for b in bars]))
        except ValueError as error:windows.append(dict(sessions=n,startAt=None,endAt=end,**{'return':None},drawdownFromHigh=None,maximumDrawdown=None,positiveSessions=None,status='unavailable',reason=str(error),sourceIds=[]))
    return dict(version=VERSION,instrumentId=instrument_id,instrument=instrument,latest=latest,windows=windows,mode=data['mode'],executionAuthority='none')


def classify_recovery_case(value,cutoff,anchor_at=None):
    data=parse_recovery_case(value);anchor=data['anchorAt'] if anchor_at is None else anchor_at;instant(anchor);snapshot=freeze_recovery_case(data,cutoff)['case'];missing=[];momentum=[recovery_momentum(data,id,cutoff,anchor) for id in ('COMP','NDX','SOX')]
    for m in momentum:
        if not m['latest'] or m['latest']['eventAt']!=anchor:missing.append(f"{m['instrumentId']}: requested anchor close is unavailable; latest sourced observation is not substituted")
        if any(w['status']!='available' for w in m['windows']):missing.append(f"{m['instrumentId']}: complete 1/5/20-session history required")
    breadth_rows=sorted([r for r in snapshot['breadth'] if r['populationInstrumentId']=='COMP' and r['eventAt']==anchor and r['licensed'] and r['coverageComplete'] and r['eligiblePopulation']>=CRITERIA['minimumBreadthPopulation']],key=lambda r:r['receivedAt'],reverse=True)
    sector_rows=sorted([r for r in snapshot['sectorParticipation'] if r['eventAt']==anchor and r['licensed'] and r['coverageComplete'] and r['totalSectors']>=CRITERIA['minimumSectorPopulation']],key=lambda r:r['receivedAt'],reverse=True)
    breadth=breadth_rows[0] if breadth_rows else None;sectors=sector_rows[0] if sector_rows else None
    if not breadth:missing.append('Licensed complete Nasdaq Composite breadth with an explicit population is required')
    if not sectors:missing.append('Licensed complete sector participation with an explicit population is required')
    c=snapshot['calendar'];index=c['sessionCloses'].index(anchor) if c and anchor in c['sessionCloses'] else -1;prior_at=c['sessionCloses'][index-5] if index>=5 else None
    indicators=[]
    for metric in ('vix','treasury_10y','credit_spread'):
        def select(at):
            if at is None:return None
            rows=sorted([r for r in snapshot['indicators'] if r['metric']==metric and r['measurementAt']<=at and at-r['measurementAt']<=CRITERIA['maximumIndicatorAgeDays']*DAY],key=lambda r:(r['measurementAt'],r['receivedAt']),reverse=True)
            return rows[0] if rows else None
        current=select(anchor);prior=select(prior_at)
        if not current or not prior or current['seriesId']!=prior['seriesId'] or current['populationDefinition']!=prior['populationDefinition']:missing.append(f'{metric}: fresh compatible current and five-session-prior measurements are required')
        def normalize(r):return r['value']*100 if r and r['metric']=='credit_spread' and r['unit']=='percent' else r['value'] if r else None
        indicators.append(dict(metric=metric,current=current,prior=prior,currentValue=normalize(current),fiveSessionChange=normalize(current)-normalize(prior) if current and prior else None,comparisonUnit='basis_points' if metric=='credit_spread' else 'percentage_points' if metric=='treasury_10y' else 'index_points'))
    def window(name,n):return next(w for m in momentum if m['instrumentId']==name for w in m['windows'] if w['sessions']==n)
    metrics={r['metric']:r for r in indicators};breadth_share=breadth['advancing']/breadth['eligiblePopulation'] if breadth else None;sector_share=sectors['positiveSectors']/sectors['totalSectors'] if sectors else None;classification='unconfirmed';reasons=[]
    if missing:reasons.append('Missing critical evidence prevents confirmation or invalidation')
    else:
        invalid=window('COMP',5)['return']<=CRITERIA['invalidationFiveSessionReturn'] or window('COMP',20)['return']<=CRITERIA['invalidationTwentySessionReturn'] or metrics['vix']['currentValue']>CRITERIA['invalidationVix'] or metrics['credit_spread']['fiveSessionChange']>CRITERIA['invalidationCreditIncreaseBps']
        guards=metrics['vix']['currentValue']<=CRITERIA['maximumVix'] and metrics['vix']['fiveSessionChange']<=CRITERIA['maximumVixFiveSessionIncrease'] and metrics['credit_spread']['fiveSessionChange']<=CRITERIA['maximumCreditFiveSessionIncreaseBps'] and metrics['treasury_10y']['fiveSessionChange']<=CRITERIA['maximumTreasuryFiveSessionIncreasePercentagePoints']
        persistence=all(window(m['instrumentId'],5)['positiveSessions']>=CRITERIA['minimumPositiveSessions'] for m in momentum);positive5=all(window(m['instrumentId'],5)['return']>0 for m in momentum);positive20=all(window(m['instrumentId'],20)['return']>0 for m in momentum)
        if invalid:classification='invalidated';reasons.append('Complete observed data meets a predefined invalidation condition')
        elif guards and persistence and positive5 and positive20 and window('COMP',5)['return']>=CRITERIA['confirmedFiveSessionReturn'] and breadth_share>=CRITERIA['confirmedBreadth'] and sector_share>=CRITERIA['confirmedSectorParticipation']:classification='confirmed';reasons.append('All predefined persistence, breadth, participation and macro-risk guards are met')
        elif guards and persistence and positive5 and breadth_share>=.5 and sector_share>=.5:classification='developing';reasons.append('Five-session recovery evidence exists but the complete confirmation thresholds are not all met')
        else:reasons.append('Complete observations do not yet meet the predefined recovery confirmation tests')
    return dict(version=VERSION,criteria=CRITERIA,anchorAt=anchor,cutoff=cutoff,classification=classification,reasons=reasons,missingCritical=missing,momentum=momentum,breadth=breadth,breadthShare=breadth_share,sectors=sectors,sectorShare=sector_share,indicators=indicators,limitation='Versioned research heuristics, not a validated profit score or automatic investment recommendation. One positive session cannot confirm a recovery.',mode=data['mode'],executionAuthority='none')


def build_recovery_registration(value,options):
    data=parse_recovery_case(value);strict(options,'name cutoff anchorAt registeredAt benchmarkInstrumentId priceBasis adjustmentVersion','registration options');string(options['name'],15000)
    for field in ('cutoff','anchorAt','registeredAt'):instant(options[field])
    enum(options['priceBasis'],('total-return','split-adjusted'));string(options['adjustmentVersion'],240);string(options['benchmarkInstrumentId'],240)
    if options['cutoff']>options['registeredAt'] or data['mode']=='forward' and (options['registeredAt']>options['anchorAt'] or options['cutoff']>options['anchorAt']):raise ValueError('Forward recovery registration must precede its common entry anchor')
    frozen=freeze_recovery_case(data,options['cutoff']);evidence=frozen['case'];benchmark=next((i for i in evidence['instruments'] if i['id']==options['benchmarkInstrumentId']),None)
    if not benchmark or benchmark['product'] in ('index','cash') or not benchmark['researchApproved']:raise ValueError('Approved tradeable benchmark specification is required; indices are not execution instruments')
    if len(evidence['plans'])!=3 or len({p['kind'] for p in evidence['plans']})!=3:raise ValueError('Case 006 requires exactly one immediate, staged and diversified £500 experiment')
    c=evidence['calendar'];index=c['sessionCloses'].index(options['anchorAt']) if c and options['anchorAt'] in c['sessionCloses'] else -1;windows=[]
    for plan in evidence['plans']:
        for horizon in HORIZONS:
            id=f"{data['id']}:{plan['id']}:{horizon}";string(id,240)
            end=c['sessionCloses'][index+horizon] if c and c['verified'] and index>=0 and index+horizon<len(c['sessionCloses']) else None
            windows.append(dict(id=id,version=VERSION,caseId=data['id'],planId=plan['id'],planSnapshot=copy.deepcopy(plan),instrumentSnapshots=copy.deepcopy(evidence['instruments']),sourceSnapshots=copy.deepcopy(evidence['sources']),calendarSnapshot=copy.deepcopy(c),criteriaVersion=CRITERIA_VERSION,mode=data['mode'],cutoff=options['cutoff'],registeredAt=options['registeredAt'],anchorAt=options['anchorAt'],endAt=end,horizon=horizon,horizonSessions=horizon,benchmarkInstrumentId=options['benchmarkInstrumentId'],priceBasis=options['priceBasis'],adjustmentVersion=options['adjustmentVersion'],currency='GBP',session='regular'))
    return dict(version=VERSION,name=options['name'],caseId=data['id'],mode=data['mode'],cutoff=options['cutoff'],anchorAt=options['anchorAt'],registeredAt=options['registeredAt'],evidence=evidence,excluded=frozen['excluded'],criteria=CRITERIA,assessment=classify_recovery_case(data,options['cutoff'],options['anchorAt']),plans=evidence['plans'],windows=windows,
        protocol=dict(stagedOffsets=[0,5,20],trancheFractions=[1/3,1/3,1/3],endpointEntryIncluded=True,windowPolicy='All experiments use the same anchor and 1/5/20/60-session endpoints; staged windows never restart at a later tranche',entryPolicy='Each tranche budget includes its own per-leg fees and percentage dealing costs; no future unexecuted tranche fee is charged',returnPolicy='Gross and net GBP paths include explicit market FX effects; dealing/FX fees are separately disclosed',cashPolicy='Uncommitted cash remains in GBP until its fixed tranche; insufficient cash blocks the experiment rather than borrowing'),
        historicalStatus='Retrospective research comparison; actual receipt or registration after entry cannot establish an earlier forward prediction' if data['mode']=='retrospective' else 'Forward status requires authenticated server registration before entry; synthetic records remain demonstrations',capitalPolicy='Three independent £500 research experiments do not alter the established paper-ledger minimum capital or independent human approval',executionAuthority='none')


def required_costs(plan):return all(plan[k] is not None for k in ('entryFeePerLegGbp','exitFeePerLegGbp','spreadBps','slippageBps','fxFeeBps','annualAdditionalFeeBps','cashAnnualRate'))


def parse_recovery_window(value):
    w=copy.deepcopy(value);strict(w,'id version caseId planId planSnapshot instrumentSnapshots sourceSnapshots calendarSnapshot criteriaVersion mode cutoff registeredAt anchorAt endAt horizon horizonSessions benchmarkInstrumentId priceBasis adjustmentVersion currency session','recovery window')
    if w['version']!=VERSION or w['criteriaVersion']!=CRITERIA_VERSION:raise ValueError('Unsupported recovery window version')
    for field in ('id','caseId','planId','benchmarkInstrumentId','adjustmentVersion'):w[field]=string(w[field],240)
    for field in ('cutoff','registeredAt','anchorAt'):instant(w[field])
    if w['endAt'] is not None:instant(w['endAt'])
    enum(w['mode'],MODES);enum(w['horizon'],HORIZONS);enum(w['horizonSessions'],HORIZONS);enum(w['priceBasis'],('total-return','split-adjusted'));enum(w['currency'],('GBP',));enum(w['session'],('regular',))
    skeleton=dict(version=VERSION,id='window-structure',name='Frozen window structural validation',mode=w['mode'],anchorAt=w['anchorAt'],sources=w['sourceSnapshots'],instruments=w['instrumentSnapshots'],calendar=w['calendarSnapshot'],prices=[],fx=[],breadth=[],sectorParticipation=[],indicators=[],electionHeadlines=[],analystConsensusSnapshot=None,plans=[w['planSnapshot']])
    parse_recovery_case(skeleton)
    if w['planId']!=w['planSnapshot']['id'] or w['horizon']!=w['horizonSessions']:raise ValueError('Window and frozen plan identity differ')
    return w


def evaluate_recovery_window(value,window,as_of):
    data=parse_recovery_case(value);w=parse_recovery_window(window);instant(as_of)
    base=dict(version=VERSION,windowId=w['id'],planId=w['planId'],horizon=w['horizon'],anchorAt=w['anchorAt'],endAt=w['endAt'],mode=w['mode'],executionAuthority='none')
    def pending(reason):return {**base,'status':'pending','reason':reason,'result':None}
    try:
        if data['mode']!=w['mode'] or w['planSnapshot']['mode']!=w['mode']:raise ValueError('Observed, synthetic and forward records cannot be mixed')
        if w['cutoff']>w['registeredAt'] or w['mode']=='forward' and w['registeredAt']>w['anchorAt']:raise ValueError('Forward window was registered after entry')
        c=w['calendarSnapshot'];index=c['sessionCloses'].index(w['anchorAt']) if c and w['anchorAt'] in c['sessionCloses'] else -1
        if not c or not c['verified'] or c['publishedAt']>w['cutoff'] or c['receivedAt']>w['cutoff'] or index<0 or w['endAt'] is None or index+w['horizon']>=len(c['sessionCloses']) or c['sessionCloses'][index+w['horizon']]!=w['endAt']:raise ValueError('A complete verified anchor calendar is required')
        if as_of<w['endAt']:raise ValueError('Outcome window has not completed')
        p=w['planSnapshot']
        if not required_costs(p):raise ValueError('All dealing, FX, annual and cash-return assumptions remain required; unknown costs cannot become zero')
        sessions=c['sessionCloses'][index:index+w['horizon']+1];instruments={i['id']:i for i in w['instrumentSnapshots']};source_ids=[];price_conventions={};fx_conventions={}
        def remember(id):
            if id not in source_ids:source_ids.append(id)
        def quote(instrument_id,at):
            i=instruments.get(instrument_id)
            if not i or i['product']=='index' or not i['researchApproved'] or i['receivedAt']>w['cutoff']:raise ValueError('Only the registered approved equity/ETF specifications can be valued')
            bar=price_at(data,instrument_id,at,as_of,True)
            if bar['currency']!=i['currency'] or bar['priceBasis']!=w['priceBasis'] or bar['adjustmentVersion']!=w['adjustmentVersion'] or not bar['corporateActionsReviewed']:raise ValueError('Outcome needs compatible licensed adjusted closes with corporate actions reviewed')
            convention=f"{bar['provider']}|{bar['adjustmentVersion']}"
            if instrument_id in price_conventions and price_conventions[instrument_id]!=convention:raise ValueError('Price provider/basis changed within the window')
            price_conventions[instrument_id]=convention;remember(bar['id'])
            if i['currency']=='GBP':return bar['close']
            rows=[f for f in data['fx'] if f['from']==i['currency'] and f['to']=='GBP' and f['eventAt']==at and f['publishedAt']<=as_of and f['receivedAt']<=as_of and f['licensed'] and f['permittedUse'] is not None]
            superseded={f['supersedes'] for f in rows};active=[f for f in rows if f['id'] not in superseded]
            if len(active)!=1:raise ValueError('A licensed exact-session GBP FX rate is required')
            fx=active[0];fc=f"{fx['provider']}|{fx['conversionVersion']}"
            if i['currency'] in fx_conventions and fx_conventions[i['currency']]!=fc:raise ValueError('FX convention changed within the window')
            fx_conventions[i['currency']]=fc;remember(fx['id']);return bar['close']*fx['rate']
        noncash=[a for a in p['basket'] if instruments[a['instrumentId']]['product']!='cash'];prices={a['instrumentId']:[quote(a['instrumentId'],at) for at in sessions] for a in noncash};benchmark=[quote(w['benchmarkInstrumentId'],at) for at in sessions]
        schedule=[s for s in p['schedule'] if s['offsetSessions']<=w['horizon']];pct_base=(p['spreadBps']+p['slippageBps'])/10000
        cash=500;gross_cash=500;previous_at=w['anchorAt'];entry_fees=0;entry_percentage_costs=0;entry_fx_costs=0;entry_trading_percentage_costs=0;additional_fees=0;holdings=[];entries=[];path=[]
        def liquidation(j):return sum(p['exitFeePerLegGbp']+h['units']*prices[h['instrumentId']][j]*(pct_base+(0 if instruments[h['instrumentId']]['currency']=='GBP' else p['fxFeeBps']/10000)) for h in holdings)
        for j,at in enumerate(sessions):
            years=(at-previous_at)/(365.25*DAY);cash_factor=(1+p['cashAnnualRate'])**years;cash*=cash_factor;gross_cash*=cash_factor
            fee_factor=math.exp(-p['annualAdditionalFeeBps']/10000*years);pre_fee_assets=sum(h['units']*prices[h['instrumentId']][j] for h in holdings)
            for h in holdings:h['units']*=fee_factor
            additional_fees+=pre_fee_assets*(1-fee_factor)
            tranche=next((s for s in schedule if s['offsetSessions']==j),None)
            if tranche:
                budget=500*tranche['fraction'];noncash_weight=sum(a['weight'] for a in noncash);commitment=budget*noncash_weight
                if cash+1e-9<commitment or gross_cash+1e-9<commitment:raise ValueError('Available GBP cash cannot fund the fixed tranche without borrowing')
                used_fees=0;used_pct=0
                for a in noncash:
                    i=instruments[a['instrumentId']];leg_budget=budget*a['weight'];fee=p['entryFeePerLegGbp'];pct=pct_base+(0 if i['currency']=='GBP' else p['fxFeeBps']/10000)
                    if leg_budget<=fee:raise ValueError('Tranche budget cannot cover per-leg entry fees')
                    principal=(leg_budget-fee)/(1+pct);cost=principal*pct;price=prices[a['instrumentId']][j];existing=next((h for h in holdings if h['instrumentId']==a['instrumentId']),None)
                    if existing:existing['units']+=principal/price;existing['grossUnits']+=leg_budget/price
                    else:holdings.append(dict(instrumentId=a['instrumentId'],units=principal/price,grossUnits=leg_budget/price))
                    used_fees+=fee;used_pct+=cost;entry_fx_costs+=principal*(0 if i['currency']=='GBP' else p['fxFeeBps']/10000);entry_trading_percentage_costs+=principal*pct_base
                cash-=commitment;gross_cash-=commitment;entry_fees+=used_fees;entry_percentage_costs+=used_pct;entries.append(dict(at=at,offsetSessions=j,budgetGbp=budget,entryLegs=len(noncash),entryFeeGbp=used_fees,percentageCostGbp=used_pct))
            gross_value=gross_cash+sum(h['grossUnits']*prices[h['instrumentId']][j] for h in holdings);liquidation_costs=liquidation(j);noncash_value=sum(h['units']*prices[h['instrumentId']][j] for h in holdings);net_value=cash+noncash_value-liquidation_costs
            if net_value<0:raise ValueError('Defined liquidation costs exceed the fully funded portfolio value')
            path.append(dict(at=at,grossValueGbp=gross_value,netValueGbp=net_value,cashGbp=cash,noncashValueGbp=noncash_value,noncashFraction=noncash_value/(cash+noncash_value) if cash+noncash_value>0 else 0,liquidationCostsGbp=liquidation_costs));previous_at=at
        peak=500;max_drawdown=0
        for row in path:peak=max(peak,row['netValueGbp']);max_drawdown=min(max_drawdown,row['netValueGbp']/peak-1)
        final=path[-1];gross_return=final['grossValueGbp']/500-1;net_return=final['netValueGbp']/500-1;benchmark_return=benchmark[-1]/benchmark[0]-1
        for v in (gross_return,net_return,max_drawdown,benchmark_return,entry_fees,entry_percentage_costs,additional_fees):finite(v,-MAX_SAFE,MAX_SAFE)
        result=dict(initialCapitalGbp=500,grossEndingCapitalGbp=final['grossValueGbp'],endingCapitalGbp=final['netValueGbp'],grossReturn=gross_return,netReturn=net_return,absoluteReturn=net_return,benchmarkReturn=benchmark_return,benchmarkRelativeReturn=net_return-benchmark_return,grossBenchmarkRelativeReturn=gross_return-benchmark_return,maxDrawdown=max_drawdown,cashRemainingGbp=cash,entryFeesGbp=entry_fees,entryPercentageCostsGbp=entry_percentage_costs,entryFxCostsGbp=entry_fx_costs,entryTradingPercentageCostsGbp=entry_trading_percentage_costs,additionalFeesGbp=additional_fees,exitLiquidationCostsGbp=final['liquidationCostsGbp'],exitFxCostsGbp=sum(h['units']*prices[h['instrumentId']][-1]*(0 if instruments[h['instrumentId']]['currency']=='GBP' else p['fxFeeBps']/10000) for h in holdings),exitTradingPercentageCostsGbp=sum(h['units']*prices[h['instrumentId']][-1]*pct_base for h in holdings),exitFixedFeesGbp=len(holdings)*p['exitFeePerLegGbp'],finalExposureByInstrument=[dict(instrumentId=h['instrumentId'],valueGbp=h['units']*prices[h['instrumentId']][-1]) for h in holdings],entries=entries,path=path,sourceIds=source_ids,costConvention='Per-tranche budgets include entry costs; future tranches are uncharged; endpoint tranches enter before hypothetical liquidation; daily net marks include costs to liquidate held legs',benchmarkCostBasis='Gross GBP benchmark return over the identical anchor window; no invented benchmark dealing fee',executionAuthority='none')
        return {**base,'status':'complete','reason':None,'result':result}
    except (ValueError,OverflowError,ZeroDivisionError) as error:return pending(str(error))


def recovery_risk_gate(registration,plan_id,current_case,as_of):
    data=parse_recovery_case(current_case);plan=next((p for p in registration['plans'] if p['id']==plan_id),None);reasons=[]
    if not plan:reasons.append('Research plan is absent from the immutable registration')
    elif not required_costs(plan):reasons.append('All dealing, FX, annual and cash assumptions must be explicitly supplied')
    if data['mode']!=registration['mode']:reasons.append('Synthetic and observed risk assessments cannot be combined')
    latest=recovery_momentum(data,'COMP',as_of)['latest'] if as_of>registration['cutoff'] else None
    current_anchor=latest['eventAt'] if latest else registration['anchorAt']
    assessment=classify_recovery_case(data,as_of,current_anchor)
    if assessment['classification'] in ('unconfirmed','invalidated'):reasons.append(f"Recovery classification is {assessment['classification']}; the research guard cannot be waived")
    reasons+=assessment['missingCritical'];window=next((w for w in registration['windows'] if w['planId']==plan_id),None)
    if not window or not window['calendarSnapshot'] or not window['calendarSnapshot']['verified']:reasons.append('Verified frozen calendar required')
    if window:
        for a in window['planSnapshot']['basket']:
            i=next((i for i in window['instrumentSnapshots'] if i['id']==a['instrumentId']),None)
            if not i or not i['researchApproved'] or i['product']=='index':reasons.append('Approved unleveraged tradeable specifications are required');continue
            if i['product']=='cash':continue
            try:
                bar=price_at(data,i['id'],registration['anchorAt'],as_of,True)
                if bar['currency']!=i['currency'] or bar['priceBasis']!=window['priceBasis'] or bar['adjustmentVersion']!=window['adjustmentVersion'] or not bar['corporateActionsReviewed']:raise ValueError('Adjusted corporate-action-reviewed entry quote required')
                if i['currency']!='GBP':
                    rows=[f for f in data['fx'] if f['from']==i['currency'] and f['eventAt']==registration['anchorAt'] and f['publishedAt']<=as_of and f['receivedAt']<=as_of and f['licensed'] and f['permittedUse'] is not None];old={f['supersedes'] for f in rows}
                    if len([f for f in rows if f['id'] not in old])!=1:raise ValueError('One unambiguous licensed aligned GBP FX quote is required')
            except ValueError as error:reasons.append(str(error))
    reasons=list(dict.fromkeys(reasons))
    return dict(version=VERSION,planId=plan_id,asOf=as_of,passed=not reasons,invalidationTriggered=assessment['classification']=='invalidated',reasons=reasons,assessment=assessment,executionAuthority='none')


def evaluate(request):
    required={'case','cutoff','anchorAt','registeredAt','benchmarkInstrumentId','priceBasis','adjustmentVersion','asOf'}
    if not isinstance(request,dict) or not required.issubset(request) or set(request)-required-{'name','version'}:raise ValueError('Invalid recovery evaluation request')
    if 'version' in request and request['version']!=VERSION:raise ValueError('Unsupported recovery request version')
    data=parse_recovery_case(request['case']);options={key:request[key] for key in ('cutoff','anchorAt','registeredAt','benchmarkInstrumentId','priceBasis','adjustmentVersion')};options['name']=request.get('name',data['name']);registration=build_recovery_registration(data,options);as_of=instant(request['asOf'])
    return dict(version=VERSION,snapshot=freeze_recovery_case(data,request['cutoff']),assessment=classify_recovery_case(data,request['cutoff'],request['anchorAt']),registration=registration,outcomes=[evaluate_recovery_window(data,w,as_of) for w in registration['windows']],riskGates=[recovery_risk_gate(registration,p['id'],data,as_of) for p in registration['plans']],executionAuthority='none')


def main():
    parser=argparse.ArgumentParser(description='Recovery research validation, no execution authority');parser.add_argument('input');parser.add_argument('--output');args=parser.parse_args()
    try:
        request=json.loads(Path(args.input).read_text(encoding='utf-8-sig'));encoded=json.dumps(evaluate(request),indent=2,sort_keys=True,allow_nan=False)+'\n'
        if args.output:
            with Path(args.output).open('x',encoding='utf8') as file:file.write(encoded)
        else:print(encoded,end='')
        return 0
    except (ValueError,KeyError,TypeError,OSError,OverflowError) as error:print(json.dumps(dict(error=str(error))),file=sys.stderr);return 2


if __name__=='__main__':raise SystemExit(main())
