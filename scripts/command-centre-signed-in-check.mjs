// Signed-in layout check for the dedicated Clerk DEVELOPMENT test user (no password, empty data).
// Requires CLERK_UI_TICKET: a short-lived, one-time sign-in token created server-side for that user only.
// No credential is typed into the page; the ticket is consumed via Clerk's ticket strategy.
import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
const ticket=process.env.CLERK_UI_TICKET,BASE='http://localhost:3000',WIDTHS=[390,768,1440,1920];
if(!ticket)throw new Error('CLERK_UI_TICKET is required');
const browser=await chromium.launch({headless:true,channel:'msedge'});
try{
 fs.mkdirSync('test-results/command-centre',{recursive:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${BASE}/`);await page.waitForFunction(()=>window.Clerk?.loaded,null,{timeout:30000});
 const result=await page.evaluate(async t=>{const c=window.Clerk;const si=await c.client.signIn.create({strategy:'ticket',ticket:t});if(si.status!=='complete')return si.status;await c.setActive({session:si.createdSessionId});return 'complete';},ticket);
 if(result!=='complete')throw new Error(`Ticket sign-in did not complete: ${result}`);
 await page.reload();await expect(page.getByTestId('command-centre')).toBeVisible({timeout:30000});
 const who=await page.evaluate(()=>window.Clerk?.user?.externalId);if(who!=='aci-ui-layout-test')throw new Error('Signed in as an unexpected user');
 for(const w of WIDTHS){await page.setViewportSize({width:w,height:1000});await page.waitForTimeout(800);
  await expect(page.getByTestId('command-centre')).toHaveAttribute('data-source','broker');await expect(page.locator('.cc-fixture')).toHaveCount(0);
  await expect(page.getByTestId('kpi-empty')).toContainText('No account data yet');await expect(page.getByTestId('kpi-empty').getByRole('link',{name:/Connect Trading 212/})).toHaveAttribute('href','/settings/brokers');
  await expect(page.locator('[data-alert=noconn]')).toBeVisible();await expect(page.locator('[data-alert=noconn]').getByRole('link')).toHaveAttribute('href','/settings/brokers');
  await expect(page.getByTestId('chart-empty')).toBeVisible();await expect(page.getByTestId('approvals-widget')).toContainText('0 awaiting review');
  await expect(page.getByTestId('execution-widget')).toContainText('Reviewer grant: none');await expect(page.getByTestId('execution-widget')).toContainText('Live submission: disabled');
  await expect(page.getByTestId('killswitch-widget')).toContainText('Engaged');
  const o=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);if(o>1)throw new Error(`signed-in ${w}: overflow ${o}px`);
  await page.screenshot({path:`test-results/command-centre/signed-in-${w}.png`,fullPage:true});}
 await page.evaluate(async()=>{await window.Clerk.signOut();});
 if(errors.length)throw new Error(errors.join('\n'));
 console.log('Signed-in command-centre checks passed at 390/768/1440/1920 for the dedicated dev test user: empty-account states, connect routes, approvals 0, reviewer none, Live disabled, emergency switch engaged, no fixture styling, no overflow. Signed out afterwards.');
}finally{await browser.close();}
