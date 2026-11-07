"""Independent analyst-consensus validation and GBP research accounting.

No network, executable price import, model call, broker or approval authority.
All timestamps are integer epoch milliseconds; returns are decimal returns.
"""
import argparse
import copy
import json
import math
import re
import statistics
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse, parse_qsl

VERSION = 'analyst-consensus-001-v1'
SYMBOLS = ('NVDA', 'MSFT', 'AAPL')
WINDOWS = (1, 5, 20, 60)
MODES = ('retrospective', 'synthetic', 'forward')
MAX_SAFE = 9007199254740991


def strict(row, fields, label='record'):
    if not isinstance(row, dict) or set(row) != set(fields.split()):
        raise ValueError(f'Invalid {label} fields')
    return row


def seq(value, maximum, minimum=0):
    if not isinstance(value, list) or not minimum <= len(value) <= maximum:
        raise ValueError('Invalid bounded array')
    return value


def finite(value, minimum=None, maximum=None):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError('Finite number required')
    if minimum is not None and value < minimum or maximum is not None and value > maximum:
        raise ValueError('Number outside supported range')
    return value


def instant(value):
    finite(value, 0, 8640000000000000)
    if int(value) != value: raise ValueError('Integer millisecond timestamp required')
    return value


def integer(value, minimum=0, maximum=MAX_SAFE):
    finite(value, minimum, maximum)
    if int(value) != value: raise ValueError('Integer required')
    return value


def string(value, maximum=12000):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum:
        raise ValueError('Nonempty bounded text required')
    return value.strip()


def enum(value, choices):
    if value not in choices: raise ValueError('Unsupported enum value')
    return value


def boolean(value):
    if type(value) is not bool: raise ValueError('Boolean required')
    return value


def currency(value):
    if not isinstance(value, str) or not re.fullmatch('[A-Z]{3}', value): raise ValueError('Currency code required')
    return value


def url(value):
    if not isinstance(value, str): raise ValueError('HTTPS source URL required')
    parsed = urlparse(value)
    credential_name = re.compile(r'^(token|key|api[_-]?key|secret|access[_-]?token|password|authorization|auth|client[_-]?secret|x[_-]?api[_-]?key|bearer|signature)$', re.IGNORECASE)
    if parsed.scheme != 'https' or not parsed.netloc or parsed.username or parsed.password or any(credential_name.fullmatch(name) for name, _ in parse_qsl(parsed.query,keep_blank_values=True)):
        raise ValueError('Credential-free HTTPS source URL required')
    return value


def money(value): return finite(value, 0, MAX_SAFE)


def check_common(row, names=()):
    for key in ('id', 'providerId', 'instrumentId', 'adjustmentVersion', 'conversionVersion'):
        if key in row: row[key] = string(row[key], 240)
    for key in ('name', 'analyst', 'institution', 'rating', 'previousRating', 'label', 'description', 'provider', 'permittedUse', 'costAssumptionsNote'):
        if key in row and row[key] is not None: row[key] = string(row[key])
    for key in ('sourceUrl', 'outcomeSourceUrl'):
        if key in row: url(row[key])
    for key in ('publishedAt', 'updatedAt', 'receivedAt', 'eventAt'):
        if key in row and row[key] is not None: instant(row[key])
    if 'mode' in row: enum(row['mode'], MODES)
    for key in names: boolean(row[key])


def parse_consensus_case(value):
    data = copy.deepcopy(value)
    if isinstance(data, dict) and 'contextRecords' not in data: data['contextRecords']=[]
    strict(data, 'version id name mode providers recommendations headlines webClaims contextRecords instruments portfolios calendar prices fx ablations', 'consensus case')
    if data['version'] != VERSION: raise ValueError('Unsupported consensus version')
    data['id'] = string(data['id'], 240); data['name'] = string(data['name']); enum(data['mode'], MODES)
    maxima = dict(providers=100, recommendations=10000, headlines=2000, webClaims=1000, contextRecords=1000, instruments=100, portfolios=100, prices=20000, fx=20000, ablations=10000)
    for key, maximum in maxima.items(): seq(data[key], maximum)
    for p in data['providers']:
        strict(p, 'id name sourceUrl licensed permittedUse mode ratingScale coverage', 'provider'); check_common(p, ('licensed',))
        for r in seq(p['ratingScale'], 100):
            strict(r, 'raw normalized'); r['raw'] = string(r['raw'], 240); enum(r['normalized'], ('positive', 'neutral', 'negative'))
        c = strict(p['coverage'], 'startAt endAt publishedAt receivedAt complete symbols analystUniverse', 'coverage')
        for field in ('startAt', 'endAt', 'publishedAt', 'receivedAt'): instant(c[field])
        boolean(c['complete']); c['analystUniverse'] = string(c['analystUniverse'])
        for s in seq(c['symbols'], 3): enum(s, SYMBOLS)
        if c['startAt'] > c['endAt'] or c['publishedAt'] > c['receivedAt']: raise ValueError('Provider coverage dates invalid')
        if len({r['raw'] for r in p['ratingScale']}) != len(p['ratingScale']) or len(set(c['symbols'])) != len(c['symbols']): raise ValueError('Provider declarations must be unique')
    for r in data['recommendations']:
        strict(r, 'id providerId analyst institution symbol rating previousRating target previousTarget targetCurrency publishedAt updatedAt receivedAt sourceUrl mode supersedes', 'recommendation'); check_common(r); enum(r['symbol'], SYMBOLS)
        for key in ('target', 'previousTarget'):
            if r[key] is not None: money(r[key])
        if r['targetCurrency'] is not None: currency(r['targetCurrency'])
        if any(r[k] is not None for k in ('target', 'previousTarget')) and r['targetCurrency'] is None: raise ValueError('Target currency required')
        if not r['publishedAt'] <= r['updatedAt'] <= r['receivedAt']: raise ValueError('Recommendation timestamps reversed')
        if r['supersedes'] is not None: r['supersedes'] = string(r['supersedes'], 240)
    for r in data['headlines']:
        strict(r, 'id providerId symbol label analystCount publishedAt updatedAt receivedAt sourceUrl mode'); check_common(r); enum(r['symbol'], SYMBOLS)
        if r['analystCount'] is not None: integer(r['analystCount'], 0, 100000)
        if not r['publishedAt'] <= r['updatedAt'] <= r['receivedAt']: raise ValueError('Headline timestamps reversed')
    for r in data['webClaims']:
        strict(r, 'id symbol description sourceUrl publishedAt receivedAt kind verification mode'); check_common(r)
        if r['symbol'] is not None: enum(r['symbol'], SYMBOLS)
        enum(r['kind'], ('rating', 'target', 'market_reaction', 'narrative')); enum(r['verification'], ('unverified',))
        if r['publishedAt'] is not None and r['publishedAt'] > r['receivedAt']: raise ValueError('Web receipt precedes publication')
    for r in data['contextRecords']:
        strict(r,'id symbol kind sourceUrl publishedAt publicationDate receivedAt recordJson mode');check_common(r);enum(r['symbol'],SYMBOLS);enum(r['kind'],('fundamentals','news'))
        if r['publicationDate'] is not None and (not isinstance(r['publicationDate'],str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',r['publicationDate'])): raise ValueError('Publication date must retain date precision')
        if not isinstance(r['recordJson'],str) or not 1<=len(r['recordJson'])<=150000: raise ValueError('Structured context JSON required')
        parsed=json.loads(r['recordJson'],parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Invalid JSON constant')))
        if not isinstance(parsed,dict): raise ValueError('Context must contain a structured JSON object')
        if r['publishedAt'] is not None and r['publishedAt']>r['receivedAt']: raise ValueError('Context receipt precedes publication')
    for i in data['instruments']:
        strict(i, 'id name symbol product currency sourceUrl globalDiversificationVerified leverageFactor researchApproved publishedAt receivedAt mode'); check_common(i, ('globalDiversificationVerified', 'researchApproved')); i['symbol'] = string(i['symbol'], 240)
        enum(i['product'], ('equity', 'etf', 'cash')); currency(i['currency'])
        if i['leverageFactor'] != 1 or isinstance(i['leverageFactor'], bool): raise ValueError('No leverage permitted')
        if i['publishedAt'] > i['receivedAt']: raise ValueError('Instrument receipt precedes publication')
    for p in data['portfolios']:
        strict(p, 'id name planType initialCapitalGbp allocations entryCostsGbp exitCostsGbp annualFeesBps cashAnnualRate costAssumptionsNote mode'); check_common(p); enum(p['planType'], ('ai_equal', 'diversified', 'custom'))
        if p['initialCapitalGbp'] != 500 or isinstance(p['initialCapitalGbp'], bool): raise ValueError('All research portfolios require 500 GBP initial capital')
        for a in seq(p['allocations'], 100, 1):
            strict(a, 'instrumentId weight'); a['instrumentId'] = string(a['instrumentId'], 240); finite(a['weight'], 0, 1)
            if a['weight'] == 0: raise ValueError('Positive allocation required')
        for key in ('entryCostsGbp', 'exitCostsGbp', 'annualFeesBps'):
            if p[key] is not None: money(p[key])
        if p['cashAnnualRate'] is not None: finite(p['cashAnnualRate'], -1, 1)
        if abs(sum(a['weight'] for a in p['allocations']) - 1) > 1e-10 or len({a['instrumentId'] for a in p['allocations']}) != len(p['allocations']): raise ValueError('Fully funded long-only unique weights must total 100%')
        if p['entryCostsGbp'] is not None and p['exitCostsGbp'] is not None and p['entryCostsGbp'] + p['exitCostsGbp'] >= 500: raise ValueError('Costs must leave investable research capital')
    calendar = data['calendar']
    if calendar is not None:
        strict(calendar, 'id sourceUrl verified publishedAt receivedAt session sessionCloses mode'); check_common(calendar, ('verified',)); enum(calendar['session'], ('regular',))
        for t in seq(calendar['sessionCloses'], 10000, 2): instant(t)
        if calendar['publishedAt'] > calendar['receivedAt'] or any(t <= calendar['sessionCloses'][j-1] for j,t in enumerate(calendar['sessionCloses']) if j): raise ValueError('Calendar dates invalid')
    for p in data['prices']:
        strict(p, 'id instrumentId provider sourceUrl licensed permittedUse eventAt publishedAt receivedAt currency close priceBasis adjustmentVersion session corporateActionsReviewed mode supersedes'); check_common(p, ('licensed', 'corporateActionsReviewed')); currency(p['currency']); finite(p['close'], 0, MAX_SAFE)
        if p['close'] == 0: raise ValueError('Positive price required')
        enum(p['priceBasis'], ('total-return', 'split-adjusted')); enum(p['session'], ('regular',))
        if not p['eventAt'] <= p['publishedAt'] <= p['receivedAt']: raise ValueError('Price timestamps reversed')
        if p['supersedes'] is not None: p['supersedes'] = string(p['supersedes'], 240)
    for f in data['fx']:
        strict(f, 'id provider sourceUrl licensed permittedUse from to eventAt publishedAt receivedAt rate conversionVersion mode supersedes'); check_common(f, ('licensed',)); currency(f['from']); enum(f['to'], ('GBP',)); finite(f['rate'], 0, MAX_SAFE)
        if f['rate'] == 0 or f['from'] == 'GBP' or not f['eventAt'] <= f['publishedAt'] <= f['receivedAt']: raise ValueError('FX definition or timestamps invalid')
        if f['supersedes'] is not None: f['supersedes'] = string(f['supersedes'], 240)
    for r in data['ablations']:
        strict(r, 'id holdoutId symbol horizonSessions benchmarkInstrumentId priceBasis currency targetDefinition protocolRegisteredAt trainingEndAt evidenceCutoff submittedAt startAt endAt outcomeReceivedAt mode baselineInputId modelProtocolId predictions relativeOutcome outcomeSourceUrl missingInputPolicy missingInputs outcomeVerified'); check_common(r, ('outcomeVerified',))
        for field in ('holdoutId', 'baselineInputId', 'modelProtocolId','benchmarkInstrumentId'): r[field] = string(r[field], 240)
        for field in ('protocolRegisteredAt','trainingEndAt', 'evidenceCutoff', 'submittedAt', 'startAt', 'endAt', 'outcomeReceivedAt'): instant(r[field])
        enum(r['symbol'],SYMBOLS);enum(r['horizonSessions'],WINDOWS);enum(r['priceBasis'],('total-return','split-adjusted'));enum(r['currency'],('GBP',));r['targetDefinition']=string(r['targetDefinition'])
        enum(r['mode'], ('forward',)); enum(r['missingInputPolicy'], ('explicit_abstention',))
        for field in seq(r['missingInputs'], 100): string(field, 240)
        strict(r['predictions'], 'pricesFundamentals plusConsensusLabel plusAnalystRevisions')
        for v in r['predictions'].values(): finite(v)
        finite(r['relativeOutcome'])
        if not (r['trainingEndAt']<=r['protocolRegisteredAt']<=r['evidenceCutoff'] and r['trainingEndAt'] < r['evidenceCutoff'] <= r['submittedAt'] <= r['startAt'] < r['endAt'] <= r['outcomeReceivedAt']): raise ValueError('Ablation chronological split introduces look-ahead')
    for key in maxima:
        if len({r['id'] for r in data[key]}) != len(data[key]): raise ValueError('Register IDs must be unique')
    feature_rows=data['recommendations']+data['headlines']+data['contextRecords']+data['prices']+data['fx']
    if len({r['id'] for r in feature_rows})!=len(feature_rows):raise ValueError('Feature evidence IDs must be globally unique')
    records = [r for k in maxima if k != 'ablations' for r in data[k]] + ([calendar] if calendar else [])
    if any(r['mode'] != data['mode'] for r in records) or data['mode'] != 'forward' and data['ablations']: raise ValueError('Synthetic, retrospective and forward evidence cannot be silently combined')
    providers = {p['id'] for p in data['providers']}; instruments = {i['id']:i for i in data['instruments']}
    if any(r['providerId'] not in providers for r in data['recommendations'] + data['headlines']) or any(p['instrumentId'] not in instruments for p in data['prices']): raise ValueError('Missing provider or instrument identity')
    for p in data['portfolios']:
        rows = [instruments.get(a['instrumentId']) for a in p['allocations']]
        if any(r is None for r in rows): raise ValueError('Portfolio instrument missing')
        if any(i['product'] == 'cash' and i['currency'] != 'GBP' for i in rows): raise ValueError('Research cash reserve must be denominated in GBP')
        if p['planType'] == 'ai_equal' and (len(rows) != 3 or {i['symbol'] for i in rows} != set(SYMBOLS) or any(i['product'] != 'equity' for i in rows) or any(abs(a['weight']-1/3)>1e-10 for a in p['allocations'])): raise ValueError('AI equal plan requires equal NVDA/MSFT/AAPL weights')
        if p['planType'] == 'diversified' and (not any(i['product']=='cash' for i in rows) or not any(i['product']=='etf' and i['globalDiversificationVerified'] for i in rows) or any(i['product'] not in ('etf','cash') for i in rows)): raise ValueError('Diversified comparison requires verified global ETF exposure plus GBP cash')
    def revisions(rows, same):
        index = {r['id']:r for r in rows}
        for r in rows:
            seen={r['id']}; current=r
            while current['supersedes']:
                prior=index.get(current['supersedes'])
                if prior is None or prior['id'] in seen or not same(r, prior) or prior['receivedAt'] > current['receivedAt']: raise ValueError('Revision chains must preserve identity and ordered receipt history')
                seen.add(prior['id']); current=prior
    revisions(data['recommendations'], lambda a,b: all(a[k]==b[k] for k in ('providerId','analyst','institution','symbol')))
    revisions(data['prices'], lambda a,b: all(a[k]==b[k] for k in ('instrumentId','eventAt')))
    revisions(data['fx'], lambda a,b: all(a[k]==b[k] for k in ('from','to','eventAt')))
    return data


DAY = 86400000


def available(row, cutoff):
    return row['publishedAt'] <= cutoff and row['receivedAt'] <= cutoff and row.get('updatedAt', cutoff) <= cutoff


def recommendation_key(row):
    return tuple(row[k] for k in ('providerId', 'analyst', 'institution', 'symbol'))


def freeze_consensus_case(value, cutoff):
    data = parse_consensus_case(value); instant(cutoff); excluded = []
    def choose(rows, test, reason):
        result=[]
        for row in rows:
            if test(row): result.append(row)
            else: excluded.append(dict(id=row['id'], reason=reason(row) if callable(reason) else reason))
        return result
    providers=choose(data['providers'], lambda p: available(p['coverage'],cutoff) and p['licensed'] and p['permittedUse'] is not None,
                     lambda p: 'Licensed permitted use has not been established' if not p['licensed'] or p['permittedUse'] is None else 'Provider coverage metadata unavailable at cutoff')
    provider_ids={p['id'] for p in providers}
    instruments=choose(data['instruments'], lambda i: available(i,cutoff) and i['researchApproved'], 'Instrument specification or research approval unavailable at cutoff')
    instrument_ids={i['id'] for i in instruments}
    recommendations=choose(data['recommendations'], lambda r: available(r,cutoff) and r['providerId'] in provider_ids, 'Recommendation unavailable or provider use unlicensed')
    headlines=choose(data['headlines'], lambda r: available(r,cutoff) and r['providerId'] in provider_ids, 'Headline unavailable or provider use unlicensed')
    prices=choose(data['prices'], lambda r: available(r,cutoff) and r['eventAt']<=cutoff and r['licensed'] and r['permittedUse'] is not None and r['instrumentId'] in instrument_ids, 'Price unavailable, unlicensed or instrument unapproved')
    fx=choose(data['fx'], lambda r: available(r,cutoff) and r['eventAt']<=cutoff and r['licensed'] and r['permittedUse'] is not None, 'FX unavailable or unlicensed')
    portfolios=[p for p in data['portfolios'] if all(a['instrumentId'] in instrument_ids for a in p['allocations'])]
    calendar=data['calendar'] if data['calendar'] and available(data['calendar'],cutoff) else None
    def context_eligible(r):
        bound=r['publishedAt']
        if bound is None and r['publicationDate']:
            try: bound=datetime.fromisoformat(r['publicationDate']).replace(tzinfo=timezone.utc).timestamp()*1000+32*3600000-1
            except ValueError: bound=None
        return bound is not None and bound<=cutoff and r['receivedAt']<=cutoff
    context=choose(data['contextRecords'],context_eligible,'Context publication or actual receipt unavailable at cutoff')
    frozen={**data, 'providers':providers,'recommendations':recommendations,'headlines':headlines,'webClaims':[],'contextRecords':context,'instruments':instruments,'portfolios':portfolios,'calendar':calendar,'prices':prices,'fx':fx,'ablations':[]}
    return dict(version=VERSION,cutoff=cutoff,case=frozen,excluded=excluded,executionAuthority='none')


def active_rows(rows, cutoff, lookback_days):
    eligible=[r for r in rows if available(r,cutoff) and r['publishedAt']>=cutoff-lookback_days*DAY]
    superseded={r['supersedes'] for r in eligible}; groups={}
    for r in eligible:
        if r['id'] not in superseded: groups.setdefault(recommendation_key(r),[]).append(r)
    result=[]
    for group in groups.values():
        group.sort(key=lambda r:(r['updatedAt'],r['publishedAt'],r['receivedAt']),reverse=True)
        if len(group)>1 and all(group[0][k]==group[1][k] for k in ('updatedAt','publishedAt','receivedAt')): raise ValueError('Ambiguous active analyst observations require reconciliation')
        result.append(group[0])
    return result


def target_stats(rows):
    targets=[r for r in rows if r['target'] is not None]; currencies={r['targetCurrency'] for r in targets}
    if not targets or len(currencies)!=1 or None in currencies:
        return dict(count=len(targets),currency=None,mean=None,median=None,reason='Incompatible target currencies' if targets else 'No eligible targets')
    values=sorted(r['target'] for r in targets)
    return dict(count=len(values),currency=next(iter(currencies)),mean=sum(values)/len(values),median=statistics.median(values),reason=None)


def consensus_summary(value, ticker, provider_id, cutoff, lookback_days=365):
    enum(ticker,SYMBOLS); integer(lookback_days,1,3650)
    frozen=freeze_consensus_case(value,cutoff); data=frozen['case']; provider=next((p for p in data['providers'] if p['id']==provider_id),None)
    base=dict(version=VERSION,symbol=ticker,providerId=provider_id,cutoff=cutoff,lookbackDays=lookback_days,mode=data['mode'],executionAuthority='none')
    if provider is None:
        return {**base,'status':'unavailable','reason':'Licensed provider and eligible coverage metadata required','provider':None,'coverageComplete':False,'rows':[],'analystCount':0,'distribution':None,'targets':dict(count=0,currency=None,mean=None,median=None,reason='Licensed data unavailable'),'headline':None}
    c=provider['coverage']; complete=c['complete'] and ticker in c['symbols'] and c['startAt']<=cutoff-lookback_days*DAY and c['endAt']>=cutoff
    rows=active_rows([r for r in data['recommendations'] if r['providerId']==provider_id and r['symbol']==ticker],cutoff,lookback_days)
    headlines=sorted([h for h in data['headlines'] if h['providerId']==provider_id and h['symbol']==ticker],key=lambda h:(h['updatedAt'],h['receivedAt']),reverse=True)
    if len(headlines)>1 and all(headlines[0][k]==headlines[1][k] for k in ('updatedAt','receivedAt')): raise ValueError('Ambiguous provider headline revisions')
    distribution=dict(positive=0,neutral=0,negative=0,unmapped=0); scale={r['raw']:r['normalized'] for r in provider['ratingScale']}
    for row in rows: distribution[scale.get(row['rating'],'unmapped')]+=1
    return {**base,'status':'complete' if complete else 'partial','reason':None if complete else 'Observed licensed sample only; coverage does not establish a complete market consensus','provider':provider,'coverageComplete':complete,'rows':rows,'analystCount':len(rows),'distribution':distribution,'targets':target_stats(rows),'headline':headlines[0] if headlines else None}


def consensus_revisions(value,ticker,provider_id,cutoff,days,lookback_days=365):
    enum(days,(7,30,90)); current=consensus_summary(value,ticker,provider_id,cutoff,lookback_days); prior=consensus_summary(value,ticker,provider_id,cutoff-days*DAY,lookback_days); provider=current['provider']
    empty=dict(matchedAnalysts=0,ratingUpgrades=0,ratingDowngrades=0,ratingUnchanged=0,rawRatingChanges=0,targetRaised=0,targetLowered=0,targetUnchanged=0,targetMissing=0,targetMeanChangePct=None,targetMeanChange=None,targetCurrency=None)
    def calculate(pairs):
        result={**empty,'matchedAnalysts':len(pairs)}; percentages=[]; absolutes=[]; currencies=set(); scale={r['raw']:r['normalized'] for r in provider['ratingScale']} if provider else {}; rank=dict(negative=-1,neutral=0,positive=1)
        for p in pairs:
            before=scale.get(p['beforeRating']); after=scale.get(p['afterRating'])
            if before is not None and after is not None:
                result['ratingUpgrades' if rank[after]>rank[before] else 'ratingDowngrades' if rank[after]<rank[before] else 'ratingUnchanged']+=1
            if p['beforeRating'] is not None and p['beforeRating']!=p['afterRating']: result['rawRatingChanges']+=1
            if any(p[k] is None for k in ('beforeTarget','afterTarget','currency')): result['targetMissing']+=1; continue
            currencies.add(p['currency']); delta=p['afterTarget']-p['beforeTarget']; absolutes.append(delta)
            if p['beforeTarget']>0: percentages.append(p['afterTarget']/p['beforeTarget']-1)
            result['targetRaised' if delta>0 else 'targetLowered' if delta<0 else 'targetUnchanged']+=1
        if len(currencies)==1:
            result.update(targetCurrency=next(iter(currencies)),targetMeanChange=sum(absolutes)/len(absolutes) if absolutes else None,targetMeanChangePct=sum(percentages)/len(percentages) if percentages else None)
        return result
    prior_map={recommendation_key(r):r for r in prior['rows']}; current_keys={recommendation_key(r) for r in current['rows']}; pairs=[]
    for r in current['rows']:
        old=prior_map.get(recommendation_key(r))
        if old: pairs.append(dict(beforeRating=old['rating'],afterRating=r['rating'],beforeTarget=old['target'],afterTarget=r['target'],currency=r['targetCurrency'] if old['targetCurrency']==r['targetCurrency'] else None))
    events=[r for r in freeze_consensus_case(value,cutoff)['case']['recommendations'] if r['providerId']==provider_id and r['symbol']==ticker and cutoff-days*DAY<r['publishedAt']<=cutoff]
    event_pairs=[dict(beforeRating=r['previousRating'],afterRating=r['rating'],beforeTarget=r['previousTarget'],afterTarget=r['target'],currency=r['targetCurrency']) for r in events]
    matched=prior['status']!='unavailable' and current['status']!='unavailable'
    return dict(version=VERSION,symbol=ticker,providerId=provider_id,days=days,cutoff=cutoff,current=current,prior=prior,
        matchedCohort=dict(status='available' if matched else 'unavailable',reason=None if matched else 'Earlier actual receipt-time archives are unavailable; event previous values cannot reconstruct a past consensus',**(calculate(pairs) if matched else empty),addedCoverage=len([r for r in current['rows'] if recommendation_key(r) not in prior_map]) if matched else None,removedCoverage=len([r for r in prior['rows'] if recommendation_key(r) not in current_keys]) if matched else None),
        reportedEvents=dict(status='observed_events_only' if provider else 'unavailable',rows=events,**calculate(event_pairs),limitation='Provider-reported event comparisons are not an earlier point-in-time consensus snapshot'),
        headlineChange=dict(previous=prior['headline']['label'] if prior['headline'] else None,current=current['headline']['label'] if current['headline'] else None,changed=prior['headline']['label']!=current['headline']['label'] if prior['headline'] and current['headline'] else None,limitation='A provider label may change through composition or methodology; it is not an analyst upgrade count'),executionAuthority='none')


def validate_consensus_portfolio(value, registry):
    instruments=registry if isinstance(registry,list) else registry['instruments']
    data=dict(version=VERSION,id='portfolio-validation',name='Research portfolio validation',mode=value['mode'],providers=[],recommendations=[],headlines=[],webClaims=[],instruments=instruments,portfolios=[value],calendar=None,prices=[],fx=[],ablations=[])
    plan=parse_consensus_case(data)['portfolios'][0]
    if any(not next(i for i in instruments if i['id']==a['instrumentId'])['researchApproved'] for a in plan['allocations']): raise ValueError('Every custom instrument needs sourced research approval')
    return plan


def build_consensus_study(value, options):
    data=parse_consensus_case(value); strict(options,'name cutoff startAt registeredAt benchmarkInstrumentId priceBasis adjustmentVersion','study options'); string(options['name'])
    for field in ('cutoff','startAt','registeredAt'): instant(options[field])
    if options['cutoff']>options['registeredAt'] or data['mode']=='forward' and (options['registeredAt']>options['startAt'] or options['cutoff']>options['startAt']): raise ValueError('Forward registration and evidence must precede the entry session')
    frozen=freeze_consensus_case(data,options['cutoff']); evidence=frozen['case']; benchmark=next((i for i in evidence['instruments'] if i['id']==options['benchmarkInstrumentId']),None)
    if benchmark is None or benchmark['product']=='cash': raise ValueError('A sourced, approved noncash benchmark is required')
    enum(options['priceBasis'],('total-return','split-adjusted')); string(options['adjustmentVersion'],240)
    c=evidence['calendar']; index=c['sessionCloses'].index(options['startAt']) if c and options['startAt'] in c['sessionCloses'] else -1
    windows=[]
    for p in evidence['portfolios']:
        for horizon in WINDOWS:
            end=c['sessionCloses'][index+horizon] if c and c['verified'] and index>=0 and index+horizon<len(c['sessionCloses']) else None
            window_id=f"{data['id']}:{p['id']}:{horizon}"
            string(window_id,240)
            windows.append(dict(id=window_id,version=VERSION,caseId=data['id'],portfolioId=p['id'],portfolioSnapshot=copy.deepcopy(p),instrumentSnapshots=copy.deepcopy(evidence['instruments']),calendarSnapshot=copy.deepcopy(c),mode=data['mode'],cutoff=options['cutoff'],registeredAt=options['registeredAt'],startAt=options['startAt'],endAt=end,horizon=horizon,horizonSessions=horizon,calendarId=c['id'] if c else None,benchmarkInstrumentId=options['benchmarkInstrumentId'],priceBasis=options['priceBasis'],adjustmentVersion=options['adjustmentVersion'],currency='GBP',session='regular'))
    baseline_ids=[r['id'] for r in evidence['contextRecords']+evidence['prices']+evidence['fx']];headline_ids=[r['id'] for r in evidence['headlines']];revision_ids=[r['id'] for r in evidence['recommendations']]
    arms=[dict(id='prices_fundamentals',inputIds=baseline_ids),dict(id='plus_consensus_label',inputIds=baseline_ids+headline_ids),dict(id='plus_analyst_revisions',inputIds=baseline_ids+headline_ids+revision_ids)]
    return dict(version=VERSION,name=options['name'],caseId=data['id'],mode=data['mode'],cutoff=options['cutoff'],startAt=options['startAt'],registeredAt=options['registeredAt'],evidence=evidence,excluded=frozen['excluded'],portfolios=evidence['portfolios'],windows=windows,arms=arms,
        interpretation='Retrospective return comparison; evidence may have been received after entry and does not establish a forward signal' if data['mode']=='retrospective' else 'Registered research comparison; genuine forward status requires authenticated server registration',capitalPolicy='Independent £500 research calculations do not amend the existing paper-ledger minimum capital or risk policy',executionAuthority='none')


def parse_window(value):
    w=copy.deepcopy(value)
    strict(w,'id version caseId portfolioId portfolioSnapshot instrumentSnapshots calendarSnapshot mode cutoff registeredAt startAt endAt horizon horizonSessions calendarId benchmarkInstrumentId priceBasis adjustmentVersion currency session','window')
    if w['version']!=VERSION: raise ValueError('Unsupported window version')
    for field in ('id','caseId','portfolioId','benchmarkInstrumentId','adjustmentVersion'): w[field]=string(w[field],240)
    for field in ('cutoff','registeredAt','startAt'): instant(w[field])
    if w['endAt'] is not None: instant(w['endAt'])
    if w['calendarId'] is not None: string(w['calendarId'],240)
    enum(w['horizon'],WINDOWS);enum(w['horizonSessions'],WINDOWS);enum(w['mode'],MODES);enum(w['currency'],('GBP',));enum(w['session'],('regular',));enum(w['priceBasis'],('total-return','split-adjusted'))
    # Reuse structural source validation without creating orders or granting approval.
    skeleton=dict(version=VERSION,id='window-structure',name='Window structural validation',mode=w['portfolioSnapshot']['mode'],providers=[],recommendations=[],headlines=[],webClaims=[],instruments=w['instrumentSnapshots'],portfolios=[w['portfolioSnapshot']],calendar=w['calendarSnapshot'],prices=[],fx=[],ablations=[])
    parse_consensus_case(skeleton)
    if w['portfolioId']!=w['portfolioSnapshot']['id'] or w['horizon']!=w['horizonSessions']: raise ValueError('Window must preserve its portfolio and horizon identity')
    return w


def evaluate_consensus_window(value,registration,as_of):
    data=parse_consensus_case(value);w=parse_window(registration);instant(as_of)
    base=dict(version=VERSION,windowId=w['id'],portfolioId=w['portfolioId'],horizon=w['horizon'],startAt=w['startAt'],endAt=w['endAt'],mode=w['mode'],executionAuthority='none')
    def pending(reason): return {**base,'status':'pending','reason':reason,'result':None}
    try:
        if data['mode']!=w['mode'] or w['portfolioSnapshot']['mode']!=w['mode']: raise ValueError('Synthetic, retrospective and forward observations cannot be combined')
        if w['cutoff']>w['registeredAt'] or w['mode']=='forward' and (w['registeredAt']>w['startAt'] or w['cutoff']>w['startAt']): raise ValueError('Forward entry cannot precede registration or evidence eligibility')
        c=w['calendarSnapshot']
        if not c or not c['verified'] or c['id']!=w['calendarId'] or not available(c,w['cutoff']): raise ValueError('Verified calendar known at registration is required')
        start_index=c['sessionCloses'].index(w['startAt']) if w['startAt'] in c['sessionCloses'] else -1
        end=c['sessionCloses'][start_index+w['horizon']] if start_index>=0 and start_index+w['horizon']<len(c['sessionCloses']) else None
        if w['endAt'] is None or end is None or end!=w['endAt']: raise ValueError('Full aligned session window has not been registered')
        if as_of<w['endAt']: raise ValueError('Outcome window has not completed')
        sessions=c['sessionCloses'][start_index:start_index+w['horizon']+1]
        p=validate_consensus_portfolio(w['portfolioSnapshot'],w['instrumentSnapshots'])
        if any(p[k] is None for k in ('entryCostsGbp','exitCostsGbp','annualFeesBps')): raise ValueError('Net outcome pending: all entry, exit and ongoing costs must be explicitly declared')
        source_ids=[];price_providers={};fx_conventions={}
        def remember(id):
            if id not in source_ids: source_ids.append(id)
        def gbp_path(instrument_id):
            i=next((i for i in w['instrumentSnapshots'] if i['id']==instrument_id),None)
            if not i or not i['researchApproved'] or i['mode']!=w['mode'] or not available(i,w['cutoff']): raise ValueError('Registered instrument specification is missing or was unavailable')
            if i['product']=='cash':
                if i['currency']!='GBP' or p['cashAnnualRate'] is None: raise ValueError('Explicit GBP cash return assumption required')
                return [(1+p['cashAnnualRate'])**((t-w['startAt'])/(365.25*DAY)) for t in sessions]
            result=[]
            for event_at in sessions:
                matches=[r for r in data['prices'] if r['instrumentId']==instrument_id and r['eventAt']==event_at and available(r,as_of) and r['licensed'] and r['permittedUse'] is not None]
                old={r['supersedes'] for r in matches};active=[r for r in matches if r['id'] not in old]
                if len(active)!=1: raise ValueError('Exactly one eligible licensed price per instrument and session is required')
                bar=active[0]
                if bar['currency']!=i['currency'] or bar['priceBasis']!=w['priceBasis'] or bar['adjustmentVersion']!=w['adjustmentVersion'] or bar['session']!=w['session'] or not bar['corporateActionsReviewed']: raise ValueError('Price basis, currency, session or corporate-action review is incompatible')
                if instrument_id in price_providers and price_providers[instrument_id]!=bar['provider']: raise ValueError('One compatible provider history per instrument required')
                price_providers[instrument_id]=bar['provider'];remember(bar['id'])
                if i['currency']=='GBP': result.append(bar['close']);continue
                rows=[r for r in data['fx'] if r['from']==i['currency'] and r['eventAt']==event_at and available(r,as_of) and r['licensed'] and r['permittedUse'] is not None]
                old_fx={r['supersedes'] for r in rows};active_fx=[r for r in rows if r['id'] not in old_fx]
                if len(active_fx)!=1: raise ValueError('Explicit same-session licensed GBP FX observation is required')
                f=active_fx[0];convention=f"{f['provider']}|{f['conversionVersion']}"
                if i['currency'] in fx_conventions and fx_conventions[i['currency']]!=convention: raise ValueError('FX provider and conversion basis must remain consistent')
                fx_conventions[i['currency']]=convention;remember(f['id']);result.append(bar['close']*f['rate'])
            return result
        paths=[dict(weight=a['weight'],values=gbp_path(a['instrumentId'])) for a in p['allocations']];benchmark=gbp_path(w['benchmarkInstrumentId'])
        deployed=500-p['entryCostsGbp']-p['exitCostsGbp'];growth=[sum(path['weight']*path['values'][j]/path['values'][0] for path in paths) for j,_ in enumerate(sessions)]
        net_path=[deployed*g*math.exp(-p['annualFeesBps']/10000*(sessions[j]-w['startAt'])/(365.25*DAY)) for j,g in enumerate(growth)]
        ending=net_path[-1];gross_return=growth[-1]-1;benchmark_return=benchmark[-1]/benchmark[0]-1;net_return=ending/500-1
        peak=500;max_drawdown=0
        for val in net_path: peak=max(peak,val);max_drawdown=min(max_drawdown,val/peak-1)
        fee_cost=deployed*growth[-1]-ending
        for val in (ending,gross_return,benchmark_return,net_return,max_drawdown,fee_cost):finite(val,-MAX_SAFE,MAX_SAFE)
        result=dict(initialCapitalGbp=500,deployedCapitalGbp=deployed,endingCapitalGbp=ending,grossReturn=gross_return,netReturn=net_return,absoluteReturn=net_return,benchmarkReturn=benchmark_return,benchmarkRelativeReturn=net_return-benchmark_return,grossBenchmarkRelativeReturn=gross_return-benchmark_return,maxDrawdown=max_drawdown,entryCostsGbp=p['entryCostsGbp'],exitCostsGbp=p['exitCostsGbp'],ongoingFeeGbp=fee_cost,sourceIds=source_ids,path=[dict(at=t,netValueGbp=net_path[j],grossValueGbp=500*growth[j]) for j,t in enumerate(sessions)],benchmarkCostBasis='Gross benchmark return; no hypothetical benchmark dealing fee is inferred',costConvention='Entry and exit costs reserved within initial capital; declared additional annual portfolio fee accrues by actual elapsed days / 365.25; adjusted ETF prices already reflect fund expenses',executionAuthority='none')
        return {**base,'status':'complete','reason':None,'result':result}
    except (ValueError,OverflowError,ZeroDivisionError) as error:return pending(str(error))


def consensus_ablation_report(value,as_of,minimum_cases=30):
    data=parse_consensus_case(value);instant(as_of);integer(minimum_cases,10)
    eligible=[r for r in data['ablations'] if r['outcomeVerified'] and r['outcomeReceivedAt']<=as_of and r['endAt']<=as_of and not r['missingInputs']]
    missing=sum(bool(r['missingInputs']) for r in data['ablations']);unverified=sum(not r['outcomeVerified'] or r['outcomeReceivedAt']>as_of or r['endAt']>as_of for r in data['ablations'])
    if len({r['holdoutId'] for r in eligible})!=len(eligible):raise ValueError('Holdout outcomes cannot be counted twice')
    protocols={tuple(r[k] for k in ('modelProtocolId','symbol','horizonSessions','benchmarkInstrumentId','priceBasis','currency','targetDefinition')) for r in eligible};ready=data['mode']=='forward' and len(eligible)>=minimum_cases and len(protocols)==1
    def mse(field):return sum((r['predictions'][field]-r['relativeOutcome'])**2 for r in eligible)/len(eligible)
    try:
        baseline=mse('pricesFundamentals') if ready else None;label=mse('plusConsensusLabel') if ready else None;revisions=mse('plusAnalystRevisions') if ready else None
        if any(v is not None and (not math.isfinite(v) or abs(v)>MAX_SAFE) for v in (baseline,label,revisions)):raise OverflowError()
    except OverflowError:ready=False;baseline=None;label=None;revisions=None
    return dict(version=VERSION,status='descriptive_out_of_sample_only' if ready else 'insufficient_evidence',pairedHoldouts=len(eligible),minimumCases=minimum_cases,missingInputCases=missing,unverifiedOrPendingCases=unverified,baselineMse=baseline,plusLabelMse=label,plusRevisionsMse=revisions,labelMseImprovement=baseline-label if ready else None,revisionsMseImprovement=baseline-revisions if ready else None,revisionsIncrementalMseImprovement=label-revisions if ready else None,conclusion='Paired forward holdout errors are descriptive only; they do not establish persistent predictive value, causality, statistical significance or a trade recommendation' if ready else 'No incremental value claim is supported until compatible independently verified forward holdouts, all ablation arms and explicit missing-data handling are available',limitation='Imported model protocol and verified-outcome declarations require independent audit; JSON validation does not prove actual feature isolation or an authentic historical registration',executionAuthority='none')


def evaluate(request):
    strict(request,'version case studyOptions asOf','evaluation request')
    if request['version']!=VERSION:raise ValueError('Unsupported evaluation version')
    data=parse_consensus_case(request['case']);options=request['studyOptions'];as_of=instant(request['asOf']);snapshot=freeze_consensus_case(data,options['cutoff']);study=build_consensus_study(data,options)
    summaries=[dict(symbol=ticker,providerId=provider['id'],summary=consensus_summary(data,ticker,provider['id'],options['cutoff']),revisions=[consensus_revisions(data,ticker,provider['id'],options['cutoff'],days) for days in (7,30,90)]) for provider in data['providers'] for ticker in SYMBOLS]
    return dict(version=VERSION,snapshot=snapshot,summaries=summaries,study=study,outcomes=[evaluate_consensus_window(data,w,as_of) for w in study['windows']],ablation=consensus_ablation_report(data,as_of),executionAuthority='none')


def main():
    parser=argparse.ArgumentParser(description='Independent analyst consensus validation; no execution authority');parser.add_argument('input');parser.add_argument('--output');args=parser.parse_args()
    try:
        request=json.loads(Path(args.input).read_text(encoding='utf-8-sig'));encoded=json.dumps(evaluate(request),indent=2,sort_keys=True,allow_nan=False)+'\n'
        if args.output:
            with Path(args.output).open('x',encoding='utf-8') as file:file.write(encoded)
        else: print(encoded,end='')
        return 0
    except (ValueError,KeyError,TypeError,OSError,OverflowError) as error:
        print(json.dumps(dict(error=str(error))),file=sys.stderr);return 2


if __name__=='__main__':raise SystemExit(main())
