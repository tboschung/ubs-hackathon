# Email-to-ticket parser

Self-contained entry module that turns an email into the validated, ontology-backed ticket contract defined in `../../ontology.md`. Its core package does not depend on the demo server and exposes a small downstream handoff contract.

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
    subject="E-Banking login blocked",
    body="Customers on iOS receive error A17.",
    sender="alex@example.com",
    email_id="EMAIL-1042",                    # optional
    received_at="2026-09-22T09:14:00+02:00", # optional
)
ticket = EmailTicketParser().parse_email(email)
next_system.send(ticket)
```

Implement `TicketSink` from `email_parser.handoff` for a database, queue, or ticketing API adapter. The parser remains independent of that destination.

## Ticket shape

```json
{
  "id": "TCK-1042",
  "email_id": "EMAIL-1042",
  "received_at": "2026-09-22T09:14:00+02:00",
  "raw_email": "Subject: E-Banking login blocked\nFrom: alex@example.com\nBody:\nCustomers on iOS receive error A17.",
  "summary": "Mobile users cannot log into E-Banking.",
  "ontology_values": {
    "actor_ids": ["actor:user"],
    "platform_ids": ["platform:e_banking"],
    "server_ids": [],
    "supplier_ids": [],
    "edge_ids": ["edge:user_login_ebanking"],
    "relationship_types": ["LOGS_INTO"],
    "primary_affected_node_id": "platform:e_banking",
    "symptom": "login_failure",
    "region": "CH",
    "channel": "mobile_ios",
    "environment": "production",
    "error_code": "A17",
    "release_id": null
  },
  "extraction": {"confidence": 0.96, "evidence": ["Customers", "iOS", "A17"]}
}
```

The model response is validated against the ontology. A malformed response is retried once; a second validation failure produces an `unknown`/empty unclassified ticket while retaining the source email.

## Test

```bash
python3 -m unittest discover -s tests
```
