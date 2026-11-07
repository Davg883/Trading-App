import Link from 'next/link';
import ConnectedWorkspace from '../../integrations/connected-workspace';

export default function WorkspacePage() {
  const configured = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
  return <main style={{maxWidth:1100,margin:'40px auto',padding:24}}>
    <Link href="/">← Back to research demo</Link>
    <h1>Connected research workspace</h1>
    <p>Authenticated, private Convex records. This workspace contains no preloaded market observations.</p>
    {configured ? <ConnectedWorkspace/> : <section style={{padding:24,border:'1px solid #344047',borderRadius:16,marginTop:24}}>
      <h2>Ready for your connections</h2>
      <p>The interactive synthetic laboratory is available now. To enable persistent private records, configure Convex and Clerk using the project README.</p>
      <ul><li>NEXT_PUBLIC_CONVEX_URL</li><li>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</li><li>CLERK_SECRET_KEY</li><li>CLERK_JWT_ISSUER_DOMAIN in Convex</li></ul>
      <p>Provider ingestion and model runs require their own credentials and setup. Adding a key does not import data automatically.</p>
    </section>}
  </main>;
}
