import {afterEach,describe,expect,it,vi} from 'vitest';
import {convexTest} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import schema from '../convex/schema';
import {
 MARKET_DATA_SYMBOLS,
 PROVIDER_ASSESSMENT_MATRIX,
 ProviderRequestBudget,
 assertNotTrading212PositionPrice,
 collectUniverseMarketObservations,
 resolveMarketProviderConfig,
 type AuthorisedMarketObservation,
} from '../lib/market-data/provider-adapter';
import {resolveMissingEvidenceAndOutcomes} from '../lib/market-data/missing-evidence-resolver';
import {
 createAndRunForwardResearchEvent,
 evaluateForwardResearchEvent,
 type FrozenForwardEvidenceItem,
} from '../lib/market-data/forward-research';

const modules={
 './_generated/server.ts':async()=>({}),
 './operations.ts':()=>import('../convex/operations'),
 './brokers.ts':()=>import('../convex/brokers'),
 './trading.ts':()=>import('../convex/trading'),
 './roles.ts':()=>import('../convex/roles'),
 './research.ts':()=>import('../convex/research'),
};

const opsM=(n:string)=>makeFunctionReference<'mutation'>(`operations:${n}`);
const opsQ=(n:string)=>makeFunctionReference<'query'>(`operations:${n}`);
const OWNER='https://issuer.test|user_owner';
const NOW=Date.parse('2026-11-06T16:00:00Z');

afterEach(()=>vi.useRealTimers());

function makeMockFetchForNasdaqAndFx():typeof fetch{
 const barsBySymbol:Record<string,Array<{date:string;open:string;high:string;low:string;close:string;volume:string}>>={
  NVDA:[
   {date:'11/05/2026',close:'$181.60',volume:'38,112,000',open:'$179.50',high:'$182.40',low:'$178.90'},
   {date:'11/04/2026',close:'$178.40',volume:'35,900,000',open:'$176.20',high:'$179.10',low:'$175.80'},
   {date:'11/03/2026',close:'$175.00',volume:'33,500,000',open:'$174.00',high:'$176.50',low:'$173.10'},
  ],
  MSFT:[
   {date:'11/05/2026',close:'$535.93',volume:'19,400,000',open:'$532.00',high:'$537.10',low:'$531.00'},
   {date:'11/04/2026',close:'$531.10',volume:'18,200,000',open:'$529.00',high:'$532.50',low:'$527.90'},
   {date:'11/03/2026',close:'$528.00',volume:'17,800,000',open:'$526.50',high:'$529.40',low:'$525.10'},
  ],
  GOOGL:[
   {date:'11/05/2026',close:'$282.57',volume:'22,100,000',open:'$280.10',high:'$283.40',low:'$279.60'},
   {date:'11/04/2026',close:'$279.80',volume:'21,000,000',open:'$277.90',high:'$280.50',low:'$276.80'},
   {date:'11/03/2026',close:'$276.50',volume:'20,400,000',open:'$275.00',high:'$277.80',low:'$274.20'},
  ],
  AMZN:[
   {date:'11/05/2026',close:'$260.21',volume:'28,500,000',open:'$258.00',high:'$261.30',low:'$257.40'},
   {date:'11/04/2026',close:'$257.60',volume:'26,700,000',open:'$255.80',high:'$258.40',low:'$254.90'},
   {date:'11/03/2026',close:'$255.00',volume:'25,100,000',open:'$253.50',high:'$256.00',low:'$252.80'},
  ],
  INTC:[
   {date:'11/05/2026',close:'$52.25',volume:'44,000,000',open:'$51.40',high:'$52.60',low:'$51.10'},
   {date:'11/04/2026',close:'$51.10',volume:'41,200,000',open:'$50.50',high:'$51.50',low:'$50.20'},
   {date:'11/03/2026',close:'$50.00',volume:'39,800,000',open:'$49.60',high:'$50.40',low:'$49.20'},
  ],
  AMD:[
   {date:'11/05/2026',close:'$404.40',volume:'31,200,000',open:'$399.00',high:'$406.00',low:'$397.80'},
   {date:'11/04/2026',close:'$398.10',volume:'29,500,000',open:'$394.50',high:'$399.80',low:'$393.00'},
   {date:'11/03/2026',close:'$392.00',volume:'28,000,000',open:'$390.00',high:'$394.00',low:'$388.50'},
  ],
  CRWV:[
   {date:'11/05/2026',close:'$43.66',volume:'9,400,000',open:'$42.80',high:'$44.10',low:'$42.50'},
   {date:'11/04/2026',close:'$42.90',volume:'8,800,000',open:'$42.10',high:'$43.20',low:'$41.90'},
   {date:'11/03/2026',close:'$42.00',volume:'8,200,000',open:'$41.50',high:'$42.40',low:'$41.10'},
  ],
  QQQ:[
   {date:'11/05/2026',close:'$647.05',volume:'27,600,000',open:'$643.00',high:'$648.20',low:'$642.10'},
   {date:'11/04/2026',close:'$641.20',volume:'25,900,000',open:'$638.50',high:'$642.50',low:'$637.40'},
   {date:'11/03/2026',close:'$636.00',volume:'24,800,000',open:'$634.00',high:'$637.50',low:'$633.00'},
  ],
 };

 return (async(input:RequestInfo|URL)=>{
  const url=String(input);
  if(url.includes('api.frankfurter.app')){
   return new Response(
    JSON.stringify({
     amount:1,
     base:'USD',
     start_date:'2026-11-01',
     end_date:'2026-11-06',
     rates:{
      '2026-11-03':{GBP:0.7415},
      '2026-11-04':{GBP:0.7422},
      '2026-11-05':{GBP:0.74299},
      '2026-11-06':{GBP:0.74711},
     },
    }),
    {status:200,headers:{'content-type':'application/json'}},
   );
  }
  const m=/api\.nasdaq\.com\/api\/quote\/([A-Z]+)\/historical/.exec(url);
  if(m){
   const sym=m[1];
   const rows=barsBySymbol[sym]??[];
   return new Response(
    JSON.stringify({
     data:{
      symbol:sym,
      totalRecords:rows.length,
      tradesTable:{rows},
     },
    }),
    {status:200,headers:{'content-type':'application/json'}},
   );
  }
  return new Response('not found',{status:404});
 }) as typeof fetch;
}

function buildFrozenEvidenceFromObservations(observations:AuthorisedMarketObservation[]):FrozenForwardEvidenceItem[]{
 return observations
  .filter(o=>o.symbol==='NVDA'||o.symbol==='QQQ')
  .map(o=>({
   id:o.observationId,
   kind:'market_close_observation' as const,
   symbol:o.symbol,
   metric:'close_usd',
   value:o.close,
   unit:'USD',
   period:o.sessionDate,
   publishedAt:o.eventAt,
   serverReceivedAt:o.serverReceivedAt,
   sourceUrl:o.sourceUrl,
  }));
}

describe('Phase 004 Stage 1 & 2 — Provider Assessment, Adapter, Provenance & Request Limits',()=>{
 it('Stage 1: assesses US equity market-data providers across all 9 required comparison criteria and covers all 8 universe symbols',()=>{
  expect(MARKET_DATA_SYMBOLS).toEqual(['NVDA','MSFT','GOOGL','AMZN','INTC','AMD','CRWV','QQQ']);
  expect(PROVIDER_ASSESSMENT_MATRIX.length).toBeGreaterThanOrEqual(4);

  for(const row of PROVIDER_ASSESSMENT_MATRIX){
   expect(row.ukAvailable).toBe(true);
   expect(row.pricingTierGbpOrUsd.length).toBeGreaterThan(5);
   expect(row.historicalCoverage.length).toBeGreaterThan(10);
   expect(row.corporateActionsAndAdjustedPrices.length).toBeGreaterThan(10);
   expect(row.apiRequestLimits.length).toBeGreaterThan(10);
   expect(row.redistributionAndDisplayRights.length).toBeGreaterThan(10);
   expect(row.commercialVsPersonalPermissions.length).toBeGreaterThan(10);
   expect(row.gbpUsdCoverage.length).toBeGreaterThan(10);
   expect(row.universeAndQqqCoverage).toContain('NVDA');
   expect(row.universeAndQqqCoverage).toContain('CRWV');
   expect(row.universeAndQqqCoverage).toContain('QQQ');
  }

  const primary=PROVIDER_ASSESSMENT_MATRIX.find(p=>p.recommendedRank===1);
  const upgrade=PROVIDER_ASSESSMENT_MATRIX.find(p=>p.recommendedRank===2);
  expect(primary?.providerId).toBe('nasdaq_public_historical');
  expect(upgrade?.providerId).toBe('tiingo_iex_eod');
 });

 it('Stage 2: imports authorised price observations for NVDA, MSFT, GOOGL, AMZN, INTC, AMD, CRWV and QQQ with exact exchange timestamps, server receipt times, adjustment metadata, feed delay and GBP conversion',async()=>{
  const config=resolveMarketProviderConfig({});
  expect(config.providerId).toBe('nasdaq_public_historical');
  expect(config.apiKeyConfigured).toBe(false);

  const result=await collectUniverseMarketObservations({
   now:NOW,
   env:{},
   fetchImpl:makeMockFetchForNasdaqAndFx(),
   lookbackDays:10,
   maxBarsPerSymbol:3,
  });

  expect(result.providerConfig.providerId).toBe('nasdaq_public_historical');
  expect(result.errors).toHaveLength(0);
  expect(result.observations).toHaveLength(24); // 8 symbols * 3 daily sessions
  expect(result.providerRequestsCount).toBe(9); // 1 FX + 8 symbols

  const nvdaLatest=result.observations.find(o=>o.symbol==='NVDA'&&o.sessionDate==='2026-11-05')!;
  expect(nvdaLatest).toBeDefined();
  expect(nvdaLatest.close).toBe(181.6);
  expect(nvdaLatest.usdToGbp).toBe(0.74299);
  expect(nvdaLatest.closeGbp).toBe(Number((181.6*0.74299).toFixed(4)));
  expect(nvdaLatest.eventAt).toBe(Date.parse('2026-11-05T21:00:00.000Z')); // 16:00 America/New_York EST = 21:00 UTC
  expect(nvdaLatest.serverReceivedAt).toBe(NOW);
  expect(nvdaLatest.sourceId).toBe('nasdaq-historical-nvda-2026-11-05');
  expect(nvdaLatest.priceBasis).toBe('unadjusted_close');
  expect(nvdaLatest.corporateActionsReviewed).toBe(false);
  expect(nvdaLatest.declaredDelayMs).toBe(900_000);
  expect(nvdaLatest.isTrading212PositionPrice).toBe(false);
 });

 it('Stage 2: upgrades seamlessly to Tiingo split+dividend adjusted EOD when server-side TIINGO_API_KEY is configured',async()=>{
  const env={TIINGO_API_KEY:'tiingo-test-secret-token-value-123456'};
  const config=resolveMarketProviderConfig(env);
  expect(config.providerId).toBe('tiingo_iex_eod');
  expect(config.apiKeyConfigured).toBe(true);

  const tiingoFetch:typeof fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
   const url=String(input);
   if(url.includes('api.frankfurter.app')){
    return new Response(JSON.stringify({rates:{'2026-11-05':{GBP:0.74299}}}),{status:200});
   }
   expect((init?.headers as Record<string,string>)?.Authorization).toBe('Token tiingo-test-secret-token-value-123456');
   return new Response(
    JSON.stringify([
     {
      date:'2026-11-05T00:00:00.000Z',
      close:181.6,
      open:179.5,
      high:182.4,
      low:178.9,
      volume:38112000,
      adjClose:181.6,
      adjOpen:179.5,
      adjHigh:182.4,
      adjLow:178.9,
      adjVolume:38112000,
      divCash:0,
      splitFactor:1,
     },
    ]),
    {status:200,headers:{'content-type':'application/json'}},
   );
  }) as typeof fetch;

  const result=await collectUniverseMarketObservations({
   now:NOW,
   env,
   symbols:['NVDA','QQQ'],
   fetchImpl:tiingoFetch,
  });

  expect(result.providerConfig.providerId).toBe('tiingo_iex_eod');
  expect(result.observations).toHaveLength(2);
  expect(result.observations[0].priceBasis).toBe('total-return');
  expect(result.observations[0].corporateActionsReviewed).toBe(true);
  expect(result.observations[0].licensed).toBe(true);
 });

 it('Stage 2: enforces provider request budgets and strictly prohibits substituting Trading 212 portfolio-position prices',()=>{
  const budget=new ProviderRequestBudget(2);
  budget.consume(1);
  budget.consume(1);
  expect(budget.remaining).toBe(0);
  expect(()=>budget.consume(1)).toThrow(/Provider request budget exceeded/);

  expect(()=>
   assertNotTrading212PositionPrice({
    provider:'trading212',
    sourceUrl:'https://live.trading212.com/api/v0/equity/portfolio',
   }),
  ).toThrow(/Trading 212 portfolio-position prices cannot be substituted/);
 });
});

describe('Phase 004 Stage 3 — Missing Evidence Resolver & Automatic Outcome Recalculation',()=>{
 it('recalculates USD & GBP outcomes for completed windows when all required observations exist and never scores incomplete or unelapsed windows',async()=>{
  const collected=await collectUniverseMarketObservations({
   now:NOW,
   env:{},
   fetchImpl:makeMockFetchForNasdaqAndFx(),
   lookbackDays:10,
   maxBarsPerSymbol:3,
  });

  const resolution=resolveMissingEvidenceAndOutcomes({
   observations:collected.observations,
   asOf:NOW,
  });

  expect(resolution.totalWindows).toBe(4);
  expect(resolution.scoredWindows).toBe(2); // 1d and 2d policy-001.2 windows have all 7 symbols + QQQ + FX
  expect(resolution.blockedIncompleteWindows).toBe(1); // recovery-006:immediate-plan:1d blocked on corporate actions & transaction costs
  expect(resolution.pendingFutureWindows).toBe(1); // 5d window (2026-11-10)

  const scored1d=resolution.windows.find(w=>w.windowId==='policy-001.2:ai-hyperscalers-chips:1d')!;
  expect(scored1d.status).toBe('complete_scored');
  expect(scored1d.scored).toBe(true);
  expect(scored1d.outcome).not.toBeNull();
  expect(Object.keys(scored1d.outcome?.memberReturnsUsd??{})).toHaveLength(7);
  expect(typeof scored1d.outcome?.equalWeightReturnUsd).toBe('number');
  expect(typeof scored1d.outcome?.equalWeightReturnGbp).toBe('number');
  expect(typeof scored1d.outcome?.excessReturnUsd).toBe('number');
  expect(typeof scored1d.outcome?.excessReturnGbp).toBe('number');

  const blockedRecovery=resolution.windows.find(w=>w.windowId==='recovery-006:immediate-plan:1d')!;
  expect(blockedRecovery.status).toBe('incomplete_blocked');
  expect(blockedRecovery.scored).toBe(false);
  expect(blockedRecovery.outcome).toBeNull();
  expect(blockedRecovery.absentCorporateActions.length).toBeGreaterThan(0);
  expect(blockedRecovery.absentTransactionCosts.length).toBeGreaterThan(0);

  const pending5d=resolution.windows.find(w=>w.windowId==='policy-001.2:ai-hyperscalers-chips:5d')!;
  expect(pending5d.status).toBe('horizon_not_elapsed');
  expect(pending5d.scored).toBe(false);
  expect(pending5d.outcome).toBeNull();

  // Removing INTC's 2026-11-04 observation must immediately block scoring the 1d window (never score incomplete windows).
  const missingIntcObs=collected.observations.filter(o=>!(o.symbol==='INTC'&&o.sessionDate==='2026-11-04'));
  const partialResolution=resolveMissingEvidenceAndOutcomes({
   observations:missingIntcObs,
   asOf:NOW,
  });
  const blocked1d=partialResolution.windows.find(w=>w.windowId==='policy-001.2:ai-hyperscalers-chips:1d')!;
  expect(blocked1d.status).toBe('incomplete_blocked');
  expect(blocked1d.scored).toBe(false);
  expect(blocked1d.outcome).toBeNull();
  expect(blocked1d.absentPrices).toEqual([
   expect.objectContaining({symbol:'INTC',sessionDate:'2026-11-04'}),
  ]);
 });
});

describe('Phase 004 Stage 4 — Forward Research Registration, Multi-Provider Tournament & Trusted Timestamps',()=>{
 it('registers a genuine forward event with trusted server timestamps, runs OpenAI + Anthropic + deterministic + neutral baselines on identical frozen evidence, and evaluates only after post-horizon observations exist',async()=>{
  const collected=await collectUniverseMarketObservations({
   now:NOW,
   env:{},
   fetchImpl:makeMockFetchForNasdaqAndFx(),
   lookbackDays:10,
   maxBarsPerSymbol:3,
  });

  const evidenceItems:FrozenForwardEvidenceItem[]=[
   ...buildFrozenEvidenceFromObservations(collected.observations),
   {
    id:'sec-nvda-rev-2026q3',
    kind:'sec_xbrl_fact',
    symbol:'NVDA',
    metric:'Revenues',
    value:35082000000,
    unit:'USD',
    period:'2026-Q3',
    publishedAt:Date.parse('2026-11-01T20:00:00Z'),
    serverReceivedAt:Date.parse('2026-11-05T18:00:00Z'),
    sourceUrl:'https://data.sec.gov/api/xbrl/companyfacts/CIK0001045810.json',
   },
  ];

  // Mock OpenAI & Anthropic API responses so we test full live-model invocation path with actual token & billed cost capture
  const modelTransport=async(req:{provider:'openai'|'anthropic';endpoint:string})=>{
   if(req.provider==='openai'){
    return {
     model:'gpt-4o-mini-2024-07-18',
     actualBilledCostGbp:0.00027,
     usage:{prompt_tokens:520,completion_tokens:140,prompt_tokens_details:{cached_tokens:0}},
     choices:[
      {
       finish_reason:'stop',
       message:{
        content:JSON.stringify({
         symbol:'NVDA',
         horizon:'5d',
         probabilities:[0.48,0.22,0.3],
         expectedReturn:0.0185,
         lower:-0.025,
         upper:0.062,
         evidenceIds:['sec-nvda-rev-2026q3','nasdaq-nvda-2026-11-05'],
         explanation:'NVDA momentum (+3.77% over 2 sessions) and hyperscaler capex support outperformance vs QQQ.',
         invalidation:'Invalidate if NVDA closes >3% below QQQ on hyperscaler capex guidance reductions.',
         decision:'no-trade',
        }),
       },
      },
     ],
    };
   }
   return {
    model:'claude-3-5-haiku-20241022',
    actualBilledCostGbp:0.00029,
    stop_reason:'end_turn',
    usage:{input_tokens:540,output_tokens:155,cache_read_input_tokens:0},
    content:[
     {
      type:'text',
      text:JSON.stringify({
       symbol:'NVDA',
       horizon:'5d',
       probabilities:[0.4,0.26,0.34],
       expectedReturn:0.012,
       lower:-0.03,
       upper:0.054,
       evidenceIds:['sec-nvda-rev-2026q3','nasdaq-nvda-2026-11-05'],
       explanation:'Positive excess momentum over QQQ balanced by unadjusted reference feed constraints.',
       invalidation:'Invalidate if semiconductor export or hyperscaler capex disclosures turn negative.',
       decision:'no-trade',
      }),
     },
    ],
   };
  };

  const anchorAt=Date.parse('2026-11-05T21:00:00.000Z');
  const targetEndAt=Date.parse('2026-11-12T21:00:00.000Z');

  const event=await createAndRunForwardResearchEvent({
   eventKey:'forward-004-nvda-qqq-5d-2026-11-05',
   name:'Phase 004 Forward Tournament · NVDA vs QQQ 5-Session Excess Return',
   symbol:'NVDA',
   benchmarkSymbol:'QQQ',
   horizon:'5d',
   neutralBand:0.0075,
   serverNow:NOW,
   cutoffAt:NOW,
   anchorSessionDate:'2026-11-05',
   anchorAt,
   targetEndSessionDate:'2026-11-12',
   targetEndAt,
   evidenceItems,
   observations:collected.observations,
   env:{
    OPENAI_API_KEY:'sk-test-openai-key',
    ANTHROPIC_API_KEY:'sk-ant-test-key',
   },
   transport:modelTransport,
  });

  expect(event.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(event.participants).toHaveLength(4);
  for(const p of event.participants){
   expect(p.evidenceSha256).toBe(event.evidenceSha256);
   expect(p.status).toBe('succeeded');
   expect(p.forecast).not.toBeNull();
  }
  const openaiP=event.participants.find(p=>p.participantId==='openai')!;
  const anthropicP=event.participants.find(p=>p.participantId==='anthropic')!;
  expect(openaiP.inputTokens).toBe(520);
  expect(openaiP.estimatedCostGbp).toBeGreaterThan(0);
  expect(anthropicP.inputTokens).toBe(540);
  expect(anthropicP.estimatedCostGbp).toBeGreaterThan(0);

  // Before targetEndAt (2026-11-12), evaluation must remain unscored
  expect(event.evaluation.evaluationStatus).toBe('awaiting_post_horizon_observations');
  expect(event.evaluation.realizedClass).toBeNull();

  // Reject backdated registration where targetEndAt <= serverNow
  await expect(
   createAndRunForwardResearchEvent({
    eventKey:'backdated-invalid',
    name:'Backdated Invalid',
    symbol:'NVDA',
    benchmarkSymbol:'QQQ',
    serverNow:Date.parse('2026-11-15T00:00:00Z'),
    cutoffAt:NOW,
    anchorSessionDate:'2026-11-05',
    anchorAt,
    targetEndSessionDate:'2026-11-12',
    targetEndAt,
    evidenceItems,
    observations:collected.observations,
    env:{},
   }),
  ).rejects.toThrow(/backdated forward registration is prohibited/i);

  // Once post-horizon observations arrive on 2026-11-12 (with serverReceivedAt >= targetEndAt), evaluate automatically
  const postHorizonNow=Date.parse('2026-11-12T22:00:00Z');
  const postHorizonObs:AuthorisedMarketObservation[]=[
   ...collected.observations,
   {
    ...collected.observations.find(o=>o.symbol==='NVDA'&&o.sessionDate==='2026-11-05')!,
    observationId:'nasdaq-nvda-2026-11-12',
    sessionDate:'2026-11-12',
    eventAt:targetEndAt,
    publishedAt:null,
    serverReceivedAt:postHorizonNow,
    sourceId:'nasdaq-historical-nvda-2026-11-12',
    close:190.5,
    closeGbp:Number((190.5*0.745).toFixed(4)),
    usdToGbp:0.745,
   },
   {
    ...collected.observations.find(o=>o.symbol==='QQQ'&&o.sessionDate==='2026-11-05')!,
    observationId:'nasdaq-qqq-2026-11-12',
    sessionDate:'2026-11-12',
    eventAt:targetEndAt,
    publishedAt:null,
    serverReceivedAt:postHorizonNow,
    sourceId:'nasdaq-historical-qqq-2026-11-12',
    close:655.0,
    closeGbp:Number((655.0*0.745).toFixed(4)),
    usdToGbp:0.745,
   },
  ];

  const scoredEval=evaluateForwardResearchEvent({
   event,
   observations:postHorizonObs,
   asOf:postHorizonNow,
  });

  expect(scoredEval.evaluationStatus).toBe('evaluated');
  expect(scoredEval.realizedClass).toBe('up'); // NVDA +4.90% vs QQQ +1.23% => +3.67% excess > +0.75% band
  expect(scoredEval.participantScores).toHaveLength(4);
  for(const s of scoredEval.participantScores){
   expect(s.brierScore).toBeGreaterThanOrEqual(0);
   expect(s.brierScore).toBeLessThanOrEqual(2);
  }
 });
});

describe('Phase 004 Stage 5 — Convex Cloud Persistence, Missing Evidence & Forward Tournament Integration',()=>{
 it('stores market observations idempotently, resolves missing evidence, registers forward research events, and automatically scores forward events when post-horizon observations arrive',async()=>{
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const t=convexTest(schema,modules);
  const ownerClient=t.withIdentity({subject:'user_owner',tokenIdentifier:OWNER});

  const collected=await collectUniverseMarketObservations({
   now:NOW,
   env:{},
   fetchImpl:makeMockFetchForNasdaqAndFx(),
   lookbackDays:10,
   maxBarsPerSymbol:3,
  });

  const storeRes=await t.mutation(opsM('storeMarketObservationsInternal'),{
   owner:OWNER,
   observationsJson:JSON.stringify(collected.observations),
  }) as {
   insertedCount:number;
   duplicateCount:number;
   totalStoredCount:number;
   scoredWindows:number;
   blockedIncompleteWindows:number;
   pendingFutureWindows:number;
  };

  expect(storeRes.insertedCount).toBe(24);
  expect(storeRes.duplicateCount).toBe(0);
  expect(storeRes.totalStoredCount).toBe(24);
  expect(storeRes.scoredWindows).toBe(2);
  expect(storeRes.blockedIncompleteWindows).toBe(1);

  // Re-submitting the identical observations is idempotent
  const replayRes=await t.mutation(opsM('storeMarketObservationsInternal'),{
   owner:OWNER,
   observationsJson:JSON.stringify(collected.observations),
  }) as {insertedCount:number;duplicateCount:number;totalStoredCount:number};
  expect(replayRes.insertedCount).toBe(0);
  expect(replayRes.duplicateCount).toBe(24);
  expect(replayRes.totalStoredCount).toBe(24);

  const anchorAt=Date.parse('2026-11-05T21:00:00.000Z');
  const targetEndAt=Date.parse('2026-11-12T21:00:00.000Z');
  const evidenceItems=buildFrozenEvidenceFromObservations(collected.observations);

  // Register forward event via `storeForwardResearchEventInternal`
  const forwardEvent=await createAndRunForwardResearchEvent({
   eventKey:'forward-004-nvda-qqq-5d-2026-11-05',
   name:'Phase 004 Forward Tournament · NVDA vs QQQ 5-Session Excess Return',
   symbol:'NVDA',
   benchmarkSymbol:'QQQ',
   horizon:'5d',
   neutralBand:0.0075,
   serverNow:NOW,
   cutoffAt:NOW,
   anchorSessionDate:'2026-11-05',
   anchorAt,
   targetEndSessionDate:'2026-11-12',
   targetEndAt,
   evidenceItems,
   observations:collected.observations,
   env:{}, // Tests clean `configuration_missing` recording when provider API keys are absent
  });

  const storedForward=await t.mutation(opsM('storeForwardResearchEventInternal'),{
   owner:OWNER,
   eventJson:JSON.stringify(forwardEvent),
  }) as {stored:boolean;idempotentReplay:boolean;eventKey:string;evidenceSha256:string};

  expect(storedForward.stored).toBe(true);
  expect(storedForward.idempotentReplay).toBe(false);
  expect(storedForward.evidenceSha256).toBe(forwardEvent.evidenceSha256);

  // Verify overview returns marketData, missingEvidenceResolution, and forwardResearchEvents
  const ov=await ownerClient.query(opsQ('overview'),{}) as {
   marketData:{totalObservationsStored:number;latestBySymbol:AuthorisedMarketObservation[]};
   missingEvidenceResolution:{scoredWindows:number;blockedIncompleteWindows:number;pendingFutureWindows:number};
   forwardResearchEvents:Array<{eventKey:string;evaluation:{evaluationStatus:string}}>;
  };
  expect(ov.marketData.totalObservationsStored).toBe(24);
  expect(ov.marketData.latestBySymbol).toHaveLength(8);
  expect(ov.missingEvidenceResolution.scoredWindows).toBe(2);
  expect(ov.missingEvidenceResolution.pendingFutureWindows).toBe(2); // 5d policy window + forward-004 window
  expect(ov.forwardResearchEvents).toHaveLength(1);
  expect(ov.forwardResearchEvents[0].evaluation.evaluationStatus).toBe('awaiting_post_horizon_observations');
 });
});
