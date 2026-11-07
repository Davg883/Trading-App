"""Network-free illustrative retrospective; all company values are synthetic."""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from .stress import VERSION, register_outcome, market_summary, valuation_reset
from .stress_runner import run_experiment, evaluate_experiment


def fixtures():
    # Illustrative calendar only, explicitly labelled synthetic; not an exchange feed.
    days=[2,5,6,7,8,9,12,13,14,15,16,19,20,21,22,23,26,27,28,29,30]
    closes=[datetime(2026,10,day,20,tzinfo=timezone.utc).timestamp()*1000 for day in days]
    calendar={'id':'synthetic-XNAS-October-2026','sourceUrl':'https://example.com/synthetic-calendar','verified':True,'sessionCloses':closes}
    bars=[]
    for symbol,start,step in [('GOOGL',100,-1),('QQQ',100,-.25)]:
        for index,t in enumerate(closes):
            bars.append({'id':f'{symbol}-{index}','symbol':symbol,'provider':'synthetic-fixture','sourceUrl':'https://example.com/synthetic-prices',
                         'eventAt':t,'receivedAt':t+1000,'currency':'USD','session':'regular','priceBasis':'split-adjusted','adjustmentVersion':'fixture-v1',
                         'synthetic':True,'declaredDelayMs':1000,'kind':'daily-bar','close':start+index*step,'high':start+index*step+1,'corporateActionsReviewed':True})
    market={'version':VERSION,'provider':'synthetic-fixture','license':'Synthetic demonstration only; no observed prices',
            'synthetic':True,'coverageStart':closes[0],'coverageEnd':closes[-1],'calendar':calendar,'bars':bars}
    registered=closes[10]+2000;cutoff=closes[0]-1000
    window=register_outcome({'symbol':'GOOGL','benchmark':'QQQ','horizon':5,'startAt':closes[0],'registeredAt':registered,'evidenceCutoff':cutoff,
        'mode':'retrospective','calendar':calendar,'session':'regular','priceBasis':'split-adjusted','adjustmentVersion':'fixture-v1',
        'provider':'synthetic-fixture','currency':'USD','synthetic':True,'spreadBps':None,'slippageBps':None,'tradingCostBps':None})
    bundle={'version':VERSION,'symbol':'GOOGL','synthetic':True,'mode':'retrospective','cutoff':cutoff,'registeredAt':registered,'window':window,
        'neutralBand':.002,'baselineVersion':'valuation-checklist-v1',
        'evidence':[{'id':'fact-1','synthetic':True,'sourceUrl':'https://example.com/synthetic-financials','publishedAt':cutoff-2000,'receivedAt':cutoff-1000,
            'verification':'verified','kind':'financial-fact','text':'Synthetic illustration only. No authoritative October 2026 company explanation supplied.'}],
        'baselineReview':{'positiveEvidence':[],'negativeEvidence':[],'uncertainties':['Observed financial evidence missing'],'fundamentals':'unknown','valuation':'unknown','evidenceVerified':False}}
    return market,bundle


def mock_transport(endpoint,headers,payload,timeout):
    forecast={'economicInterpretation':'Synthetic demonstration: no observed fundamentals are available.','probabilities':{'up':.25,'neutral':.5,'down':.25},
              'expectedReturn':0,'lower':-.1,'upper':.1,'evidenceIds':['fact-1'],'risks':['All values are synthetic'],
              'invalidation':'Replace illustration with verified eligible sources.','researchAction':'no-trade'}
    if 'openai' in endpoint:
        return {'model':'mock-only-a','usage':{'prompt_tokens':0},'choices':[{'finish_reason':'stop','message':{'content':json.dumps(forecast)}}]}
    return {'model':'mock-only-b','usage':{'input_tokens':0},'stop_reason':'end_turn','content':[{'type':'text','text':json.dumps(forecast)}]}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output-dir',required=True);args=parser.parse_args()
    root=Path(args.output_dir);root.mkdir(parents=True,exist_ok=False)
    market,bundle=fixtures()
    for name,value in [('market',market),('experiment',bundle)]:
        (root/f'{name}.json').write_text(json.dumps(value,indent=2),encoding='utf-8')
    env={'OPENAI_API_KEY':'mock-not-a-key','OPENAI_MODEL':'mock-a','ANTHROPIC_API_KEY':'mock-not-a-key','ANTHROPIC_MODEL':'mock-b'}
    run_experiment(bundle,root/'run',env=env,transport=mock_transport)
    report=evaluate_experiment(root/'run',market,market['coverageEnd']+1000)
    (root/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({'synthetic':True,'mode':'retrospective','directory':str(root),'outcome':report['outcome']['status'],'networkCalls':0}))


if __name__=='__main__':main()
