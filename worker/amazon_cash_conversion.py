"""Independent, offline Amazon cash conversion calculations; no order authority."""
import argparse
import calendar
import copy
from datetime import date, datetime, timezone
import json
import math
from pathlib import Path
import re
import sys
from urllib.parse import urlparse

VERSION = 'amazon-cash-2026-v1'
METRICS = {'revenue', 'operating_income', 'net_income', 'operating_cash_flow', 'gross_capex', 'capex_proceeds', 'net_capex', 'free_cash_flow', 'cash_capex_guidance', 'aws_growth_forecast'}
MAX_NUMBER = 9007199254740991


def strict(row, required, optional=()):
    if not isinstance(row, dict) or not set(required) <= set(row) or not set(row) <= set(required) | set(optional):
        raise ValueError('Fields do not match the versioned Amazon contract')


def number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or abs(value) > MAX_NUMBER:
        raise ValueError('Finite supported numeric value required')
    return value


def instant(value):
    number(value)
    if value < 0 or int(value) != value or value > 8640000000000000:
        raise ValueError('Integer supported timestamp required')
    return value


def text(value, maximum=12000):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError('Bounded nonempty text required')


def source_url(value):
    text(value)
    parsed = urlparse(value)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('HTTPS source without credentials required')


def day(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        raise ValueError('Reporting date must be YYYY-MM-DD')
    return date.fromisoformat(value)


def milliseconds(value):
    return int(datetime.combine(day(value), datetime.min.time(), timezone.utc).timestamp() * 1000)


def publication_bound(source):
    if source['publishedAt'] is not None:
        return source['publishedAt']
    return milliseconds(source['publicationDate']) + 32 * 3600000 - 1 if source['publicationDate'] is not None else None


def parse_amazon_case(value):
    data = copy.deepcopy(value)
    strict(data, ('version', 'id', 'name', 'mode', 'sources', 'observations', 'bedrock', 'articleClaim'))
    if data['version'] != VERSION or data['mode'] != 'retrospective':
        raise ValueError('Only the versioned retrospective case is accepted')
    text(data['id'], 240); text(data['name'])
    for key, limit in (('sources', 100), ('observations', 2000), ('bedrock', 100)):
        rows = data[key]
        if not isinstance(rows, list) or len(rows) > limit or key == 'sources' and not rows:
            raise ValueError('Bounded register required')
        if len({row['id'] for row in rows}) != len(rows):
            raise ValueError('Register IDs must be unique')
    sources = {}
    for s in data['sources']:
        strict(s, ('id', 'title', 'url', 'kind', 'publishedAt', 'publicationDate', 'receivedAt', 'verified'), ('publicationBasis',))
        text(s['id'], 240); text(s['title']); source_url(s['url']); instant(s['receivedAt'])
        if s['kind'] not in ('company', 'sec') or type(s['verified']) is not bool:
            raise ValueError('Invalid primary source')
        if s['publishedAt'] is not None and instant(s['publishedAt']) > s['receivedAt']:
            raise ValueError('Receipt precedes publication')
        if s['publicationDate'] is not None: day(s['publicationDate'])
        basis = s.get('publicationBasis')
        if basis is not None and basis not in ('exact', 'sec_acceptance_proxy', 'date_only'):
            raise ValueError('Unknown publication basis')
        if basis == 'date_only' and s['publishedAt'] is not None or basis == 'sec_acceptance_proxy' and (s['publishedAt'] is None or s['kind'] != 'sec'):
            raise ValueError('Publication basis conflicts with source timestamp')
        sources[s['id']] = s
    observations = {}
    for o in data['observations']:
        strict(o, ('id', 'metric', 'scope', 'period', 'value', 'currency', 'unit', 'basis', 'kind', 'qualifier', 'sourceId', 'receivedAt', 'supersedes'), ('inputIds',))
        text(o['id'], 240); number(o['value']); instant(o['receivedAt']); text(o['sourceId'], 240)
        if o['supersedes'] is not None: text(o['supersedes'], 240)
        if o['metric'] not in METRICS or o['scope'] not in ('company', 'AWS') or o['currency'] != 'USD' or o['unit'] not in ('million', 'ratio') or o['basis'] != 'amazon-reported-v1':
            raise ValueError('Invalid metric definition')
        if o['kind'] not in ('reported', 'derived', 'guidance', 'management_expectation') or o['qualifier'] not in ('exact', 'approximately', 'greater_than', 'nearly'):
            raise ValueError('Invalid reporting role')
        p = o['period']; strict(p, ('scope', 'start', 'end', 'label')); start = day(p['start']); end = day(p['end']); text(p['label'], 240)
        if start > end or p['scope'] not in ('quarter', 'ttm', 'calendar_year'):
            raise ValueError('Invalid period dates')
        if p['scope'] == 'calendar_year':
            if not re.fullmatch(r'\d{4}', p['label']) or p['start'] != p['label'] + '-01-01' or p['end'] != p['label'] + '-12-31':
                raise ValueError('Calendar-year dates do not match label')
        else:
            pattern = r'(\d{4})-Q([1-4])' if p['scope'] == 'quarter' else r'TTM-(\d{4})-Q([1-4])'
            match = re.fullmatch(pattern, p['label'])
            if not match: raise ValueError('Period label and scope differ')
            year, quarter = map(int, match.groups()); month = quarter * 3
            expected_end = date(year, month, calendar.monthrange(year, month)[1])
            expected_start = date(year, month - 2, 1) if p['scope'] == 'quarter' else date(year if quarter == 4 else year - 1, 1 if quarter == 4 else month + 1, 1)
            if start != expected_start or end != expected_end: raise ValueError('Reporting dates do not match quarter or TTM window')
        if (o['metric'] == 'aws_growth_forecast') != (o['unit'] == 'ratio'):
            raise ValueError('Growth forecasts use ratios; statement metrics use millions')
        if o['metric'] == 'aws_growth_forecast' and (o['scope'] != 'AWS' or o['kind'] != 'management_expectation' or p['scope'] != 'calendar_year'):
            raise ValueError('AWS forecasts remain calendar-year management expectations')
        if o['kind'] == 'guidance' and (o['metric'] != 'cash_capex_guidance' or p['scope'] != 'calendar_year' or o['scope'] != 'company') or o['metric'] == 'cash_capex_guidance' and o['kind'] != 'guidance':
            raise ValueError('Cash-capex guidance is never a realised result')
        inputs = o.get('inputIds', [])
        if not isinstance(inputs, list) or len(inputs) > 20: raise ValueError('Bounded input references required')
        for identity in inputs: text(identity, 240)
        if o['kind'] == 'derived' and (o['metric'] not in ('net_capex', 'free_cash_flow') or len(inputs) != 2 or o['qualifier'] != 'exact') or o['kind'] != 'derived' and inputs:
            raise ValueError('Derived cash metrics require two explicit inputs')
        if o['metric'] in ('revenue', 'gross_capex', 'capex_proceeds', 'net_capex') and o['value'] < 0:
            raise ValueError('Revenue and capital outlays must use nonnegative magnitudes')
        if o['sourceId'] not in sources or o['receivedAt'] < sources[o['sourceId']]['receivedAt']:
            raise ValueError('Observation must reference already received source')
        observations[o['id']] = o
    for o in data['observations']:
        if o['kind'] == 'derived':
            inputs = [observations.get(identity) for identity in o['inputIds']]
            if any(r is None or r['kind'] not in ('reported', 'derived') or r['qualifier'] != 'exact' or r['receivedAt'] > o['receivedAt'] or any(r[k] != o[k] for k in ('scope', 'currency', 'unit', 'basis', 'period')) for r in inputs):
                raise ValueError('Derived cash inputs must be eligible compatible records')
            expected = ('gross_capex', 'capex_proceeds') if o['metric'] == 'net_capex' else ('operating_cash_flow', 'net_capex')
            if tuple(r['metric'] for r in inputs) != expected or abs(inputs[0]['value'] - inputs[1]['value'] - o['value']) > 1e-8:
                raise ValueError('Derived cash metric does not reconcile to input formula')
        seen = {o['id']}; prior = o
        while prior['supersedes'] is not None:
            previous = observations.get(prior['supersedes'])
            if previous is None or previous['id'] in seen or any(previous[k] != o[k] for k in ('metric', 'scope', 'period', 'kind')) or previous['receivedAt'] > prior['receivedAt']:
                raise ValueError('Revision chain changes identity or receipt history')
            seen.add(previous['id']); prior = previous
    for b in data['bedrock']:
        strict(b, ('id', 'metric', 'population', 'comparison', 'multiple', 'qualifier', 'sourceId', 'receivedAt'))
        for key in ('id', 'population', 'sourceId'): text(b[key])
        instant(b['receivedAt'])
        if b['metric'] not in ('token_volume', 'customer_spending') or b['comparison'] != 'year_over_year' or b['qualifier'] != 'nearly' or number(b['multiple']) <= 0:
            raise ValueError('Invalid qualified Bedrock growth claim')
        if b['sourceId'] not in sources or b['receivedAt'] < sources[b['sourceId']]['receivedAt']:
            raise ValueError('Bedrock claim must reference received source')
    a = data['articleClaim']
    if a is not None:
        strict(a, ('description', 'amountMillions', 'sourceUrl', 'verified')); text(a['description'])
        if number(a['amountMillions']) < 0 or a['verified'] is not False: raise ValueError('Unverified user article claim required')
        if a['sourceUrl'] is not None: source_url(a['sourceUrl'])
    return data


def freeze_amazon_case(value, cutoff):
    data = parse_amazon_case(value); instant(cutoff); excluded = []; sources = []
    for s in data['sources']:
        pub = publication_bound(s)
        if s['verified'] and pub is not None and pub <= cutoff and s['receivedAt'] <= cutoff: sources.append(s)
        else: excluded.append({'id': s['id'], 'reason': 'Source unverified' if not s['verified'] else 'Publication unknown' if pub is None else 'Publication bound or receipt follows cutoff'})
    source_map = {s['id']: s for s in sources}; observations = []
    for o in data['observations']:
        source = source_map.get(o['sourceId']); pub = publication_bound(source) if source else None
        if source and o['receivedAt'] <= cutoff and (o['kind'] != 'reported' or pub is not None and milliseconds(o['period']['end']) + 86400000 - 1 <= pub): observations.append(o)
        else: excluded.append({'id': o['id'], 'reason': 'Source, observation receipt or completed reporting period unavailable at cutoff'})
    superseded = {o['supersedes'] for o in observations if o['supersedes'] is not None}; active = [o for o in observations if o['id'] not in superseded]
    for _ in observations:
        present = {o['id'] for o in active}; remaining = []
        for o in active:
            if o['kind'] != 'derived' or all(identity in present for identity in o['inputIds']): remaining.append(o)
            else: excluded.append({'id': o['id'], 'reason': 'A derived cash input is unavailable or superseded at cutoff'})
        if len(remaining) == len(active): break
        active = remaining
    bedrock = []
    for b in data['bedrock']:
        if b['sourceId'] in source_map and b['receivedAt'] <= cutoff: bedrock.append(b)
        else: excluded.append({'id': b['id'], 'reason': 'Bedrock claim source or receipt unavailable at cutoff'})
    frozen = {**data, 'sources': sources, 'observations': active, 'bedrock': bedrock, 'articleClaim': None}
    return {'version': VERSION, 'cutoff': cutoff, 'case': frozen, 'eligibleHistory': observations, 'excluded': excluded, 'publicationBounds': [{'sourceId': s['id'], 'at': publication_bound(s), 'precision': 'conservative_date_bound' if s['publishedAt'] is None else s.get('publicationBasis', 'exact')} for s in sources], 'executionAuthority': 'none'}


def missing(reason, unit='ratio', inputs=None):
    return {'value': None, 'inputs': inputs or [], 'reason': reason, 'unit': unit}


def calculate(rows, unit, operation):
    try: return {'value': number(operation()), 'inputs': [r['id'] for r in rows], 'reason': None, 'unit': unit}
    except (ValueError, ZeroDivisionError): return missing('Calculation outside finite precision limits', unit, [r['id'] for r in rows])


def amazon_cash_kpis(value, quarter, cutoff):
    snapshot = freeze_amazon_case(value, cutoff); data = snapshot['case']; match = re.fullmatch(r'(\d{4})-Q([1-4])', quarter)
    if not match: raise ValueError('Quarter label required')
    year, q = map(int, match.groups()); prior_year = f'{year - 1}-Q{q}'; prior_quarter = f'{year - 1}-Q4' if q == 1 else f'{year}-Q{q - 1}'
    def get(metric, scope, period): return [o for o in data['observations'] if o['metric'] == metric and o['scope'] == scope and o['period']['label'] == period and o['kind'] in ('reported', 'derived') and o['qualifier'] == 'exact']
    def one(metric, scope, period, unit='million_USD'):
        rows = get(metric, scope, period)
        return calculate(rows, unit, lambda: rows[0]['value']) if len(rows) == 1 else missing('Exactly one eligible reported observation required', unit, [r['id'] for r in rows])
    def ratio(a, b, scope, period):
        x = get(a, scope, period); y = get(b, scope, period); rows = x + y
        if len(x) != 1 or len(y) != 1: return missing('Compatible reported inputs unavailable', 'ratio', [r['id'] for r in rows])
        if any(x[0][key] != y[0][key] for key in ('basis', 'unit', 'currency', 'period')) or y[0]['value'] <= 0:
            return missing('Compatible definitions and positive denominator required', 'ratio', [r['id'] for r in rows])
        return calculate(rows, 'ratio', lambda: x[0]['value'] / y[0]['value'])
    def change(metric, scope, a_period, b_period, relative):
        a = get(metric, scope, a_period); b = get(metric, scope, b_period); rows = a + b; unit = 'ratio' if relative else 'million_USD'
        if len(a) != 1 or len(b) != 1: return missing('Comparable prior-period observations unavailable', unit, [r['id'] for r in rows])
        if any(a[0][key] != b[0][key] for key in ('basis', 'unit', 'currency')) or a[0]['period']['scope'] != b[0]['period']['scope'] or relative and b[0]['value'] <= 0:
            return missing('Compatible periods, definitions and positive prior denominator required', unit, [r['id'] for r in rows])
        return calculate(rows, unit, lambda: a[0]['value'] / b[0]['value'] - 1 if relative else a[0]['value'] - b[0]['value'])
    def margin_change(scope, a_period, b_period):
        a = ratio('operating_income', 'revenue', scope, a_period); b = ratio('operating_income', 'revenue', scope, b_period); inputs = a['inputs'] + b['inputs']
        return {'value': (a['value'] - b['value']) * 100, 'unit': 'percentage_points', 'inputs': inputs, 'reason': None} if a['value'] is not None and b['value'] is not None else missing('Comparable operating margins unavailable', 'percentage_points', inputs)
    def growth(period): return change('revenue', 'AWS', period, str(int(period[:4]) - 1) + period[4:], True)
    def reconcile(period):
        groups = [get(metric, 'company', period) for metric in ('operating_cash_flow', 'net_capex', 'free_cash_flow')]; rows = sum(groups, [])
        return calculate(rows, 'million_USD', lambda: rows[0]['value'] - rows[1]['value'] - rows[2]['value']) if all(len(g) == 1 for g in groups) else missing('Cash bridge inputs unavailable', 'million_USD', [r['id'] for r in rows])
    a_growth = growth(quarter); p_growth = growth(prior_quarter); ttm = 'TTM-' + quarter; prior_ttm = 'TTM-' + prior_year
    quarterly = {'companyRevenue': one('revenue', 'company', quarter), 'companyOperatingIncome': one('operating_income', 'company', quarter), 'companyNetIncome': one('net_income', 'company', quarter), 'awsRevenue': one('revenue', 'AWS', quarter), 'awsOperatingIncome': one('operating_income', 'AWS', quarter), 'awsOperatingMargin': ratio('operating_income', 'revenue', 'AWS', quarter), 'companyOperatingMargin': ratio('operating_income', 'revenue', 'company', quarter), 'operatingCashFlow': one('operating_cash_flow', 'company', quarter), 'grossCapex': one('gross_capex', 'company', quarter), 'capexProceeds': one('capex_proceeds', 'company', quarter), 'netCapex': one('net_capex', 'company', quarter), 'freeCashFlow': one('free_cash_flow', 'company', quarter), 'cashBridgeResidual': reconcile(quarter)}
    trailing = {'revenue': one('revenue', 'company', ttm), 'operatingCashFlow': one('operating_cash_flow', 'company', ttm), 'grossCapex': one('gross_capex', 'company', ttm), 'netCapex': one('net_capex', 'company', ttm), 'freeCashFlow': one('free_cash_flow', 'company', ttm), 'cashBridgeResidual': reconcile(ttm), 'capexCoverage': ratio('operating_cash_flow', 'net_capex', 'company', ttm), 'freeCashFlowMargin': ratio('free_cash_flow', 'revenue', 'company', ttm)}
    changes = {'companyRevenueGrowthYoy': change('revenue', 'company', quarter, prior_year, True), 'awsRevenueGrowthYoy': a_growth, 'awsGrowthChangeQoq': {'value': (a_growth['value'] - p_growth['value']) * 100, 'unit': 'percentage_points', 'inputs': a_growth['inputs'] + p_growth['inputs'], 'reason': None} if a_growth['value'] is not None and p_growth['value'] is not None else missing('Comparable prior-quarter year-over-year cloud growth unavailable', 'percentage_points'), 'awsOperatingMarginQoq': margin_change('AWS', quarter, prior_quarter), 'awsOperatingMarginYoy': margin_change('AWS', quarter, prior_year), 'companyOperatingMarginQoq': margin_change('company', quarter, prior_quarter), 'freeCashFlowDeltaYoy': change('free_cash_flow', 'company', ttm, prior_ttm, False), 'freeCashFlowChangeYoy': change('free_cash_flow', 'company', ttm, prior_ttm, True), 'netCapexGrowthYoy': change('net_capex', 'company', ttm, prior_ttm, True), 'netCapexGrowthQoq': change('net_capex', 'company', quarter, prior_quarter, True)}
    gross = quarterly['grossCapex']['value']; net = quarterly['netCapex']['value']; annotation = parse_amazon_case(value)['articleClaim']
    return {'version': VERSION, 'quarter': quarter, 'mode': 'retrospective', 'quarterly': quarterly, 'ttm': trailing, 'changes': changes, 'aiSpecificRoi': missing('AI-specific invested capital, attributable net cash returns and compatible timing are not disclosed'), 'management': [o for o in data['observations'] if o['kind'] in ('guidance', 'management_expectation')], 'bedrock': data['bedrock'], 'bedrockComparison': {'comparable': False, 'reason': 'Total Bedrock token volume and Fortune 500 customer spending have different populations and units; no per-token monetisation or common-cohort growth can be inferred'}, 'articleDiscrepancy': {'status': 'pending_official_gross_input' if gross is None else 'flagged', 'articleVerified': False, 'claimedNetMillions': annotation['amountMillions'] if gross is not None and annotation is not None else None, 'officialGrossMillions': gross, 'officialNetMillions': net, 'reason': 'The user-described article calls approximately $77.3bn quarterly purchases net; official gross purchases and net-of-proceeds capex are separate definitions. The article itself has not been supplied or verified.'}, 'excluded': snapshot['excluded'], 'executionAuthority': 'none'}


def build_amazon_interpretation(value, quarter, cutoff):
    snapshot = freeze_amazon_case(value, cutoff); kpis = amazon_cash_kpis(value, quarter, cutoff); positive = []; negative = []
    uncertainties = ['AI-specific return on invested capital cannot be inferred from AWS segment operating income', 'Management guidance and expectations are not realised financial results', 'No verified share-price reaction or executable quote is part of this case']
    if (kpis['changes']['awsRevenueGrowthYoy']['value'] or 0) > 0: positive.append('Reported AWS revenue exceeds the comparable prior-year quarter')
    if (kpis['quarterly']['awsOperatingMargin']['value'] or 0) > 0: positive.append('AWS reports positive segment operating income relative to sales')
    if kpis['ttm']['freeCashFlow']['value'] is not None and kpis['ttm']['freeCashFlow']['value'] < 0: negative.append('Trailing free cash flow is negative after net cash capital expenditure')
    if kpis['changes']['freeCashFlowDeltaYoy']['value'] is not None and kpis['changes']['freeCashFlowDeltaYoy']['value'] < 0: negative.append('Trailing free cash flow deteriorated against the comparable prior-year window')
    if (kpis['changes']['netCapexGrowthYoy']['value'] or 0) > 0: negative.append('Trailing net cash capital expenditure grew versus the comparable prior-year window')
    return {'version': VERSION, 'caseId': snapshot['case']['id'], 'quarter': quarter, 'cutoff': cutoff, 'mode': 'retrospective', 'evidence': snapshot['case'], 'evidenceHistory': snapshot['eligibleHistory'], 'baseline': {'id': 'amazon-cash-rules-v1', 'status': 'complete', 'positiveEvidence': positive, 'negativeEvidence': negative, 'uncertainties': uncertainties, 'interpretation': 'Separate operating growth and segment profitability from consolidated capital spending and cash conversion. Further research is required; no automatic investment recommendation.', 'marketForecast': None}, 'models': [{'slot': slot, 'status': 'pending', 'provider': None, 'modelVersion': None, 'result': None, 'cost': None, 'latencyMs': None} for slot in ('model_a', 'model_b')], 'interpretationScore': None, 'marketForecastScore': None, 'forwardExperiment': {'status': 'not_registered', 'requirement': 'Register a separate authenticated forward experiment with a future observation window and identical eligible evidence before submitting predictions'}, 'executionAuthority': 'none'}


def evaluate(request):
    if 'case' in request:
        strict(request, ('case', 'cutoff', 'quarter'), ('version',))
        if request.get('version', VERSION) != VERSION: raise ValueError('Unsupported request version')
        data = request['case']; cutoff = request['cutoff']; quarter = request['quarter']
    else:
        data = parse_amazon_case(request); cutoff = max([s['receivedAt'] for s in data['sources']] + [o['receivedAt'] for o in data['observations']] + [b['receivedAt'] for b in data['bedrock']]); quarter = '2026-Q3'
    return {'version': VERSION, 'snapshot': freeze_amazon_case(data, cutoff), 'kpis': amazon_cash_kpis(data, quarter, cutoff), 'experiment': build_amazon_interpretation(data, quarter, cutoff), 'executionAuthority': 'none'}


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('input'); parser.add_argument('--output'); args = parser.parse_args()
    try:
        request = json.loads(Path(args.input).read_text(encoding='utf-8-sig'))
        result = json.dumps(evaluate(request), indent=2, sort_keys=True, allow_nan=False) + '\n'
        if args.output:
            with Path(args.output).open('x', encoding='utf-8') as target: target.write(result)
        else: print(result, end='')
        return 0
    except (ValueError, TypeError, KeyError, OSError, OverflowError) as error:
        print(json.dumps({'error': str(error)}), file=sys.stderr); return 2


if __name__ == '__main__':
    raise SystemExit(main())
