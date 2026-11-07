import copy
import json
from pathlib import Path
import unittest

from worker.policy_risk import parse_observation_set, merge_policy_observations, parse_policy_case, freeze_policy_case, classify_policy_event, policy_assessment, register_policy_experiment, evaluate_policy_study, evaluate

REQUEST = json.loads((Path(__file__).resolve().parents[1] / 'data/policy-risk/midterm-2026-11-03-request.json').read_text(encoding='utf8'))


def data():
    return copy.deepcopy(REQUEST['case'])


def classes(case=None):
    return {k['eventId']: k for k in policy_assessment(case or data(), REQUEST['cutoff'])['policy']['classifications']}


class PolicyRiskTests(unittest.TestCase):
    def test_election_and_campaign_signals_are_never_enacted_restrictions(self):
        k = classes()
        for event in ('us-midterm-2026-11-03', 'oh-senate-2026', 'ks-governor-2026'):
            self.assertEqual(k[event]['policyClass'], 'political_signal'); self.assertFalse(k[event]['restrictionInForce'])

    def test_proposed_bill_differs_from_active_order(self):
        k = classes()
        self.assertEqual(k['ny-s10642']['policyClass'], 'proposed_not_enacted'); self.assertTrue(k['ny-s10642']['potentialRestriction'])
        self.assertEqual(k['ny-eo62']['policyClass'], 'active'); self.assertTrue(k['ny-eo62']['restrictionInForce'])

    def test_exposure_requires_links_and_hold_is_not_cancellation(self):
        c = data(); base = next(p for p in c['projects'] if p['id'] == 'wulf-lake-hawkeye')
        c['projects'].append(dict(base, id='unlinked-ny'))
        ex = {x['projectId']: x for x in policy_assessment(c, REQUEST['cutoff'])['policy']['exposures']}
        self.assertEqual(ex['unlinked-ny']['exposure'], 'no_substantiated_exposure')
        self.assertEqual(ex['aws-wilmington']['exposure'], 'directly_exposed'); self.assertEqual(ex['aws-wilmington']['stage'], 'permitting_on_hold')

    def test_planned_capacity_is_not_operational(self):
        ex = {x['projectId']: x for x in policy_assessment(data(), REQUEST['cutoff'])['policy']['exposures']}
        self.assertEqual((ex['apld-polaris-forge-1']['energisedMw'], ex['apld-polaris-forge-1']['unenergisedMw']), (250, 150))
        self.assertIsNone(ex['apld-polaris-forge-2']['energisedMw'])
        c = data(); c['projects'][0]['plannedMw'] = 1; c['projects'][0]['energisedMw'] = 2
        with self.assertRaises(ValueError):
            parse_policy_case(c)

    def test_publication_cutoff_excludes_later_news(self):
        c = data(); frozen = freeze_policy_case(c, c['anchorAt'], 'publication')
        ids = {e['id'] for e in frozen['case']['events']}
        self.assertIn('ny-eo62', ids); self.assertNotIn('piqua-charter-2026-11-03', ids)
        self.assertEqual(freeze_policy_case(c, c['anchorAt'])['case']['events'], [])
        with self.assertRaises(ValueError):
            register_policy_experiment(c, c['anchorAt'], REQUEST['registeredAt'], 'publication')

    def test_study_scores_only_complete_windows_without_authority(self):
        report = evaluate(REQUEST)
        done = [o for o in report['study']['outcomes'] if o['status'] == 'complete']
        self.assertTrue(done and all(o['horizon'] == 1 for o in done))
        self.assertTrue(all(o['status'] == 'pending' for o in report['study']['outcomes'] if o['horizon'] > 1))
        self.assertEqual(report['executionAuthority'], 'none'); self.assertFalse(report['registration']['priorForecast'])


    def test_conflicting_observation_keeps_window_pending_and_identical_recapture_collapses(self):
        base = [p for p in data()['prices'] if p['ticker'] == 'APLD']
        same = dict(base[-1], id='recapture'); diff = dict(base[-1], id='conflict', close=1.0)
        src = dict(id='s', title='Test fixture', url='https://example.test/x', kind='market_data', authority='secondary', publishedAt=None, publicationDate=None, publicationBasis='retrieval_upper_bound', receivedAt=base[-1]['receivedAt'], role='evidence', usage='unknown', mode='retrospective')
        mk = lambda p: parse_observation_set(dict(id='o', capturedAt=p['receivedAt'], sources=[src], prices=[dict(p, sourceIds=['s'])]))
        self.assertEqual(len(merge_policy_observations(base, mk(same))), len(base))
        self.assertEqual(len(merge_policy_observations(base, mk(diff))), len(base) + 1)


if __name__ == '__main__':
    unittest.main()
