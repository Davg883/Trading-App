import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from worker.proof_scale import VERSION, COST_CATEGORIES, GATES, eligible_evidence, validate_evidence_history, evaluate_gate, evaluate_expansion, vectis_economics, investment_economics, run_economics, evaluate


def source(**updates):
    record={'id':'facts-v1','sourceId':'facts','authoritativeSource':'Finance ledger export','sourceUrl':'https://example.test/ledger',
        'dataOwner':'Finance owner','lastVerifiedAt':120,'permittedUses':['pilot-review'],'reconciliation':'matched','exceptionPolicy':'Block; reconcile and append a revision',
        'revision':1,'supersedes':None,'publishedAt':100,'receivedAt':110,'mode':'forward','critical':True,'content':'Synthetic test fixture; all amounts are invented.'}
    record.update(updates);return record


def gate(gate_type='business_value',**updates):
    record={'id':gate_type,'type':gate_type,'owner':'Named reviewer','state':'passed','evidenceIds':['facts-v1'],
        'thresholds':[{'metric':'successfulTasks','operator':'gte','value':5,'unit':'tasks'}],
        'measurements':[{'metric':'successfulTasks','value':8,'unit':'tasks','evidenceIds':['facts-v1'],'kind':'measured','observedAt':125,'receivedAt':130}],
        'evaluatedAt':140,'revalidateAt':500,'decisionBy':'Independent human reviewer','decisionActor':'human',
        'audit':[{'at':140,'actor':'Independent human reviewer','actorType':'human','action':'assess','reason':'Measured pilot completed','evidenceIds':['facts-v1']}]}
    record.update(updates);return record


def metric(value,status='verified',evidence_ids=None):
    return {'value':value,'status':status,'evidenceIds':['facts-v1'] if evidence_ids is None else evidence_ids}


def costs(value=1):return {key:metric(value) for key in COST_CATEGORIES}


def vectis(**updates):
    record={'mode':'forward','baselineWorkflowCostGbp':metric(100),'attemptedTasks':metric(10),'successfulTasks':metric(8),
        'avoidedExpenditureGbp':metric(60),'incrementalContributionGbp':metric(30),'customerIncomeGbp':metric(100),'costs':costs()}
    record.update(updates);return record


def expansion(**updates):
    record={'currentStage':'idea','nextStage':'limited_pilot','scope':{'users':['analyst-1'],'workflows':['research-summary'],'sourceIds':['facts'],
        'capexCeilingGbp':0,'operatingBudgetGbp':50,'nextReviewAt':400},'gates':[gate(t) for t in GATES],
        'evidence':[source()],'asOf':200,'mode':'forward','permittedUse':'pilot-review'}
    record.update(updates);return record


def run(**updates):
    record={'id':'run-1','mode':'forward','provider':'local-demo','modelVersion':'fixture-v1','inputTokens':100,'outputTokens':20,
        'inferenceCostGbp':.01,'latencyMs':20,'quality':'passed','fallbackCalls':1,
        'hardware':{'energyKwh':None,'depreciationGbp':None,'utilisation':None,'throughputPerSecond':None}}
    record.update(updates);return record


class ProofScaleTests(unittest.TestCase):
    def test_missing_authority_reconciliation_permissions_and_verification_block(self):
        for patch in ({'authoritativeSource':''},{'dataOwner':''},{'lastVerifiedAt':None},{'permittedUses':[]},{'reconciliation':'contradictory'},{'exceptionPolicy':''}):
            result=evaluate_gate(gate(),[source(**patch)],200,'forward','pilot-review')
            self.assertEqual(result['state'],'failed');self.assertTrue(result['blockers'])
        result=evaluate_gate(gate(evidenceIds=['missing']),[source()],200,'forward','pilot-review')
        self.assertEqual(result['state'],'failed')

    def test_late_and_revised_sources_preserve_historical_cutoff(self):
        original=source();revision=source(id='facts-v2',revision=2,supersedes=original['id'],publishedAt=150,receivedAt=250,lastVerifiedAt=260,reconciliation='contradictory')
        records=[original,revision]
        self.assertEqual([r['id'] for r in eligible_evidence(records,200,'forward')],['facts-v1'])
        self.assertEqual(evaluate_gate(gate(),records,200,'forward','pilot-review')['state'],'passed')
        current=evaluate_gate(gate(),records,300,'forward','pilot-review')
        self.assertEqual(current['state'],'failed');self.assertTrue(any('superseded' in b for b in current['blockers']))
        late=source(receivedAt=210)
        self.assertEqual(eligible_evidence([late],200,'forward'),[])

    def test_invalid_revision_fork_and_credentials_are_rejected(self):
        for records in ([source(),source()], [source(revision=2,supersedes='absent')], [source(),source(id='v2',revision=2,supersedes='facts-v1'),source(id='other-v2',revision=2,supersedes='facts-v1')]):
            with self.assertRaises(ValueError):validate_evidence_history(records)
        with self.assertRaises(ValueError):validate_evidence_history([source(sourceUrl='https://user:secret@example.test/private')])

    def test_model_recommendation_cannot_pass_gate(self):
        result=evaluate_gate(gate(decisionActor='model',decisionBy='model-a'),[source()],200,'forward','pilot-review')
        self.assertEqual(result['state'],'failed')
        self.assertTrue(any('Human' in b for b in result['blockers']))
        pending=evaluate_gate(gate(state='pending',decisionActor='model'),[source()],200,'forward','pilot-review')
        self.assertEqual(pending['state'],'pending')

    def test_failed_expired_missing_gates_and_stage_skip_block_expansion(self):
        self.assertTrue(evaluate_expansion(expansion())['allowed'])
        for change in ({'nextStage':'expanded_pilot'},{'gates':[gate(t,revalidateAt=200) for t in GATES]},
                       {'gates':[gate(t,state='failed') for t in GATES]},{'gates':[gate()]}):
            self.assertFalse(evaluate_expansion(expansion(**change))['allowed'])
        old=evaluate_expansion(expansion(currentStage='expanded_pilot',nextStage='production',mode='historical',evidence=[source(mode='historical')]))
        self.assertFalse(old['allowed'])

    def test_global_critical_exception_blocks_even_outside_gate_references(self):
        second=source(id='critical-v1',sourceId='customer-permission',authoritativeSource='',critical=True)
        self.assertFalse(evaluate_expansion(expansion(evidence=[source(),second]))['allowed'])

    def test_threshold_cannot_use_forecast_late_or_ambiguous_measurement(self):
        for patch in ({'kind':'forecast'},{'receivedAt':145},{'unit':'seconds'},{'value':1},{'evidenceIds':['not-in-snapshot']}):
            m={**gate()['measurements'][0],**patch}
            self.assertEqual(evaluate_gate(gate(measurements=[m]),[source()],200,'forward','pilot-review')['state'],'failed')
        m=gate()['measurements'][0]
        self.assertEqual(evaluate_gate(gate(measurements=[m,m]),[source()],200,'forward','pilot-review')['state'],'failed')

    def test_forecast_savings_and_customer_income_are_not_realised_profit(self):
        request=vectis(avoidedExpenditureGbp=metric(1000,'forecast'),incrementalContributionGbp=metric(500,'unverified'),customerIncomeGbp=metric(10000,'forecast'))
        result=vectis_economics(request,[source()],200,'pilot-review')
        self.assertIsNone(result['avoidedExpenditureGbp']);self.assertIsNone(result['incrementalContributionGbp']);self.assertIsNone(result['realisedProfitGbp'])
        self.assertEqual(result['forecasts']['avoidedExpenditureGbp']['value'],1000)
        realised=vectis_economics(vectis(),[source()],200,'pilot-review')
        self.assertEqual(realised['realisedProfitGbp'],92)
        self.assertEqual(realised['costPerSuccessfulTaskGbp'],1)
        self.assertEqual(realised['correctionCostGbp'],1)

    def test_negative_measured_incremental_contribution_is_preserved_without_profit_doublecount(self):
        request=vectis(incrementalContributionGbp=metric(-30))
        result=vectis_economics(request,[source()],200,'pilot-review')
        self.assertEqual(result['incrementalContributionGbp'],-30)
        self.assertEqual(result['realisedProfitGbp'],92)
        self.assertEqual(result['customerIncomeGbp'],100)
        self.assertEqual(result['fullyAllocatedCostGbp'],8)

    def test_every_allocated_cost_including_zero_requires_verified_evidence(self):
        request=vectis();request['costs']['energyGbp']=metric(None,'unverified')
        result=vectis_economics(request,[source()],200,'pilot-review')
        self.assertIsNone(result['fullyAllocatedCostGbp']);self.assertIsNone(result['realisedProfitGbp'])
        request['costs']['energyGbp']=metric(0,evidence_ids=[])
        self.assertIsNone(vectis_economics(request,[source()],200,'pilot-review')['fullyAllocatedCostGbp'])
        request['costs']['energyGbp']=metric(0)
        self.assertEqual(vectis_economics(request,[source()],200,'pilot-review')['fullyAllocatedCostGbp'],7)

    def test_counts_are_valid_and_missing_attempts_cannot_create_success_rate(self):
        result=vectis_economics(vectis(attemptedTasks=metric(None,'unverified')),[source()],200,'pilot-review')
        self.assertIsNone(result['successfulTasks']);self.assertIsNone(result['successRate'])
        result=vectis_economics(vectis(successfulTasks=metric(12)),[source()],200,'pilot-review')
        self.assertIsNone(result['successfulTasks'])

    def test_financial_results_reproduce_and_preserve_decimal_units(self):
        request={'mode':'forward','brier':metric(.2),'mae':metric(.01),'absoluteReturn':metric(.05),'benchmarkReturn':metric(.02),'maxDrawdown':metric(.1),'costs':costs()}
        a=investment_economics(request,[source()],200,'pilot-review');b=investment_economics(copy.deepcopy(request),[source()],200,'pilot-review')
        self.assertEqual(json.dumps(a,sort_keys=True),json.dumps(b,sort_keys=True));self.assertAlmostEqual(a['benchmarkRelativeReturn'],.03)
        self.assertEqual(a['fullyAllocatedCostGbp'],8)
        request['brier']=metric(.1,'forecast')
        self.assertIsNone(investment_economics(request,[source()],200,'pilot-review')['brier'])

    def test_relative_returns_require_shared_aligned_outcome_protocol(self):
        evidence=[source(),source(id='other-v1',sourceId='other-protocol')]
        request={'mode':'forward','brier':metric(.2),'mae':metric(.01),'absoluteReturn':metric(.05),'benchmarkReturn':metric(.02,evidence_ids=['other-v1']),'maxDrawdown':metric(.1),'costs':costs()}
        result=investment_economics(request,evidence,200,'pilot-review')
        self.assertIsNone(result['benchmarkRelativeReturn'])
        self.assertIn('Relative returns require the same aligned outcome evidence references',result['blockers'])
        request['absoluteReturn']['evidenceIds']=['facts-v1','other-v1']
        request['benchmarkReturn']['evidenceIds']=['other-v1','facts-v1']
        self.assertAlmostEqual(investment_economics(request,evidence,200,'pilot-review')['benchmarkRelativeReturn'],.03)
        with self.assertRaises(ValueError):evaluate_expansion(expansion(currentStage='invalid',nextStage='idea'))
        with self.assertRaises(ValueError):evaluate_expansion(expansion(mode='unclassified'))

    def test_modes_never_combine_and_per_run_stats_do_not_claim_hardware_profit(self):
        self.assertEqual(eligible_evidence([source()],200,'synthetic'),[])
        self.assertEqual(evaluate_gate(gate(),[source()],200,'historical','pilot-review')['state'],'failed')
        result=run_economics([run()]);self.assertEqual(result['inputTokens'],100);self.assertEqual(result['fallbackCalls'],1)
        self.assertIsNone(result['fullServiceCostGbp']);self.assertIn('Not established',result['profitability'])
        with self.assertRaises(ValueError):run_economics([run(),run(id='other',mode='synthetic')])
        with self.assertRaises(ValueError):run_economics([run(inputTokens=-1)])
        with self.assertRaises(ValueError):run_economics([run(hardware={'energyKwh':None,'depreciationGbp':None,'utilisation':2,'throughputPerSecond':None})])
        self.assertIsNone(run_economics([run(inferenceCostGbp=None)])['inferenceCostGbp'])

    def test_synthetic_profit_arithmetic_cannot_establish_commercial_profit(self):
        request=vectis(mode='synthetic')
        result=vectis_economics(request,[source(mode='synthetic')],200,'pilot-review')
        self.assertEqual(result['realisedProfitGbp'],92)
        self.assertFalse(result['commercialProfitEstablished']);self.assertIn('Demonstration',result['benefitBasis'])
        self.assertTrue(vectis_economics(vectis(),[source()],200,'pilot-review')['commercialProfitEstablished'])
        incomplete=vectis(customerIncomeGbp=metric(100,'forecast'))
        self.assertFalse(vectis_economics(incomplete,[source()],200,'pilot-review')['commercialProfitEstablished'])

    def test_unsafe_cost_magnitude_stays_unavailable(self):
        request=vectis(costs=costs(1e16))
        result=vectis_economics(request,[source()],200,'pilot-review')
        self.assertIsNone(result['fullyAllocatedCostGbp']);self.assertIsNone(result['realisedProfitGbp'])
        self.assertFalse(result['commercialProfitEstablished'])

    def test_cli_exports_reproducibly_without_execution_authority(self):
        request={'version':VERSION,'evidence':[source()],'asOf':200,'mode':'forward','permittedUse':'pilot-review','vectis':vectis(),'gates':[gate()]}
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'input.json';path.write_text(json.dumps(request),encoding='utf-8')
            completed=subprocess.run([sys.executable,'-m','worker.proof_scale',str(path)],capture_output=True,text=True,check=True)
            result=json.loads(completed.stdout)
        self.assertEqual(result['executionAuthority'],'none');self.assertEqual(result['vectis']['realisedProfitGbp'],92)


if __name__=='__main__':unittest.main()
