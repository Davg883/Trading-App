import copy
import json
import math
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from worker.portfolio_defence import (VERSION, sample_statistics, maximum_drawdown,
                                      derivative_payoff, daily_inverse, parse_defence_case,
                                      freeze_defence_case, portfolio_exposure, compare_defence_portfolios,
                                      defence_history_analytics, option_research_payoff, daily_inverse_research, evaluate)


def instrument(identity, product='equity', ai=True):
    return {'id': identity, 'name': f'Synthetic {identity}', 'symbol': f'TEST-{identity}', 'isin': None,
            'currency': 'GBP', 'company': identity, 'sector': 'Technology' if ai else 'Cash', 'country': 'GB',
            'aiLayer': 'Compute' if ai else 'Cash', 'aiRelated': ai, 'product': product,
            'paperEligible': product not in ('protective_put', 'collar', 'inverse'), 'availability': 'Demonstration only',
            'structure': 'Synthetic research specification', 'annualFeeBps': None, 'sourceIds': ['source'],
            'restrictions': ['No execution'], 'risks': ['Illustrative'], 'protectsAgainst': ['Scenario only'],
            'cannotProtectAgainst': ['Unspecified risks'], 'lossConditions': ['Unfavourable shocks']}


def portfolio(identity, allocations, costs=0):
    return {'id': identity, 'name': identity, 'initialCapital': 10000, 'currency': 'GBP', 'horizonSessions': 60,
            'priceBasis': 'total-return', 'calendarId': 'synthetic-calendar', 'session': 'regular', 'mode': 'synthetic',
            'allocations': [{'instrumentId': key, 'weight': weight} for key, weight in allocations],
            'costs': {'fees': costs, 'slippage': 0, 'financing': 0}}


def history(identity, twice=False):
    sessions = [1000 * (index + 1) for index in range(61)]
    price = 100; observations = []
    for index, at in enumerate(sessions):
        if index: price *= 1 + ((.01 if index % 2 else -.01) * (2 if twice else 1))
        observations.append({'eventAt': at, 'publishedAt': at + 1, 'receivedAt': at + 2, 'close': price, 'sourceId': 'source'})
    return {'id': f'history-{identity}', 'instrumentId': identity, 'provider': 'Synthetic fixture', 'currency': 'GBP',
            'priceBasis': 'total-return', 'adjustmentVersion': 'fixture-v1', 'calendarId': 'synthetic-calendar',
            'session': 'regular', 'mode': 'synthetic', 'corporateActionsReviewed': True, 'sessionsPerYear': 252,
            'calendarVerified': True, 'calendarSessions': sessions, 'observations': observations}


def fixture():
    return {'version': VERSION, 'id': 'synthetic-case', 'name': 'Synthetic defence case', 'mode': 'synthetic',
            'sources': [{'id': 'source', 'title': 'Synthetic data', 'url': 'https://example.test/defence',
                         'publishedAt': 1, 'receivedAt': 2, 'mode': 'synthetic', 'verified': True, 'role': 'evidence'}],
            'instruments': [instrument('a'), instrument('b'), instrument('cash', 'cash', False), instrument('fund', 'etf', None)],
            'funds': [{'id': 'fund-r1', 'instrumentId': 'fund', 'asOf': 10, 'publishedAt': 11, 'receivedAt': 12,
                       'verified': True, 'mode': 'synthetic', 'sourceIds': ['source'],
                       'constituents': [{'instrumentId': 'a', 'weight': .6}, {'instrumentId': 'cash', 'weight': .4}]}],
            'portfolios': [portfolio('baseline', [('fund', .5), ('a', .5)]), portfolio('alternative', [('a', .5), ('cash', .5)], costs=100)],
            'scenarios': [{'id': 'correction', 'name': 'Synthetic correction', 'category': 'ai_correction', 'kind': 'user_defined',
                           'mode': 'synthetic', 'publishedAt': 3, 'receivedAt': 4, 'sourceIds': ['source'], 'startAt': 1000,
                           'endAt': 61000, 'horizonSessions': 60, 'calendarId': 'synthetic-calendar', 'currency': 'GBP',
                           'priceBasis': 'total-return', 'session': 'regular',
                           'returns': [{'instrumentId': 'fund', 'return': -.2}, {'instrumentId': 'a', 'return': -.4}, {'instrumentId': 'cash', 'return': 0}]}],
            'histories': [history('a', twice=True), history('b')]}


def request():
    return {'version': VERSION, 'case': fixture(), 'cutoff': 100000, 'baselineId': 'baseline', 'alternativeId': 'alternative',
            'scenarioId': 'correction', 'instrumentId': 'a', 'benchmarkId': 'b'}


class PortfolioDefenceMathTests(unittest.TestCase):
    def test_aligned_history_and_minimum_samples_are_required(self):
        self.assertIsNone(sample_statistics([.01] * 29, [.02] * 29)['correlation'])
        with self.assertRaisesRegex(ValueError, 'Aligned'):
            sample_statistics([.01] * 60, [.02] * 59)
        with self.assertRaises(ValueError):
            sample_statistics([.01] * 60, [.02] * 60, minimum_samples=2)

    def test_beta_volatility_and_correlation_have_known_values(self):
        benchmark = [.01, -.01] * 30
        result = sample_statistics([2 * value for value in benchmark], benchmark)
        self.assertAlmostEqual(result['correlation'], 1)
        self.assertAlmostEqual(result['beta'], 2)
        self.assertAlmostEqual(result['annualizedVolatility'], math.sqrt(.0004 * 60 / 59 * 252))
        self.assertFalse(result['covarianceReliable'])
        self.assertIsNone(sample_statistics([0] * 60, [0] * 60)['correlation'])

    def test_drawdown_uses_prior_peak_and_does_not_equal_terminal_return(self):
        result = maximum_drawdown([100, 120, 90, 110])
        self.assertAlmostEqual(result['value'], -.25)
        self.assertIsNone(maximum_drawdown([100])['value'])

    def put(self, **changes):
        spec = {'type': 'protective_put', 'expiry': 1000, 'putStrike': 95, 'callStrike': None,
                'putPremium': 3, 'callPremium': 0, 'multiplier': 100, 'contracts': 2,
                'underlyingShares': 200, 'currency': 'USD', 'priceBasis': 'split-adjusted'}
        spec.update(changes)
        return spec

    def settlement(self, **changes):
        observation = {'at': 1000, 'price': 70, 'currency': 'USD', 'priceBasis': 'split-adjusted'}
        observation.update(changes)
        return observation

    def test_protective_put_prices_premium_contract_units_and_exact_expiry(self):
        result = derivative_payoff(self.put(), self.settlement())
        self.assertEqual(result['grossPayoff'], 5000)
        self.assertEqual(result['premiumCost'], 600)
        self.assertEqual(result['netPayoff'], 4400)
        self.assertIsNone(derivative_payoff(self.put(), self.settlement(at=999))['netPayoff'])
        self.assertIsNone(derivative_payoff(self.put(), self.settlement(at=1001))['netPayoff'])

    def test_collar_caps_upside_and_cannot_be_uncovered(self):
        spec = self.put(type='collar', callStrike=110, callPremium=2)
        result = derivative_payoff(spec, self.settlement(price=130))
        self.assertEqual(result['grossPayoff'], -4000)
        self.assertEqual(result['netPayoff'], -4200)
        with self.assertRaisesRegex(ValueError, 'covered'):
            derivative_payoff(self.put(underlyingShares=100), self.settlement())
        with self.assertRaisesRegex(ValueError, 'currency'):
            derivative_payoff(spec, self.settlement(currency='GBP'))

    def test_daily_inverse_is_path_dependent_and_charges_declared_fees(self):
        # Index returns to its starting value, but daily -1x loses 1.818...%.
        path = [.1, -1 / 11]
        result = daily_inverse(path)
        self.assertAlmostEqual(result['value'], -.018181818181818188)
        self.assertNotAlmostEqual(result['value'], -((1 + path[0]) * (1 + path[1]) - 1))
        self.assertLess(daily_inverse(path, annual_fee_bps=50)['value'], result['value'])
        self.assertIsNone(daily_inverse([])['value'])
        self.assertTrue(result['researchOnly'])

    def test_nonfinite_values_never_become_financial_statistics(self):
        with self.assertRaises(ValueError):
            maximum_drawdown([100, float('nan')])
        with self.assertRaises(ValueError):
            daily_inverse([float('inf')])


class PortfolioDefenceCaseTests(unittest.TestCase):
    def test_fund_lookthrough_replaces_wrapper_and_combines_direct_exposure(self):
        exposure = portfolio_exposure(fixture(), 'baseline', 100000)
        self.assertAlmostEqual(exposure['aiWeight'], .8)
        self.assertAlmostEqual(exposure['dimensions']['company']['a'], .8)
        self.assertNotIn('fund', exposure['dimensions']['company'])
        self.assertAlmostEqual(sum(row['weight'] for row in exposure['leaves']), 1)
        self.assertAlmostEqual(exposure['companyHhi'], .8 ** 2 + .2 ** 2)

    def test_undisclosed_and_stale_global_fund_exposure_is_unresolved(self):
        case = fixture(); case['funds'][0]['constituents'].pop()
        exposure = portfolio_exposure(case, 'baseline', 100000)
        self.assertAlmostEqual(exposure['unknownAiWeight'], .2)
        self.assertFalse(exposure['hhiComplete'])
        stale = portfolio_exposure(fixture(), 'baseline', 100 * 86400000)
        self.assertAlmostEqual(stale['unknownAiWeight'], .5)
        self.assertAlmostEqual(stale['aiWeight'], .5)

    def test_nested_funds_cannot_create_cycles_or_overallocated_capital(self):
        case = fixture(); case['funds'][0]['constituents'] = [{'instrumentId': 'fund', 'weight': 1}]
        with self.assertRaisesRegex(ValueError, 'Cyclic'):
            parse_defence_case(case)
        case = fixture(); case['funds'][0]['constituents'][0]['weight'] = .8
        with self.assertRaises(ValueError): parse_defence_case(case)

    def test_costs_are_reserved_and_gross_and_net_protection_are_separate(self):
        result = compare_defence_portfolios(fixture(), 'baseline', 'alternative', 'correction', 100000)
        self.assertAlmostEqual(result['baseline']['netPnl'], -3000)
        self.assertAlmostEqual(result['alternative']['deployedCapital'], 9900)
        self.assertAlmostEqual(result['alternative']['grossPnl'], -1980)
        self.assertAlmostEqual(result['alternative']['netPnl'], -2080)
        self.assertAlmostEqual(result['grossProtection'], 1020)
        self.assertAlmostEqual(result['netProtection'], 920)
        self.assertIsNone(result['reboundParticipation'])
        case = fixture(); case['portfolios'][1]['initialCapital'] = 12000
        with self.assertRaisesRegex(ValueError, 'identical initial capital'):
            compare_defence_portfolios(case, 'baseline', 'alternative', 'correction', 100000)

    def test_recovery_participation_has_a_positive_benchmark_denominator(self):
        case = fixture()
        case['scenarios'][0]['returns'] = [{'instrumentId': 'fund', 'return': .2}, {'instrumentId': 'a', 'return': .4}, {'instrumentId': 'cash', 'return': 0}]
        result = compare_defence_portfolios(case, 'baseline', 'alternative', 'correction', 100000)
        self.assertAlmostEqual(result['reboundParticipation'], .188 / .3)

    def test_late_receipts_and_outcome_sources_cannot_enter_an_earlier_forecast(self):
        case = fixture(); case['funds'][0]['receivedAt'] = 100001
        snapshot = freeze_defence_case(case, 100000)
        self.assertEqual(snapshot['case']['funds'], [])
        self.assertAlmostEqual(portfolio_exposure(case, 'baseline', 100000)['unknownAiWeight'], .5)
        case = fixture(); case['sources'][0]['role'] = 'outcome'
        snapshot = freeze_defence_case(case, 100000)
        self.assertEqual(snapshot['case']['instruments'], [])
        self.assertEqual(snapshot['executionAuthority'], 'none')

    def test_synthetic_evidence_cannot_be_mixed_with_observed_historical_records(self):
        case = fixture(); case['histories'][0]['mode'] = 'historical'
        with self.assertRaisesRegex(ValueError, 'cannot be combined'):
            parse_defence_case(case)

    def test_analytics_reject_missing_sessions_different_basis_and_late_prices(self):
        case = fixture(); case['histories'][1]['observations'].pop(20)
        self.assertIsNone(defence_history_analytics(case, 'a', 'b', 100000)['correlation'])
        case = fixture(); case['histories'][1]['adjustmentVersion'] = 'incompatible'
        result = defence_history_analytics(case, 'a', 'b', 100000)
        self.assertIsNone(result['beta']); self.assertIn('aligned', result['reason'])
        case = fixture(); case['histories'][0]['observations'][40]['receivedAt'] = 100001
        self.assertIsNone(defence_history_analytics(case, 'a', 'b', 100000)['annualVolatility'])

    def test_case_statistics_and_rolling_windows_reproduce_known_beta(self):
        result = defence_history_analytics(fixture(), 'a', 'b', 100000)
        self.assertEqual(result['samples'], 60)
        self.assertAlmostEqual(result['beta'], 2)
        self.assertAlmostEqual(result['correlation'], 1)
        self.assertEqual(len(result['rolling']), 1)
        self.assertFalse(result['reliable'])
        # Cutoff between closes selects the last completed registered session.
        self.assertEqual(defence_history_analytics(fixture(), 'a', 'b', 61777)['samples'], 60)

    def test_currency_and_fund_revision_ambiguity_are_rejected(self):
        case = fixture(); case['histories'][0]['currency'] = 'USD'
        with self.assertRaisesRegex(ValueError, 'currency'):
            parse_defence_case(case)
        case = fixture(); duplicate = copy.deepcopy(case['funds'][0]); duplicate['id'] = 'another-id'
        case['funds'].append(duplicate)
        with self.assertRaisesRegex(ValueError, 'Ambiguous'):
            parse_defence_case(case)

    def test_timestamps_are_integer_milliseconds_within_the_displayable_date_range(self):
        for invalid in (1.5, 8640000000000001):
            case = fixture(); case['sources'][0]['publishedAt'] = invalid
            with self.assertRaises(ValueError): parse_defence_case(case)
            with self.assertRaises(ValueError): freeze_defence_case(fixture(), invalid)
            case = fixture(); case['histories'][0]['calendarSessions'][0] = invalid
            with self.assertRaises(ValueError): parse_defence_case(case)
        option = {'kind': 'protective_put', 'underlyingStart': 100, 'underlyingEnd': 70, 'shares': 100,
                  'contracts': 1, 'multiplier': 100, 'putStrike': 95, 'putPremium': 3, 'callStrike': None,
                  'callPremium': 0, 'expiryAt': 1000.5, 'settlementAt': 1000.5, 'asOf': 1001,
                  'currency': 'GBP', 'premiumCurrency': 'GBP', 'fees': 0}
        with self.assertRaises(ValueError): option_research_payoff(option)

    def test_historical_scenario_shocks_must_match_actual_registered_sessions(self):
        case = fixture(); case['mode'] = 'historical'
        for collection in ('sources', 'funds', 'portfolios', 'scenarios', 'histories'):
            for row in case[collection]: row['mode'] = 'historical'
        scenario = case['scenarios'][0]; scenario.update(kind='historical', publishedAt=62000, receivedAt=62001)
        # A deliberately invented market drop does not become a historical result.
        with self.assertRaisesRegex(ValueError, 'price history'):
            compare_defence_portfolios(case, 'baseline', 'alternative', 'correction', 100000)

    def test_completed_historical_scenario_reproduces_sourced_window_returns(self):
        case = fixture(); case['mode'] = 'historical'
        case['portfolios'][0]['allocations'] = [{'instrumentId': 'a', 'weight': 1}]
        case['portfolios'][1]['allocations'] = [{'instrumentId': 'cash', 'weight': 1}]
        cash = history('cash')
        for row in cash['observations']: row['close'] = 100
        case['histories'].append(cash)
        for collection in ('sources', 'funds', 'portfolios', 'scenarios', 'histories'):
            for row in case[collection]: row['mode'] = 'historical'
        actual = case['histories'][0]['observations'][-1]['close'] / 100 - 1
        scenario = case['scenarios'][0]; scenario.update(kind='historical', publishedAt=62000, receivedAt=62001,
            returns=[{'instrumentId': 'a', 'return': actual}, {'instrumentId': 'cash', 'return': 0}])
        result = compare_defence_portfolios(case, 'baseline', 'alternative', 'correction', 100000)
        self.assertAlmostEqual(result['baseline']['grossReturn'], actual)
        scenario['returns'][0]['return'] = -.9
        with self.assertRaisesRegex(ValueError, 'differs from eligible sourced prices'):
            compare_defence_portfolios(case, 'baseline', 'alternative', 'correction', 100000)

    def test_complex_products_are_research_only_and_not_static_shock_positions(self):
        case = fixture(); case['instruments'][0].update(product='inverse', paperEligible=False)
        with self.assertRaisesRegex(ValueError, 'separate contract'):
            compare_defence_portfolios(case, 'baseline', 'alternative', 'correction', 100000)
        case['instruments'][0]['paperEligible'] = True
        with self.assertRaisesRegex(ValueError, 'research only'):
            parse_defence_case(case)

    def test_shared_option_contract_includes_underlying_losses_and_premium(self):
        spec = {'kind': 'protective_put', 'underlyingStart': 100, 'underlyingEnd': 70, 'shares': 100,
                'contracts': 1, 'multiplier': 100, 'putStrike': 95, 'putPremium': 3, 'callStrike': None, 'callPremium': 0,
                'expiryAt': 1000, 'settlementAt': 1000, 'asOf': 1000, 'currency': 'GBP', 'premiumCurrency': 'GBP', 'fees': 5}
        result = option_research_payoff(spec)
        self.assertEqual(result['underlyingPnl'], -3000)
        self.assertEqual(result['grossPnl'], -500)
        self.assertEqual(result['netPnl'], -805)
        spec['asOf'] = 999
        self.assertEqual(option_research_payoff(spec)['status'], 'pending')

    def test_shared_inverse_contract_uses_multiplicative_fee_convention(self):
        result = daily_inverse_research([.1, -1/11], 252)
        self.assertAlmostEqual(result['grossReturn'], -.018181818181818188)
        self.assertAlmostEqual(result['netReturn'], .9 * (1 + 1/11) * .9999 ** 2 - 1)

    def test_cli_is_reproducible_and_will_not_overwrite_a_saved_report(self):
        payload = request()
        self.assertEqual(evaluate(payload), evaluate(copy.deepcopy(payload)))
        with tempfile.TemporaryDirectory() as directory:
            input_path = Path(directory, 'request.json'); output_path = Path(directory, 'report.json')
            input_path.write_text(json.dumps(payload), encoding='utf-8')
            args = [sys.executable, '-m', 'worker.portfolio_defence', str(input_path), '--output', str(output_path)]
            first = subprocess.run(args, capture_output=True, text=True)
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertEqual(json.loads(output_path.read_text())['comparison'], evaluate(payload)['comparison'])
            self.assertNotEqual(subprocess.run(args, capture_output=True).returncode, 0)


if __name__ == '__main__':
    unittest.main()
