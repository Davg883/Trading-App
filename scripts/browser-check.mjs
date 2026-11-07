import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
(async()=>{
  fs.mkdirSync('test-results',{recursive:true});
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://localhost:3000');
    await expect(page.getByRole('heading',{name:'Market Radar',exact:true})).toBeVisible();
    await expect(page.getByText('Synthetic research preview.')).toBeVisible();
    await page.screenshot({path:'test-results/dashboard-desktop.png',fullPage:true});
    await page.getByRole('textbox',{name:'Search companies'}).fill('nvidia');
    await expect(page.getByRole('button',{name:'NVDA NVIDIA'})).toBeVisible();
    await page.getByRole('button',{name:'Analyst Lab',exact:true}).click();
    await page.getByRole('button',{name:'Run synthetic experiment'}).click();
    await expect(page.getByText('3 submissions')).toBeVisible();
    await page.getByRole('button',{name:/Human Review/}).click();
    await page.getByRole('button',{name:'Approve paper allocation'}).first().click();
    await expect(page.getByText('approved',{exact:true})).toBeVisible();
    await page.reload();
    await page.getByRole('button',{name:'Paper Trading',exact:true}).click();
    await expect(page.getByRole('main')).toContainText('MSFT');
    const persisted=await page.evaluate(()=>JSON.parse(localStorage.getItem('aci-benchmark-demo-v1')));
    const approved=persisted.proposals.filter(p=>p.state==='approved');
    if(approved.length!==1||approved[0].quantity<=0||approved[0].cashDebit<=500)throw new Error('Paper ledger failed to retain one costed approval');
    for(const moduleName of ['Economics Observatory','Vectis ONE Lab']) {
      await page.getByRole('button',{name:moduleName,exact:true}).click();
      await expect(page.getByRole('heading',{name:moduleName,exact:true})).toBeVisible();
    }
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:'Market Radar',exact:true}).click();
    await page.screenshot({path:'test-results/dashboard-mobile.png',fullPage:true});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
    if(overflow)throw new Error('Mobile page overflows horizontally');
    await page.evaluate(()=>localStorage.setItem('aci-benchmark-demo-v1',JSON.stringify({proposals:[null],runs:[null]})));
    await page.reload();
    await expect(page.getByRole('heading',{name:'Market Radar',exact:true})).toBeVisible();
    await page.goto('http://localhost:3000/workspace');
    await expect(page.getByRole('heading',{name:'Ready for your connections'})).toBeVisible();
    if(errors.length)throw new Error(errors.join('\n'));
    console.log('Browser checks passed: navigation, search, replay, approval, persistence, mobile layout, key-free connection screen; no browser exceptions.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
