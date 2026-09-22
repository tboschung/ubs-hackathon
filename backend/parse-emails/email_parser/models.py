"""Validated, transport-independent email and ontology ticket types."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any

ACTOR_IDS = ("actor:user", "actor:employee", "actor:supplier")
PLATFORM_IDS = ("platform:e_banking", "platform:hr", "platform:crm")
SERVER_IDS = ("server:ebanking_primary",)
SUPPLIER_IDS = ("actor:supplier",)
EDGE_IDS = ("edge:user_login_ebanking", "edge:employee_login_hr", "edge:employee_login_crm", "edge:user_pays_supplier", "edge:ebanking_depends_on_server", "edge:server_provided_by_supplier")
RELATIONSHIP_TYPES = ("LOGS_INTO", "PAYS", "VIA", "DEPENDS_ON", "PROVIDED_BY", "OPERATED_BY")
NODE_IDS = ACTOR_IDS + PLATFORM_IDS + SERVER_IDS
SYMPTOMS = ("login_failure", "timeout", "duplicate_payment", "server_unreachable", "unknown")
REGIONS = ("CH", "EMEA", "APAC", "unknown")
CHANNELS = ("mobile_ios", "mobile_android", "web", "api", "unknown")
ENVIRONMENTS = ("production", "test", "unknown")


@dataclass(frozen=True)
class EmailMessage:
    subject: str
    body: str
    sender: str = ""
    email_id: str | None = None
    received_at: str | None = None


def _strict_keys(value: dict[str, Any], expected: set[str], name: str) -> None:
    if set(value) != expected:
        raise ValueError(f"Gemini returned an unexpected {name} structure.")


def _enum_list(value: Any, allowed: tuple[str, ...], name: str) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(item, str) or item not in allowed for item in value):
        raise ValueError(f"Gemini returned invalid {name}.")
    return list(dict.fromkeys(value))


def _nullable_string(value: Any, name: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Gemini returned invalid {name}.")
    return value.strip()


@dataclass(frozen=True)
class OntologyValues:
    actor_ids: list[str] = field(default_factory=list)
    platform_ids: list[str] = field(default_factory=list)
    server_ids: list[str] = field(default_factory=list)
    supplier_ids: list[str] = field(default_factory=list)
    edge_ids: list[str] = field(default_factory=list)
    relationship_types: list[str] = field(default_factory=list)
    primary_affected_node_id: str | None = None
    symptom: str = "unknown"
    region: str = "unknown"
    channel: str = "unknown"
    environment: str = "unknown"
    error_code: str | None = None
    release_id: str | None = None

    @classmethod
    def from_dict(cls, value: Any) -> "OntologyValues":
        if not isinstance(value, dict):
            raise ValueError("ontology_values must be an object.")
        _strict_keys(value, set(cls.__annotations__), "ontology_values")
        primary = value["primary_affected_node_id"]
        if primary is not None and primary not in NODE_IDS:
            raise ValueError("Gemini returned an invalid primary affected node.")
        for name, allowed in {"symptom": SYMPTOMS, "region": REGIONS, "channel": CHANNELS, "environment": ENVIRONMENTS}.items():
            if value[name] not in allowed:
                raise ValueError(f"Gemini returned an invalid {name}.")
        return cls(
            actor_ids=_enum_list(value["actor_ids"], ACTOR_IDS, "actor IDs"), platform_ids=_enum_list(value["platform_ids"], PLATFORM_IDS, "platform IDs"),
            server_ids=_enum_list(value["server_ids"], SERVER_IDS, "server IDs"), supplier_ids=_enum_list(value["supplier_ids"], SUPPLIER_IDS, "supplier IDs"),
            edge_ids=_enum_list(value["edge_ids"], EDGE_IDS, "edge IDs"), relationship_types=_enum_list(value["relationship_types"], RELATIONSHIP_TYPES, "relationship types"),
            primary_affected_node_id=primary, symptom=value["symptom"], region=value["region"], channel=value["channel"], environment=value["environment"],
            error_code=_nullable_string(value["error_code"], "error_code"), release_id=_nullable_string(value["release_id"], "release_id"),
        )

    @classmethod
    def unclassified(cls) -> "OntologyValues":
        return cls()


@dataclass(frozen=True)
class Extraction:
    confidence: float
    evidence: list[str]

    @classmethod
    def from_dict(cls, value: Any) -> "Extraction":
        if not isinstance(value, dict):
            raise ValueError("extraction must be an object.")
        _strict_keys(value, {"confidence", "evidence"}, "extraction")
        confidence, evidence = value["confidence"], value["evidence"]
        if isinstance(confidence, bool) or not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
            raise ValueError("Extraction confidence must be between 0 and 1.")
        if not isinstance(evidence, list) or any(not isinstance(item, str) or not item.strip() for item in evidence):
            raise ValueError("Extraction evidence must be a list of non-empty strings.")
        return cls(float(confidence), [item.strip() for item in evidence])


@dataclass(frozen=True)
class Ticket:
    id: str
    email_id: str
    received_at: str
    raw_email: str
    summary: str
    ontology_values: OntologyValues
    extraction: Extraction

    @classmethod
    def from_dict(cls, value: Any) -> "Ticket":
        if not isinstance(value, dict):
            raise ValueError("Ticket must be an object.")
        _strict_keys(value, set(cls.__annotations__), "ticket")
        strings = {name: value[name] for name in ("id", "email_id", "received_at", "raw_email", "summary")}
        if any(not isinstance(item, str) or not item.strip() for item in strings.values()):
            raise ValueError("Ticket identifiers, timestamp, raw email, and summary must be non-empty strings.")
        try:
            datetime.fromisoformat(strings["received_at"].replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("received_at must be an ISO-8601 timestamp.") from exc
        return cls(**strings, ontology_values=OntologyValues.from_dict(value["ontology_values"]), extraction=Extraction.from_dict(value["extraction"]))

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
