import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
const browser=await chromium.launch({headless:true,channel:'msedge'});
try{
 fs.mkdirSync('test-results',{recursive:true});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:3000/');await page.getByTestId('alerts-centre').locator('summary').click();await page.getByRole('link',{name:'Trading workspace',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Trading workspace'})).toBeVisible();
 await expect(page.getByTestId('trading-status')).toContainText(/Live submission is disabled on this server/);
 const status=await page.request.post('http://localhost:3000/api/trading',{headers:{origin:'http://localhost:3000','content-type':'application/json'},data:{action:'submit',orderId:'x'}});
 if(![401,503].includes(status.status())||!status.headers()['cache-control']?.includes('no-store'))throw new Error('Signed-out submission did not fail closed');
 const foreign=await page.request.post('http://localhost:3000/api/trading',{headers:{origin:'https://evil.example','content-type':'application/json'},data:{action:'monitor',environment:'demo'}});
 if(foreign.status()!==403)throw new Error('Cross-origin trading request was not refused');
 const stored=await page.evaluate(()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage)}));
 if([...stored.local,...stored.session].some(k=>/trad|order|broker|credential|secret/i.test(k)))throw new Error('Trading data persisted in browser storage');
 await page.screenshot({path:'test-results/trading-desktop.png'});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/trading-mobile.png'});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw new Error('Trading page mobile overflow');
 if(errors.length)throw new Error(errors.join('\n'));
 console.log('Trading browser checks passed: dashboard link, Live disabled banner, fail-closed signed-out submission, cross-origin refusal, no browser storage, responsive layout.');
}finally{await browser.close();}
