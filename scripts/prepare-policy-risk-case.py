"""Build Benchmark 001.2 (US Midterm Infrastructure Risk) source package v1.

Every policy event, project and exposure link below is a curated research assertion tied to the
sources retrieved on 5 November 2026. Values not stated by a source stay null. Market closes come
from the raw Nasdaq responses in tmp/policy-risk/nasdaq; nothing is interpolated or adjusted.
The package is retrospective: it was assembled after the 3 November 2026 election.
"""
import datetime as dt
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'data' / 'policy-risk'
RAW = ROOT / 'tmp' / 'policy-risk' / 'nasdaq'
VERSION = 'policy-risk-001.2-v1'
MODE = 'retrospective'


def ms(value):
    return int(dt.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() * 1000)


def iso(value):
    return dt.datetime.fromtimestamp(value / 1000, dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def close_at(day):
    if day in ('2026-11-27', '2026-12-24'):
        return ms(f'{day}T18:00:00Z')
    est = '2026-11-01' <= day < '2027-03-14'
    return ms(f'{day}T{21 if est else 20}:00:00Z')


def sessions():
    holidays = {'2026-09-07', '2026-11-26', '2026-12-25', '2027-01-01', '2027-01-18', '2027-02-15'}
    out, day = [], dt.date(2026, 9, 1)
    while day <= dt.date(2027, 3, 31):
        if day.weekday() < 5 and day.isoformat() not in holidays:
            out.append(close_at(day.isoformat()))
        day += dt.timedelta(days=1)
    return out


def main():
    out = DEST / 'midterm-2026-11-03.json'
    if out.exists() and '--force-rebuild-from-same-capture' not in sys.argv:
        raise SystemExit('Package v1 exists; a new capture needs a new version, not overwritten receipt times.')
    now = int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000)
    # Curated records were read between 14:30 and 14:55 UTC on 5 November; the build time is a conservative receipt bound.
    received = now

    def src(id, title, url, kind, authority, published=None, date=None):
        basis = 'exact' if published else 'date_upper_bound' if date else 'retrieval_upper_bound'
        return dict(id=id, title=title, url=url, kind=kind, authority=authority, publishedAt=ms(published) if published else None, publicationDate=date, publicationBasis=basis, receivedAt=received, role='evidence', usage='public_reference', mode=MODE)

    sources = [
        src('ny-eo62', 'New York Executive Order No. 62: temporary moratorium on data centers while the State develops a GEIS', 'https://www.governor.ny.gov/executive-order/no-62-establishing-temporary-moratorium-data-centers-new-york-while-state-develops', 'official_government', 'primary', date='2026-07-14'),
        src('ny-s10642', 'NY Senate bill S10642 (substituted by A11560): Responsible Data Center Development Act', 'https://www.nysenate.gov/legislation/bills/2025/S10642', 'legislature', 'primary'),
        src('hselaw-eo62', 'Harter Secrest & Emery: data center development in New York faces immediate pause under EO 62', 'https://hselaw.com/news-and-information/legalcurrents/data-center-development-in-new-york-faces-immediate-pause-under-executive-order-62/', 'law_firm', 'secondary', date='2026-07-17'),
        src('theblock-wulf-eo62', 'The Block: TeraWulf falls 7% after New York orders pause on new data center permits', 'https://www.theblock.co/amp/post/408344/new-york-pause-new-data-center-permits-terawulf-falls', 'news', 'secondary', published='2026-07-15T05:10:00Z'),
        src('wyso-wilmington-court', 'WYSO: Federal judge says Wilmington has to redo key steps to consider Amazon data center proposal', 'https://www.wyso.org/news/2026-07-24/federal-judge-wilmington-has-to-redo-key-steps-to-consider-amazon-data-center-proposal', 'news', 'secondary', published='2026-07-24T20:14:00Z'),
        src('fox19-wilmington-emergency', 'FOX19: Tri-State resident sues to block emergency rezoning for data center', 'https://www.fox19.com/2026/09/04/tri-state-resident-sues-block-emergency-rezoning-data-center/', 'news', 'secondary', published='2026-09-04T11:25:00Z'),
        src('wyso-sw-ohio-results', 'WYSO: Across Southwest Ohio, voters pushed back against data centers', 'https://www.wyso.org/government-politics-news/2026-11-04/across-southwest-ohio-voters-pushed-back-against-data-centers-and-politicians-who-support-them', 'news', 'secondary', published='2026-11-05T03:38:00Z'),
        src('gridsight-votes', 'The Grid Sight: data center vote results 2026 (unofficial returns as of 4 November, 4 p.m. Central)', 'https://thegridsight.com/data-center-votes-2026', 'tracker', 'secondary', date='2026-11-04'),
        src('time-midterms', 'TIME: How AI backlash shaped the 2026 midterms', 'https://time.com/article/2026/11/04/midterm-elections-results-ai-industry-data-centers/', 'news', 'secondary', published='2026-11-04T13:15:17Z'),
        src('okhouse-hb2992', 'Oklahoma House: Governor signs HB 2992 protecting consumers from data-center utility costs', 'https://www.okhouse.gov/posts/News-20260513_1', 'legislature', 'primary', date='2026-05-13'),
        src('azcapitol-tpt-pause', 'Arizona Capitol Times: data centers dominated 2026 session; three-year tax incentive pause', 'https://azcapitoltimes.com/news/2026/07/09/data-centers-dominated-2026-session-lawmakers-answered-with-3-year-tax-incentive-pause/', 'news', 'secondary', date='2026-07-09'),
        src('apld-8k-2026-07-27', 'Applied Digital Form 8-K, fiscal Q4 2026 earnings release (filed 27 July 2026)', 'https://www.sec.gov/Archives/edgar/data/0001144879/000114487926000044/apldq426earningsreleaseasf.htm', 'company_filing', 'primary', date='2026-07-27'),
        src('apld-8k-2026-10-07', 'Applied Digital Form 8-K, fiscal Q1 2027 earnings release (filed 7 October 2026)', 'https://www.sec.gov/Archives/edgar/data/1144879/000114487926000057/apldq127earningsrelease.htm', 'company_filing', 'primary', date='2026-10-07'),
        src('spectrum-janesville', 'Spectrum News: Janesville referendum on voter approval for GM/JATCO site development', 'https://spectrumnews1.com/wi/madison/news/2026/10/06/janesville-referendum-gm-jatco-development-voter-approval', 'news', 'secondary', published='2026-10-06T16:13:00Z'),
        src('nyse-calendar', 'NYSE holidays and trading hours', 'https://www.nyse.com/markets/hours-calendars', 'calendar', 'primary'),
    ]

    def event(id, title, level, state, locality, name, instrument, status, binding, direction, mechanisms, event_date, effective, expires, expiry_condition, threshold, applies, exemptions, outcome, uncertainty, notes, conflicting, source_ids):
        return dict(id=id, revision=1, supersedes=None, title=title, jurisdiction=dict(level=level, state=state, locality=locality, name=name), instrument=instrument, legalStatus=status, binding=binding, direction=direction, mechanisms=mechanisms, eventDate=event_date, effectiveDate=effective, expiresDate=expires, expiryCondition=expiry_condition, scope=dict(thresholdMw=threshold, appliesTo=applies, exemptions=exemptions), outcome=outcome, uncertainty=uncertainty, uncertaintyNotes=notes, conflictingSources=conflicting, sourceIds=source_ids, receivedAt=received, mode=MODE)

    events = [
        event('us-midterm-2026-11-03', 'US midterm general election, 3 November 2026', 'federal', 'DC', None, 'United States', 'election', 'candidate_elected', None, 'neutral', ['election'], '2026-11-03', None, None, None, None, 'Federal, state and local offices and ballot measures', None, 'Results partly preliminary at capture. TIME reports Democrats won control of Congress; an NBC exit poll found 56% of voters called AI and data centers a crucial or major factor.', 'medium', ['Many contests were uncalled at capture', 'An election outcome enacts no data-center rule'], False, ['time-midterms']),
        event('oh-senate-2026', 'Ohio US Senate: Sherrod Brown reported winner over Jon Husted', 'state', 'OH', None, 'Ohio', 'election', 'candidate_elected', None, 'neutral', ['election'], '2026-11-03', None, None, None, None, 'Federal legislative office', None, 'Brown reported to have won by about five points after ads calling Husted "the face of data centers in Ohio". Brown\'s own policy position is not stated in the source.', 'medium', ['Call status not stated by the source', 'A Senate seat confers no state or local permitting power'], False, ['time-midterms']),
        event('ks-governor-2026', 'Kansas governor: Cindy Holscher leading; campaign called for a data-center pause', 'state', 'KS', None, 'Kansas', 'campaign_statement', 'candidate_leading', None, 'neutral', ['election', 'moratorium'], '2026-11-03', None, None, None, None, 'Campaign pledge for a pause until guardrails are set', None, 'Preliminary: leading on 4 November morning.', 'high', ['Result preliminary', 'A campaign pledge is not a proposal, bill or rule'], False, ['time-midterms']),
        event('ny-eo62', 'New York Executive Order 62: DEC permit applications for ≥50 MW data centers held in abeyance', 'state', 'NY', None, 'New York State', 'executive_order', 'in_force', True, 'restrictive', ['moratorium', 'permitting', 'water', 'electricity', 'grid_connection'], '2026-07-14', '2026-07-14', None, 'Until DPS submits the final Generic Environmental Impact Statement and findings statement; no fixed end date', 50, 'DEC discretionary permits, approvals and licences to build or expand facilities consuming or able to consume ≥50 MW, for applications not deemed complete before the order', 'Local-government permits; facilities primarily used for manufacturing, research, education or medical care; applications deemed complete before the order', 'Executive action in force; DEC water-withdrawal review report due within twelve months.', 'medium', ['Termination depends on GEIS completion, not a date', 'Applicability to a specific project requires DEC completeness records, which were not retrieved', 'The order text states no separate effective date; the signing date is used'], False, ['ny-eo62', 'hselaw-eo62']),
        event('ny-s10642', 'New York Responsible Data Center Development Act (S10642 / A11560): passed legislature, not shown as signed', 'state', 'NY', None, 'New York State', 'bill', 'passed_legislature', None, 'restrictive', ['moratorium', 'permitting'], '2026-06-04', None, None, 'One year after the effective date, if enacted', 20, 'DEC permits, certificates, registrations or licences for large data centers (peak demand ≥20 MW)', 'Modifications or renewals of existing approvals; facilities that began construction on or before the effective date', 'Senate passed A11560 on 4 June 2026 (43–17). The bill page shows no delivery, signature, veto or chapter number at capture.', 'high', ['Secondary coverage reports conflicting status, including one claim of signature that the legislative record does not show', 'Not enacted: the governor acted through EO 62 instead'], True, ['ny-s10642']),
        event('ok-hb2992', 'Oklahoma HB 2992, Data Center Consumer Ratepayer Protection Act of 2026', 'state', 'OK', None, 'Oklahoma', 'bill', 'enacted', True, 'cost_allocation', ['power_cost_allocation', 'electricity', 'community_consultation'], '2026-05-13', '2026-07-01', None, None, 75, 'New large-load users of ≥75 MW (data centers, AI computing, cryptocurrency mining) bear their own energy-infrastructure costs; developers notify nearby landowners, county commissioners and the Corporation Commission within 60 days of acquiring land', None, 'Signed by Governor Stitt (date not stated in the official release); effective 1 July 2026.', 'medium', ['Enrolled bill text and exact signing date not retrieved', 'Cost-allocation detail depends on Corporation Commission implementation'], False, ['okhouse-hb2992']),
        event('az-tpt-pause', 'Arizona budget: three-year pause on new data-center transaction-privilege tax exemption applications', 'state', 'AZ', None, 'Arizona', 'tax_measure', 'enacted', True, 'restrictive', ['tax_incentive'], '2026-06-30', '2026-07-01', None, 'Reported to run through 2029 unless incentives are eliminated', None, 'New applications to the Arizona Commerce Authority for data-center TPT and use-tax exemptions', 'Applications filed before the end of June 2026 (treatment of existing certifications not stated)', 'Applications closed at the end of June 2026; many operators filed before the deadline.', 'high', ['Bill number, signing date and exact end date not identified', 'Only secondary reporting retrieved'], False, ['azcapitol-tpt-pause']),
        event('wilmington-federal-order', 'US District Court (S.D. Ohio): Wilmington must redo three ordinances before deciding the Amazon site plan', 'municipal', 'OH', 'Wilmington', 'City of Wilmington, Clinton County', 'court_order', 'court_order', True, 'restrictive', ['litigation', 'zoning', 'community_consultation'], '2026-07-14', '2026-07-14', None, 'Until the generator-noise, rezoning and permitted-use ordinances are redone with required notice', None, 'Decision on the Amazon data center site plan; public comment at planning commission', None, 'The city cannot decide the site plan until it redoes the ordinances; the case continues in federal court.', 'medium', ['Whether the September re-enactment satisfied the order is not established by the retrieved sources', 'Court order not retrieved directly; reported by WYSO'], False, ['wyso-wilmington-court']),
        event('wilmington-emergency-rezoning', 'Wilmington emergency rezoning of the 471-acre Cosler Farm parcel to light industrial', 'municipal', 'OH', 'Wilmington', 'City of Wilmington, Clinton County', 'ordinance', 'enacted_challenged', True, 'permissive', ['zoning', 'litigation'], '2026-09-03', '2026-09-03', None, None, None, 'Permits data center construction in a light-industrial zone on the parcel proposed for the Amazon campus', None, 'Emergency ordinances take effect immediately and cannot be referred; a resident sued in Clinton County Common Pleas Court. The city agreed not to act for one week pending a TRO hearing.', 'medium', ['Litigation outcome unknown at capture'], False, ['fox19-wilmington-emergency']),
        event('wilmington-referenda-2026-11-03', 'Wilmington referenda: four rezonings (≈545 acres near US 68 / SR 730) rejected', 'municipal', 'OH', 'Wilmington', 'City of Wilmington, Clinton County', 'referendum', 'rejected_unofficial', True, 'restrictive', ['zoning'], '2026-11-03', None, None, None, None, 'February 2026 rezonings of four parcels from rural residential to light industrial (65.29, 191.12, 119.373 and 170.11 acres)', None, 'Voters rejected the rezoning ordinances by about 80% to 20% (final unofficial).', 'medium', ['Unofficial results', 'Parcels are adjacent to, and "could be related" to, the Amazon campus; they are not the 471-acre Cosler parcel'], False, ['gridsight-votes', 'wyso-sw-ohio-results']),
        event('piqua-charter-2026-11-03', 'Piqua charter amendment banning data centers', 'municipal', 'OH', 'Piqua', 'City of Piqua, Miami County', 'ballot_initiative', 'approved_unofficial', True, 'restrictive', ['moratorium', 'zoning'], '2026-11-03', None, None, None, 25, 'WYSO: data centers above 25 MW of peak demand; tracker: ban on construction', None, 'Approved (tracker: 67% to 33%); final unofficial. City: "unclear at this time if and how" it affects the Meta project underway.', 'high', ['Sources differ on scope (25 MW threshold vs outright construction ban)', 'Unofficial results', 'Applicability to the existing Meta project undetermined by the city'], True, ['wyso-sw-ohio-results', 'gridsight-votes']),
        event('urbana-charter-2026-11-03', 'Urbana charter amendment banning large data centers', 'municipal', 'OH', 'Urbana', 'City of Urbana, Champaign County', 'ballot_initiative', 'approved_unofficial', True, 'restrictive', ['moratorium', 'zoning', 'litigation'], '2026-11-03', None, None, None, 7.5, 'WYSO: data centers above 7.5 MW of peak demand; tracker: ban within city limits', None, 'Approved (tracker: 77% to 23%); effect on Thor Equities\' proposed Urbana Technology Hub unclear given a state appeal and federal lawsuit.', 'high', ['Sources differ on scope', 'Unofficial results', 'Pending litigation'], True, ['wyso-sw-ohio-results', 'gridsight-votes']),
        event('janesville-referendum-2026-11-03', 'Janesville referendum: voter approval required for GM/JATCO site projects over $450 million', 'municipal', 'WI', 'Janesville', 'City of Janesville, Rock County', 'referendum', 'approved_unofficial', True, 'restrictive', ['community_consultation'], '2026-11-03', None, None, None, None, 'Development agreements, projects, sales or leases at the former GM/JATCO site above $450 million total cost', None, 'Approved 62% to 38% (unofficial tracker figures).', 'medium', ['Unofficial results', 'The question does not name data centers'], False, ['gridsight-votes', 'spectrum-janesville']),
        event('ashville-referendum-2026-11-03', 'Ashville referendum on term summary for village talks with EdgeConneX', 'municipal', 'OH', 'Ashville', 'Village of Ashville, Pickaway County', 'referendum', 'rejected_unofficial', True, 'restrictive', ['community_consultation'], '2026-11-03', None, None, None, None, 'Term summary for village negotiations on two EdgeConneX data centers', None, 'Defeated 18% to 82% (unofficial tracker figures).', 'high', ['Tracker-only source', 'Unofficial results', 'Legal effect on negotiations not stated'], False, ['gridsight-votes']),
        event('harwood-review-2026-11-03', 'Harwood initiative for added review before approving industrial development', 'municipal', 'ND', 'Harwood', 'City of Harwood, Cass County', 'ballot_initiative', 'rejected_unofficial', True, 'neutral', ['permitting', 'community_consultation'], '2026-11-03', None, None, None, None, 'Additional review before approving industrial development', None, 'Defeated (tracker: 25% yes / 75% no). Rejection adds no new review requirement.', 'medium', ['Unofficial results', 'Tracker-only source'], False, ['gridsight-votes']),
        event('wells-me-moratorium-2026-11-03', 'Wells, Maine: 180-day moratorium on data center development', 'municipal', 'ME', 'Wells', 'Town of Wells, York County', 'ballot_initiative', 'approved_unofficial', True, 'restrictive', ['moratorium'], '2026-11-03', None, None, '180 days', None, 'Data center development', None, 'Approved 82% to 18% (unofficial).', 'medium', ['Unofficial results', 'Tracker-only source'], False, ['gridsight-votes']),
        event('wiscasset-me-moratorium-2026-11-03', 'Wiscasset, Maine: six-month moratorium on new or expanded data center applications', 'municipal', 'ME', 'Wiscasset', 'Town of Wiscasset, Lincoln County', 'ballot_initiative', 'approved_unofficial', True, 'restrictive', ['moratorium', 'permitting'], '2026-11-03', None, None, 'Six months', None, 'New or expanded data center applications', None, 'Approved 66% to 34% (unofficial).', 'medium', ['Unofficial results', 'Tracker-only source'], False, ['gridsight-votes']),
        event('sunbury-oh-25mw-2026-11-03', 'Sunbury, Ohio: initiative banning data centers over 25 MW', 'municipal', 'OH', 'Sunbury', 'Village of Sunbury, Delaware County', 'ballot_initiative', 'approved_unofficial', True, 'restrictive', ['zoning'], '2026-11-03', None, None, None, 25, 'Data centers over 25 MW', None, 'Approved 79% to 21% (unofficial).', 'medium', ['Unofficial results', 'Tracker-only source'], False, ['gridsight-votes']),
        event('bloomington-il-advisory-2026-11-03', 'Bloomington, Illinois: advisory question on a moratorium on large-scale data centers', 'municipal', 'IL', 'Bloomington', 'City of Bloomington, McLean County', 'advisory_question', 'approved_unofficial', False, 'neutral', ['moratorium'], '2026-11-03', None, None, None, None, 'Advisory only', None, 'Approved 78% to 22%; not binding.', 'medium', ['Advisory; no legal effect', 'Unofficial results'], False, ['gridsight-votes']),
    ]

    def project(id, name, companies, state, locality, site, planned, energised, basis, stage, sources_, financing=(), customers=(), revisions=(), opening=None, notes=()):
        return dict(id=id, name=name, companies=companies, state=state, locality=locality, site=site, plannedMw=planned, energisedMw=energised, mwBasis=basis, securedGridMw=None, requestedGridMw=None, stage=stage, equipmentCommitments=[], financing=list(financing), customers=list(customers), expectedOpening=opening, timelineRevisions=list(revisions), notes=list(notes), sourceIds=sources_, receivedAt=received, mode=MODE)

    projects = [
        project('aws-wilmington', 'Amazon Web Services data center campus, Wilmington', [dict(name='Amazon', ticker='AMZN', role='owner')], 'OH', 'Wilmington, Clinton County', '471-acre Cosler Farm parcel along South U.S. 68', None, None, 'unknown', 'permitting_on_hold', ['wyso-wilmington-court', 'fox19-wilmington-emergency'],
                customers=[dict(name='Amazon Web Services', status='owner_operated', sourceIds=['wyso-wilmington-court'])],
                revisions=[dict(kind='hold', previous=None, revised=None, delayDays=None, announcedDate='2026-07-14', sourceIds=['wyso-wilmington-court'])],
                notes=['Reported investment $4 billion; about 1.9 million sq ft, multiple buildings and a substation', 'MW, grid allocation and opening date not stated in retrieved sources', 'A court-ordered hold on the site-plan decision is not a cancellation']),
        project('meta-piqua', 'Meta data center project, Piqua', [dict(name='Meta Platforms', ticker='META', role='owner')], 'OH', 'Piqua, Miami County', None, None, None, 'unknown', 'site_preparation', ['wyso-sw-ohio-results'],
                notes=['City describes the project as "currently underway"', 'Secondary coverage cites a large power demand; the figure was not verified from a retrieved source and is not used']),
        project('thor-urbana', 'Urbana Technology Hub (proposed)', [dict(name='Thor Equities', ticker=None, role='developer')], 'OH', 'Urbana, Champaign County', '460,000 sq ft proposed facility', None, None, 'unknown', 'proposed', ['wyso-sw-ohio-results'], notes=['Subject to a state appeal and a federal lawsuit']),
        project('viridian-janesville', 'Former GM/JATCO site data center proposal, Janesville', [dict(name='Viridian Partners', ticker=None, role='developer')], 'WI', 'Janesville, Rock County', 'Former GM/JATCO site (city-owned)', None, None, 'unknown', 'not_proceeding', ['spectrum-janesville'], notes=['Proposal "did not move forward" before the referendum; recorded as not proceeding, not as a delay']),
        project('edgeconnex-ashville', 'EdgeConneX data centers (two), Ashville', [dict(name='EdgeConneX', ticker=None, role='developer')], 'OH', 'Ashville, Pickaway County', None, None, None, 'unknown', 'proposed', ['gridsight-votes'], notes=['Only tracker-level evidence']),
        project('apld-polaris-forge-1', 'Applied Digital Polaris Forge 1', [dict(name='Applied Digital', ticker='APLD', role='owner')], 'ND', 'Ellendale', None, 400, 250, 'critical_it', 'partially_energised', ['apld-8k-2026-10-07', 'apld-8k-2026-07-27'],
                financing=[dict(instrument='7.000% Senior Secured Notes due 2031 (APLD ComputeCo 3 LLC)', principalUsd=1.59e9, annualRate=0.07, maturity='2031', sourceIds=['apld-8k-2026-07-27', 'apld-8k-2026-10-07'])],
                customers=[dict(name='CoreWeave', status='contracted', sourceIds=['apld-8k-2026-10-07'])],
                opening='250 MW operational from 1 October 2026; third 150 MW building under construction with no disclosed ready-for-service date',
                notes=['Planned MW is the sum of disclosed building sizes (100 + 150 + 150)', 'No delay versus prior guidance stated']),
        project('apld-polaris-forge-2', 'Applied Digital Polaris Forge 2', [dict(name='Applied Digital', ticker='APLD', role='owner')], 'ND', 'Harwood, Cass County', None, 200, None, 'critical_it', 'under_construction', ['apld-8k-2026-07-27', 'apld-8k-2026-10-07'],
                financing=[dict(instrument='6.750% Senior Secured Notes due 2031 (APLD ComputeCo 2 LLC), issued at 98% of par', principalUsd=2.15e9, annualRate=0.0675, maturity='2031', sourceIds=['apld-8k-2026-07-27'])],
                customers=[dict(name='Investment-grade hyperscaler (unnamed)', status='contracted', sourceIds=['apld-8k-2026-10-07'])],
                opening='Initial operations expected to help bring North Dakota delivered critical IT to 300 MW by end of calendar 2026',
                notes=['Energised MW not disclosed; not assumed to be zero or operational']),
        project('wulf-lake-mariner', 'TeraWulf Lake Mariner campus', [dict(name='TeraWulf', ticker='WULF', role='owner')], 'NY', 'Lake Mariner, New York (locality not stated in retrieved source)', None, None, None, 'unknown', 'operational', ['theblock-wulf-eo62'],
                customers=[dict(name='Fluidstack', status='reported', sourceIds=['theblock-wulf-eo62']), dict(name='Google', status='reported', sourceIds=['theblock-wulf-eo62'])],
                notes=['Company: "Lake Mariner is already operational, and our expansion supporting Fluidstack and Google is fully permitted"', 'MW not stated in retrieved source']),
        project('wulf-lake-hawkeye', 'TeraWulf Lake Hawkeye (multi-year development)', [dict(name='TeraWulf', ticker='WULF', role='owner')], 'NY', 'New York (locality not stated in retrieved source)', None, None, None, 'unknown', 'permitting', ['theblock-wulf-eo62'],
                notes=['Company: EO 62 "does not change our current expectations"; local planning and review underway']),
    ]

    def link(project_id, event_id, relation, substantiation, note, source_ids):
        return dict(id=f'{project_id}--{event_id}', projectId=project_id, eventId=event_id, relation=relation, substantiation=substantiation, note=note, sourceIds=source_ids, receivedAt=received, mode=MODE)

    links = [
        link('aws-wilmington', 'wilmington-federal-order', 'direct', 'news_report', 'The order bars the city from deciding the Amazon site plan until three ordinances are redone', ['wyso-wilmington-court']),
        link('aws-wilmington', 'wilmington-emergency-rezoning', 'direct', 'news_report', 'Emergency rezoning of the Amazon parcel; challenged in state court', ['fox19-wilmington-emergency']),
        link('aws-wilmington', 'wilmington-referenda-2026-11-03', 'adjacent', 'news_report', 'Rejected rezonings cover adjacent parcels that "could be related"; the Cosler parcel itself was rezoned separately', ['wyso-sw-ohio-results', 'gridsight-votes']),
        link('meta-piqua', 'piqua-charter-2026-11-03', 'unclear_per_authority', 'official_statement', 'City spokesperson: unclear if and how the amendment affects the Meta project', ['wyso-sw-ohio-results']),
        link('thor-urbana', 'urbana-charter-2026-11-03', 'unclear_per_authority', 'news_report', 'Effect unclear given state appeal and federal lawsuit; city and developer did not respond', ['wyso-sw-ohio-results']),
        link('viridian-janesville', 'janesville-referendum-2026-11-03', 'direct', 'news_report', 'Referendum governs the same site; the proposal had already not moved forward', ['spectrum-janesville']),
        link('edgeconnex-ashville', 'ashville-referendum-2026-11-03', 'direct', 'tracker', 'Referendum on the term summary for talks about two EdgeConneX data centers', ['gridsight-votes']),
        link('apld-polaris-forge-2', 'harwood-review-2026-11-03', 'jurisdiction_only', 'tracker', 'Tracker notes Applied Digital is building nearby; the measure failed and adds no review', ['gridsight-votes']),
        link('wulf-lake-mariner', 'ny-eo62', 'company_states_unaffected', 'company_statement', 'Company states the expansion is fully permitted; not independently verified against DEC records', ['theblock-wulf-eo62']),
        link('wulf-lake-mariner', 'ny-s10642', 'jurisdiction_only', 'none', 'Bill not enacted; its construction-started exemption would need project records to assess', ['ny-s10642']),
        link('wulf-lake-hawkeye', 'ny-eo62', 'company_states_unaffected', 'company_statement', 'Company: no change to multi-year expectations; DEC application status unknown', ['theblock-wulf-eo62']),
    ]

    economic = [
        dict(id='apld-capex-q1fy27', ticker='APLD', metric='capex', value=2_074_698_000, unit='USD', period='Fiscal Q1 2027 purchases of property, equipment and other assets', periodEnd='2026-08-31', sourceIds=['apld-8k-2026-10-07'], receivedAt=received, mode=MODE),
        dict(id='apld-debt-q1fy27', ticker='APLD', metric='debt', value=6.4e9, unit='USD', period='As reported in fiscal Q1 2027 release (rounded)', periodEnd='2026-08-31', sourceIds=['apld-8k-2026-10-07'], receivedAt=received, mode=MODE),
        dict(id='apld-cash-q1fy27', ticker='APLD', metric='cash', value=3.7e9, unit='USD', period='Cash, equivalents and restricted cash (rounded)', periodEnd='2026-08-31', sourceIds=['apld-8k-2026-10-07'], receivedAt=received, mode=MODE),
    ]

    groups = [
        dict(id='developers', name='Listed AI-infrastructure developers', role='ai_infrastructure_developers', members=['APLD', 'WULF', 'CRWV', 'IREN', 'CIFR'], membershipRule='US-listed developers/operators of AI data-center capacity; membership fixed before outcomes; per-member policy exposure is recorded separately'),
        dict(id='hyperscalers', name='Established hyperscalers', role='hyperscalers', members=['AMZN', 'MSFT', 'GOOGL', 'META', 'ORCL'], membershipRule='Large cloud platforms with AI data-center capex'),
        dict(id='chips', name='Chip suppliers', role='chip_suppliers', members=['NVDA', 'AMD', 'AVGO'], membershipRule='AI accelerator and networking chip designers'),
        dict(id='bench-vt', name='Vanguard Total World Stock ETF', role='diversified_benchmarks', members=['VT'], membershipRule='Primary diversified benchmark'),
        dict(id='bench-spy', name='SPDR S&P 500 ETF', role='diversified_benchmarks', members=['SPY'], membershipRule='US large-cap benchmark'),
        dict(id='bench-qqq', name='Invesco QQQ Trust', role='diversified_benchmarks', members=['QQQ'], membershipRule='Nasdaq-100 benchmark'),
    ]
    hypotheses = [
        dict(id='H1', statement='Listed AI-infrastructure developers underperform VT after the election (relative return below 0).', kind='relative_below', subjectGroupId='developers', comparisonGroupId='bench-vt', threshold=0, horizons=[1, 5, 20, 60], evidenceIds=['gridsight-votes', 'wyso-sw-ohio-results', 'ny-eo62']),
        dict(id='H2', statement='Established hyperscalers outperform listed developers relative to VT (spread above 0).', kind='spread_above', subjectGroupId='hyperscalers', comparisonGroupId='developers', threshold=0, horizons=[1, 5, 20, 60], evidenceIds=['gridsight-votes']),
        dict(id='H3', statement='Chip suppliers are not materially hurt: relative return versus VT stays above −5%.', kind='spread_above', subjectGroupId='chips', comparisonGroupId='bench-vt', threshold=-0.05, horizons=[5, 20, 60], evidenceIds=[]),
    ]

    prices, tickers = [], sorted({m for g in groups for m in g['members']})
    for t in tickers:
        path = RAW / f'{t.lower()}.json'
        rcv = (int(path.stat().st_mtime) + 1) * 1000
        sid = f'nasdaq-{t.lower()}'
        sources.append(dict(id=sid, title=f'Nasdaq public historical Close/Last table: {t}', url=f'https://api.nasdaq.com/api/quote/{t}/historical?fromdate=2026-09-01&todate=2026-11-05&limit=200', kind='market_data', authority='primary', publishedAt=None, publicationDate=None, publicationBasis='retrieval_upper_bound', receivedAt=rcv, role='evidence', usage='public_reference', mode=MODE))
        for row in json.loads(path.read_text(encoding='utf-8'))['data']['tradesTable']['rows']:
            m, d, y = row['date'].split('/')
            day = f'{y}-{m}-{d}'
            prices.append(dict(id=f'{sid}-{day}', ticker=t, eventAt=close_at(day), close=float(row['close'].replace('$', '').replace(',', '')), currency='USD', priceBasis='unadjusted_close', provider='Nasdaq public historical table', sourceIds=[sid], publishedAt=None, receivedAt=rcv, mode=MODE))
    cal = sessions()
    returned = sorted({p['eventAt'] for p in prices})
    expected = [t for t in cal if t <= close_at('2026-11-04')]
    if returned != expected:
        raise SystemExit('Returned sessions differ from the calendar')

    case = dict(version=VERSION, id='policy-risk-001.2-midterm-2026-11-03', name='Benchmark 001.2 · US Midterm Infrastructure Risk · 3 November 2026', mode=MODE, anchorAt=close_at('2026-11-03'), anchorEventId='us-midterm-2026-11-03',
                sources=sources, events=events, projects=projects, links=links, economicObservations=economic, groups=groups, benchmarkTicker='VT',
                calendar=dict(id='nyse-regular-2026-09-to-2027-03', sourceIds=['nyse-calendar'], sessionCloses=cal, receivedAt=received),
                prices=prices, hypotheses=hypotheses,
                aggregateContext=[dict(id='local-measure-count', statement='Tracker reports 41 local data-center measures in 10 states on 3 November (21 in Ohio), 39 with unofficial results by 4 November; only a subset is registered individually here.', sourceIds=['gridsight-votes']),
                                  dict(id='exit-poll', statement='NBC exit poll: 56% of voters called AI and data centers a crucial or major factor in their congressional vote (as reported by TIME).', sourceIds=['time-midterms'])])
    DEST.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(case, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    request = dict(case=case, cutoff=now, registeredAt=now, asOf=now)
    (DEST / 'midterm-2026-11-03-request.json').write_text(json.dumps(request, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'{len(events)} events, {len(projects)} projects, {len(links)} links, {len(prices)} closes for {len(tickers)} tickers. Receipt bound {iso(received)}.')


if __name__ == '__main__':
    main()
