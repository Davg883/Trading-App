import type {Metadata} from 'next';
import PolicyRiskMonitor from '../../components/policy-risk-monitor';
import ConnectedPolicyRisk from '../../integrations/connected-policy-risk';
import '../proof-scale/proof-scale.css';
import '../recovery/recovery.css';
import './policy-risk.css';

export const metadata:Metadata={title:'US Midterm Infrastructure Risk · Benchmark 001.2 | AI Capital Intelligence',description:'Sourced state and local data-centre policy events, project-level exposure and a retrospective event study.'};
export default function PolicyRiskPage(){
  const configured=Boolean(process.env.NEXT_PUBLIC_CONVEX_URL&&process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY&&process.env.CLERK_SECRET_KEY);
  return <PolicyRiskMonitor connectedReview={configured?<ConnectedPolicyRisk/>:<div className="proof-empty"><strong>Private persistence is not configured.</strong><p>Configure Clerk and Convex to import the sourced package, freeze owner-scoped registrations and append later observation sets. The local study above is already registered for review.</p></div>}/>;
}
