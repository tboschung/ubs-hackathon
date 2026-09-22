"""Small downstream contract implemented by a database, API, or queue adapter."""

from typing import Protocol

from .models import Ticket


class TicketSink(Protocol):
    def send(self, ticket: Ticket) -> None:
        """Pass a validated ticket to the next system."""
