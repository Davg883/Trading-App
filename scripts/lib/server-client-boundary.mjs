// G9.3.3 — server/client module boundary checks.
//
// Defect this guards against: app/api/graph/chat/route.ts imported validateClerkConvexJwtClaims from a 'use client'
// module. Next.js compiled that import into a client-reference stub that throws when called on the server, the
// route's catch turned the throw into 401, and every signed-in chat request failed. Vitest does not apply
// 'use client' semantics, so unit tests could not see it.
//
// 1. scanServerEntry(): static — walks the relative/aliased import closure of a server entry (route handler) and
//    reports any module in it that starts with a 'use client' directive or imports the 'client-only' package.
// 2. scanCompiledApiRoutes(): post-build — for every compiled app/api route in .next/server, scans the chunks the
//    route loads for client-reference stubs ("Attempted to call X() from the server but X is on the client").
//    API routes render no components, so any such stub in their chunks is a defect.
import fs from 'node:fs';
import path from 'node:path';

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.jsx'];
const CLIENT_ONLY_PACKAGES = new Set(['client-only']);

function stripLeadingComments(src) {
  let s = src.replace(/^﻿/, '');
  for (;;) {
    const t = s.trimStart();
    if (t.startsWith('//')) { s = t.slice(t.indexOf('\n') + 1 || t.length); continue; }
    if (t.startsWith('/*')) { const end = t.indexOf('*/'); s = end < 0 ? '' : t.slice(end + 2); continue; }
    return t;
  }
}

export function hasUseClientDirective(src) {
  return /^['"]use client['"]\s*;?/.test(stripLeadingComments(src));
}

/** Value imports only: `import type` / `export type` are erased and never reach a bundle. */
export function importSpecifiers(src) {
  const out = new Set();
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const re = /(?:^|[;\n])\s*(import|export)\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]|(?:^|[;\n])\s*import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of code.matchAll(re)) {
    if (m[4]) { if (!m[2]) out.add(m[4]); continue; }
    const spec = m[5] ?? m[6] ?? m[7];
    if (spec) out.add(spec);
  }
  return [...out];
}

function resolveLocal(root, fromFile, spec) {
  let base;
  if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else if (spec.startsWith('@/')) base = path.resolve(root, spec.slice(2));
  else return null;
  const candidates = [base, ...EXTENSIONS.map((e) => base + e), ...EXTENSIONS.map((e) => path.join(base, `index${e}`))];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile() && EXTENSIONS.includes(path.extname(c))) return c;
  }
  return null;
}

/** Returns [{module, reason, chain}] for every client-only module reachable from `entryFile`. */
export function scanServerEntry(root, entryFile) {
  const violations = [];
  const seen = new Set();
  const queue = [[path.resolve(entryFile), [path.relative(root, entryFile)]]];
  while (queue.length) {
    const [file, chain] = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const src = fs.readFileSync(file, 'utf8');
    if (file !== path.resolve(entryFile) && hasUseClientDirective(src)) {
      violations.push({module: path.relative(root, file).split(path.sep).join('/'), reason: "'use client' module", chain});
      continue; // do not descend: everything below is already client-side
    }
    for (const spec of importSpecifiers(src)) {
      if (CLIENT_ONLY_PACKAGES.has(spec)) {
        violations.push({module: spec, reason: 'client-only package', chain});
        continue;
      }
      const resolved = resolveLocal(root, file, spec);
      if (resolved && !seen.has(resolved)) queue.push([resolved, [...chain, path.relative(root, resolved).split(path.sep).join('/')]]);
    }
  }
  return violations;
}

export function findRouteHandlers(root) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/^route\.(ts|tsx|js|mjs)$/.test(e.name)) out.push(p);
    }
  };
  walk(path.join(root, 'app'));
  return out.sort();
}

const STUB_RE = /Attempted to call ([A-Za-z_$][\w$]*)\(\) from the server but \1 is on the client/g;

/** Post-build: client-reference stubs present in the chunks loaded by each compiled app/api route. */
export function scanCompiledApiRoutes(nextDir) {
  const serverDir = path.join(nextDir, 'server');
  const apiDir = path.join(serverDir, 'app', 'api');
  const routes = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'route.js') routes.push(p);
    }
  };
  if (fs.existsSync(apiDir)) walk(apiDir);
  return routes.sort().map((routeFile) => {
    const src = fs.readFileSync(routeFile, 'utf8');
    const chunks = [...new Set([...src.matchAll(/R\.c\("(server\/chunks\/[^"]+\.js)"\)/g)].map((m) => m[1]))];
    const files = [routeFile, ...chunks.map((c) => path.join(nextDir, c))].filter((f) => fs.existsSync(f));
    const stubs = [];
    const contents = [];
    for (const f of files) {
      const code = fs.readFileSync(f, 'utf8');
      contents.push(code);
      for (const m of code.matchAll(STUB_RE)) stubs.push({chunk: path.relative(nextDir, f).split(path.sep).join('/'), fn: m[1]});
    }
    return {route: path.relative(serverDir, routeFile).split(path.sep).join('/'), chunkCount: chunks.length, stubs, code: contents.join('\n')};
  });
}
