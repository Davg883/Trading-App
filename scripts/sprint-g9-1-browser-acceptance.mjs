// Sprint G9.1 — real-browser source-to-screen acceptance (public pages, refresh/navigation persistence, two-user isolation).
// Usage: node scripts/sprint-g9-1-browser-acceptance.mjs <baseUrl> <label> <outDir> [ticketFile] [ownerLiveConnectionId]
// Unauthenticated checks run everywhere. Signed-in checks run only when a ticket file is given (dedicated Clerk
// development test user, Clerk `ticket` strategy; no credential is typed into any page; the user is signed out at the end).
import {chromium} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const [BASE, LABEL, OUT, TICKET_FILE, OWNER_CONN] = process.argv.slice(2);
if (!BASE || !LABEL || !OUT) throw new Error('usage: <baseUrl> <label> <outDir> [ticketFile] [ownerLiveConnectionId]');
fs.mkdirSync(OUT, {recursive: true});
const report = {base: BASE, label: LABEL, startedAt: new Date().toISOString(), checks: [], pageErrors: [], consoleErrors: []};
const squash = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
const text = async (p, sel, timeout = 30000) => {
  try {
    await p.waitForSelector(sel, {timeout});
    return squash(await p.locator(sel).first().innerText());
  } catch {
    return null;
  }
};
const shot = (p, name) => p.screenshot({path: path.join(OUT, `${LABEL}-${name}.png`), fullPage: true});

async function captureHome(p) {
  await p.goto(`${BASE}/`, {waitUntil: 'networkidle', timeout: 90000});
  await p.waitForSelector('[data-testid=command-centre]', {timeout: 60000});
  const heading = await text(p, '#g6-briefing-title', 20000);
  const asOf = await text(p, '[data-testid=briefing-observation-asof]', 5000);
  const prov = await text(p, '[data-testid=briefing-provenance-pill]', 5000);
  const refreshed = await text(p, '[data-testid=briefing-last-refreshed]', 5000);
  const notice = await text(p, '[data-testid=briefing-freshness-notice]', 5000);
  const fresh = await text(p, '[data-testid=freshness]', 5000);
  const brief = await text(p, '[data-testid=morning-brief-panel]', 5000);
  const facts = await text(p, '[data-testid=brief-confirmed-facts]', 5000);
  const syncPill = await text(p, '[data-testid=broker-last-sync-pill]', 3000);
  const rows = await p.locator('[data-testid=stock-research-table] tbody tr').evaluateAll((trs) => trs.map((tr) => tr.innerText.replace(/\s+/g, ' ').trim().slice(0, 220)));
  const jobs = await p.locator('[data-testid^=job-freshness-]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-testid')}=${e.innerText.trim()}`));
  const nextRuns = await p.locator('[data-testid^=job-next-run-]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-testid')}=${e.innerText.trim()}`));
  const cursorUnchanged = await p.locator('text=cursor unchanged').count();
  const briefingText = await p.locator('[data-testid=executive-market-briefing]').innerText().catch(() => '');
  return {
    heading, asOf, prov, refreshed, notice, fresh, syncPill,
    briefSnippet: brief ? brief.slice(0, 700) : null,
    factsSnippet: facts ? facts.slice(0, 900) : null,
    watchlistRows: rows, jobFreshness: jobs, nextRuns, cursorUnchangedMentions: cursorUnchanged,
    briefingMentions20261104: briefingText.includes('2026-11-04'),
  };
}

const browser = await chromium.launch({headless: true, channel: 'msedge'});
try {
  const ctx = await browser.newContext({viewport: {width: 1440, height: 1000}});
  const p = await ctx.newPage();
  p.on('pageerror', (e) => report.pageErrors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(m.text().slice(0, 300)); });

  // 1. Market Radar (public; server-rendered from Convex publicOperationsOverview)
  const home1 = await captureHome(p);
  await shot(p, 'market-radar');
  report.checks.push({id: 'home-initial', ...home1});

  // 2. Refresh persistence: reload three times, then navigate away to /stress and back
  const reloads = [];
  for (let i = 0; i < 3; i++) {
    await p.reload({waitUntil: 'networkidle', timeout: 90000});
    await p.waitForSelector('[data-testid=command-centre]', {timeout: 60000});
    reloads.push({heading: await text(p, '#g6-briefing-title', 20000), asOf: await text(p, '[data-testid=briefing-observation-asof]', 5000), refreshed: await text(p, '[data-testid=briefing-last-refreshed]', 3000)});
  }
  await p.goto(`${BASE}/stress`, {waitUntil: 'networkidle', timeout: 90000});
  await p.waitForSelector('.stress-alert', {timeout: 60000});
  const stressAlert = await text(p, '.stress-alert');
  const stressChip = await text(p, '#market .stress-panel-head', 10000);
  const stressRows = await p.locator('#market .stress-table tbody tr').evaluateAll((trs) => trs.map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.innerText.replace(/\s+/g, ' ').trim()).join(' || ').slice(0, 420)));
  await shot(p, 'stress');
  report.checks.push({id: 'stress', alert: stressAlert, chip: stressChip, rows: stressRows});
  await p.goBack({waitUntil: 'networkidle', timeout: 90000});
  await p.waitForSelector('[data-testid=command-centre]', {timeout: 60000});
  const homeBack = {heading: await text(p, '#g6-briefing-title', 20000), asOf: await text(p, '[data-testid=briefing-observation-asof]', 5000)};
  const stable = [...reloads, homeBack].every((r) => r.heading === home1.heading && r.asOf === home1.asOf);
  report.checks.push({id: 'refresh-navigation-persistence', initial: {heading: home1.heading, asOf: home1.asOf}, reloads, afterBack: homeBack, stable, fallbackTo20261104: [home1, ...reloads, homeBack].some((r) => (r.heading || '').includes('2026-11-04'))});

  // 3. Broker settings, unauthenticated
  await p.goto(`${BASE}/settings/brokers`, {waitUntil: 'networkidle', timeout: 90000});
  const brokersAnon = squash(await p.locator('body').innerText()).slice(0, 600);
  await shot(p, 'brokers-anonymous');
  report.checks.push({id: 'brokers-anonymous', text: brokersAnon, envBadges: [await text(p, '[data-testid=broker-env-badge-live]', 3000), await text(p, '[data-testid=broker-env-badge-demo]', 3000)]});

  // 4. Signed-in dedicated test user (ticket strategy): isolation from the owner's broker records
  if (TICKET_FILE && fs.existsSync(TICKET_FILE)) {
    const ticket = fs.readFileSync(TICKET_FILE, 'utf8').trim();
    await p.goto(`${BASE}/settings/brokers`, {waitUntil: 'networkidle', timeout: 90000});
    await p.waitForFunction(() => window.Clerk?.loaded, null, {timeout: 60000});
    const status = await p.evaluate(async (tk) => {
      const c = window.Clerk;
      const si = await c.client.signIn.create({strategy: 'ticket', ticket: tk});
      if (si.status !== 'complete') return si.status;
      await c.setActive({session: si.createdSessionId});
      return 'complete';
    }, ticket);
    report.checks.push({id: 'test-user-signin', status});
    if (status === 'complete') {
      await p.reload({waitUntil: 'networkidle', timeout: 90000});
      const who = await p.evaluate(() => ({externalId: window.Clerk?.user?.externalId ?? null, id: window.Clerk?.user?.id ?? null}));
      const liveBadge = await text(p, '[data-testid=broker-env-badge-live]', 30000);
      const demoBadge = await text(p, '[data-testid=broker-env-badge-demo]', 5000);
      const syncPanel = await text(p, '[data-testid=broker-sync-panel]', 15000);
      const api = await p.evaluate(async () => { const r = await fetch('/api/brokers', {cache: 'no-store'}); return {status: r.status, body: await r.text()}; });
      let crossDetail = null, crossSync = null;
      if (OWNER_CONN) {
        crossDetail = await p.evaluate(async (id) => { const r = await fetch(`/api/brokers?connectionId=${encodeURIComponent(id)}`, {cache: 'no-store'}); return {status: r.status, body: (await r.text()).slice(0, 300)}; }, OWNER_CONN);
        crossSync = await p.evaluate(async (id) => { const r = await fetch('/api/brokers/sync', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({connectionId: id, environment: 'live', operation: 'test'})}); return {status: r.status, body: (await r.text()).slice(0, 300)}; }, OWNER_CONN);
      }
      await shot(p, 'brokers-test-user');
      await p.goto(`${BASE}/`, {waitUntil: 'networkidle', timeout: 90000});
      await p.waitForSelector('[data-testid=command-centre]', {timeout: 60000});
      const kpiEmpty = await text(p, '[data-testid=kpi-empty]', 10000);
      const source = await p.getAttribute('[data-testid=command-centre]', 'data-source');
      await shot(p, 'home-test-user');
      report.checks.push({id: 'test-user-isolation', who, liveBadge, demoBadge, syncPanelSnippet: syncPanel ? syncPanel.slice(0, 400) : null, apiBrokers: {status: api.status, body: api.body.slice(0, 400)}, crossOwnerDetail: crossDetail, crossOwnerSync: crossSync, homeKpiEmpty: kpiEmpty, homeDataSource: source});
      await p.evaluate(async () => { await window.Clerk.signOut(); });
      report.checks.push({id: 'test-user-signout', done: true});
    }
  }
} finally {
  await browser.close();
}
report.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(OUT, `${LABEL}-report.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
