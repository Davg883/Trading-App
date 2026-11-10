/**
 * Server-only client for the Evidence-Locked Chat gateway HTTP actions (`convex/http.ts`).
 *
 * - The gateway credential is read from `EVIDENCE_CHAT_GATEWAY_SECRET`, a dedicated machine secret that is
 *   never sent to a browser and is distinct from every other secret in the deployment.
 * - Requests are never retried here: a consume whose outcome is unknown (timeout, transport error) must be
 *   treated as spent, and the operator mints a new nonce.
 * - Nothing in this module accepts or forwards a caller-supplied owner identity.
 */
export type GatewayEnv = Record<string, string | undefined>;
export type GatewayFetch = (input: string, init: RequestInit) => Promise<Response>;

export type GatewayRetrievalContext = {
  checkpoint: {
    lastProjectedSequence: number;
    lastProjectionKey: string | null;
    projectedCount: number;
    reconciled: boolean;
  } | null;
  publicProjectedRelationships: unknown[];
  dailyCostCeilingGbp: number;
  dailyChatSpendGbp: number;
};

export type GatewayResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      /** `unavailable`: not configured, timed out or transport failure. `rejected`: the gateway refused. */
      kind: 'unavailable' | 'rejected';
      status: number | null;
      reason: string;
    };

const GATEWAY_TIMEOUT_MS = 10_000;

/** Convex serves HTTP actions from `<deployment>.convex.site`; `CONVEX_HTTP_ACTIONS_URL` overrides the derivation. */
export function resolveGatewayBaseUrl(env: GatewayEnv = process.env): string | null {
  const explicit = env.CONVEX_HTTP_ACTIONS_URL?.trim().replace(/\/+$/, '');
  if (explicit) return /^https:\/\/|^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(explicit) ? explicit : null;
  const cloud = env.NEXT_PUBLIC_CONVEX_URL?.trim().replace(/\/+$/, '');
  if (!cloud) return null;
  const m = /^https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*)\.convex\.cloud$/.exec(cloud);
  return m ? `https://${m[1]}.convex.site` : null;
}

export function gatewayConfigured(env: GatewayEnv = process.env): boolean {
  const secret = env.EVIDENCE_CHAT_GATEWAY_SECRET;
  return Boolean(secret && secret.length >= 32 && resolveGatewayBaseUrl(env));
}

async function post<T>(
  path: string,
  body: unknown,
  options: { env?: GatewayEnv; fetchImpl?: GatewayFetch; userToken?: string | null; timeoutMs?: number },
): Promise<GatewayResult<T>> {
  const env = options.env ?? process.env;
  const base = resolveGatewayBaseUrl(env);
  const secret = env.EVIDENCE_CHAT_GATEWAY_SECRET;
  if (!base || !secret || secret.length < 32)
    return { ok: false, kind: 'unavailable', status: null, reason: 'gateway_not_configured' };
  try {
    const response = await (options.fetchImpl ?? fetch)(`${base}${path}`, {
      method: 'POST',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs ?? GATEWAY_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        'X-ACI-Gateway-Authorization': `Bearer ${secret}`,
        ...(options.userToken ? { Authorization: `Bearer ${options.userToken}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (response.ok) return { ok: true, value: (await response.json()) as T };
    let reason = `http_${response.status}`;
    try {
      const parsed = (await response.json()) as { error?: { code?: string; reason?: string } };
      reason = parsed.error?.reason ?? parsed.error?.code ?? reason;
    } catch {
      // Keep the status-derived reason
    }
    return {
      ok: false,
      kind: response.status >= 500 ? 'unavailable' : 'rejected',
      status: response.status,
      reason,
    };
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return {
      ok: false,
      kind: 'unavailable',
      status: null,
      reason: timedOut ? 'gateway_timeout' : 'gateway_unreachable',
    };
  }
}

type Options = { env?: GatewayEnv; fetchImpl?: GatewayFetch; timeoutMs?: number };

export function consumeAcceptanceNonce(token: string, question: string, options: Options = {}) {
  return post<{
    owner: string;
    reservation: string;
    recordDeadlineMs: number;
    budget?: { reserved: boolean; reason?: string };
    context: GatewayRetrievalContext;
  }>('/api/evidence-chat/acceptance/consume', { token, question }, options);
}

export function recordAcceptanceTurn(
  token: string,
  reservation: string,
  turn: Record<string, unknown>,
  options: Options = {},
) {
  return post<{ auditId: string; duplicate: boolean }>(
    '/api/evidence-chat/acceptance/record',
    { token, reservation, turn },
    options,
  );
}

export function failAcceptanceNonce(
  token: string,
  reservation: string,
  failureCode: string,
  options: Options = {},
) {
  return post<{ failed: true }>(
    '/api/evidence-chat/acceptance/fail',
    { token, reservation, failureCode },
    options,
  );
}

/** Attested audit record for a signed-in user: gateway credential plus the user's own Convex JWT. */
export function recordAuthenticatedTurn(
  userToken: string,
  turn: Record<string, unknown>,
  options: Options & { budgetReservation?: string | null } = {},
) {
  const { budgetReservation, ...rest } = options;
  return post<{ auditId: string }>(
    '/api/evidence-chat/turn',
    { turn, ...(budgetReservation ? { budgetReservation } : {}) },
    { ...rest, userToken },
  );
}

/**
 * Atomic paid-inference budget reservation for the signed-in user. Callers must treat any result other than
 * `ok` as "do not call the paid provider": `rejected` with reason `budget_exceeded` or `rate_limited`, or
 * `unavailable` when the authoritative budget cannot be checked.
 */
export function reserveChatBudget(userToken: string, options: Options = {}) {
  return post<{ reservation: string; spentGbp: number; ceilingGbp: number; expiresAtMs: number }>(
    '/api/evidence-chat/budget/reserve',
    {},
    { ...options, userToken },
  );
}
