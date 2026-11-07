// Configures the server-only Trading 212 vault settings in .env.local without printing any secret.
// - CONVEX_BROKER_ADMIN_KEY: a new Convex deploy key for the given deployment, created with the Convex CLI.
// - BROKER_VAULT_KEY_B64: 32 cryptographically random bytes, standard Base64 (AES-256-GCM key).
// - BROKER_VAULT_KEY_VERSION=v1, BROKER_APP_ORIGIN=http://localhost:3000
// Refuses to replace an existing vault key, because that would make saved credentials undecryptable.
// Usage: node scripts/configure-broker-vault.mjs <convex-deployment-name>
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

const deployment=process.argv[2];
if(!deployment||!/^[a-z]+-[a-z]+-\d+$/.test(deployment)){console.error('Usage: node scripts/configure-broker-vault.mjs <convex-deployment-name>');process.exit(2);}
const envPath=path.resolve('.env.local');
if(!existsSync(envPath)){console.error('.env.local not found; run from the project root.');process.exit(2);}
const lines=readFileSync(envPath,'utf8').split(/\r?\n/);
const has=k=>lines.some(l=>l.startsWith(`${k}=`)&&l.length>k.length+1);
if(has('BROKER_VAULT_KEY_B64')){console.error('BROKER_VAULT_KEY_B64 is already set. Not replacing it: existing saved credentials would become unreadable.');process.exit(3);}

const dir=mkdtempSync(path.join(tmpdir(),'broker-key-')),tmp=path.join(dir,'key.env');
try{
 const name=`trading-app-broker-readonly-${new Date().toISOString().slice(0,10)}`;
 const run=spawnSync('npx',['convex','deployment','token','create',name,'--deployment',deployment,'--save-env',tmp],{stdio:['ignore','ignore','pipe'],shell:process.platform==='win32',encoding:'utf8'});
 if(run.status!==0||!existsSync(tmp)){console.error('Convex deploy-key creation failed (details withheld). Check `npx convex` login and the deployment name.');process.exit(4);}
 const adminKey=readFileSync(tmp,'utf8').split(/\r?\n/).find(l=>l.startsWith('CONVEX_DEPLOY_KEY='))?.slice('CONVEX_DEPLOY_KEY='.length).trim();
 if(!adminKey){console.error('Deploy key not found in CLI output file.');process.exit(4);}
 const vaultKey=randomBytes(32).toString('base64');
 const managed=['CONVEX_BROKER_ADMIN_KEY','BROKER_VAULT_KEY_B64','BROKER_VAULT_KEY_VERSION','BROKER_APP_ORIGIN'];
 const kept=lines.filter(l=>!managed.some(k=>l.startsWith(`${k}=`))&&l!=='# Read-only Trading 212 vault (server-only)');
 while(kept.length&&kept[kept.length-1]==='')kept.pop();
 kept.push('','# Read-only Trading 212 vault (server-only)',`CONVEX_BROKER_ADMIN_KEY=${adminKey}`,`BROKER_VAULT_KEY_B64=${vaultKey}`,'BROKER_VAULT_KEY_VERSION=v1','BROKER_APP_ORIGIN=http://localhost:3000','');
 writeFileSync(envPath,kept.join('\n'),'utf8');
 console.log(`Broker vault configured in .env.local (deploy key "${name}" for ${deployment}; 32-byte vault key v1). No secret values were printed. Restart the dev server.`);
}finally{rmSync(dir,{recursive:true,force:true});}
