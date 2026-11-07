"""Benchmark 001.2 Proof & Scale evidence gates and measured economics.

Epoch milliseconds and GBP amounts; this additive module does not alter prior
forecast, market-return or paper-accounting formulas. It cannot authorise orders.
"""
import argparse
import json
import math
import sys
from pathlib import Path
from urllib.parse import urlparse

from .research import number

VERSION = 'proof-001.2-v1'
MODES = ('synthetic', 'historical', 'forward')
GATES = ('business_value', 'data_integrity', 'execution_safety', 'operational_readiness')
STAGES = ('idea', 'limited_pilot', 'expanded_pilot', 'production')
STATES = ('not_assessed', 'pending', 'passed', 'failed', 'expired')


def text(value, field, empty=False):
    if not isinstance(value, str) or (not empty and not value.strip()) or len(value)>16000:
        raise ValueError(f'Invalid {field}')
    return value


def instant(value):
    value=number(value)
    if value<0:
        raise ValueError('Nonnegative epoch milliseconds required')
    return value


def count(value):
    value=number(value)
    if value<0 or int(value)!=value:
        raise ValueError('Nonnegative integer required')
    return int(value)


def amount(value, nullable=False):
    if nullable and value is None:
        return None
    value=number(value)
    if value<0:
        raise ValueError('Nonnegative amount required')
    return value


def strings(value, field):
    if not isinstance(value,list) or len(value)>1000:
        raise ValueError(f'Expected bounded {field} list')
    for v in value:text(v,field)
    if len(set(value))!=len(value):
        raise ValueError(f'Duplicate {field}')
    return value


def validate_evidence(record):
    for key in ('id','sourceId'):text(record[key],key)
    for key in ('authoritativeSource','dataOwner','exceptionPolicy','content'):text(record[key],key,True)
    url=urlparse(record['sourceUrl'])
    if url.scheme!='https' or not url.hostname or url.username or url.password:
        raise ValueError('Identifiable HTTPS source without credentials required')
    strings(record['permittedUses'],'permitted uses')
    if record['reconciliation'] not in ('matched','unreconciled','contradictory') or record['mode'] not in MODES or not isinstance(record['critical'],bool):
        raise ValueError('Explicit reconciliation, evidence mode and critical status required')
    if count(record['revision'])<1:
        raise ValueError('Positive revision required')
    if record['supersedes'] is not None:text(record['supersedes'],'supersedes')
    if instant(record['receivedAt'])<instant(record['publishedAt']):
        raise ValueError('Receipt precedes publication')
    if record['lastVerifiedAt'] is not None:instant(record['lastVerifiedAt'])
    return record


def validate_evidence_history(records):
    if not isinstance(records,list) or len(records)>2000:
        raise ValueError('Bounded evidence history required')
    by_id={};by_source={}
    for r in records:
        validate_evidence(r)
        if r['id'] in by_id:raise ValueError('Duplicate immutable evidence ID')
        by_id[r['id']]=r
        by_source.setdefault((r['sourceId'],r['mode']),[]).append(r)
    for versions in by_source.values():
        versions.sort(key=lambda r:r['revision'])
        for i,r in enumerate(versions):
            if i==0:
                if r['revision']!=1 or r['supersedes'] is not None:
                    raise ValueError('Revision history must begin with revision one')
            else:
                prior=versions[i-1]
                if r['revision']!=prior['revision']+1 or r['supersedes']!=prior['id'] or r['receivedAt']<prior['receivedAt']:
                    raise ValueError('Invalid evidence revision lineage or fork')
    return records


def eligible_evidence(records,cutoff,mode):
    validate_evidence_history(records);instant(cutoff)
    if mode not in MODES:raise ValueError('Explicit evidence mode required')
    selected={}
    for r in records:
        if r['mode']==mode and r['publishedAt']<=cutoff and r['receivedAt']<=cutoff:
            previous=selected.get(r['sourceId'])
            if previous is None or r['revision']>previous['revision']:selected[r['sourceId']]=r
    return sorted(selected.values(),key=lambda r:r['sourceId'])


def evidence_blockers(record,as_of,permitted_use):
    result=[]
    if not record['authoritativeSource'].strip():result.append('Authoritative source missing')
    if not record['dataOwner'].strip():result.append('Data owner missing')
    if record['lastVerifiedAt'] is None or record['lastVerifiedAt']>as_of:result.append('Source verification unavailable at cutoff')
    if permitted_use not in record['permittedUses']:result.append('Permitted use does not cover this decision')
    if record['reconciliation']!='matched':result.append(f"Reconciliation {record['reconciliation']}")
    if not record['exceptionPolicy'].strip():result.append('Exception policy missing')
    return result


def validate_gate(gate):
    text(gate['id'],'gate ID');text(gate['owner'],'gate owner',True)
    if gate['type'] not in GATES or gate['state'] not in STATES:raise ValueError('Invalid gate type/state')
    strings(gate['evidenceIds'],'gate evidence IDs')
    if not isinstance(gate['thresholds'],list) or not isinstance(gate['measurements'],list) or not isinstance(gate['audit'],list):
        raise ValueError('Threshold, measurement and audit lists required')
    for t in gate['thresholds']:
        text(t['metric'],'metric');text(t['unit'],'unit');number(t['value'])
        if t['operator'] not in ('gte','lte'):raise ValueError('Unknown threshold operator')
    for m in gate['measurements']:
        text(m['metric'],'metric');text(m['unit'],'unit');number(m['value']);strings(m['evidenceIds'],'measurement evidence IDs')
        if m['kind'] not in ('measured','forecast') or instant(m['receivedAt'])<instant(m['observedAt']):
            raise ValueError('Measurement kind or timestamp invalid')
    for key in ('evaluatedAt','revalidateAt'):
        if gate[key] is not None:instant(gate[key])
    if gate['decisionActor'] not in ('human','model',None):raise ValueError('Invalid gate decision actor')
    if gate['decisionBy'] is not None:text(gate['decisionBy'],'decision actor')
    for a in gate['audit']:
        instant(a['at']);text(a['actor'],'audit actor');text(a['action'],'audit action');text(a['reason'],'audit reason',True);strings(a['evidenceIds'],'audit evidence IDs')
        if a['actorType'] not in ('human','model','system'):raise ValueError('Invalid audit actor type')
    return gate


def reference_blockers(ids,rows,as_of,mode,permitted_use):
    active={r['sourceId']:r for r in eligible_evidence(rows,as_of,mode)};by_id={r['id']:r for r in rows};result=[]
    if not ids:result.append('Evidence references required')
    for identity in ids:
        r=by_id.get(identity)
        if r is None:result.append(f'{identity}: evidence missing');continue
        if r['mode']!=mode:result.append(f'{identity}: evidence mode differs')
        if r['publishedAt']>as_of or r['receivedAt']>as_of:result.append(f'{identity}: evidence unavailable at cutoff')
        result.extend(f'{identity}: {reason}' for reason in evidence_blockers(r,as_of,permitted_use))
        if active.get(r['sourceId'],{}).get('id')!=identity:result.append(f'{identity}: evidence superseded or not active at cutoff')
    return result


def evaluate_gate(gate,evidence,as_of,mode,permitted_use):
    validate_gate(gate);instant(as_of);text(permitted_use,'permitted use');validate_evidence_history(evidence)
    by_id={r['id']:r for r in evidence};blockers=[]
    if not gate['owner'].strip():blockers.append('Named gate owner required')
    blockers.extend(reference_blockers(gate['evidenceIds'],evidence,as_of,mode,permitted_use))
    if not gate['thresholds']:blockers.append('Explicit required thresholds are missing')
    seen=set()
    for t in gate['thresholds']:
        if t['metric'] in seen:blockers.append(f"{t['metric']}: duplicate threshold")
        seen.add(t['metric']);values=[m for m in gate['measurements'] if m['metric']==t['metric']]
        if len(values)!=1:blockers.append(f"{t['metric']}: unique measurement required");continue
        m=values[0]
        if m['kind']!='measured':blockers.append(f"{t['metric']}: forecast cannot satisfy a measured threshold")
        if m['observedAt']>as_of or m['receivedAt']>as_of or gate['evaluatedAt'] is not None and (m['observedAt']>gate['evaluatedAt'] or m['receivedAt']>gate['evaluatedAt']):blockers.append(f"{t['metric']}: measurement unavailable at evaluation")
        if m['unit']!=t['unit']:blockers.append(f"{t['metric']}: measurement unit differs")
        blockers.extend(reference_blockers(m['evidenceIds'],evidence,as_of,mode,permitted_use))
        if any(identity not in gate['evidenceIds'] for identity in m['evidenceIds']):blockers.append(f"{t['metric']}: measurement source outside gate snapshot")
        passed=m['value']>=t['value'] if t['operator']=='gte' else m['value']<=t['value']
        if not passed:blockers.append(f"{t['metric']}: required threshold failed")
    if gate['state']=='passed':
        if gate['decisionActor']!='human' or not gate['decisionBy']:blockers.append('Human gate decision required; model recommendation cannot approve')
        if gate['evaluatedAt'] is None or gate['evaluatedAt']>as_of:blockers.append('Valid human evaluation date required')
        if gate['revalidateAt'] is None or gate['evaluatedAt'] is not None and gate['revalidateAt']<=gate['evaluatedAt']:blockers.append('Revalidation must follow evaluation')
        if gate['evaluatedAt'] is not None:
            for identity in gate['evidenceIds']:
                r=by_id.get(identity)
                if r and (r['publishedAt']>gate['evaluatedAt'] or r['receivedAt']>gate['evaluatedAt'] or r['lastVerifiedAt'] is None or r['lastVerifiedAt']>gate['evaluatedAt']):blockers.append(f'{identity}: evidence unavailable when gate was evaluated')
    expired=gate['state']=='expired' or gate['revalidateAt'] is not None and as_of>=gate['revalidateAt']
    state='expired' if expired else 'failed' if gate['state']=='passed' and blockers else gate['state']
    if gate['state']!='passed':blockers.append(f"Gate is {gate['state']}")
    if expired:blockers.append('Gate revalidation expired')
    return {'version':VERSION,'type':gate['type'],'state':state,'blockers':list(dict.fromkeys(blockers)),'evidenceIds':gate['evidenceIds']}


def evaluate_expansion(request):
    as_of=instant(request['asOf']);mode=request['mode'];permitted_use=request['permittedUse'];scope=request['scope'];blockers=[]
    if request['currentStage'] not in STAGES or request['nextStage'] not in STAGES:
        raise ValueError('Unsupported deployment stage')
    if mode not in MODES:
        raise ValueError('Explicit evidence mode required')
    if request['currentStage'] not in STAGES or request['nextStage'] not in STAGES or STAGES.index(request['nextStage'])!=STAGES.index(request['currentStage'])+1:
        blockers.append('Only the next defined stage can be approved')
    for field in ('users','workflows','sourceIds'):
        strings(scope[field],field)
        if not scope[field]:blockers.append(f'Permitted {field} required')
    for field in ('capexCeilingGbp','operatingBudgetGbp'):
        if scope[field] is None:blockers.append(f'Explicit {field} required')
        else:amount(scope[field])
    if scope['nextReviewAt'] is None or instant(scope['nextReviewAt'])<=as_of:blockers.append('Future scope review date required')
    if mode!='forward' and request['nextStage']=='production':blockers.append('Production expansion requires authentic forward evidence')
    active=eligible_evidence(request['evidence'],as_of,mode)
    for r in active:
        if r['critical']:blockers.extend(f"Critical {r['id']}: {reason}" for reason in evidence_blockers(r,as_of,permitted_use))
    for source_id in scope['sourceIds']:
        matching=[r for r in active if r['sourceId']==source_id]
        if not matching:blockers.append(f'Scope data source unavailable: {source_id}')
        else:blockers.extend(f'{source_id}: {reason}' for reason in evidence_blockers(matching[0],as_of,permitted_use))
    evaluations=[]
    for gate_type in GATES:
        matches=[g for g in request['gates'] if g['type']==gate_type]
        if len(matches)!=1:
            blockers.append(f'Exactly one gate required: {gate_type}');continue
        result=evaluate_gate(matches[0],request['evidence'],as_of,mode,permitted_use)
        evaluations.append(result)
        if result['state']!='passed':blockers.append(f"{gate_type}: {result['state']}")
        blockers.extend(f'{gate_type}: {b}' for b in result['blockers'])
    return {'version':VERSION,'allowed':not blockers,'blockers':list(dict.fromkeys(blockers)),'gates':evaluations,'scope':scope}


COST_CATEGORIES=('inferenceGbp','labourGbp','dataGbp','energyGbp','hardwareDepreciationGbp','operationsGbp','correctionGbp','otherGbp')


def verified_metric(metric,evidence,as_of,mode,permitted_use,label,blockers,nonnegative=False):
    if not isinstance(metric,dict) or metric.get('status') not in ('forecast','unverified','verified'):
        raise ValueError(f'Explicit status required for {label}')
    strings(metric.get('evidenceIds',[]),'metric evidence IDs')
    value=metric.get('value')
    if value is not None:
        number(value)
        if nonnegative and value<0:
            blockers.append(f'{label}: nonnegative valid amount/count required');return None
    if value is None or metric['status']!='verified':
        blockers.append(f'{label}: verified realised value unavailable');return None
    if label.endswith('Gbp') and abs(value)>9007199254740991/100:
        blockers.append(f'{label}: monetary value exceeds safe numerical range');return None
    active={r['id']:r for r in eligible_evidence(evidence,as_of,mode)}
    if not metric['evidenceIds']:
        blockers.append(f'{label}: source evidence required');return None
    invalid=[]
    for identity in metric['evidenceIds']:
        r=active.get(identity)
        if r is None:invalid.append(f'{identity} unavailable or superseded at cutoff')
        else:invalid.extend(f'{identity}: {reason}' for reason in evidence_blockers(r,as_of,permitted_use))
    if invalid:
        blockers.extend(f'{label}: {reason}' for reason in invalid);return None
    return value


def allocated_costs(costs,evidence,as_of,mode,permitted_use,blockers):
    if not isinstance(costs,dict) or set(costs)!=set(COST_CATEGORIES):
        raise ValueError('Every fully allocated cost category must be explicitly supplied')
    values={key:verified_metric(costs[key],evidence,as_of,mode,permitted_use,key,blockers,True) for key in COST_CATEGORIES}
    total=sum(values.values()) if all(v is not None for v in values.values()) else None
    if total is not None and (not math.isfinite(total) or total>9007199254740991/100):
        blockers.append('Fully allocated cost exceeds supported safe numeric range');total=None
    return {'components':values,'total':total}


def forecast_values(values):
    return {key:value['value'] for key,value in values.items() if isinstance(value,dict) and value.get('status')=='forecast'}


def vectis_economics(request,evidence,as_of,permitted_use):
    mode=request['mode'];eligible_evidence(evidence,as_of,mode);blockers=[]
    fields=('baselineWorkflowCostGbp','attemptedTasks','successfulTasks','avoidedExpenditureGbp','incrementalContributionGbp','customerIncomeGbp')
    values={key:verified_metric(request[key],evidence,as_of,mode,permitted_use,key,blockers,key!='incrementalContributionGbp') for key in fields}
    for key in ('attemptedTasks','successfulTasks'):
        if values[key] is not None and int(values[key])!=values[key]:
            blockers.append(f'{key}: nonnegative valid amount/count required');values[key]=None
    if values['successfulTasks'] is not None and (values['attemptedTasks'] is None or values['successfulTasks']>values['attemptedTasks']):
        blockers.append('Successful tasks require a valid attempt count and cannot exceed attempts');values['successfulTasks']=None
    costs=allocated_costs(request['costs'],evidence,as_of,mode,permitted_use,blockers)
    successful=values['successfulTasks'];income=values['customerIncomeGbp']
    profit=income-costs['total'] if income is not None and costs['total'] is not None else None
    commercial=mode=='forward' and profit is not None and profit>0 and income is not None and income>0 and values['attemptedTasks'] is not None and values['attemptedTasks']>0 and successful is not None and successful>0
    return {'version':VERSION,'mode':mode,**values,'correctionCostGbp':costs['components']['correctionGbp'],
            'fullyAllocatedCostGbp':costs['total'],'costPerSuccessfulTaskGbp':costs['total']/successful if costs['total'] is not None and successful is not None and successful>0 else None,
            'realisedProfitGbp':profit,'commercialProfitEstablished':commercial,
            'benefitBasis':'Demonstration arithmetic; no genuine customer income or commercial profitability established' if mode=='synthetic' else 'Source-backed research measurements; independent source and workload verification required',
            'successRate':successful/values['attemptedTasks'] if successful is not None and values['attemptedTasks'] not in (None,0) else None,
            'forecasts':{key:request[key] for key in fields if request[key]['status']=='forecast'},'costs':costs['components'],'blockers':list(dict.fromkeys(blockers))}


def investment_economics(request,evidence,as_of,permitted_use):
    mode=request['mode'];eligible_evidence(evidence,as_of,mode);blockers=[]
    fields=('brier','mae','absoluteReturn','benchmarkReturn','maxDrawdown')
    values={key:verified_metric(request[key],evidence,as_of,mode,permitted_use,key,blockers,key in ('brier','mae','maxDrawdown')) for key in fields}
    if values['brier'] is not None and values['brier']>2:
        blockers.append('Brier score must be between zero and two');values['brier']=None
    if values['maxDrawdown'] is not None and values['maxDrawdown']>1:
        blockers.append('Maximum drawdown uses positive loss magnitude between zero and one');values['maxDrawdown']=None
    for key in ('absoluteReturn','benchmarkReturn'):
        if values[key] is not None and values[key]<-1:
            blockers.append(f'{key}: simple return cannot be below negative one');values[key]=None
    costs=allocated_costs(request['costs'],evidence,as_of,mode,permitted_use,blockers)
    aligned=values['absoluteReturn'] is not None and values['benchmarkReturn'] is not None
    if aligned and set(request['absoluteReturn']['evidenceIds'])!=set(request['benchmarkReturn']['evidenceIds']):
        aligned=False;blockers.append('Relative returns require the same aligned outcome evidence references')
    return {'version':VERSION,'mode':mode,**values,'benchmarkRelativeReturn':values['absoluteReturn']-values['benchmarkReturn'] if aligned else None,
            'fullyAllocatedCostGbp':costs['total'],'costs':costs['components'],'forecasts':{key:request[key] for key in fields if request[key]['status']=='forecast'},
            'blockers':list(dict.fromkeys(blockers))}


def run_economics(runs):
    if not isinstance(runs,list) or len(runs)>5000:raise ValueError('Bounded run list required')
    ids=set();modes=set()
    for r in runs:
        for key in ('id','provider','modelVersion'):text(r[key],key)
        if r['id'] in ids:raise ValueError('Run IDs must be unique')
        ids.add(r['id']);modes.add(r['mode'])
        if r['mode'] not in MODES or r['quality'] not in ('passed','failed','not_evaluated'):raise ValueError('Explicit run mode and quality required')
        for key in ('inputTokens','outputTokens','fallbackCalls'):count(r[key])
        for key in ('inferenceCostGbp','latencyMs'):amount(r[key],True)
        for key in ('energyKwh','depreciationGbp','utilisation','throughputPerSecond'):amount(r['hardware'][key],True)
        if r['hardware']['utilisation'] is not None and r['hardware']['utilisation']>1:raise ValueError('Utilisation must be in 0..1')
    if len(modes)>1:raise ValueError('Run evidence modes cannot be mixed')
    inference=sum(r['inferenceCostGbp'] for r in runs) if runs and all(r['inferenceCostGbp'] is not None for r in runs) else None
    latency=sum(r['latencyMs'] for r in runs)/len(runs) if runs and all(r['latencyMs'] is not None for r in runs) else None
    return {'version':VERSION,'runs':len(runs),'inputTokens':sum(r['inputTokens'] for r in runs),'outputTokens':sum(r['outputTokens'] for r in runs),
            'fallbackCalls':sum(r['fallbackCalls'] for r in runs),'successfulTasks':sum(r['quality']=='passed' for r in runs),
            'inferenceCostGbp':inference if inference is not None and math.isfinite(inference) and inference<=9007199254740991/100 else None,
            'meanLatencyMs':latency if latency is not None and math.isfinite(latency) else None,
            'fullServiceCostGbp':None,'profitability':'Not established: per-run inference statistics exclude complete service costs and customer income'}


def evaluate(request):
    if request.get('version')!=VERSION:raise ValueError('Unsupported Proof & Scale version')
    evidence=validate_evidence_history(request.get('evidence',[]));as_of=instant(request['asOf']);mode=request['mode'];permitted_use=text(request['permittedUse'],'permitted use')
    if mode not in MODES:raise ValueError('Explicit evidence mode required')
    result={'version':VERSION,'mode':mode,'asOf':as_of,'executionAuthority':'none','eligibleEvidence':eligible_evidence(evidence,as_of,mode)}
    if 'gates' in request:result['gates']=[evaluate_gate(g,evidence,as_of,mode,permitted_use) for g in request['gates']]
    if 'expansion' in request:result['expansion']=evaluate_expansion({**request['expansion'],'gates':request.get('gates',[]),'evidence':evidence,'asOf':as_of,'mode':mode,'permittedUse':permitted_use})
    for key,fn in (('vectis',vectis_economics),('investment',investment_economics)):
        if key in request:
            if request[key]['mode']!=mode:raise ValueError('Economics and evidence modes cannot be mixed')
            result[key]=fn(request[key],evidence,as_of,permitted_use)
    if 'runs' in request:
        if any(r['mode']!=mode for r in request['runs']):raise ValueError('Run and evidence modes cannot be mixed')
        result['runs']=run_economics(request['runs'])
    return result


def main():
    parser=argparse.ArgumentParser(description='Versioned Proof & Scale evidence and economics evaluation; no execution authority')
    parser.add_argument('input');parser.add_argument('--output')
    args=parser.parse_args()
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
