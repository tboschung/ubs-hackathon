#!/usr/bin/env python3
"""Generate and validate deterministic email/ticket mock pairs."""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
OUTPUT_PATH = DATA_DIR / "email_ticket_pairs.json"
REPORT_PATH = DATA_DIR / "validation_report.json"

NODE_IDS = {
    "actor:user",
    "actor:employee",
    "actor:supplier",
    "platform:e_banking",
    "platform:hr",
    "platform:crm",
    "server:ebanking_primary",
}
EDGE_MAP = {
    "edge:user_login_ebanking": ("actor:user", "LOGS_INTO", "platform:e_banking"),
    "edge:employee_login_hr": ("actor:employee", "LOGS_INTO", "platform:hr"),
    "edge:employee_login_crm": ("actor:employee", "LOGS_INTO", "platform:crm"),
    "edge:user_pays_supplier": ("actor:user", "PAYS", "actor:supplier"),
    "edge:ebanking_depends_on_server": ("platform:e_banking", "DEPENDS_ON", "server:ebanking_primary"),
    "edge:server_provided_by_supplier": ("server:ebanking_primary", "PROVIDED_BY", "actor:supplier"),
}
RELATIONSHIP_TYPES = {value[1] for value in EDGE_MAP.values()} | {"OPERATED_BY"}
CHANNELS = {"mobile_ios", "mobile_android", "web", "api", "unknown"}
ENVIRONMENTS = {"production", "test", "unknown"}
REGIONS = {"CH", "EMEA", "APAC", "unknown"}


def iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


def make_pair(
    number: int,
    received_at: datetime,
    sender: str,
    subject: str,
    body: str,
    summary: str,
    *,
    actor_ids: list[str],
    platform_ids: list[str],
    server_ids: list[str],
    supplier_ids: list[str],
    edge_ids: list[str],
    relationship_types: list[str],
    primary: str | None,
    symptom: str,
    region: str,
    channel: str,
    environment: str,
    error_code: str | None,
    release_id: str | None,
    confidence: float,
    evidence: list[str],
) -> dict:
    suffix = f"{number:04d}"
    return {
        "email": {
            "id": f"EMAIL-{suffix}",
            "received_at": iso(received_at),
            "from": sender,
            "subject": subject,
            "body": body,
        },
        "ticket": {
            "id": f"TCK-{suffix}",
            "email_id": f"EMAIL-{suffix}",
            "received_at": iso(received_at),
            "raw_email": body,
            "summary": summary,
            "ontology_values": {
                "actor_ids": actor_ids,
                "platform_ids": platform_ids,
                "server_ids": server_ids,
                "supplier_ids": supplier_ids,
                "edge_ids": edge_ids,
                "relationship_types": relationship_types,
                "primary_affected_node_id": primary,
                "symptom": symptom,
                "region": region,
                "channel": channel,
                "environment": environment,
                "error_code": error_code,
                "release_id": release_id,
            },
            "extraction": {"confidence": confidence, "evidence": evidence},
        },
    }


def build_pairs() -> list[dict]:
    start = datetime(2026, 9, 22, 8, 30, tzinfo=timezone(timedelta(hours=2)))
    pairs: list[dict] = []

    def add(category: str, count: int, offset: int, spacing: int, spec) -> None:
        for index in range(count):
            number = len(pairs) + 1
            timestamp = start + timedelta(minutes=offset + index * spacing)
            values = spec(index, number)
            values["body"] = values["body"].format(n=number, i=index + 1)
            values["body"] += f" Reference CASE-{number:04d}."
            pairs.append(make_pair(number, timestamp, **values))

    ios_phrases = [
        "After installing mobile release 6.4.0, customer {n} gets error A17 while signing into E-Banking on iOS.",
        "A client reports that E-Banking login on the iPhone app fails with A17 since mobile-6.4.0.",
        "Mobile user {n} cannot authenticate to online banking on iOS; the screen shows error A17 after today's 6.4.0 update.",
        "Since the mobile-6.4.0 rollout, E-Banking rejects an iOS customer's sign-in with code A17.",
        "Customer {n} says the updated iOS mobile banking app returns A17 at login on version mobile-6.4.0.",
    ]
    add("ios_login", 25, 42, 1, lambda i, n: dict(
        sender=f"support.agent{(i % 6) + 1}@example.test",
        subject=f"iOS login failure A17 case {n}",
        body=ios_phrases[i % len(ios_phrases)],
        summary="Mobile iOS user cannot log into E-Banking after release 6.4.0.",
        actor_ids=["actor:user"], platform_ids=["platform:e_banking"], server_ids=[], supplier_ids=[],
        edge_ids=["edge:user_login_ebanking"], relationship_types=["LOGS_INTO"], primary="platform:e_banking",
        symptom="login_failure", region="CH", channel="mobile_ios", environment="production",
        error_code="A17", release_id="mobile-6.4.0", confidence=0.97,
        evidence=["mobile", "A17", "6.4.0"],
    ))

    add("android_login", 10, 75, 2, lambda i, n: dict(
        sender=f"contact.centre{(i % 4) + 1}@example.test",
        subject=f"Android authentication issue B42 #{n}",
        body="Customer {n} cannot log into E-Banking from Android; production app mobile-6.4.0 displays B42 in CH.",
        summary="Android user receives B42 while logging into E-Banking.",
        actor_ids=["actor:user"], platform_ids=["platform:e_banking"], server_ids=[], supplier_ids=[],
        edge_ids=["edge:user_login_ebanking"], relationship_types=["LOGS_INTO"], primary="platform:e_banking",
        symptom="login_failure", region="CH", channel="mobile_android", environment="production",
        error_code="B42", release_id="mobile-6.4.0", confidence=0.96,
        evidence=["Customer", "log into E-Banking", "Android", "B42"],
    ))

    add("web_timeout", 8, 100, 4, lambda i, n: dict(
        sender=f"web.ops{(i % 3) + 1}@example.test",
        subject=f"Web banking timeout {n}",
        body="A CH client using the E-Banking web channel in production sees a timeout before the login page completes; code WEB-504.",
        summary="E-Banking web login times out with WEB-504.",
        actor_ids=["actor:user"], platform_ids=["platform:e_banking"], server_ids=[], supplier_ids=[],
        edge_ids=["edge:user_login_ebanking"], relationship_types=["LOGS_INTO"], primary="platform:e_banking",
        symptom="timeout", region="CH", channel="web", environment="production",
        error_code="WEB-504", release_id=None, confidence=0.94,
        evidence=["client", "E-Banking", "web", "timeout", "WEB-504"],
    ))

    add("hr_login", 10, 0, 24, lambda i, n: dict(
        sender=f"employee{n}@example.test",
        subject=f"HR portal access request {n}",
        body="An employee in EMEA cannot log into the HR portal on the web in production and sees HR-401.",
        summary="Employee cannot log into the HR Platform.",
        actor_ids=["actor:employee"], platform_ids=["platform:hr"], server_ids=[], supplier_ids=[],
        edge_ids=["edge:employee_login_hr"], relationship_types=["LOGS_INTO"], primary="platform:hr",
        symptom="login_failure", region="EMEA", channel="web", environment="production",
        error_code="HR-401", release_id=None, confidence=0.96,
        evidence=["employee", "log into", "HR portal", "web", "HR-401"],
    ))

    crm_specs = [("timeout", "CRM-504", "times out"), ("login_failure", "CRM-403", "rejects the login")]
    add("crm", 10, 15, 11, lambda i, n: dict(
        sender=f"adviser{n}@example.test",
        subject=f"CRM issue {n}",
        body=f"A CH adviser says the production CRM web portal {crm_specs[i % 2][2]} with {crm_specs[i % 2][1]}.",
        summary=f"Employee reports a CRM {crm_specs[i % 2][0].replace('_', ' ')}.",
        actor_ids=["actor:employee"], platform_ids=["platform:crm"], server_ids=[], supplier_ids=[],
        edge_ids=["edge:employee_login_crm"], relationship_types=["LOGS_INTO"], primary="platform:crm",
        symptom=crm_specs[i % 2][0], region="CH", channel="web", environment="production",
        error_code=crm_specs[i % 2][1], release_id=None, confidence=0.93,
        evidence=["adviser", "CRM", "web", crm_specs[i % 2][1]],
    ))

    payment_specs = [("duplicate_payment", "PAY-208", "was submitted twice"), ("payment_failure", "PAY-503", "failed")]
    add("payments", 15, 130, 3, lambda i, n: dict(
        sender=f"payments.desk{(i % 5) + 1}@example.test",
        subject=f"Supplier payment report {n}",
        body=f"A CH customer reports that a supplier payment through E-Banking web {payment_specs[i % 2][2]}; code {payment_specs[i % 2][1]} in production.",
        summary=f"User reports a {payment_specs[i % 2][0].replace('_', ' ')} to a supplier through E-Banking.",
        actor_ids=["actor:user", "actor:supplier"], platform_ids=["platform:e_banking"], server_ids=[],
        supplier_ids=["actor:supplier"], edge_ids=["edge:user_pays_supplier"], relationship_types=["PAYS"],
        primary="platform:e_banking", symptom=payment_specs[i % 2][0], region="CH", channel="web",
        environment="production", error_code=payment_specs[i % 2][1], release_id=None, confidence=0.95,
        evidence=["customer", "supplier payment", "E-Banking", payment_specs[i % 2][1]],
    ))

    add("server", 12, 55, 2, lambda i, n: dict(
        sender=f"infrastructure.monitor{(i % 3) + 1}@example.test",
        subject=f"srv-eb-01 connectivity alert {n}",
        body="Production health check cannot reach srv-eb-01, the E-Banking backend server in CH; connection timeout INFRA-001.",
        summary="The primary E-Banking Server is unreachable.",
        actor_ids=[], platform_ids=["platform:e_banking"], server_ids=["server:ebanking_primary"], supplier_ids=[],
        edge_ids=["edge:ebanking_depends_on_server"], relationship_types=["DEPENDS_ON"],
        primary="server:ebanking_primary", symptom="server_unreachable", region="CH", channel="api",
        environment="production", error_code="INFRA-001", release_id=None, confidence=0.99,
        evidence=["srv-eb-01", "E-Banking", "server", "connection timeout", "INFRA-001"],
    ))

    add("supplier", 5, 62, 7, lambda i, n: dict(
        sender=f"vendor.management{(i % 2) + 1}@example.test",
        subject=f"Infrastructure supplier notice {n}",
        body="Our supplier reports degraded service for the production E-Banking server srv-eb-01 in EMEA under contract INFRA-SLA.",
        summary="Supplier reports degraded service for the E-Banking Server.",
        actor_ids=["actor:supplier"], platform_ids=[], server_ids=["server:ebanking_primary"],
        supplier_ids=["actor:supplier"], edge_ids=["edge:server_provided_by_supplier"],
        relationship_types=["PROVIDED_BY"], primary="server:ebanking_primary", symptom="server_unreachable",
        region="EMEA", channel="unknown", environment="production", error_code=None, release_id=None,
        confidence=0.91, evidence=["supplier", "E-Banking server", "srv-eb-01", "degraded service"],
    ))

    unknown_bodies = [
        "Please call me about the issue discussed yesterday; no system details were included.",
        "The screen looks unusual this morning, but I do not know which application it is.",
        "Can someone investigate the intermittent problem reported by the team?",
        "A customer mentioned that something failed, without sharing the channel or service.",
        "Following up on the earlier case; the original technical information is unavailable.",
    ]
    add("unclassified", 5, 210, 5, lambda i, n: dict(
        sender=f"general.inbox{(i % 2) + 1}@example.test",
        subject=f"Insufficient information {n}", body=unknown_bodies[i],
        summary="Insufficient information to classify the reported issue.",
        actor_ids=[], platform_ids=[], server_ids=[], supplier_ids=[], edge_ids=[], relationship_types=[],
        primary=None, symptom="unknown", region="unknown", channel="unknown", environment="unknown",
        error_code=None, release_id=None, confidence=0.22, evidence=[unknown_bodies[i].split(";")[0]],
    ))

    return sorted(pairs, key=lambda pair: (pair["email"]["received_at"], pair["email"]["id"]))


def validate_pair(pair: dict) -> list[str]:
    errors: list[str] = []
    email, ticket = pair.get("email", {}), pair.get("ticket", {})
    values, extraction = ticket.get("ontology_values", {}), ticket.get("extraction", {})
    required_ticket = {"id", "email_id", "received_at", "raw_email", "summary", "ontology_values", "extraction"}
    required_values = {"actor_ids", "platform_ids", "server_ids", "supplier_ids", "edge_ids", "relationship_types", "primary_affected_node_id", "symptom", "region", "channel", "environment", "error_code", "release_id"}
    if set(ticket) != required_ticket:
        errors.append("ticket fields do not exactly match the contract")
    if set(values) != required_values:
        errors.append("ontology_values fields do not exactly match the contract")
    if ticket.get("email_id") != email.get("id") or ticket.get("received_at") != email.get("received_at"):
        errors.append("ticket/email identity or timestamp mismatch")
    if ticket.get("raw_email") != email.get("body"):
        errors.append("raw_email is not the immutable email body")
    for field in ("actor_ids", "platform_ids", "server_ids", "supplier_ids"):
        if not isinstance(values.get(field), list) or not set(values.get(field, [])).issubset(NODE_IDS):
            errors.append(f"invalid {field}")
    if not set(values.get("edge_ids", [])).issubset(EDGE_MAP):
        errors.append("invalid edge_ids")
    if not set(values.get("relationship_types", [])).issubset(RELATIONSHIP_TYPES):
        errors.append("invalid relationship_types")
    for edge_id in values.get("edge_ids", []):
        if EDGE_MAP[edge_id][1] not in values.get("relationship_types", []):
            errors.append(f"relationship missing for {edge_id}")
    listed_nodes = set().union(*(set(values.get(field, [])) for field in ("actor_ids", "platform_ids", "server_ids", "supplier_ids")))
    if values.get("primary_affected_node_id") is not None and values["primary_affected_node_id"] not in listed_nodes:
        errors.append("primary affected node is not among extracted nodes")
    if values.get("region") not in REGIONS or values.get("channel") not in CHANNELS or values.get("environment") not in ENVIRONMENTS:
        errors.append("invalid controlled context value")
    if not isinstance(values.get("symptom"), str) or not values.get("symptom"):
        errors.append("symptom must be a non-empty controlled value")
    confidence = extraction.get("confidence")
    if not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
        errors.append("confidence is outside 0..1")
    body_lower = email.get("body", "").lower()
    evidence = extraction.get("evidence")
    if not isinstance(evidence, list) or not evidence:
        errors.append("evidence must be a non-empty list")
    else:
        for fragment in evidence:
            if fragment.lower() not in body_lower:
                errors.append(f"evidence is not verbatim email text: {fragment}")
    if not re.fullmatch(r"EMAIL-\d{4}", str(email.get("id", ""))) or not re.fullmatch(r"TCK-\d{4}", str(ticket.get("id", ""))):
        errors.append("invalid stable ID format")
    try:
        datetime.fromisoformat(email.get("received_at", ""))
    except (TypeError, ValueError):
        errors.append("invalid ISO-8601 received_at")
    return errors


def main() -> None:
    pairs = build_pairs()
    results = [{"email_id": pair["email"]["id"], "ticket_id": pair["ticket"]["id"], "valid": not (issues := validate_pair(pair)), "errors": issues} for pair in pairs]
    ids = [pair["email"]["id"] for pair in pairs] + [pair["ticket"]["id"] for pair in pairs]
    global_errors = []
    if len(pairs) != 100:
        global_errors.append(f"expected 100 pairs, got {len(pairs)}")
    if len(ids) != len(set(ids)):
        global_errors.append("IDs are not unique")
    bodies = [pair["email"]["body"] for pair in pairs]
    if len(bodies) != len(set(bodies)):
        global_errors.append("email bodies are not unique")
    if [pair["email"]["received_at"] for pair in pairs] != sorted(pair["email"]["received_at"] for pair in pairs):
        global_errors.append("pairs are not in timestamp order")
    failed = [result for result in results if not result["valid"]]
    report = {
        "schema_version": "1.0",
        "source_contract": "ontology.md#6-model-pass-1-email-to-ticket-contract",
        "pair_count": len(pairs),
        "valid_pair_count": len(pairs) - len(failed),
        "invalid_pair_count": len(failed),
        "global_errors": global_errors,
        "pairs": results,
    }
    DATA_DIR.mkdir(exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(pairs, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if failed or global_errors:
        raise SystemExit(f"Validation failed: {len(failed)} invalid pairs; {global_errors}")
    print(f"Wrote and validated {len(pairs)} pairs to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
