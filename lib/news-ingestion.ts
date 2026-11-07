/** Extract candidates only. Source publication and claim verification require review. */
export type ArticleInput = { url: string; title: string; text: string; publishedAt: number | null; receivedAt: number };
export function extractArticleClaims(input: ArticleInput) {
  const url = new URL(input.url);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('An HTTPS article URL without credentials is required');
  if (!input.title.trim() || !input.text.trim() || input.text.length > 100_000) throw new Error('Title and article text (up to 100,000 characters) required');
  if (!Number.isFinite(input.receivedAt) || (input.publishedAt !== null && (!Number.isFinite(input.publishedAt) || input.publishedAt > input.receivedAt))) throw new Error('Publication cannot follow receipt; leave unknown publication empty');
  const pattern = /(?:\$\s*)?([−-]?\d+(?:,\d{3})*(?:\.\d+)?)\s*(billion|million|bn|%)/gi;
  const claims: {id:string;excerpt:string;value:number;unit:'billions'|'millions'|'percent';verification:'unverified';classification:'unclassified'}[] = [];
  for (const match of input.text.matchAll(pattern)) {
    if (claims.length >= 100) throw new Error('More than 100 numerical candidates; split the article for review');
    const value = Number(match[1].replaceAll(',', '').replace('−', '-'));
    if (!Number.isFinite(value)) throw new Error('Non-finite article value');
    const start=match.index!, unit=match[2].toLowerCase();
    claims.push({id:`candidate-${start}`,excerpt:input.text.slice(Math.max(0,start-70),Math.min(input.text.length,start+match[0].length+70)),value,unit:unit==='%'?'percent':unit==='million'?'millions':'billions',verification:'unverified',classification:'unclassified'});
  }
  return {source:{url:url.href,title:input.title.trim(),publishedAt:input.publishedAt,receivedAt:input.receivedAt},originalText:input.text,claims};
}
