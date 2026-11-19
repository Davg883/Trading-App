import {cronJobs,makeFunctionReference} from 'convex/server';

const crons=cronJobs();
const runCycleRef=makeFunctionReference<'action'>('remoteOpsCloud:runScheduledCloudCycle');
const runMarketDataOnlyRef=makeFunctionReference<'action'>('remoteOpsCloud:runMarketDataOnlyInternal');

// Persistent cloud schedule running in Convex (eu-west-1) independently of the local laptop.
crons.interval(
 'remote-research-operations-cycle',
 {minutes:15},
 runCycleRef,
 {environment:'remote',forceOnDemand:false},
);

// Weekday 07:30 Europe/London Morning Intelligence Brief schedule across BST (UTC+1 -> 06:30 UTC) and GMT (UTC+0 -> 07:30 UTC).
// `evaluateLondonMorningBriefWindow` enforces >= 07:30 Europe/London and strict 1-briefing-per-UK-date deduplication.
crons.cron(
 'morning-intelligence-brief-uk-bst',
 '30 6 * * 1-5',
 runCycleRef,
 {environment:'remote',forceOnDemand:false,jobs:['daily_intelligence_briefing']},
);

crons.cron(
 'morning-intelligence-brief-uk-gmt',
 '30 7 * * 1-5',
 runCycleRef,
 {environment:'remote',forceOnDemand:false,jobs:['daily_intelligence_briefing']},
);

// RC002.4 — Dedicated market-data-only weekday EOD schedule (Mode B).
// Governed strictly by `MARKET_DATA_SCHEDULER_ENV=enabled` (default: disabled), decoupled from `RESEARCH_SCHEDULER_ENV`.
// Targets `runMarketDataOnlyInternal` exclusively (cannot invoke SEC, news, briefing, TypeDB, or broker execution).
// Two weekday slots (21:30 UTC = 16:30 EST / 17:30 EDT; 22:30 UTC = bounded retry for delayed EOD publication):
// max 23 weekdays/month * 2 slots = 46 scheduled attempts/month (0 provider requests on US holidays or when disabled).
crons.cron(
 'market-data-eod-us-slot-1',
 '30 21 * * 1-5',
 runMarketDataOnlyRef,
 {environment:'remote',forceOnDemand:false,triggerSource:'scheduled_market_data_cron'},
);

crons.cron(
 'market-data-eod-us-slot-2',
 '30 22 * * 1-5',
 runMarketDataOnlyRef,
 {environment:'remote',forceOnDemand:false,triggerSource:'scheduled_market_data_cron'},
);

export default crons;
