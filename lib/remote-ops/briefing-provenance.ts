import type {MorningBriefingRecord} from './contracts';

export type BriefingSource = 'fixture' | 'owner_latest' | 'stored_latest' | 'bundled_reference' | 'none';

/**
 * Sprint G9.2: decides which morning briefing the command centre shows and says where it came from.
 *
 * - `owner_latest`: the authorised research owner's latest stored briefing from the private `operations:overview`.
 * - `stored_latest`: a stored briefing supplied server-side (never happens for anonymous viewers today).
 * - `bundled_reference`: the static briefing generated at build time from bundled 2026-11-05 evidence. It is a historical
 *   fallback, must be labelled as such, and never feeds the executive synthesis or its "last refreshed" time.
 * - `fixture`: the synthetic demonstration mode.
 */
export function resolveDisplayedBriefing(input: {
  fixture: boolean;
  /** `undefined` while the private overview is loading or when signed out; `null` when it loaded without a briefing. */
  ownerOverviewLoaded: boolean;
  ownerHasActivity: boolean;
  ownerBriefing: MorningBriefingRecord | null | undefined;
  feedBriefing: MorningBriefingRecord | null | undefined;
  feedBriefingSource: 'bundled_reference' | 'stored_latest' | undefined;
}): {briefing: MorningBriefingRecord | null; source: BriefingSource; executiveBriefing: MorningBriefingRecord | null} {
  const briefing = input.ownerOverviewLoaded
    ? input.ownerHasActivity
      ? (input.ownerBriefing ?? null)
      : (input.ownerBriefing ?? input.feedBriefing ?? null)
    : (input.feedBriefing ?? null);
  const source: BriefingSource = input.fixture
    ? 'fixture'
    : !briefing
      ? 'none'
      : input.ownerBriefing && briefing === input.ownerBriefing
        ? 'owner_latest'
        : input.feedBriefingSource === 'stored_latest'
          ? 'stored_latest'
          : 'bundled_reference';
  return {briefing, source, executiveBriefing: source === 'bundled_reference' ? null : briefing};
}
