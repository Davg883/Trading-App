"""Versioned infrastructure-financing research, with no execution authority.

Timestamps are epoch milliseconds. This additive evaluator does not modify prior
financial, earnings, forecast or paper-accounting calculations.
"""
import argparse
import copy
import json
import math
import sys
from pathlib import Path
from urllib.parse import urlparse

from .research import number

VERSION = 'infrastructure-001.2-v1'
MODES = ('synthetic', 'historical', 'forward')
STATUSES = ('reported_discussion', 'announced', 'signed', 'funded', 'cancelled', 'expired')
COMMITMENT_TYPES = ('equity_investment', 'gpu_supply', 'commercial_contract', 'borrowing', 'guarantee', 'other_commitment')
CLAIM_TYPES = ('fact', 'discussion', 'forecast', 'contingent', 'speculation')


def text(value, name, nullable=False):
    if nullable and value is None:
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > 10000:
        raise ValueError(f'Invalid {name}')
    return value


def instant(value, nullable=False):
    if nullable and value is None:
        return None
    value = number(value)
    if value < 0:
        raise ValueError('Nonnegative timestamp required')
    return value


def strings(value, name):
    if not isinstance(value, list) or len(value) > 100:
        raise ValueError(f'Bounded {name} list required')
    for item in value:
        text(item, name)
    return value


def keys(record, required, name, optional=()):
    if not isinstance(record, dict) or not set(required)<=set(record) or not set(record)<=set(required)|set(optional):
        raise ValueError(f'{name} fields do not match the versioned contract')


def source_url(value):
    text(value, 'source URL')
    parsed = urlparse(value)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('HTTPS source without embedded credentials required')
    return value


def validate_source(source):
    keys(source, ('id', 'title', 'url', 'kind', 'publishedAt', 'receivedAt', 'verification', 'mode', 'role', 'supports'), 'Source')
    for field in ('id', 'title'):
        text(source[field], field)
    source_url(source['url'])
    if source['kind'] not in ('company', 'filing', 'news', 'regulator') or source['verification'] not in ('verified', 'corroborated', 'unverified') or source['mode'] not in MODES or source['role'] not in ('evidence', 'outcome'):
        raise ValueError('Invalid source classification')
    published, received = instant(source['publishedAt'], True), instant(source['receivedAt'])
    if published is not None and received < published:
        raise ValueError('Receipt cannot precede publication')
    if not isinstance(source['supports'], list) or len(source['supports']) > 100:
        raise ValueError('Bounded source assertions required')
    seen = set()
    for support in source['supports']:
        keys(support, ('eventId', 'status', 'binding'), 'Source assertion')
        text(support['eventId'], 'supported event')
        if support['status'] not in STATUSES or not isinstance(support['binding'], bool):
            raise ValueError('Invalid supported contractual state')
        key = (support['eventId'], support['status'])
        seen.add(key)
    return source


def validate_event(event):
    keys(event, ('id', 'eventId', 'revision', 'supersedes', 'issuer', 'borrower', 'guarantor', 'customer', 'projectId', 'type', 'principal', 'currency', 'maturityAt', 'status', 'claimType', 'publishedAt', 'receivedAt', 'sourceIds', 'mode', 'economicGroupId'), 'Event', ('financier',))
    for field in ('id', 'eventId', 'projectId'):
        text(event[field], field)
    for field in ('supersedes', 'issuer', 'borrower', 'guarantor', 'customer', 'economicGroupId'):
        text(event[field], field, True)
    if 'financier' in event:text(event['financier'],'financier',True)
    revision = number(event['revision'])
    if revision < 1 or int(revision) != revision:
        raise ValueError('Positive integer event revision required')
    if event['type'] not in COMMITMENT_TYPES or event['status'] not in STATUSES or event['claimType'] not in CLAIM_TYPES or event['mode'] not in MODES:
        raise ValueError('Invalid financing classification')
    if event['principal'] is not None and number(event['principal']) < 0:
        raise ValueError('Principal must be nonnegative or null')
    if event['currency'] is not None and (not isinstance(event['currency'], str) or len(event['currency']) != 3 or not event['currency'].isupper() or not event['currency'].isalpha()):
        raise ValueError('ISO currency or null required')
    if (event['principal'] is None) != (event['currency'] is None):
        raise ValueError('A principal requires its currency; missing amounts stay null')
    if all(event[k] is None for k in ('issuer','borrower','guarantor','customer')):
        raise ValueError('At least one identified counterparty required')
    if event['type']=='guarantee' and (event['borrower'] is None or event['guarantor'] is None):
        raise ValueError('Guarantee borrower and guarantor required')
    instant(event['maturityAt'], True)
    if instant(event['receivedAt']) < instant(event['publishedAt']):
        raise ValueError('Event receipt cannot precede publication')
    strings(event['sourceIds'], 'event source IDs')
    return event


def validate_relationship(row):
    keys(row, ('id', 'from', 'to', 'type', 'projectId', 'eventIds', 'sourceIds', 'certainty', 'economicGroupId'), 'Relationship')
    for field in ('id', 'from', 'to', 'projectId'):
        text(row[field], field)
    text(row['economicGroupId'], 'economic group', True)
    strings(row['eventIds'], 'relationship event IDs')
    strings(row['sourceIds'], 'relationship source IDs')
    if row['from']==row['to']:
        raise ValueError('Distinct relationship counterparties required')
    if row['type'] not in COMMITMENT_TYPES or row['certainty'] not in ('verified_contract', 'reported', 'inferred'):
        raise ValueError('Invalid relationship type or certainty')
    return row

METRICS = ('funding_committed', 'project_cost', 'contracted_backlog', 'recognised_revenue', 'cash_collections', 'installed_gpu_capacity', 'available_gpu_capacity', 'planned_power_mw', 'energised_power_mw', 'construction_committed', 'construction_paid', 'cash_available_for_debt_service', 'debt_service_due', 'capital_expenditure', 'customer_revenue', 'project_operating_cash_flow')
PRIMARY = ('company', 'filing', 'regulator')
DAY = 86_400_000


def validate_metric(row):
    keys(row, ('id', 'entity', 'projectId', 'metric', 'value', 'unit', 'currency', 'period', 'basis', 'definition', 'kind', 'sourceIds', 'eventIds', 'counterparty', 'mode'), 'Metric')
    for field in ('id', 'entity', 'basis', 'definition'):
        text(row[field], field)
    for field in ('projectId', 'counterparty'):
        text(row[field], field, True)
    if row['metric'] not in METRICS or row['unit'] not in ('currency', 'MW', 'GPU') or row['kind'] not in ('reported', 'forecast') or row['mode'] not in MODES:
        raise ValueError('Invalid metric identity, unit, kind or mode')
    number(row['value'])
    if row['metric'] not in ('project_operating_cash_flow','cash_available_for_debt_service') and row['value']<0:
        raise ValueError('This measurement cannot be negative')
    if row['currency'] is not None and (not isinstance(row['currency'], str) or len(row['currency']) != 3 or not row['currency'].isupper() or not row['currency'].isalpha()):
        raise ValueError('ISO currency or null required')
    if row['unit'] == 'currency' and row['currency'] is None or row['unit'] != 'currency' and row['currency'] is not None:
        raise ValueError('Metric currency must match monetary units')
    expected = 'GPU' if row['metric'] in ('installed_gpu_capacity', 'available_gpu_capacity') else 'MW' if row['metric'] in ('planned_power_mw', 'energised_power_mw') else 'currency'
    if row['unit'] != expected:
        raise ValueError('Power, GPU capacity and accounting units cannot substitute')
    keys(row['period'], ('start', 'end', 'label'), 'Reporting period')
    if instant(row['period']['start']) > instant(row['period']['end']):
        raise ValueError('Ordered reporting period required')
    text(row['period']['label'], 'period label')
    strings(row['sourceIds'], 'metric source IDs')
    if not row['sourceIds']:raise ValueError('At least one metric source required')
    strings(row['eventIds'], 'metric event IDs')
    return row


def source_eligible(source, cutoff, mode, primary=False):
    return (source['mode'] == mode and source['role'] == 'evidence' and source['publishedAt'] is not None
            and source['publishedAt'] <= cutoff and source['receivedAt'] <= cutoff and source['verification']!='unverified'
            and (not primary or source['kind'] in PRIMARY and source['verification'] == 'verified'))


def validate_transition(previous, event, sources, cutoff):
    validate_event(event); instant(cutoff)
    if event['publishedAt']>cutoff or event['receivedAt']>cutoff:
        raise ValueError('Event was unavailable at cutoff')
    if previous:
        if event['eventId']!=previous['eventId'] or event['revision']!=previous['revision']+1 or event['supersedes']!=previous['id'] or event['projectId']!=previous['projectId'] or event['type']!=previous['type'] or event['mode']!=previous['mode'] or event['receivedAt']<previous['receivedAt'] or event['publishedAt']<previous['publishedAt'] or any(event.get(k)!=previous.get(k) for k in ('issuer','borrower','guarantor','customer','financier','economicGroupId')):
            raise ValueError('Status revision must preserve identity and ordered history')
        if previous['status'] in ('cancelled','expired') and event['status']!=previous['status']:
            raise ValueError('Terminal events cannot be silently revived')
    elif event['revision']!=1 or event['supersedes'] is not None:
        raise ValueError('First event revision starts a complete history')
    candidates=[source for source in sources if source['id'] in event['sourceIds'] and source_eligible(source,cutoff,event['mode'])
                and any(s['eventId']==event['eventId'] and s['status']==event['status'] for s in source['supports'])]
    if not candidates:raise ValueError('Status requires eligible source evidence scoped to this event')
    if previous and previous['status']==event['status'] and any(previous[k]!=event[k] for k in ('principal','currency','maturityAt')):
        amended=[source for source in candidates if source['id'] not in previous['sourceIds']]
        if not any(event['status'] not in ('signed','funded') or source['kind'] in PRIMARY and source['verification']=='verified' and any(s['eventId']==event['eventId'] and s['status']==event['status'] and s['binding'] for s in source['supports']) for source in amended):
            raise ValueError('Changed contractual terms require a new suitable source revision, not reused original evidence')
    if event['status'] in ('signed','funded'):
        if event['claimType'] not in ('fact','contingent') or event['claimType']=='contingent' and event['type']!='guarantee':
            raise ValueError('Discussions, forecasts and speculation cannot be signed obligations')
        if not any(source['kind'] in PRIMARY and source['verification']=='verified' and any(s['eventId']==event['eventId'] and s['status']==event['status'] and s['binding'] for s in source['supports']) for source in candidates):
            raise ValueError('Signed or funded status requires verified primary binding evidence')
    if event['status'] in ('announced','cancelled','expired') and event['claimType'] in ('forecast','speculation'):
        raise ValueError('Forecasts and speculation cannot establish contractual status')
    if previous and previous['status']!=event['status']:
        allowed={'reported_discussion':('announced','signed','funded','cancelled','expired'), 'announced':('signed','funded','cancelled','expired'),
                 'signed':('funded','cancelled','expired'),'funded':('cancelled','expired'),'cancelled':(),'expired':()}
        if event['status'] not in allowed[previous['status']]:raise ValueError('Unsupported contractual status transition')
    return event


def relation_parties_match(relation,event):
    parties=[event.get(k) for k in ('issuer','financier','borrower','guarantor','customer')]
    return relation['from'] in parties and relation['to'] in parties and (relation['type']!='guarantee' or relation['from']==event['guarantor'] and relation['to']==event['borrower'])


def parse_infrastructure_case(value):
    keys(value, ('version', 'id', 'name', 'mode', 'sources', 'events', 'relationships', 'metrics'), 'Infrastructure case')
    if value['version'] != VERSION or value['mode'] not in MODES:
        raise ValueError('Explicit infrastructure version and evidence mode required')
    text(value['id'], 'case ID'); text(value['name'], 'case name')
    specifications = (('sources', validate_source), ('events', validate_event), ('relationships', validate_relationship), ('metrics', validate_metric))
    for field, validate in specifications:
        rows = value[field]
        if not isinstance(rows, list) or len(rows) > {'sources':500,'events':1000,'relationships':1000,'metrics':2000}[field]:
            raise ValueError(f'Bounded {field} list required')
        seen = set()
        for row in rows:
            validate(row)
            if row['id'] in seen:
                raise ValueError(f'Unique {field} IDs required')
            seen.add(row['id'])
            if 'mode' in row and row['mode'] != value['mode']:
                raise ValueError('Synthetic, historical and forward records cannot mix')
    source_ids = {source['id'] for source in value['sources']}
    event_ids = {event['eventId'] for event in value['events']}
    histories={}
    for event in value['events']:
        if any(identity not in source_ids for identity in event['sourceIds']):raise ValueError('Event source is missing')
        histories.setdefault(event['eventId'],[]).append(event)
    for history in histories.values():
        history.sort(key=lambda e:e['revision'])
        for index,event in enumerate(history):validate_transition(history[index-1] if index else None,event,value['sources'],event['receivedAt'])
    for field in ('relationships', 'metrics'):
        for row in value[field]:
            if any(identity not in source_ids for identity in row['sourceIds']) or any(identity not in event_ids for identity in row['eventIds']):
                raise ValueError('Source or event reference outside the case')
    for link in value['relationships']:
        if link['certainty'] == 'verified_contract':
            matching = [event for event in value['events'] if event['eventId'] in link['eventIds'] and event['projectId'] == link['projectId'] and event['type'] == link['type'] and event['status'] in ('signed', 'funded')]
            if not link['eventIds'] or not link['sourceIds'] or not any(relation_parties_match(link,e) and any(identity in link['sourceIds'] and any(source['id']==identity and source['kind'] in PRIMARY and source['verification']=='verified' and any(p['eventId']==e['eventId'] and p['status']==e['status'] and p['binding'] for p in source['supports']) for source in value['sources']) for identity in e['sourceIds']) for e in matching):
                raise ValueError('Speculative relationships cannot be verified contractual links')
    return copy.deepcopy(value)


def freeze_infrastructure_case(value, cutoff):
    case=parse_infrastructure_case(value);instant(cutoff);excluded=[];sources=[]
    for source in case['sources']:
        if source_eligible(source,cutoff,case['mode']):sources.append(source)
        else:
            reason='Market outcome cannot enter earlier research evidence' if source['role']=='outcome' else 'Publication time is unknown' if source['publishedAt'] is None else 'Source remains unverified' if source['verification']=='unverified' else 'Publication or receipt follows cutoff'
            excluded.append({'id':source['id'],'reason':reason})
    active={};eligible_events=[];by_id={e['id']:e for e in case['events']}
    for event in sorted(case['events'],key=lambda e:e['revision']):
        try:
            validate_transition(None if event['revision']==1 else by_id.get(event['supersedes']),event,sources,cutoff)
            active[event['eventId']]=event;eligible_events.append(event)
        except ValueError as error:excluded.append({'id':event['id'],'reason':str(error)})
    source_ids={s['id'] for s in sources};relationships=[];metrics=[]
    for relation in case['relationships']:
        matching=[active[identity] for identity in relation['eventIds'] if identity in active]
        eligible=bool(relation['sourceIds']) and all(identity in source_ids for identity in relation['sourceIds']) and all(identity in active for identity in relation['eventIds']) and (relation['certainty']!='verified_contract' or any(e['status'] in ('signed','funded') and relation_parties_match(relation,e) and e['type']==relation['type'] and any(identity in relation['sourceIds'] and any(s['id']==identity and s['kind'] in PRIMARY and s['verification']=='verified' and any(p['eventId']==e['eventId'] and p['status']==e['status'] and p['binding'] for p in s['supports']) for s in sources) for identity in e['sourceIds']) for e in matching))
        if eligible:relationships.append(relation)
        else:excluded.append({'id':relation['id'],'reason':'Relationship evidence is unavailable, cancelled or not a verified contract at this cutoff'})
    for row in case['metrics']:
        if all(identity in source_ids for identity in row['sourceIds']) and all(identity in active for identity in row['eventIds']) and (row['kind']!='reported' or row['period']['end']<=cutoff and all(any(source['id']==identity and source['publishedAt'] is not None and row['period']['end']<=source['publishedAt'] for source in sources) for identity in row['sourceIds'])):metrics.append(row)
        else:excluded.append({'id':row['id'],'reason':'Metric source or event is unavailable at cutoff'})
    return {'version':VERSION,'cutoff':cutoff,'case':{**case,'sources':sources,'events':eligible_events,'relationships':relationships,'metrics':metrics},'activeEvents':list(active.values()),'excluded':excluded,'executionAuthority':'none'}


def active_events(case):
    latest = {}
    for event in case['events']:
        if event['eventId'] not in latest or latest[event['eventId']]['revision'] < event['revision']:
            latest[event['eventId']] = event
    return list(latest.values())


def missing(reason, unit='ratio', source_ids=None):
    return {'value': None, 'reason': reason, 'sourceIds': list(source_ids or []), 'unit': unit}

def _current_case(value, cutoff):
    snapshot=freeze_infrastructure_case(value,cutoff)
    return {**snapshot['case'],'events':snapshot.get('activeEvents',active_events(snapshot['case']))}


def _calculation(rows,unit,operation):
    try:
        value=operation()
        if not math.isfinite(value) or abs(value)>9007199254740991:
            raise ValueError('Undefined or unsupported result')
        return {'value':value,'reason':None,'sourceIds':list(dict.fromkeys(identity for row in rows for identity in row['sourceIds'])),'unit':unit}
    except (ValueError,ZeroDivisionError) as error:
        return missing(str(error),unit)


def infrastructure_kpis(value,entity,project_id,cutoff):
    case=_current_case(value,cutoff)
    observed=[m for m in case['metrics'] if m['entity']==entity and m['projectId']==project_id and m['kind']=='reported'
              and m['period']['end']<=cutoff and all(any(s['id']==identity and s['kind'] in PRIMARY and s['verification']=='verified' for s in case['sources']) for identity in m['sourceIds'])]
    def get(metric,counterparty=None):
        rows=[m for m in observed if m['metric']==metric and (metric!='customer_revenue' or m['counterparty']==counterparty)]
        return rows[0] if len(rows)==1 else None
    def compatible(a,b):
        if any(a[key]!=b[key] for key in ('unit','currency','basis')) or any(a['period'][key]!=b['period'][key] for key in ('start','end')):
            raise ValueError('Compatible reporting periods, currency, units and definitions required')
    def ratio(a,b,unit='ratio'):
        x,y=get(a),get(b)
        if not x or not y:return missing(f'One compatible reported {a} and {b} required',unit)
        def operation():
            compatible(x,y)
            if y['value']<=0:raise ValueError('Positive denominator required')
            return x['value']/y['value']
        return _calculation([x,y],unit,operation)
    def direct(name,unit):
        row=get(name)
        return {'value':row['value'],'reason':None,'sourceIds':row['sourceIds'],'unit':unit} if row else missing(f'No unique compatible reported {name}',unit)
    funding=ratio('funding_committed','project_cost');committed=get('funding_committed')
    if committed and (not committed['eventIds'] or any(not any(e['eventId']==identity and e['status'] in ('signed','funded') and e['type'] in ('borrowing','equity_investment','other_commitment') for e in case['events']) for identity in committed['eventIds'])):
        funding=missing('Funding coverage requires borrowing, equity or explicit cash-funding commitments; customer backlog, commercial contracts and contingent guarantees are not cash funding')
    concentrations=[]
    counterparties=list(dict.fromkeys(m['counterparty'] for m in observed if m['metric']=='customer_revenue' and m['counterparty'] is not None))
    for counterparty in counterparties:
        a,b=get('customer_revenue',counterparty),get('recognised_revenue')
        def operation(a=a,b=b):
            compatible(a,b)
            if a['definition']!=b['definition'] or b['value']<=0 or a['value']>b['value']:
                raise ValueError('Customer concentration requires compatible recognised-revenue definitions and totals')
            return a['value']/b['value']
        result=missing('Unique compatible customer and total recognised revenue required') if not a or not b else _calculation([a,b],'ratio',operation)
        concentrations.append({'counterparty':counterparty,**result})
    c,p=get('construction_committed'),get('construction_paid')
    def construction():
        compatible(c,p);remaining=c['value']-p['value']
        if remaining<0:raise ValueError('Construction payments exceed compatible commitments')
        return remaining
    construction_exposure=missing('Reported construction commitments and cash paid required','currency') if not c or not p else _calculation([c,p],'currency',construction)
    payback=ratio('project_cost','project_operating_cash_flow','years');cash=get('project_operating_cash_flow')
    if cash and not 364*DAY<=cash['period']['end']-cash['period']['start']<=366*DAY:
        payback=missing('Project cash payback requires a reported annual operating-cash-flow period','years')
    guarantees=[e for e in case['events'] if e['type']=='guarantee' and e['status'] in ('signed','funded') and e['guarantor']==entity and (project_id is None or e['projectId']==project_id)]
    total=_economic_exposure_from_active({**case,'events':guarantees})
    guarantee=missing(total['reason'] or 'Verified guarantee principal unavailable','currency') if total['totalPrincipal'] is None else {'value':total['totalPrincipal'],'reason':None,'sourceIds':list(dict.fromkeys(identity for e in guarantees for identity in e['sourceIds'])),'unit':total['currency'] or 'currency'}
    return {'version':VERSION,'fundingCoverage':funding,'customerConcentration':concentrations,'powerReadiness':ratio('energised_power_mw','planned_power_mw','power-only ratio'),
            'constructionExposure':construction_exposure,'debtServiceCapacity':ratio('cash_available_for_debt_service','debt_service_due'),
            'guaranteeExposure':guarantee,'capitalIntensity':ratio('capital_expenditure','recognised_revenue'),'projectCashPayback':payback,
            'distinctMetrics':{'contractedBacklog':direct('contracted_backlog','currency'),'recognisedRevenue':direct('recognised_revenue','currency'),
                               'cashCollections':direct('cash_collections','currency'),'installedCapacity':direct('installed_gpu_capacity','GPU'),
                               'commerciallyAvailableCapacity':direct('available_gpu_capacity','GPU')}}


def _economic_exposure_from_active(case):
    events=[e for e in case['events'] if e['status'] in ('signed','funded')]
    grouped={};reason=None;double=False
    for event in events:
        if not event['economicGroupId']:
            reason='Explicit underlying economic group IDs are required before aggregation';continue
        grouped.setdefault(event['economicGroupId'],[]).append(event)
    groups=[]
    for identity,rows in grouped.items():
        currencies=set(e['currency'] for e in rows);types=set(e['type'] for e in rows);principal=None
        financing=all(t in ('borrowing','guarantee') for t in types)
        measurement='financing_principal' if financing else next(iter(types)) if len(types)==1 else 'incompatible_commitments'
        if any(e['principal'] is None for e in rows) or len(currencies)!=1:
            reason='Missing principal or incompatible currency prevents aggregation'
        elif not financing and len(types)>1:
            reason='Contract value, equity and financing principal are different measurements and cannot be added'
        else:
            amounts=set(e['principal'] for e in rows)
            if len(rows)>1:double=True
            loans=[e for e in rows if e['type']=='borrowing'];guarantees=[e for e in rows if e['type']=='guarantee']
            if financing and len(loans)==1 and all(g['principal']<=loans[0]['principal'] for g in guarantees):principal=loans[0]['principal']
            elif len(amounts)==1:principal=rows[0]['principal']
            else:reason='Unequal overlapping commitments require reconciliation before aggregation'
        groups.append({'economicGroupId':identity,'principal':principal,'currency':rows[0]['currency'] if len(currencies)==1 else None,
                       'eventIds':[e['eventId'] for e in rows],'measurementType':measurement})
    for index,a in enumerate(events):
        for b in events[index+1:]:
            if a['projectId']==b['projectId'] and a['economicGroupId']!=b['economicGroupId'] and a['type']!=b['type']:
                double=True;reason='Supplier, customer or financing commitments may share one project exposure; cross-type totals require reconciliation'
    currencies=set(g['currency'] for g in groups);types=set(g['measurementType'] for g in groups)
    if len(currencies)>1:reason='Multiple currencies require explicit sourced normalization before aggregation'
    if len(types)>1:reason='Commercial contract values, equity and debt principal are not comparable aggregate exposure measures'
    if not events:reason='No verified active contractual principal is available'
    total=None if reason else sum(g['principal'] for g in groups)
    if total is not None and (not math.isfinite(total) or total>9007199254740991):reason='Aggregate exceeds supported finite precision'
    return {'version':VERSION,'totalPrincipal':None if reason else total,'currency':next(iter(currencies)) if len(currencies)==1 else None,
            'groups':groups,'potentialDoubleCounting':double,'reason':reason,
            'measurement':'Underlying comparable contractual principal only; not net balance-sheet loss exposure. A guarantee is not added again to the loan it covers.',
            'executionAuthority':'none'}


def economic_exposure(value,cutoff):
    return _economic_exposure_from_active(_current_case(value,cutoff))


def risk_review(value,cutoff):
    case=_current_case(value,cutoff);exposure=_economic_exposure_from_active(case);alerts=[]
    discussions=[e for e in case['events'] if e['status']=='reported_discussion']
    if discussions:alerts.append('Reported financing discussions remain uncommitted and cannot fund a signed-obligation total.')
    if any(e['status']=='cancelled' for e in case['events']):alerts.append('A cancelled commitment requires project-specific funding and customer-replacement review; it does not cancel unrelated projects.')
    if exposure['potentialDoubleCounting'] or exposure['reason']:alerts.append('Potential overlap or incomplete principal prevents an unqualified aggregate exposure claim.')
    supplier=any(e['type']=='guarantee' and e['guarantor'] and any(r['type']=='gpu_supply' and r['projectId']==e['projectId'] and r['from']==e['guarantor'] and r['to']==e['borrower'] for r in case['relationships']) for e in case['events'])
    if supplier:alerts.append('A reported supplier-financing and purchase dependency warrants independent review; it does not prove a direct supplier sales contract or recognized revenue.')
    if not any(m['metric']=='available_gpu_capacity' and m['kind']=='reported' and m['value']>0 and all(any(source['id']==identity and source['kind'] in PRIMARY and source['verification']=='verified' for source in case['sources']) for identity in m['sourceIds']) for m in case['metrics']):alerts.append('Commercially available GPU capacity is unproven; planned power or installed equipment is not available service capacity.')
    return {'version':VERSION,'alerts':alerts,'unresolvedFinancing':bool(discussions),'supplierFundedPurchases':supplier,
            'potentialDoubleCounting':exposure['potentialDoubleCounting'],'researchOnly':True,'executionAuthority':'none'}


def evaluate(request):
    if not isinstance(request,dict):raise ValueError('Infrastructure evaluation request required')
    case=parse_infrastructure_case(request['case']);cutoff=instant(request['cutoff']);entity=text(request['entity'],'entity');project=text(request.get('projectId'),'project',True)
    return {'version':VERSION,'snapshot':freeze_infrastructure_case(case,cutoff),'kpis':infrastructure_kpis(case,entity,project,cutoff),
            'exposure':economic_exposure(case,cutoff),'review':risk_review(case,cutoff),'executionAuthority':'none'}


def main():
    parser=argparse.ArgumentParser(description='Infrastructure financing evidence and KPIs; no execution authority')
    parser.add_argument('input');parser.add_argument('--output');args=parser.parse_args()
    try:
        request=json.loads(Path(args.input).read_text(encoding='utf-8-sig'));result=evaluate(request)
        encoded=json.dumps(result,indent=2,sort_keys=True,allow_nan=False)+'\n'
        if args.output:
            with Path(args.output).open('x',encoding='utf-8') as output:output.write(encoded)
        else:print(encoded,end='')
        return 0
    except (ValueError,KeyError,TypeError,OSError) as error:
        print(json.dumps({'error':str(error)}),file=sys.stderr);return 2


if __name__=='__main__':raise SystemExit(main())
