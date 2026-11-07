import copy
import json
import tempfile
import unittest
from pathlib import Path

from worker.stress import VERSION, classify, market_summary, relative_return, valuation_reset, outcome, register_outcome, validate_market
from worker.stress_runner import run_experiment, evaluate_experiment, validate_experiment, prepare_draft
from worker.stress_demo import fixtures, mock_transport


def financial(metric,value,**extra):
    result={'id':metric,'symbol':'GOOGL','metric':metric,'value':value,'unit':'currency-per-share' if metric=='forward_eps' else 'currency',
            'currency':'USD','period':{'start':100,'end':200,'label':'test','scope':'quarter'},'basis':'gaap','kind':'reported',
            'publishedAt':300,'receivedAt':310,'sourceUrl':'https://example.com/synthetic','verified':True,'synthetic':True,'adjustmentVersion':'fixture-v1'}
    result.update(extra);return result


class StressTests(unittest.TestCase):
    def test_decline_never_classifies_buy(self):
        self.assertEqual(classify({'priceChange':-.9})['classification'],'Insufficient evidence')
        review={'evidenceVerified':True,'fundamentals':'stable','valuation':'reset','positiveEvidence':['fact'],'negativeEvidence':[],'uncertainties':[]}
        self.assertEqual(classify(review)['classification'],'Potential valuation opportunity')
        self.assertTrue(classify(review)['researchOnly'])
        review['uncertainties']=['Unknown debt'];self.assertEqual(classify(review)['classification'],'Insufficient evidence')
        review.update(fundamentals='deteriorating',negativeEvidence=['Margin fell']);self.assertEqual(classify(review)['classification'],'Fundamental deterioration')

    def test_deterministic_null_safe_financials(self):
        request={'financials':[financial('revenue',100),financial('operating_cash_flow',30),financial('capex',20),financial('operating_income',10)],'asOf':400,'price':None}
        values=valuation_reset(request)
        self.assertEqual(values,valuation_reset(copy.deepcopy(request)))
        self.assertEqual(values['kpis']['freeCashFlow']['value'],10)
        self.assertEqual(values['kpis']['freeCashFlowMargin']['value'],.1)
        self.assertIsNone(values['kpis']['forwardPE']['value'])
        self.assertIsNone(values['kpis']['enterpriseValue']['value'])
        request['financials'][2]['basis']='non-gaap'
        self.assertIsNone(valuation_reset(request)['kpis']['freeCashFlow']['value'])

    def test_consensus_and_prior_observation(self):
        market,_=fixtures();price=market['bars'][0];instant=price['eventAt']
        eps=financial('forward_eps',5,kind='estimated',period={'start':instant,'end':instant+100000,'label':'same forecast','scope':'forward12m'},consensusVendor='licensed-vendor',collectedAt=290)
        prior={'price':price,'financials':[eps],'asOf':instant+1000}
        current={'price':{**price,'close':110,'high':111},'financials':[{**eps,'value':5.5}],'asOf':instant+2000,'prior':prior}
        kpis=valuation_reset(current)['kpis']
        self.assertEqual(kpis['forwardPE']['value'],20)
        self.assertAlmostEqual(kpis['forwardEPSChange']['value'],.1)
        self.assertAlmostEqual(kpis['forwardPEChange']['value'],0)
        current['financials'][0]['consensusVendor']='other'
        self.assertIsNone(valuation_reset(current)['kpis']['forwardEPSChange']['value'])
        del current['financials'][0]['consensusVendor']
        self.assertIsNone(valuation_reset(current)['kpis']['forwardEPS']['value'])

    def test_mixed_financials_rejected(self):
        with self.assertRaises(ValueError):valuation_reset({'financials':[financial('revenue',10),financial('capex',2,synthetic=False)],'asOf':400})

    def test_financial_ties_and_invalid_price_rejected(self):
        records=[financial('revenue',100),financial('revenue',200,id='other')]
        with self.assertRaises(ValueError):valuation_reset({'financials':records,'asOf':400})
        market,_=fixtures();price={**market['bars'][0],'close':-1}
        with self.assertRaises(ValueError):valuation_reset({'financials':[],'asOf':400,'price':price})
        with self.assertRaises(ValueError):valuation_reset({'financials':[financial('revenue',100,currency='usd')],'asOf':400})

    def test_aligned_sessions_full_coverage_and_future_receipt(self):
        market,_=fixtures();asof=market['coverageEnd']+1000
        full=market_summary(market,'GOOGL',asof)
        self.assertAlmostEqual(full['oneSession']['absolute']['value'],80/81-1)
        self.assertIsNone(full['days30']['drawdown']['value'])
        market['bars']=[b for b in market['bars'] if b['id']!='GOOGL-19']
        self.assertIsNone(market_summary(market,'GOOGL',asof)['oneSession']['absolute']['value'])
        market,_=fixtures();market['bars'][20]['receivedAt']=asof+1
        self.assertIsNone(market_summary(market,'GOOGL',asof)['oneSession']['absolute']['value'])

    def test_currency_actions_and_mode_rejected(self):
        market,_=fixtures();bars=[market['bars'][0],market['bars'][1],market['bars'][21],market['bars'][22]]
        self.assertAlmostEqual(relative_return(*bars)['relativeReturn'],-.0075)
        for field,value in [('currency','GBP'),('adjustmentVersion','split-new'),('corporateActionsReviewed',False),('synthetic',False)]:
            changed=copy.deepcopy(bars);changed[1][field]=value
            with self.assertRaises(ValueError):relative_return(*changed)
        changed=copy.deepcopy(bars);changed[3]['eventAt']+=1
        with self.assertRaises(ValueError):relative_return(*changed)

    def test_pending_windows_and_frozen_provider(self):
        market,bundle=fixtures();window=bundle['window']
        self.assertEqual(outcome(window,market,window['endAt']-1)['status'],'pending')
        self.assertEqual(outcome(window,market,window['endAt']+1000)['status'],'complete')
        window['provider']='other'
        self.assertEqual(outcome(window,market,window['endAt']+1000)['status'],'pending')
        window['endAt']+=1
        with self.assertRaises(ValueError):register_outcome(window)

    def test_lookahead_and_backdating(self):
        _,bundle=fixtures();bundle['evidence'][0]['receivedAt']=bundle['cutoff']+1
        with self.assertRaises(ValueError):validate_experiment(bundle)
        _,bundle=fixtures();bundle['mode']='forward';bundle['window']['mode']='forward'
        with self.assertRaises(ValueError):validate_experiment(bundle)

    def test_mocked_experiment_same_evidence_no_trade(self):
        market,bundle=fixtures();seen=[]
        def transport(endpoint,headers,payload,timeout):
            seen.append(payload['messages'][-1]['content']);return mock_transport(endpoint,headers,payload,timeout)
        env={'OPENAI_API_KEY':'mock-key','OPENAI_MODEL':'mock-a','ANTHROPIC_API_KEY':'mock-key','ANTHROPIC_MODEL':'mock-b'}
        with tempfile.TemporaryDirectory() as temp:
            directory=Path(temp)/'run'
            run=run_experiment(bundle,directory,env=env,transport=transport)
            self.assertEqual(set(run['statuses'].values()),{'success'})
            self.assertEqual(seen[0],seen[1])
            report=evaluate_experiment(directory,market,market['coverageEnd']+1000)
            self.assertEqual(len(report['participants']),5)
            self.assertIsNone(report['participants'][0]['economicAccuracy'])
            self.assertIsNone(report['participants'][0]['actualBilledCost'])
            self.assertIsNotNone(report['participants'][0]['scores'])
            self.assertEqual(report['paperTrading']['status'],'not_authorised')
            pending=evaluate_experiment(directory,market,bundle['window']['endAt']-1)
            self.assertTrue(all(p['scores'] is None for p in pending['participants']))
            with self.assertRaises(FileExistsError):run_experiment(bundle,directory,env=env,transport=transport)

    def test_unconfigured_and_missing_preserved(self):
        market,bundle=fixtures()
        def forbidden(*args):raise AssertionError('No network without configuration')
        with tempfile.TemporaryDirectory() as temp:
            directory=Path(temp)/'run';result=run_experiment(bundle,directory,env={},transport=forbidden)
            self.assertEqual(set(result['statuses'].values()),{'invalid-or-unconfigured'})
            (directory/'openai.json').unlink()
            report=evaluate_experiment(directory,market,market['coverageEnd']+1000)
            self.assertEqual(report['participants'][0]['status'],'missing')
            self.assertIsNone(report['participants'][0]['scores'])

    def test_ui_bridge_refilters_to_window_cutoff(self):
        market,bundle=fixtures();window=bundle['window'];window['evidenceCutoff']=market['bars'][0]['receivedAt']
        window['startAt']=market['calendar']['sessionCloses'][1];window.pop('endAt');window=register_outcome(window)
        fact=financial('revenue',100,publishedAt=window['evidenceCutoff']-20,receivedAt=window['evidenceCutoff']-10)
        later={**fact,'id':'late','receivedAt':window['evidenceCutoff']+10}
        draft={'version':VERSION,'executionAuthority':'none','registrationStatus':'local-research-draft','mode':'retrospective_study','symbol':'GOOGL',
            'synthetic':True,'cutoff':market['coverageEnd'],'neutralBand':.002,'outcomeRegistrations':[window],
            'evidence':{'bars':market['bars'],'financials':[fact,later]}}
        prepared=prepare_draft(draft,5)
        self.assertEqual(prepared['cutoff'],window['evidenceCutoff'])
        self.assertNotIn('late',[r['id'] for r in prepared['evidence']])
        self.assertEqual(prepared['mode'],'retrospective')

    def test_large_price_history_group_preserves_rows_and_rejects_nested_lookahead(self):
        market,bundle=fixtures();cutoff=bundle['cutoff'];bars=[]
        for index in range(150):
            bars.append({**market['bars'][0],'id':f'history-{index}','eventAt':cutoff-2000-index*1000,'receivedAt':cutoff-1000-index*1000})
        draft={'version':VERSION,'executionAuthority':'none','registrationStatus':'local-research-draft','mode':'retrospective_study','symbol':'GOOGL',
            'synthetic':True,'cutoff':cutoff,'neutralBand':.002,'outcomeRegistrations':[bundle['window']],
            'evidence':{'bars':bars,'financials':[]}}
        prepared=prepare_draft(draft,5)
        self.assertEqual(len(prepared['evidence']),1)
        self.assertEqual(len(prepared['evidence'][0]['observations']),150)
        self.assertEqual(prepared['preparation']['selectedFinancialRows'],0)
        prepared['baselineReview']['positiveEvidence']=['history-0'];validate_experiment(prepared)
        prepared['evidence'][0]['observations'][0]['receivedAt']=cutoff+1
        with self.assertRaises(ValueError):validate_experiment(prepared)

    def test_independent_economic_adjudication_hash_and_rubric(self):
        import time
        market,bundle=fixtures()
        with tempfile.TemporaryDirectory() as temp:
            directory=Path(temp)/'run';run_experiment(bundle,directory,env={'OPENAI_API_KEY':'mock-key','OPENAI_MODEL':'mock-a','ANTHROPIC_API_KEY':'mock-key','ANTHROPIC_MODEL':'mock-b'},transport=mock_transport)
            manifest=json.loads((directory/'manifest.json').read_text())
            review={'version':'economic-factual-rubric-v1','reviewer':'human-reviewer','reviewerType':'human','reviewedAt':time.time()*1000,
                'evidenceSha256':manifest['evidenceSha256'],'participants':{'openai':[{'statement':'Observed facts unavailable','verdict':'correct','evidenceIds':['fact-1']},
                {'statement':'Unknown future','verdict':'unassessable','evidenceIds':['fact-1']}]}}
            path=directory/'economic-adjudication.json';path.write_text(json.dumps(review))
            report=evaluate_experiment(directory,market,market['coverageEnd']+1000)
            accuracy=report['participants'][0]['economicAccuracy']
            self.assertEqual(accuracy['factualAccuracy'],1);self.assertEqual(accuracy['coverage'],.5)
            self.assertIsNotNone(report['participants'][0]['scores'])
            review['evidenceSha256']='wrong';path.write_text(json.dumps(review))
            with self.assertRaises(ValueError):evaluate_experiment(directory,market,market['coverageEnd']+1000)


if __name__=='__main__':unittest.main()
