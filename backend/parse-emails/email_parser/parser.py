"""Application service for parsing text or email into an ontology ticket."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from .gemini import GeminiTicketGenerator
from .models import EmailMessage, Ticket


class EmailTicketParser:
    def __init__(self, generator: GeminiTicketGenerator | None = None):
        self.generator = generator or GeminiTicketGenerator()

    def parse_text(self, text: str) -> Ticket:
        return self._parse(text, None, None)

    def parse_email(self, email: EmailMessage) -> Ticket:
        parts = [f"Subject: {email.subject.strip() or '(none)'}"]
        if email.sender.strip():
            parts.append(f"From: {email.sender.strip()}")
        parts.append(f"Body:\n{email.body.strip()}")
        return self._parse("\n".join(parts), email.email_id, email.received_at)

    def _parse(self, raw_email: str, email_id: str | None, received_at: str | None) -> Ticket:
        cleaned = raw_email.strip()
        if not cleaned:
            raise ValueError("Enter an email or problem description.")
        if len(cleaned) > 8_000:
            raise ValueError("Input is too long (maximum 8,000 characters).")
        resolved_email_id = email_id or f"EMAIL-{uuid4().hex[:12].upper()}"
        timestamp = received_at or datetime.now(timezone.utc).isoformat()
        try:
            datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("received_at must be an ISO-8601 timestamp.") from exc
        return self.generator.generate(cleaned, ticket_id=resolved_email_id.replace("EMAIL-", "TCK-", 1), email_id=resolved_email_id, received_at=timestamp)
