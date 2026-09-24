"""Deterministic, offline fallback for GeminiTicketGenerator.

Tags an email against the same ontology contract using keyword/alias
matching instead of a model call, so the pipeline still produces a valid
Ticket when no API key is configured or the Gemini call fails (network,
auth, rate limit). It is intentionally shallow - no attempt to match the
model's language understanding - so confidence is capped well below the
model's typical range to signal "needs review" downstream.
"""

from __future__ import annotations

import re

from .models import Extraction, OntologyValues, Ticket

# Mirrors static/ontology/ontology.json node aliases.
_NODE_ALIASES: dict[str, tuple[str, ...]] = {
    "actor:user": ("customer", "client", "end user", "mobile user", "user"),
    "actor:employee": ("staff", "colleague", "agent", "adviser", "employee"),
    "actor:supplier": ("vendor", "beneficiary", "third party", "supplier"),
    "platform:e_banking": ("ebanking", "e-bank", "e-banking", "online banking", "mobile banking", "myhub"),
    "platform:hr": ("hr portal", "people portal", "employee portal", "hr platform"),
    "platform:crm": ("crm", "client relationship platform"),
    "server:ebanking_primary": ("e-banking host", "backend server", "application server", "srv-eb-01"),
}

_SYMPTOM_KEYWORDS: dict[str, tuple[str, ...]] = {
    "login_failure": (
        "log in", "login", "sign in", "signing in", "authenticate", "authentication",
        "authenticating", "password", "locked out", "lockout", "one-time code", "otp", "face id", "mfa",
    ),
    "timeout": ("timeout", "timed out", "times out", "slow", "loading", "hangs", "hung"),
    "duplicate_payment": ("twice", "duplicate", "double payment", "charged twice"),
    "server_unreachable": ("unreachable", "cannot connect", "connection refused", "outage", "not responding"),
}

_CHANNEL_KEYWORDS: dict[str, tuple[str, ...]] = {
    "mobile_ios": ("ios", "iphone", "face id", "ipad"),
    "mobile_android": ("android",),
    "web": ("website", "browser", "web portal", "web channel", "web"),
    "api": ("api",),
}

_REGION_KEYWORDS: dict[str, tuple[str, ...]] = {
    "CH": ("switzerland", "zurich", "geneva", "swiss", "ch"),
    "APAC": ("apac", "asia", "singapore", "hong kong", "tokyo"),
    "EMEA": ("emea", "europe", "london", "frankfurt"),
}

_ENVIRONMENT_KEYWORDS: dict[str, tuple[str, ...]] = {
    "production": ("production", "live environment"),
    "test": ("test environment", "staging", "sandbox"),
}

# (edge id, (source node, target node), relationship) - mirrors static/ontology/ontology.json edges.
_EDGE_RULES: tuple[tuple[str, tuple[str, str], str], ...] = (
    ("edge:user_login_ebanking", ("actor:user", "platform:e_banking"), "LOGS_INTO"),
    ("edge:employee_login_hr", ("actor:employee", "platform:hr"), "LOGS_INTO"),
    ("edge:employee_login_crm", ("actor:employee", "platform:crm"), "LOGS_INTO"),
    ("edge:user_pays_supplier", ("actor:user", "actor:supplier"), "PAYS"),
    ("edge:ebanking_depends_on_server", ("platform:e_banking", "server:ebanking_primary"), "DEPENDS_ON"),
    ("edge:server_provided_by_supplier", ("server:ebanking_primary", "actor:supplier"), "PROVIDED_BY"),
)

_ERROR_CODE_RE = re.compile(r"\b[A-Z]{2,6}-?\d{2,4}\b")
_RELEASE_RE = re.compile(r"\bmobile-\d+\.\d+\.\d+\b", re.IGNORECASE)


def _keyword_pattern(keyword: str) -> re.Pattern[str]:
    return re.compile(rf"\b{re.escape(keyword)}\b", re.IGNORECASE)


def _find(text: str, keywords: tuple[str, ...]) -> str | None:
    for keyword in keywords:
        match = _keyword_pattern(keyword).search(text)
        if match:
            return match.group(0)
    return None


def _match_all(text: str, table: dict[str, tuple[str, ...]]) -> list[tuple[str, str]]:
    """Return [(label, evidence_fragment), ...] for every label with a hit."""
    hits = []
    for label, keywords in table.items():
        fragment = _find(text, keywords)
        if fragment:
            hits.append((label, fragment))
    return hits


def _match_one(text: str, table: dict[str, tuple[str, ...]]) -> tuple[str | None, str | None]:
    for label, keywords in table.items():
        fragment = _find(text, keywords)
        if fragment:
            return label, fragment
    return None, None


def _pick_primary(server_ids: list[str], platform_ids: list[str], actor_ids: list[str]) -> str | None:
    if server_ids:
        return server_ids[0]
    if platform_ids:
        return platform_ids[0]
    if actor_ids:
        return actor_ids[0]
    return None


def _confidence(node_ids: set[str], symptom: str | None, channel: str | None, region: str | None, error_code: str | None) -> float:
    score = 0.15
    if node_ids:
        score += 0.25
    if symptom:
        score += 0.2
    if channel or region:
        score += 0.1
    if error_code:
        score += 0.1
    return round(min(score, 0.75), 2)


_ACTOR_LABELS = {"actor:user": "A customer", "actor:employee": "An employee", "actor:supplier": "A supplier"}
_PLATFORM_LABELS = {"platform:e_banking": "E-Banking", "platform:hr": "the HR Platform", "platform:crm": "the CRM Platform", "server:ebanking_primary": "the E-Banking Server"}


def _summarize(node_ids: set[str], symptom: str | None, channel: str | None) -> str:
    actor = next((label for node, label in _ACTOR_LABELS.items() if node in node_ids), "Someone")
    platform = next((label for node, label in _PLATFORM_LABELS.items() if node in node_ids), None)
    if not symptom and not platform:
        return "Unclassified email requiring manual review."
    parts = [actor, "reports", symptom.replace("_", " ") if symptom else "an issue"]
    if platform:
        parts += ["on", platform]
    if channel and channel != "unknown":
        parts += ["via", channel.replace("_", " ")]
    return " ".join(parts).strip() + "."


class RuleBasedTicketGenerator:
    """Same interface as GeminiTicketGenerator: generate(text, *, ticket_id, email_id, received_at) -> Ticket.

    Deterministic keyword/alias matching against the ontology contract, no
    network calls, so it always succeeds. Intended as a fallback, not a
    replacement for the model's language understanding.
    """

    def generate(self, text: str, *, ticket_id: str, email_id: str, received_at: str) -> Ticket:
        evidence: list[str] = []

        node_hits = _match_all(text, _NODE_ALIASES)
        node_ids = {label for label, _ in node_hits}
        evidence.extend(fragment for _, fragment in node_hits)

        symptom, symptom_evidence = _match_one(text, _SYMPTOM_KEYWORDS)
        if symptom_evidence:
            evidence.append(symptom_evidence)

        channel, channel_evidence = _match_one(text, _CHANNEL_KEYWORDS)
        if channel_evidence:
            evidence.append(channel_evidence)

        region, region_evidence = _match_one(text, _REGION_KEYWORDS)
        if region_evidence:
            evidence.append(region_evidence)

        environment, _ = _match_one(text, _ENVIRONMENT_KEYWORDS)

        error_match = _ERROR_CODE_RE.search(text)
        error_code = error_match.group(0) if error_match else None
        if error_code:
            evidence.append(error_code)

        release_match = _RELEASE_RE.search(text)
        release_id = release_match.group(0) if release_match else None
        if release_id:
            evidence.append(release_id)

        actor_ids = sorted(n for n in node_ids if n.startswith("actor:"))
        platform_ids = sorted(n for n in node_ids if n.startswith("platform:"))
        server_ids = sorted(n for n in node_ids if n.startswith("server:"))
        supplier_ids = ["actor:supplier"] if "actor:supplier" in node_ids else []

        edge_ids: list[str] = []
        relationship_types: list[str] = []
        for edge_id, (source, target), relationship in _EDGE_RULES:
            if source in node_ids and target in node_ids:
                edge_ids.append(edge_id)
                if relationship not in relationship_types:
                    relationship_types.append(relationship)

        ontology_values = OntologyValues(
            actor_ids=actor_ids, platform_ids=platform_ids, server_ids=server_ids, supplier_ids=supplier_ids,
            edge_ids=edge_ids, relationship_types=relationship_types,
            primary_affected_node_id=_pick_primary(server_ids, platform_ids, actor_ids),
            symptom=symptom or "unknown", region=region or "unknown", channel=channel or "unknown",
            environment=environment or "unknown", error_code=error_code, release_id=release_id,
        )

        return Ticket(
            id=ticket_id, email_id=email_id, received_at=received_at, raw_email=text,
            summary=_summarize(node_ids, symptom, channel), ontology_values=ontology_values,
            extraction=Extraction(_confidence(node_ids, symptom, channel, region, error_code), evidence or ["no keyword match found"]),
        )
