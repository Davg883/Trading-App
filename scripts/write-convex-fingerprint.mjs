// Regenerates convex/deploymentFingerprint.ts from the current sources. Run before committing Convex/lib changes and
// before `npx convex deploy`; tests/release-fingerprint.test.ts fails when the committed value is stale.
import fs from 'node:fs';
import {computeConvexFingerprint, renderFingerprintModule, FINGERPRINT_FILE} from './lib/convex-fingerprint.mjs';

const fp = computeConvexFingerprint(process.cwd());
const next = renderFingerprintModule(fp);
const current = fs.existsSync(FINGERPRINT_FILE) ? fs.readFileSync(FINGERPRINT_FILE, 'utf8').replace(/\r\n/g, '\n') : '';
if (current === next) {
  console.log(`${FINGERPRINT_FILE} up to date: ${fp.sourceSha256} (${fp.fileCount} files, ${fp.packageCount} packages)`);
} else {
  fs.writeFileSync(FINGERPRINT_FILE, next);
  console.log(`${FINGERPRINT_FILE} written: ${fp.sourceSha256} (${fp.fileCount} files, ${fp.packageCount} packages)`);
}
if (process.argv.includes('--list')) {
  for (const f of fp.files) console.log(`  ${f}`);
  for (const p of fp.packages) console.log(`  pkg ${p}`);
}
