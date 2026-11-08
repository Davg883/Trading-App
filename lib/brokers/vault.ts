import 'server-only';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {z} from 'zod';
import {brokerCredentialsSchema,brokerEnvironmentSchema,type BrokerCredentials,type BrokerEnvironment} from './contracts';

export const encryptedBrokerCredentialsSchema=z.object({version:z.literal('broker-vault-v1'),keyVersion:z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),iv:z.string().max(100),tag:z.string().max(100),ciphertext:z.string().max(20000)}).strict();
export type EncryptedBrokerCredentials=z.infer<typeof encryptedBrokerCredentialsSchema>;
type VaultEnvironment=Record<string,string|undefined>;
export class BrokerVaultError extends Error{constructor(){super('Broker credential vault is unavailable or the stored credentials could not be verified.');this.name='BrokerVaultError';}}
function cleanEnv(raw:string|undefined):string|undefined{if(typeof raw!=='string')return undefined;const t=raw.trim().replace(/^["']+|["']+$/g,'').trim();return t.length>0?t:undefined;}
function config(env:VaultEnvironment){if(env.VERCEL_ENV==='preview')throw new BrokerVaultError();const encoded=cleanEnv(env['BROKER_VAULT_KEY_B64']),version=cleanEnv(env.BROKER_VAULT_KEY_VERSION);if(!encoded||!version||!/^[A-Za-z0-9._-]{1,64}$/.test(version)||!/^[A-Za-z0-9+/]{43}=$/.test(encoded))throw new BrokerVaultError();const key=Buffer.from(encoded,'base64');if(key.length!==32||key.toString('base64')!==encoded)throw new BrokerVaultError();return {key,version};}
export type VaultPurpose='read'|'orders';
function aad(owner:string,environment:BrokerEnvironment,keyVersion:string,purpose:VaultPurpose='read'){if(!owner.trim()||owner.length>1000)throw new BrokerVaultError();brokerEnvironmentSchema.parse(environment);// Read-only ciphertexts keep the original AAD; trading keys add a purpose so the two can never be swapped.
  return Buffer.from(JSON.stringify(purpose==='read'?{provider:'trading212',owner,environment,keyVersion,version:'broker-vault-v1'}:{provider:'trading212',owner,environment,keyVersion,version:'broker-vault-v1',purpose}));}
export function vaultConfigured(env:VaultEnvironment=process.env){try{config(env);return true;}catch{return false;}}
export function maskApiKey(apiKey:string){const suffix=apiKey.slice(-4);return apiKey.length>=8&&/^[A-Za-z0-9_-]{4}$/.test(suffix)?`••••${suffix}`:'••••';}
export function encryptCredentials(credentials:BrokerCredentials,owner:string,environment:BrokerEnvironment,env:VaultEnvironment=process.env,purpose:VaultPurpose='read'):EncryptedBrokerCredentials{
  try{const parsed=brokerCredentialsSchema.parse(credentials),{key,version}=config(env),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad(owner,environment,version,purpose));const ciphertext=Buffer.concat([cipher.update(JSON.stringify(parsed),'utf8'),cipher.final()]);return {version:'broker-vault-v1',keyVersion:version,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')};}catch{throw new BrokerVaultError();}
}
export function decryptCredentials(input:EncryptedBrokerCredentials,owner:string,environment:BrokerEnvironment,env:VaultEnvironment=process.env,purpose:VaultPurpose='read'):BrokerCredentials{
  try{const r=encryptedBrokerCredentialsSchema.parse(input),{key,version}=config(env);if(r.keyVersion!==version)throw new BrokerVaultError();const iv=Buffer.from(r.iv,'base64'),tag=Buffer.from(r.tag,'base64'),ciphertext=Buffer.from(r.ciphertext,'base64');if(!ciphertext.length||ciphertext.toString('base64')!==r.ciphertext)throw new BrokerVaultError();if(iv.length!==12||tag.length!==16||iv.toString('base64')!==r.iv||tag.toString('base64')!==r.tag)throw new BrokerVaultError();const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(aad(owner,environment,r.keyVersion,purpose));decipher.setAuthTag(tag);const raw=Buffer.concat([decipher.update(ciphertext),decipher.final()]).toString('utf8');return brokerCredentialsSchema.parse(JSON.parse(raw));}catch{throw new BrokerVaultError();}
}

export function verifyBrokerVaultSelfTest(env:VaultEnvironment=process.env):{ready:boolean;cipher:'AES-256-GCM';keyVersion:string|null;selfTestPassed:boolean;reason:string}{
  try{
    const {version}=config(env);
    const probe:BrokerCredentials={apiKey:'selftest-probe-key-0000',apiSecret:'selftest-probe-secret-0000'};
    const encrypted=encryptCredentials(probe,'vault-selftest-owner','demo',env,'read');
    const decrypted=decryptCredentials(encrypted,'vault-selftest-owner','demo',env,'read');
    let crossOwnerBlocked=false;
    try{decryptCredentials(encrypted,'vault-selftest-other-owner','demo',env,'read');}catch{crossOwnerBlocked=true;}
    if(!crossOwnerBlocked||decrypted.apiKey!==probe.apiKey||decrypted.apiSecret!==probe.apiSecret||encrypted.ciphertext.includes(probe.apiSecret)){
      return {ready:false,cipher:'AES-256-GCM',keyVersion:version,selfTestPassed:false,reason:'AES-256-GCM self-test round-trip or AAD isolation check failed.'};
    }
    return {ready:true,cipher:'AES-256-GCM',keyVersion:version,selfTestPassed:true,reason:`AES-256-GCM server vault self-test passed (keyVersion=${version}).`};
  }catch{
    return {ready:false,cipher:'AES-256-GCM',keyVersion:null,selfTestPassed:false,reason:'Server vault encryption key is not configured in this deployment.'};
  }
}

export function diagnoseBrokerVaultReadiness(env:VaultEnvironment=process.env):{vaultKeyPresent:boolean;vaultKeyVersionPresent:boolean;vaultKeyFormatValid:boolean;vaultSelfTestPassed:boolean}{
  const encoded=cleanEnv(env['BROKER_VAULT_KEY_B64']);
  const version=cleanEnv(env.BROKER_VAULT_KEY_VERSION);
  const vaultKeyPresent=Boolean(encoded);
  const vaultKeyVersionPresent=Boolean(version&&/^[A-Za-z0-9._-]{1,64}$/.test(version));
  let vaultKeyFormatValid=false;
  if(encoded&&/^[A-Za-z0-9+/]{43}=$/.test(encoded)){
    const buf=Buffer.from(encoded,'base64');
    vaultKeyFormatValid=buf.length===32&&buf.toString('base64')===encoded;
  }
  const selfTest=verifyBrokerVaultSelfTest(env);
  return {vaultKeyPresent,vaultKeyVersionPresent,vaultKeyFormatValid,vaultSelfTestPassed:selfTest.selfTestPassed};
}
