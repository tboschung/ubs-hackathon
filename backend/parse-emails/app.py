"""Small local web demo for creating internal tickets with Gemini."""

from __future__ import annotations

import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from email_parser import EmailMessage, EmailTicketParser


ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
PARSER = EmailTicketParser()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC), **kwargs)

    def do_POST(self) -> None:
        if self.path != "/api/tickets":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > 20_000:
                raise ValueError("Request is too large.")
            body = json.loads(self.rfile.read(length))
            email = EmailMessage(
                subject=str(body.get("subject", "")),
                body=str(body.get("body", "")),
                sender=str(body.get("sender", "")),
                email_id=str(body["email_id"]) if body.get("email_id") else None,
                received_at=str(body["received_at"]) if body.get("received_at") else None,
            )
            ticket, source = PARSER.parse_email_with_source(email)
            self._json(200, {"ticket": ticket.to_dict(), "source": source})
        except (ValueError, json.JSONDecodeError) as exc:
            self._json(400, {"error": str(exc)})
        except RuntimeError as exc:
            self._json(502, {"error": str(exc)})

    def _json(self, status: int, value: dict) -> None:
        data = json.dumps(value).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    address = ("127.0.0.1", 8000)
    print(f"Ticket demo running at http://{address[0]}:{address[1]}")
    ThreadingHTTPServer(address, Handler).serve_forever()
