import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const DEFAULT_PORT = 3109;
const BASE_URL = process.env.BASE_URL || `http://localhost:${DEFAULT_PORT}`;
const OUT_DIR = path.resolve('test-results/drawer-scrolling');

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

async function waitForServer(url, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return;
    } catch {
      // Retry
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function runDrawerScrollAcceptance() {
  let serverProcess = null;
  const isLocal = BASE_URL.includes('localhost') || BASE_URL.includes('127.0.0.1');

  if (isLocal) {
    const portMatch = BASE_URL.match(/:(\d+)/);
    const port = portMatch ? portMatch[1] : String(DEFAULT_PORT);
    console.log(`Starting local Next.js production server on port ${port}...`);
    serverProcess = spawn(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['next', 'start', '-H', 'localhost', '-p', port],
      { stdio: 'pipe', shell: true },
    );
    serverProcess.stdout?.on('data', (d) => {
      const msg = d.toString();
      if (msg.includes('Ready') || msg.includes('started')) console.log('[Server]', msg.trim());
    });
    serverProcess.stderr?.on('data', (d) => console.error('[Server Err]', d.toString().trim()));
    await waitForServer(`${BASE_URL}/data-room`);
    console.log(`Local server ready at ${BASE_URL}`);
  }

  console.log(`Starting Evidence Drawer Scrolling Acceptance tests against ${BASE_URL}...`);
  const browser = await chromium.launch({
    headless: true,
    channel: 'msedge',
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const summary = {
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    desktop1440x900: {},
    laptop1280x720: {},
    mobile390x844: {},
    failures: [],
    overallSuccess: false,
  };

  try {
    // =========================================================================
    // 1. DESKTOP VIEWPORT (1440 x 900)
    // =========================================================================
    console.log('\n--- 1. Testing Desktop 1440x900 Viewport ---');
    const desktopCtx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const desktopPage = await desktopCtx.newPage();
    desktopPage.on('pageerror', (err) => console.log('DESKTOP PAGE ERROR:', err.message));

    console.log(`Navigating to ${BASE_URL}/data-room...`);
    await desktopPage.goto(`${BASE_URL}/data-room`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
    await desktopPage.waitForSelector('[data-testid="macro-data-room"]');

    // Verify desktop drawer container is visible
    const desktopDrawer = await desktopPage.waitForSelector('[data-testid="desktop-evidence-drawer"]', {
      timeout: 10000,
    });
    summary.desktop1440x900.drawerVisible = !!desktopDrawer;

    // Verify Loughton Microsoft relationship is selected by default
    const headerTitle = await desktopPage.textContent('.dr-drawer-header h3');
    summary.desktop1440x900.defaultSelectedRel = headerTitle?.trim();
    console.log(`Default selected relationship in drawer: ${headerTitle?.trim()}`);
    if (!headerTitle?.includes('rel-loughton-msft-r2')) {
      summary.failures.push(`Expected rel-loughton-msft-r2, got ${headerTitle}`);
    }

    // Capture initial state screenshot before scrolling
    const desktopBeforePath = path.join(OUT_DIR, 'desktop-1440x900-before-scroll.png');
    await desktopPage.screenshot({ path: desktopBeforePath });
    summary.desktop1440x900.screenshotBefore = desktopBeforePath;

    // Check scroll container properties
    const scrollContainer = await desktopPage.waitForSelector('[data-testid="evidence-drawer-scrollable-body"]');
    const scrollMetricsBefore = await desktopPage.evaluate(() => {
      const el = document.querySelector('[data-testid="evidence-drawer-scrollable-body"]');
      const drawer = document.querySelector('[data-testid="desktop-evidence-drawer"]');
      return {
        hasScrollContainer: !!el,
        scrollHeight: el ? el.scrollHeight : 0,
        clientHeight: el ? el.clientHeight : 0,
        scrollTop: el ? el.scrollTop : 0,
        drawerHeight: drawer ? drawer.getBoundingClientRect().height : 0,
        viewportHeight: window.innerHeight,
      };
    });

    console.log('Desktop scroll metrics:', scrollMetricsBefore);
    summary.desktop1440x900.metricsBefore = scrollMetricsBefore;

    if (scrollMetricsBefore.scrollHeight <= scrollMetricsBefore.clientHeight) {
      summary.failures.push('Desktop evidence drawer body is not overflowing vertically; scrollHeight <= clientHeight');
    }

    if (scrollMetricsBefore.drawerHeight > scrollMetricsBefore.viewportHeight) {
      summary.failures.push(
        `Desktop evidence drawer height (${scrollMetricsBefore.drawerHeight}px) exceeds viewport (${scrollMetricsBefore.viewportHeight}px)`,
      );
    }

    // Test scrolling inside the drawer via wheel / scrollTop
    console.log('Scrolling evidence drawer to the bottom...');
    await desktopPage.evaluate(() => {
      const el = document.querySelector('[data-testid="evidence-drawer-scrollable-body"]');
      if (el) el.scrollTop = el.scrollHeight;
    });
    await desktopPage.waitForTimeout(300);

    const scrollMetricsAfter = await desktopPage.evaluate(() => {
      const el = document.querySelector('[data-testid="evidence-drawer-scrollable-body"]');
      const header = document.querySelector('.dr-drawer-header');
      const finalSource = document.querySelector('[data-testid="drawer-source-reuters-loughton-oct19"]');
      const reviewBox = document.querySelector('[data-testid="drawer-reviewer-promotion"]');
      const approveBtn = document.querySelector('[data-testid="approve-promote-relationship-btn"]');

      const isElementInViewport = (elem) => {
        if (!elem) return false;
        const rect = elem.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= window.innerHeight;
      };

      return {
        scrollTop: el ? el.scrollTop : 0,
        headerRemainsVisible: isElementInViewport(header),
        finalSourceReachable: !!finalSource,
        reviewBoxReachable: isElementInViewport(reviewBox) || !!approveBtn,
      };
    });

    console.log('Desktop scroll metrics after scrolling:', scrollMetricsAfter);
    summary.desktop1440x900.metricsAfter = scrollMetricsAfter;

    if (scrollMetricsAfter.scrollTop <= 0) {
      summary.failures.push('Desktop evidence drawer failed to scroll vertically (scrollTop is 0)');
    }
    if (!scrollMetricsAfter.headerRemainsVisible) {
      summary.failures.push('Desktop evidence drawer header did not remain visible while scrolling');
    }
    if (!scrollMetricsAfter.finalSourceReachable) {
      summary.failures.push('Final source document in drawer is not reachable');
    }

    // Test keyboard scrolling
    console.log('Testing keyboard navigation in drawer scroll container...');
    await scrollContainer.focus();
    await desktopPage.keyboard.press('Home');
    await desktopPage.waitForTimeout(200);
    const topAfterHome = await desktopPage.evaluate(() => {
      const el = document.querySelector('[data-testid="evidence-drawer-scrollable-body"]');
      return el ? el.scrollTop : -1;
    });
    await desktopPage.keyboard.press('PageDown');
    await desktopPage.waitForTimeout(200);
    const topAfterPageDown = await desktopPage.evaluate(() => {
      const el = document.querySelector('[data-testid="evidence-drawer-scrollable-body"]');
      return el ? el.scrollTop : -1;
    });
    summary.desktop1440x900.keyboardScrollWorks = topAfterPageDown > topAfterHome;
    console.log(`Keyboard scroll: top after Home=${topAfterHome}, top after PageDown=${topAfterPageDown}`);

    // Verify main page scrolls independently
    console.log('Testing main page scrolling independence...');
    await desktopPage.evaluate(() => window.scrollTo(0, 500));
    await desktopPage.waitForTimeout(200);
    const windowScrollY = await desktopPage.evaluate(() => window.scrollY);
    summary.desktop1440x900.mainPageScrolls = windowScrollY > 100;
    console.log(`Main page scroll Y: ${windowScrollY}`);

    // Check horizontal overflow
    const desktopOverflow = await desktopPage.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    summary.desktop1440x900.hasHorizontalOverflow = desktopOverflow;
    if (desktopOverflow) {
      summary.failures.push('Desktop 1440x900 has horizontal overflow');
    }

    // Test switching relationship: click on supersession link to switch to v1
    console.log('Testing relationship switching in drawer (v2 -> v1)...');
    const supersededLink = await desktopPage.$('button:has-text("Inspect Superseded v1 Record")');
    if (supersededLink) {
      await supersededLink.click();
      await desktopPage.waitForTimeout(300);
      const newTitle = await desktopPage.textContent('.dr-drawer-header h3');
      summary.desktop1440x900.switchedToV1 = newTitle?.includes('rel-loughton-msft-r1');
      console.log(`Switched relationship title: ${newTitle?.trim()}`);
    }

    // Capture screenshot after scroll
    const desktopAfterPath = path.join(OUT_DIR, 'desktop-1440x900-after-scroll.png');
    await desktopPage.screenshot({ path: desktopAfterPath });
    summary.desktop1440x900.screenshotAfter = desktopAfterPath;
    await desktopCtx.close();

    // =========================================================================
    // 2. LAPTOP VIEWPORT (1280 x 720)
    // =========================================================================
    console.log('\n--- 2. Testing Laptop 1280x720 Viewport ---');
    const laptopCtx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    const laptopPage = await laptopCtx.newPage();
    laptopPage.on('pageerror', (err) => console.log('LAPTOP PAGE ERROR:', err.message));

    await laptopPage.goto(`${BASE_URL}/data-room`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
    await laptopPage.waitForSelector('[data-testid="macro-data-room"]');

    const laptopMetrics = await laptopPage.evaluate(() => {
      const drawer = document.querySelector('[data-testid="desktop-evidence-drawer"]');
      const body = document.querySelector('[data-testid="evidence-drawer-scrollable-body"]');
      return {
        drawerHeight: drawer ? drawer.getBoundingClientRect().height : 0,
        viewportHeight: window.innerHeight,
        canScroll: body ? body.scrollHeight > body.clientHeight : false,
      };
    });

    console.log('Laptop 1280x720 metrics:', laptopMetrics);
    summary.laptop1280x720.metrics = laptopMetrics;

    if (laptopMetrics.drawerHeight > laptopMetrics.viewportHeight) {
      summary.failures.push(
        `Laptop evidence drawer height (${laptopMetrics.drawerHeight}px) exceeds 720px viewport`,
      );
    }
    if (!laptopMetrics.canScroll) {
      summary.failures.push('Laptop evidence drawer scrollable body cannot scroll');
    }

    // Scroll inside laptop drawer
    await laptopPage.evaluate(() => {
      const el = document.querySelector('[data-testid="evidence-drawer-scrollable-body"]');
      if (el) el.scrollTop = 400;
    });
    await laptopPage.waitForTimeout(200);

    const laptopScrollTop = await laptopPage.evaluate(() => {
      const el = document.querySelector('[data-testid="evidence-drawer-scrollable-body"]');
      return el ? el.scrollTop : 0;
    });
    summary.laptop1280x720.scrolledSuccessfully = laptopScrollTop > 0;

    const laptopOverflow = await laptopPage.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    summary.laptop1280x720.hasHorizontalOverflow = laptopOverflow;
    if (laptopOverflow) {
      summary.failures.push('Laptop 1280x720 has horizontal overflow');
    }

    const laptopPath = path.join(OUT_DIR, 'laptop-1280x720-scrolled.png');
    await laptopPage.screenshot({ path: laptopPath });
    summary.laptop1280x720.screenshot = laptopPath;
    await laptopCtx.close();

    // =========================================================================
    // 3. MOBILE VIEWPORT (390 x 844, iPhone 12/13/14)
    // =========================================================================
    console.log('\n--- 3. Testing Mobile 390x844 Viewport ---');
    const mobileCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const mobilePage = await mobileCtx.newPage();
    mobilePage.on('pageerror', (err) => console.log('MOBILE PAGE ERROR:', err.message));

    await mobilePage.goto(`${BASE_URL}/data-room`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
    await mobilePage.waitForSelector('[data-testid="macro-data-room"]');

    // Desktop drawer must be hidden on mobile
    const desktopDrawerOnMobile = await mobilePage.evaluate(() => {
      const el = document.querySelector('[data-testid="desktop-evidence-drawer"]');
      return el ? window.getComputedStyle(el).display : 'none';
    });
    summary.mobile390x844.desktopDrawerHidden = desktopDrawerOnMobile === 'none';
    console.log(`Desktop drawer display on mobile: ${desktopDrawerOnMobile}`);
    if (desktopDrawerOnMobile !== 'none') {
      summary.failures.push('Desktop drawer is not hidden on mobile viewport');
    }

    // Verify mobile drawer trigger button is present
    const triggerBtn = await mobilePage.waitForSelector('[data-testid="mobile-drawer-trigger-btn"]', {
      timeout: 5000,
    });
    summary.mobile390x844.triggerBtnVisible = !!triggerBtn;

    // Click trigger button to open drawer
    console.log('Opening mobile evidence drawer...');
    await triggerBtn.click();
    await mobilePage.waitForSelector('[data-testid="mobile-evidence-drawer"]');

    // Verify mobile drawer sheet has scrollable body
    const mobileSheetMetrics = await mobilePage.evaluate(() => {
      const sheet = document.querySelector('.dr-mobile-drawer-sheet');
      const body = sheet ? sheet.querySelector('[data-testid="evidence-drawer-scrollable-body"]') : null;
      const header = sheet ? sheet.querySelector('.dr-drawer-header') : null;
      const closeBtn = sheet ? sheet.querySelector('button[aria-label="Close evidence drawer"]') : null;
      return {
        hasSheet: !!sheet,
        hasBody: !!body,
        canScroll: body ? body.scrollHeight > body.clientHeight : false,
        headerHasCloseBtn: !!closeBtn,
      };
    });

    console.log('Mobile drawer metrics:', mobileSheetMetrics);
    summary.mobile390x844.sheetMetrics = mobileSheetMetrics;

    if (!mobileSheetMetrics.hasBody || !mobileSheetMetrics.canScroll) {
      summary.failures.push('Mobile evidence drawer body is missing or cannot scroll');
    }
    if (!mobileSheetMetrics.headerHasCloseBtn) {
      summary.failures.push('Mobile evidence drawer header is missing Close button');
    }

    // Scroll inside mobile drawer
    await mobilePage.evaluate(() => {
      const sheet = document.querySelector('.dr-mobile-drawer-sheet');
      const body = sheet ? sheet.querySelector('[data-testid="evidence-drawer-scrollable-body"]') : null;
      if (body) body.scrollTop = body.scrollHeight;
    });
    await mobilePage.waitForTimeout(200);

    const mobileScrollAfter = await mobilePage.evaluate(() => {
      const sheet = document.querySelector('.dr-mobile-drawer-sheet');
      const body = sheet ? sheet.querySelector('[data-testid="evidence-drawer-scrollable-body"]') : null;
      return body ? body.scrollTop : 0;
    });
    summary.mobile390x844.scrolledSuccessfully = mobileScrollAfter > 0;

    // Capture mobile drawer screenshot
    const mobilePath = path.join(OUT_DIR, 'mobile-390x844-drawer-open.png');
    await mobilePage.screenshot({ path: mobilePath });
    summary.mobile390x844.screenshot = mobilePath;

    // Close mobile drawer
    const closeBtn = await mobilePage.$('[data-testid="mobile-evidence-drawer"] button[aria-label="Close evidence drawer"]');
    if (closeBtn) {
      await closeBtn.click();
      await mobilePage.waitForTimeout(300);
      const isDrawerStillOpen = await mobilePage.isVisible('[data-testid="mobile-evidence-drawer"]');
      summary.mobile390x844.closedSuccessfully = !isDrawerStillOpen;
    }

    // Check horizontal overflow on mobile
    const mobileOverflow = await mobilePage.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    summary.mobile390x844.hasHorizontalOverflow = mobileOverflow;
    if (mobileOverflow) {
      summary.failures.push('Mobile 390x844 has horizontal overflow');
    }

    await mobileCtx.close();

    summary.overallSuccess = summary.failures.length === 0;
  } catch (err) {
    console.error('Test execution error:', err);
    summary.error = err.message;
    summary.failures.push(err.message);
  } finally {
    await browser.close();
    if (serverProcess) {
      console.log('Stopping local Next.js server...');
      serverProcess.kill();
    }
  }

  const jsonSummaryPath = path.join(OUT_DIR, 'drawer-scrolling-summary.json');
  fs.writeFileSync(jsonSummaryPath, JSON.stringify(summary, null, 2));
  console.log('\n--- Summary ---');
  console.log(JSON.stringify(summary, null, 2));

  if (!summary.overallSuccess) {
    console.error(`\nFAILED with ${summary.failures.length} issues`);
    process.exit(1);
  } else {
    console.log('\nALL TESTS PASSED');
    process.exit(0);
  }
}

runDrawerScrollAcceptance();
