import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';

async function runBrowserAcceptance() {
  const results = {
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    desktop: {},
    mobile: {},
    overallSuccess: false,
    failures: [],
  };

  const outDir = path.resolve('test-results');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  console.log(`Launching browser (msedge) against ${BASE_URL}...`);
  const browser = await chromium.launch({
    headless: true,
    channel: 'msedge',
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    // ----------------------------------------------------
    // 1. Desktop Test (1440 x 1000)
    // ----------------------------------------------------
    console.log('Starting Desktop test (1440x1000)...');
    const desktopContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    });
    const desktopPage = await desktopContext.newPage();
    desktopPage.on('pageerror', (err) => console.log('DESKTOP PAGE ERROR:', err.message));

    console.log(`Navigating to ${BASE_URL}/portfolio...`);
    const desktopRes = await desktopPage.goto(`${BASE_URL}/portfolio`, {
      timeout: 25000,
      waitUntil: 'domcontentloaded',
    });
    results.desktop.httpStatus = desktopRes?.status();

    // Verify root element
    console.log('Waiting for portfolio page root selector...');
    const pageContainer = await desktopPage.waitForSelector('[data-testid="portfolio-risk-page"]', {
      timeout: 15000,
    });
    results.desktop.pageLoaded = !!pageContainer;

    // Check horizontal scroll
    const desktopOverflow = await desktopPage.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    results.desktop.hasHorizontalOverflow = desktopOverflow;
    if (desktopOverflow) {
      results.failures.push('Desktop has horizontal overflow');
    }

    // Check 7 sections
    const sections = [
      'portfolio-overview-section',
      'portfolio-diversification-section',
      'portfolio-stress-section',
      'portfolio-alerts-section',
      'portfolio-ai-chat-section',
      'portfolio-operational-health-section',
      'portfolio-drawers-section',
    ];
    results.desktop.sectionsFound = {};
    for (const sec of sections) {
      const el = await desktopPage.$(`[data-testid="${sec}"]`);
      results.desktop.sectionsFound[sec] = !!el;
      if (!el) {
        results.failures.push(`Desktop missing section: ${sec}`);
      }
    }

    // Check Execution Authority pill in header
    const headerText = await desktopPage.textContent('.portfolio-breadcrumb');
    results.desktop.hasExecutionDisabledPill =
      headerText?.includes('Execution: Read-Only (Disabled)') ?? false;
    if (!results.desktop.hasExecutionDisabledPill) {
      results.failures.push('Desktop missing Execution: Read-Only pill');
    }

    // Check Brokerage Privacy footer notice
    const privacyNotice = await desktopPage.textContent('.broker-privacy-notice');
    results.desktop.hasBrokerPrivacyNotice =
      (privacyNotice?.includes('Brokerage Privacy & Isolation') &&
        privacyNotice?.includes('executionAuthority')) ??
      false;
    if (!results.desktop.hasBrokerPrivacyNotice) {
      results.failures.push('Desktop missing broker privacy notice');
    }

    // Verify initial educational benchmark model (default view)
    const initialSourcePill = await desktopPage.textContent('.g6-eyebrow-row');
    results.desktop.initialModelSource = initialSourcePill?.includes('Educational Benchmark Model (£100k Basis)');

    // Verify interactive model toggle: Click Capital Preservation (£100k)
    console.log('Testing interactive tab toggles...');
    await desktopPage.click('[data-testid="tab-capital-preservation"]');
    await desktopPage.waitForTimeout(300);
    const kpiVal = await desktopPage.textContent('[data-testid="kpi-total-value"] .kpi-value');
    results.desktop.capitalPreservationValueSwitched = kpiVal?.includes('100,000.00') ?? false;

    // Click Balanced Multi-Asset (£100k)
    await desktopPage.click('[data-testid="tab-balanced"]');
    await desktopPage.waitForTimeout(300);
    const balancedAiExposure = await desktopPage.textContent('[data-testid="ai-total-stat"] strong');
    results.desktop.balancedAiExposure = balancedAiExposure?.includes('3.1%') ?? false;

    // Click Tech Concentrated (£100k Contrast)
    await desktopPage.click('[data-testid="tab-tech-concentrated"]');
    await desktopPage.waitForTimeout(300);
    const techAiExposure = await desktopPage.textContent('[data-testid="ai-total-stat"] strong');
    results.desktop.techConcentratedAiExposure = techAiExposure?.includes('76.2%') ?? false;

    // Switch back to Owner Live to test baseline fixture isolation
    await desktopPage.click('[data-testid="tab-owner-live"]');
    await desktopPage.waitForTimeout(300);

    // Verify baseline fixture tags when viewing owner live baseline
    const liveSourcePill = await desktopPage.textContent('.g6-eyebrow-row');
    results.desktop.hasFixtureSourcePill =
      liveSourcePill?.includes('Development Baseline Fixture (£250 Cash / 0 Positions)') ?? false;
    results.desktop.hasDemonstrationFreshnessPill =
      liveSourcePill?.includes('Development Fixture (Demonstration Only)') ?? false;
    if (!results.desktop.hasFixtureSourcePill || !results.desktop.hasDemonstrationFreshnessPill) {
      results.failures.push('Owner live tab missing explicit Development Fixture demarcation');
    }

    // Test Scenario toggles in Section C
    console.log('Testing Scenario G (Emergency Liquidity)...');
    await desktopPage.click('[data-testid="tab-capital-preservation"]');
    await desktopPage.waitForTimeout(300);
    const scenarioGTab = await desktopPage.$('[data-testid="scenario-btn-scenario-g"]');
    if (scenarioGTab) {
      await scenarioGTab.click();
      await desktopPage.waitForTimeout(300);
      const scenarioText = await desktopPage.textContent('[data-testid="active-scenario-card"]');
      results.desktop.scenarioGTested = scenarioText?.includes('Scenario G') || scenarioText?.includes('Liquidity');
    }

    // Test Evidence-Locked Q&A in Section E
    console.log('Testing Evidence-Locked Q&A buttons...');
    const qButton = await desktopPage.$('[data-testid="q-cash-zero-loss"]');
    if (qButton) {
      await qButton.click();
      await desktopPage.waitForTimeout(300);
      const answerText = await desktopPage.textContent('[data-testid="evidence-answer-box"]');
      results.desktop.evidenceQaWorks =
        answerText?.includes('3.99%') &&
        answerText?.includes('IUDSOIA') &&
        answerText?.includes('4.00%');
      if (!results.desktop.evidenceQaWorks) {
        results.failures.push('Evidence-Locked QA missing verified BoE SONIA references');
      }
    }

    // Open Drawer 1: Bank of England SONIA Observation
    console.log('Opening SONIA Technical Drawer...');
    await desktopPage.click('[data-testid="drawer-sonia-toggle"]');
    await desktopPage.waitForTimeout(400);
    const drawerContent = await desktopPage.textContent('.g6-drawer-details .drawer-inner');
    results.desktop.soniaDrawerVerified =
      (drawerContent?.includes('IUDSOIA') &&
        drawerContent?.includes('3.9852') &&
        drawerContent?.includes('4.00%') &&
        drawerContent?.includes('5 November 2026')) ??
      false;

    if (!results.desktop.soniaDrawerVerified) {
      results.failures.push('SONIA Technical Drawer missing verified 3.9852% / 4.00% BoE data');
    }

    // Check Section F operational health elements
    const brokerSyncCard = await desktopPage.$('[data-testid="health-card-broker-sync"]');
    const vaultCipherCard = await desktopPage.$('[data-testid="health-card-vault-cipher"]');
    results.desktop.operationalHealthCardsVerified = !!brokerSyncCard && !!vaultCipherCard;
    if (!results.desktop.operationalHealthCardsVerified) {
      results.failures.push('Section F operational health cards missing');
    }

    // Capture desktop screenshot
    const desktopScreenshotPath = path.join(outDir, 'portfolio-desktop.png');
    await desktopPage.screenshot({ path: desktopScreenshotPath, fullPage: true });
    results.desktop.screenshot = desktopScreenshotPath;
    console.log('Desktop screenshot saved:', desktopScreenshotPath);

    // Test Navigation back to Market Radar
    console.log('Testing breadcrumb navigation back to /...');
    const backLink = await desktopPage.$('.portfolio-breadcrumb a');
    if (backLink) {
      await backLink.click();
      await desktopPage.waitForURL(`${BASE_URL}/`, { timeout: 10000 });
      results.desktop.navigationBackWorks = desktopPage.url() === `${BASE_URL}/` || desktopPage.url().endsWith('/');
    }

    await desktopContext.close();

    // ----------------------------------------------------
    // 2. Mobile Test (390 x 844, iPhone 12/13/14)
    // ----------------------------------------------------
    console.log('Starting Mobile test (390x844)...');
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    });
    const mobilePage = await mobileContext.newPage();
    mobilePage.on('pageerror', (err) => console.log('MOBILE PAGE ERROR:', err.message));

    console.log(`Navigating mobile to ${BASE_URL}/portfolio...`);
    const mobileRes = await mobilePage.goto(`${BASE_URL}/portfolio`, {
      timeout: 25000,
      waitUntil: 'domcontentloaded',
    });
    results.mobile.httpStatus = mobileRes?.status();

    const mobileContainer = await mobilePage.waitForSelector('[data-testid="portfolio-risk-page"]', {
      timeout: 15000,
    });
    results.mobile.pageLoaded = !!mobileContainer;

    // Check horizontal scroll on mobile
    const mobileOverflow = await mobilePage.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    results.mobile.hasHorizontalOverflow = mobileOverflow;
    if (mobileOverflow) {
      results.failures.push('Mobile has horizontal overflow');
    }

    // Verify sections present on mobile
    results.mobile.sectionsFound = {};
    for (const sec of sections) {
      const el = await mobilePage.$(`[data-testid="${sec}"]`);
      results.mobile.sectionsFound[sec] = !!el;
      if (!el) {
        results.failures.push(`Mobile missing section: ${sec}`);
      }
    }

    // Check model selector responsiveness
    const modelButtons = await mobilePage.$$('.portfolio-model-selector button');
    results.mobile.modelButtonsCount = modelButtons.length;

    // Capture mobile screenshot
    const mobileScreenshotPath = path.join(outDir, 'portfolio-mobile.png');
    await mobilePage.screenshot({ path: mobileScreenshotPath, fullPage: true });
    results.mobile.screenshot = mobileScreenshotPath;
    console.log('Mobile screenshot saved:', mobileScreenshotPath);
    await mobileContext.close();

    results.overallSuccess = results.failures.length === 0;
  } catch (err) {
    results.error = err.message;
    results.failures.push(err.message);
  } finally {
    await browser.close();
  }

  const jsonOut = path.join(outDir, 'browser-acceptance-summary.json');
  fs.writeFileSync(jsonOut, JSON.stringify(results, null, 2));
  console.log('Acceptance Results:', JSON.stringify(results, null, 2));

  if (!results.overallSuccess) {
    process.exit(1);
  }
}

runBrowserAcceptance();
