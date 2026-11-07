import {cronJobs,makeFunctionReference} from 'convex/server';

const crons=cronJobs();
const runCycleRef=makeFunctionReference<'action'>('remoteOpsCloud:runScheduledCloudCycle');

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

export default crons;
