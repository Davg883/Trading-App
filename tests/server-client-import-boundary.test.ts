import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {
  findRouteHandlers,
  hasUseClientDirective,
  importSpecifiers,
  scanServerEntry,
} from '../scripts/lib/server-client-boundary.mjs';

/**
 * G9.3.3 regression: server route handlers must never import a 'use client' module, directly or indirectly.
 * In a Next.js server bundle such an import becomes a client-reference stub that throws when called; the chat route's
 * catch turned that into 401 for every signed-in user. Vitest ignores 'use client', so this static check (and the
 * post-build `npm run check:server-bundle`) is what catches it.
 */
const ROOT = path.resolve(__dirname, '..');

describe('server/client import boundary', () => {
  const routes = findRouteHandlers(ROOT);

  it('finds every app route handler, including the chat route', () => {
    const rel = routes.map((r) => path.relative(ROOT, r).split(path.sep).join('/'));
    expect(rel).toContain('app/api/graph/chat/route.ts');
    expect(rel.length).toBeGreaterThanOrEqual(13);
  });

  it.each(findRouteHandlers(ROOT).map((r) => [path.relative(ROOT, r).split(path.sep).join('/'), r]))(
    '%s imports no client-only module (transitively)',
    (_rel, file) => {
      expect(scanServerEntry(ROOT, file)).toEqual([]);
    },
  );

  it('negative control: detects a route importing the client auth module, with the import chain', () => {
    const v = scanServerEntry(ROOT, path.join(ROOT, 'tests/fixtures/server-client-boundary/bad-route.ts'));
    expect(v).toEqual([
      {
        module: 'lib/clerk-convex-auth.ts',
        reason: "'use client' module",
        chain: [path.join('tests', 'fixtures', 'server-client-boundary', 'bad-route.ts'), 'lib/clerk-convex-auth.ts'],
      },
    ]);
  });

  it('the client auth module is client-only and the server claim module is not', () => {
    expect(hasUseClientDirective(fs.readFileSync(path.join(ROOT, 'lib/clerk-convex-auth.ts'), 'utf8'))).toBe(true);
    expect(hasUseClientDirective(fs.readFileSync(path.join(ROOT, 'lib/auth/clerk-jwt-claims.ts'), 'utf8'))).toBe(false);
  });

  it('import parsing: value imports, re-exports and dynamic imports count; type-only imports do not', () => {
    const src = [
      "import type { A } from './types';",
      "import { b, type C } from './values';",
      "export { d } from './reexport';",
      "export type { E } from './typeonly';",
      "import './side-effect';",
      "const m = await import('./lazy');",
    ].join('\n');
    expect(importSpecifiers(src).sort()).toEqual(['./lazy', './reexport', './side-effect', './values']);
  });

  it("directive detection tolerates leading comments and ignores 'use client' later in a file", () => {
    expect(hasUseClientDirective("// header\n/* note */\n'use client';\nexport const x=1;")).toBe(true);
    expect(hasUseClientDirective("export const x='use client';")).toBe(false);
  });
});
