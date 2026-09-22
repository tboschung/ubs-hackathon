# Email-to-ticket parser

Self-contained entry module that turns an email into a validated six-field ticket. Its core package does not depend on the demo server and exposes a small downstream handoff contract.

## Run

1. From this directory, start the demo:

```bash
python3 app.py
```

3. Open <http://127.0.0.1:8000>.

The parser automatically reads the key at `../../assets/gemini_key.txt`, matching the project-level `../assets/gemini_key.txt` path. `GEMINI_API_KEY` can override it. No third-party Python packages are required.

## Integration

```python
from email_parser import EmailMessage, EmailTicketParser

email = EmailMessage(
    subject="CRM login blocked",
    body="The Zurich team receives error 403.",
    sender="alex@example.com",
)
ticket = EmailTicketParser().parse_email(email)
next_system.send(ticket)
```

Implement `TicketSink` from `email_parser.handoff` for a database, queue, or ticketing API adapter. The parser remains independent of that destination.

## Ticket shape

```json
{
  "title": "Short problem title",
  "description": "Clear summary",
  "category": "access | hardware | network | security | software | other",
  "urgency": "low | medium | high | critical",
  "affected_system": "System or device",
  "suggested_action": "First support action"
}
```

## Test

```bash
python3 -m unittest discover -s tests
```
