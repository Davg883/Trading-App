import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  fs.mkdirSync('test-results', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // 1. Navigate to /research-chat (opens directly on View 6: Evidence-Locked AI Chat)
  await page.goto(`${BASE_URL}/research-chat`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('view-evidence-chat')).toBeVisible();
  await expect(page.getByTestId('evidence-chat-panel')).toBeVisible();
  await expect(page.getByTestId('chat-namespace-badge')).toContainText('public_research only');
  await expect(page.getByTestId('chat-broker-lock-badge')).toContainText('ZERO ACCESS');

  // 2. Click Starter Question 1 ("Which AI infrastructure investments share documented financial counterparties?")
  await page.getByTestId('starter-q-1').click();
  await expect(page.getByTestId('chat-turn-0')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('chat-support-status-0')).toContainText('FULLY SUPPORTED');
  await expect(page.getByTestId('chat-validator-badge-0')).toContainText('9/9 Checks Passed');
  await expect(page.getByTestId('chat-short-answer-0')).toContainText('Anthropic');
  await expect(page.getByTestId('chat-short-answer-0')).toContainText('Nscale');

  // 3. Click an evidence citation button inside Claim 1 and verify the desktop right-hand evidence drawer highlights/updates
  const firstCitation = page.locator('[data-testid^="citation-ev-"]').first();
  await expect(firstCitation).toBeVisible();
  await firstCitation.click();
  await expect(page.getByTestId('desktop-evidence-drawer')).toBeVisible();

  await page.screenshot({
    path: 'test-results/phase-g4-research-chat-desktop.png',
    fullPage: false,
  });

  // 4. Ask unsupported question ("What is Anthropic's projected 2029 net income in Ireland?") -> verify explicit abstention
  await page
    .getByTestId('evidence-chat-input')
    .fill("What is Anthropic's projected 2029 net income in Ireland?");
  await page.getByTestId('evidence-chat-submit').click();
  await expect(page.getByTestId('chat-turn-1')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('chat-support-status-0')).toContainText(
    'NO SUPPORTING EVIDENCE (EXPLICIT ABSTENTION)',
  );
  await expect(page.getByTestId('chat-abstention-banner-0')).toBeVisible();
  await expect(page.getByTestId('chat-abstention-banner-0')).toContainText('2029 net income');

  await page.screenshot({
    path: 'test-results/phase-g4-abstention-cutoff-desktop.png',
    fullPage: false,
  });

  // 5. Switch to Mobile Viewport (412x915), verify mobile drawer, close it, then click a relationship citation pill to re-open it
  await page.setViewportSize({ width: 412, height: 915 });
  if ((await page.getByTestId('mobile-evidence-drawer').count()) > 0) {
    await page.getByRole('button', { name: 'Close evidence drawer' }).click();
    await expect(page.getByTestId('mobile-evidence-drawer')).toHaveCount(0);
  }
  const relCitation = page.locator('[data-testid^="citation-rel-"]').first();
  await relCitation.scrollIntoViewIfNeeded();
  await relCitation.click();
  await expect(page.getByTestId('mobile-evidence-drawer')).toBeVisible();

  await page.screenshot({
    path: 'test-results/phase-g4-research-chat-mobile-drawer.png',
    fullPage: false,
  });

  await page.getByRole('button', { name: 'Close evidence drawer' }).click();
  await expect(page.getByTestId('mobile-evidence-drawer')).toHaveCount(0);

  if (errors.length > 0) {
    throw new Error(`Browser page errors:\n${errors.join('\n')}`);
  }

  console.log(
    `Phase G.4 Evidence-Locked AI Chat browser check passed on ${BASE_URL} (Desktop 1440x950 + Mobile 412x915, citations, historical cutoff abstention, and evidence drawer).`,
  );
} finally {
  await browser.close();
}
