import type {Metadata} from 'next';
import RecoveryMonitor from '../../components/recovery-monitor';
import ConnectedRecovery from '../../integrations/connected-recovery';
import '../proof-scale/proof-scale.css';
import './recovery.css';

export const metadata:Metadata={title:'AI Market Recovery · Case 006 | AI Capital Intelligence',description:'Retrospective, sourced market recovery research and three independent £500 entry comparisons.'};
export default function RecoveryPage(){
  const configured=Boolean(process.env.NEXT_PUBLIC_CONVEX_URL&&process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY&&process.env.CLERK_SECRET_KEY);
  return <RecoveryMonitor connectedReview={configured?<ConnectedRecovery/>:<div className="proof-empty"><strong>Private persistence is not configured.</strong><p>Configure Clerk and Convex to import trusted evidence and preserve owner-scoped registrations and authenticated human reviews. Three downloadable local research drafts are already registered below.</p></div>}/>;
}
