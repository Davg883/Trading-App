// G9.3.3 post-build gate: no compiled app/api route may load a client-reference stub, and the chat route must contain
// the real server-side claim validation. Run after `next build`: npm run check:server-bundle
import path from 'node:path';
import {scanCompiledApiRoutes} from './lib/server-client-boundary.mjs';

const nextDir = path.resolve(process.argv[2] ?? '.next');
const routes = scanCompiledApiRoutes(nextDir);
if (routes.length === 0) {
  console.error(`No compiled API routes found under ${nextDir}/server/app/api — run next build first.`);
  process.exit(1);
}
let failed = false;
for (const r of routes) {
  const status = r.stubs.length ? `FAIL client-reference stubs: ${[...new Set(r.stubs.map((s) => s.fn))].join(', ')}` : 'ok';
  console.log(`${r.route} (${r.chunkCount} chunks): ${status}`);
  if (r.stubs.length) failed = true;
}
const chat = routes.find((r) => r.route === 'app/api/graph/chat/route.js');
if (!chat) {
  console.error('Compiled chat route not found.');
  process.exit(1);
}
// Markers that only exist in the real implementation (env names read by the validator, the 401 codes it drives).
const markers = ['CLERK_ALLOWED_AZP_ORIGINS', 'CLERK_JWT_ISSUER_DOMAIN', 'token_expired', 'invalid_token'];
const missing = markers.filter((m) => !chat.code.includes(m));
console.log(`chat route real claim-validation markers: ${missing.length ? `MISSING ${missing.join(', ')}` : 'present'}`);
if (missing.length) failed = true;
if (failed) {
  console.error('SERVER BUNDLE CHECK FAIL');
  process.exit(1);
}
console.log('SERVER BUNDLE CHECK PASS');
