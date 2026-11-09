import {
  EVIDENCE_LOCKED_ANSWER_VERSION,
  SUGGESTED_STARTER_QUESTIONS,
  answerValidationReportSchema,
  evidenceLockedAnswerSchema,
  type AnswerValidationReport,
  type EvidenceBundleV1,
  type EvidenceLockedAnswer,
} from './evidence-chat-contracts';
import { detectAdversarialContent } from './evidence-retrieval-gateway';
import { assertNoBrokerOrPrivateAccountData } from './query-gateway';

/**
 * Phase G.4 (Phase E) — Independent Semantic, Numerical, Temporal & Security Answer Validator.
 *
 * Verifies every model response against the frozen `EvidenceBundleV1` before display:
 * 1. Every cited evidence ID (`docId` or `claimId`) exists in `bundle`.
 * 2. Every referenced graph `relationshipId` exists in `bundle.relationships`.
 * 3. Historical cutoff eligibility is respected (blocks hindsight leakage of post-cutoff S-1/S-1A facts).
 * 4. Quoted numerical values, units, and currencies match source records in `bundle`.
 * 5. Deterministic commitment-ledger arithmetic is respected (blocks $940B naive double-count presented as true total).
 * 6. Rejects private/broker references and prompt-injection overrides.
 *
 * If validation fails, returns an explicit evidence-limited abstention response (`downgraded_to_abstention`).
 */

export function buildEvidenceLimitedAbstentionAnswer(
  bundle: EvidenceBundleV1,
  reason: string,
): EvidenceLockedAnswer {
  const boundedReason = reason.slice(0, 360);
  const shortReason = reason.slice(0, 480);
  return evidenceLockedAnswerSchema.parse({
    version: EVIDENCE_LOCKED_ANSWER_VERSION,
    bundleId: bundle.bundleId,
    bundleSha256: bundle.bundleSha256,
    shortAnswer: `No supporting evidence in current bundle: ${boundedReason}`,
    executiveTldr: [
      `Explicit abstention enforced at cutoff ${bundle.historicalCutoffIso.slice(0, 10)} (${bundle.temporalBasis} clock).`,
      boundedReason,
      `Retrieved bundle (${bundle.bundleId}) contains ${bundle.relationships.length} eligible relationship(s) and ${bundle.sources.length} approved source document(s).`,
    ],
    supportingClaims: [],
    relevantRelationshipIds: bundle.relationships.slice(0, 5).map((r) => r.relationshipId),
    contradictoryEvidence: [],
    missingInformation: [boundedReason],
    historicalCutoffUsed: {
      asOfMs: bundle.historicalCutoffMs,
      asOfIso: bundle.historicalCutoffIso,
      temporalBasis: bundle.temporalBasis,
    },
    supportStatus: 'unsupported',
    abstentionReason: shortReason,
    suggestedFollowUpQuestions: [...SUGGESTED_STARTER_QUESTIONS.slice(0, 4)],
    executionAuthority: 'none',
  });
}

function collectAllowedNumbers(bundle: EvidenceBundleV1): Set<number> {
  const allowed = new Set<number>([0, 1, 2, 3, 4, 5, 6, 10, 15, 18, 20, 21, 23, 25, 30, 31, 50, 100, 2025, 2026, 2027, 2028]);
  const addNum = (n: number | null | undefined) => {
    if (n === null || n === undefined || !Number.isFinite(n)) return;
    allowed.add(Number(n));
    allowed.add(Math.abs(Number(n)));
    // Add billions / millions scaled equivalents for USD amounts
    if (Math.abs(n) >= 100_000_000) {
      const b = Number((n / 1_000_000_000).toFixed(2));
      allowed.add(b);
      allowed.add(Number((n / 1_000_000_000).toFixed(1)));
      allowed.add(Number((n / 1_000_000_000).toFixed(3)));
    }
    if (Math.abs(n) >= 1_000_000) {
      const m = Number((n / 1_000_000).toFixed(2));
      allowed.add(m);
      allowed.add(Number((n / 1_000_000).toFixed(0)));
    }
  };

  for (const rel of bundle.relationships) {
    addNum(rel.principalAmount);
    addNum(rel.capacityMw);
    addNum(rel.version);
  }
  for (const claim of bundle.quantitativeClaims) {
    addNum(claim.quantitativeValue);
  }
  for (const sc of bundle.scenarios) {
    addNum(sc.usEquityShockPct);
    addNum(sc.irishMddImpactPct);
    addNum(sc.irishInvestmentImpactPct);
    addNum(sc.irishExportsImpactPct);
    addNum(sc.irishEmploymentGrowthDeltaPp);
  }
  addNum(bundle.commitmentLedger.naiveComputeCommitmentsSumUsd);
  addNum(bundle.commitmentLedger.deduplicatedComputeCommitmentsUsd);
  addNum(bundle.commitmentLedger.doubleCountPreventedUsd);
  addNum(bundle.commitmentLedger.signedDebtAndCoInvestmentUsd);
  addNum(bundle.commitmentLedger.signedGuaranteesUsd);
  addNum(bundle.commitmentLedger.signedEquityAndConvertibleBackingCapUsd);
  addNum(bundle.relationships.length);
  addNum(bundle.sources.length);
  addNum(bundle.organisations.length);
  addNum(bundle.excludedByHistoricalCutoffCount);

  // Extract explicit numbers appearing in approved source excerpts or relationship summaries
  const textPool = [
    ...bundle.sources.map((s) => `${s.title} ${s.excerpt}`),
    ...bundle.relationships.map((r) => r.summary),
    ...bundle.quantitativeClaims.map((c) => `${c.title} ${c.assumptionsAndBasis}`),
  ].join(' ');
  const matches = textPool.matchAll(/-?\d+(?:\.\d+)?/g);
  for (const m of matches) {
    const parsed = Number(m[0]);
    if (Number.isFinite(parsed)) {
      allowed.add(parsed);
      allowed.add(Math.abs(parsed));
    }
  }

  return allowed;
}

function isNumberAllowed(value: number, allowed: Set<number>): boolean {
  if (allowed.has(value) || allowed.has(Math.abs(value))) return true;
  for (const candidate of allowed) {
    const tolerance = Math.max(0.05, Math.abs(candidate) * 0.005);
    if (Math.abs(value - candidate) <= tolerance || Math.abs(Math.abs(value) - candidate) <= tolerance) {
      return true;
    }
  }
  return false;
}

export function validateEvidenceLockedAnswer(
  candidateAnswer: unknown,
  bundle: EvidenceBundleV1,
  nowMs = Date.now(),
): {
  validatedAnswer: EvidenceLockedAnswer;
  report: AnswerValidationReport;
} {
  const invalidEvidenceIds: string[] = [];
  const invalidRelationshipIds: string[] = [];
  const unverifiedNumbers: string[] = [];
  const temporalViolations: string[] = [];
  const securityViolations: string[] = [];

  // 1. Schema validation
  const parsed = evidenceLockedAnswerSchema.safeParse(candidateAnswer);
  if (!parsed.success) {
    const reason = `Model output failed structured schema validation (${parsed.error.issues[0]?.message ?? 'invalid JSON structure'}).`;
    const fallback = buildEvidenceLimitedAbstentionAnswer(bundle, reason);
    return {
      validatedAnswer: fallback,
      report: answerValidationReportSchema.parse({
        valid: false,
        actionTaken: 'downgraded_to_abstention',
        checks: [
          {
            checkId: 'schema_valid',
            passed: false,
            detail: reason,
          },
        ],
        invalidEvidenceIds,
        invalidRelationshipIds,
        unverifiedNumbers,
        temporalViolations,
        securityViolations,
        validatedAtMs: nowMs,
      }),
    };
  }

  const answer = parsed.data;

  // 2. Security & Private/Broker Data Isolation Check
  const serializedAnswer = JSON.stringify(answer);
  try {
    assertNoBrokerOrPrivateAccountData(serializedAnswer);
  } catch (err) {
    securityViolations.push(
      err instanceof Error ? err.message : 'Forbidden broker or private account reference in answer',
    );
  }
  const adv = detectAdversarialContent(
    `${answer.shortAnswer} ${answer.executiveTldr.join(' ')} ${answer.supportingClaims.map((c) => c.statement).join(' ')}`,
  );
  if (adv.blocked && bundle.selectedQuery.intentCategory !== 'security_blocked') {
    securityViolations.push(`Adversarial or forbidden instruction pattern in answer (${adv.reasons.join(', ')})`);
  }

  // 3. Bundle Hash & ID Binding
  const bundleBound =
    answer.bundleId === bundle.bundleId && answer.bundleSha256 === bundle.bundleSha256;

  // 4. Evidence ID Existence Check
  const validEvidenceIds = new Set<string>([
    ...bundle.sources.map((s) => s.docId),
    ...bundle.quantitativeClaims.map((c) => c.claimId),
    ...bundle.scenarios.map((sc) => sc.scenarioId),
  ]);
  for (const claim of answer.supportingClaims) {
    for (const evId of claim.evidenceIds) {
      if (!validEvidenceIds.has(evId)) {
        invalidEvidenceIds.push(evId);
      }
    }
  }
  for (const contra of answer.contradictoryEvidence) {
    for (const evId of contra.evidenceIds) {
      if (!validEvidenceIds.has(evId)) {
        invalidEvidenceIds.push(evId);
      }
    }
  }

  // 5. Relationship ID Existence Check
  const validRelIds = new Set<string>(bundle.relationships.map((r) => r.relationshipId));
  for (const relId of answer.relevantRelationshipIds) {
    if (!validRelIds.has(relId)) {
      invalidRelationshipIds.push(relId);
    }
  }
  for (const claim of answer.supportingClaims) {
    for (const relId of claim.relationshipIds) {
      if (!validRelIds.has(relId)) {
        invalidRelationshipIds.push(relId);
      }
    }
  }
  for (const contra of answer.contradictoryEvidence) {
    for (const relId of contra.relationshipIds) {
      if (!validRelIds.has(relId)) {
        invalidRelationshipIds.push(relId);
      }
    }
  }

  // 6. Generalised Historical Cutoff & Hindsight Leakage Check
  if (
    answer.historicalCutoffUsed.asOfMs !== bundle.historicalCutoffMs ||
    answer.historicalCutoffUsed.temporalBasis !== bundle.temporalBasis
  ) {
    temporalViolations.push(
      `Answer cutoff metadata (${answer.historicalCutoffUsed.asOfMs}/${answer.historicalCutoffUsed.temporalBasis}) does not match bundle (${bundle.historicalCutoffMs}/${bundle.temporalBasis}).`,
    );
  }

  const cutoffDateIso = bundle.historicalCutoffIso.slice(0, 10);
  for (const claim of answer.supportingClaims) {
    if (
      claim.periodOrAsOf &&
      /^\d{4}-\d{2}-\d{2}$/.test(claim.periodOrAsOf) &&
      claim.periodOrAsOf > cutoffDateIso
    ) {
      temporalViolations.push(
        `Claim '${claim.claimId}' references post-cutoff date ${claim.periodOrAsOf} (cutoff ${cutoffDateIso}).`,
      );
    }
  }

  // 7. Generalised Numerical & Relationship-Grounded Verification
  const allowedNumbers = collectAllowedNumbers(bundle);
  const relById = new Map(bundle.relationships.map((r) => [r.relationshipId, r]));
  const claimById = new Map(bundle.quantitativeClaims.map((c) => [c.claimId, c]));
  const scenarioById = new Map(bundle.scenarios.map((s) => [s.scenarioId, s]));
  const sourceById = new Map(bundle.sources.map((s) => [s.docId, s]));

  for (const claim of answer.supportingClaims) {
    if (claim.quantitativeValue !== null) {
      if (!isNumberAllowed(claim.quantitativeValue, allowedNumbers)) {
        unverifiedNumbers.push(`${claim.claimId}:${claim.quantitativeValue}`);
        if (bundle.excludedByHistoricalCutoffCount > 0) {
          temporalViolations.push(
            `Hindsight or ungrounded figure (${claim.quantitativeValue}) in claim '${claim.claimId}' not present in cutoff-filtered bundle (${cutoffDateIso}).`,
          );
        }
        continue;
      }

      // Source-grounded relationship/claim consistency: if the claim is not a cross-relationship
      // deterministic arithmetic total, verify that its quantitativeValue is grounded in the
      // specific relationships, claims, scenarios, or source excerpts cited by this claim.
      if (
        claim.distinction !== 'deterministic_arithmetic' &&
        (claim.relationshipIds.length > 0 || claim.evidenceIds.length > 0)
      ) {
        const citedNumbers = new Set<number>();
        const addScopedNum = (n: number | null | undefined) => {
          if (n === null || n === undefined || !Number.isFinite(n)) return;
          citedNumbers.add(Number(n));
          citedNumbers.add(Math.abs(Number(n)));
          if (Math.abs(n) >= 1_000_000_000) {
            citedNumbers.add(Number((n / 1_000_000_000).toFixed(2)));
            citedNumbers.add(Number((n / 1_000_000_000).toFixed(1)));
          }
          if (Math.abs(n) >= 1_000_000) {
            citedNumbers.add(Number((n / 1_000_000).toFixed(2)));
            citedNumbers.add(Number((n / 1_000_000).toFixed(0)));
          }
        };
        const citedTexts: string[] = [];
        for (const rId of claim.relationshipIds) {
          const r = relById.get(rId);
          if (r) {
            addScopedNum(r.principalAmount);
            addScopedNum(r.capacityMw);
            citedTexts.push(r.summary);
          }
        }
        for (const evId of claim.evidenceIds) {
          const qc = claimById.get(evId);
          if (qc) {
            addScopedNum(qc.quantitativeValue);
            citedTexts.push(`${qc.title} ${qc.assumptionsAndBasis}`);
          }
          const sc = scenarioById.get(evId);
          if (sc) {
            addScopedNum(sc.usEquityShockPct);
            addScopedNum(sc.irishMddImpactPct);
            addScopedNum(sc.irishInvestmentImpactPct);
            addScopedNum(sc.irishExportsImpactPct);
            addScopedNum(sc.irishEmploymentGrowthDeltaPp);
            citedTexts.push(sc.fiscalAndTaxChannelSummary);
          }
          const src = sourceById.get(evId);
          if (src) {
            citedTexts.push(`${src.title} ${src.excerpt}`);
            // Unless the claim targets a single specific child sub-commitment with its own amount,
            // include relationships backed by this cited sourceDocId
            const singleRel =
              claim.relationshipIds.length === 1
                ? relById.get(claim.relationshipIds[0]!)
                : null;
            const isSingleChildWithOwnAmount = Boolean(
              singleRel &&
                (singleRel.principalAmount !== null || singleRel.capacityMw !== null) &&
                singleRel.parentCommitmentEnvelopeId !== null,
            );
            if (!isSingleChildWithOwnAmount) {
              for (const bRel of bundle.relationships) {
                if (bRel.sourceDocIds.includes(evId)) {
                  addScopedNum(bRel.principalAmount);
                  addScopedNum(bRel.capacityMw);
                  citedTexts.push(bRel.summary);
                }
              }
            }
            for (const bClaim of bundle.quantitativeClaims) {
              if (bClaim.sourceDocIds.includes(evId)) {
                addScopedNum(bClaim.quantitativeValue);
                citedTexts.push(`${bClaim.title} ${bClaim.assumptionsAndBasis}`);
              }
            }
            for (const bScen of bundle.scenarios) {
              if (bScen.sourceDocIds.includes(evId)) {
                addScopedNum(bScen.usEquityShockPct);
                addScopedNum(bScen.irishMddImpactPct);
                addScopedNum(bScen.irishInvestmentImpactPct);
                addScopedNum(bScen.irishExportsImpactPct);
                addScopedNum(bScen.irishEmploymentGrowthDeltaPp);
              }
            }
          }
        }
        for (const m of citedTexts.join(' ').matchAll(/-?\d+(?:\.\d+)?/g)) {
          const parsedNum = Number(m[0]);
          if (Number.isFinite(parsedNum)) addScopedNum(parsedNum);
        }
        if (citedNumbers.size > 0 && !isNumberAllowed(claim.quantitativeValue, citedNumbers)) {
          unverifiedNumbers.push(
            `claim_relationship_mismatch:${claim.claimId}=${claim.quantitativeValue}`,
          );
        }
      }
    }

    // Contractual classification consistency check: a claim citing ONLY cancelled/terminated
    // relationships cannot present them as an active signed obligation without noting cancellation.
    if (claim.relationshipIds.length > 0 && claim.distinction === 'source_fact') {
      const citedRels = claim.relationshipIds
        .map((id) => relById.get(id))
        .filter((r): r is NonNullable<typeof r> => Boolean(r));
      const allCancelled =
        citedRels.length > 0 &&
        citedRels.every(
          (r) => r.contractualStatus === 'cancelled' || r.contractualStatus === 'expired',
        );
      if (
        allCancelled &&
        /\b(active\s+signed|currently\s+active\s+binding)\b/i.test(claim.statement) &&
        !/\b(cancel|terminat|supersed|pull\s+out)\b/i.test(claim.statement)
      ) {
        unverifiedNumbers.push(
          `contractual_status_violation:${claim.claimId} presents cancelled relationship as active`,
        );
      }
    }
  }

  // Check explicit currency/MW/percent figures in shortAnswer & executiveTldr
  const narrativeText = [answer.shortAnswer, ...answer.executiveTldr].join(' ');
  const explicitQuantMatches = narrativeText.matchAll(
    /(?:\$|USD\s*)(\d+(?:\.\d+)?)\s*(?:B|M|billion|million)?|(\d+(?:\.\d+)?)\s*(?:MW|%|percentage\s+points|pp)\b/gi,
  );
  for (const m of explicitQuantMatches) {
    const rawNum = Number(m[1] ?? m[2]);
    if (Number.isFinite(rawNum) && !isNumberAllowed(rawNum, allowedNumbers)) {
      unverifiedNumbers.push(`narrative:${m[0]}`);
      if (bundle.excludedByHistoricalCutoffCount > 0) {
        temporalViolations.push(
          `Hindsight or ungrounded figure (${m[0]}) in narrative not present in cutoff-filtered bundle (${cutoffDateIso}).`,
        );
      }
    }
  }

  // If historical cutoff withheld relationships and the model claims `fully_supported` while citing post-cutoff filing titles
  if (
    bundle.excludedByHistoricalCutoffCount > 0 &&
    answer.supportStatus !== 'unsupported' &&
    !bundle.sources.some((s) => /\bs-1\/a\b/i.test(s.title)) &&
    /\bs-1\/a\b/i.test(narrativeText)
  ) {
    temporalViolations.push(
      `Hindsight leakage detected: post-cutoff filing reference (S-1/A) appeared in a supported answer restricted to cutoff ${cutoffDateIso}.`,
    );
  }

  // 8. Generalised Deterministic Arithmetic Check (prevent any naive parent+child double-counted sum presented as deduplicated total)
  const naiveSumB = Number(
    (bundle.commitmentLedger.naiveComputeCommitmentsSumUsd / 1_000_000_000).toFixed(1),
  );
  const dedupSumB = Number(
    (bundle.commitmentLedger.deduplicatedComputeCommitmentsUsd / 1_000_000_000).toFixed(1),
  );
  let arithmeticValid = true;
  if (
    naiveSumB > dedupSumB &&
    narrativeText.includes(`${naiveSumB}`) &&
    !narrativeText.toLowerCase().includes('double') &&
    !narrativeText.toLowerCase().includes('naive') &&
    !narrativeText.toLowerCase().includes('prevented') &&
    !narrativeText.toLowerCase().includes('sub-commitment') &&
    !narrativeText.toLowerCase().includes('sub-allocation')
  ) {
    arithmeticValid = false;
    unverifiedNumbers.push(
      `double_counted_compute_sum:$${naiveSumB}B cited without deduplication disclosure ($${dedupSumB}B deduplicated)`,
    );
  }

  const checks: AnswerValidationReport['checks'] = [
    {
      checkId: 'schema_valid',
      passed: true,
      detail: 'Answer conforms to evidence-locked-answer-g4-v1 schema.',
    },
    {
      checkId: 'bundle_hash_bound',
      passed: bundleBound,
      detail: bundleBound
        ? `Bound to bundle ${bundle.bundleId} (${bundle.bundleSha256.slice(0, 12)}…).`
        : 'Bundle ID or SHA-256 mismatch.',
    },
    {
      checkId: 'evidence_ids_in_bundle',
      passed: invalidEvidenceIds.length === 0,
      detail:
        invalidEvidenceIds.length === 0
          ? `All cited evidence IDs verified against bundle (${validEvidenceIds.size} available).`
          : `Unauthorised evidence IDs cited: ${invalidEvidenceIds.join(', ')}.`,
    },
    {
      checkId: 'relationship_ids_in_bundle',
      passed: invalidRelationshipIds.length === 0,
      detail:
        invalidRelationshipIds.length === 0
          ? `All referenced relationship IDs verified against bundle (${validRelIds.size} available).`
          : `Unauthorised relationship IDs referenced: ${invalidRelationshipIds.join(', ')}.`,
    },
    {
      checkId: 'historical_cutoff_respected',
      passed: temporalViolations.length === 0,
      detail:
        temporalViolations.length === 0
          ? `Historical cutoff ${bundle.historicalCutoffIso.slice(0, 10)} (${bundle.temporalBasis} clock) respected with zero hindsight leakage.`
          : temporalViolations.join(' '),
    },
    {
      checkId: 'numerical_claims_verified',
      passed: unverifiedNumbers.length === 0,
      detail:
        unverifiedNumbers.length === 0
          ? 'All quantitative values in claims and narrative verified against source records.'
          : `Unverified numerical values detected: ${unverifiedNumbers.join(', ')}.`,
    },
    {
      checkId: 'deterministic_arithmetic_verified',
      passed: arithmeticValid,
      detail: arithmeticValid
        ? `Commitment ledger deduplication verified (deduplicated compute=$${dedupSumB}B).`
        : 'Naive sum cited without parent-envelope deduplication.',
    },
    {
      checkId: 'no_private_or_broker_leakage',
      passed: securityViolations.length === 0,
      detail:
        securityViolations.length === 0
          ? 'Zero broker credentials, account balances, or cross-tenant references present.'
          : securityViolations.join(' '),
    },
    {
      checkId: 'no_prompt_injection_override',
      passed: securityViolations.length === 0,
      detail:
        securityViolations.length === 0
          ? 'Untrusted source excerpts remained strictly data-scoped.'
          : securityViolations.join(' '),
    },
  ];

  const allPassed = checks.every((c) => c.passed);
  if (!allPassed) {
    const failedReasons = checks
      .filter((c) => !c.passed)
      .map((c) => `${c.checkId}: ${c.detail}`)
      .join('; ');
    const actionTaken =
      securityViolations.length > 0 ? 'rejected_security_violation' : 'downgraded_to_abstention';
    const abstention = buildEvidenceLimitedAbstentionAnswer(
      bundle,
      `Independent answer validator rejected model output (${failedReasons}).`,
    );
    return {
      validatedAnswer: abstention,
      report: answerValidationReportSchema.parse({
        valid: false,
        actionTaken,
        checks,
        invalidEvidenceIds,
        invalidRelationshipIds,
        unverifiedNumbers,
        temporalViolations,
        securityViolations,
        validatedAtMs: nowMs,
      }),
    };
  }

  return {
    validatedAnswer: answer,
    report: answerValidationReportSchema.parse({
      valid: true,
      actionTaken: 'accepted',
      checks,
      invalidEvidenceIds: [],
      invalidRelationshipIds: [],
      unverifiedNumbers: [],
      temporalViolations: [],
      securityViolations: [],
      validatedAtMs: nowMs,
    }),
  };
}
