/**
 * Sprint G9.2 — frontend/backend release compatibility verdict.
 * The frontend is compatible with the running Convex backend only when both were built from the same Convex source
 * closure (identical `sourceSha256` under the same contract version). Anything else fails release acceptance.
 */
export type ConvexFingerprint = {
  contractVersion: string;
  sourceSha256: string;
  fileCount: number;
  packageCount: number;
};

export type BackendFingerprint = ConvexFingerprint & {
  deployedGitSha: string | null;
  deployedAt: string | null;
};

export type ReleaseCompatibilityVerdict = 'COMPATIBLE' | 'INCOMPATIBLE' | 'BACKEND_UNREACHABLE' | 'BACKEND_UNVERSIONED';

export function evaluateReleaseCompatibility(
  expected: ConvexFingerprint,
  backend: BackendFingerprint | null,
  backendError: string | null,
): { verdict: ReleaseCompatibilityVerdict; compatible: boolean; detail: string } {
  if (!backend) {
    const unversioned = backendError !== null && /could not find public function|release:fingerprint/i.test(backendError);
    return unversioned
      ? {
          verdict: 'BACKEND_UNVERSIONED',
          compatible: false,
          detail: 'The deployed Convex backend predates release fingerprinting; it cannot be proven compatible with this frontend.',
        }
      : { verdict: 'BACKEND_UNREACHABLE', compatible: false, detail: `Convex backend fingerprint unavailable: ${backendError ?? 'unknown error'}.` };
  }
  if (backend.contractVersion !== expected.contractVersion || backend.sourceSha256 !== expected.sourceSha256) {
    return {
      verdict: 'INCOMPATIBLE',
      compatible: false,
      detail: `Frontend expects Convex sources ${expected.sourceSha256.slice(0, 12)} (${expected.contractVersion}); backend runs ${backend.sourceSha256.slice(0, 12)} (${backend.contractVersion}). Redeploy Convex from the frontend's commit.`,
    };
  }
  return {
    verdict: 'COMPATIBLE',
    compatible: true,
    detail: `Frontend and backend built from Convex sources ${expected.sourceSha256.slice(0, 12)}${backend.deployedGitSha ? ` (backend deployed from ${backend.deployedGitSha.slice(0, 12)})` : ''}.`,
  };
}
