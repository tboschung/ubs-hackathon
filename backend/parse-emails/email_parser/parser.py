"""Application service for parsing text or email into an ontology ticket."""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from uuid import uuid4

from .fallback import RuleBasedTicketGenerator
from .gemini import GeminiTicketGenerator
from .models import EmailMessage, Ticket


class EmailTicketParser:
    def __init__(self, generator: GeminiTicketGenerator | None = None, fallback: RuleBasedTicketGenerator | None = None):
        self.generator = generator or GeminiTicketGenerator()
        self.fallback = fallback or RuleBasedTicketGenerator()

    def parse_text(self, text: str) -> Ticket:
        ticket, _source = self._parse(text, None, None)
        return ticket

    def parse_email(self, email: EmailMessage) -> Ticket:
        ticket, _source = self.parse_email_with_source(email)
        return ticket

    def parse_email_with_source(self, email: EmailMessage) -> tuple[Ticket, str]:
        """Like parse_email, but also reports whether Gemini or the offline
        fallback tagger produced the ticket - useful for surfacing degraded
        mode in a UI without changing the Ticket contract itself."""
        parts = [f"Subject: {email.subject.strip() or '(none)'}"]
        if email.sender.strip():
            parts.append(f"From: {email.sender.strip()}")
        parts.append(f"Body:\n{email.body.strip()}")
        return self._parse("\n".join(parts), email.email_id, email.received_at)

    def _parse(self, raw_email: str, email_id: str | None, received_at: str | None) -> tuple[Ticket, str]:
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
        ticket_id = resolved_email_id.replace("EMAIL-", "TCK-", 1)
        try:
            ticket = self.generator.generate(cleaned, ticket_id=ticket_id, email_id=resolved_email_id, received_at=timestamp)
            return ticket, "gemini"
        except RuntimeError as exc:
            print(f"Gemini unavailable ({exc}); using rule-based fallback tagger.", file=sys.stderr)
            ticket = self.fallback.generate(cleaned, ticket_id=ticket_id, email_id=resolved_email_id, received_at=timestamp)
            return ticket, "fallback"
