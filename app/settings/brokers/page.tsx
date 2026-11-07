import type {Metadata} from 'next';
import BrokerSettings from '../../../components/broker-settings';
import {vaultConfigured} from '../../../lib/brokers/vault';
import '../../proof-scale/proof-scale.css';
import './brokers.css';
import '../../broker-sync.css';
export const metadata:Metadata={title:'Broker Connections | AI Capital Intelligence',description:'Secure read-only Trading 212 account connection.'};
export const dynamic='force-dynamic';
export default function BrokersPage(){const authenticationConfigured=Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY&&process.env.CLERK_SECRET_KEY&&process.env.NEXT_PUBLIC_CONVEX_URL);const storageConfigured=Boolean(vaultConfigured()&&process.env.CONVEX_BROKER_ADMIN_KEY);return <BrokerSettings authenticationConfigured={authenticationConfigured} storageConfigured={storageConfigured}/>;}
