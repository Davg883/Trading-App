import type {Metadata} from 'next';
import PortfolioDefence from '../../components/portfolio-defence';
import ConnectedDefence from '../../integrations/connected-defence';
import '../proof-scale/proof-scale.css';
import './defence.css';

export const metadata:Metadata={title:'Portfolio Defence | AI Capital Intelligence',description:'Evidence-based portfolio exposure, matched stress scenarios and research-only hedge analysis.'};
export default function DefencePage(){
  const configured=Boolean(process.env.NEXT_PUBLIC_CONVEX_URL&&process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY&&process.env.CLERK_SECRET_KEY);
  return <PortfolioDefence connectedReview={configured?<ConnectedDefence/>:<div className="proof-empty"><strong>Private research reviews are not connected.</strong><p>Configure Clerk and Convex to retain owner-scoped cases, immutable snapshots and authenticated human research reviews. Local analysis grants no paper-allocation authority.</p></div>}/>;
}
