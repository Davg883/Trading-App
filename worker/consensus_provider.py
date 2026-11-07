"""Licensed Benzinga ratings import. Keys remain in the worker; no brokerage calls."""
import argparse
import copy
from datetime import datetime, timedelta, timezone
import json
import math
import os
from pathlib import Path
import sys
import time
from urllib.parse import urlencode, urlparse
from urllib.request import Request, HTTPRedirectHandler, build_opener

ENDPOINT = 'https://api.benzinga.com/api/v2.1/calendar/ratings'
SYMBOLS = ('NVDA', 'MSFT', 'AAPL')


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        raise ValueError('Provider redirects are blocked')


def instant(value):
    if type(value) is not int or not 0 <= value <= 8_640_000_000_000_000:
        raise ValueError('Integer timestamp required')
    return value


def licensed(metadata):
    if not isinstance(metadata, dict) or metadata.get('licenseConfirmed') is not True or not isinstance(metadata.get('permittedUse'), str) or not metadata['permittedUse'].strip():
        raise ValueError('Operator-confirmed provider licence and permitted use required')
    if type(metadata.get('utcOffsetMinutes')) is not int or not -720 <= metadata['utcOffsetMinutes'] <= 840:
        raise ValueError('Provider publication timezone must be explicitly verified')
    if not isinstance(metadata.get('ratingScale'), list) or not metadata.get('analystUniverse'):
        raise ValueError('Explicit rating mapping and coverage population required')
    return metadata


def provider_get(url):
    parsed = urlparse(url)
    if parsed.scheme != 'https' or parsed.netloc != 'api.benzinga.com' or parsed.path != '/api/v2.1/calendar/ratings':
        raise ValueError('Only the official ratings endpoint is permitted')
    request = Request(url, headers={'Accept': 'application/json'}, method='GET')
    with build_opener(NoRedirect()).open(request, timeout=20) as response:
        body = response.read(2_000_001)
    if len(body) > 2_000_000: raise ValueError('Provider body exceeds import limit')
    return json.loads(body)


def fetch_ratings(metadata, from_date, to_date, allow_provider_request=False, env=None, transport=provider_get):
    licensed(metadata)
    if allow_provider_request is not True: raise ValueError('Explicit provider request opt-in required')
    key = (os.environ if env is None else env).get('BENZINGA_API_KEY')
    if not isinstance(key, str) or not key.strip(): raise ValueError('Server-side provider key missing')
    start, end = datetime.fromisoformat(from_date), datetime.fromisoformat(to_date)
    if start > end or (end-start).days > 1100: raise ValueError('Bounded date range required')
    rows = []; seen = set()
    for page in range(11):
        params = {'token': key, 'page': page, 'pagesize': 1000, 'parameters[date_from]': from_date, 'parameters[date_to]': to_date, 'parameters[tickers]': ','.join(SYMBOLS)}
        raw = transport(ENDPOINT+'?'+urlencode(params))
        chunk = raw.get('ratings') if isinstance(raw, dict) else None
        if not isinstance(chunk, list) or len(chunk) > 1000: raise ValueError('Invalid or oversized provider page')
        for row in chunk:
            identity = (str(row.get('id')), str(row.get('updated')))
            if identity in seen: raise ValueError('Duplicate provider pagination; incomplete import rejected')
            seen.add(identity)
        rows.extend(chunk)
        if len(chunk) < 1000: return {'ratings': rows}, int(time.time()*1000)
        if len(rows) >= 10000: raise ValueError('Provider pagination limit reached; narrow the date range')
    raise ValueError('Provider pagination did not terminate')


def _target(value):
    if value is None or value == '': return None
    if isinstance(value, bool): raise ValueError('Invalid target')
    result = float(value)
    if not math.isfinite(result) or not 0 <= result <= 9_007_199_254_740_991: raise ValueError('Invalid target')
    return result


def normalize_ratings(raw, base_case, metadata, received_at, from_date, to_date):
    """Keep first receipt on exact retries; quarantine incomplete/conflicting vendor rows."""
    licensed(metadata); instant(received_at)
    if not isinstance(raw, dict) or not isinstance(raw.get('ratings'), list) or len(raw['ratings']) > 10000:
        raise ValueError('Bounded ratings response required')
    data = copy.deepcopy(base_case)
    if data.get('mode') != 'retrospective': raise ValueError('This adapter imports retrospective observations only')
    provider_id = 'benzinga-licensed'
    provider = {'id': provider_id, 'name': 'Benzinga licensed ratings import', 'sourceUrl': 'https://docs.benzinga.com/api-reference/calendar-api/get-ratings', 'licensed': True, 'permittedUse': metadata['permittedUse'], 'mode': 'retrospective', 'ratingScale': metadata['ratingScale'], 'coverage': {'startAt': int(datetime.fromisoformat(from_date).replace(tzinfo=timezone.utc).timestamp()*1000), 'endAt': int(datetime.fromisoformat(to_date).replace(hour=23, minute=59, second=59, microsecond=999000, tzinfo=timezone.utc).timestamp()*1000), 'publishedAt': received_at, 'receivedAt': received_at, 'complete': metadata.get('coverageComplete') is True, 'symbols': list(SYMBOLS), 'analystUniverse': metadata['analystUniverse']}}
    data['providers'] = [p for p in data['providers'] if p['id'] != provider_id]+[provider]
    quarantine = []; inserted = 0
    for index, row in enumerate(raw['ratings']):
        try:
            if not isinstance(row, dict) or row.get('ticker') not in SYMBOLS: raise ValueError('Unsupported or missing symbol')
            for field in ('id', 'analyst_name', 'analyst', 'date', 'time', 'rating_current'):
                if not isinstance(row.get(field), str) or not row[field].strip(): raise ValueError('Missing analyst identity, original publication time or rating')
            day = row['date']
            if not from_date <= day <= to_date: raise ValueError('Publication date outside requested coverage')
            published = int(datetime.fromisoformat(day+'T'+row['time']).replace(tzinfo=timezone(timedelta(minutes=metadata['utcOffsetMinutes']))).timestamp()*1000)
            updated_raw = row.get('updated')
            if type(updated_raw) not in (int, float) or not math.isfinite(updated_raw): raise ValueError('Provider UTC update timestamp required')
            updated = int(updated_raw*1000)
            if not 0 <= published <= updated <= received_at: raise ValueError('Conflicting publication, provider update or receipt timestamp')
            target, prior = _target(row.get('pt_current')), _target(row.get('pt_prior'))
            denomination = row.get('currency')
            if (target is not None or prior is not None) and (not isinstance(denomination, str) or len(denomination) != 3 or not denomination.isalpha() or not denomination.isupper()): raise ValueError('Target currency missing')
            identity = 'benzinga:'+row['id']+':'+str(updated)
            previous = [r for r in data['recommendations'] if r['id'].startswith('benzinga:'+row['id']+':')]
            same = next((r for r in previous if r['id'] == identity), None)
            predecessor = max(previous, key=lambda r:r['updatedAt'], default=None)
            source = row.get('url_news') or row.get('url')
            parsed = urlparse(source or '')
            if parsed.scheme != 'https' or parsed.hostname not in ('www.benzinga.com', 'benzinga.com') or parsed.username or parsed.password or parsed.query or parsed.fragment:
                source = 'https://www.benzinga.com/quote/'+row['ticker']+'/analyst-ratings'
            record = {'id': identity, 'providerId': provider_id, 'analyst': row['analyst_name'], 'institution': row['analyst'], 'symbol': row['ticker'], 'rating': row['rating_current'], 'previousRating': row.get('rating_prior') or None, 'target': target, 'previousTarget': prior, 'targetCurrency': denomination if target is not None or prior is not None else None, 'publishedAt': published, 'updatedAt': updated, 'receivedAt': received_at, 'sourceUrl': source, 'mode': 'retrospective', 'supersedes': same['supersedes'] if same else predecessor['id'] if predecessor else None}
            if predecessor and any(predecessor[k] != record[k] for k in ('analyst','institution','symbol')): raise ValueError('Provider event identity changed')
            if same:
                if any(same[k] != record[k] for k in record if k != 'receivedAt'): raise ValueError('Conflicting same-version vendor correction')
                continue
            data['recommendations'].append(record); inserted += 1
        except (ValueError, TypeError, KeyError, OverflowError):
            quarantine.append({'row': index, 'reason': 'Identity, timestamp, target, currency or revision requires provider reconciliation'})
    data['id'] = 'consensus-benzinga-import-'+str(received_at)
    return {'case': data, 'inserted': inserted, 'quarantine': quarantine, 'rightsStatus': 'Operator-declared permission; deployment must independently verify the licence', 'publicationTimezoneOffsetMinutes': metadata['utcOffsetMinutes']}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--case',required=True); parser.add_argument('--licence',required=True); parser.add_argument('--input'); parser.add_argument('--from-date',required=True); parser.add_argument('--to-date',required=True); parser.add_argument('--output',required=True); parser.add_argument('--allow-provider-request',action='store_true')
    args=parser.parse_args()
    try:
        base=json.loads(Path(args.case).read_text(encoding='utf-8-sig')); metadata=json.loads(Path(args.licence).read_text(encoding='utf-8-sig'))
        if Path(args.output).exists(): raise ValueError('Output exists')
        if args.input:
            if Path(args.input).stat().st_size > 8_000_000: raise ValueError('Input exceeds import limit')
            raw=json.loads(Path(args.input).read_text(encoding='utf-8-sig')); received=int(time.time()*1000)
        else: raw,received=fetch_ratings(metadata,args.from_date,args.to_date,args.allow_provider_request)
        outcome=normalize_ratings(raw,base,metadata,received,args.from_date,args.to_date)
        from worker.analyst_consensus import parse_consensus_case
        parse_consensus_case(outcome['case'])
        with Path(args.output).open('x',encoding='utf8') as stream:json.dump(outcome,stream,ensure_ascii=False,indent=2,allow_nan=False)
        print(json.dumps({'status':'imported_with_quarantine' if outcome['quarantine'] else 'imported','inserted':outcome['inserted'],'quarantined':len(outcome['quarantine']),'executionAuthority':'none'}));return 0
    except Exception:
        print(json.dumps({'error':'Import blocked. Check licence, server key, verified publication timezone, input dates and output path. No provider URL, credentials or response body are logged.'}),file=sys.stderr);return 2


if __name__=='__main__':raise SystemExit(main())
