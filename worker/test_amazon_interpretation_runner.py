import copy
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
import subprocess
import sys
from urllib.error import HTTPError, URLError

from worker.amazon_cash_conversion import build_amazon_interpretation
from worker.amazon_interpretation_runner import canonical_evidence, run_interpretation, validate_manifest, validate_payload

ENV = {'OPENAI_API_KEY': 'fake-secret-a', 'OPENAI_MODEL': 'pinned-openai-2026', 'ANTHROPIC_API_KEY': 'fake-secret-b', 'ANTHROPIC_MODEL': 'pinned-anthropic-2026'}


def manifest():
    data = json.loads((Path(__file__).resolve().parents[1] / 'data' / 'earnings' / 'amazon-q3-2026-cash.json').read_text(encoding='utf-8-sig'))
    cutoff = max(o['receivedAt'] for o in data['observations'])
    result = build_amazon_interpretation(data, '2026-Q3', cutoff)
    result['models'][0].update(provider='openai', modelVersion=ENV['OPENAI_MODEL'])
    result['models'][1].update(provider='anthropic', modelVersion=ENV['ANTHROPIC_MODEL'])
    result['registeredAt'] = cutoff
    return result


def interpretation(value):
    ids = [o['id'] for o in value['evidence']['observations']]
    return {'economicInterpretation': 'Strong AWS sales do not establish AI-specific investment returns; evaluate consolidated cash conversion separately.',
            'supportingEvidenceIds': [ids[0]], 'challengingEvidenceIds': [ids[-1]], 'risks': ['Cash investment may precede demand'],
            'invalidation': ['Reconciled financial statements revise the cash bridge'], 'researchAction': 'further_research'}


def response(payload, value):
    body = json.dumps(value)
    if payload['model'] == ENV['OPENAI_MODEL']:
        return {'model': payload['model'], 'usage': {'prompt_tokens': 123, 'completion_tokens': 45}, 'choices': [{'finish_reason': 'stop', 'message': {'content': body}}]}
    return {'model': payload['model'], 'usage': {'input_tokens': 124, 'output_tokens': 46}, 'stop_reason': 'end_turn', 'content': [{'type': 'text', 'text': body}]}


class AmazonInterpretationRunnerTests(unittest.TestCase):
    def test_two_independent_calls_use_identical_evidence_and_no_forecast_prompt(self):
        data = manifest(); seen = []; barrier = threading.Barrier(2)
        def transport(endpoint, headers, payload, timeout):
            seen.append(payload)
            barrier.wait(timeout=3)
            return response(payload, interpretation(data))
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'run'; result = run_interpretation(data, out, ENV, True, transport=transport)
            self.assertEqual(result['statuses'], {'model_a': 'complete', 'model_b': 'complete'})
            self.assertEqual(seen[0]['messages'][-1], seen[1]['messages'][-1])
            self.assertEqual(result['results'][0]['evidenceJson'], result['results'][1]['evidenceJson'])
            self.assertTrue(all(r['actualCost'] is None and r['marketForecastScore'] is None and r['interpretationScore'] is None and r['executionAuthority'] == 'none' for r in result['results']))
            self.assertEqual(result['results'][0]['inputTokens'], 123)
            self.assertEqual(result['results'][1]['outputTokens'], 46)
            self.assertTrue(all('tools' not in p for p in seen))
            self.assertIn('Do not browse', seen[0].get('system', seen[0]['messages'][0].get('content')))
            self.assertNotIn('fake-secret', (out / 'results.json').read_text())
            self.assertNotIn('rawResponse', (out / 'results.json').read_text())

    def test_paid_opt_in_blocks_before_any_directory_or_network(self):
        def forbidden(*args): self.fail('Network called without opt-in')
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'run'
            with self.assertRaises(ValueError): run_interpretation(manifest(), out, ENV, transport=forbidden)
            self.assertFalse(out.exists())

    def test_both_keys_and_exact_models_required_before_any_network(self):
        def forbidden(*args): self.fail('Network called before complete valid configuration')
        for env in ({}, {k: v for k, v in ENV.items() if k != 'ANTHROPIC_API_KEY'}, {**ENV, 'OPENAI_MODEL': 'different-version'}):
            with tempfile.TemporaryDirectory() as tmp, self.assertRaises(ValueError):
                run_interpretation(manifest(), Path(tmp) / 'run', env, True, transport=forbidden)

    def test_provider_destinations_are_fixed(self):
        with tempfile.TemporaryDirectory() as tmp, self.assertRaises(ValueError):
            run_interpretation(manifest(), Path(tmp) / 'run', {**ENV, 'OPENAI_ENDPOINT': 'https://untrusted.example/infer'}, True)

    def test_manifest_rejects_annotation_late_receipts_and_duplicate_provider(self):
        for mutation in ('annotation', 'late', 'provider', 'empty', 'future'):
            value = manifest()
            if mutation == 'annotation': value['evidence']['articleClaim'] = {'description': 'Unverified article', 'amountMillions': 77300, 'sourceUrl': None, 'verified': False}
            if mutation == 'late': value['evidence']['observations'][0]['receivedAt'] = value['cutoff'] + 1
            if mutation == 'provider': value['models'][1]['provider'] = 'openai'
            if mutation == 'empty': value['evidence']['observations'] = []
            if mutation == 'future': value['registeredAt'] = int(time.time() * 1000) + 10000
            with self.assertRaises(ValueError): validate_manifest(value)

    def test_unknown_citations_trade_actions_and_extra_fields_fail(self):
        data = manifest()
        for mutation in ('citation', 'trade', 'forecast', 'scores'):
            payload = interpretation(data)
            if mutation == 'citation': payload['supportingEvidenceIds'] = ['invented']
            if mutation == 'trade': payload['researchAction'] = 'buy'
            if mutation == 'forecast': payload['probabilities'] = {'up': 1}
            if mutation == 'scores': payload['interpretationScore'] = 1
            with self.assertRaises(ValueError): validate_payload(payload, data)

    def test_invalid_submissions_retain_usage_without_raw_response(self):
        data = manifest()
        def transport(endpoint, headers, payload, timeout):
            value = response(payload, {**interpretation(data), 'researchAction': 'buy'})
            return value
        with tempfile.TemporaryDirectory() as tmp:
            result = run_interpretation(data, Path(tmp) / 'run', ENV, True, transport=transport)
            self.assertTrue(all(r['status'] == 'failed' and r['payload'] is None and r['errorCode'] == 'invalid_response' and r['inputTokens'] is not None for r in result['results']))

    def test_returned_model_version_mismatch_fails_and_does_not_echo_untrusted_value(self):
        data = manifest()
        def transport(endpoint, headers, payload, timeout): return {**response(payload, interpretation(data)), 'model': 'fake-secret-a'}
        with tempfile.TemporaryDirectory() as tmp:
            result = run_interpretation(data, Path(tmp) / 'run', ENV, True, transport=transport)
            self.assertTrue(all(r['errorCode'] == 'model_version_mismatch' and r['returnedModelVersion'] is None and r['payload'] is None for r in result['results']))
            self.assertNotIn('fake-secret-a', json.dumps(result))

    def test_http_network_and_unexpected_errors_are_redacted(self):
        errors = [HTTPError('https://provider.example', 401, 'fake-secret-a', {}, None), URLError('fake-secret-b'), RuntimeError('fake-secret-a')]
        for error in errors:
            def transport(*args): raise error
            with tempfile.TemporaryDirectory() as tmp:
                result = run_interpretation(manifest(), Path(tmp) / 'run', ENV, True, transport=transport)
                self.assertTrue(all(r['status'] == 'failed' and r['payload'] is None for r in result['results']))
                self.assertNotIn('fake-secret', json.dumps(result))

    def test_global_deadline_keeps_missing_results_without_waiting_or_late_overwrite(self):
        data = manifest()
        def transport(endpoint, headers, payload, timeout):
            time.sleep(1.5)
            return response(payload, interpretation(data))
        with tempfile.TemporaryDirectory() as tmp:
            start = time.monotonic(); out = Path(tmp) / 'run'
            result = run_interpretation(data, out, ENV, True, deadline_seconds=1, transport=transport)
            self.assertLess(time.monotonic() - start, 1.4)
            self.assertTrue(all(r['errorCode'] == 'deadline_exceeded' and r['completedAt'] >= r['startedAt'] and r['latencyMs'] == 1000 for r in result['results']))
            saved = (out / 'results.json').read_text(); time.sleep(.7)
            self.assertEqual(saved, (out / 'results.json').read_text())

    def test_output_directory_cannot_be_reused(self):
        data = manifest()
        def transport(endpoint, headers, payload, timeout): return response(payload, interpretation(data))
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'run'; run_interpretation(data, out, ENV, True, transport=transport)
            with self.assertRaises(FileExistsError): run_interpretation(data, out, ENV, True, transport=transport)

    def test_canonical_json_matches_javascript_numeric_and_unicode_conventions(self):
        self.assertEqual(canonical_evidence({'z': 40.0, 'a': 'Nearly 17× tokens', 'small': .000001, 'smaller': .0000001}), '{"a":"Nearly 17× tokens","small":0.000001,"smaller":1e-7,"z":40}')

    def test_cli_validate_only_and_blocked_calls_are_safe_without_network(self):
        with tempfile.TemporaryDirectory() as tmp:
            request = Path(tmp) / 'manifest.json'; request.write_text(json.dumps(manifest()), encoding='utf-8')
            offline = subprocess.run([sys.executable, '-m', 'worker.amazon_interpretation_runner', str(request), '--validate-only'], capture_output=True, text=True)
            self.assertEqual(offline.returncode, 0, offline.stderr)
            self.assertEqual(json.loads(offline.stdout)['status'], 'valid_offline')
            out = Path(tmp) / 'run'
            for arguments in ([], ['--allow-paid-requests']):
                blocked = subprocess.run([sys.executable, '-m', 'worker.amazon_interpretation_runner', str(request), '--output-dir', str(out), *arguments], capture_output=True, text=True, env={'PATH': str(Path(sys.executable).parent), 'OPENAI_API_KEY': '', 'ANTHROPIC_API_KEY': ''})
                self.assertEqual(blocked.returncode, 2)
                self.assertIn('blocked', json.loads(blocked.stderr)['error'])
                self.assertFalse(out.exists())

    def test_revised_observations_use_eligible_history_without_sending_old_revisions(self):
        original = manifest(); data = json.loads((Path(__file__).resolve().parents[1] / 'data' / 'earnings' / 'amazon-q3-2026-cash.json').read_text(encoding='utf-8-sig'))
        row = next(o for o in data['observations'] if o['metric'] == 'net_income' and o['period']['label'] == '2026-Q3')
        now = original['cutoff'] + 1
        data['observations'].append({**copy.deepcopy(row), 'id': 'revised-income-runner-test', 'supersedes': row['id'], 'value': row['value'] + 1, 'receivedAt': now})
        revised = build_amazon_interpretation(data, '2026-Q3', now); revised['models'] = original['models']; revised['registeredAt'] = now
        validated = validate_manifest(revised)
        self.assertNotIn(row['id'], {o['id'] for o in validated['evidence']['observations']})
        self.assertIn(row['id'], {o['id'] for o in validated['evidenceHistory']})
        bad = copy.deepcopy(revised); bad['evidenceHistory'][-1]['receivedAt'] = now + 100
        with self.assertRaises(ValueError): validate_manifest(bad)


if __name__ == '__main__':
    unittest.main()
