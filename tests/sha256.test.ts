import {describe,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {sha256HexSync} from '../lib/crypto/sha256';
describe('sha256HexSync matches node:crypto',()=>{
 it('for empty, short, block-boundary, multi-block and non-ASCII input',()=>{
  for(const s of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'x'.repeat(1000), 'Which hyperscalers fund the Irish data-centre build-out? £ € 日本'])
   expect(sha256HexSync(s)).toBe(createHash('sha256').update(s,'utf8').digest('hex'));
 });
});
