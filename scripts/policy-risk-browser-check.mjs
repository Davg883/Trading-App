import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const browser=await chromium.launch({headless:true,channel:'msedge'});
try{
 fs.mkdirSync('test-results',{recursive:true});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:3000/');await page.getByTestId('alerts-centre').locator('summary').click();await page.getByRole('link',{name:'Benchmark 001.2 · Midterm infrastructure risk',exact:true}).click();
 await expect(page.getByRole('heading',{name:/Votes are not/})).toBeVisible();await expect(page.getByTestId('policy-mode')).toContainText('not a prior prediction');
 await expect(page.locator('#events tbody tr')).toHaveCount(19);await expect(page.locator('#exposure tbody tr')).toHaveCount(9);
 await expect(page.locator('tr[data-event="oh-senate-2026"]')).toContainText('political signal');await expect(page.locator('tr[data-event="ny-s10642"]')).toContainText('proposed not enacted');await expect(page.locator('tr[data-event="ny-eo62"]')).toContainText('Restriction in force');
 await expect(page.locator('tr[data-project="aws-wilmington"]')).toContainText('directly exposed');await expect(page.locator('tr[data-project="aws-wilmington"]')).toContainText('permitting on hold');await expect(page.locator('tr[data-project="apld-polaris-forge-2"]')).toContainText('no substantiated exposure');
 await expect(page.locator('tr[data-group="developers"]')).toContainText('complete');await expect(page.locator('#market tbody tr').first().locator('.proof-badge',{hasText:'pending'})).toHaveCount(3);
 await expect(page.locator('#missing li').first()).toContainText('grid capacity');
 await page.getByRole('button',{name:'Reconstruct at 3 Nov close'}).click();await expect(page.locator('#events tbody tr[data-event="wells-me-moratorium-2026-11-03"]')).toHaveCount(0);await expect(page.locator('#events tbody tr[data-event="ny-eo62"]')).toHaveCount(1);
 await page.getByLabel('Knowledge basis').selectOption('receipt');await expect(page.locator('#events tbody tr')).toHaveCount(0);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export offline evaluation request'}).click();await(await download).saveAs('test-results/policy-risk-ui-request.json');
 const run=()=>spawnSync('python',['-m','worker.policy_risk','test-results/policy-risk-ui-request.json'],{encoding:'utf8',maxBuffer:64*1024*1024});const first=run(),second=run();if(first.status!==0)throw new Error(first.stderr);expect(first.stdout).toBe(second.stdout);expect(JSON.parse(first.stdout).executionAuthority).toBe('none');
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'test-results/policy-risk-desktop.png'});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/policy-risk-mobile.png'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 expect(errors).toEqual([]);console.log('Policy-risk browser checks passed: legal-status classes, sourced exposure, hold-not-cancelled, cutoff reconstruction, pending windows, Python reproduction, responsive layout.');
}finally{await browser.close();}
