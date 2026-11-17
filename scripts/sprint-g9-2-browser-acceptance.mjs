// Sprint G9.2 — repeatable browser acceptance for release compatibility, briefing provenance and scheduler honesty.
// Usage: node scripts/sprint-g9-2-browser-acceptance.mjs <baseUrl> <label> <outDir> [--require-compatible]
// Records /api/health/release, the Market Radar briefing provenance and labels, the scheduler and external-news status,
// and refresh/navigation persistence. With --require-compatible it exits 1 unless frontend and backend fingerprints match.
import {chromium} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const [BASE, LABEL, OUT] = process.argv.slice(2);
const requireCompatible = process.argv.includes('--require-compatible');
if (!BASE || !LABEL || !OUT) throw new Error('usage: <baseUrl> <label> <outDir> [--require-compatible]');
fs.mkdirSync(OUT, {recursive: true});
const report = {base: BASE, label: LABEL, startedAt: new Date().toISOString(), checks: [], pageErrors: []};
const squash = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
const text = async (p, sel, timeout = 20000) => {
  try {
    await p.waitForSelector(sel, {timeout, state: 'attached'});
    return squash(await p.locator(sel).first().textContent());
  } catch {
    return null;
  }
};

const browser = await chromium.launch({headless: true, channel: 'msedge'});
let compatible = false;
try {
  const ctx = await browser.newContext({viewport: {width: 1440, height: 1000}});
  const p = await ctx.newPage();
  p.on('pageerror', (e) => report.pageErrors.push(e.message));

  // 1. Release compatibility (frontend build vs running Convex functions)
  const rel = await p.request.get(`${BASE}/api/health/release`, {maxRedirects: 0});
  const relBody = rel.status() === 200 ? await rel.json() : {status: rel.status(), location: rel.headers().location ?? null};
  compatible = Boolean(relBody.compatible);
  report.checks.push({id: 'release-fingerprint', httpStatus: rel.status(), ...relBody});

  // 2. Market Radar: briefing provenance, labels and scheduler/news honesty
  await p.goto(`${BASE}/`, {waitUntil: 'networkidle', timeout: 90000});
  await p.waitForSelector('[data-testid=command-centre]', {timeout: 60000});
  const capture = async () => ({
    heading: await text(p, '#g6-briefing-title'),
    asOf: await text(p, '[data-testid=briefing-observation-asof]', 5000),
    lastRefreshed: await text(p, '[data-testid=briefing-last-refreshed]', 3000),
    freshnessNotice: await text(p, '[data-testid=briefing-freshness-notice]', 3000),
    briefingSource: await p.getAttribute('[data-testid=morning-brief-panel]', 'data-briefing-source').catch(() => null),
    briefingTitle: await text(p, '#morning-brief-title', 5000),
    bundledNotice: await text(p, '[data-testid=brief-bundled-notice]', 3000),
    withheldFacts: await text(p, '[data-testid=brief-withheld-facts]', 2000),
    schedulerLayer: await text(p, '[data-testid=layer-scheduler]', 5000),
    externalNews: await text(p, '[data-testid=external-news-ingestion]', 3000),
    newsAgentRow: await text(p, '[data-job=news_discovery_agent] th', 3000),
    nextRunSec: await text(p, '[data-testid=job-next-run-sec_filings_collect]', 3000),
  });
  const first = await capture();
  await p.screenshot({path: path.join(OUT, `${LABEL}-market-radar.png`), fullPage: true});
  await p.locator('[data-testid=technical-evidence-details] summary').first().click().catch(() => {});
  await p.screenshot({path: path.join(OUT, `${LABEL}-market-radar-operations.png`), fullPage: true});
  report.checks.push({id: 'market-radar', ...first});

  // 3. Refresh and navigation persistence
  const runs = [];
  for (let i = 0; i < 2; i++) {
    await p.reload({waitUntil: 'networkidle', timeout: 90000});
    await p.waitForSelector('[data-testid=command-centre]', {timeout: 60000});
    runs.push({heading: await text(p, '#g6-briefing-title'), briefingSource: await p.getAttribute('[data-testid=morning-brief-panel]', 'data-briefing-source').catch(() => null)});
  }
  await p.goto(`${BASE}/stress`, {waitUntil: 'networkidle', timeout: 90000});
  await p.goBack({waitUntil: 'networkidle', timeout: 90000});
  await p.waitForSelector('[data-testid=command-centre]', {timeout: 60000});
  runs.push({heading: await text(p, '#g6-briefing-title'), briefingSource: await p.getAttribute('[data-testid=morning-brief-panel]', 'data-briefing-source').catch(() => null)});
  report.checks.push({id: 'refresh-navigation', runs, stable: runs.every((r) => r.heading === first.heading && r.briefingSource === first.briefingSource)});
} finally {
  await browser.close();
}
report.finishedAt = new Date().toISOString();
report.releaseVerdict = report.checks[0]?.verdict ?? 'UNKNOWN';
fs.writeFileSync(path.join(OUT, `${LABEL}-report.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
if (requireCompatible && !compatible) {
  console.error(`RELEASE GATE FAIL: ${report.releaseVerdict}`);
  process.exit(1);
}
