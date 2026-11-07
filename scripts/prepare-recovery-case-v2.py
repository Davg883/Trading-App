"""Build source version 2 of Research Case 006 from the 5 November 2026 public re-capture.

The v1 package (captured 3 November, before the anchor close was published) is never
modified. Version 2 is a separate, explicitly versioned retrospective import: every
observation carries the actual file receipt time of this capture. No price, rate, breadth,
sector or cost value is created, interpolated or adjusted here.
"""
import csv
import datetime as dt
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'data' / 'recovery'
RAW = ROOT / 'tmp' / 'recovery' / 'v2'
SYMBOLS = {'COMP': 'index', 'NDX': 'index', 'SOX': 'index', 'QQQ': 'etf', 'VT': 'etf', 'NVDA': 'stocks', 'MSFT': 'stocks', 'AAPL': 'stocks'}
FROM, TO = '2026-09-01', '2026-11-05'


def ms(value):
    return int(dt.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() * 1000)


def iso(value):
    return dt.datetime.fromtimestamp(value / 1000, dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def close_at(date):
    # US regular-session close: 16:00 New York. EDT until 1 November 2026, EST afterwards.
    hour = 20 if date < '2026-11-01' else 21
    if date in ('2026-11-27', '2026-12-24'):
        hour = 18
    return ms(f'{date}T{hour:02}:00:00Z')


def receipt(path):
    """Actual local write time of the raw response, rounded up to the whole second."""
    return (int(path.stat().st_mtime) + 1) * 1000


def number(text):
    return float(text.replace('$', '').replace(',', ''))


def main():
    out = DEST / 'november-3-2026-v2.json'
    if out.exists() and '--force-rebuild-from-same-capture' not in sys.argv:
        raise SystemExit('Version 2 already built; a new capture needs a new source version, not overwritten receipt times.')
    v1 = json.loads((DEST / 'november-3-2026.json').read_text(encoding='utf-8'))
    now = int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000)
    now = max(now, max(receipt(p) for p in RAW.iterdir()))
    sources, closes, indicators, fx_rows, revisions = [], [], [], [], []

    def source(**s):
        sources.append(dict(dict(publishedAt=None, publicationDate=None, publicationBasis='retrieval_upper_bound', verified=True, mode='retrospective', role='evidence'), **s))
        return sources[-1]

    for symbol, assetclass in SYMBOLS.items():
        path = RAW / f'nasdaq-{symbol.lower()}.json'
        url = f'https://api.nasdaq.com/api/quote/{symbol}/historical?assetclass={assetclass}&fromdate={FROM}&todate={TO}&limit=200'
        s = source(id=f'nasdaq-{symbol.lower()}-history-v2', title=f'Nasdaq public historical Close/Last table: {symbol} (5 November re-capture)', url=url, kind='official_market', receivedAt=receipt(path), usage='public_reference', permittedUse='Public reference display; commercial redistribution and executable-use licence not asserted')
        rows = json.loads(path.read_text(encoding='utf-8'))['data']['tradesTable']['rows']
        for row in rows:
            m, d, y = row['date'].split('/')
            date = f'{y}-{m}-{d}'
            closes.append(dict(symbol=symbol, date=date, value=number(row['close']), sourceId=s['id'], receivedAt=iso(s['receivedAt']), priceBasis='index-level' if assetclass == 'index' else 'unadjusted_close'))
    # Compare against the 3 November capture: any revision is reported, never silently merged.
    v1_close = {(p['instrumentId'], p['eventAt']): p['close'] for p in v1['prices']}
    for c in closes:
        old = v1_close.get((c['symbol'], close_at(c['date'])))
        if old is not None and abs(old - c['value']) > 1e-9:
            revisions.append(dict(symbol=c['symbol'], date=c['date'], v1=old, v2=c['value']))

    fred = {'VIXCLS': ('vix', 'CBOE S&P 500 volatility index close', 'index_points', 'Copyrighted CBOE series via FRED; citation required; public reference only'),
            'DGS10': ('treasury_10y', 'US Treasury 10-year constant maturity, daily yield', 'percent', 'Public domain Federal Reserve series; citation requested'),
            'BAMLH0A0HYM2': ('credit_spread', 'ICE BofA US High Yield option-adjusted spread', 'percent', 'ICE internal-use reference via FRED; redistribution requires permission; no feed licence asserted')}
    for series, (metric, population, unit, use) in fred.items():
        path = RAW / f'fred-{series}.csv'
        s = source(id=f'fred-{series.lower()}-v2', title=f'FRED {series} daily observations (5 November re-capture)', url=f'https://fred.stlouisfed.org/series/{series}', kind='economic', receivedAt=receipt(path), usage='public_reference', permittedUse=use)
        for row in csv.DictReader(path.read_text(encoding='utf-8').splitlines()):
            date, value = row['observation_date'], row[series]
            if value in ('', '.'):
                continue  # FRED marks unavailable observations; they stay missing.
            indicators.append(dict(id=f'{series}-{date}-v2', metric=metric, seriesId=series, populationDefinition=population, value=float(value), unit=unit, measurementAt=close_at(date), publishedAt=None, receivedAt=s['receivedAt'], sourceIds=[s['id']], mode='retrospective'))

    path = RAW / 'boe-XUDLUSS.csv'
    boe = source(id='boe-xudluss-v2', title='Bank of England XUDLUSS: spot USD per GBP, approx. 16:00 London (5 November capture)', url='https://www.bankofengland.co.uk/boeapps/database/', kind='economic', receivedAt=receipt(path), usage='public_reference', permittedUse='Bank of England statistical reference; indicative mid-market rate, not a dealing rate')
    for line in path.read_text(encoding='utf-8').splitlines():
        parts = line.split(',')
        try:
            date = dt.datetime.strptime(parts[0], '%d %b %Y').date().isoformat()
            usd_per_gbp = float(parts[1])
        except (ValueError, IndexError):
            continue
        # Fixing is ~16:00 London, before the 21:00 UTC US close: it is NOT a close-aligned rate.
        event = ms(f'{date}T16:00:00Z') if date >= '2026-10-25' else ms(f'{date}T15:00:00Z')
        fx_rows.append(dict(id=f'boe-xudluss-{date}', provider='Bank of England statistical database (XUDLUSS)', sourceUrl=boe['url'], licensed=False, permittedUse=None, **{'from': 'USD'}, to='GBP', eventAt=event, publishedAt=boe['receivedAt'], receivedAt=boe['receivedAt'], rate=1 / usd_per_gbp, conversionVersion='boe-xudluss-inverted-v1', mode='retrospective', supersedes=None))

    for s in v1['sources']:
        if s['id'] in ('nyse-calendar', 'vt-structure', 'cash-definition') or s['role'] == 'headline':
            sources.append(s)  # Original receipt times are preserved, not refreshed.
    nasdaq_sources = {s['id']: s for s in sources}
    instruments = []
    for i in v1['instruments']:
        i = dict(i, publishedAt=now, receivedAt=now)
        if i['product'] != 'cash':
            sid = f"nasdaq-{i['id'].lower()}-history-v2"
            i['sourceIds'] = [sid] + (['vt-structure'] if i['id'] == 'VT' else [])
            i['sourceUrl'] = nasdaq_sources[sid]['url']
        instruments.append(i)
    sessions, date = [], dt.date(2026, 9, 1)
    while date <= dt.date(2027, 2, 5):
        day = date.isoformat()
        if date.weekday() < 5 and day not in ('2026-09-07', '2026-11-26', '2026-12-25', '2027-01-01', '2027-01-18'):
            sessions.append(close_at(day))
        date += dt.timedelta(days=1)
    calendar = dict(v1['calendar'], id='US-cash-equities-regular-2026-2027-recovery-v2', publishedAt=now, receivedAt=now, sessionCloses=sessions)
    returned = sorted({c['date'] for c in closes})
    expected = [d for d in (dt.datetime.fromtimestamp(t / 1000, dt.timezone.utc).date().isoformat() for t in sessions) if FROM <= d <= '2026-11-04']
    if returned != expected:
        raise SystemExit(f'Calendar and returned sessions differ: {sorted(set(expected) ^ set(returned))}')
    prices = [dict(id=f"nasdaq-v2-{c['symbol']}-{c['date']}", instrumentId=c['symbol'], provider='Nasdaq public historical table', sourceIds=[c['sourceId']], sourceUrl=nasdaq_sources[c['sourceId']]['url'], eventAt=close_at(c['date']), publishedAt=None, receivedAt=ms(c['receivedAt']), currency='USD', close=c['value'], priceBasis=c['priceBasis'], adjustmentVersion='nasdaq-index-close-v1' if c['priceBasis'] == 'index-level' else 'nasdaq-unadjusted-undeclared-v1', session='regular', corporateActionsReviewed=c['priceBasis'] == 'index-level', licensed=False, permittedUse=None, usage='public_reference', mode='retrospective', supersedes=None) for c in closes]

    missing = {
        'licensedBreadth': 'No complete licensed Nasdaq Composite constituent advance/decline population imported',
        'sectorParticipation': 'No complete licensed sector-participation population imported',
        'analystTargetRevisions': 'No licensed analyst target-revision or rating-label feed configured; the frozen analyst snapshot holds zero recommendations',
        'licensedMarketFeed': 'Prices are public reference closes (licensed=false); paper portfolio accounting stays blocked',
        'closeAlignedLicensedFx': 'BoE XUDLUSS is an indicative ~16:00 London rate, not a licensed 21:00 UTC close-aligned rate',
        'costs': 'Dealing fees, spread, slippage, FX fee, platform fee and cash rate undisclosed (null, not zero)',
        'corporateActions': 'Stock/ETF closes are unadjusted; dividend and split treatment unreviewed',
        'macroAfterNov3': 'FRED VIXCLS, DGS10 and BAMLH0A0HYM2 had no 4 November observation at capture',
        'electionResults': 'No election result source imported; headlines are context only',
    }
    raw = dict(receivedAt=iso(min(s['receivedAt'] for s in sources if s['id'].endswith('-v2'))), asOfDate='2026-11-05', mode='retrospective', sourceVersion='recovery-006-2026-11-03-source-v2', supersedesSourceVersion=None, v1Revisions=revisions, closes=closes, indicators=[dict(id=i['id'], seriesId=i['seriesId'], measurementDate=iso(i['measurementAt'])[:10], value=i['value'], unit=i['unit'], receivedAt=iso(i['receivedAt'])) for i in indicators], fxUsdPerGbp=[dict(id=f['id'], fixingAt=iso(f['eventAt']), usdPerGbp=round(1 / f['rate'], 6), receivedAt=iso(f['receivedAt'])) for f in fx_rows], missing=missing, executionAuthority='none')
    case = dict(v1, id='recovery-006-2026-11-03-v2', name='Research Case 006 · US technology rebound · 3 November 2026 · source v2', sources=sources, instruments=instruments, calendar=calendar, prices=prices, fx=fx_rows, breadth=[], sectorParticipation=[], indicators=indicators)
    (DEST / 'sourced-observations-v2.json').write_text(json.dumps(raw, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    out.write_text(json.dumps(case, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    request = dict(case=case, cutoff=now, anchorAt=case['anchorAt'], registeredAt=now, benchmarkInstrumentId='VT', priceBasis='total-return', adjustmentVersion='licensed-provider-total-return-version-required', asOf=now)
    (DEST / 'november-3-2026-v2-request.json').write_text(json.dumps(request, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'v2: {len(prices)} closes, {len(indicators)} macro, {len(fx_rows)} FX rows, {len(revisions)} revisions vs v1. Cutoff {iso(now)}.')


if __name__ == '__main__':
    main()
