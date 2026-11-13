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

const CONVEX_DNS_LABEL_SOURCE = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const CONVEX_HOST_RE = new RegExp(
  `^(${CONVEX_DNS_LABEL_SOURCE}(?:\\.${CONVEX_DNS_LABEL_SOURCE})?)\\.convex\\.(cloud|site)$`,
);
const LOCAL_GATEWAY_ORIGIN_RE =
  /^https?:\/\/(127\.0\.0\.1|localhost)(?::([1-9]\d{0,4}))?\/?$/;

function parseConvexGatewaySiteOrigin(
  rawUrl: string,
  options: { allowCloudHostname: boolean },
): string | null {
  const trimmed = rawUrl.trim();
  if (!/^https:\/\/[a-z0-9.-]+\/?$/.test(trimmed)) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    return null;
  }
  const match = CONVEX_HOST_RE.exec(parsed.hostname);
  if (!match) return null;
  const [, deploymentAndRegion, tld] = match;
  if (tld === 'cloud' && !options.allowCloudHostname) return null;
  return `https://${deploymentAndRegion}.convex.site`;
}

function parseExplicitGatewayOverride(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  const localMatch = LOCAL_GATEWAY_ORIGIN_RE.exec(trimmed);
  if (localMatch) {
    const port = localMatch[2] ? Number(localMatch[2]) : null;
    if (port !== null && (port < 1 || port > 65535)) return null;
    return trimmed.replace(/\/+$/, '');
  }
  return parseConvexGatewaySiteOrigin(trimmed, { allowCloudHostname: true });
}

/**
 * Convex serves HTTP actions from `<deployment>.convex.site` (or `<deployment>.<region>.convex.site`);
 * `CONVEX_HTTP_ACTIONS_URL` overrides the derivation and fails closed if invalid.
 */
export function resolveGatewayBaseUrl(env: GatewayEnv = process.env): string | null {
  const explicitRaw = env.CONVEX_HTTP_ACTIONS_URL?.trim();
  if (explicitRaw) {
    return parseExplicitGatewayOverride(explicitRaw);
  }
  const siteRaw = env.NEXT_PUBLIC_CONVEX_SITE_URL?.trim();
  const cloudRaw = env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (siteRaw) {
    const siteOrigin = parseConvexGatewaySiteOrigin(siteRaw, { allowCloudHostname: false });
    if (!siteOrigin) return null;
    if (cloudRaw) {
      const cloudOrigin = parseConvexGatewaySiteOrigin(cloudRaw, { allowCloudHostname: true });
      if (!cloudOrigin || cloudOrigin !== siteOrigin) return null;
    }
    return siteOrigin;
  }
  if (!cloudRaw) return null;
  return parseConvexGatewaySiteOrigin(cloudRaw, { allowCloudHostname: true });
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

/** reserved -> in_flight for the signed-in user's reservation. Do not call the paid provider unless `ok`. */
export function startChatBudget(userToken: string, budgetReservation: string, options: Options = {}) {
  return post<{ started: true; inFlightDeadlineMs: number }>(
    '/api/evidence-chat/budget/start',
    { budgetReservation },
    { ...options, userToken },
  );
}

/** Starts the budget reservation taken when the acceptance nonce was consumed. */
export function startAcceptanceBudget(token: string, reservation: string, options: Options = {}) {
  return post<{ started: true; inFlightDeadlineMs: number }>(
    '/api/evidence-chat/acceptance/start',
    { token, reservation },
    options,
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
