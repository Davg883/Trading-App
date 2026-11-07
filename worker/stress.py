"""Versioned market stress calculations. Epoch milliseconds; returns are decimals.

This module does not change Benchmark 001 earnings/scoring formulas. Imports are
caller-supplied records, not evidence that a live data connection is configured.
"""
import argparse
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

from .research import number

VERSION = 'stress-001.1-v1'
UNIVERSE = ('GOOGL', 'AMZN', 'MSFT', 'NVDA', 'INTC', 'CRWV')
DAY = 86_400_000


def source_url(value):
    url = urlparse(value)
    if url.scheme != 'https' or not url.hostname or url.username or url.password:
        raise ValueError('Identifiable HTTPS source without embedded credentials required')
    return value


def validate_bar(bar):
    source_url(bar['sourceUrl'])
    if not bar.get('id') or not bar.get('provider') or bar.get('symbol') not in (*UNIVERSE,'QQQ') or not re.fullmatch('[A-Z]{3}',bar.get('currency','')):
        raise ValueError('Identified instrument/provider and ISO currency required')
    if not isinstance(bar.get('synthetic'),bool) or not isinstance(bar.get('corporateActionsReviewed'),bool):
        raise ValueError('Explicit synthetic and corporate action review flags required')
    if not 0<=number(bar['eventAt'])<=number(bar['receivedAt']) or number(bar['declaredDelayMs'])<0:
        raise ValueError('Nonnegative ordered timestamps and delay required')
    if bar.get('session') not in ('regular','after-hours','pre-market') or bar.get('kind') not in ('daily-bar','quote') or bar.get('priceBasis') not in ('unadjusted','split-adjusted','total-return') or not bar.get('adjustmentVersion'):
        raise ValueError('Explicit session, kind and adjustment basis required')
    if number(bar['close'])<=0 or number(bar['high'])<bar['close']:
        raise ValueError('Positive close and high >= close required')
    return bar


def validate_market(data):
    if data.get('version') != VERSION or not isinstance(data.get('synthetic'), bool):
        raise ValueError('Version and explicit synthetic mode required')
    if not data.get('provider') or not data.get('license'):
        raise ValueError('Provider and licensed-use description required')
    start, end = number(data['coverageStart']), number(data['coverageEnd'])
    if start < 0 or start > end or not isinstance(data.get('bars'), list) or len(data['bars']) > 10_000:
        raise ValueError('Invalid coverage or excessive bar count')
    calendar = data['calendar']
    source_url(calendar['sourceUrl'])
    closes = calendar['sessionCloses']
    if not isinstance(calendar.get('verified'),bool) or not calendar.get('id') or len(closes) < 2 or any(number(t)<0 for t in closes) or any(number(b) <= number(a) for a, b in zip(closes, closes[1:])):
        raise ValueError('Ordered explicit exchange calendar required')
    seen = set(); ids=set()
    for bar in data['bars']:
        validate_bar(bar)
        if not bar.get('id') or bar['id'] in ids or not isinstance(bar.get('corporateActionsReviewed'),bool):
            raise ValueError('Unique observation ID and corporate action review state required')
        ids.add(bar['id'])
        if bar['symbol'] not in (*UNIVERSE, 'QQQ') or bar['provider'] != data['provider'] or bar['synthetic'] is not data['synthetic']:
            raise ValueError('Unexpected instrument/provider or mixed synthetic records')
        source_url(bar['sourceUrl'])
        event, received = number(bar['eventAt']), number(bar['receivedAt'])
        if not start <= event <= end or received < event or number(bar['declaredDelayMs']) < 0:
            raise ValueError('Invalid market timestamps or delay')
        if bar['session'] not in ('regular', 'after-hours', 'pre-market') or bar['kind'] not in ('daily-bar', 'quote'):
            raise ValueError('Explicit session and observation kind required')
        if bar['priceBasis'] not in ('unadjusted', 'split-adjusted', 'total-return') or not bar['adjustmentVersion'] or not bar['currency']:
            raise ValueError('Currency and versioned adjustment basis required')
        if number(bar['close']) <= 0 or number(bar['high']) < bar['close']:
            raise ValueError('Positive close and high >= close required')
        key = (bar['symbol'], event, bar['session'], bar['kind'])
        if key in seen:
            raise ValueError('Duplicate observation window; resolve source versions explicitly')
        seen.add(key)
    return data


def compatible_prices(bars):
    if not bars:
        raise ValueError('Price observations required')
    for bar in bars:validate_bar(bar)
    fields = ('provider', 'currency', 'session', 'priceBasis', 'adjustmentVersion', 'synthetic', 'kind')
    if any(bar.get('corporateActionsReviewed') is not True for bar in bars):
        raise ValueError('Corporate actions must be explicitly reviewed')
    for field in fields:
        if len({bar[field] for bar in bars}) != 1:
            raise ValueError(f'Incompatible price {field}; explicit normalization required')


def relative_return(start, end, qqq_start, qqq_end):
    compatible_prices([start, end, qqq_start, qqq_end])
    if start['symbol'] != end['symbol'] or qqq_start['symbol'] != 'QQQ' or qqq_end['symbol'] != 'QQQ' or start['symbol'] == 'QQQ':
        raise ValueError('Stable company and QQQ identities required')
    if start['eventAt'] != qqq_start['eventAt'] or end['eventAt'] != qqq_end['eventAt'] or end['eventAt'] <= start['eventAt']:
        raise ValueError('Return windows must align exactly')
    absolute = end['close']/start['close']-1
    benchmark = qqq_end['close']/qqq_start['close']-1
    return {'absoluteReturn': absolute, 'benchmarkReturn': benchmark, 'relativeReturn': absolute-benchmark}


def market_summary(data, symbol, as_of):
    validate_market(data)
    number(as_of)
    eligible = [bar for bar in data['bars'] if bar['eventAt'] <= as_of and bar['receivedAt'] <= as_of]
    company = sorted([bar for bar in eligible if bar['symbol'] == symbol], key=lambda bar: (-bar['eventAt'],-bar['receivedAt'],bar['kind']!='quote',bar['id']))
    latest = company[0] if company else None
    closes = [t for t in data['calendar']['sessionCloses'] if t <= as_of and data['coverageStart'] <= t <= data['coverageEnd']]
    def window(days):
        try:
            if data['calendar'].get('verified') is not True or not closes:
                raise ValueError('Verified exchange calendar required')
            end = closes[-1]
            start = closes[-2] if days is None and len(closes) >= 2 else next((t for t in reversed(data['calendar']['sessionCloses']) if days is not None and t <= end-days*DAY), None)
            if start is None or start < data['coverageStart']:
                raise ValueError('Insufficient complete lookback coverage')
            required = [t for t in data['calendar']['sessionCloses'] if start <= t <= end]
            def pick(ticker):
                result=[]
                for instant in required:
                    matches=[bar for bar in eligible if bar['symbol']==ticker and bar['eventAt']==instant and bar['kind']=='daily-bar' and bar['session']=='regular']
                    if len(matches)!=1:
                        raise ValueError('Missing aligned daily bars')
                    result.append(matches[0])
                return result
            bars, qqq = pick(symbol), pick('QQQ')
            for index in range(1,len(bars)):
                relative_return(bars[0],bars[index],qqq[0],qqq[index])
            values=relative_return(bars[0],bars[-1],qqq[0],qqq[-1])
            highs=bars if days is None else [bar for bar in bars if bar['eventAt']>=end-days*DAY]
            wrap=lambda value:{'value':value,'reason':None,'startAt':start,'endAt':end}
            return {'absolute':wrap(values['absoluteReturn']),'relative':wrap(values['relativeReturn']),'drawdown':wrap(bars[-1]['close']/max(bar['high'] for bar in highs)-1)}
        except ValueError as error:
            null={'value':None,'reason':str(error),'startAt':None,'endAt':None}
            return {'absolute':null,'relative':null,'drawdown':null}
    return {'version':VERSION,'latest':latest,'oneSession':window(None),'days30':window(30),'days90':window(90),'weeks52':window(364),'status':'Imported observations; not a live connection' if latest else 'No eligible sourced observations'}


def validate_financial(record):
    number(record['value']);source_url(record['sourceUrl'])
    metrics=('forward_eps','revenue','operating_income','operating_cash_flow','capex','debt','cash','market_cap','preferred_equity','minority_interest','debt_due_12m')
    if record.get('metric') not in metrics or record.get('unit')!=('currency-per-share' if record['metric']=='forward_eps' else 'currency') or not isinstance(record.get('verified'),bool) or not record.get('id'):
        raise ValueError('Metric, unit, ID and verification state required')
    if record['metric'] in ('capex','debt','cash','market_cap','preferred_equity','minority_interest','debt_due_12m') and record['value']<0:
        raise ValueError('Balance and capex outflow must be nonnegative')
    if record.get('symbol') not in UNIVERSE or record.get('kind') not in ('reported','estimated','derived') or record.get('basis') not in ('gaap','non-gaap') or record.get('unit') not in ('currency','currency-per-share'):
        raise ValueError('Financial identity, kind and accounting definition required')
    if not isinstance(record.get('synthetic'),bool) or not record.get('adjustmentVersion') or not re.fullmatch('[A-Z]{3}',record.get('currency','')):
        raise ValueError('Financial currency, corporate-action version and data mode required')
    period=record['period']
    if period.get('scope') not in ('quarter','annual','ttm','forward12m','instant') or not period.get('label') or not 0<=number(period['start'])<=number(period['end']):
        raise ValueError('Explicit financial reporting period required')
    if not 0<=number(record['publishedAt'])<=number(record['receivedAt']):
        raise ValueError('Invalid publication/receipt order')
    if 'collectedAt' in record and number(record['collectedAt'])<0:raise ValueError('Invalid consensus collection timestamp')


def compatible_financial(records, same_period=True):
    if any(r is None for r in records):
        return False
    keys=('symbol','currency','unit','basis','synthetic','adjustmentVersion')
    if any(len({r[k] for r in records})!=1 for k in keys) or same_period and any(any(r['period'][k]!=records[0]['period'][k] for k in ('start','end','scope')) for r in records):
        raise ValueError('Incompatible accounting definition, currency, adjustment basis or period')
    return True


def valuation_reset(request):
    """Null-safe versioned financial KPIs; no implicit FX, consensus or annualisation."""
    def build(snapshot):
        records=snapshot['financials'];as_of=number(snapshot['asOf']);price=snapshot.get('price')
        if price:validate_bar(price)
        for record in records:validate_financial(record)
        if len({r['id'] for r in records})!=len(records):raise ValueError('Duplicate financial observation IDs')
        eligible=[r for r in records if r['verified'] is True and r['publishedAt']<=as_of and r['receivedAt']<=as_of and (r['kind']=='estimated' or r['period']['end']<=r['publishedAt'])]
        if len({r['synthetic'] for r in eligible})>1 or len({r['symbol'] for r in eligible})>1:
            raise ValueError('Synthetic and observed records or issuers cannot be mixed')
        selected={}
        for r in sorted(eligible,key=lambda r:(r['publishedAt'],r['receivedAt']),reverse=True):
            old=selected.get(r['metric'])
            if old and (old['publishedAt'],old['receivedAt'])==(r['publishedAt'],r['receivedAt']):raise ValueError('Ambiguous latest same-time financial observations')
            if old is None:selected[r['metric']]=r
        def calc(names,compute,scope='flow'):
            rows=[selected.get(k) for k in names]
            try:
                if any(r is None for r in rows):raise ValueError('Required verified input unavailable')
                compatible_financial(rows)
                first=rows[0]
                if scope=='flow' and (any(r['kind']!='reported' for r in rows) or first['period']['scope'] not in ('quarter','annual','ttm')):
                    raise ValueError('Compatible reported flow periods required')
                if scope=='instant' and (any(r['kind']=='estimated' for r in rows) or first['period']['scope']!='instant'):
                    raise ValueError('Compatible reported balance sheet dates required')
                if scope=='eps' and (first['kind']!='estimated' or first['period']['scope']!='forward12m' or not first.get('consensusVendor') or first.get('collectedAt') is None or not 0<=number(first['collectedAt'])<=first['receivedAt']<=as_of or first['value']<=0):
                    raise ValueError('Positive authoritative forward consensus with known collection cutoff required')
                return {'value':number(compute(*[r['value'] for r in rows])),'reason':None,'sourceIds':[r['id'] for r in rows]}
            except (ValueError,ZeroDivisionError) as error:return missing(str(error))
        eps=selected.get('forward_eps');forward_eps=calc(['forward_eps'],lambda e:e,'eps');forward_pe=missing('Eligible compatible sourced price and consensus required')
        if price and eps and forward_eps['value'] is not None and price['eventAt']<=as_of and price['receivedAt']<=as_of and all(price[k]==eps[k] for k in ('symbol','currency','synthetic','adjustmentVersion')) and price.get('corporateActionsReviewed') is True and price['priceBasis']!='total-return':
            forward_pe={'value':number(price['close'])/forward_eps['value'],'reason':None,'sourceIds':[price['id'],eps['id']]}
        ev=calc(['market_cap','debt','cash','preferred_equity','minority_interest'],lambda m,d,c,p,i:m+d-c+p+i,'instant')
        revenue=calc(['revenue'],lambda v:v);ev_revenue=missing('Compatible annual or trailing revenue and enterprise value required')
        rev,mc=selected.get('revenue'),selected.get('market_cap')
        if ev['value'] is not None and revenue['value'] is not None and revenue['value']>0 and all(mc[k]==rev[k] for k in ('currency','basis','adjustmentVersion')) and rev['period']['scope'] in ('annual','ttm') and rev['period']['end']<=mc['period']['end']:
            ev_revenue={'value':ev['value']/revenue['value'],'reason':None,'sourceIds':ev['sourceIds']+revenue['sourceIds']}
        def ratio(a,b):
            if b<=0:raise ValueError('Positive denominator required')
            return a/b
        kpis={'forwardPE':forward_pe,'forwardEPS':forward_eps,'enterpriseValue':ev,'evRevenue':ev_revenue,'revenue':revenue,
            'operatingCashFlow':calc(['operating_cash_flow'],lambda c:c),'capex':calc(['capex'],lambda c:c),
            'freeCashFlow':calc(['operating_cash_flow','capex'],lambda c,k:c-k),
            'freeCashFlowMargin':calc(['operating_cash_flow','capex','revenue'],lambda c,k,r:ratio(c-k,r)),
            'capexRevenue':calc(['capex','revenue'],ratio),'netDebt':calc(['debt','cash'],lambda d,c:d-c,'instant'),
            'debtDue12m':calc(['debt_due_12m'],lambda d:d,'instant'),'operatingMargin':calc(['operating_income','revenue'],ratio)}
        return {'records':selected,'eligible':eligible,'kpis':kpis}
    def missing(reason):return {'value':None,'reason':reason,'sourceIds':[]}
    current=build(request);prior=build(request['prior']) if request.get('prior') else None
    def change(key,relative):
        if not prior or request['prior']['asOf']>=request['asOf']:return missing('Earlier compatible observation required')
        metric='forward_eps' if key in ('forwardEPS','forwardPE') else 'operating_income' if key=='operatingMargin' else 'revenue'
        x,y=current['records'].get(metric),prior['records'].get(metric)
        try:
            if not compatible_financial([x,y],False):raise ValueError('Prior input unavailable')
            if x['period']['scope']!=y['period']['scope'] or x.get('consensusVendor')!=y.get('consensusVendor'):raise ValueError('Prior definitions differ')
            if key in ('forwardEPS','forwardPE') and (x['period']['start'],x['period']['end'])!=(y['period']['start'],y['period']['end']):raise ValueError('Consensus forecast horizons differ')
            if key in ('operatingMargin','revenue') and x['period']['start']<=y['period']['end']:raise ValueError('Comparable nonoverlapping reporting periods required')
            a,b=current['kpis'][key],prior['kpis'][key]
            if a['value'] is None or b['value'] is None or relative and b['value']<=0:raise ValueError('Both valid current and prior values required')
            return {'value':a['value']/b['value']-1 if relative else a['value']-b['value'],'reason':None,'sourceIds':a['sourceIds']+b['sourceIds']}
        except ValueError as error:return missing(str(error))
    return {'version':VERSION,'inputs':{kind:[r for r in current['eligible'] if r['kind']==kind] for kind in ('reported','estimated','derived')},'kpis':{**current['kpis'],'forwardPEChange':change('forwardPE',False),'forwardEPSChange':change('forwardEPS',True),'revenueGrowth':change('revenue',True),'operatingMarginChange':change('operatingMargin',False)}}


def valuation(records,cutoff,period=None):
    return valuation_reset({'financials':records,'asOf':cutoff,'price':None})


def classify(review):
    """A conservative research checklist, never an order or numerical score."""
    classification='Insufficient evidence'
    if review.get('evidenceVerified') is True:
        if review.get('fundamentals')=='deteriorating' and any(str(s).strip() for s in review.get('negativeEvidence',[])):
            classification='Fundamental deterioration'
        elif review.get('fundamentals')=='stable' and review.get('valuation')=='reset' and any(str(s).strip() for s in review.get('positiveEvidence',[])) and not review.get('negativeEvidence') and not review.get('uncertainties'):
            classification='Potential valuation opportunity'
    return {'version':VERSION,'classification':classification,'researchOnly':True}


def register_outcome(request):
    r=dict(request);calendar=r['calendar'];closes=calendar['sessionCloses']
    if r.get('version',VERSION)!=VERSION or isinstance(r.get('horizon'),bool) or r.get('horizon') not in (1,5,20,60) or r.get('symbol') not in UNIVERSE or r.get('benchmark')!='QQQ' or r.get('mode') not in ('retrospective','historical-model-replay','forward'):
        raise ValueError('Supported horizon, instrument, benchmark and research mode required')
    if calendar.get('verified') is not True or not calendar.get('id') or any(number(t)<0 for t in closes) or any(number(b)<=number(a) for a,b in zip(closes,closes[1:])):
        raise ValueError('Verified ordered exchange calendar required')
    source_url(calendar['sourceUrl'])
    if r['startAt'] not in closes or closes.index(r['startAt'])+r['horizon']>=len(closes):
        raise ValueError('Calendar must cover complete registered window')
    end=closes[closes.index(r['startAt'])+r['horizon']]
    if 'endAt' in r and r['endAt']!=end:
        raise ValueError('End does not match registered exchange calendar')
    if min(number(r['evidenceCutoff']),number(r['registeredAt']),number(r['startAt']))<0 or number(r['evidenceCutoff'])>min(number(r['registeredAt']),number(r['startAt'])) or r['mode']=='forward' and r['registeredAt']>r['startAt']:
        raise ValueError('Registration or cutoff introduces look-ahead')
    if r.get('session')!='regular' or r.get('priceBasis') not in ('unadjusted','split-adjusted','total-return') or not r.get('provider') or not r.get('adjustmentVersion') or not isinstance(r.get('synthetic'),bool) or not re.fullmatch('[A-Z]{3}',r.get('currency','')):
        raise ValueError('Frozen provider, currency, data mode and price basis required')
    for key in ('spreadBps','slippageBps','tradingCostBps'):
        if key not in r or r[key] is not None and number(r[key])<0:
            raise ValueError('Declare nonnegative cost assumptions or explicit null')
    return {**r,'version':VERSION,'endAt':end}


def outcome(window,data,as_of):
    validate_market(data);r=register_outcome(window);number(as_of)
    if data['synthetic'] is not r['synthetic']:
        raise ValueError('Synthetic and observed outcomes cannot be combined')
    def pending(reason):return {'status':'pending','scores':None,'reason':reason}
    if as_of<r['endAt']:
        return pending('Registered horizon has not completed')
    selected=[]
    for symbol in (r['symbol'],'QQQ'):
        for instant in (r['startAt'],r['endAt']):
            bars=[b for b in data['bars'] if b['symbol']==symbol and b['eventAt']==instant and b['receivedAt']<=as_of and b['kind']=='daily-bar' and all(b[k]==r[k] for k in ('provider','currency','session','priceBasis','adjustmentVersion','synthetic'))]
            if len(bars)!=1:return pending('Unique compatible sourced endpoint observations unavailable')
            selected.append(bars[0])
    try:
        values=relative_return(*selected)
    except ValueError as error:
        return pending(str(error))
    return {'status':'complete',**values,'observations':selected,'costs':{k:r[k] for k in ('spreadBps','slippageBps','tradingCostBps')}}


def main():
    parser = argparse.ArgumentParser(description='Versioned offline stress calculations')
    parser.add_argument('input')
    parser.add_argument('--output')
    args = parser.parse_args()
    try:
        request = json.loads(Path(args.input).read_text(encoding='utf-8-sig'))
        result = {'version': VERSION}
        if 'market' in request:
            result['market'] = market_summary(request['market'], request['symbol'], request['asOf'])
        if 'financials' in request:
            result['valuation'] = valuation_reset(request)
        if 'review' in request:
            result['assessment'] = classify(request['review'])
        if 'window' in request:
            result['outcome'] = outcome(request['window'], request['market'], request['asOf'])
        encoded = json.dumps(result, indent=2, allow_nan=False)
        if args.output:
            with Path(args.output).open('x', encoding='utf-8') as file:
                file.write(encoded+'\n')
        else:
            print(encoded)
        return 0
    except (ValueError, KeyError, TypeError, OSError) as error:
        print(json.dumps({'error': str(error)}), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
