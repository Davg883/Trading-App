import type { Metadata } from 'next';
import { PortfolioRiskDashboard } from '../../components/portfolio-risk-dashboard';
import { evaluatePhaseG81PortfolioRisk } from '../../lib/portfolio/multi-asset-risk-pilot';
import './portfolio.css';
import '../command-centre.css';

export const metadata: Metadata = {
  title: 'Portfolio Risk & Capital Preservation | AI Capital Intelligence',
  description:
    'Owner-scoped multi-asset risk intelligence, ETF look-through concentration, and 7 audited stress scenarios with zero broker execution.',
};

export const dynamic = 'force-dynamic';

export default function PortfolioPage() {
  const initialReport = evaluatePhaseG81PortfolioRisk();

  return (
    <main>
      <PortfolioRiskDashboard initialReport={initialReport} />
    </main>
  );
}
