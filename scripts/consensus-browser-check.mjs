import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const browser=await chromium.launch({headless:true,channel:'msedge'});
try{
 fs.mkdirSync('test-results',{recursive:true});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:3000/');await page.getByRole('link',{name:/Analyst Consensus Validation · NVIDIA/}).click();
 await expect(page.getByRole('heading',{name:'Beyond the Buy label.'})).toBeVisible();
 await expect(page.getByTestId('melius-flag')).toContainText('$420 to $315');await expect(page.getByTestId('melius-flag')).toContainText('excluded from consensus aggregates');
 await expect(page.getByText('No licensed recommendation dataset has been imported.',{exact:false})).toBeVisible();
 await expect(page.getByRole('table',{name:'Sourced company financial comparison'}).locator('tbody tr')).toHaveCount(3);
 await expect(page.getByRole('table',{name:'GBP research outcome windows'}).locator('tbody tr')).toHaveCount(8);
 await expect(page.locator('#outcomes tbody tr').filter({hasText:'pending'})).toHaveCount(8);
 await expect(page.locator('#outcomes')).toContainText('2027-02-01T21:00:00.000Z');
 await expect(page.locator('#portfolios .consensus-plan')).toHaveCount(2);await expect(page.locator('#portfolios .consensus-plan').getByText('£500.00',{exact:true})).toHaveCount(2);
 const originalDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Export study for Python'}).click();await(await originalDownload).saveAs('test-results/consensus-observed-ui-request.json');
 const call=path=>spawnSync('python',['-m','worker.analyst_consensus',path],{encoding:'utf8'});const observed=call('test-results/consensus-observed-ui-request.json');if(observed.status!==0)throw new Error(observed.stderr);const observedReport=JSON.parse(observed.stdout);expect(observedReport.outcomes.every(r=>r.status==='pending')).toBe(true);expect(observedReport.study.portfolios).toHaveLength(2);
 await page.getByText('Create an additional custom allocation',{exact:true}).click();await page.getByRole('button',{name:'Add custom research allocation'}).click();await expect(page.locator('#portfolios .consensus-plan')).toHaveCount(3);
 await page.getByRole('button',{name:'Register £500 comparison draft'}).click();await expect(page.locator('#outcomes tbody tr')).toHaveCount(12);
 const customDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Export study for Python'}).click();await(await customDownload).saveAs('test-results/consensus-custom-ui-request.json');expect(JSON.parse(fs.readFileSync('test-results/consensus-custom-ui-request.json','utf8')).case.portfolios).toHaveLength(3);
 await page.getByRole('button',{name:'Synthetic demonstration',exact:true}).click();await expect(page.getByTestId('consensus-mode')).toContainText('All analyst records, targets, prices, FX and outcomes are invented');await expect(page.getByTestId('melius-flag')).toHaveCount(0);
 await expect(page.locator('#revisions')).toContainText('Provider headline unchanged');await expect(page.locator('#revisions')).toContainText('Targets cut 2');
 await page.getByRole('button',{name:'Register £500 comparison draft'}).click();await expect(page.locator('#outcomes tbody tr').filter({hasText:'complete'})).toHaveCount(8);
 const demoDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Export study for Python'}).click();await(await demoDownload).saveAs('test-results/consensus-synthetic-ui-request.json');
 const first=call('test-results/consensus-synthetic-ui-request.json'),second=call('test-results/consensus-synthetic-ui-request.json');if(first.status!==0)throw new Error(first.stderr);expect(first.stdout).toBe(second.stdout);const report=JSON.parse(first.stdout);expect(report.outcomes.every(r=>r.status==='complete'&&r.result.initialCapitalGbp===500)).toBe(true);expect(report.ablation.status).toBe('insufficient_evidence');
 // Post-registration cost edits must not rewrite the exported frozen plan.
 await page.getByText('Declare portfolio costs and cash assumptions',{exact:true}).click();for(const [label,value]of [['All-in entry costs · GBP','100'],['All-in exit costs · GBP','0'],['Additional annual fee · bps','0'],['Annual GBP cash rate · %','0']])await page.getByLabel(label,{exact:true}).fill(value);
 await page.getByRole('button',{name:'Save research cost assumptions'}).click();const frozenDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Export study for Python'}).click();await(await frozenDownload).saveAs('test-results/consensus-frozen-ui-request.json');expect(JSON.parse(fs.readFileSync('test-results/consensus-frozen-ui-request.json','utf8')).case.portfolios[0].entryCostsGbp).toBe(3);
 await page.getByLabel('Evidence cutoff · ISO timestamp',{exact:true}).fill('1969-12-31T23:59:59Z');await expect(page.getByRole('button',{name:'Register £500 comparison draft'})).toBeDisabled();
 await page.getByRole('button',{name:'Observed case',exact:true}).click();await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'test-results/consensus-desktop.png',caret:'initial'});
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'test-results/consensus-mobile.png',caret:'initial'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 expect(errors).toEqual([]);console.log('Consensus browser checks passed: source flag, unlicensed nulls, two registered £500 portfolios, custom allocation, completed/pending windows, frozen costs, independent Python reproduction and responsive layout.');
}finally{await browser.close();}
