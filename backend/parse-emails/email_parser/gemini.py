"""Minimal Gemini client constrained to the ticket intelligence ontology."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

from .models import (ACTOR_IDS, CHANNELS, EDGE_IDS, ENVIRONMENTS, PLATFORM_IDS, REGIONS, RELATIONSHIP_TYPES, SERVER_IDS, SUPPLIER_IDS, SYMPTOMS, Extraction, OntologyValues, Ticket)


def _array(values: tuple[str, ...]) -> dict:
    return {"type": "array", "items": {"type": "string", "enum": list(values)}}


EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string", "description": "One short factual summary without invented details."},
        "ontology_values": {
            "type": "object",
            "properties": {
                "actor_ids": _array(ACTOR_IDS), "platform_ids": _array(PLATFORM_IDS), "server_ids": _array(SERVER_IDS),
                "supplier_ids": _array(SUPPLIER_IDS), "edge_ids": _array(EDGE_IDS), "relationship_types": _array(RELATIONSHIP_TYPES),
                "primary_affected_node_id": {"anyOf": [{"type": "string", "enum": list(ACTOR_IDS + PLATFORM_IDS + SERVER_IDS)}, {"type": "null"}]},
                "symptom": {"type": "string", "enum": list(SYMPTOMS)}, "region": {"type": "string", "enum": list(REGIONS)},
                "channel": {"type": "string", "enum": list(CHANNELS)}, "environment": {"type": "string", "enum": list(ENVIRONMENTS)},
                "error_code": {"anyOf": [{"type": "string"}, {"type": "null"}]}, "release_id": {"anyOf": [{"type": "string"}, {"type": "null"}]},
            },
            "required": list(OntologyValues.__annotations__), "additionalProperties": False,
        },
        "extraction": {"type": "object", "properties": {"confidence": {"type": "number", "minimum": 0, "maximum": 1}, "evidence": {"type": "array", "items": {"type": "string"}}}, "required": ["confidence", "evidence"], "additionalProperties": False},
    },
    "required": ["summary", "ontology_values", "extraction"], "additionalProperties": False,
}

ONTOLOGY_PROMPT = """Extract an ontology-backed ticket from the email below.
Use only values allowed by the JSON schema. Map aliases by meaning (for example customer -> actor:user, CRM -> platform:crm).
Only include nodes, edges, and relationships supported by the email. Use unknown, null, or [] when absent.
supplier_ids contains actor:supplier only when the supplier role is relevant; actor_ids may also include that same node.
Evidence must contain short verbatim fragments from the email. Do not assess criticality or create clusters.

EMAIL:
"""


class GeminiTicketGenerator:
    def __init__(self, key_path: Path | None = None, model: str = "gemini-3.1-flash-lite"):
        self.key_path = key_path or Path(__file__).resolve().parents[3] / "assets" / "gemini_key.txt"
        self.model = model

    def generate(self, text: str, *, ticket_id: str, email_id: str, received_at: str) -> Ticket:
        key = self._key()
        endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        payload = {"contents": [{"parts": [{"text": ONTOLOGY_PROMPT + text}]}], "generationConfig": {"responseMimeType": "application/json", "responseJsonSchema": EXTRACTION_SCHEMA, "temperature": 0.1}}
        for _attempt in range(2):
            result = self._post(endpoint, key, payload)
            try:
                content = result["candidates"][0]["content"]["parts"][0]["text"]
                extracted = json.loads(content)
                return Ticket.from_dict({"id": ticket_id, "email_id": email_id, "received_at": received_at, "raw_email": text, "summary": extracted["summary"], "ontology_values": extracted["ontology_values"], "extraction": extracted["extraction"]})
            except (KeyError, IndexError, TypeError, json.JSONDecodeError, ValueError):
                continue
        return Ticket(ticket_id, email_id, received_at, text, "Unclassified email", OntologyValues.unclassified(), Extraction(0.0, []))

    def _key(self) -> str:
        key = os.getenv("GEMINI_API_KEY", "").strip()
        if not key:
            try:
                key = self.key_path.read_text(encoding="utf-8").strip()
            except OSError as exc:
                raise RuntimeError(f"Could not read Gemini key from {self.key_path}.") from exc
        if not key:
            raise RuntimeError("The Gemini API key is empty.")
        return key

    @staticmethod
    def _post(endpoint: str, key: str, payload: dict) -> dict:
        request = urllib.request.Request(endpoint, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json", "x-goog-api-key": key}, method="POST")
        try:
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    return json.load(response)
            except urllib.error.URLError as exc:
                if "CERTIFICATE_VERIFY_FAILED" not in str(exc) or not shutil.which("curl"):
                    raise
                completed = subprocess.run(["curl", "--fail-with-body", "--silent", "--show-error", "--max-time", "30", "-H", "Content-Type: application/json", "-H", f"x-goog-api-key: {key}", "--data-binary", "@-", endpoint], input=json.dumps(payload), text=True, capture_output=True, timeout=35, check=False)
                if completed.returncode:
                    raise RuntimeError(_api_error(completed.stdout or completed.stderr))
                return json.loads(completed.stdout)
        except urllib.error.HTTPError as exc:
            raise RuntimeError(_api_error(exc.read().decode(errors="replace"))) from exc
        except urllib.error.URLError as exc:
            raise RuntimeError("Could not connect to Gemini. Check your internet connection.") from exc


def _api_error(raw: str) -> str:
    try:
        return json.loads(raw)["error"]["message"]
    except (KeyError, TypeError, json.JSONDecodeError):
        return raw.strip() or "Gemini rejected the request."
