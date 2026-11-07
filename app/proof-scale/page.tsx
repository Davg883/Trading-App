import type { Metadata } from 'next';
import ProofScale from '../../components/proof-scale';
import ConnectedProof from '../../integrations/connected-proof';
import './proof-scale.css';

export const metadata:Metadata={title:'Proof & Scale | AI Capital Intelligence',description:'Evidence gates, measured value and scoped human investment review.'};
export default function ProofScalePage(){
  const connected=Boolean(process.env.NEXT_PUBLIC_CONVEX_URL&&process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY&&process.env.CLERK_SECRET_KEY);
  return <ProofScale connectedReview={connected?<ConnectedProof/>:<div className="proof-empty"><strong>Private approval workspace is not connected.</strong><p>Configure Clerk and Convex to create persistent pilots and record authenticated review. Local examples and imported files let you inspect the evidence requirements.</p></div>}/>;
}
