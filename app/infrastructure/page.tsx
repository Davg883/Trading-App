import type {Metadata} from 'next';
import InfrastructureMonitor from '../../components/infrastructure-monitor';
import ConnectedInfrastructure from '../../integrations/connected-infrastructure';
import '../proof-scale/proof-scale.css';
import './infrastructure.css';
export const metadata:Metadata={title:'Infrastructure Financing | AI Capital Intelligence',description:'Source-backed AI infrastructure funding, counterparties and project dependencies.'};
export default function InfrastructurePage(){const configured=Boolean(process.env.NEXT_PUBLIC_CONVEX_URL&&process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY&&process.env.CLERK_SECRET_KEY);return <InfrastructureMonitor connectedReview={configured?<ConnectedInfrastructure/>:<div className="proof-empty"><strong>Private infrastructure registry is not connected.</strong><p>The sourced local case is available for review. Configure Clerk and Convex for persistent owner-scoped imports and immutable research snapshots.</p></div>}/>;}
