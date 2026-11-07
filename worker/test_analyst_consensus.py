import copy
import json
import unittest

from worker.analyst_consensus import VERSION, parse_consensus_case, freeze_consensus_case, consensus_summary, consensus_revisions, validate_consensus_portfolio, build_consensus_study, evaluate_consensus_window, consensus_ablation_report, evaluate

DAY=86400000
T=1800000000000
URL='https://example.com/declared-synthetic-provenance'


def fixture(mode='synthetic'):
    def instrument(id, symbol, product='equity', currency='USD'):
        return dict(id=id,name=id,symbol=symbol,product=product,currency=currency,sourceUrl=URL,globalDiversificationVerified=product=='etf',leverageFactor=1,researchApproved=True,publishedAt=T-500*DAY,receivedAt=T-500*DAY,mode=mode)
    instruments=[instrument('nvda','NVDA'),instrument('msft','MSFT'),instrument('aapl','AAPL'),instrument('global','GLOBAL','etf','GBP'),instrument('cash','GBP','cash','GBP'),instrument('benchmark','QQQ')]
    provider=dict(id='provider',name='Synthetic licensed test provider',sourceUrl=URL,licensed=True,permittedUse='Synthetic evaluation fixture only',mode=mode,ratingScale=[dict(raw='Buy',normalized='positive'),dict(raw='Hold',normalized='neutral'),dict(raw='Sell',normalized='negative')],coverage=dict(startAt=T-500*DAY,endAt=T+100*DAY,publishedAt=T-100*DAY,receivedAt=T-100*DAY,complete=True,symbols=['NVDA','MSFT','AAPL'],analystUniverse='Declared synthetic complete analyst population'))
    def recommendation(id, analyst, at, target=420, rating='Buy', **extra):
        return dict(id=id,providerId='provider',analyst=analyst,institution='Synthetic firm',symbol='NVDA',rating=rating,previousRating=None,target=target,previousTarget=None,targetCurrency='USD',publishedAt=at,updatedAt=at,receivedAt=at,sourceUrl=URL,mode=mode,supersedes=None,**extra)
    recommendations=[recommendation('old','Analyst A',T-20*DAY),recommendation('other','Analyst B',T-50*DAY,300,'Hold')]
    new=recommendation('new','Analyst A',T-DAY,315);new.update(previousTarget=420,previousRating='Buy',supersedes='old');recommendations.append(new)
    common=dict(initialCapitalGbp=500,entryCostsGbp=1,exitCostsGbp=1,annualFeesBps=100,cashAnnualRate=.01,costAssumptionsNote='Fully declared synthetic cost assumptions, not brokerage costs',mode=mode)
    portfolios=[dict(id='ai',name='Equal three-company research basket',planType='ai_equal',allocations=[dict(instrumentId=i,weight=1/3) for i in ('nvda','msft','aapl')],**common),dict(id='diversified',name='Global fund plus cash',planType='diversified',allocations=[dict(instrumentId='global',weight=.7),dict(instrumentId='cash',weight=.3)],**common)]
    sessions=[T+i*DAY for i in range(61)]
    prices=[];fx=[]
    for n,event in enumerate(sessions):
        for instrument_id,multiplier,currency_code in [('nvda',1.002,'USD'),('msft',1.001,'USD'),('aapl',.999,'USD'),('global',1.0005,'GBP'),('benchmark',1.0008,'USD')]:
            prices.append(dict(id=f'{instrument_id}-{n}',instrumentId=instrument_id,provider='Declared synthetic prices',sourceUrl=URL,licensed=True,permittedUse='Synthetic fixtures only',eventAt=event,publishedAt=event,receivedAt=event+1000,currency=currency_code,close=100*multiplier**n,priceBasis='total-return',adjustmentVersion='fixture-v1',session='regular',corporateActionsReviewed=True,mode=mode,supersedes=None))
        fx.append(dict(id=f'fx-{n}',provider='Declared synthetic FX',sourceUrl=URL,licensed=True,permittedUse='Synthetic fixtures only',**{'from':'USD','to':'GBP'},eventAt=event,publishedAt=event,receivedAt=event+1000,rate=.8+n*.0001,conversionVersion='fixture-fx-v1',mode=mode,supersedes=None))
    return dict(version=VERSION,id='synthetic-consensus-fixture',name='Synthetic analyst validation',mode=mode,providers=[provider],recommendations=recommendations,headlines=[],webClaims=[dict(id='unverified-web',symbol='NVDA',description='Unverified reaction or target cannot replace licensed evidence',sourceUrl=URL,publishedAt=T-DAY,receivedAt=T,kind='market_reaction',verification='unverified',mode=mode)],instruments=instruments,portfolios=portfolios,calendar=dict(id='calendar',sourceUrl=URL,verified=True,publishedAt=T-100*DAY,receivedAt=T-100*DAY,session='regular',sessionCloses=sessions,mode=mode),prices=prices,fx=fx,ablations=[])


def study_options():
    return dict(name='Matched 500 GBP research',cutoff=T,startAt=T,registeredAt=T,benchmarkInstrumentId='benchmark',priceBasis='total-return',adjustmentVersion='fixture-v1')


class ConsensusEvidenceTests(unittest.TestCase):
    def test_unlicensed_source_and_web_commentary_cannot_populate_consensus(self):
        data=fixture();data['providers'][0]['licensed']=False
        result=consensus_summary(data,'NVDA','provider',T)
        self.assertEqual(result['status'],'unavailable');self.assertEqual(result['analystCount'],0);self.assertIsNone(result['targets']['mean'])
        self.assertEqual(freeze_consensus_case(data,T)['case']['webClaims'],[])

    def test_latest_recommendation_per_analyst_identity_is_counted_once(self):
        result=consensus_summary(fixture(),'NVDA','provider',T)
        self.assertEqual(result['analystCount'],2);self.assertEqual(result['distribution'],dict(positive=1,neutral=1,negative=0,unmapped=0));self.assertEqual(result['targets']['mean'],307.5);self.assertEqual(result['targets']['median'],307.5)
        self.assertEqual({r['id'] for r in result['rows']},{'new','other'})

    def test_receipt_and_update_times_prevent_historical_reconstruction(self):
        data=fixture();new=data['recommendations'][-1];new.update(updatedAt=T+DAY,receivedAt=T+DAY)
        before=consensus_summary(data,'NVDA','provider',T)
        self.assertEqual(before['targets']['mean'],360)
        data['providers'][0]['coverage']['receivedAt']=T
        revisions=consensus_revisions(data,'NVDA','provider',T,7)
        self.assertEqual(revisions['matchedCohort']['status'],'unavailable')
        self.assertIsNone(revisions['headlineChange']['changed'])

    def test_target_cut_is_not_a_rating_downgrade(self):
        result=consensus_revisions(fixture(),'NVDA','provider',T,7)
        self.assertEqual(result['matchedCohort']['targetLowered'],1);self.assertEqual(result['matchedCohort']['ratingDowngrades'],0)
        self.assertEqual(result['reportedEvents']['targetLowered'],1);self.assertAlmostEqual(result['reportedEvents']['targetMeanChangePct'],-.25)

    def test_mixed_target_currency_never_produces_a_mean(self):
        data=fixture();data['recommendations'][1]['targetCurrency']='GBP'
        result=consensus_summary(data,'NVDA','provider',T)
        self.assertIsNone(result['targets']['mean']);self.assertIn('currencies',result['targets']['reason'])

    def test_partial_coverage_is_not_a_complete_market_consensus(self):
        data=fixture();data['providers'][0]['coverage']['complete']=False
        result=consensus_summary(data,'NVDA','provider',T)
        self.assertEqual(result['status'],'partial');self.assertFalse(result['coverageComplete'])

    def test_synthetic_observed_modes_and_revision_identities_are_separate(self):
        data=fixture();data['prices'][0]['mode']='retrospective'
        with self.assertRaisesRegex(ValueError,'combined'):parse_consensus_case(data)
        data=fixture();data['recommendations'][-1]['analyst']='Different analyst'
        with self.assertRaisesRegex(ValueError,'identity'):parse_consensus_case(data)

    def test_ambiguous_observations_require_reconciliation(self):
        data=fixture();duplicate=copy.deepcopy(data['recommendations'][-1]);duplicate.update(id='ambiguous',supersedes=None);data['recommendations'].append(duplicate)
        with self.assertRaisesRegex(ValueError,'Ambiguous'):consensus_summary(data,'NVDA','provider',T)

    def test_unknown_fields_invalid_timestamps_and_fake_leverage_rejected(self):
        for change in [('extra',True),('version','unversioned')]:
            data=fixture();data[change[0]]=change[1]
            with self.assertRaises(ValueError):parse_consensus_case(data)
        data=fixture();data['instruments'][0]['receivedAt']=1e30
        with self.assertRaises(ValueError):parse_consensus_case(data)
        data=fixture();data['instruments'][0]['leverageFactor']=2
        with self.assertRaises(ValueError):parse_consensus_case(data)

    def test_query_credentials_and_cross_register_feature_id_collisions_rejected(self):
        for field in ('token','API_KEY','access-token','secret','authorization','password','signature'):
            data=fixture();data['providers'][0]['sourceUrl']=URL+'?'+field+'=placeholder'
            with self.assertRaisesRegex(ValueError,'Credential-free'):parse_consensus_case(data)
        data=fixture();data['providers'][0]['sourceUrl']=URL+'?symbol=NVDA&date=2026-11-03'
        self.assertEqual(parse_consensus_case(data)['providers'][0]['sourceUrl'],data['providers'][0]['sourceUrl'])
        data=fixture();data['fx'][0]['id']=data['recommendations'][0]['id']
        with self.assertRaisesRegex(ValueError,'globally unique'):parse_consensus_case(data)


class ConsensusStudyTests(unittest.TestCase):
    def test_all_plans_use_same_capital_and_four_complete_calendar_windows(self):
        study=build_consensus_study(fixture(),study_options())
        self.assertEqual(len(study['windows']),8);self.assertEqual(study['windows'][-1]['endAt'],T+60*DAY)
        self.assertEqual({p['initialCapitalGbp'] for p in study['portfolios']},{500});self.assertEqual(study['executionAuthority'],'none')

    def test_long_only_capital_and_research_approval_cannot_be_bypassed(self):
        data=fixture();data['portfolios'][0]['initialCapitalGbp']=501
        with self.assertRaisesRegex(ValueError,'500'):parse_consensus_case(data)
        data=fixture();data['instruments'][0]['researchApproved']=False
        with self.assertRaisesRegex(ValueError,'approval'):validate_consensus_portfolio(data['portfolios'][0],data)
        self.assertFalse(any(w['portfolioId']=='ai' for w in build_consensus_study(data,study_options())['windows']))

    def test_forward_registration_cannot_follow_entry_session(self):
        options=study_options();options['registeredAt']=T+1
        with self.assertRaisesRegex(ValueError,'precede'):build_consensus_study(fixture('forward'),options)

    def test_absent_calendar_keeps_future_endpoints_unresolved(self):
        data=fixture();data['calendar']=None
        self.assertTrue(all(w['endAt'] is None for w in build_consensus_study(data,study_options())['windows']))

    def test_complete_window_accounts_for_fx_all_costs_and_gross_benchmark(self):
        data=fixture();window=build_consensus_study(data,study_options())['windows'][1]
        result=evaluate_consensus_window(data,window,T+5*DAY+1000)
        self.assertEqual(result['status'],'complete');r=result['result']
        gross_growth=((1.002**5+1.001**5+.999**5)/3)*(.8005/.8)
        expected=498*gross_growth*__import__('math').exp(-.01*5/365.25)
        self.assertAlmostEqual(r['endingCapitalGbp'],expected);self.assertAlmostEqual(r['grossReturn'],gross_growth-1)
        self.assertEqual(r['deployedCapitalGbp'],498);self.assertEqual(r['initialCapitalGbp'],500)
        self.assertAlmostEqual(r['benchmarkReturn'],1.0008**5*.8005/.8-1);self.assertAlmostEqual(r['benchmarkRelativeReturn'],r['netReturn']-r['benchmarkReturn'])
        self.assertLess(r['netReturn'],r['grossReturn']);self.assertLessEqual(r['maxDrawdown'],-.004)
        self.assertEqual(r['executionAuthority'],'none')

    def test_future_or_not_yet_received_window_stays_pending(self):
        data=fixture();window=build_consensus_study(data,study_options())['windows'][0]
        self.assertEqual(evaluate_consensus_window(data,window,T+DAY-1)['status'],'pending')
        self.assertEqual(evaluate_consensus_window(data,window,T+DAY)['status'],'pending')
        self.assertEqual(evaluate_consensus_window(data,window,T+DAY+1000)['status'],'complete')

    def test_missing_intermediate_price_or_fx_blocks_full_window(self):
        data=fixture();window=build_consensus_study(data,study_options())['windows'][1]
        data['prices']=[p for p in data['prices'] if p['id']!='aapl-2']
        self.assertIsNone(evaluate_consensus_window(data,window,T+5*DAY+1000)['result'])
        data=fixture();data['fx']=[f for f in data['fx'] if f['eventAt']!=T+2*DAY]
        self.assertIn('same-session',evaluate_consensus_window(data,window,T+5*DAY+1000)['reason'])

    def test_unknown_costs_cash_assumption_and_unlicensed_prices_stay_pending(self):
        data=fixture();data['portfolios'][0]['annualFeesBps']=None
        window=build_consensus_study(data,study_options())['windows'][0]
        self.assertIn('costs',evaluate_consensus_window(data,window,T+DAY+1000)['reason'])
        data=fixture();data['portfolios'][1]['cashAnnualRate']=None
        window=build_consensus_study(data,study_options())['windows'][4]
        self.assertIn('cash',evaluate_consensus_window(data,window,T+DAY+1000)['reason'])
        data=fixture();window=build_consensus_study(data,study_options())['windows'][0];data['prices'][0]['licensed']=False
        self.assertEqual(evaluate_consensus_window(data,window,T+DAY+1000)['status'],'pending')

    def test_adjustment_provider_or_fx_basis_changes_are_rejected(self):
        for field,value in [('adjustmentVersion','other'),('provider','Other provider'),('corporateActionsReviewed',False)]:
            data=fixture();window=build_consensus_study(data,study_options())['windows'][0]
            next(p for p in data['prices'] if p['id']=='nvda-1')[field]=value
            self.assertEqual(evaluate_consensus_window(data,window,T+DAY+1000)['status'],'pending')
        data=fixture();window=build_consensus_study(data,study_options())['windows'][0];data['fx'][1]['conversionVersion']='incompatible'
        self.assertIn('conversion',evaluate_consensus_window(data,window,T+DAY+1000)['reason'])

    def test_registered_portfolio_costs_are_immutable_when_current_case_changes(self):
        data=fixture();window=build_consensus_study(data,study_options())['windows'][0]
        data['portfolios'][0]['entryCostsGbp']=200
        result=evaluate_consensus_window(data,window,T+DAY+1000)['result']
        self.assertEqual(result['entryCostsGbp'],1);self.assertEqual(result['deployedCapitalGbp'],498)

    def test_context_is_shared_baseline_and_late_web_text_never_enters_arms(self):
        data=fixture();data['contextRecords']=[dict(id='financials',symbol='NVDA',kind='fundamentals',sourceUrl=URL,publishedAt=T-1000,publicationDate=None,receivedAt=T-1000,recordJson=json.dumps({'revenueMillions':96221,'period':'Q2'}),mode='synthetic')]
        study=build_consensus_study(data,study_options())
        self.assertTrue(all('financials' in arm['inputIds'] for arm in study['arms']))
        self.assertFalse(any('unverified-web' in arm['inputIds'] for arm in study['arms']))
        self.assertTrue(set(study['arms'][1]['inputIds']).issubset(study['arms'][2]['inputIds']))
        data['contextRecords'][0]['receivedAt']=T+1
        self.assertFalse(any('financials' in arm['inputIds'] for arm in build_consensus_study(data,study_options())['arms']))

    def test_entry_fx_is_shared_by_every_ablation_arm_when_eligible(self):
        options=study_options();options['cutoff']=T+1000;options['registeredAt']=T+1000
        study=build_consensus_study(fixture(),options)
        self.assertTrue(all('fx-0' in arm['inputIds'] for arm in study['arms']))
        self.assertFalse(any('fx-1' in arm['inputIds'] for arm in study['arms']))

    def test_same_request_reproduces_same_report_without_execution_authority(self):
        request=dict(version=VERSION,case=fixture(),studyOptions=study_options(),asOf=T+60*DAY+1000)
        first=evaluate(request);second=evaluate(copy.deepcopy(request))
        self.assertEqual(first,second);self.assertEqual(len(first['outcomes']),8);self.assertEqual(first['executionAuthority'],'none')


def ablation_rows(count=30):
    return [dict(id=f'ablation-{n}',holdoutId=f'holdout-{n}',symbol='NVDA',horizonSessions=5,benchmarkInstrumentId='benchmark',priceBasis='total-return',currency='GBP',targetDefinition='Five-session net benchmark-relative return',protocolRegisteredAt=T-90*DAY,trainingEndAt=T-100*DAY,evidenceCutoff=T-20*DAY+n*1000,submittedAt=T-19*DAY+n*1000,startAt=T-18*DAY+n*1000,endAt=T-11*DAY+n*1000,outcomeReceivedAt=T-10*DAY+n*1000,mode='forward',baselineInputId=f'base-{n}',modelProtocolId='same-predeclared-protocol',predictions=dict(pricesFundamentals=.01,plusConsensusLabel=.02,plusAnalystRevisions=.03),relativeOutcome=.03,outcomeSourceUrl=URL,missingInputPolicy='explicit_abstention',missingInputs=[],outcomeVerified=True) for n in range(count)]


class ConsensusAblationTests(unittest.TestCase):
    def test_no_forward_holdouts_means_no_incremental_value_claim(self):
        result=consensus_ablation_report(fixture(),T)
        self.assertEqual(result['status'],'insufficient_evidence');self.assertIsNone(result['revisionsMseImprovement'])

    def test_complete_compatible_paired_holdouts_produce_descriptive_errors_only(self):
        data=fixture('forward');data['ablations']=ablation_rows()
        result=consensus_ablation_report(data,T)
        self.assertEqual(result['status'],'descriptive_out_of_sample_only');self.assertAlmostEqual(result['baselineMse'],.0004)
        self.assertAlmostEqual(result['plusLabelMse'],.0001);self.assertAlmostEqual(result['plusRevisionsMse'],0)
        self.assertAlmostEqual(result['revisionsIncrementalMseImprovement'],.0001)
        self.assertIn('do not establish',result['conclusion']);self.assertEqual(result['executionAuthority'],'none')

    def test_missing_unverified_pending_and_mixed_horizon_holdouts_cannot_score(self):
        for amend in [('outcomeVerified',False),('missingInputs',['consensus']),('outcomeReceivedAt',T+DAY),('horizonSessions',20),('modelProtocolId','changed-protocol')]:
            data=fixture('forward');data['ablations']=ablation_rows();data['ablations'][0][amend[0]]=amend[1]
            result=consensus_ablation_report(data,T)
            self.assertEqual(result['status'],'insufficient_evidence');self.assertIsNone(result['baselineMse'])

    def test_duplicate_holdouts_and_lookahead_are_rejected(self):
        data=fixture('forward');data['ablations']=ablation_rows();data['ablations'][1]['holdoutId']=data['ablations'][0]['holdoutId']
        with self.assertRaisesRegex(ValueError,'twice'):consensus_ablation_report(data,T)
        data=fixture('forward');data['ablations']=ablation_rows();data['ablations'][0]['protocolRegisteredAt']=T
        with self.assertRaisesRegex(ValueError,'look-ahead'):parse_consensus_case(data)

    def test_score_overflow_does_not_publish_infinite_accuracy(self):
        data=fixture('forward');data['ablations']=ablation_rows();data['ablations'][0]['predictions']['pricesFundamentals']=1e300
        result=consensus_ablation_report(data,T)
        self.assertEqual(result['status'],'insufficient_evidence');self.assertIsNone(result['baselineMse'])


if __name__=='__main__':unittest.main()
