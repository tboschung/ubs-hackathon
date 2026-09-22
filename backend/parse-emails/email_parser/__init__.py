"""Public API for turning incoming emails into support tickets."""

from .models import EmailMessage, Ticket
from .parser import EmailTicketParser
from .handoff import TicketSink

__all__ = ["EmailMessage", "Ticket", "EmailTicketParser", "TicketSink"]
