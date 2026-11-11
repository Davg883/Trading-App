# 06 — CI/CD and release gating

**Work package:** WP5, commit `ebcb7fd`
**Status:** Workflow committed to the branch; it runs on pull requests. Its first run on GitHub had not been observed at the time of writing. Branch protection and Vercel settings were **not** inspected or changed (owner settings).

## 1. Baseline

Only `.github/workflows/remote-research-operations.yml` existed. It ran one Python test file and triggered the Convex scheduler endpoint. No type check, Vitest, build, lint or audit ran in CI. A clean Linux checkout could not run Vitest at all (Windows-only bundler binding in the lockfile) and three pinned-hash tests failed on LF line endings.

## 2. Changes

`.github/workflows/ci.yml` (on pull requests, pushes to `main`, manual dispatch):

| Job | Steps |
|---|---|
| Type check, lint baseline, unit tests, build | `npm ci`; assert no provider, broker, deployment or gateway secret is present; `tsc`; ESLint non-regression gate; Vitest; `next build` |
| Python unit tests | `unittest discover` over `worker/` |
| GitHub Actions semantic validation | actionlint 1.7.7 |
| Dependency audit | full report (informational); fail on high/critical |
| **CI gate** | Fails unless every job above succeeded — the single check to require in branch protection |

Properties: `permissions: contents: read`; no repository secrets referenced; `LIVE_TRADING_ENABLED=false`, `DEMO_TRADING_ENABLED=false`, `EVIDENCE_CHAT_GEMINI_ENABLED=false` pinned; no deploy step.

Supporting changes:
- Linux bundler binding added to `optionalDependencies` and the lockfile.
- `.gitattributes` fixes CRLF line endings for the three hash-pinned evidence packages so the registered SHA-256 values reproduce on every platform. File contents are unchanged.
- Live TypeDB tests run only with `ACI_LIVE_TYPEDB_TESTS=1` (`npm run test:integration:typedb`) and otherwise report as **skipped**, never passed.
- The scheduled workflow now validates the dispatch `job_key` (it was interpolated into JSON).

## 3. ESLint baseline and clean-up plan

`scripts/eslint-baseline-check.mjs` records existing errors per file and rule in `config/eslint-baseline.json` and fails on any new error; `--update` refuses to raise the total. Baseline: 31 errors at introduction, **29** after WP6 removed two `any` casts.

| Rule | Count | Plan |
|---|---|---|
| `@typescript-eslint/no-explicit-any` | 23 | Replace with SDK types; mostly tests and evaluation helpers. Target: 30 November 2026 |
| `react-hooks/purity` | 4 | `Date.now()` during render in `app/page.tsx`, `app/workspace/page.tsx`, two components; move to server props or effects. Target: 30 November 2026 |
| `react/no-unescaped-entities` | 2 | Escape quotes. Target: 20 November 2026 |

Rules were not disabled.

## 4. Local reproduction of the CI job (final commit)

Clean `npm ci` on Linux; typecheck pass; lint gate pass (29 = baseline); Vitest **646 passed, 4 skipped** (3 live TypeDB, 1 billable live evaluation); Python **218 passed, 1 skipped**; build pass; actionlint pass; `npm audit --audit-level=high` pass (8 moderate advisories remain in the ESLint toolchain).

## 5. Release controls — not verified

| Control | Status | Owner action |
|---|---|---|
| Branch protection on `main` | Not inspected (no tool access to settings) | Require pull requests, at least one approval, and the **CI gate** status check; disallow force pushes; include administrators |
| Vercel production deployment | Not inspected | Confirm production deploys only from `main`; consider "require checks to pass" or a manual promote step |
| Preview isolation | Not inspected | Previews must not hold production Convex, Clerk, vault, gateway or TypeDB secrets. The broker vault already refuses to run when `VERCEL_ENV=preview`. |
| Secrets exposure | CI uses none | Keep CI hermetic |
| Rollback | Vercel "promote previous deployment"; Convex rollback per 03 §6 | Never roll Convex back to the pre-WP2 functions |

A green workflow does not stop a release until branch protection requires it.

## 6. Release-gating test plan (owner-run)

1. Create a temporary branch with a deliberately failing assertion; open a draft pull request; confirm **CI gate** fails and the merge button is blocked.
2. Push a fix; confirm **CI gate** passes and merging is allowed only with the required approval.
3. Confirm the Vercel deployment for the failing commit was not promoted to production.
4. Record screenshots or links as evidence; delete the temporary branch.

Do not disable the existing production deployment mechanism until this plan has been demonstrated.
