"""Portfolio defence research, version defence-001.3-v1.

Independent standard-library calculations. No orders, recommendations, approval
authority, network access or changes to established paper-accounting formulas.
Returns are decimals; timestamps are epoch milliseconds; costs are absolute
amounts in the portfolio's stated currency.
"""
import argparse
import copy
import json
import math
import sys
from pathlib import Path
from urllib.parse import urlparse

from .research import number

VERSION = 'defence-001.3-v1'
MAX_SAFE_INTEGER = 9007199254740991
MAX_TIMESTAMP = 8640000000000000
MODES = ('synthetic', 'historical', 'forward')
PRODUCTS = ('equity', 'etf', 'cash', 'bond', 'gold_etc', 'protective_put', 'collar', 'inverse')
RESEARCH_ONLY = ('protective_put', 'collar', 'inverse')
DIMENSIONS = ('company', 'sector', 'country', 'currency', 'aiLayer')


def text(value, name):
    if not isinstance(value, str) or not value.strip() or len(value) > 10000:
        raise ValueError(f'Invalid {name}')
    return value


def finite(value, minimum=None):
    value = number(value)
    if abs(value) > MAX_SAFE_INTEGER:
        raise ValueError('Calculation exceeds supported finite numeric precision')
    if minimum is not None and value < minimum:
        raise ValueError(f'Number must be at least {minimum}')
    return value


def integer(value, minimum=0):
    finite(value, minimum)
    if int(value) != value:
        raise ValueError('Integer required')
    return value


def instant(value):
    """Integer epoch milliseconds, within the JavaScript Date display range."""
    integer(value, 0)
    if value > MAX_TIMESTAMP:
        raise ValueError('Timestamp exceeds the supported Date range')
    return value


def strict(record, required, label, optional=()):
    if not isinstance(record, dict) or not set(required) <= set(record) or not set(record) <= set(required) | set(optional):
        raise ValueError(f'{label} fields do not match the versioned contract')


def unique(rows, label):
    if not isinstance(rows, list) or len(rows) > 10000:
        raise ValueError(f'Bounded {label} required')
    if len({row['id'] for row in rows}) != len(rows):
        raise ValueError(f'Duplicate {label} IDs')


def url(value):
    text(value, 'source URL')
    parsed = urlparse(value)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('HTTPS source without embedded credentials required')
    return value


def unavailable(reason, **extra):
    return {'value': None, 'reason': reason, **extra}


def sample_statistics(asset_returns, benchmark_returns, minimum_samples=60, sessions_per_year=252):
    """Aligned same-session decimal returns only. Never fills missing returns.

    Sample count is a disclosed research eligibility rule, not validation of a
    predictive covariance model. No covariance matrix is estimated or inverted.
    """
    integer(minimum_samples, 30)
    integer(sessions_per_year, 1)
    if not isinstance(asset_returns, list) or not isinstance(benchmark_returns, list) or len(asset_returns) != len(benchmark_returns):
        raise ValueError('Aligned same-session return arrays required')
    for value in asset_returns + benchmark_returns:
        if finite(value) <= -1:
            raise ValueError('A simple price return must exceed -1')
    n = len(asset_returns)
    empty = {'samples': n, 'minimumSamples': minimum_samples, 'correlation': None,
             'beta': None, 'annualizedVolatility': None, 'reason': 'Insufficient aligned return history',
             'covarianceReliable': False}
    if n < minimum_samples:
        return empty
    mean_a = sum(asset_returns) / n
    mean_b = sum(benchmark_returns) / n
    var_a = sum((value - mean_a) ** 2 for value in asset_returns) / (n - 1)
    var_b = sum((value - mean_b) ** 2 for value in benchmark_returns) / (n - 1)
    cov = sum((a - mean_a) * (b - mean_b) for a, b in zip(asset_returns, benchmark_returns)) / (n - 1)
    reason = 'Zero variance prevents correlation or benchmark sensitivity' if var_a == 0 or var_b == 0 else None
    return {'samples': n, 'minimumSamples': minimum_samples,
            'correlation': None if not var_a or not var_b else max(-1, min(1, cov / math.sqrt(var_a * var_b))),
            'beta': None if not var_b else cov / var_b,
            'annualizedVolatility': math.sqrt(var_a * sessions_per_year),
            'reason': reason, 'covarianceReliable': False}


def maximum_drawdown(prices):
    if not isinstance(prices, list) or len(prices) < 2:
        return unavailable('At least two valid aligned prices required')
    for value in prices:
        if finite(value, 0) == 0:
            raise ValueError('Positive prices required')
    peak = prices[0]
    drawdown = 0.0
    for price in prices:
        peak = max(peak, price)
        drawdown = min(drawdown, price / peak - 1)
    return {'value': drawdown, 'reason': None}


def derivative_payoff(specification, observation):
    """Expiry settlement only; mark-to-market before expiry remains unknown.

    Collar calls are covered by the declared underlying shares. Premiums are
    per underlying unit; strike and settlement share one currency/adjustment
    basis. No contract is created or authorised by this research calculation.
    """
    strict(specification, ('type', 'expiry', 'putStrike', 'callStrike', 'putPremium', 'callPremium',
                          'multiplier', 'contracts', 'underlyingShares', 'currency', 'priceBasis'), 'Derivative specification')
    strict(observation, ('at', 'price', 'currency', 'priceBasis'), 'Derivative settlement')
    kind = specification['type']
    if kind not in ('protective_put', 'collar'):
        raise ValueError('Only protective put or covered collar research supported')
    expiry = instant(specification['expiry'])
    integer(specification['contracts'], 1)
    integer(specification['multiplier'], 1)
    shares = finite(specification['underlyingShares'], 0)
    units = specification['contracts'] * specification['multiplier']
    if units > shares:
        raise ValueError('Option units cannot exceed covered underlying shares')
    strike = finite(specification['putStrike'], 0)
    put_premium = finite(specification['putPremium'], 0)
    call_premium = finite(specification['callPremium'], 0)
    call_strike = specification['callStrike']
    if not strike or kind == 'collar' and (call_strike is None or finite(call_strike, strike) <= strike):
        raise ValueError('Positive put strike and collar call strike above put strike required')
    if kind == 'protective_put' and (call_strike is not None or call_premium != 0):
        raise ValueError('Protective put cannot contain a call leg')
    if observation['currency'] != specification['currency'] or observation['priceBasis'] != specification['priceBasis']:
        raise ValueError('Settlement currency or adjustment basis differs')
    when = instant(observation['at'])
    price = finite(observation['price'], 0)
    if price == 0:
        raise ValueError('Positive settlement price required')
    net_premium = units * (put_premium - call_premium)
    if when != expiry:
        return {'grossPayoff': None, 'netPayoff': None, 'premiumCost': net_premium,
                'reason': 'An exact expiry settlement is required; no pre-expiry option value is inferred', 'researchOnly': True}
    gross = units * max(strike - price, 0)
    if kind == 'collar':
        gross -= units * max(price - call_strike, 0)
    return {'grossPayoff': gross, 'netPayoff': gross - net_premium, 'premiumCost': net_premium,
            'reason': None, 'researchOnly': True}


def daily_inverse(index_returns, annual_fee_bps=0, sessions_per_year=252):
    """Research-only -1x daily-reset path, compounded after declared fee drag.

    Excludes tracking error, spreads, borrow costs and provider implementation
    effects; these omissions remain explicit. It is not a tradable quote.
    """
    if not isinstance(index_returns, list) or not index_returns:
        return unavailable('A complete daily path is required', researchOnly=True)
    annual_fee_bps = finite(annual_fee_bps, 0)
    integer(sessions_per_year, 1)
    wealth = 1.0
    daily_fee = annual_fee_bps / 10000 / sessions_per_year
    if daily_fee >= 1:
        raise ValueError('Invalid fee assumption')
    for daily in index_returns:
        if finite(daily) <= -1:
            raise ValueError('Daily index returns must exceed -1')
        factor = (1 - daily) * (1 - daily_fee)
        if factor < 0:
            return unavailable('Daily path exhausts the unleveraged research product; no negative NAV is modelled', researchOnly=True)
        wealth *= factor
    return {'value': wealth - 1, 'reason': None, 'researchOnly': True}


def parse_defence_case(value):
    strict(value, ('version', 'id', 'name', 'mode', 'sources', 'instruments', 'funds', 'portfolios', 'scenarios', 'histories'), 'Defence case')
    if value['version'] != VERSION or value['mode'] not in MODES:
        raise ValueError('Unsupported defence version or evidence mode')
    for field in ('id', 'name'):
        text(value[field], field)
    for field in ('sources', 'instruments', 'funds', 'portfolios', 'scenarios', 'histories'):
        unique(value[field], field)
    for source in value['sources']:
        strict(source, ('id', 'title', 'url', 'publishedAt', 'receivedAt', 'mode', 'verified', 'role'), 'Source')
        text(source['id'], 'source id'); text(source['title'], 'source title'); url(source['url'])
        if not isinstance(source['verified'], bool) or source['role'] not in ('evidence', 'outcome'):
            raise ValueError('Invalid source status')
        if instant(source['receivedAt']) < instant(source['publishedAt']):
            raise ValueError('Receipt precedes publication')
    source_ids = {source['id'] for source in value['sources']}
    instruments = {instrument['id']: instrument for instrument in value['instruments']}
    for instrument in value['instruments']:
        strict(instrument, ('id', 'name', 'symbol', 'isin', 'currency', 'company', 'sector', 'country', 'aiLayer', 'aiRelated', 'product',
                            'paperEligible', 'availability', 'structure', 'annualFeeBps', 'sourceIds', 'restrictions', 'risks',
                            'protectsAgainst', 'cannotProtectAgainst', 'lossConditions'), 'Instrument')
        for key in ('id', 'name', 'symbol', 'company', 'sector', 'country', 'aiLayer', 'availability', 'structure'):
            text(instrument[key], key)
        if instrument['isin'] is not None: text(instrument['isin'], 'ISIN')
        if instrument['product'] not in PRODUCTS or not isinstance(instrument['paperEligible'], bool):
            raise ValueError('Invalid product or paper eligibility')
        if instrument['aiRelated'] is not None and not isinstance(instrument['aiRelated'], bool):
            raise ValueError('AI classification must be verified boolean or unknown')
        if instrument['product'] in RESEARCH_ONLY and instrument['paperEligible']:
            raise ValueError('Derivatives and inverse products are research only')
        if instrument['annualFeeBps'] is not None: finite(instrument['annualFeeBps'], 0)
        for key in ('restrictions', 'risks', 'protectsAgainst', 'cannotProtectAgainst', 'lossConditions'):
            if not isinstance(instrument[key], list) or not 1 <= len(instrument[key]) <= 50:
                raise ValueError('Instrument risks and protection limits required')
            for item in instrument[key]: text(item, key)
    for fund in value['funds']:
        strict(fund, ('id', 'instrumentId', 'asOf', 'publishedAt', 'receivedAt', 'verified', 'mode', 'sourceIds', 'constituents'), 'Fund')
        if instruments.get(fund['instrumentId'], {}).get('product') != 'etf' or not isinstance(fund['verified'], bool):
            raise ValueError('Fund must identify an ETF')
        if not instant(fund['asOf']) <= instant(fund['publishedAt']) <= instant(fund['receivedAt']):
            raise ValueError('Fund timestamps reversed')
        _allocations(fund['constituents'], instruments, full=False)
    fund_versions = [(fund['instrumentId'], fund['asOf'], fund['receivedAt']) for fund in value['funds']]
    if len(set(fund_versions)) != len(fund_versions):
        raise ValueError('Ambiguous fund holdings revisions require distinct receipt timestamps')
    for portfolio in value['portfolios']:
        strict(portfolio, ('id', 'name', 'initialCapital', 'currency', 'horizonSessions', 'priceBasis', 'calendarId', 'session', 'mode', 'allocations', 'costs'), 'Portfolio')
        if finite(portfolio['initialCapital'], 0) == 0: raise ValueError('Positive initial capital required')
        integer(portfolio['horizonSessions'], 1)
        _allocations(portfolio['allocations'], instruments, full=True)
        strict(portfolio['costs'], ('fees', 'slippage', 'financing'), 'Costs')
        if sum(finite(v, 0) for v in portfolio['costs'].values()) > portfolio['initialCapital']:
            raise ValueError('Costs cannot exceed initial capital')
    for scenario in value['scenarios']:
        strict(scenario, ('id', 'name', 'category', 'kind', 'mode', 'publishedAt', 'receivedAt', 'sourceIds', 'startAt', 'endAt', 'horizonSessions', 'calendarId', 'currency', 'priceBasis', 'session', 'returns'), 'Scenario')
        if scenario['category'] not in ('ai_correction', 'equity_downturn', 'rates_credit', 'recession', 'ai_recovery') or scenario['kind'] not in ('user_defined', 'historical'):
            raise ValueError('Invalid scenario classification')
        if instant(scenario['endAt']) <= instant(scenario['startAt']) or instant(scenario['receivedAt']) < instant(scenario['publishedAt']):
            raise ValueError('Invalid scenario timestamps')
        if scenario['kind'] == 'historical' and (scenario['endAt'] > scenario['publishedAt'] or scenario['mode'] == 'synthetic'):
            raise ValueError('Historical scenarios require completed observed windows')
        integer(scenario['horizonSessions'], 1)
        if not isinstance(scenario['returns'], list) or not scenario['returns'] or len({r['instrumentId'] for r in scenario['returns']}) != len(scenario['returns']):
            raise ValueError('Unique scenario returns required')
        for row in scenario['returns']:
            strict(row, ('instrumentId', 'return'), 'Scenario return')
            if row['instrumentId'] not in instruments: raise ValueError('Scenario instrument missing')
            finite(row['return'], -1)
    for history in value['histories']:
        strict(history, ('id', 'instrumentId', 'provider', 'currency', 'priceBasis', 'adjustmentVersion', 'calendarId', 'session', 'mode', 'corporateActionsReviewed', 'sessionsPerYear', 'calendarVerified', 'calendarSessions', 'observations'), 'History')
        if history['instrumentId'] not in instruments: raise ValueError('History instrument missing')
        if history['currency'] != instruments[history['instrumentId']]['currency']:
            raise ValueError('History currency must match instrument currency; explicit sourced FX-normalised records required')
        text(history['provider'], 'provider'); text(history['adjustmentVersion'], 'adjustment version')
        integer(history['sessionsPerYear'], 1)
        if history['sessionsPerYear'] > 366 or not isinstance(history['corporateActionsReviewed'], bool) or not isinstance(history['calendarVerified'], bool):
            raise ValueError('Invalid history conventions')
        calendar = history['calendarSessions']
        if not isinstance(calendar, list) or len(calendar) < 2:
            raise ValueError('Strictly increasing calendar required')
        for session in calendar: instant(session)
        if any(t <= calendar[i-1] for i, t in enumerate(calendar) if i):
            raise ValueError('Strictly increasing calendar required')
        if len({row['eventAt'] for row in history['observations']}) != len(history['observations']): raise ValueError('Duplicate history sessions')
        for row in history['observations']:
            strict(row, ('eventAt', 'publishedAt', 'receivedAt', 'close', 'sourceId'), 'Observation')
            if row['sourceId'] not in source_ids or row['eventAt'] not in calendar: raise ValueError('History source or calendar session missing')
            if not instant(row['eventAt']) <= instant(row['publishedAt']) <= instant(row['receivedAt']): raise ValueError('History timestamps reversed')
            if finite(row['close'], 0) == 0: raise ValueError('Positive history prices required')
    for collection in ('sources', 'funds', 'portfolios', 'scenarios', 'histories'):
        if any(row['mode'] != value['mode'] for row in value[collection]):
            raise ValueError('Synthetic, historical and forward evidence cannot be combined')
    for row in value['instruments'] + value['funds'] + value['scenarios']:
        if not isinstance(row['sourceIds'], list) or not 1 <= len(row['sourceIds']) <= 100 or any(ref not in source_ids for ref in row['sourceIds']):
            raise ValueError('Missing source reference')
    for row in value['instruments'] + value['portfolios'] + value['scenarios'] + value['histories']:
        if not isinstance(row['currency'], str) or len(row['currency']) != 3 or not row['currency'].isalpha() or not row['currency'].isupper(): raise ValueError('Three-letter currency required')
        if 'priceBasis' in row and row['priceBasis'] not in ('total-return', 'split-adjusted'): raise ValueError('Invalid price basis')
        if 'session' in row and row['session'] != 'regular': raise ValueError('Regular sessions required')
    def visit(identity, path):
        if identity in path: raise ValueError('Cyclic ETF look-through is unsupported')
        for fund in value['funds']:
            if fund['instrumentId'] == identity:
                for row in fund['constituents']:
                    if instruments[row['instrumentId']]['product'] == 'etf': visit(row['instrumentId'], path | {identity})
    for fund in value['funds']: visit(fund['instrumentId'], set())
    return copy.deepcopy(value)


def _allocations(rows, instruments, full):
    if not isinstance(rows, list) or full and not rows or len({row['instrumentId'] for row in rows}) != len(rows):
        raise ValueError('Unique allocations required')
    for row in rows:
        strict(row, ('instrumentId', 'weight'), 'Allocation')
        if row['instrumentId'] not in instruments or not 0 < finite(row['weight'], 0) <= 1: raise ValueError('Invalid allocation')
    total = sum(row['weight'] for row in rows)
    if total > 1 + 1e-10 or full and abs(total - 1) > 1e-10: raise ValueError('Fully funded weights must total 100%')


def freeze_defence_case(value, cutoff):
    data = parse_defence_case(value); instant(cutoff); excluded = []
    sources = []
    for source in data['sources']:
        if source['verified'] and source['role'] == 'evidence' and source['publishedAt'] <= cutoff and source['receivedAt'] <= cutoff:
            sources.append(source)
        else:
            reason = 'Outcomes cannot enter forecast evidence' if source['role'] == 'outcome' else 'Unverified source' if not source['verified'] else 'Publication or receipt follows cutoff'
            excluded.append({'id': source['id'], 'reason': reason})
    source_ids = {source['id'] for source in sources}; instruments = []
    for row in data['instruments']:
        if all(ref in source_ids for ref in row['sourceIds']): instruments.append(row)
        else: excluded.append({'id': row['id'], 'reason': 'Instrument specification lacks eligible evidence'})
    instrument_ids = {row['id'] for row in instruments}; funds = []; portfolios = []; scenarios = []
    for row in data['funds']:
        if row['asOf'] <= cutoff and row['publishedAt'] <= cutoff and row['receivedAt'] <= cutoff and row['verified'] and all(ref in source_ids for ref in row['sourceIds']) and row['instrumentId'] in instrument_ids and all(c['instrumentId'] in instrument_ids for c in row['constituents']): funds.append(row)
        else: excluded.append({'id': row['id'], 'reason': 'Fund holdings are unverified, late or lack eligible constituent evidence'})
    for row in data['portfolios']:
        if all(a['instrumentId'] in instrument_ids for a in row['allocations']): portfolios.append(row)
        else: excluded.append({'id': row['id'], 'reason': 'Portfolio has instruments without eligible evidence'})
    for row in data['scenarios']:
        if row['publishedAt'] <= cutoff and row['receivedAt'] <= cutoff and all(ref in source_ids for ref in row['sourceIds']) and all(r['instrumentId'] in instrument_ids for r in row['returns']): scenarios.append(row)
        else: excluded.append({'id': row['id'], 'reason': 'Scenario evidence is unavailable at cutoff'})
    histories = []
    for history in data['histories']:
        if history['instrumentId'] not in instrument_ids: continue
        rows = []
        for row in history['observations']:
            if row['eventAt'] <= cutoff and row['publishedAt'] <= cutoff and row['receivedAt'] <= cutoff and row['sourceId'] in source_ids: rows.append(row)
            else: excluded.append({'id': f"{history['id']}:{row['eventAt']}", 'reason': 'History observation or revision unavailable at cutoff'})
        histories.append({**history, 'observations': rows})
    return {'version': VERSION, 'cutoff': cutoff, 'case': {**data, 'sources': sources, 'instruments': instruments, 'funds': funds,
            'portfolios': portfolios, 'scenarios': scenarios, 'histories': histories}, 'excluded': excluded, 'executionAuthority': 'none'}


def portfolio_exposure(value, portfolio_id, cutoff, max_fund_age_days=90):
    if finite(max_fund_age_days, 0) == 0: raise ValueError('Positive holdings age limit required')
    frozen = freeze_defence_case(value, cutoff); data = frozen['case']
    portfolio = next((p for p in data['portfolios'] if p['id'] == portfolio_id), None)
    if portfolio is None: raise ValueError('Portfolio is unavailable at cutoff')
    instruments = {i['id']: i for i in data['instruments']}; leaves = []
    def unresolved(weight, via, reason):
        leaves.append({'instrumentId': None, 'name': 'Unresolved fund exposure', 'weight': weight, 'via': via,
                       **{dimension: 'Unknown' for dimension in DIMENSIONS}, 'aiRelated': None, 'unknownReason': reason})
    def expand(identity, weight, via):
        instrument = instruments[identity]
        if instrument['product'] != 'etf':
            leaves.append({'instrumentId': identity, 'name': instrument['name'], 'weight': weight, 'via': via,
                           **{dimension: instrument[dimension] for dimension in DIMENSIONS}, 'aiRelated': instrument['aiRelated'],
                           'unknownReason': 'AI classification is unverified' if instrument['aiRelated'] is None else None})
            return
        funds = sorted((f for f in data['funds'] if f['instrumentId'] == identity and cutoff - f['asOf'] <= max_fund_age_days * 86400000), key=lambda f: (f['asOf'], f['receivedAt']), reverse=True)
        if not funds:
            unresolved(weight, via + [identity], 'No current verified fund holdings; global index exposure is not assumed independent of AI'); return
        fund = funds[0]
        for child in fund['constituents']: expand(child['instrumentId'], weight * child['weight'], via + [identity])
        residual = 1 - sum(child['weight'] for child in fund['constituents'])
        if residual > 1e-10: unresolved(weight * residual, via + [identity], 'Undisclosed fund holdings remain unresolved')
    for allocation in portfolio['allocations']: expand(allocation['instrumentId'], allocation['weight'], [])
    dimensions = {dimension: {} for dimension in DIMENSIONS}
    for leaf in leaves:
        for dimension in DIMENSIONS:
            key = leaf[dimension]; dimensions[dimension][key] = dimensions[dimension].get(key, 0) + leaf['weight']
    ai_weight = sum(leaf['weight'] for leaf in leaves if leaf['aiRelated'] is True)
    unknown_weight = sum(leaf['weight'] for leaf in leaves if leaf['aiRelated'] is None)
    return {'version': VERSION, 'portfolioId': portfolio_id, 'mode': data['mode'], 'initialCapital': portfolio['initialCapital'],
            'currency': portfolio['currency'], 'leaves': leaves, 'dimensions': dimensions, 'aiWeight': ai_weight,
            'unknownAiWeight': unknown_weight, 'knownNonAiWeight': 1 - ai_weight - unknown_weight,
            'companyHhi': sum(weight ** 2 for key, weight in dimensions['company'].items() if key != 'Unknown'),
            'hhiComplete': not any(leaf['company'] == 'Unknown' for leaf in leaves), 'excluded': frozen['excluded'], 'executionAuthority': 'none'}


def _history_window(data, instrument_id, start_at, end_at, cutoff):
    instant(start_at); instant(end_at); instant(cutoff)
    histories = [h for h in data['histories'] if h['instrumentId'] == instrument_id]
    if len(histories) != 1: raise ValueError('Exactly one explicit price history is required per instrument')
    history = histories[0]
    if not history['calendarVerified'] or not history['corporateActionsReviewed']: raise ValueError('Verified calendar and corporate-action treatment required')
    sessions = [t for t in history['calendarSessions'] if start_at <= t <= end_at]
    if not sessions or sessions[0] != start_at or sessions[-1] != end_at: raise ValueError('Price windows require exact registered sessions')
    observations = {row['eventAt']: row for row in history['observations']}; rows = []
    for session in sessions:
        row = observations.get(session)
        if row is None or row['receivedAt'] > cutoff or row['publishedAt'] > cutoff: raise ValueError('Missing aligned eligible price observation')
        rows.append(row)
    return history, sessions, rows


def _scenario_portfolio(data, portfolio, scenario, cutoff):
    if any(portfolio[key] != scenario[key] for key in ('currency', 'horizonSessions', 'priceBasis', 'calendarId', 'session', 'mode')):
        raise ValueError('Scenario and portfolio conventions must match')
    gross_return = 0.0
    instruments = {i['id']: i for i in data['instruments']}
    returns = {row['instrumentId']: row['return'] for row in scenario['returns']}
    for allocation in portfolio['allocations']:
        identity = allocation['instrumentId']
        if instruments[identity]['product'] in RESEARCH_ONLY: raise ValueError('Complex products require separate contract or daily-path research; static shocks are unsupported')
        if identity not in returns: raise ValueError('Missing scenario return; missing prices cannot be fabricated')
        if scenario['kind'] == 'historical':
            history, sessions, rows = _history_window(data, identity, scenario['startAt'], scenario['endAt'], cutoff)
            if any(history[key] != portfolio[key] for key in ('currency', 'priceBasis', 'calendarId', 'session', 'mode')) or len(sessions) - 1 != portfolio['horizonSessions']:
                raise ValueError('Historical scenario has incompatible observation conventions')
            observed = rows[-1]['close'] / rows[0]['close'] - 1
            if abs(observed - returns[identity]) > 1e-10: raise ValueError('Historical scenario return differs from eligible sourced prices')
        gross_return += allocation['weight'] * returns[identity]
    costs = sum(portfolio['costs'].values())
    deployed = portfolio['initialCapital'] - costs
    gross_pnl = deployed * gross_return
    net_pnl = gross_pnl - costs
    for amount in (gross_return, deployed, gross_pnl, net_pnl, portfolio['initialCapital'] + net_pnl): finite(amount)
    return {'portfolioId': portfolio['id'], 'initialCapital': portfolio['initialCapital'], 'deployedCapital': deployed,
            'currency': portfolio['currency'], 'grossReturn': gross_return, 'grossPnl': gross_pnl, 'costs': costs,
            'netPnl': net_pnl, 'netReturn': net_pnl / portfolio['initialCapital'],
            'endingCapital': portfolio['initialCapital'] + net_pnl, 'stressLoss': max(0, -net_pnl)}


def compare_defence_portfolios(value, baseline_id, alternative_id, scenario_id, cutoff):
    data = freeze_defence_case(value, cutoff)['case']
    baseline = next((p for p in data['portfolios'] if p['id'] == baseline_id), None)
    alternative = next((p for p in data['portfolios'] if p['id'] == alternative_id), None)
    scenario = next((s for s in data['scenarios'] if s['id'] == scenario_id), None)
    if baseline is None or alternative is None or scenario is None: raise ValueError('Portfolio or scenario evidence unavailable at cutoff')
    if any(baseline[key] != alternative[key] for key in ('initialCapital', 'currency', 'horizonSessions', 'priceBasis', 'calendarId', 'session', 'mode')):
        raise ValueError('Comparisons require identical initial capital, horizon, currency, calendar, session, price basis and evidence mode')
    a = _scenario_portfolio(data, baseline, scenario, cutoff); b = _scenario_portfolio(data, alternative, scenario, cutoff)
    gross_protection = finite(b['grossPnl'] - a['grossPnl'])
    net_protection = finite(b['netPnl'] - a['netPnl'])
    rebound = finite(b['netReturn'] / a['netReturn']) if a['netReturn'] > 0 else None
    return {'version': VERSION, 'scenarioId': scenario_id, 'scenarioKind': scenario['kind'], 'mode': data['mode'],
            'startAt': scenario['startAt'], 'endAt': scenario['endAt'], 'horizonSessions': scenario['horizonSessions'],
            'priceBasis': scenario['priceBasis'], 'baseline': a, 'alternative': b,
            'grossProtection': gross_protection, 'netProtection': net_protection,
            'reboundParticipation': rebound, 'executionAuthority': 'none'}


def defence_history_analytics(value, instrument_id, benchmark_id, cutoff, options=None):
    options = options or {}
    strict(options, (), 'History options', ('minimumReturns', 'rollingWindow', 'startAt', 'endAt'))
    minimum = integer(options.get('minimumReturns', 60), 30); window = integer(options.get('rollingWindow', 60), 30)
    parsed = parse_defence_case(value)
    def absent(reason):
        return {'version': VERSION, 'mode': parsed['mode'], 'samples': 0, 'correlation': None, 'beta': None,
                'annualVolatility': None, 'maxDrawdown': None, 'rolling': [], 'reason': reason, 'reliable': False, 'executionAuthority': 'none'}
    try:
        data = freeze_defence_case(parsed, cutoff)['case']
        candidates_a = [h for h in data['histories'] if h['instrumentId'] == instrument_id]
        candidates_b = [h for h in data['histories'] if h['instrumentId'] == benchmark_id]
        if len(candidates_a) != 1 or len(candidates_b) != 1: raise ValueError('Exactly one sourced instrument and benchmark history required')
        ah, bh = candidates_a[0], candidates_b[0]
        if any(ah[key] != bh[key] for key in ('currency', 'priceBasis', 'adjustmentVersion', 'calendarId', 'session', 'mode', 'sessionsPerYear')):
            raise ValueError('Histories require aligned currency, adjustment, calendar, session and mode')
        start = options.get('startAt', max(ah['calendarSessions'][0], bh['calendarSessions'][0]))
        common = [session for session in ah['calendarSessions'] if session <= cutoff and session in bh['calendarSessions']]
        if not common: raise ValueError('No completed common trading session at cutoff')
        end = options.get('endAt', common[-1])
        _, sessions_a, rows_a = _history_window(data, instrument_id, start, end, cutoff)
        _, sessions_b, rows_b = _history_window(data, benchmark_id, start, end, cutoff)
        if sessions_a != sessions_b: raise ValueError('Trading sessions are not aligned')
        a = [finite(rows_a[index]['close'] / rows_a[index-1]['close'] - 1) for index in range(1, len(rows_a))]
        b = [finite(rows_b[index]['close'] / rows_b[index-1]['close'] - 1) for index in range(1, len(rows_b))]
        if len(a) < minimum: raise ValueError(f'Insufficient aligned history: {len(a)} returns; {minimum} required')
        def stats(x, y):
            mx = sum(x) / len(x); my = sum(y) / len(y)
            xx = sum((r - mx) ** 2 for r in x); yy = sum((r - my) ** 2 for r in y)
            xy = sum((r - mx) * (s - my) for r, s in zip(x, y))
            return {'correlation': xy / math.sqrt(xx * yy) if xx > 0 and yy > 0 else None,
                    'beta': xy / yy if yy > 0 else None,
                    'annualVolatility': math.sqrt(xx / (len(x) - 1)) * math.sqrt(ah['sessionsPerYear'])}
        result = stats(a, b); rolling = []
        for amount in result.values():
            if amount is not None: finite(amount)
        for end_index in range(window, len(a) + 1):
            r = stats(a[end_index-window:end_index], b[end_index-window:end_index])
            for amount in r.values():
                if amount is not None: finite(amount)
            rolling.append({'endAt': rows_a[end_index]['eventAt'], 'correlation': r['correlation'], 'beta': r['beta']})
        return {'version': VERSION, 'mode': data['mode'], 'samples': len(a), **result,
                'maxDrawdown': maximum_drawdown([row['close'] for row in rows_a])['value'], 'rolling': rolling,
                'reason': 'Constant return history prevents correlation or beta estimation' if result['correlation'] is None or result['beta'] is None else None,
                'reliable': False, 'limitation': 'Descriptive historical statistics, not a reliable forecast or validated covariance estimate', 'executionAuthority': 'none'}
    except ValueError as error:
        return absent(str(error))


def option_research_payoff(value):
    strict(value, ('kind', 'underlyingStart', 'underlyingEnd', 'shares', 'contracts', 'multiplier', 'putStrike', 'putPremium', 'callStrike', 'callPremium', 'expiryAt', 'settlementAt', 'asOf', 'currency', 'premiumCurrency', 'fees'), 'Option research')
    if value['kind'] not in ('protective_put', 'collar'): raise ValueError('Unknown research option strategy')
    for key in ('underlyingStart', 'putStrike'):
        if finite(value[key], 0) == 0: raise ValueError('Positive starting price and strike required')
    for key in ('shares', 'contracts', 'multiplier'): integer(value[key], 1)
    for key in ('putPremium', 'callPremium', 'fees'): finite(value[key], 0)
    instant(value['expiryAt']); instant(value['asOf'])
    if value['underlyingEnd'] is not None: finite(value['underlyingEnd'], 0)
    if value['settlementAt'] is not None: instant(value['settlementAt'])
    units = value['contracts'] * value['multiplier']
    if units > value['shares']: raise ValueError('Contracts cannot exceed fully funded underlying coverage')
    if value['currency'] != value['premiumCurrency']: raise ValueError('Option premium currency requires explicit conversion')
    if value['kind'] == 'protective_put' and (value['callStrike'] is not None or value['callPremium'] != 0) or value['kind'] == 'collar' and (value['callStrike'] is None or finite(value['callStrike'], 0) <= value['putStrike']):
        raise ValueError('Invalid put or covered collar specification')
    premium = (value['putPremium'] - value['callPremium']) * units
    finite(units); finite(premium)
    if value['asOf'] < value['expiryAt'] or value['settlementAt'] != value['expiryAt'] or value['underlyingEnd'] is None:
        return {'version': VERSION, 'status': 'pending', 'grossPnl': None, 'netPnl': None, 'premium': premium, 'fees': value['fees'],
                'reason': 'Expiry settlement observation required; intrinsic value is not a pre-expiry option mark', 'evidenceStatus': 'unverified_user_input', 'executionAuthority': 'none'}
    underlying = (value['underlyingEnd'] - value['underlyingStart']) * value['shares']
    put = max(value['putStrike'] - value['underlyingEnd'], 0) * units
    call = max(value['underlyingEnd'] - value['callStrike'], 0) * units if value['kind'] == 'collar' else 0
    gross = underlying + put - call
    for amount in (underlying, put, call, gross, gross - premium - value['fees']): finite(amount)
    return {'version': VERSION, 'status': 'complete', 'underlyingPnl': underlying, 'putPayoff': put, 'callLiability': call,
            'grossPnl': gross, 'netPnl': gross - premium - value['fees'], 'premium': premium, 'fees': value['fees'], 'reason': None, 'evidenceStatus': 'unverified_user_input', 'executionAuthority': 'none'}


def daily_inverse_research(daily_returns, annual_fee_bps, sessions_per_year=252):
    if not isinstance(daily_returns, list) or not 1 <= len(daily_returns) <= 10000 or any(not -1 <= finite(r) <= 1 for r in daily_returns):
        raise ValueError('A bounded daily index path with returns between -1 and 1 required')
    fee = finite(annual_fee_bps, 0) / 10000 / integer(sessions_per_year, 1)
    if sessions_per_year > 366 or fee >= 1: raise ValueError('Invalid fee or annualisation convention')
    index = math.prod(1 + r for r in daily_returns) - 1
    gross = math.prod(1 - r for r in daily_returns) - 1
    net = math.prod((1 - r) * (1 - fee) for r in daily_returns) - 1
    for amount in (index, gross, net, gross - net): finite(amount)
    return {'version': VERSION, 'indexReturn': index, 'grossReturn': gross, 'netReturn': net, 'feeDrag': gross - net,
            'reset': 'daily', 'evidenceStatus': 'unverified_user_input', 'executionAuthority': 'none',
            'limitation': 'Illustrative unlevered inverse daily target; tracking, financing, spread and tax differences require observed product data'}


def evaluate(request):
    strict(request, ('version', 'case', 'cutoff', 'baselineId', 'alternativeId', 'scenarioId', 'instrumentId', 'benchmarkId'), 'Defence evaluation request', ('historyOptions', 'option', 'inverse'))
    if request['version'] != VERSION: raise ValueError('Unsupported evaluation request version')
    data = parse_defence_case(request['case']); cutoff = instant(request['cutoff'])
    result = {'version': VERSION, 'snapshot': freeze_defence_case(data, cutoff),
              'exposure': portfolio_exposure(data, request['baselineId'], cutoff),
              'alternativeExposure': portfolio_exposure(data, request['alternativeId'], cutoff),
              'comparison': compare_defence_portfolios(data, request['baselineId'], request['alternativeId'], request['scenarioId'], cutoff),
              'history': defence_history_analytics(data, request['instrumentId'], request['benchmarkId'], cutoff, request.get('historyOptions')),
              'executionAuthority': 'none'}
    if 'option' in request: result['option'] = option_research_payoff(request['option'])
    if 'inverse' in request:
        strict(request['inverse'], ('dailyReturns', 'annualFeeBps'), 'Inverse request', ('sessionsPerYear',))
        result['inverse'] = daily_inverse_research(request['inverse']['dailyReturns'], request['inverse']['annualFeeBps'], request['inverse'].get('sessionsPerYear', 252))
    return result


def main():
    parser = argparse.ArgumentParser(description='Portfolio defence evidence and calculations; no execution authority')
    parser.add_argument('input'); parser.add_argument('--output'); args = parser.parse_args()
    try:
        request = json.loads(Path(args.input).read_text(encoding='utf-8-sig'))
        encoded = json.dumps(evaluate(request), indent=2, sort_keys=True, allow_nan=False) + '\n'
        if args.output:
            with Path(args.output).open('x', encoding='utf-8') as output: output.write(encoded)
        else: print(encoded, end='')
        return 0
    except (ValueError, KeyError, TypeError, OSError) as error:
        print(json.dumps({'error': str(error)}), file=sys.stderr); return 2


if __name__ == '__main__':
    raise SystemExit(main())
