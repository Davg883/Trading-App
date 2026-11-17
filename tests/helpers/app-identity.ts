/**
 * G9.3.5 — application context for convex-test identities.
 *
 * convex/authz.ts `verifyIdentityClaims` now refuses every identity that carries neither an approved authorised party
 * (`azp`) nor an approved audience (`aud`). Real callers always send one: the browser and the Next.js server routes
 * forward Clerk session tokens whose `azp` is the page origin (or the `convex` template's `aud: "convex"`).
 *
 * Test identities therefore state that context explicitly instead of the production check being relaxed:
 *
 *   t.withIdentity({...APP_SESSION, subject: 'alice', tokenIdentifier: 'test|alice'})
 *
 * `APP_SESSION` models a default Clerk browser session token (`azp` = an allowed origin, no `aud`). The origin is
 * `http://localhost:3000`, which is in the authz default allowlist used when `CLERK_ALLOWED_AZP_ORIGINS` is unset (the
 * Convex test environment). Spread it FIRST so a test can still override `azp`/`aud` with untrusted values to prove a
 * refusal. Tests of the missing-context refusal itself must not use it.
 */
export const TEST_APP_ORIGIN = 'http://localhost:3000';

/** Default Clerk browser session token context: approved `azp`, no `aud`. */
export const APP_SESSION = Object.freeze({azp: TEST_APP_ORIGIN});

/** Clerk `convex` JWT template context: approved `aud`, no `azp`. */
export const CONVEX_TEMPLATE_SESSION = Object.freeze({aud: 'convex'});
