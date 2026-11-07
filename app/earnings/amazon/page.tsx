import type {Metadata} from 'next';
import EarningsCase,{type EarningsCaseData} from '../../../components/earnings-case';
import AmazonCashPanel from '../../../components/amazon-cash-panel';
import ConnectedAmazonCase from '../../../integrations/connected-amazon-case';
import earnings from '../../../data/earnings/amazon-q3-2026.json';
import cashCase from '../../../data/earnings/amazon-q3-2026-cash.json';
import {parseAmazonCashCase} from '../../../lib/amazon-cash-conversion';
import '../earnings.css';
import './amazon.css';

export const metadata:Metadata={title:'Amazon Q3 2026 cash conversion | AI Capital Intelligence',description:'Official Amazon earnings, AWS economics, cash capital spending and retrospective interpretation evidence.'};
export default function AmazonPage(){const configured=Boolean(process.env.NEXT_PUBLIC_CONVEX_URL&&process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY&&process.env.CLERK_SECRET_KEY);return <EarningsCase data={earnings as EarningsCaseData} economics={<AmazonCashPanel data={parseAmazonCashCase(cashCase)} connectedReview={configured?<ConnectedAmazonCase/>:<p className="earnings-empty">Private experiment registration is not connected. Configure the established Clerk and Convex deployment to register immutable owner-scoped experiments. Local exports remain retrospective research artifacts.</p>}/>}/>;}
