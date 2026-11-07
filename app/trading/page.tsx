import type {Metadata} from 'next';
import Link from 'next/link';
import ConnectedTrading from '../../integrations/connected-trading';
import {vaultConfigured} from '../../lib/brokers/vault';
import '../proof-scale/proof-scale.css';
import '../recovery/recovery.css';
import './trading.css';

export const metadata:Metadata={title:'Trading Workspace | AI Capital Intelligence',description:'Human-authorised Trading 212 order proposals, confirmations and broker records.'};
export const dynamic='force-dynamic';
export default function TradingPage(){
  const configured=Boolean(process.env.NEXT_PUBLIC_CONVEX_URL&&process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY&&process.env.CLERK_SECRET_KEY&&vaultConfigured()&&process.env.CONVEX_BROKER_ADMIN_KEY);
  // Server-side flags only. Live submission stays off unless LIVE_TRADING_ENABLED is exactly "true".
  const flags={demo:process.env.DEMO_TRADING_ENABLED==='true',live:process.env.LIVE_TRADING_ENABLED==='true'};
  return <div className="proof-shell trading-shell"><main className="proof-main">
    <header className="proof-topbar"><Link href="/">← Market Radar</Link><Link href="/settings/brokers">Broker connections</Link></header>
    <section className="trading-hero"><div className="proof-label">PHASE 002 · HUMAN-AUTHORISED EXECUTION</div><h1>Trading workspace</h1>
      <p>Propose, risk-check, approve and confirm each order yourself. Trading 212 is the record of what actually executed. No model, agent or background job can submit an order.</p>
      <div className="recovery-notice" data-testid="trading-status"><strong>Live submission is {flags.live?'enabled on this server':'disabled on this server'}.</strong> Demo submission is {flags.demo?'enabled':'disabled'}. Enabling Live requires a separate owner activation decision.</div></section>
    {configured?<ConnectedTrading flags={flags}/>:<div className="proof-empty"><strong>Trading storage is not configured.</strong><p>Clerk, Convex and the broker vault must be configured first.</p></div>}
  </main></div>;
}
