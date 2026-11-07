import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
const browser=await chromium.launch({headless:true,channel:'msedge'});
try{
  fs.mkdirSync('test-results',{recursive:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:3000/');
  await page.getByRole('button',{name:'Connections & settings',exact:true}).click();
  await page.getByRole('link',{name:'Broker Connections · Trading 212',exact:false}).click();
  await expect(page.getByRole('heading',{name:/Your broker account/})).toBeVisible();
  const probe=await page.request.get('http://localhost:3000/api/brokers'),configured=probe.status()===401;
  if(!configured)await expect(page.getByText('Sign-in is not configured yet.',{exact:true})).toBeVisible();
  else await expect(page.getByText('Sign-in is not configured yet.',{exact:true})).toHaveCount(0);
  await expect(page.getByLabel('Account environment')).toHaveValue('demo');
  if(!configured)await expect(page.getByLabel('API Key',{exact:true})).toBeDisabled();
  await expect(page.getByLabel('API Secret',{exact:true})).toHaveAttribute('type','password');
  await expect(page.getByLabel('API Secret',{exact:true})).toHaveValue('');
  if(!configured)await expect(page.getByRole('button',{name:'Save credentials securely',exact:true})).toBeDisabled();
  if(!configured)await expect(page.getByRole('button',{name:'Test Connection',exact:true})).toBeDisabled();
  await expect(page.getByText('No account summary retrieved. No demonstration balances are shown.',{exact:true})).toBeVisible();
  await page.screenshot({path:'test-results/broker-settings-desktop.png',caret:'initial'});
  await page.getByLabel('Account environment').selectOption('live');
  await expect(page.getByText('Trading 212 Live account',{exact:false})).toBeVisible();
  await expect(page.getByLabel('API Key',{exact:true})).toHaveValue('');
  await expect(page.getByLabel('API Secret',{exact:true})).toHaveValue('');
  const response=await page.request.get('http://localhost:3000/api/brokers');
  if(response.status()!==(configured?401:503)||!response.headers()['cache-control']?.includes('no-store'))throw new Error('Broker API did not fail closed without caching');
  const error=await response.json();if(error.error?.code!==(configured?'sign_in_required':'not_configured'))throw new Error('Unsafe or unexpected service error');
  if(configured){const sync=await page.request.post('http://localhost:3000/api/brokers/sync',{headers:{origin:'http://localhost:3000','content-type':'application/json'},data:{}});if(sync.status()!==401)throw new Error('Signed-out synchronisation was not refused');}
  const stored=await page.evaluate(()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage)}));
  if([...stored.local,...stored.session].some(k=>/broker|credential|secret|trading212/i.test(k)))throw new Error('Broker credentials persisted in browser storage');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'test-results/broker-settings-mobile.png',caret:'initial'});
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Broker settings mobile overflow');
  if(errors.length)throw new Error(errors.join('\n'));
  console.log(`Broker browser checks passed (${configured?'configured, signed out':'unconfigured'}): Settings navigation, separate environments, empty password fields, fail-closed API, no browser storage, mobile layout.`);
}finally{await browser.close();}
