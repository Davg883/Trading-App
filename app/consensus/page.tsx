import type {Metadata} from 'next';
import ConsensusMonitor from '../../components/consensus-monitor';
import ConnectedConsensus from '../../integrations/connected-consensus';
import '../proof-scale/proof-scale.css';
import './consensus.css';
export const metadata:Metadata={title:'Analyst consensus validation | AI Capital Intelligence',description:'Timestamped analyst revisions, financial context and independent £500 research comparisons.'};
export default function ConsensusPage(){const configured=Boolean(process.env.NEXT_PUBLIC_CONVEX_URL&&process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY&&process.env.CLERK_SECRET_KEY);return <ConsensusMonitor connectedReview={configured?<ConnectedConsensus/>:<div className="proof-empty"><strong>Private study registration is not connected.</strong><p>Configure Clerk and Convex for persistent owner-scoped research portfolios, evidence snapshots and human reviews. Local registrations below are downloadable drafts.</p></div>}/>;}
