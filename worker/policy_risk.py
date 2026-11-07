"""Benchmark 001.2 US Midterm Infrastructure Risk: offline reproduction of lib/policy-risk.ts.

Research only. The evaluator never creates orders, positions or broker requests.
"""
import argparse
import datetime as dt
import json
import math
import re
import sys
from pathlib import Path

VERSION = 'policy-risk-001.2-v1'
HORIZONS = (1, 5, 20, 60)
INSTRUMENTS = ('election', 'campaign_statement', 'ballot_initiative', 'referendum', 'advisory_question', 'bill', 'executive_order', 'ordinance', 'court_order', 'utility_rule', 'tax_measure', 'company_disclosure')
STATUSES = ('campaign_proposal', 'candidate_elected', 'candidate_leading', 'introduced', 'passed_one_chamber', 'passed_legislature', 'enacted', 'in_force', 'approved_unofficial', 'approved_certified', 'rejected_unofficial', 'rejected_certified', 'enacted_challenged', 'court_order', 'enjoined', 'struck_down', 'expired', 'repealed', 'not_proceeding')
DIRECTIONS = ('restrictive', 'permissive', 'cost_allocation', 'neutral', 'unknown')
RELATIONS = ('direct', 'adjacent', 'jurisdiction_only', 'unclear_per_authority', 'company_states_unaffected', 'not_applicable')
STAGES = ('proposed', 'site_control', 'permitting', 'permitting_on_hold', 'approved', 'site_preparation', 'under_construction', 'partially_energised', 'operational', 'delayed', 'not_proceeding', 'cancelled')
RANK = {'low': 0, 'medium': 1, 'high': 2}
SECRET = re.compile(r'^(?:token|key|api[_-]?key|secret|password|auth|signature)$', re.I)


def fail(message):
    raise ValueError(message)


def instant(v):
    if isinstance(v, bool) or not isinstance(v, int) or v < 0 or v > 8.64e15:
        fail('Invalid timestamp')
    return v


def strict(row, keys, where):
    if not isinstance(row, dict) or set(row) != set(keys.split()):
        fail(f'{where}: unexpected or missing fields')


def check_url(u):
    if not isinstance(u, str) or not u.startswith('https://') or '@' in u.split('/')[2]:
        fail('Source URLs must be https without credentials')
    query = u.split('?', 1)[1] if '?' in u else ''
    if any(SECRET.match(part.split('=')[0]) for part in query.split('&') if part):
        fail('Source URLs cannot carry credentials')


def parse_policy_case(value):
    data = json.loads(json.dumps(value))
    strict(data, 'version id name mode anchorAt anchorEventId sources events projects links economicObservations groups benchmarkTicker calendar prices hypotheses aggregateContext', 'policy case')
    if data['version'] != VERSION:
        fail('Unsupported policy-risk version')
    if data['mode'] not in ('retrospective', 'synthetic', 'forward'):
        fail('Invalid mode')
    instant(data['anchorAt'])
    sources = set()
    for s in data['sources']:
        strict(s, 'id title url kind authority publishedAt publicationDate publicationBasis receivedAt role usage mode', 'source')
        check_url(s['url']); instant(s['receivedAt'])
        if s['publishedAt'] is not None and instant(s['publishedAt']) > s['receivedAt']:
            fail('Source publication follows receipt')
        if s['authority'] not in ('primary', 'secondary') or s['role'] not in ('evidence', 'outcome', 'headline'):
            fail('Invalid source classification')
        if s['id'] in sources:
            fail('Duplicate source')
        sources.add(s['id'])

    def refs(ids, where):
        if not ids or any(i not in sources for i in ids):
            fail(f'{where}: unknown or missing source')
    events = set()
    for e in data['events']:
        strict(e, 'id revision supersedes title jurisdiction instrument legalStatus binding direction mechanisms eventDate effectiveDate expiresDate expiryCondition scope outcome uncertainty uncertaintyNotes conflictingSources sourceIds receivedAt mode', 'event')
        if e['instrument'] not in INSTRUMENTS or e['legalStatus'] not in STATUSES or e['direction'] not in DIRECTIONS or e['uncertainty'] not in RANK:
            fail(f"{e['id']}: invalid enumeration")
        if e['effectiveDate'] and e['expiresDate'] and e['effectiveDate'] > e['expiresDate']:
            fail('Effective date follows expiry')
        refs(e['sourceIds'], e['id']); events.add(e['id'])
    projects = set()
    for p in data['projects']:
        strict(p, 'id name companies state locality site plannedMw energisedMw mwBasis securedGridMw requestedGridMw stage equipmentCommitments financing customers expectedOpening timelineRevisions notes sourceIds receivedAt mode', 'project')
        if p['stage'] not in STAGES:
            fail('Invalid stage')
        if p['plannedMw'] is not None and p['energisedMw'] is not None and p['energisedMw'] > p['plannedMw']:
            fail('Energised capacity exceeds planned capacity')
        refs(p['sourceIds'], p['id'])
        for r in p['financing'] + p['customers'] + p['timelineRevisions'] + p['equipmentCommitments']:
            refs(r['sourceIds'], p['id'])
        projects.add(p['id'])
    for l in data['links']:
        strict(l, 'id projectId eventId relation substantiation note sourceIds receivedAt mode', 'link')
        if l['relation'] not in RELATIONS or l['projectId'] not in projects or l['eventId'] not in events:
            fail('Invalid exposure link')
        refs(l['sourceIds'], l['id'])
    for p in data['prices']:
        if p['eventAt'] > p['receivedAt']:
            fail('Price received before its session closed')
        refs(p['sourceIds'], p['id'])
    for o in data['economicObservations']:
        refs(o['sourceIds'], o['id'])
    s = data['calendar']['sessionCloses']
    if any(b <= a for a, b in zip(s, s[1:])) or data['anchorAt'] not in s:
        fail('Calendar must increase and contain the anchor')
    if data['anchorEventId'] not in events:
        fail('Anchor event missing')
    return data


def date_end(day):
    return int(dt.datetime.fromisoformat(f'{day}T23:59:59.999+00:00').timestamp() * 1000)


def published_bound(s):
    if s['publishedAt'] is not None:
        return s['publishedAt']
    return date_end(s['publicationDate']) if s['publicationDate'] else None


def known_at(s):
    p = published_bound(s)
    return max(s['receivedAt'], p if p is not None else s['receivedAt'])


def freeze_policy_case(value, cutoff, basis='receipt'):
    c = parse_policy_case(value); instant(cutoff)
    if basis == 'receipt':
        eligible = {s['id'] for s in c['sources'] if s['role'] != 'outcome' and known_at(s) <= cutoff}
    else:
        eligible = {s['id'] for s in c['sources'] if s['role'] != 'outcome' and published_bound(s) is not None and published_bound(s) <= cutoff}
    ok = lambda ids: all(i in eligible for i in ids)
    excluded = []

    def keep(rows):
        out = []
        for r in rows:
            if ok(r['sourceIds']) and (basis == 'publication' or r['receivedAt'] <= cutoff):
                out.append(r)
            else:
                excluded.append(dict(id=r['id'], reason='A supporting source was not published/received by the cutoff'))
        return out
    events = keep(c['events']); superseded = {e['supersedes'] for e in events if e['supersedes']}
    active = [e for e in events if e['id'] not in superseded]; event_ids = {e['id'] for e in active}
    projects = [dict(p, financing=[r for r in p['financing'] if ok(r['sourceIds'])], customers=[r for r in p['customers'] if ok(r['sourceIds'])], timelineRevisions=[r for r in p['timelineRevisions'] if ok(r['sourceIds'])], equipmentCommitments=[r for r in p['equipmentCommitments'] if ok(r['sourceIds'])]) for p in keep(c['projects'])]
    project_ids = {p['id'] for p in projects}
    links = [l for l in keep(c['links']) if l['eventId'] in event_ids and l['projectId'] in project_ids]
    frozen = dict(c, sources=[s for s in c['sources'] if s['id'] in eligible], events=active, projects=projects, links=links, economicObservations=keep(c['economicObservations']), prices=[p for p in c['prices'] if p['eventAt'] <= cutoff and ok(p['sourceIds']) and (basis == 'publication' or p['receivedAt'] <= cutoff)])
    return dict(version=VERSION, cutoff=cutoff, basis=basis, retrospectiveReconstruction=basis == 'publication', case=frozen, excluded=excluded, executionAuthority='none')


def classify_policy_event(e, as_of, sources):
    reasons = []; s = e['legalStatus']; day = dt.datetime.fromtimestamp(as_of / 1000, dt.timezone.utc).date().isoformat()
    if e['instrument'] in ('election', 'campaign_statement') or s in ('campaign_proposal', 'candidate_elected', 'candidate_leading'):
        cls = 'political_signal'; reasons.append('An election result or campaign pledge is not an enacted rule; it creates no restriction by itself')
    elif s in ('introduced', 'passed_one_chamber', 'passed_legislature'):
        cls = 'proposed_not_enacted'; reasons.append('Legislation without signature or enactment is a proposal, not an active restriction')
    elif (s == 'approved_unofficial' and e['binding'] is False) or e['instrument'] == 'advisory_question':
        cls = 'advisory_nonbinding'; reasons.append('Advisory questions express voter preference and impose no binding rule')
    elif s in ('approved_unofficial', 'rejected_unofficial'):
        cls = 'pending_certification'; reasons.append('Unofficial vote results are not certified; the legal effect is pending')
    elif s in ('enjoined', 'struck_down'):
        cls = 'blocked_by_court'; reasons.append('A court has blocked or struck down the measure')
    elif s == 'court_order':
        cls = 'court_constraint'; reasons.append('A court order constrains the decision process while it remains in force')
    elif s in ('expired', 'repealed'):
        cls = 'lapsed'; reasons.append('The measure is no longer in force')
    elif s == 'rejected_certified':
        cls = 'not_adopted'; reasons.append('Voters or legislators did not adopt the measure')
    elif s == 'not_proceeding':
        cls = 'project_not_proceeding'; reasons.append('A proposal that did not proceed is neither a delay nor an active rule')
    else:
        eff, exp = e['effectiveDate'], e['expiresDate']
        if eff is None:
            cls = 'enacted_not_yet_effective'; reasons.append('Enacted, but no sourced effective date')
        elif eff > day:
            cls = 'enacted_not_yet_effective'; reasons.append(f'Effective {eff}, after the assessment date')
        elif exp is not None and exp < day:
            cls = 'lapsed'; reasons.append(f'Expired {exp}')
        else:
            cls = 'active'; reasons.append('In force but subject to pending litigation' if s == 'enacted_challenged' else 'In force on the assessment date')
    used = [x for x in sources if x['id'] in e['sourceIds']]; level = e['uncertainty']

    def raise_to(to, why):
        nonlocal level
        if RANK[to] > RANK[level]:
            level = to
        reasons.append(why)
    if not any(x['authority'] == 'primary' for x in used):
        raise_to('medium', 'No primary legal or official source; secondary reporting only')
    if e['conflictingSources']:
        raise_to('high', 'Sources conflict on status, scope or ballot placement')
    if cls == 'pending_certification':
        raise_to('medium', 'Results are unofficial until certification')
    if s == 'enacted_challenged':
        raise_to('medium', 'Pending litigation may alter the measure')
    in_force = cls in ('active', 'court_constraint'); restrictive = e['direction'] in ('restrictive', 'cost_allocation')
    return dict(eventId=e['id'], policyClass=cls, inForce=in_force, restrictionInForce=in_force and restrictive, potentialRestriction=(not in_force) and restrictive and cls in ('proposed_not_enacted', 'pending_certification', 'enacted_not_yet_effective'), direction=e['direction'], uncertainty=level, reasons=reasons, sourceIds=e['sourceIds'], primarySourceIds=[x['id'] for x in used if x['authority'] == 'primary'])


def project_exposure(p, links, classes):
    rows = [(l, classes[l['eventId']]) for l in links if l['projectId'] == p['id'] and l['eventId'] in classes]
    direct = [r for r in rows if r[0]['relation'] == 'direct' and r[1]['restrictionInForce']]
    potential = [r for r in rows if r not in direct and r[0]['relation'] != 'not_applicable' and (r[1]['restrictionInForce'] or r[1]['potentialRestriction'])]
    exposure = 'not_active_project' if p['stage'] in ('not_proceeding', 'cancelled') else 'directly_exposed' if direct else 'potentially_exposed' if potential else 'no_substantiated_exposure'
    unenergised = None if p['plannedMw'] is None or p['energisedMw'] is None else p['plannedMw'] - p['energisedMw']
    level = 'low'
    for _, k in rows:
        if RANK[k['uncertainty']] > RANK[level]:
            level = k['uncertainty']
    return dict(projectId=p['id'], exposure=exposure, directEventIds=[l['eventId'] for l, _ in direct], potentialEventIds=[l['eventId'] for l, _ in potential], relations=[dict(eventId=l['eventId'], relation=l['relation'], policyClass=k['policyClass'], substantiation=l['substantiation'], note=l['note'], sourceIds=l['sourceIds']) for l, k in rows], plannedMw=p['plannedMw'], energisedMw=p['energisedMw'], unenergisedMw=unenergised, mwBasis=p['mwBasis'], stage=p['stage'], uncertainty=level)


def total(xs):
    known = [x for x in xs if x is not None]
    return dict(knownMw=sum(known), knownCount=len(known), unknownCount=len(xs) - len(known))


def policy_assessment(value, cutoff, basis='receipt'):
    frozen = freeze_policy_case(value, cutoff, basis); c = frozen['case']
    classes = [classify_policy_event(e, cutoff, c['sources']) for e in c['events']]; by_id = {k['eventId']: k for k in classes}
    exposures = [project_exposure(p, c['links'], by_id) for p in c['projects']]; ex = {x['projectId']: x for x in exposures}
    capacity = []
    for cls in ('directly_exposed', 'potentially_exposed', 'no_substantiated_exposure', 'not_active_project'):
        xs = [x for x in exposures if x['exposure'] == cls]
        capacity.append(dict(exposure=cls, projects=[x['projectId'] for x in xs], plannedMw=total([x['plannedMw'] for x in xs]), energisedMw=total([x['energisedMw'] for x in xs]), unenergisedMw=total([x['unenergisedMw'] for x in xs])))
    delays = []
    for p in c['projects']:
        for t in p['timelineRevisions']:
            if t['kind'] == 'acceleration':
                continue
            debt = [f for f in p['financing'] if f['principalUsd'] is not None and f['annualRate'] is not None]
            carry = sum(f['principalUsd'] * f['annualRate'] * t['delayDays'] / 365 for f in debt) if t['delayDays'] is not None and debt else None
            delays.append(dict(projectId=p['id'], kind=t['kind'], previous=t['previous'], revised=t['revised'], delayDays=t['delayDays'], announcedDate=t['announcedDate'], incrementalCarryUsd=carry, carryBasis='Unavailable: sourced principal, rate and delay length are all required' if carry is None else 'Simple interest on sourced debt over the sourced delay; excludes fees, penalties and lost revenue', sourceIds=t['sourceIds']))
    holds = [p['id'] for p in c['projects'] if p['stage'] in ('permitting_on_hold', 'delayed')]
    names = []
    for p in c['projects']:
        for co in p['companies']:
            n = co['ticker'] or co['name']
            if co['role'] in ('owner', 'developer') and n not in names:
                names.append(n)
    concentration = []
    for n in names:
        ps = [p for p in c['projects'] if any((co['ticker'] or co['name']) == n and co['role'] in ('owner', 'developer') for co in p['companies'])]
        hit_ps = [p for p in ps if ex[p['id']]['exposure'] in ('directly_exposed', 'potentially_exposed')]
        all_mw, hit = total([p['plannedMw'] for p in ps]), total([p['plannedMw'] for p in hit_ps])
        share = hit['knownMw'] / all_mw['knownMw'] if all_mw['knownMw'] > 0 and hit['unknownCount'] == 0 and all_mw['unknownCount'] == 0 else None
        concentration.append(dict(developer=n, projects=len(ps), affectedProjects=len(hit_ps), affectedPlannedMw=hit, totalPlannedMw=all_mw, affectedShareOfKnownMw=share, coverage='Registered projects only; not a company-wide portfolio share'))
    exposed = {x['projectId'] for x in exposures if x['exposure'] in ('directly_exposed', 'potentially_exposed')} | set(holds)
    suppliers = [dict(projectId=p['id'], supplier=e['supplier'], item=e['item'], sourceIds=e['sourceIds']) for p in c['projects'] if p['id'] in exposed for e in p['equipmentCommitments']]
    restricted = {e['jurisdiction']['state'] for e in c['events'] if by_id[e['id']]['restrictionInForce'] and e['jurisdiction']['level'] == 'state'}
    operational = [dict(projectId=p['id'], state=p['state'], energisedMw=p['energisedMw']) for p in c['projects'] if p['energisedMw'] is not None and p['energisedMw'] > 0 and p['state'] in restricted]
    operational_unknown = [p['id'] for p in c['projects'] if p['stage'] == 'operational' and p['energisedMw'] is None and p['state'] in restricted]
    compute = len([o for o in c['economicObservations'] if o['metric'] == 'compute_price'])
    missing = []
    if not any(p['securedGridMw'] is not None or p['requestedGridMw'] is not None for p in c['projects']):
        missing.append('No sourced secured or requested grid capacity for any registered project')
    if not suppliers:
        missing.append('No sourced equipment or supplier commitments linked to exposed or delayed projects')
    if not delays:
        missing.append('No verified construction delay with a revised timeline; holds are listed separately')
    if not compute:
        missing.append('No observed compute or lease pricing; scarcity effects remain mechanisms only')
    missing += [f"{x['projectId']}: planned MW not sourced" for x in exposures if x['plannedMw'] is None]
    return dict(version=VERSION, cutoff=cutoff, basis=basis, retrospectiveReconstruction=frozen['retrospectiveReconstruction'], policy=dict(classifications=classes, exposures=exposures, capacity=capacity, restrictedStates=sorted(restricted)), economic=dict(delays=delays, holds=holds, concentration=concentration, suppliers=suppliers, operational=operational, operationalUnknownMw=operational_unknown, computePriceObservations=compute), missing=missing, excluded=frozen['excluded'], executionAuthority='none')


def register_policy_experiment(value, cutoff, registered_at, basis='receipt'):
    c = parse_policy_case(value); instant(cutoff); instant(registered_at)
    if registered_at < cutoff:
        fail('Registration cannot precede its evidence cutoff')
    if basis == 'receipt' and cutoff < c['anchorAt']:
        fail('A receipt-basis registration needs a cutoff at or after the anchor')
    assessment = policy_assessment(c, cutoff, basis); eligible = {s['id'] for s in freeze_policy_case(c, cutoff, basis)['case']['sources']}
    for h in c['hypotheses']:
        for e in h['evidenceIds']:
            if e not in eligible:
                fail(f"{h['id']}: evidence {e} was not available at the cutoff")
    order = ['not_active_project', 'no_substantiated_exposure', 'potentially_exposed', 'directly_exposed']; by_ticker = {}
    for x in assessment['policy']['exposures']:
        p = next(q for q in c['projects'] if q['id'] == x['projectId'])
        for co in p['companies']:
            if co['ticker'] and co['role'] in ('owner', 'developer'):
                prev = by_ticker.get(co['ticker'])
                if prev is None or order.index(x['exposure']) > order.index(prev):
                    by_ticker[co['ticker']] = x['exposure']
    s = c['calendar']['sessionCloses']; i = s.index(c['anchorAt'])
    groups = [dict(g, memberExposure={m: by_ticker.get(m, 'no_substantiated_exposure') for m in g['members']}) for g in c['groups']]
    windows = [dict(id=f"{c['id']}:{g['id']}:{h}", groupId=g['id'], horizon=h, anchorAt=c['anchorAt'], endAt=s[i + h] if i + h < len(s) else None) for g in c['groups'] for h in HORIZONS]
    return dict(version=VERSION, caseId=c['id'], mode=c['mode'], priorForecast=False, anchorAt=c['anchorAt'], cutoff=cutoff, basis=basis, registeredAt=registered_at, benchmarkTicker=c['benchmarkTicker'], groups=groups, hypotheses=c['hypotheses'], windows=windows, calendar=c['calendar'], executionAuthority='none')


def evaluate_policy_window(reg, observations, window, as_of):
    g = next(x for x in reg['groups'] if x['id'] == window['groupId'])
    base = dict(windowId=window['id'], groupId=g['id'], horizon=window['horizon'], anchorAt=window['anchorAt'], endAt=window['endAt'], executionAuthority='none')
    if window['endAt'] is None:
        return dict(base, status='pending', reason='Calendar does not extend to this horizon', result=None)
    if window['endAt'] > as_of:
        return dict(base, status='pending', reason='Window end is after the evaluation time', result=None)
    sessions = [t for t in reg['calendar']['sessionCloses'] if window['anchorAt'] <= t <= window['endAt']]
    usable = [p for p in observations if p['receivedAt'] <= as_of]; paths = {}
    for m in g['members']:
        rows = [[p for p in usable if p['ticker'] == m and p['eventAt'] == t] for t in sessions]
        if any(len(r) != 1 for r in rows):
            return dict(base, status='pending', reason=f'{m}: an aligned, unambiguous close is required for every session', result=None)
        flat = [r[0] for r in rows]
        if len({(p['provider'], p['priceBasis']) for p in flat}) != 1:
            return dict(base, status='pending', reason=f'{m}: provider or price basis changes within the window', result=None)
        paths[m] = [p['close'] / flat[0]['close'] for p in flat]
    value = [sum(paths[m][j] for m in g['members']) / len(g['members']) for j in range(len(sessions))]
    peak = value[0]; dd = 0
    for v in value:
        peak = max(peak, v); dd = min(dd, v / peak - 1)
    return dict(base, status='complete', reason=None, result=dict(equalWeightReturn=value[-1] - 1, maxDrawdown=dd, memberReturns={m: paths[m][-1] - 1 for m in g['members']}, sessions=len(sessions) - 1, priceBasis='Unadjusted public reference closes; corporate actions unreviewed; USD price return, no costs or FX'))


def evaluate_policy_study(reg, observations, as_of):
    outcomes = [evaluate_policy_window(reg, observations, w, as_of) for w in reg['windows']]
    bench = next((g['id'] for g in reg['groups'] if g['members'] == [reg['benchmarkTicker']]), None)
    at = {(o['groupId'], o['horizon']): o for o in outcomes}
    relative = []
    for o in outcomes:
        b = at.get((bench, o['horizon'])) if bench else None
        relative.append(dict(windowId=o['windowId'], groupId=o['groupId'], horizon=o['horizon'], relativeToBenchmark=o['result']['equalWeightReturn'] - b['result']['equalWeightReturn'] if o['result'] and b and b['result'] else None))
    rel = {(r['groupId'], r['horizon']): r['relativeToBenchmark'] for r in relative}
    hyps = []
    for h in reg['hypotheses']:
        for n in h['horizons']:
            subject = rel.get((h['subjectGroupId'], n)); comparison = 0 if h['comparisonGroupId'] == bench else rel.get((h['comparisonGroupId'], n))
            if subject is None or comparison is None:
                hyps.append(dict(hypothesisId=h['id'], horizon=n, status='pending', value=None)); continue
            v = subject - comparison; ok = v < h['threshold'] if h['kind'] == 'relative_below' else v > h['threshold']
            hyps.append(dict(hypothesisId=h['id'], horizon=n, status='consistent' if ok else 'inconsistent', value=v))
    return dict(version=VERSION, asOf=as_of, benchmarkGroupId=bench, outcomes=outcomes, relative=relative, hypotheses=hyps, executionAuthority='none')


def parse_observation_set(value):
    strict(value, 'id capturedAt sources prices', 'observation set'); instant(value['capturedAt'])
    ids = set()
    for s in value['sources']:
        strict(s, 'id title url kind authority publishedAt publicationDate publicationBasis receivedAt role usage mode', 'source'); check_url(s['url'])
        if s['receivedAt'] > value['capturedAt']:
            fail('Observations cannot be received after the capture time')
        ids.add(s['id'])
    if not value['prices'] or len({p['id'] for p in value['prices']}) != len(value['prices']):
        fail('Observation prices must be present and unique')
    for p in value['prices']:
        strict(p, 'id ticker eventAt close currency priceBasis provider sourceIds publishedAt receivedAt mode', 'price')
        if any(i not in ids for i in p['sourceIds']) or p['receivedAt'] > value['capturedAt'] or p['eventAt'] > p['receivedAt']:
            fail(f"{p['id']}: invalid observation")
    return value


def merge_policy_observations(base, *sets):
    out = list(base)
    for s in sets:
        for p in s['prices']:
            same = next((q for q in out if q['ticker'] == p['ticker'] and q['eventAt'] == p['eventAt']), None)
            if same and same['close'] == p['close'] and same['provider'] == p['provider'] and same['priceBasis'] == p['priceBasis']:
                continue
            out.append(p)
    return out


def evaluate(request):
    if not isinstance(request, dict) or set(request) - {'case', 'cutoff', 'registeredAt', 'asOf', 'basis', 'observationSets'} or not {'case', 'cutoff', 'registeredAt', 'asOf'} <= set(request):
        fail('Invalid policy-risk request')
    basis = request.get('basis', 'receipt')
    if basis not in ('receipt', 'publication'):
        fail('Invalid freeze basis')
    case = parse_policy_case(request['case']); reg = register_policy_experiment(case, request['cutoff'], request['registeredAt'], basis)
    return dict(version=VERSION, assessment=policy_assessment(case, request['cutoff'], basis), registration=reg, study=evaluate_policy_study(reg, merge_policy_observations(case['prices'], *[parse_observation_set(o) for o in request.get('observationSets', [])]), instant(request['asOf'])), executionAuthority='none')


def main():
    parser = argparse.ArgumentParser(description='Policy-risk research evaluation; no execution authority'); parser.add_argument('input'); parser.add_argument('--output'); args = parser.parse_args()
    try:
        encoded = json.dumps(evaluate(json.loads(Path(args.input).read_text(encoding='utf-8-sig'))), indent=2, sort_keys=True, allow_nan=False) + '\n'
        if args.output:
            with Path(args.output).open('x', encoding='utf8') as f:
                f.write(encoded)
        else:
            sys.stdout.write(encoded)
        return 0
    except (ValueError, KeyError, TypeError, OSError) as error:
        print(json.dumps(dict(error=str(error))), file=sys.stderr); return 2


if __name__ == '__main__':
    raise SystemExit(main())
