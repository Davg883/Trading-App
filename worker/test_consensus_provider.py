import copy
from datetime import datetime,timezone
import unittest
from worker.consensus_provider import fetch_ratings,normalize_ratings

RECEIVED=int(datetime(2026,11,3,23,tzinfo=timezone.utc).timestamp()*1000)
META={'licenseConfirmed':True,'permittedUse':'Mock licensed local research only','utcOffsetMinutes':-300,'ratingScale':[{'raw':'Buy','normalized':'positive'}],'analystUniverse':'Mock covered analysts','coverageComplete':False}
ROW={'id':'vendor-event','analyst_name':'Test analyst','analyst':'Test institution','ticker':'NVDA','date':'2026-11-02','time':'09:00:00','updated':1793628000,'rating_current':'Buy','rating_prior':'Buy','pt_current':'315','pt_prior':'420','currency':'USD','url':'https://www.benzinga.com/quote/NVDA/analyst-ratings'}
BASE={'id':'base','mode':'retrospective','providers':[],'recommendations':[]}

class ConsensusProviderTests(unittest.TestCase):
    def test_license_and_opt_in_block_before_network(self):
        def forbidden(*args):self.fail('Network must remain blocked')
        for metadata,opt,env in [({**META,'licenseConfirmed':False},True,{'BENZINGA_API_KEY':'fake'}),(META,False,{'BENZINGA_API_KEY':'fake'}),(META,True,{})]:
            with self.assertRaises(ValueError):fetch_ratings(metadata,'2026-08-01','2026-11-03',opt,env,forbidden)
    def test_preserves_maintained_rating_and_target_cut(self):
        result=normalize_ratings({'ratings':[ROW]},BASE,META,RECEIVED,'2026-08-01','2026-11-03')
        self.assertEqual(result['inserted'],1);r=result['case']['recommendations'][0]
        self.assertEqual((r['rating'],r['previousRating'],r['target'],r['previousTarget']),('Buy','Buy',315,420));self.assertEqual(r['receivedAt'],RECEIVED)
    def test_exact_retry_preserves_first_receipt_and_changed_revision_appends(self):
        first=normalize_ratings({'ratings':[ROW]},BASE,META,RECEIVED,'2026-08-01','2026-11-03')
        second=normalize_ratings({'ratings':[ROW]},first['case'],META,RECEIVED+1000,'2026-08-01','2026-11-03');self.assertEqual(second['inserted'],0);self.assertEqual(second['case']['recommendations'][0]['receivedAt'],RECEIVED)
        correction={**ROW,'updated':ROW['updated']+60,'pt_current':'316'};third=normalize_ratings({'ratings':[correction]},second['case'],META,RECEIVED+2000,'2026-08-01','2026-11-03');self.assertEqual(third['inserted'],1);self.assertEqual(third['case']['recommendations'][1]['supersedes'],third['case']['recommendations'][0]['id'])
    def test_missing_identity_time_currency_and_future_update_are_quarantined(self):
        for patch in [{'analyst_name':''},{'time':''},{'currency':None},{'updated':RECEIVED/1000+1},{'pt_current':'nan'}]:
            result=normalize_ratings({'ratings':[{**ROW,**patch}]},BASE,META,RECEIVED,'2026-08-01','2026-11-03');self.assertEqual(result['inserted'],0);self.assertEqual(len(result['quarantine']),1)
    def test_conflicting_same_update_cannot_overwrite(self):
        first=normalize_ratings({'ratings':[ROW]},BASE,META,RECEIVED,'2026-08-01','2026-11-03');r=normalize_ratings({'ratings':[{**ROW,'pt_current':'999'}]},first['case'],META,RECEIVED+1,'2026-08-01','2026-11-03');self.assertEqual(r['case']['recommendations'][0]['target'],315);self.assertEqual(len(r['quarantine']),1)
    def test_response_urls_cannot_retain_credentials(self):
        result=normalize_ratings({'ratings':[{**ROW,'url':'https://www.benzinga.com/quote/NVDA?token=fake-secret'}]},BASE,META,RECEIVED,'2026-08-01','2026-11-03');self.assertNotIn('fake-secret',str(result));self.assertFalse(result['case']['providers'][0]['coverage']['complete'])
    def test_provider_request_uses_fixed_ratings_endpoint_only(self):
        seen=[]
        def transport(url):seen.append(url);return {'ratings':[copy.deepcopy(ROW)]}
        raw,_=fetch_ratings(META,'2026-11-01','2026-11-03',True,{'BENZINGA_API_KEY':'fake-secret'},transport)
        self.assertEqual(len(raw['ratings']),1);self.assertTrue(seen[0].startswith('https://api.benzinga.com/api/v2.1/calendar/ratings?'));self.assertNotIn('orders',seen[0]);self.assertEqual(len(seen),1)
