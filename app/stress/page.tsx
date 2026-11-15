import type { Metadata } from 'next';
import StressMonitor, { type PersistedReferenceClose } from '../../components/stress-monitor';
import { fetchLiveOperationsOverview } from '../../lib/remote-ops/server';
import './stress.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Market Stress & Valuation | AI Capital Intelligence',
  description: 'Source-aware market stress, valuation resets and registered research outcomes.',
};

export default async function StressPage() {
  const liveOps = await fetchLiveOperationsOverview();
  const persistedReferenceCloses: PersistedReferenceClose[] = (
    liveOps?.marketData?.latestBySymbol ?? []
  ).map((o) => ({
    symbol: o.symbol,
    sessionDate: o.sessionDate,
    eventAt: o.eventAt,
    serverReceivedAt: o.serverReceivedAt,
    close: o.close,
    closeGbp: o.closeGbp,
    currency: 'USD',
    priceBasis: o.priceBasis,
    corporateActionsReviewed: o.corporateActionsReviewed,
    declaredDelayMs: o.declaredDelayMs,
    sourceUrl: o.sourceUrl,
  }));
  return <StressMonitor persistedReferenceCloses={persistedReferenceCloses} />;
}
