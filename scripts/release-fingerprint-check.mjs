// Sprint G9.2 release gate. Exits non-zero unless the frontend and Convex backend are built from the same sources.
//
//   node scripts/release-fingerprint-check.mjs                 # local sources vs the Convex deployment in .env.local
//   node scripts/release-fingerprint-check.mjs --convex-url URL # local sources vs a given Convex deployment
//   node scripts/release-fingerprint-check.mjs --app-url URL    # a running frontend's /api/health/release verdict
import fs from 'node:fs';
import {ConvexHttpClient} from 'convex/browser';
import {makeFunctionReference} from 'convex/server';
import {computeConvexFingerprint} from './lib/convex-fingerprint.mjs';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};
const fail = (msg) => {
  console.error(`RELEASE GATE FAIL: ${msg}`);
  process.exit(1);
};

const appUrl = arg('--app-url');
if (appUrl) {
  const res = await fetch(new URL('/api/health/release', appUrl), {redirect: 'manual', cache: 'no-store'});
  if (res.status !== 200) fail(`${appUrl}/api/health/release answered HTTP ${res.status}${res.headers.get('location') ? ` -> ${res.headers.get('location')}` : ''}`);
  const body = await res.json();
  console.log(JSON.stringify(body, null, 2));
  if (!body.compatible) fail(`${body.verdict}: ${body.detail}`);
  console.log(`RELEASE GATE PASS: ${body.detail}`);
  process.exit(0);
}

const local = computeConvexFingerprint(process.cwd());
const committed = fs.readFileSync('convex/deploymentFingerprint.ts', 'utf8');
if (!committed.includes(local.sourceSha256)) {
  fail(`convex/deploymentFingerprint.ts is stale (sources hash ${local.sourceSha256}); run npm run convex:fingerprint and commit.`);
}
let convexUrl = arg('--convex-url');
if (!convexUrl && fs.existsSync('.env.local')) {
  convexUrl = /^NEXT_PUBLIC_CONVEX_URL=(.+)$/m.exec(fs.readFileSync('.env.local', 'utf8'))?.[1]?.trim().replace(/^"|"$/g, '') ?? null;
}
if (!convexUrl) fail('No Convex URL (pass --convex-url or set NEXT_PUBLIC_CONVEX_URL in .env.local).');
let backend;
try {
  backend = await new ConvexHttpClient(convexUrl, {logger: false}).query(makeFunctionReference('release:fingerprint'), {});
} catch (error) {
  fail(`backend ${convexUrl} has no usable release:fingerprint (${error instanceof Error ? error.message.split('\n')[0] : error}); it predates fingerprinting or is unreachable.`);
}
console.log(JSON.stringify({local: {sourceSha256: local.sourceSha256, fileCount: local.fileCount, packageCount: local.packageCount}, backend, convexUrl}, null, 2));
if (backend.sourceSha256 !== local.sourceSha256 || backend.contractVersion !== local.contractVersion) {
  fail(`backend runs ${backend.sourceSha256} but local sources are ${local.sourceSha256}.`);
}
console.log(`RELEASE GATE PASS: backend ${convexUrl} runs the same Convex sources (${local.sourceSha256}).`);
