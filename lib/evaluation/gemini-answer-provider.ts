import { GoogleGenAI } from '@google/genai';
import type { AnswerProvider, PricingTable, ProviderResponse } from './evaluation-harness';

/**
 * Live Gemini answer provider for the evaluation harness (MVP hardening WP6).
 * Records only what the provider returns. Missing usage fields stay `null`; no default token counts,
 * request ids or model versions are invented. Any error is rethrown so the harness records `provider_failed`.
 */
export function createGeminiAnswerProvider(options: {
  apiKey: string;
  modelId: string;
  timeoutMs?: number;
  client?: Pick<GoogleGenAI, 'models'>;
}): AnswerProvider {
  const client = options.client ?? new GoogleGenAI({ apiKey: options.apiKey, httpOptions: { timeout: options.timeoutMs ?? 30_000 } });
  return {
    kind: 'live_provider',
    providerName: 'google_gemini',
    requestedModelId: options.modelId,
    async generate(prompt: string): Promise<ProviderResponse> {
      const response = await client.models.generateContent({
        model: options.modelId,
        contents: prompt,
        config: { responseMimeType: 'application/json', temperature: 0 },
      });
      const text = response.text;
      if (typeof text !== 'string' || text.length === 0) throw new Error('Provider returned no text');
      const u = response.usageMetadata;
      const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
      return {
        text,
        providerResponseId: typeof response.responseId === 'string' ? response.responseId : null,
        providerModelVersion: typeof response.modelVersion === 'string' ? response.modelVersion : null,
        usage: u
          ? {
              promptTokens: n(u.promptTokenCount),
              outputTokens: n(u.candidatesTokenCount),
              thoughtsTokens: n(u.thoughtsTokenCount),
              cachedTokens: n(u.cachedContentTokenCount),
              totalTokens: n(u.totalTokenCount),
            }
          : null,
      };
    },
  };
}

/**
 * Price table used for cost estimates. The figures must be confirmed against the provider's current price
 * list before a billable run; the run artefact records them so any later correction is traceable.
 */
export function pricingFromEnv(env: Record<string, string | undefined>): PricingTable | null {
  const input = Number(env.ACI_EVAL_GBP_PER_MILLION_INPUT_TOKENS);
  const output = Number(env.ACI_EVAL_GBP_PER_MILLION_OUTPUT_TOKENS);
  const source = env.ACI_EVAL_PRICING_SOURCE?.trim();
  const retrieved = env.ACI_EVAL_PRICING_RETRIEVED_ON?.trim();
  if (!(input > 0) || !(output > 0) || !source || !retrieved) return null;
  return {
    pricingSource: source,
    pricingRetrievedOn: retrieved,
    gbpPerInputToken: input / 1_000_000,
    gbpPerOutputToken: output / 1_000_000,
  };
}
