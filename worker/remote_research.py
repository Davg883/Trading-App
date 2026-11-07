"""Phase 003 Remote Research Operations worker: deterministic collectors, staging validator, news agent & briefing generator.

Preserves all research, broker, role, audit and execution safeguards:
- Untrusted webpages and retrieved articles are treated strictly as data, never instructions.
- AI agents cannot generate authoritative market prices or replace source-backed financial calculations.
- Remote agents never receive Trading 212 credentials, vault keys, Convex admin keys, Clerk sessions or trading permissions.
- Deterministic collectors continue unaffected when AI models fail or hit cost ceilings.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

REMOTE_OPS_VERSION = "remote-ops-003-v1"

APPROVED_RESEARCH_UNIVERSE = [
    {"ticker": "MSFT", "name": "Microsoft Corporation", "cik": "0000789019", "sector": "ai_hyperscaler", "irDomains": ["microsoft.com", "www.microsoft.com"]},
    {"ticker": "GOOGL", "name": "Alphabet Inc.", "cik": "0001652044", "sector": "ai_hyperscaler", "irDomains": ["abc.xyz", "www.abc.xyz"]},
    {"ticker": "AMZN", "name": "Amazon.com, Inc.", "cik": "0001018724", "sector": "ai_hyperscaler", "irDomains": ["ir.aboutamazon.com", "aboutamazon.com"]},
    {"ticker": "NVDA", "name": "NVIDIA Corporation", "cik": "0001045810", "sector": "ai_semiconductors", "irDomains": ["investor.nvidia.com", "nvidianews.nvidia.com"]},
    {"ticker": "CRWV", "name": "CoreWeave, Inc.", "cik": "0001769628", "sector": "ai_neocloud", "irDomains": ["investors.coreweave.com", "coreweave.com"]},
    {"ticker": "INTC", "name": "Intel Corporation", "cik": "0000050863", "sector": "ai_semiconductors", "irDomains": ["intc.com", "www.intc.com"]},
    {"ticker": "AMD", "name": "Advanced Micro Devices, Inc.", "cik": "0000002488", "sector": "ai_semiconductors", "irDomains": ["ir.amd.com", "amd.com"]},
    {"ticker": "AVGO", "name": "Broadcom Inc.", "cik": "0001730168", "sector": "ai_semiconductors", "irDomains": ["investors.broadcom.com"]},
    {"ticker": "META", "name": "Meta Platforms, Inc.", "cik": "0001326801", "sector": "ai_hyperscaler", "irDomains": ["investor.atmeta.com", "about.fb.com"]},
    {"ticker": "ORCL", "name": "Oracle Corporation", "cik": "0001341439", "sector": "ai_hyperscaler", "irDomains": ["investor.oracle.com"]},
    {"ticker": "QQQ", "name": "Invesco QQQ Trust", "cik": "0001067839", "sector": "benchmark", "irDomains": ["invesco.com", "www.invesco.com"]},
]

COVERED_TICKERS = {u["ticker"] for u in APPROVED_RESEARCH_UNIVERSE}

PRIMARY_AUTHORITATIVE_DOMAINS = {
    "sec.gov", "www.sec.gov", "data.sec.gov", "efts.sec.gov",
    "fred.stlouisfed.org", "api.stlouisfed.org",
    "bankofengland.co.uk", "www.bankofengland.co.uk",
    "ferc.gov", "www.ferc.gov", "energy.gov", "www.energy.gov",
    *(d for u in APPROVED_RESEARCH_UNIVERSE for d in u["irDomains"]),
}

FORBIDDEN_AI_PRICE_METRICS = {
    "price", "stock_price", "share_price", "close", "close_price",
    "last_price", "quote", "live_quote", "intraday_price", "vwap", "nav", "index_level",
}

FORBIDDEN_ENV_KEYS_FOR_AGENT = {
    "TRADING212_API_KEY", "TRADING212_API_SECRET", "BROKER_VAULT_KEY_B64",
    "CONVEX_BROKER_ADMIN_KEY", "CLERK_SECRET_KEY", "LIVE_TRADING_ENABLED", "DEMO_TRADING_ENABLED",
}

INJECTION_RULES = [
    ("instruction_override", re.compile(r"\b(ignore|disregard|override|bypass|forget)\s+(all\s+|prior\s+|previous\s+|system\s+|safety\s+)*(instructions|rules|constraints|guardrails|prompts|permissions|controls)\b", re.I)),
    ("system_prompt_spoof", re.compile(r"(\bsystem\s*prompt\b|\byou\s+are\s+now\b|\bact\s+as\s+(an?\s+)?(admin|reviewer|operator|broker|trader)\b|<\|im_start\|>|\[SYSTEM\]|###\s*Instruction)", re.I)),
    ("privilege_escalation", re.compile(r"\b(grantRoleInternal|assignReviewer|grant\s+reviewer|grant\s+administrator|actorType\s*[:=]\s*['\"]?human)\b", re.I)),
    ("trading_control_tamper", re.compile(r"\b(LIVE_TRADING_ENABLED|DEMO_TRADING_ENABLED|liveKillSwitchEngaged|release\s+(the\s+)?(emergency|kill)\s+switch|submit\s+live\s+order|place_order|equity/orders)\b", re.I)),
    ("credential_exfiltration", re.compile(r"\b(BROKER_VAULT_KEY|CONVEX_BROKER_ADMIN_KEY|CLERK_SECRET_KEY|TRADING212_API|decryptCredentials|getVaultInternal)\b", re.I)),
    ("script_injection", re.compile(r"(<\s*script\b|javascript\s*:|data\s*:\s*text/html|on(?:error|load|click)\s*=)", re.I)),
]

ENTITY_PATTERNS = [
    ("MSFT", [re.compile(r"\bMSFT\b", re.I), re.compile(r"\bMicrosoft\b", re.I), re.compile(r"\bAzure\b", re.I)]),
    ("GOOGL", [re.compile(r"\bGOOGL?\b", re.I), re.compile(r"\bAlphabet\b", re.I), re.compile(r"\bGoogle\s+Cloud\b", re.I)]),
    ("AMZN", [re.compile(r"\bAMZN\b", re.I), re.compile(r"\bAmazon\b", re.I), re.compile(r"\bAWS\b", re.I)]),
    ("NVDA", [re.compile(r"\bNVDA\b", re.I), re.compile(r"\bNVIDIA\b", re.I), re.compile(r"\bBlackwell\b", re.I)]),
    ("CRWV", [re.compile(r"\bCRWV\b", re.I), re.compile(r"\bCoreWeave\b", re.I)]),
    ("INTC", [re.compile(r"\bINTC\b", re.I), re.compile(r"\bIntel\b", re.I)]),
    ("AMD", [re.compile(r"\bAMD\b", re.I), re.compile(r"\bAdvanced\s+Micro\s+Devices\b", re.I)]),
    ("AVGO", [re.compile(r"\bAVGO\b", re.I), re.compile(r"\bBroadcom\b", re.I)]),
    ("META", [re.compile(r"\bMETA\b", re.I), re.compile(r"\bMeta\s+Platforms\b", re.I)]),
    ("ORCL", [re.compile(r"\bORCL\b", re.I), re.compile(r"\bOracle\b", re.I)]),
    ("QQQ", [re.compile(r"\bQQQ\b", re.I), re.compile(r"\bNasdaq-100\b", re.I)]),
]

DROP_QUERY_PARAMS = {"utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"}


class RejectRedirects(HTTPRedirectHandler):
    """Never follow redirects when sending staging tokens or fetching external feeds."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise HTTPError(req.full_url, code, "Redirects are disabled", headers, fp)


def assert_least_privilege_environment(env: dict[str, str]) -> None:
    """Refuse to run the remote research agent if forbidden broker/admin/trading secrets are injected."""
    leaked = sorted(k for k in FORBIDDEN_ENV_KEYS_FOR_AGENT if env.get(k))
    if leaked:
        raise PermissionError(f"Remote research agent refused forbidden environment credentials: {', '.join(leaked)}")


def canonicalize_source_url(raw_url: str) -> tuple[str, str]:
    parsed = urlparse(raw_url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise ValueError("An HTTPS URL without credentials or fragments is required")
    domain = parsed.hostname.lower()
    filtered_q = sorted((k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True) if k not in DROP_QUERY_PARAMS)
    clean_path = parsed.path.rstrip("/") or "/"
    canonical = urlunparse(("https", domain, clean_path, "", urlencode(filtered_q), ""))
    return canonical, domain


def is_authoritative_primary_domain(domain: str) -> bool:
    clean = domain.lower()
    if clean in PRIMARY_AUTHORITATIVE_DOMAINS:
        return True
    return any(clean.endswith(f".{d}") for d in PRIMARY_AUTHORITATIVE_DOMAINS)


def content_sha256(canonical_url: str, title: str, text: str) -> str:
    norm_title = re.sub(r"\s+", " ", title.strip())
    norm_text = re.sub(r"\s+", " ", text.strip())
    payload = f"{canonical_url}\n{norm_title}\n{norm_text}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def fact_dedupe_key(entity: str, metric: str, period: str, value: float, unit: str) -> str:
    return f"{entity.upper()}|{metric.strip().lower()}|{period.strip().upper()}|{float(value):.12g}|{unit.strip().lower()}"


def detect_prompt_injection(texts: list[str | None]) -> list[str]:
    codes: list[str] = []
    seen = set()
    for text in texts:
        if not text:
            continue
        for code, pattern in INJECTION_RULES:
            if code not in seen and pattern.search(text):
                seen.add(code)
                codes.append(code)
    return codes


def extract_universe_entities(title: str, text: str) -> list[str]:
    combined = f"{title}\n{text}"
    found = []
    for ticker, patterns in ENTITY_PATTERNS:
        if any(p.search(combined) for p in patterns):
            found.append(ticker)
    return found


def classify_claim_excerpt(excerpt: str, is_primary: bool) -> str:
    lower = excerpt.lower()
    if re.search(r"\b(propose[ds]?|bill|draft\s+order|would\s+require|campaign\s+pledge|planned\s+expansion|seeking\s+approval)\b", lower):
        return "proposed"
    if re.search(r"\b(estimate[ds]?|forecast[s]?|consensus|projected|guidance|analyst[s]?\s+expect|approximate(?:ly)?)\b", lower):
        return "estimated"
    if re.search(r"\b(unverified|rumou?r|unconfirmed|anonymous\s+sources|reportedly)\b", lower):
        return "unverified"
    if is_primary and re.search(r"\b(form\s+10-[kq]|form\s+8-k|xbrl|audited|recorded|actual|balance\s+sheet|cash\s+flows|capital\s+expenditure|capex|revenue|operating\s+income)\b", lower):
        return "observed"
    if is_primary or re.search(r"\b(reported|disclosed|announced|filed|stated)\b", lower):
        return "reported"
    return "unverified"


def infer_metric_name(excerpt: str) -> tuple[str, str, str]:
    lower = excerpt.lower()
    period_match = re.search(r"\b(Q[1-4]\s*202\d|FY\s*202\d|202[5-8])\b", excerpt, re.I)
    period = re.sub(r"\s+", "", period_match.group(1)).upper() if period_match else "2026"
    if re.search(r"\b(capex|capital\s+expenditure[s]?|property\s+and\s+equipment)\b", lower):
        return "capital_expenditures", "Capital expenditures / property and equipment additions", period
    if re.search(r"\b(free\s+cash\s+flow|fcf)\b", lower):
        return "free_cash_flow", "Operating cash flow less capital expenditures", period
    if re.search(r"\b(operating\s+cash\s+flow)\b", lower):
        return "operating_cash_flow", "Cash generated from operating activities", period
    if re.search(r"\b(backlog|remaining\s+performance\s+obligation[s]?|rpo)\b", lower):
        return "contracted_backlog", "Remaining performance obligations / contracted backlog", period
    if re.search(r"\b(megawatt[s]?|mw|gigawatt[s]?|gw|power\s+capacity)\b", lower):
        return "datacentre_power_capacity", "Disclosed AI datacentre power capacity", period
    if re.search(r"\b(revenue|sales)\b", lower):
        return "revenue", "Reported total or segment revenue", period
    return "financial_commitment", "Disclosed financial amount or infrastructure commitment", period


def extract_structured_claims(doc: dict, entities: list[str], is_primary: bool, primary_url: str | None) -> list[dict]:
    primary_entity = entities[0] if entities else "MSFT"
    pattern = re.compile(r"(?:\$\s*|£\s*)?([−-]?\d+(?:,\d{3})*(?:\.\d+)?)\s*(billion|million|bn|mw|gw|%)", re.I)
    text = doc["text"]
    claims = []
    for match in pattern.finditer(text):
        if len(claims) >= 25:
            break
        raw_num = float(match.group(1).replace(",", "").replace("−", "-"))
        start = match.start()
        excerpt = text[max(0, start - 80):min(len(text), match.end() + 80)].strip()
        unit_tok = match.group(2).lower()
        unit = (
            "percent" if unit_tok == "%" else
            "millions_usd" if unit_tok == "million" else
            "megawatts" if unit_tok == "mw" else
            "gigawatts" if unit_tok == "gw" else
            "billions_usd"
        )
        metric, definition, period = infer_metric_name(excerpt)
        classification = classify_claim_excerpt(excerpt, is_primary)
        claims.append({
            "id": f"claim-{start}",
            "entity": primary_entity,
            "metric": metric,
            "value": raw_num,
            "unit": unit,
            "period": period,
            "definition": definition,
            "excerpt": excerpt,
            "classification": classification,
            "isPrimarySource": is_primary,
            "primarySourceUrl": primary_url,
        })
    return claims


def validate_staged_item(
    item: dict,
    now_ms: int,
    seen_urls: set[str],
    seen_hashes: set[str],
    seen_fact_keys: set[str],
) -> dict:
    canonical_url, domain = canonicalize_source_url(item["sourceUrl"])
    digest = content_sha256(canonical_url, item["title"], item["text"])
    source_retrieved_at = int(item["receivedAt"])
    server_received_at = int(now_ms)
    imported_at = int(now_ms)
    published_at = int(item["publishedAt"]) if item.get("publishedAt") is not None else None
    untrusted_agent_metadata = {
        "agentReportedReceivedAt": source_retrieved_at,
        "agentReportedPublishedAt": published_at,
        "agentClockSkewMs": server_received_at - source_retrieved_at,
        "forwardEligibilityTrusted": False,
    }

    if source_retrieved_at > server_received_at:
        raise ValueError(f"Future receipt timestamp rejected ({source_retrieved_at} > {server_received_at})")
    if published_at is not None and published_at > source_retrieved_at:
        raise ValueError(f"Receipt precedes publication ({source_retrieved_at} < {published_at})")
    if published_at is not None and published_at > server_received_at:
        raise ValueError(f"Publication timestamp in the future of server receipt ({published_at} > {server_received_at})")

    texts_to_scan = [
        item.get("title"),
        item.get("text"),
        item.get("summary"),
        item.get("hypothesis"),
        *(field for c in item.get("claims", []) for field in (c.get("metric"), c.get("definition"), c.get("excerpt"))),
    ]
    injection_codes = detect_prompt_injection(texts_to_scan)
    if injection_codes:
        return {
            "externalId": item["externalId"],
            "canonicalUrl": canonical_url,
            "sourceDomain": domain,
            "title": item["title"].strip(),
            "contentSha256": digest,
            "publishedAt": published_at,
            "receivedAt": server_received_at,
            "serverReceivedAt": server_received_at,
            "sourceRetrievedAt": source_retrieved_at,
            "importedAt": imported_at,
            "untrustedAgentMetadata": untrusted_agent_metadata,
            "entities": [e for e in item.get("entities", []) if e in COVERED_TICKERS],
            "summary": "[Quarantined: untrusted source content contained instruction-override or restricted patterns]",
            "validationStatus": "quarantined_injection",
            "validationReasons": [f"prompt_injection:{c}" for c in injection_codes],
            "researchEligible": False,
            "marketOutcomeEligible": False,
            "executionAuthority": "none",
            "acceptedClaims": [],
            "promotableFacts": [],
            "duplicateFactCount": 0,
        }

    if canonical_url in seen_urls or digest in seen_hashes:
        return {
            "externalId": item["externalId"],
            "canonicalUrl": canonical_url,
            "sourceDomain": domain,
            "title": item["title"].strip(),
            "contentSha256": digest,
            "publishedAt": published_at,
            "receivedAt": server_received_at,
            "serverReceivedAt": server_received_at,
            "sourceRetrievedAt": source_retrieved_at,
            "importedAt": imported_at,
            "untrustedAgentMetadata": untrusted_agent_metadata,
            "entities": [e for e in item.get("entities", []) if e in COVERED_TICKERS],
            "summary": item["summary"].strip(),
            "validationStatus": "duplicate",
            "validationReasons": ["duplicate_article_or_content_hash"],
            "researchEligible": False,
            "marketOutcomeEligible": False,
            "executionAuthority": "none",
            "acceptedClaims": [],
            "promotableFacts": [],
            "duplicateFactCount": 0,
        }

    covered_entities = []
    for e in item.get("entities", []):
        up = str(e).upper()
        if up in COVERED_TICKERS and up not in covered_entities:
            covered_entities.append(up)

    if not covered_entities:
        return {
            "externalId": item["externalId"],
            "canonicalUrl": canonical_url,
            "sourceDomain": domain,
            "title": item["title"].strip(),
            "contentSha256": digest,
            "publishedAt": published_at,
            "receivedAt": server_received_at,
            "serverReceivedAt": server_received_at,
            "sourceRetrievedAt": source_retrieved_at,
            "importedAt": imported_at,
            "untrustedAgentMetadata": untrusted_agent_metadata,
            "entities": [],
            "summary": item["summary"].strip(),
            "validationStatus": "rejected",
            "validationReasons": ["outside_approved_universe"],
            "researchEligible": False,
            "marketOutcomeEligible": False,
            "executionAuthority": "none",
            "acceptedClaims": [],
            "promotableFacts": [],
            "duplicateFactCount": 0,
        }

    source_is_primary = is_authoritative_primary_domain(domain)
    primary_url = canonical_url if source_is_primary else None
    if not primary_url and item.get("primarySourceUrl"):
        cand_url, cand_domain = canonicalize_source_url(item["primarySourceUrl"])
        if is_authoritative_primary_domain(cand_domain):
            primary_url = cand_url

    accepted_claims = []
    promotable_facts = []
    reasons = []
    duplicate_facts = 0

    for claim in item.get("claims", []):
        norm_metric = re.sub(r"[\s-]+", "_", claim["metric"].strip().lower())
        if norm_metric in FORBIDDEN_AI_PRICE_METRICS:
            reasons.append(f"rejected_ai_price_claim:{claim['id']}")
            continue
        ticker = str(claim["entity"]).upper()
        if ticker not in COVERED_TICKERS:
            reasons.append(f"unapproved_entity:{ticker}")
            continue
        claim_primary_url = canonical_url if source_is_primary else None
        if not claim_primary_url and claim.get("primarySourceUrl"):
            c_url, c_dom = canonicalize_source_url(claim["primarySourceUrl"])
            if is_authoritative_primary_domain(c_dom):
                claim_primary_url = c_url
        verified_primary = bool(claim_primary_url) and bool(claim.get("isPrimarySource"))
        norm_claim = {
            **claim,
            "entity": ticker,
            "isPrimarySource": verified_primary,
            "primarySourceUrl": claim_primary_url,
        }
        accepted_claims.append(norm_claim)

        if claim["classification"] in ("observed", "reported") and verified_primary and published_at is not None:
            fkey = fact_dedupe_key(ticker, claim["metric"], claim["period"], float(claim["value"]), claim["unit"])
            if fkey in seen_fact_keys:
                duplicate_facts += 1
                reasons.append(f"duplicate_fact_skipped:{claim['id']}")
            else:
                seen_fact_keys.add(fkey)
                promotable_facts.append({
                    "source": claim_primary_url,
                    "symbol": ticker,
                    "metric": claim["metric"].strip(),
                    "value": float(claim["value"]),
                    "unit": claim["unit"].strip(),
                    "period": claim["period"].strip(),
                    "definition": claim["definition"].strip(),
                    "status": "measured" if claim["classification"] == "observed" else "reported",
                    "publishedAt": published_at,
                    "receivedAt": server_received_at,
                    "serverReceivedAt": server_received_at,
                    "sourceRetrievedAt": source_retrieved_at,
                    "importedAt": imported_at,
                    "factKey": fkey,
                })
        else:
            reasons.append(f"pending_primary_verification:{claim['id']}:{claim['classification']}")

    seen_urls.add(canonical_url)
    seen_hashes.add(digest)

    if item.get("claims") and not accepted_claims:
        return {
            "externalId": item["externalId"],
            "canonicalUrl": canonical_url,
            "sourceDomain": domain,
            "title": item["title"].strip(),
            "contentSha256": digest,
            "publishedAt": published_at,
            "receivedAt": server_received_at,
            "serverReceivedAt": server_received_at,
            "sourceRetrievedAt": source_retrieved_at,
            "importedAt": imported_at,
            "untrustedAgentMetadata": untrusted_agent_metadata,
            "entities": covered_entities,
            "summary": item["summary"].strip(),
            "validationStatus": "rejected",
            "validationReasons": reasons or ["no_valid_claims"],
            "researchEligible": False,
            "marketOutcomeEligible": False,
            "executionAuthority": "none",
            "acceptedClaims": [],
            "promotableFacts": [],
            "duplicateFactCount": duplicate_facts,
        }

    status = "promoted" if promotable_facts else "pending_verification"
    return {
        "externalId": item["externalId"],
        "canonicalUrl": canonical_url,
        "sourceDomain": domain,
        "title": item["title"].strip(),
        "contentSha256": digest,
        "publishedAt": published_at,
        "receivedAt": server_received_at,
        "serverReceivedAt": server_received_at,
        "sourceRetrievedAt": source_retrieved_at,
        "importedAt": imported_at,
        "untrustedAgentMetadata": untrusted_agent_metadata,
        "entities": covered_entities,
        "summary": item["summary"].strip(),
        "validationStatus": status,
        "validationReasons": reasons or (["primary_source_verified"] if status == "promoted" else ["awaiting_primary_source_verification"]),
        "researchEligible": published_at is not None and published_at <= server_received_at,
        "marketOutcomeEligible": False,
        "executionAuthority": "none",
        "acceptedClaims": accepted_claims,
        "promotableFacts": promotable_facts,
        "duplicateFactCount": duplicate_facts,
    }


def validate_forward_experiment_registration(
    registration_cutoff_at: int,
    server_now: int,
    evidence_items: list[dict],
) -> dict:
    if registration_cutoff_at < server_now:
        raise ValueError(
            f"Backdated forward experiment registration prohibited: registrationCutoffAt ({registration_cutoff_at}) precedes authoritative server time ({server_now})"
        )
    for ev in evidence_items:
        pub = ev.get("publishedAt")
        srv = ev.get("serverReceivedAt")
        if pub is None or pub > registration_cutoff_at:
            raise ValueError(f"Evidence {ev.get('externalId')} lacks a publication time at or before the forward cutoff")
        if srv is None or srv > registration_cutoff_at:
            raise ValueError(
                f"Agent-submitted historical receipt times cannot establish forward eligibility for {ev.get('externalId')}: authoritative serverReceivedAt ({srv}) is after cutoff ({registration_cutoff_at})"
            )
    return {
        "eligible": True,
        "registeredAt": server_now,
        "cutoffAt": registration_cutoff_at,
    }


def _last_sunday_day(year: int, month: int) -> int:
    # month is 3 (March, 31 days) or 10 (October, 31 days)
    dt = datetime(year, month, 31, tzinfo=timezone.utc)
    # weekday(): Monday=0 ... Sunday=6
    offset = (dt.weekday() + 1) % 7
    return 31 - offset


def get_london_time_parts(timestamp_ms: int) -> dict:
    utc_dt = datetime.fromtimestamp(timestamp_ms / 1000.0, tz=timezone.utc)
    year = utc_dt.year
    bst_start_utc = datetime(year, 3, _last_sunday_day(year, 3), 1, 0, 0, tzinfo=timezone.utc)
    bst_end_utc = datetime(year, 10, _last_sunday_day(year, 10), 1, 0, 0, tzinfo=timezone.utc)
    is_bst = bst_start_utc <= utc_dt < bst_end_utc
    offset_minutes = 60 if is_bst else 0
    regime = "BST" if is_bst else "GMT"
    local_dt = datetime.fromtimestamp((timestamp_ms + offset_minutes * 60_000) / 1000.0, tz=timezone.utc)
    weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    weekday = weekdays[local_dt.weekday()]
    is_weekday = weekday not in ("Sat", "Sun")
    return {
        "dateKey": local_dt.strftime("%Y-%m-%d"),
        "localTimeDisplay": local_dt.strftime("%H:%M"),
        "year": local_dt.year,
        "month": local_dt.month,
        "day": local_dt.day,
        "hour": local_dt.hour,
        "minute": local_dt.minute,
        "second": local_dt.second,
        "weekday": weekday,
        "isWeekday": is_weekday,
        "offsetMinutes": offset_minutes,
        "regime": regime,
        "minutesSinceMidnight": local_dt.hour * 60 + local_dt.minute,
    }


def evaluate_london_morning_brief_window(
    now_ms: int,
    existing_briefing_dates: set[str] | list[str],
    force_on_demand: bool = False,
) -> dict:
    parts = get_london_time_parts(now_ms)
    existing_set = set(existing_briefing_dates)
    already_generated = parts["dateKey"] in existing_set
    in_target_window = parts["isWeekday"] and parts["minutesSinceMidnight"] >= 7 * 60 + 30
    if already_generated:
        should_run = False
        reason = "already_generated_for_uk_date"
    elif force_on_demand:
        should_run = True
        reason = "forced_on_demand_first_for_date"
    elif not parts["isWeekday"]:
        should_run = False
        reason = "weekend_europe_london"
    elif not in_target_window:
        should_run = False
        reason = "before_0730_europe_london"
    else:
        should_run = True
        reason = "due_at_0730_europe_london"
    return {
        "dateKey": parts["dateKey"],
        "localTimeDisplay": parts["localTimeDisplay"],
        "regime": parts["regime"],
        "offsetMinutes": parts["offsetMinutes"],
        "isWeekday": parts["isWeekday"],
        "alreadyGeneratedForDate": already_generated,
        "inTargetWindow": in_target_window,
        "shouldRun": should_run,
        "reason": reason,
    }


def validate_price_presentation(obs: dict, now_ms: int) -> dict:
    received_at = int(obs["receivedAt"])
    event_at = int(obs["eventAt"])
    if received_at > now_ms:
        raise ValueError("Future receipt timestamp is invalid")
    if received_at < event_at:
        raise ValueError("Receipt timestamp cannot precede observation event time")
    age_ms = now_ms - event_at
    is_delayed = float(obs.get("declaredDelayMs", 0)) > 0 or not bool(obs.get("licensedForLiveQuotes")) or age_ms > 120_000
    if obs.get("presentedAsLiveQuote") and is_delayed:
        raise ValueError(f"Delayed or unlicensed price for {obs['symbol']} cannot be presented as a live quote")
    return {
        "symbol": obs["symbol"],
        "price": float(obs["price"]),
        "currency": obs["currency"],
        "eventAt": event_at,
        "receivedAt": received_at,
        "isDelayed": is_delayed,
        "licensedForExecution": bool(obs.get("licensedForExecution")) and not is_delayed,
        "badge": "Delayed reference close (not a live quote)" if is_delayed else "Licensed live quote",
        "source": obs["source"],
    }


def run_news_research_workflow(
    run_id: str,
    candidates: list[dict],
    now_ms: int,
    cursor_before: str | None = None,
    existing_urls: set[str] | None = None,
    existing_hashes: set[str] | None = None,
    existing_fact_keys: set[str] | None = None,
    agent_id: str = "antigravity-news-research-agent",
    environment: str = "remote",
    model_version: str = "gemini-2.5-flash-preview",
    env: dict[str, str] | None = None,
) -> dict:
    if env is not None:
        assert_least_privilege_environment(env)
    seen_urls = set(existing_urls or set())
    seen_hashes = set(existing_hashes or set())
    seen_facts = set(existing_fact_keys or set())

    staged_items = []
    validation_results = []
    duplicates_skipped = 0
    quarantined_count = 0
    promoted_count = 0
    pending_count = 0
    latest_receipt = now_ms

    for doc in candidates:
        canonical_url, domain = canonicalize_source_url(doc["url"])
        digest = content_sha256(canonical_url, doc["title"], doc["text"])
        if canonical_url in seen_urls or digest in seen_hashes:
            duplicates_skipped += 1
            continue
        entities = extract_universe_entities(doc["title"], doc["text"]) or ["MSFT"]
        is_primary = is_authoritative_primary_domain(domain)
        primary_url = canonical_url if is_primary else None
        if not primary_url and doc.get("primarySourceUrl"):
            c_url, c_dom = canonicalize_source_url(doc["primarySourceUrl"])
            if is_authoritative_primary_domain(c_dom):
                primary_url = c_url
        claims = doc.get("claims") if "claims" in doc else extract_structured_claims(doc, entities, is_primary or bool(primary_url), primary_url)
        item = {
            "externalId": doc.get("externalId") or f"staged-{digest[:16]}",
            "sourceUrl": canonical_url,
            "title": doc["title"].strip(),
            "text": doc["text"],
            "summary": f"{doc['title'].strip()} ({', '.join(entities)}; {len(claims)} claim(s)).",
            "publishedAt": doc.get("publishedAt"),
            "receivedAt": int(doc["receivedAt"]),
            "entities": entities,
            "claims": claims,
            "primarySourceUrl": primary_url,
        }
        if doc.get("proposedHypothesis"):
            item["hypothesis"] = doc["proposedHypothesis"].strip()
        staged_items.append(item)

        validated = validate_staged_item(item, now_ms, seen_urls, seen_hashes, seen_facts)
        validation_results.append(validated)
        duplicates_skipped += validated["duplicateFactCount"]
        if validated["validationStatus"] == "duplicate":
            duplicates_skipped += 1
        elif validated["validationStatus"] == "quarantined_injection":
            quarantined_count += 1
        elif validated["validationStatus"] == "promoted":
            promoted_count += len(validated["promotableFacts"])
        elif validated["validationStatus"] == "pending_verification":
            pending_count += 1
        if int(doc["receivedAt"]) > latest_receipt:
            latest_receipt = int(doc["receivedAt"])

    cursor_digest = hashlib.sha256(
        f"{cursor_before or 'init'}|{','.join(i['externalId'] for i in staged_items)}".encode("utf-8")
    ).hexdigest()[:12]
    cursor_after = f"cursor:{max(latest_receipt, now_ms)}:{cursor_digest}"
    no_new_items = len(staged_items) == 0
    input_tokens = 0 if no_new_items else (sum(max(1, len(i["text"]) // 4) for i in staged_items) + 120)
    output_tokens = 0 if no_new_items else (len(staged_items) * 95 + 60)
    estimated_cost_gbp = 0.0 if no_new_items else round((input_tokens * 0.00000015 + output_tokens * 0.0000006) * 0.79, 6)

    submission = {
        "runId": run_id,
        "agentId": agent_id,
        "environment": environment,
        "cursorBefore": cursor_before,
        "cursorAfter": cursor_after,
        "modelVersion": model_version,
        "inputTokens": input_tokens,
        "outputTokens": output_tokens,
        "estimatedCostGbp": estimated_cost_gbp,
        "actualCostGbp": None,
        "items": staged_items,
    }
    return {
        "submission": submission,
        "validationResults": validation_results,
        "summary": {
            "runId": run_id,
            "agentId": agent_id,
            "universeCount": len(APPROVED_RESEARCH_UNIVERSE),
            "cursorBefore": cursor_before,
            "cursorAfter": cursor_after,
            "candidatesDiscovered": len(candidates),
            "duplicatesSkipped": duplicates_skipped,
            "quarantinedCount": quarantined_count,
            "stagedCount": len(staged_items),
            "promotedEvidenceCount": promoted_count,
            "pendingVerificationCount": pending_count,
            "modelVersion": model_version,
            "estimatedCostGbp": estimated_cost_gbp,
            "executionAuthority": "none",
        },
    }


def submit_to_staging_endpoint(endpoint: str, staging_token: str, payload: dict, timeout: float = 15.0) -> dict:
    parsed = urlparse(endpoint)
    if parsed.scheme not in ("https", "http") or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Invalid staging endpoint URL")
    if parsed.scheme == "http" and parsed.hostname not in ("localhost", "127.0.0.1"):
        raise ValueError("Remote staging endpoint must use HTTPS")
    if not staging_token or len(staging_token) < 32:
        raise ValueError("RESEARCH_STAGING_TOKEN (32+ chars) is required")
    body = json.dumps(payload, separators=(",", ":"), allow_nan=False).encode("utf-8")
    req = Request(
        endpoint,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {staging_token}",
        },
        method="POST",
    )
    with build_opener(RejectRedirects()).open(req, timeout=timeout) as resp:
        raw = resp.read(500_000)
    return json.loads(raw.decode("utf-8"))


def fetch_live_sec_candidates(tickers: list[str], now_ms: int, user_agent: str = "AICapitalIntelligence/0.3 (compliance@vectis.ai)") -> list[dict]:
    opener = build_opener(RejectRedirects())
    candidates = []
    for u in APPROVED_RESEARCH_UNIVERSE:
        if u["ticker"] not in tickers:
            continue
        cik_padded = u["cik"].zfill(10)
        cik_num = str(int(u["cik"]))
        sub_url = f"https://data.sec.gov/submissions/CIK{cik_padded}.json"
        facts_url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik_padded}.json"
        req_sub = Request(sub_url, headers={"User-Agent": user_agent, "Accept": "application/json"})
        req_facts = Request(facts_url, headers={"User-Agent": user_agent, "Accept": "application/json"})
        with opener.open(req_sub, timeout=15.0) as r_sub:
            sub = json.loads(r_sub.read(2_000_000).decode("utf-8"))
        with opener.open(req_facts, timeout=20.0) as r_facts:
            facts = json.loads(r_facts.read(15_000_000).decode("utf-8"))
        recent = (sub.get("filings") or {}).get("recent") or {}
        forms = recent.get("form") or []
        accns = recent.get("accessionNumber") or []
        fileds = recent.get("filingDate") or []
        pdocs = recent.get("primaryDocument") or []
        if not forms or not accns or not fileds:
            continue
        idx = next((i for i, f in enumerate(forms) if f in ("10-Q", "10-K", "8-K")), 0)
        accn = accns[idx]
        accn_clean = accn.replace("-", "")
        form = forms[idx]
        filed = fileds[idx]
        pdoc = pdocs[idx] if idx < len(pdocs) and pdocs[idx] else f"{accn}.txt"
        doc_url = f"https://www.sec.gov/Archives/edgar/data/{cik_num}/{accn_clean}/{pdoc}"
        pub_dt = datetime.fromisoformat(f"{filed}T16:00:00+00:00")
        pub_ms = min(int(pub_dt.timestamp() * 1000), now_ms - 60_000)

        gaap = (facts.get("facts") or {}).get("us-gaap") or {}
        capex_obj = gaap.get("PaymentsToAcquirePropertyPlantAndEquipment") or gaap.get("CapitalExpendituresIncurredButNotYetPaid")
        rev_obj = gaap.get("RevenueFromContractWithCustomerExcludingAssessedTax") or gaap.get("Revenues")
        chosen = capex_obj if (capex_obj and (capex_obj.get("units") or {}).get("USD")) else rev_obj
        metric_kind = "capital expenditures" if chosen is capex_obj else "revenue"
        units = ((chosen or {}).get("units") or {}).get("USD") or []
        valid_units = [x for x in units if isinstance(x.get("val"), (int, float)) and x["val"] > 0 and x.get("form") in ("10-Q", "10-K") and x.get("filed")]
        valid_units.sort(key=lambda x: str(x.get("filed")), reverse=True)
        if not valid_units:
            continue
        latest = valid_units[0]
        val_b = round(float(latest["val"]) / 1e9, 2)
        fy = latest.get("fy") or filed[:4]
        fp_raw = latest.get("fp") or "FY"
        period = f"{fp_raw} {fy}" if fp_raw != "FY" else f"FY{fy}"
        candidates.append({
            "url": doc_url,
            "title": f"{u['name']} ({u['ticker']}) SEC Form {form} ({accn}) — {period} XBRL disclosure",
            "text": f"In SEC Form {form} (accession {accn}, filed {filed}), {u['name']} ({u['ticker']}) reported ${val_b} billion in {metric_kind} for {period}.",
            "publishedAt": pub_ms,
            "receivedAt": now_ms - 5_000,
            "primarySourceUrl": doc_url,
            "proposedHypothesis": f"{u['ticker']} primary XBRL {metric_kind} ({period}: ${val_b}B) provides verified baseline before regional power-grid capacity checks.",
        })
    return candidates


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run Phase 003 Remote News & Disclosure Research Agent workflow")
    parser.add_argument("--candidates", help="Path to JSON candidate sources file")
    parser.add_argument("--live-sec", nargs="*", help="Fetch live SEC EDGAR filings for specified tickers (e.g. NVDA MSFT)")
    parser.add_argument("--run-id", default=f"run-{int(datetime.now(timezone.utc).timestamp() * 1000)}")
    parser.add_argument("--now-ms", type=int, default=int(datetime.now(timezone.utc).timestamp() * 1000))
    parser.add_argument("--output", help="Optional path to write staging submission & validation output JSON")
    parser.add_argument("--submit-url", help="Optional staging endpoint URL (POST /api/research/staging)")
    args = parser.parse_args(argv)

    env = dict(os.environ)
    assert_least_privilege_environment(env)
    if args.live_sec is not None:
        tickers = args.live_sec if len(args.live_sec) > 0 else ["NVDA", "MSFT", "AMZN"]
        user_agent = env.get("SEC_USER_AGENT", "AICapitalIntelligence/0.3 (compliance@vectis.ai)")
        candidates = fetch_live_sec_candidates(tickers, args.now_ms, user_agent=user_agent)
        model_ver = env.get("GEMINI_MODEL", "gemini-2.5-flash") if env.get("GEMINI_API_KEY") else "deterministic-sec-xbrl-extractor-v1 (GEMINI_API_KEY not configured)"
    elif args.candidates:
        candidates = json.loads(Path(args.candidates).read_text(encoding="utf-8"))
        model_ver = "gemini-2.5-flash-preview"
    else:
        raise ValueError("Specify either --candidates <path> or --live-sec [TICKERS...]")

    result = run_news_research_workflow(
        run_id=args.run_id,
        candidates=candidates,
        now_ms=args.now_ms,
        model_version=model_ver,
        env=env,
    )
    if args.live_sec is not None and not env.get("GEMINI_API_KEY"):
        result["submission"]["inputTokens"] = 0
        result["submission"]["outputTokens"] = 0
        result["submission"]["estimatedCostGbp"] = 0.0
        result["submission"]["actualCostGbp"] = None
        result["summary"]["estimatedCostGbp"] = 0.0

    if args.output:
        Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    if args.submit_url:
        token = env.get("RESEARCH_STAGING_TOKEN", "")
        result["serverResponse"] = submit_to_staging_endpoint(args.submit_url, token, result["submission"])
    print(json.dumps({"summary": result["summary"], "serverResponse": result.get("serverResponse")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
