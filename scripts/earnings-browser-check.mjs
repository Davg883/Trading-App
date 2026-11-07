import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
const browser=await chromium.launch({headless:true,channel:'msedge'});
try {
  fs.mkdirSync('test-results',{recursive:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(`${m.text()} ${m.location().url}`);});
  await page.goto('http://localhost:3000/earnings');
  await expect(page.getByRole('heading',{name:/Strong demand/})).toBeVisible();
  for(const label of ['40.3%','−7.1%','36.2%']) {
    // Percent formatter uses ASCII minus; normalise the expected negative sign.
    await expect(page.getByText(label.replace('−','-'),{exact:true})).toBeVisible();
  }
  await page.getByRole('button',{name:'Current review snapshot',exact:true}).click();
  await page.screenshot({path:'test-results/earnings-desktop.png',caret:'initial'});
  await page.getByRole('button',{name:'Pre-earnings',exact:true}).click();
  await expect(page.getByText('0 eligible',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Post-release + 1 minute',exact:true}).click();
  await expect(page.getByText('0 eligible',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Current review snapshot',exact:true}).click();
  await expect(page.getByText('15 eligible',{exact:true})).toBeVisible();
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export evidence snapshot'}).click();
  await (await download).saveAs('test-results/alphabet-review-snapshot.json');
  await page.getByLabel('Article title',{exact:true}).fill('Test intake');
  await page.getByLabel('Source URL',{exact:true}).fill('https://example.com/test');
  await page.getByLabel('Article text',{exact:true}).fill('Revenue $127.58 billion. Cash flow −9.07bn.');
  await page.getByRole('button',{name:'Extract unverified candidates'}).click();
  await expect(page.getByText(/2 unverified numerical candidates/)).toBeVisible();
  const file={eventId:'GOOGL_Q3_2026',mode:'retrospective',synthetic:true,realisedTargetReturn:-.01,target:{returnType:'excess',benchmarkSymbol:'QQQ',anchorAt:'2026-10-29T13:30:00Z',endAt:'2026-10-29T20:00:00Z',session:'regular',calendar:'synthetic-test',priceBasis:'unadjusted'},participants:[{participant:'test-only',status:'success',scores:{count:1,brier:.2,mae:.01,intervalCoverage:1,meanIntervalWidth:.1},actualBilledCost:null,costCurrency:null}],paperTrading:{status:'not_executed'}};
  await page.getByLabel('Evaluation report JSON').setInputFiles({name:'synthetic-test.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(file))});
  await expect(page.getByText('test-only',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Clear imported report'}).click();
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'test-results/earnings-mobile.png',caret:'initial'});
  if(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth))throw new Error('Mobile overflow');
  if(errors.length)throw new Error(errors.join('\n'));
  console.log('Earnings browser checks passed: KPIs, historical exclusions, review snapshot export, article intake, report import, mobile layout.');
} finally {await browser.close();}
