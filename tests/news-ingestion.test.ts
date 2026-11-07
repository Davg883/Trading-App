import { describe, expect, it } from 'vitest';
import { extractArticleClaims } from '../lib/news-ingestion';
const article={url:'https://example.com/earnings',title:'Earnings',text:'Revenue $127.58 billion; free cash flow −9.07bn. Growth 103%.',publishedAt:10,receivedAt:20};
describe('article claim intake',()=>{
  it('retains original text and separates unverified candidates from facts',()=>{const result=extractArticleClaims(article);expect(result.originalText).toBe(article.text);expect(result.claims.map(c=>c.value)).toEqual([127.58,-9.07,103]);expect(result.claims.every(c=>c.verification==='unverified'&&c.classification==='unclassified')).toBe(true);expect(result.source.publishedAt).toBe(10);});
  it('keeps unknown publication unknown and rejects impossible timestamps',()=>{expect(extractArticleClaims({...article,publishedAt:null}).source.publishedAt).toBeNull();expect(()=>extractArticleClaims({...article,publishedAt:30})).toThrow();});
  it('rejects credentialed or unsafe URLs and excessive text',()=>{expect(()=>extractArticleClaims({...article,url:'javascript:alert(1)'})).toThrow();expect(()=>extractArticleClaims({...article,url:'https://user:secret@example.com'})).toThrow();expect(()=>extractArticleClaims({...article,text:'a'.repeat(100001)})).toThrow();});
});
