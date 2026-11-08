import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
const WIDTHS=[390,768,1440,1920],BASE='http://localhost:3000';
const browser=await chromium.launch({headless:true,channel:'msedge'});
try{
 fs.mkdirSync('test-results/command-centre',{recursive:true});
 const ctx=await browser.newContext({reducedMotion:'reduce'}),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const noOverflow=async label=>{const o=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);if(o>1)throw new Error(`${label}: horizontal page overflow ${o}px`);};

 // Real homepage (signed out in this browser): no account figures may be invented.
 for(const w of WIDTHS){await page.setViewportSize({width:w,height:1000});await page.goto(`${BASE}/`);
  await expect(page.getByTestId('command-centre')).toBeVisible({timeout:30000});await expect(page.getByTestId('command-centre')).toHaveAttribute('data-source','broker');
  await expect(page.getByTestId('kpi-empty')).toBeVisible();await expect(page.getByTestId('chart-empty')).toBeVisible();await expect(page.getByTestId('chart-empty').getByRole('link',{name:/Synchronise your account/})).toHaveAttribute('href','/settings/brokers');
  await expect(page.getByTestId('holdings-panel')).toContainText('Nothing is shown as owned');await expect(page.getByTestId('synthetic-demo')).not.toHaveAttribute('open','');
  await expect(page.getByTestId('execution-widget')).toContainText('Live submission: disabled');await expect(page.locator('.cc-fixture')).toHaveCount(0);
  if(w<768){
   await expect(page.getByTestId('brief-collapsible')).not.toHaveAttribute('open','');
   await expect(page.getByTestId('ops-collapsible')).not.toHaveAttribute('open','');
  }else{
   await expect(page.getByTestId('brief-collapsible')).toHaveAttribute('open','');
   await expect(page.getByTestId('ops-collapsible')).toHaveAttribute('open','');
   await expect(page.getByTestId('morning-brief-panel')).toBeVisible();
   await expect(page.getByTestId('brief-confirmed-facts')).toBeVisible();
   await expect(page.getByTestId('brief-interpretation')).toBeVisible();
   await expect(page.getByTestId('brief-risk-changes')).toBeVisible();
   await expect(page.getByTestId('brief-incomplete-evidence')).toBeVisible();
   await expect(page.getByTestId('agent-operations-panel')).toBeVisible();
   await expect(page.getByTestId('agent-ops-table')).toBeVisible();
   await expect(page.getByTestId('agent-ops-summary')).toBeVisible();
   await expect(page.getByTestId('agent-ops-layers')).toBeVisible();
   await expect(page.getByTestId('layer-scheduler')).toContainText('Scheduler working');
   await expect(page.getByTestId('layer-collector')).toBeVisible();
   await expect(page.getByTestId('layer-source')).toBeVisible();
   await expect(page.getByTestId('layer-evidence')).toBeVisible();
   await expect(page.getByTestId('layer-briefing')).toBeVisible();
   await expect(page.getByTestId('agent-ops-execution-paths')).toBeVisible();
   await expect(page.getByTestId('agent-ops-graph-projection')).toBeVisible();
   await expect(page.getByTestId('agent-ops-environment-audit')).toBeVisible();
   await expect(page.getByTestId('agent-ops-run-audit-trail')).toBeVisible();
   await expect(page.getByTestId('env-audit-remote_ai_models')).not.toHaveClass(/cc-ok/);
   await expect(page.getByTestId('env-audit-live_demo_execution')).toContainText('intentionally_disabled');
   await expect(page.getByTestId('job-env-market_data_collect')).toContainText('Env: remote');
   await expect(page.getByTestId('missing-evidence-resolver')).toBeVisible();
   await expect(page.getByTestId('forward-research-panel')).toBeVisible();
   await expect(page.getByTestId('watch-gbp-NVDA')).toBeVisible();
   await expect(page.getByTestId('watch-gbp-AMD')).toBeVisible();
   await expect(page.getByTestId('watch-gbp-INTC')).toBeVisible();
   await expect(page.getByTestId('watch-gbp-QQQ')).toBeVisible();
  }
  await noOverflow(`home ${w}`);
  await page.screenshot({path:`test-results/command-centre/home-${w}.png`,fullPage:w<=768});}
 await page.setViewportSize({width:1440,height:1000});
 const rows=page.locator('[data-testid=watchlist-panel] tbody tr');expect(await rows.count()).toBeGreaterThan(0);
 for(const text of await rows.allInnerTexts())if(!/research only/.test(text))throw new Error('Watchlist row not labelled research only while signed out');
 await expect(page.locator('[data-watch=INTC]').getByRole('link',{name:/Check price evidence/})).toHaveAttribute('href','/policy-risk#sources');
 await expect(page.getByTestId('evidence-widget').getByRole('link',{name:/Case 006/})).toHaveAttribute('href','/recovery#participation');
 const summary=page.locator('.cc-status-bar > summary');await summary.focus();await page.keyboard.press('Enter');await expect(page.locator('.cc-status-bar')).toHaveAttribute('open','');
 await expect(page.locator('[data-alert=market]').getByRole('link',{name:/View price evidence/})).toHaveAttribute('href','/policy-risk#sources');
 await page.getByRole('button',{name:'Connections & settings',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Connections and settings'})).toBeVisible();
 await expect(page.getByTestId('workspace-connections-summary')).toBeVisible();
 await expect(page.getByTestId('workspace-connections-list')).toBeVisible();
 await expect(page.getByTestId('workspace-conn-convex_database')).toBeVisible();
 await expect(page.getByTestId('workspace-conn-sec_edgar')).toBeVisible();
 await expect(page.getByTestId('workspace-conn-market_data_eod')).toBeVisible();
 await expect(page.getByTestId('workspace-conn-typedb_cloud')).toBeVisible();
 await expect(page.getByTestId('workspace-conn-trading212_broker')).toBeVisible();
 await expect(page.getByTestId('workspace-conn-trade_execution')).toContainText('Intentionally disabled');
 await expect(page.getByTestId('workspace-synthetic-reset-section')).toContainText('Synthetic/demo only');
 await page.screenshot({path:'test-results/command-centre/workspace-connections-modal-1440.png'});
 await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Connections and settings'})).toHaveCount(0);

 // Labelled synthetic fixtures (development only) for populated layouts.
 for(const w of WIDTHS){await page.setViewportSize({width:w,height:1000});
  await page.goto(`${BASE}/dev/command-centre?fixture=sample`);await expect(page.getByTestId('kpi-strip')).toBeVisible({timeout:30000});
  await expect(page.getByTestId('command-centre')).toHaveAttribute('data-source','synthetic-fixture');await expect(page.locator('.cc-fixture')).toContainText('SYNTHETIC LAYOUT FIXTURE');
  await expect(page.getByTestId('kpi-strip').locator('.cc-kpi')).toHaveCount(4);await expect(page.getByTestId('kpi-strip')).not.toContainText('Trading 212');await expect(page.getByTestId('kpi-strip')).toContainText('Synthetic fixture account summary');await expect(page.getByTestId('kpi-total')).toContainText('£259.00');await expect(page.getByTestId('kpi-secondary')).toContainText('Available cash');
  await expect(page.getByTestId('deposit-note')).toContainText('never counted as investment profit');await expect(page.getByTestId('flow-events')).toContainText('deposit');
  await expect(page.getByTestId('holdings-panel').locator('tbody tr')).toHaveCount(2);await expect(page.locator('.cc-figure svg')).toBeVisible();
  await expect(page.getByTestId('risk-panel')).toBeVisible();await expect(page.getByTestId('approvals-widget')).toBeVisible();
  if(w<768){
   await expect(page.getByTestId('watch-collapsible')).not.toHaveAttribute('open','');
   await expect(page.getByTestId('brief-collapsible')).not.toHaveAttribute('open','');
   await expect(page.getByTestId('ops-collapsible')).not.toHaveAttribute('open','');
   await expect(page.getByTestId('urgent-alerts')).toBeVisible();
  }else{
   await expect(page.getByTestId('watch-collapsible')).toHaveAttribute('open','');
   await expect(page.locator('[data-watch=NVDA]')).toContainText('also owned');
   await expect(page.getByTestId('morning-brief-panel')).toBeVisible();
   await expect(page.getByTestId('agent-operations-panel')).toBeVisible();
  }
  await noOverflow(`sample ${w}`);await page.screenshot({path:`test-results/command-centre/sample-${w}.png`,fullPage:true});}
 await page.setViewportSize({width:1440,height:1000});
 await expect(page.getByTestId('chart-mode').getByRole('radio',{name:'Return (TWR)'})).toHaveAttribute('aria-checked','true');
 await page.getByLabel('Compare with').selectOption('QQQ');await expect(page.getByTestId('performance-chart')).toContainText('Benchmark evidence');
 await page.getByTestId('chart-mode').getByRole('radio',{name:'Value (GBP)'}).click();await expect(page.getByTestId('performance-chart')).toContainText('Includes deposits and withdrawals');await expect(page.getByLabel('Compare with')).toBeDisabled();
 await expect(page.locator('.cc-flow-line')).toHaveCount(2);
 const svg=page.locator('.cc-figure svg');await svg.focus();await page.keyboard.press('ArrowRight');await expect(page.locator('.cc-figure figcaption')).toContainText('cumulative TWR');
 await page.goto(`${BASE}/dev/command-centre?fixture=empty`);await expect(page.getByTestId('chart-empty')).toBeVisible({timeout:30000});await expect(page.getByTestId('holdings-empty')).toBeVisible();
 await expect(page.getByTestId('kpi-return')).toContainText('Nothing invested yet');await expect(page.getByTestId('kpi-pnl')).toContainText('£0.00');
 await expect(page.getByTestId('kpi-today')).toContainText('Unavailable');await expect(page.getByTestId('kpi-today').getByRole('link',{name:/Synchronise/})).toHaveAttribute('href','/settings/brokers');
 await page.screenshot({path:'test-results/command-centre/empty-1440.png',fullPage:true});
 await page.goto(`${BASE}/dev/command-centre?fixture=stale`);await expect(page.getByTestId('freshness')).toContainText('Stale',{timeout:30000});
 await expect(page.locator('[data-alert=stale]').getByRole('link',{name:/Synchronise now/})).toHaveAttribute('href','/settings/brokers');
 await page.setViewportSize({width:390,height:844});await expect(page.locator('[data-alert=stale]')).toBeVisible();
 await page.screenshot({path:'test-results/command-centre/stale-390.png'});
 if(errors.length)throw new Error(errors.join('\n'));
 console.log('Command-centre browser checks passed at 390/768/1440/1920: primary KPI row + secondary strip, TWR and GBP-value modes with cash-flow markers, benchmark evidence route, resolution links, risk warnings visible with collapsed mobile sections, Morning Intelligence Brief + Agent Operations panels verified, fixture styling separated from broker data, no overflow.');
}finally{await browser.close();}
