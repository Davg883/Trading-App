import copy
import json
from pathlib import Path
import unittest

from worker.amazon_cash_conversion import parse_amazon_case, freeze_amazon_case, amazon_cash_kpis, build_amazon_interpretation, publication_bound, evaluate, VERSION


def fixture():
    return json.loads((Path(__file__).resolve().parents[1] / 'data' / 'earnings' / 'amazon-q3-2026-cash.json').read_text(encoding='utf-8-sig'))


def cutoff(data):
    return max([s['receivedAt'] for s in data['sources']] + [o['receivedAt'] for o in data['observations']] + [o['receivedAt'] for o in data['bedrock']])


class AmazonCashConversionTests(unittest.TestCase):
    def test_official_cash_and_margin_reconciliation(self):
        data = fixture(); k = amazon_cash_kpis(data, '2026-Q3', cutoff(data))
        self.assertEqual(k['quarterly']['companyRevenue']['value'], 201944)
        self.assertEqual(k['quarterly']['companyOperatingIncome']['value'], 28076)
        self.assertEqual(k['quarterly']['companyNetIncome']['value'], 20685)
        self.assertAlmostEqual(k['quarterly']['awsOperatingMargin']['value'], 17773 / 45984)
        self.assertAlmostEqual(k['quarterly']['companyOperatingMargin']['value'], 28076 / 201944)
        self.assertEqual(k['ttm']['operatingCashFlow']['value'], 168300)
        self.assertEqual(k['ttm']['netCapex']['value'], 210657)
        self.assertEqual(k['ttm']['freeCashFlow']['value'], -42357)
        self.assertEqual(k['ttm']['cashBridgeResidual']['value'], 0)
        self.assertAlmostEqual(k['ttm']['capexCoverage']['value'], 168300 / 210657)

    def test_quarterly_net_is_derived_from_gross_and_proceeds(self):
        data = fixture(); k = amazon_cash_kpis(data, '2026-Q3', cutoff(data))
        self.assertEqual(k['quarterly']['grossCapex']['value'], 77259)
        self.assertEqual(k['quarterly']['capexProceeds']['value'], 1381)
        self.assertEqual(k['quarterly']['netCapex']['value'], 75878)
        self.assertEqual(k['quarterly']['freeCashFlow']['value'], -33456)
        self.assertEqual(k['quarterly']['cashBridgeResidual']['value'], 0)
        self.assertEqual(k['articleDiscrepancy']['officialGrossMillions'], 77259)
        self.assertFalse(k['articleDiscrepancy']['articleVerified'])

    def test_matching_ttm_revenue_required_for_fcf_margin(self):
        data = fixture(); now = cutoff(data); k = amazon_cash_kpis(data, '2026-Q3', now)
        self.assertAlmostEqual(k['ttm']['freeCashFlowMargin']['value'], -42357 / k['ttm']['revenue']['value'])
        data['observations'] = [o for o in data['observations'] if not (o['metric'] == 'revenue' and o['period']['label'] == 'TTM-2026-Q3' and o['scope'] == 'company')]
        self.assertIsNone(amazon_cash_kpis(data, '2026-Q3', now)['ttm']['freeCashFlowMargin']['value'])

    def test_comparable_cash_deterioration_and_capex_growth(self):
        data = fixture(); k = amazon_cash_kpis(data, '2026-Q3', cutoff(data))
        self.assertEqual(k['changes']['freeCashFlowDeltaYoy']['value'], -57145)
        self.assertAlmostEqual(k['changes']['freeCashFlowChangeYoy']['value'], -42357 / 14788 - 1)
        self.assertAlmostEqual(k['changes']['netCapexGrowthYoy']['value'], 210657 / 115903 - 1)

    def test_percentage_change_undefined_for_nonpositive_prior_fcf(self):
        data = fixture()
        next(o for o in data['observations'] if o['metric'] == 'free_cash_flow' and o['period']['label'] == 'TTM-2025-Q3')['value'] = -1
        self.assertIsNone(amazon_cash_kpis(data, '2026-Q3', cutoff(data))['changes']['freeCashFlowChangeYoy']['value'])

    def test_guidance_is_never_a_reported_value(self):
        data = fixture(); k = amazon_cash_kpis(data, '2026-Q3', cutoff(data))
        guidance = next(o for o in k['management'] if o['metric'] == 'cash_capex_guidance')
        self.assertEqual(guidance['value'], 220000)
        self.assertEqual(guidance['kind'], 'guidance')
        guidance['kind'] = 'reported'
        index = next(i for i, o in enumerate(data['observations']) if o['id'] == guidance['id']); data['observations'][index] = guidance
        with self.assertRaises(ValueError): parse_amazon_case(data)

    def test_future_aws_expectations_do_not_become_outcomes(self):
        data = fixture(); forecasts = [o for o in data['observations'] if o['metric'] == 'aws_growth_forecast']
        self.assertEqual({o['period']['label'] for o in forecasts}, {'2027', '2028'})
        self.assertTrue(all(o['kind'] == 'management_expectation' and o['qualifier'] == 'greater_than' for o in forecasts))
        forecasts[0]['kind'] = 'reported'
        with self.assertRaises(ValueError): parse_amazon_case(data)

    def test_bedrock_populations_and_units_not_comparable(self):
        data = fixture(); k = amazon_cash_kpis(data, '2026-Q3', cutoff(data))
        self.assertFalse(k['bedrockComparison']['comparable'])
        self.assertEqual({b['multiple'] for b in k['bedrock']}, {7, 17})
        self.assertNotEqual(k['bedrock'][0]['population'], k['bedrock'][1]['population'])

    def test_ai_roi_stays_null(self):
        data = fixture()
        self.assertIsNone(amazon_cash_kpis(data, '2026-Q3', cutoff(data))['aiSpecificRoi']['value'])

    def test_late_receipts_do_not_leak_into_release_date(self):
        data = fixture(); release = data['sources'][0]['publishedAt']
        frozen = freeze_amazon_case(data, release + 1000)
        self.assertEqual(frozen['case']['observations'], [])
        self.assertIsNone(amazon_cash_kpis(data, '2026-Q3', release + 1000)['ttm']['freeCashFlow']['value'])

    def test_unverified_article_annotation_never_enters_model_evidence(self):
        data = fixture(); now = cutoff(data)
        self.assertIsNone(freeze_amazon_case(data, now)['case']['articleClaim'])
        self.assertIsNone(build_amazon_interpretation(data, '2026-Q3', now)['evidence']['articleClaim'])
        self.assertIsNone(amazon_cash_kpis(data, '2026-Q3', 0)['articleDiscrepancy']['claimedNetMillions'])

    def test_date_only_publication_remains_a_bound_and_proxy_is_labelled(self):
        data = fixture(); ir = next(s for s in data['sources'] if s['publicationBasis'] == 'date_only')
        self.assertIsNone(ir['publishedAt'])
        self.assertEqual(publication_bound(ir), 1793347199999)
        frozen = freeze_amazon_case(data, cutoff(data))
        self.assertEqual({b['precision'] for b in frozen['publicationBounds']}, {'sec_acceptance_proxy', 'conservative_date_bound'})

    def test_invalid_periods_and_definitions_rejected(self):
        data = fixture(); data['observations'][0]['period']['start'] = '2025-01-01'
        with self.assertRaises(ValueError): parse_amazon_case(data)
        data = fixture(); data['observations'][0]['currency'] = 'GBP'
        with self.assertRaises(ValueError): parse_amazon_case(data)

    def test_derived_cash_requires_exact_valid_compatible_inputs(self):
        for change in ('missing', 'formula', 'period', 'late'):
            data = fixture(); derived = next(o for o in data['observations'] if o['kind'] == 'derived')
            if change == 'missing': derived['inputIds'] = ['missing', 'missing-again']
            if change == 'formula': derived['value'] += 1
            if change == 'period': next(o for o in data['observations'] if o['id'] == derived['inputIds'][0])['scope'] = 'AWS'
            if change == 'late': next(o for o in data['observations'] if o['id'] == derived['inputIds'][0])['receivedAt'] += 1
            with self.assertRaises(ValueError): parse_amazon_case(data)

    def test_new_revision_does_not_replace_old_observation_before_receipt(self):
        data = fixture(); now = cutoff(data); old = next(o for o in data['observations'] if o['metric'] == 'net_income' and o['period']['label'] == '2026-Q3')
        data['observations'].append({**copy.deepcopy(old), 'id': 'new-income-revision', 'value': old['value'] + 1, 'receivedAt': now + 1000, 'supersedes': old['id']})
        self.assertEqual(amazon_cash_kpis(data, '2026-Q3', now)['quarterly']['companyNetIncome']['value'], 20685)
        self.assertEqual(amazon_cash_kpis(data, '2026-Q3', now + 1000)['quarterly']['companyNetIncome']['value'], 20686)

    def test_superseded_input_invalidates_old_derived_cash(self):
        data = fixture(); now = cutoff(data); old = next(o for o in data['observations'] if o['metric'] == 'gross_capex' and o['period']['label'] == '2026-Q3')
        data['observations'].append({**copy.deepcopy(old), 'id': 'new-gross-capex', 'value': old['value'] + 1, 'receivedAt': now + 1000, 'supersedes': old['id']})
        self.assertIsNone(amazon_cash_kpis(data, '2026-Q3', now + 1000)['quarterly']['netCapex']['value'])

    def test_model_comparison_is_pending_and_retrospective(self):
        data = fixture(); result = build_amazon_interpretation(data, '2026-Q3', cutoff(data))
        self.assertEqual(result['mode'], 'retrospective')
        self.assertEqual(len(result['models']), 2)
        self.assertTrue(all(m['status'] == 'pending' and m['result'] is None and m['cost'] is None for m in result['models']))
        self.assertEqual(result['baseline']['status'], 'complete')
        self.assertIsNone(result['baseline']['marketForecast'])
        self.assertEqual(result['forwardExperiment']['status'], 'not_registered')
        self.assertEqual(result['executionAuthority'], 'none')

    def test_worker_reproduces_versioned_same_source_case(self):
        data = fixture(); request = {'version': VERSION, 'case': data, 'cutoff': cutoff(data), 'quarter': '2026-Q3'}
        self.assertEqual(evaluate(request), evaluate(request))
        self.assertNotIn('quotes', evaluate(request))


if __name__ == '__main__':
    unittest.main()
