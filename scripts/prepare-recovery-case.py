"""Import the audited public reference capture. Never creates or adjusts market prices."""
import datetime as dt
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'data' / 'recovery'

def ms(value):
    return int(dt.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() * 1000)

def close_at(date):
    hour = 20 if date < '2026-11-01' else 21
    if date in ('2026-11-27', '2026-12-24'):
        hour = 18
    return ms(f'{date}T{hour:02}:00:00Z')

def main():
    path = DEST / 'november-3-2026.json'
    if path.exists():
        raise SystemExit('Case already captured; create an explicitly versioned revision rather than overwrite receipt times.')
    raw = json.loads((DEST / 'sourced-observations.json').read_text())
    old = json.loads((ROOT / 'data/consensus/november-3-2026.json').read_text())
    now = int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000)
    received = ms(raw['receivedAt'])
    sources = []
    for s in raw['sources']:
        sources.append(dict(id=s['id'], title=s['title'], url=s['url'], kind='news' if s['id'].startswith('ap-') else 'economic' if s['id'].startswith('fred-') else 'official_market', publishedAt=ms(s['publishedAt']) if s['publishedAt'] else None, publicationDate=s['publicationDate'], publicationBasis='exact' if s['publishedAt'] else 'retrieval_upper_bound', receivedAt=ms(s['receivedAt']), verified=True, usage=s['usage'], permittedUse=s['permittedUse'], mode='retrospective', role='headline' if s['id'].startswith('ap-') else 'evidence'))
    def add_source(id, title, url, kind='company', role='evidence'):
        sources.append(dict(id=id, title=title, url=url, kind=kind, publishedAt=None, publicationDate=None, publicationBasis='retrieval_upper_bound', receivedAt=now, verified=True, usage='public_reference', permittedUse='Cited public research reference; market-data licence not asserted', mode='retrospective', role=role))
    add_source('nyse-calendar', 'NYSE regular-session calendar, holidays and early closes', old['calendar']['sourceUrl'], 'official_market')
    add_source('vt-structure', 'Vanguard Total World Stock ETF: global equity mandate', 'https://investor.vanguard.com/investment-products/etfs/profile/vt')
    add_source('cash-definition', 'GBP cash research reserve; no observed interest rate is assumed', 'https://www.bankofengland.co.uk/', 'economic')
    add_source('ap-election-market-wrap', 'Election-day market report; exact publication of the retrieved revision unavailable', 'https://apnews.com/article/0d235af127a92c68da0cc2c45c028cef', 'news', 'headline')
    names = {'COMP': 'Nasdaq Composite', 'NDX': 'Nasdaq-100', 'SOX': 'PHLX Semiconductor Sector Index', 'QQQ': 'Invesco QQQ Trust', 'NVDA': 'NVIDIA', 'MSFT': 'Microsoft', 'AAPL': 'Apple', 'VT': 'Vanguard Total World Stock ETF', 'CASH_GBP': 'Uninvested GBP cash'}
    instruments = []
    for symbol, name in names.items():
        product = 'index' if symbol in ('COMP', 'NDX', 'SOX') else 'etf' if symbol in ('QQQ', 'VT') else 'cash' if symbol == 'CASH_GBP' else 'equity'
        sid = 'cash-definition' if product == 'cash' else f'nasdaq-{symbol.lower()}-history'
        source = next(s for s in sources if s['id'] == sid)
        instruments.append(dict(id=symbol, symbol=symbol, name=name, product=product, currency='GBP' if product == 'cash' else 'USD', sourceIds=[sid] + (['vt-structure'] if symbol == 'VT' else []), sourceUrl=source['url'], globalDiversificationVerified=symbol == 'VT', leverageFactor=1, researchApproved=product != 'index', publishedAt=now, receivedAt=now, mode='retrospective'))
    sessions = []
    date = dt.date(2026, 10, 1)
    while date <= dt.date(2027, 2, 5):
        day = date.isoformat()
        if date.weekday() < 5 and day not in ('2026-11-26', '2026-12-25', '2027-01-01', '2027-01-18'):
            sessions.append(close_at(day))
        date += dt.timedelta(days=1)
    calendar = dict(id='US-cash-equities-regular-2026-2027-recovery-v1', sourceUrl=old['calendar']['sourceUrl'], verified=True, publishedAt=now, receivedAt=now, session='regular', sessionCloses=sessions, mode='retrospective')
    prices = []
    for row in raw['closes']:
        if not row['seriesKey'].startswith('nasdaq-'):
            continue  # AP has a distinct reported index series, retained only as news context.
        source = next(s for s in sources if s['id'] == row['sourceId'])
        prices.append(dict(id=f"{row['seriesKey']}-{row['date']}", instrumentId=row['symbol'], provider='Nasdaq public historical table', sourceIds=[row['sourceId']], sourceUrl=source['url'], eventAt=close_at(row['date']), publishedAt=None, receivedAt=received, currency=row['currency'], close=row['value'], priceBasis=row['priceBasis'], adjustmentVersion='nasdaq-index-close-v1' if row['priceBasis'] == 'index-level' else 'nasdaq-unadjusted-undeclared-v1', session='regular', corporateActionsReviewed=row['corporateActionsReviewed'], licensed=False, permittedUse=None, usage='public_reference', mode='retrospective', supersedes=None))
    metrics = {'VIXCLS': ('vix', 'CBOE S&P 500 volatility index close'), 'DGS10': ('treasury_10y', 'US Treasury 10-year constant maturity, daily yield'), 'BAMLH0A0HYM2': ('credit_spread', 'ICE BofA US High Yield option-adjusted spread')}
    indicators = []
    for row in raw['indicators']:
        source = next(s for s in sources if s['id'] == row['sourceId'])
        metric, population = metrics[row['seriesId']]
        indicators.append(dict(id=row['id'], metric=metric, seriesId=row['seriesId'], populationDefinition=population, value=row['value'], unit=row['unit'], measurementAt=close_at(row['date']), publishedAt=source['publishedAt'], receivedAt=received, sourceIds=[row['sourceId']], mode='retrospective'))
    headlines = [dict(id='ap-session-summary', title='Reported technology-led rebound on 3 November', description='AP reports a Nasdaq Composite close of 25,372.01 on 3 November. This independent news reference is separate from the Nasdaq historical series; its 2 November close differs by 0.04 index points. No price is reconstructed from rounded stock moves.', eventAt=close_at('2026-11-03'), publishedAt=ms('2026-11-03T21:14:37Z'), receivedAt=received, sourceIds=['ap-comp-2026-11-03'], mode='retrospective'), dict(id='ap-election-context', title='Election-day uncertainty accompanies uneven technology rebound', description='The AP market wrap discusses the midterm-election backdrop. The retrieved revision contains closing-session information but its indexed creation time predates that session; exact revision publication is unknown. Actual receipt is the eligibility upper bound. No election result or causal trading signal is inferred.', eventAt=close_at('2026-11-03'), publishedAt=None, receivedAt=now, sourceIds=['ap-election-market-wrap'], mode='retrospective')]
    plans = []
    for kind, name in [('immediate', 'Immediate entry'), ('staged', 'Staged entry'), ('diversified', 'Diversified benchmark')]:
        basket = [dict(instrumentId='VT', weight=.5), dict(instrumentId='CASH_GBP', weight=.5)] if kind == 'diversified' else [dict(instrumentId=s, weight=1/3) for s in ('NVDA', 'MSFT', 'AAPL')]
        schedule = [dict(offsetSessions=n, fraction=1/3) for n in (0, 5, 20)] if kind == 'staged' else [dict(offsetSessions=0, fraction=1)]
        plans.append(dict(id=f'recovery-{kind}', name=name, kind=kind, initialCapitalGbp=500, basket=basket, schedule=schedule, cashInstrumentId='CASH_GBP', entryFeePerLegGbp=None, exitFeePerLegGbp=None, spreadBps=None, slippageBps=None, fxFeeBps=None, annualAdditionalFeeBps=None, cashAnnualRate=None, costAssumptionsNote='Costs, cash interest and licensed FX are not configured. Null is unknown, not zero. Each experiment has its own £500 budget including costs; undeployed staged tranches remain GBP cash. VT is a research reference; UK retail availability is unverified.', mode='retrospective'))
    old['webClaims'] = []  # Public claims stay in separate news context, outside the frozen analyst dataset.
    case = dict(version='recovery-006-v1', id='recovery-006-2026-11-03', name='Research Case 006 · US technology rebound · 3 November 2026', mode='retrospective', anchorAt=close_at('2026-11-03'), sources=sources, instruments=instruments, calendar=calendar, prices=prices, fx=[], breadth=[], sectorParticipation=[], indicators=indicators, electionHeadlines=headlines, contextRecords=old.get('contextRecords', []), analystConsensusSnapshot=dict(caseId=old['id'], cutoff=now, receivedAt=now, recordJson=json.dumps(old, separators=(',', ':')), mode='retrospective'), plans=plans)
    path.write_text(json.dumps(case, indent=2) + '\n', encoding='utf-8')
    request = dict(case=case, cutoff=now, anchorAt=case['anchorAt'], registeredAt=now, benchmarkInstrumentId='VT', priceBasis='total-return', adjustmentVersion='licensed-provider-total-return-version-required', asOf=now)
    (DEST / 'november-3-2026-request.json').write_text(json.dumps(request, indent=2) + '\n', encoding='utf-8')
    print(f'Captured {len(prices)} public reference closes, {len(indicators)} macro observations, 3 separate research plans. Receipt cutoff {now}.')

if __name__ == '__main__':
    main()
