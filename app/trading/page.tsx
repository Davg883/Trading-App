import type {Metadata} from 'next';
import Link from 'next/link';
import ConnectedTrading from '../../integrations/connected-trading';
import {verifyBrokerVaultSelfTest} from '../../lib/brokers/vault';
import {executionPermitted} from '../../lib/trading/execution-boundary';
import '../proof-scale/proof-scale.css';
import '../recovery/recovery.css';
import './trading.css';

export const metadata:Metadata={title:'Trading Workspace | AI Capital Intelligence',description:'Human-authorised Trading 212 order proposals, confirmations and broker records.'};
export const dynamic='force-dynamic';
export default function TradingPage(){
  const clerkSec=process.env['CLERK_'+'SECRET_KEY'];const configured=Boolean(process.env.NEXT_PUBLIC_CONVEX_URL&&process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY&&clerkSec&&verifyBrokerVaultSelfTest().ready);
  // Server-side flags only. Live submission stays off unless LIVE_TRADING_ENABLED is exactly "true".
  const permitted=executionPermitted();
  const flags={demo:permitted&&process.env.DEMO_TRADING_ENABLED==='true',live:permitted&&process.env.LIVE_TRADING_ENABLED==='true'};
  return <div className="proof-shell trading-shell"><main className="proof-main">
    <header className="proof-topbar"><Link href="/">← Market Radar</Link><Link href="/settings/brokers">Broker connections</Link></header>
    <section className="trading-hero"><div className="proof-label">PHASE 002 · HUMAN-AUTHORISED EXECUTION</div><h1>Trading workspace</h1>
      <p>Propose, risk-check, approve and confirm each order yourself. Trading 212 is the record of what actually executed. No model, agent or background job can submit an order.</p>
      {!permitted&&<div className="recovery-notice" data-testid="research-only-notice"><strong>Research-only deployment.</strong> This build has no order-execution authority (<code>executionAuthority: none</code>). Trading keys cannot be saved and orders cannot be confirmed, submitted or cancelled, whatever the server flags are set to. Order drafts and risk checks remain available as research records only.</div>}
      <div className="recovery-notice" data-testid="trading-status"><strong>Live submission is {flags.live?'enabled on this server':'disabled on this server'}.</strong> Demo submission is {flags.demo?'enabled':'disabled'}. Enabling Live requires a separate owner activation decision.</div></section>
    {configured?<ConnectedTrading flags={flags}/>:<div className="proof-empty"><strong>Trading storage is not configured.</strong><p>Clerk, Convex and the broker vault must be configured first.</p></div>}
  </main></div>;
}
