import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from worker.infrastructure_financing import (VERSION, DAY, parse_infrastructure_case, freeze_infrastructure_case,
    infrastructure_kpis, economic_exposure, risk_review, validate_transition, evaluate)

NOW=400*DAY
PERIOD={'start':NOW-365*DAY,'end':NOW-200,'label':'synthetic annual measured period'}


def source(identity='filing',supports=None,**extra):
    row={'id':identity,'title':'Synthetic source; not real financing','url':'https://example.test/infrastructure',
         'kind':'filing','publishedAt':NOW-100,'receivedAt':NOW-80,'verification':'verified','mode':'synthetic','role':'evidence',
         'supports':supports if supports is not None else [{'eventId':'loan','status':'signed','binding':True}]}
    row.update(extra);return row


def event(identity='loan-r1',logical='loan',**extra):
    row={'id':identity,'eventId':logical,'revision':1,'supersedes':None,'issuer':'Nscale','financier':'Lender',
         'borrower':'Nscale','guarantor':None,'customer':'Anthropic','projectId':'synthetic-project','type':'borrowing',
         'principal':80,'currency':'USD','maturityAt':None,'status':'signed','claimType':'fact','publishedAt':NOW-100,
         'receivedAt':NOW-50,'sourceIds':['filing'],'mode':'synthetic','economicGroupId':'synthetic-facility'}
    row.update(extra);return row


def metric(name,value,**extra):
    row={'id':name,'entity':'Nscale','projectId':'synthetic-project','metric':name,'value':value,
         'unit':'GPU' if name in ('installed_gpu_capacity','available_gpu_capacity') else 'MW' if name.endswith('_power_mw') else 'currency',
         'currency':None if name in ('installed_gpu_capacity','available_gpu_capacity','planned_power_mw','energised_power_mw') else 'USD',
         'period':copy.deepcopy(PERIOD),'basis':'synthetic-comparable-v1','definition':'recognised revenue measured on the same scope',
         'kind':'reported','sourceIds':['filing'],'eventIds':[],'counterparty':None,'mode':'synthetic'}
    row.update(extra);return row


def fixture(**extra):
    row={'version':VERSION,'id':'synthetic-infra','name':'Synthetic financing; no actual company claims','mode':'synthetic',
         'sources':[source()],'events':[event()],'relationships':[],
         'metrics':[metric('funding_committed',80,eventIds=['loan']),metric('project_cost',100),metric('contracted_backlog',500),
                    metric('recognised_revenue',100),metric('cash_collections',30),metric('capital_expenditure',20),
                    metric('customer_revenue',40,counterparty='Anthropic'),metric('planned_power_mw',100),metric('energised_power_mw',50),
                    metric('installed_gpu_capacity',10),metric('available_gpu_capacity',5),metric('construction_committed',90),
                    metric('construction_paid',20),metric('cash_available_for_debt_service',20),metric('debt_service_due',10),
                    metric('project_operating_cash_flow',25)]}
    row.update(extra);return row


def with_guarantee(case,**extra):
    result=copy.deepcopy(case)
    result['sources'].append(source('guarantee-source',[{'eventId':'guarantee','status':'signed','binding':True}]))
    result['events'].append(event('guarantee-r1','guarantee',issuer=None,financier=None,guarantor='NVIDIA',type='guarantee',
                                 claimType='contingent',sourceIds=['guarantee-source'],**extra))
    return result


class InfrastructureFinancingTests(unittest.TestCase):
    def test_proposed_guarantee_is_not_a_signed_obligation(self):
        news=source('report',[{'eventId':'guarantee','status':'reported_discussion','binding':False}],kind='news',verification='corroborated')
        proposal=event('proposal-r1','guarantee',issuer=None,guarantor='NVIDIA',type='guarantee',status='reported_discussion',claimType='discussion',sourceIds=['report'])
        case=fixture(sources=[news],events=[proposal],metrics=[])
        self.assertIsNone(economic_exposure(case,NOW)['totalPrincipal'])
        self.assertIsNone(infrastructure_kpis(case,'NVIDIA','synthetic-project',NOW)['guaranteeExposure']['value'])
        proposal['status']='signed';proposal['claimType']='fact'
        news['supports']=[{'eventId':'guarantee','status':'signed','binding':False}]
        with self.assertRaises(ValueError):parse_infrastructure_case(case)

    def test_all_eight_kpis_reproduce_from_compatible_reported_inputs(self):
        case=with_guarantee(fixture())
        kpis=infrastructure_kpis(case,'Nscale','synthetic-project',NOW)
        self.assertEqual(kpis,infrastructure_kpis(copy.deepcopy(case),'Nscale','synthetic-project',NOW))
        self.assertEqual(kpis['fundingCoverage']['value'],.8)
        self.assertEqual(kpis['customerConcentration'][0]['value'],.4)
        self.assertEqual(kpis['powerReadiness']['value'],.5)
        self.assertEqual(kpis['constructionExposure']['value'],70)
        self.assertEqual(kpis['debtServiceCapacity']['value'],2)
        self.assertEqual(kpis['capitalIntensity']['value'],.2)
        self.assertEqual(kpis['projectCashPayback']['value'],4)
        self.assertEqual(infrastructure_kpis(case,'NVIDIA','synthetic-project',NOW)['guaranteeExposure']['value'],80)

    def test_commercial_backlog_cannot_be_cited_as_cash_funding(self):
        case=fixture();case['events'][0]['type']='commercial_contract'
        self.assertIsNone(infrastructure_kpis(case,'Nscale','synthetic-project',NOW)['fundingCoverage']['value'])
        for kind in ('borrowing','equity_investment','other_commitment'):
            case['events'][0]['type']=kind
            self.assertEqual(infrastructure_kpis(case,'Nscale','synthetic-project',NOW)['fundingCoverage']['value'],.8)

    def test_changed_contract_terms_require_fresh_primary_amendment_evidence(self):
        case=fixture(metrics=[])
        case['events'].append(event('loan-r2',revision=2,supersedes='loan-r1',principal=90,publishedAt=NOW+10,receivedAt=NOW+20))
        with self.assertRaises(ValueError):parse_infrastructure_case(case)
        amendment=source('amendment',[{'eventId':'loan','status':'signed','binding':False}],kind='news',verification='corroborated',publishedAt=NOW+10,receivedAt=NOW+15)
        case['sources'].append(amendment);case['events'][1]['sourceIds']=['filing','amendment']
        with self.assertRaises(ValueError):parse_infrastructure_case(case)
        amendment.update(kind='filing',verification='verified');amendment['supports'][0]['binding']=True
        self.assertEqual(parse_infrastructure_case(case)['events'][1]['principal'],90)
        self.assertEqual(economic_exposure(case,NOW)['totalPrincipal'],80)
        self.assertEqual(economic_exposure(case,NOW+30)['totalPrincipal'],90)

    def test_backlog_revenue_collections_and_capacity_never_substitute(self):
        case=fixture(metrics=[metric('contracted_backlog',500),metric('planned_power_mw',100)])
        kpis=infrastructure_kpis(case,'Nscale','synthetic-project',NOW)
        self.assertEqual(kpis['distinctMetrics']['contractedBacklog']['value'],500)
        for key in ('recognisedRevenue','cashCollections','installedCapacity','commerciallyAvailableCapacity'):
            self.assertIsNone(kpis['distinctMetrics'][key]['value'])
        self.assertIsNone(kpis['powerReadiness']['value'])
        with self.assertRaises(ValueError):parse_infrastructure_case(fixture(metrics=[metric('installed_gpu_capacity',100,unit='MW')]))

    def test_customer_concentration_requires_matching_period_and_definition(self):
        for patch in ({'definition':'contracted backlog'}, {'period':{**PERIOD,'end':PERIOD['end']-DAY}}, {'basis':'different accounting basis'}, {'currency':'GBP'}):
            case=fixture(metrics=[metric('recognised_revenue',100),metric('customer_revenue',40,counterparty='Anthropic',**patch)])
            self.assertIsNone(infrastructure_kpis(case,'Nscale','synthetic-project',NOW)['customerConcentration'][0]['value'])
        case=fixture(metrics=[metric('recognised_revenue',100),metric('customer_revenue',110,counterparty='Anthropic')])
        self.assertIsNone(infrastructure_kpis(case,'Nscale','synthetic-project',NOW)['customerConcentration'][0]['value'])

    def test_loan_and_guarantee_same_underlying_exposure_are_not_added_twice(self):
        case=with_guarantee(fixture())
        result=economic_exposure(case,NOW)
        self.assertEqual(result['totalPrincipal'],80)
        self.assertTrue(result['potentialDoubleCounting'])
        self.assertEqual(result['groups'][0]['measurementType'],'financing_principal')
        case['events'][1]['principal']=40
        self.assertEqual(economic_exposure(case,NOW)['totalPrincipal'],80)
        case['events'][1]['economicGroupId']='different-unknown-overlap'
        self.assertIsNone(economic_exposure(case,NOW)['totalPrincipal'])

    def test_commercial_contracts_and_financing_do_not_form_a_false_total(self):
        case=fixture()
        case['sources'].append(source('commercial-source',[{'eventId':'contract','status':'signed','binding':True}]))
        case['events'].append(event('contract-r1','contract',type='commercial_contract',principal=500,sourceIds=['commercial-source'],economicGroupId='commercial-service'))
        result=economic_exposure(case,NOW)
        self.assertIsNone(result['totalPrincipal']);self.assertTrue(result['potentialDoubleCounting'])
        self.assertIn('not comparable',result['reason'])

    def test_forecasts_and_news_reports_do_not_fill_verified_numeric_inputs(self):
        case=fixture(metrics=[metric('recognised_revenue',100,kind='forecast'),metric('capital_expenditure',20)])
        self.assertIsNone(infrastructure_kpis(case,'Nscale','synthetic-project',NOW)['capitalIntensity']['value'])
        case['sources'].append(source('news',[],kind='news',verification='corroborated'))
        case['metrics']=[metric('recognised_revenue',100,sourceIds=['news'])]
        self.assertIsNone(infrastructure_kpis(case,'Nscale','synthetic-project',NOW)['distinctMetrics']['recognisedRevenue']['value'])

    def test_future_received_and_outcome_evidence_cannot_enter_earlier_forecasts(self):
        case=fixture()
        case['sources'].extend([source('late',[],receivedAt=NOW+100),source('market-result',[],role='outcome')])
        case['metrics']=[metric('cash_collections',90,sourceIds=['late']),metric('recognised_revenue',100,sourceIds=['market-result'])]
        result=freeze_infrastructure_case(case,NOW)
        self.assertEqual([s['id'] for s in result['case']['sources']],['filing'])
        self.assertEqual(result['case']['metrics'],[])
        self.assertEqual(result['executionAuthority'],'none')

    def test_future_reported_period_is_excluded(self):
        case=fixture(metrics=[metric('recognised_revenue',100,period={**PERIOD,'end':NOW+DAY})])
        self.assertEqual(freeze_infrastructure_case(case,NOW)['case']['metrics'],[])

    def test_reported_period_cannot_follow_its_source_publication(self):
        case=fixture(metrics=[metric('recognised_revenue',100,period={**PERIOD,'end':NOW-50})])
        self.assertEqual(freeze_infrastructure_case(case,NOW)['case']['metrics'],[])

    def test_forecast_capacity_and_cross_project_dependencies_remain_unproven(self):
        case=fixture(metrics=[metric('available_gpu_capacity',100,kind='forecast')])
        self.assertTrue(any('Commercially available' in alert for alert in risk_review(case,NOW)['alerts']))
        news=source('news',[{'eventId':'guarantee','status':'reported_discussion','binding':False}],kind='news',verification='corroborated')
        guarantee=event('guarantee-r1','guarantee',type='guarantee',guarantor='NVIDIA',projectId='Texas',status='reported_discussion',claimType='discussion',sourceIds=['news'])
        link={'id':'gpu-link','from':'NVIDIA','to':'Nscale','type':'gpu_supply','projectId':'Monarch','eventIds':[],'sourceIds':['news'],'certainty':'reported','economicGroupId':None}
        case=fixture(sources=[news],events=[guarantee],relationships=[link],metrics=[])
        self.assertFalse(risk_review(case,NOW)['supplierFundedPurchases'])
        case['relationships'][0]['projectId']='Texas'
        self.assertTrue(risk_review(case,NOW)['supplierFundedPurchases'])

    def test_source_gated_status_revisions_preserve_old_cutoffs(self):
        case=fixture(metrics=[])
        case['sources'].append(source('cancellation',[{'eventId':'loan','status':'cancelled','binding':False}],publishedAt=NOW+10,receivedAt=NOW+20))
        cancelled=event('loan-r2',revision=2,supersedes='loan-r1',status='cancelled',publishedAt=NOW+10,receivedAt=NOW+30,sourceIds=['cancellation'])
        case['events'].append(cancelled)
        self.assertEqual(freeze_infrastructure_case(case,NOW)['activeEvents'][0]['status'],'signed')
        current=freeze_infrastructure_case(case,NOW+40)
        self.assertEqual(current['activeEvents'][0]['status'],'cancelled')
        self.assertEqual(len(current['case']['events']),2)
        self.assertEqual(parse_infrastructure_case(current['case'])['events'],case['events'])
        self.assertIsNone(economic_exposure(case,NOW+40)['totalPrincipal'])
        self.assertEqual(economic_exposure(case,NOW)['totalPrincipal'],80)
        changed=copy.deepcopy(case);changed['events'][1]['borrower']='Another borrower'
        with self.assertRaises(ValueError):parse_infrastructure_case(changed)
        changed=copy.deepcopy(case);changed['events'][1]['sourceIds']=['filing']
        with self.assertRaises(ValueError):parse_infrastructure_case(changed)

    def test_speculation_and_wrong_counterparty_cannot_be_verified_links(self):
        link={'id':'link','from':'NVIDIA','to':'Nscale','type':'borrowing','projectId':'synthetic-project','eventIds':['loan'],'sourceIds':['filing'],'certainty':'verified_contract','economicGroupId':'synthetic-facility'}
        with self.assertRaises(ValueError):parse_infrastructure_case(fixture(relationships=[link]))
        link['from']='Lender'
        self.assertEqual(len(parse_infrastructure_case(fixture(relationships=[link]))['relationships']),1)
        link['certainty']='inferred';link['from']='NVIDIA'
        self.assertEqual(parse_infrastructure_case(fixture(relationships=[link]))['relationships'][0]['certainty'],'inferred')

    def test_unsourced_metrics_cannot_fill_missing_financing_data(self):
        with self.assertRaises(ValueError):parse_infrastructure_case(fixture(metrics=[metric('recognised_revenue',100,sourceIds=[])]))

    def test_negative_or_missing_cash_flow_does_not_manufacture_payback(self):
        for cash in (0,-1):
            case=fixture(metrics=[metric('project_cost',100),metric('project_operating_cash_flow',cash)])
            self.assertIsNone(infrastructure_kpis(case,'Nscale','synthetic-project',NOW)['projectCashPayback']['value'])
        case=fixture(metrics=[metric('project_cost',100),metric('project_operating_cash_flow',25,period={**PERIOD,'start':NOW-90*DAY})])
        self.assertIsNone(infrastructure_kpis(case,'Nscale','synthetic-project',NOW)['projectCashPayback']['value'])

    def test_mixed_modes_and_duplicate_or_incomplete_history_are_rejected(self):
        case=fixture();case['sources'][0]['mode']='historical'
        with self.assertRaises(ValueError):parse_infrastructure_case(case)
        case=fixture();case['events'].append(copy.deepcopy(case['events'][0]))
        with self.assertRaises(ValueError):parse_infrastructure_case(case)
        case=fixture();case['events'][0].update(revision=2,supersedes='absent')
        with self.assertRaises(ValueError):parse_infrastructure_case(case)

    def test_independent_alert_has_no_order_authority_and_cli_reproduces(self):
        case=fixture();request={'case':case,'entity':'Nscale','projectId':'synthetic-project','cutoff':NOW}
        self.assertEqual(evaluate(request)['review']['executionAuthority'],'none')
        self.assertTrue(risk_review(case,NOW)['researchOnly'])
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'input.json';path.write_text(json.dumps(request),encoding='utf-8')
            first=subprocess.run([sys.executable,'-m','worker.infrastructure_financing',str(path)],capture_output=True,text=True,check=True)
            second=subprocess.run([sys.executable,'-m','worker.infrastructure_financing',str(path)],capture_output=True,text=True,check=True)
            self.assertEqual(first.stdout,second.stdout)
            self.assertEqual(json.loads(first.stdout)['executionAuthority'],'none')


if __name__=='__main__':unittest.main()
