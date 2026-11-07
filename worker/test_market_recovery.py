import copy
import json
import math
from pathlib import Path
import unittest

from worker.market_recovery import VERSION,DAY,parse_recovery_case,freeze_recovery_case,recovery_momentum,classify_recovery_case,build_recovery_registration,evaluate_recovery_window,recovery_risk_gate,evaluate

T=1800000000000
URL='https://example.com/synthetic-recovery-provenance'


def fixture(mode='synthetic'):
    source=dict(id='licensed-source',title='Synthetic declared source',url=URL,kind='licensed_provider',publishedAt=T-100*DAY,publicationDate=None,publicationBasis='exact',receivedAt=T-100*DAY,verified=True,usage='licensed',permittedUse='Synthetic test arithmetic only',mode=mode,role='evidence')
    def instrument(symbol,product,currency='USD'):
        return dict(id=symbol,name=symbol,symbol=symbol,product=product,currency=currency,sourceIds=[source['id']],sourceUrl=URL,globalDiversificationVerified=symbol=='VT',leverageFactor=1,researchApproved=True,publishedAt=T-100*DAY,receivedAt=T-100*DAY,mode=mode)
    instruments=[instrument(s,'index') for s in ('COMP','NDX','SOX')]+[instrument('QQQ','etf')]+[instrument(s,'equity') for s in ('NVDA','MSFT','AAPL')]+[instrument('VT','etf','GBP'),instrument('CASH','cash','GBP')]
    sessions=[T+j*DAY for j in range(-20,61)];prices=[];fx=[]
    for j,at in enumerate(sessions):
        for i in instruments:
            if i['product']=='cash':continue
            prices.append(dict(id=f"{i['id']}-{j}",instrumentId=i['id'],provider='Synthetic same-provider history',sourceIds=[source['id']],sourceUrl=URL,eventAt=at,publishedAt=at,receivedAt=at,currency=i['currency'],close=100*(1.002 if i['id']=='VT' else 1.01)**j,priceBasis='index-level' if i['product']=='index' else 'total-return',adjustmentVersion='fixture-v1',session='regular',corporateActionsReviewed=True,licensed=True,permittedUse='Synthetic test calculations only',usage='licensed',mode=mode,supersedes=None))
        fx.append(dict(id=f'fx-{j}',provider='Synthetic FX',sourceUrl=URL,licensed=True,permittedUse='Synthetic arithmetic',**{'from':'USD','to':'GBP'},eventAt=at,publishedAt=at,receivedAt=at,rate=.8+j*.0001,conversionVersion='fixture-fx',mode=mode,supersedes=None))
    common=dict(initialCapitalGbp=500,cashInstrumentId='CASH',entryFeePerLegGbp=.5,exitFeePerLegGbp=.5,spreadBps=10,slippageBps=5,fxFeeBps=20,annualAdditionalFeeBps=25,cashAnnualRate=0,costAssumptionsNote='Synthetic explicit costs; not actual brokerage fees',mode=mode)
    basket=[dict(instrumentId=s,weight=1/3) for s in ('NVDA','MSFT','AAPL')]
    plans=[dict(id='immediate',name='Immediate equal basket',kind='immediate',basket=copy.deepcopy(basket),schedule=[dict(offsetSessions=0,fraction=1)],**common),dict(id='staged',name='Three fixed tranches',kind='staged',basket=copy.deepcopy(basket),schedule=[dict(offsetSessions=j,fraction=1/3) for j in (0,5,20)],**common),dict(id='diversified',name='Global ETF and GBP cash',kind='diversified',basket=[dict(instrumentId='VT',weight=.5),dict(instrumentId='CASH',weight=.5)],schedule=[dict(offsetSessions=0,fraction=1)],**common)]
    breadth=[dict(id='breadth',populationInstrumentId='COMP',populationDefinition='Explicit synthetic Composite population',eventAt=T,publishedAt=T,receivedAt=T,advancing=1800,declining=1100,unchanged=100,eligiblePopulation=3000,coverageComplete=True,licensed=True,sourceIds=[source['id']],mode=mode)]
    sectors=[dict(id='sectors',populationDefinition='Eleven synthetic sectors',eventAt=T,publishedAt=T,receivedAt=T,positiveSectors=8,totalSectors=11,coverageComplete=True,licensed=True,sourceIds=[source['id']],mode=mode)]
    indicators=[]
    for metric,unit,values in [('vix','index_points',(19,20)),('treasury_10y','percent',(4.4,4.5)),('credit_spread','basis_points',(298,300))]:
        for j,at in enumerate((T-5*DAY,T)):
            indicators.append(dict(id=f'{metric}-{j}',metric=metric,seriesId=metric,populationDefinition='Same synthetic measurement definition',value=values[j],unit=unit,measurementAt=at,publishedAt=at,receivedAt=at,sourceIds=[source['id']],mode=mode))
    return dict(version=VERSION,id='recovery-fixture',name='Synthetic recovery case',mode=mode,anchorAt=T,sources=[source],instruments=instruments,calendar=dict(id='synthetic-calendar',sourceUrl=URL,verified=True,publishedAt=T-100*DAY,receivedAt=T-100*DAY,session='regular',sessionCloses=sessions,mode=mode),prices=prices,fx=fx,breadth=breadth,sectorParticipation=sectors,indicators=indicators,electionHeadlines=[],contextRecords=[],analystConsensusSnapshot=None,plans=plans)


def options():return dict(name='Fixed 500 GBP comparisons',cutoff=T,anchorAt=T,registeredAt=T,benchmarkInstrumentId='QQQ',priceBasis='total-return',adjustmentVersion='fixture-v1')


def window_for(data,plan,horizon):return next(w for w in build_recovery_registration(data,options())['windows'] if w['planId']==plan and w['horizon']==horizon)


class RecoveryEvidenceTests(unittest.TestCase):
    def test_indices_and_qqq_are_distinct_nonleveraged_instruments(self):
        data=fixture();data['instruments'][0]['id']='index-alias'
        with self.assertRaises(ValueError):parse_recovery_case(data)
        data=fixture();data['instruments'][0]['product']='etf'
        with self.assertRaisesRegex(ValueError,'aliases'):parse_recovery_case(data)
        data=fixture();data['instruments'][0]['leverageFactor']=2
        with self.assertRaises(ValueError):parse_recovery_case(data)

    def test_sourced_full_momentum_and_predefined_confirmation(self):
        data=fixture();m=recovery_momentum(data,'COMP',T)
        self.assertEqual([w['status'] for w in m['windows']],['available']*3)
        self.assertAlmostEqual(m['windows'][1]['return'],1.01**5-1);self.assertEqual(m['windows'][1]['positiveSessions'],5)
        self.assertEqual(classify_recovery_case(data,T)['classification'],'confirmed')

    def test_one_positive_session_or_missing_population_never_confirms(self):
        data=fixture();data['breadth']=[]
        result=classify_recovery_case(data,T)
        self.assertEqual(result['classification'],'unconfirmed');self.assertIn('Licensed complete',result['missingCritical'][0])
        data=fixture();data['sectorParticipation'][0]['coverageComplete']=False
        self.assertEqual(classify_recovery_case(data,T)['classification'],'unconfirmed')

    def test_anchor_requires_exact_close_not_stale_previous_observation(self):
        data=fixture();data['prices']=[p for p in data['prices'] if not (p['instrumentId']=='NDX' and p['eventAt']==T)]
        result=classify_recovery_case(data,T)
        self.assertEqual(result['classification'],'unconfirmed');self.assertTrue(any('anchor close' in m for m in result['missingCritical']))

    def test_missing_intermediate_closes_do_not_become_daily_observations(self):
        data=fixture();data['prices']=[p for p in data['prices'] if not (p['instrumentId']=='COMP' and p['eventAt']==T-3*DAY)]
        self.assertEqual(recovery_momentum(data,'COMP',T)['windows'][1]['status'],'unavailable')

    def test_public_reference_supports_descriptive_index_only_not_paper_quotes(self):
        data=fixture();data['sources'][0].update(usage='public_reference',permittedUse=None)
        for p in data['prices']:p.update(licensed=False,usage='public_reference',permittedUse=None)
        self.assertEqual(recovery_momentum(data,'COMP',T)['windows'][2]['status'],'available')
        result=evaluate_recovery_window(data,window_for(data,'immediate',1),T+DAY)
        self.assertEqual(result['status'],'pending');self.assertIsNone(result['result'])

    def test_news_narrative_cannot_become_numeric_evidence(self):
        data=fixture();data['sources'][0]['kind']='news'
        self.assertIsNone(recovery_momentum(data,'COMP',T)['latest'])
        self.assertEqual(freeze_recovery_case(data,T)['case']['prices'],[])

    def test_future_received_and_outcome_evidence_cannot_leak(self):
        data=fixture();data['sources'][0]['receivedAt']=T+1
        self.assertEqual(freeze_recovery_case(data,T)['case']['sources'],[])
        data=fixture();data['sources'][0]['role']='outcome'
        self.assertEqual(freeze_recovery_case(data,T)['case']['sources'],[])
        data=fixture();data['prices'][0]['mode']='retrospective'
        with self.assertRaisesRegex(ValueError,'combined'):parse_recovery_case(data)

    def test_breadth_denominator_units_and_credential_urls_rejected(self):
        data=fixture();data['breadth'][0]['eligiblePopulation']=2999
        with self.assertRaisesRegex(ValueError,'population'):parse_recovery_case(data)
        data=fixture();data['indicators'][0]['unit']='percent'
        with self.assertRaisesRegex(ValueError,'unit'):parse_recovery_case(data)
        data=fixture();data['sources'][0]['url']=URL+'?api_key=not-a-real-key'
        with self.assertRaises(ValueError):parse_recovery_case(data)

    def test_strict_nested_analyst_snapshot_cannot_be_arbitrary_model_json(self):
        data=fixture();data['analystConsensusSnapshot']=dict(caseId='fake',cutoff=T,receivedAt=T,recordJson=json.dumps({'modelSaysBuy':True}),mode='synthetic')
        with self.assertRaises(ValueError):parse_recovery_case(data)

    def test_macro_unit_conversion_and_stale_measurements(self):
        data=fixture()
        for r in data['indicators']:
            if r['metric']=='credit_spread':r['value']/=100;r['unit']='percent'
        result=classify_recovery_case(data,T)
        self.assertEqual(result['classification'],'confirmed');credit=next(i for i in result['indicators'] if i['metric']=='credit_spread')
        self.assertAlmostEqual(credit['fiveSessionChange'],2)
        data['indicators']=[r for r in data['indicators'] if r['measurementAt']!=T]
        self.assertEqual(classify_recovery_case(data,T)['classification'],'unconfirmed')


class RecoveryAccountingTests(unittest.TestCase):
    def test_registration_preserves_one_anchor_and_all_four_windows(self):
        r=build_recovery_registration(fixture(),options())
        self.assertEqual(len(r['windows']),12);self.assertEqual({w['anchorAt'] for w in r['windows']},{T})
        self.assertTrue(all(w['endAt']==T+w['horizon']*DAY for w in r['windows']));self.assertEqual({p['initialCapitalGbp'] for p in r['plans']},{500});self.assertEqual(r['executionAuthority'],'none')

    def test_staged_fees_only_charge_executed_tranches_and_aggregate_exit(self):
        data=fixture()
        for horizon,count in ((1,1),(5,2),(20,3),(60,3)):
            result=evaluate_recovery_window(data,window_for(data,'staged',horizon),T+horizon*DAY)
            self.assertEqual(result['status'],'complete',result['reason']);r=result['result']
            self.assertEqual(len(r['entries']),count);self.assertAlmostEqual(r['entryFeesGbp'],count*3*.5)
            self.assertAlmostEqual(r['exitFixedFeesGbp'],3*.5);self.assertEqual(len(r['finalExposureByInstrument']),3)
            self.assertAlmostEqual(r['cashRemainingGbp'],500-count*500/3,places=8)

    def test_endpoint_entry_is_included_and_windows_never_restart(self):
        data=fixture();r=evaluate_recovery_window(data,window_for(data,'staged',5),T+5*DAY)['result']
        self.assertEqual(r['entries'][-1]['at'],T+5*DAY);self.assertEqual(r['path'][0]['at'],T)
        self.assertEqual(r['path'][-1]['at'],T+5*DAY);self.assertGreater(r['path'][-1]['noncashFraction'],r['path'][0]['noncashFraction'])

    def test_fx_and_trading_costs_remain_separate_and_returns_include_fx(self):
        data=fixture();r=evaluate_recovery_window(data,window_for(data,'immediate',5),T+5*DAY)['result']
        self.assertAlmostEqual(r['entryPercentageCostsGbp'],r['entryFxCostsGbp']+r['entryTradingPercentageCostsGbp'])
        self.assertAlmostEqual(r['exitLiquidationCostsGbp'],r['exitFixedFeesGbp']+r['exitFxCostsGbp']+r['exitTradingPercentageCostsGbp'])
        self.assertGreater(r['entryFxCostsGbp'],0);self.assertGreater(r['grossReturn'],1.01**5-1)
        self.assertLess(r['netReturn'],r['grossReturn']);self.assertAlmostEqual(r['benchmarkRelativeReturn'],r['netReturn']-r['benchmarkReturn']);self.assertLessEqual(r['maxDrawdown'],0)

    def test_global_cash_control_has_half_cash_and_one_entry_exit_leg(self):
        data=fixture();r=evaluate_recovery_window(data,window_for(data,'diversified',20),T+20*DAY)['result']
        self.assertAlmostEqual(r['cashRemainingGbp'],250);self.assertEqual(r['entryFeesGbp'],.5);self.assertEqual(r['exitFixedFeesGbp'],.5);self.assertEqual(r['entryFxCostsGbp'],0)

    def test_missing_cost_or_partial_future_window_never_scores(self):
        data=fixture();w=window_for(data,'immediate',5)
        self.assertEqual(evaluate_recovery_window(data,w,T+4*DAY)['status'],'pending')
        data=fixture();data['plans'][0]['fxFeeBps']=None;w=window_for(data,'immediate',1)
        self.assertIsNone(evaluate_recovery_window(data,w,T+DAY)['result'])

    def test_missing_licensed_quote_fx_or_split_adjustment_blocks(self):
        for field,value in [('licensed',False),('corporateActionsReviewed',False),('adjustmentVersion','different')]:
            data=fixture();w=window_for(data,'immediate',1);next(p for p in data['prices'] if p['instrumentId']=='NVDA' and p['eventAt']==T)[field]=value
            self.assertEqual(evaluate_recovery_window(data,w,T+DAY)['status'],'pending')
        data=fixture();w=window_for(data,'staged',5);data['fx']=[f for f in data['fx'] if f['eventAt']!=T+2*DAY]
        self.assertEqual(evaluate_recovery_window(data,w,T+5*DAY)['status'],'pending')

    def test_negative_cash_yield_cannot_borrow_to_fund_later_fixed_tranches(self):
        data=fixture();data['plans'][1]['cashAnnualRate']=-.5;w=window_for(data,'staged',20)
        self.assertIn('without borrowing',evaluate_recovery_window(data,w,T+20*DAY)['reason'])

    def test_frozen_costs_and_schedule_do_not_change_when_current_case_changes(self):
        data=fixture();w=window_for(data,'staged',5);data['plans'][1]['entryFeePerLegGbp']=10
        self.assertEqual(evaluate_recovery_window(data,w,T+5*DAY)['result']['entryFeesGbp'],3)

    def test_index_allocation_alias_capital_and_forward_backdating_rejected(self):
        data=fixture();data['plans'][0]['basket'][0]['instrumentId']='COMP'
        with self.assertRaisesRegex(ValueError,'Indices'):parse_recovery_case(data)
        data=fixture();data['plans'][0]['initialCapitalGbp']=501
        with self.assertRaisesRegex(ValueError,'500'):parse_recovery_case(data)
        data=fixture('forward');o=options();o['registeredAt']=T+1
        with self.assertRaisesRegex(ValueError,'precede'):build_recovery_registration(data,o)

    def test_risk_gate_checks_current_invalidation_and_grants_no_execution(self):
        data=fixture();r=build_recovery_registration(data,options());gate=recovery_risk_gate(r,'immediate',data,T)
        self.assertTrue(gate['passed']);self.assertEqual(gate['executionAuthority'],'none')
        next(i for i in data['indicators'] if i['metric']=='vix' and i['measurementAt']==T)['value']=40
        gate=recovery_risk_gate(r,'immediate',data,T)
        self.assertFalse(gate['passed']);self.assertTrue(gate['invalidationTriggered'])

    def test_v2_capture_classifies_at_anchor_not_latest_close(self):
        p=Path(__file__).resolve().parents[1]/'data/recovery/november-3-2026-v2-request.json'
        if not p.exists():self.skipTest('Source v2 package not bundled')
        request=json.loads(p.read_text(encoding='utf8'));report=evaluate(request);a=report['assessment']
        comp=next(m for m in a['momentum'] if m['instrumentId']=='COMP')
        self.assertEqual(comp['latest']['close'],25372.01);self.assertEqual(recovery_momentum(request['case'],'COMP',request['cutoff'])['latest']['close'],25736.51)
        self.assertEqual(a['classification'],'unconfirmed');self.assertEqual(len(a['missingCritical']),2);self.assertTrue(all('breadth' in m or 'sector' in m for m in a['missingCritical']))
        self.assertEqual([round(w['return']*100,2) for w in comp['windows']],[0.83,-4.18,-8.07])
        self.assertTrue(all(o['status']=='pending' for o in report['outcomes']));self.assertTrue(all(not g['passed'] for g in report['riskGates']))

    def test_momentum_end_bound_does_not_substitute_earlier_close(self):
        data=fixture();data['prices']=[p for p in data['prices'] if p['eventAt']!=T]
        m=recovery_momentum(data,'COMP',T+5*DAY,T);self.assertEqual(m['latest']['eventAt'],T-DAY)
        self.assertIn('anchor close',' '.join(classify_recovery_case(data,T+5*DAY,T)['missingCritical']))

    def test_actual_observed_package_stays_unconfirmed_with_pending_future_outcomes(self):
        p=Path(__file__).resolve().parents[1]/'data/recovery/november-3-2026-request.json'
        if not p.exists():self.skipTest('Actual source package not bundled')
        report=evaluate(json.loads(p.read_text(encoding='utf8')))
        self.assertEqual(report['assessment']['classification'],'unconfirmed');self.assertTrue(all(o['status']=='pending' for o in report['outcomes']))
