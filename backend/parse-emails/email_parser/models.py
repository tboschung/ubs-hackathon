"""Transport-independent input and output data types."""

from __future__ import annotations

from dataclasses import asdict, dataclass


CATEGORIES = ("access", "hardware", "network", "security", "software", "other")
URGENCIES = ("low", "medium", "high", "critical")


@dataclass(frozen=True)
class EmailMessage:
    subject: str
    body: str
    sender: str = ""


@dataclass(frozen=True)
class Ticket:
    title: str
    description: str
    category: str
    urgency: str
    affected_system: str
    suggested_action: str

    @classmethod
    def from_dict(cls, value: dict) -> "Ticket":
        required = set(cls.__annotations__)
        if set(value) != required:
            raise ValueError("Gemini returned an unexpected ticket structure.")
        cleaned = {key: str(value[key]).strip() for key in required}
        if not all(cleaned.values()):
            raise ValueError("Every ticket field must contain a value.")
        if cleaned["category"] not in CATEGORIES:
            raise ValueError("Gemini returned an invalid category.")
        if cleaned["urgency"] not in URGENCIES:
            raise ValueError("Gemini returned an invalid urgency.")
        return cls(**cleaned)

    def to_dict(self) -> dict[str, str]:
        return asdict(self)
