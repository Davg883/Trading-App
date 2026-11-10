/**
 * Research-only deployment boundary (MVP hardening, work package 3).
 *
 * `DEPLOYMENT_EXECUTION_AUTHORITY` is a compile-time constant. It is not read from an environment variable,
 * a database row, a request, a feature flag or any other runtime input, so no configuration change, leaked
 * credential or prompt can turn order execution on in a build made from this source. `LIVE_TRADING_ENABLED`
 * and `DEMO_TRADING_ENABLED` are therefore inert in this build: they can no longer enable anything.
 *
 * Enforcement points (each independently sufficient to stop an order):
 *   1. `handleTrading` (the `/api/trading` route) refuses every request before authentication, vault,
 *      Convex or broker access.
 *   2. `Trading212OrderClient.submit` and `.cancel` refuse before building a broker request.
 *   3. Convex refuses to store a trading key, record the trading opt-in, issue or accept an order
 *      confirmation, claim a submission, or release the Live emergency switch.
 *
 * Read-only brokerage synchronisation (`/api/brokers`, read-purpose vault credentials) is a separate code
 * path and is unaffected.
 *
 * Re-enabling execution is a product and regulatory decision, not a configuration change: it requires a
 * reviewed source change to this constant, ideally shipped as a separately deployed execution service.
 */
export const DEPLOYMENT_EXECUTION_AUTHORITY: 'none' | 'human_authorised_orders' = 'none';

export const RESEARCH_ONLY_ERROR_CODE = 'research_only_deployment';
export const RESEARCH_ONLY_MESSAGE =
  'This deployment is research-only (executionAuthority: none). Order execution, order confirmation, order cancellation and trading-key storage are not available.';

export class ResearchOnlyDeploymentError extends Error {
  readonly code = RESEARCH_ONLY_ERROR_CODE;
  readonly status = 403;
  constructor(readonly operation: string) {
    super(`${RESEARCH_ONLY_MESSAGE} Refused operation: ${operation}.`);
    this.name = 'ResearchOnlyDeploymentError';
  }
}

/** True only in a build whose source grants execution authority. Always false in this build. */
export function executionPermitted(): boolean {
  return DEPLOYMENT_EXECUTION_AUTHORITY !== 'none';
}

/** Throws unless the build grants execution authority. Takes no flag, environment or caller input. */
export function assertExecutionPermitted(operation: string): void {
  if (!executionPermitted()) throw new ResearchOnlyDeploymentError(operation);
}
