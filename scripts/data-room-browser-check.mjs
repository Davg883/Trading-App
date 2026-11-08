import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const PORT = 3108;
const BASE_URL = `http://localhost:${PORT}`;

async function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return;
    } catch {
      // Wait for server
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  const server = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['next', 'start', '-H', 'localhost', '-p', String(PORT)],
    { stdio: 'pipe', shell: true },
  );

  const browser = await chromium.launch({ headless: true, channel: 'msedge' });

  try {
    await waitForServer(`${BASE_URL}/data-room`);

    // 1. Desktop viewport (1440x900)
    const desktopCtx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await desktopCtx.newPage();
    const consoleErrors = [];
    page.on('pageerror', (err) => consoleErrors.push(err.message));

    await page.goto(`${BASE_URL}/data-room`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="macro-data-room"]');

    // Verify Live TypeDB 3.14.2 pill is displayed
    const pillText = await page.textContent('[data-testid="typedb-live-pill"]');
    if (!pillText?.includes('LIVE (3.14.2)')) {
      throw new Error(`Expected live TypeDB 3.14.2 status pill, got: ${pillText}`);
    }

    // Verify all 5 views render cleanly and right-hand desktop evidence drawer updates
    await page.click('[data-testid="tab-sector_intelligence"]');
    await page.waitForSelector('[data-testid="view-sector-intelligence"]');

    await page.click('[data-testid="tab-relationship_explorer"]');
    await page.waitForSelector('[data-testid="view-relationship-explorer"]');

    // Test point-in-time date machine (2026-09-25 vs 2026-11-05)
    await page.selectOption('[data-testid="as-of-select"]', '1790380800000');
    await page.selectOption('[data-testid="focal-entity-select"]', 'org-msft');
    await page.waitForSelector('[data-testid="rel-card-rel-loughton-msft-r1"]');

    await page.selectOption('[data-testid="as-of-select"]', '1793900000000');
    await page.waitForSelector('[data-testid="rel-card-rel-loughton-msft-r2"]');

    await page.click('[data-testid="tab-risk_pathways"]');
    await page.waitForSelector('[data-testid="view-risk-pathways"]');

    await page.click('[data-testid="tab-evidence_room"]');
    await page.waitForSelector('[data-testid="view-evidence-room"]');
    await page.waitForSelector('[data-testid="conflict-conflict-polaris-forge-2-tenant"]');

    const desktopDrawerVisible = await page.isVisible('[data-testid="desktop-evidence-drawer"]');
    if (!desktopDrawerVisible) {
      throw new Error('Expected persistent right-hand desktop evidence drawer to be visible at 1440x900');
    }

    await desktopCtx.close();

    // 2. Mobile viewport (412x915)
    const mobileCtx = await browser.newContext({
      viewport: { width: 412, height: 915 },
    });
    const mPage = await mobileCtx.newPage();
    await mPage.goto(`${BASE_URL}/data-room`, { waitUntil: 'networkidle' });
    await mPage.waitForSelector('[data-testid="macro-data-room"]');

    // Trigger mobile evidence drawer by clicking a relationship card
    await mPage.click('[data-testid="tab-relationship_explorer"]');
    await mPage.click('[data-testid="rel-card-rel-loughton-msft-r2"]');
    await mPage.waitForSelector('[data-testid="mobile-evidence-drawer"]');

    // Press Escape to close mobile modal drawer
    await mPage.keyboard.press('Escape');
    const stillVisible = await mPage.isVisible('[data-testid="mobile-evidence-drawer"]');
    if (stillVisible) {
      throw new Error('Expected mobile evidence drawer to close on Escape');
    }

    if (consoleErrors.length > 0) {
      throw new Error(`Console page errors encountered: ${consoleErrors.join('; ')}`);
    }

    await mobileCtx.close();
    console.log('PASS: Macro Intelligence Data Room (/data-room) verified on desktop (1440x900) and mobile (412x915) with live TypeDB 3.14.2.');
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
