"""Application service for parsing text or email into a ticket."""

from __future__ import annotations

from .gemini import GeminiTicketGenerator
from .models import EmailMessage, Ticket


class EmailTicketParser:
    def __init__(self, generator: GeminiTicketGenerator | None = None):
        self.generator = generator or GeminiTicketGenerator()

    def parse_text(self, text: str) -> Ticket:
        cleaned = text.strip()
        if not cleaned:
            raise ValueError("Enter an email or problem description.")
        if len(cleaned) > 8_000:
            raise ValueError("Input is too long (maximum 8,000 characters).")
        return self.generator.generate(cleaned)

    def parse_email(self, email: EmailMessage) -> Ticket:
        parts = [f"Subject: {email.subject.strip() or '(none)'}"]
        if email.sender.strip():
            parts.append(f"From: {email.sender.strip()}")
        parts.append(f"Body:\n{email.body.strip()}")
        return self.parse_text("\n".join(parts))
