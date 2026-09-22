"""Minimal Gemini structured-output client."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

from .models import CATEGORIES, URGENCIES, Ticket


SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string", "description": "Short, specific ticket title."},
        "description": {"type": "string", "description": "Clear summary without invented facts."},
        "category": {"type": "string", "enum": list(CATEGORIES)},
        "urgency": {"type": "string", "enum": list(URGENCIES)},
        "affected_system": {"type": "string", "description": "Application, device, or service; Unknown if absent."},
        "suggested_action": {"type": "string", "description": "Concise first action for support."},
    },
    "required": ["title", "description", "category", "urgency", "affected_system", "suggested_action"],
    "additionalProperties": False,
}


class GeminiTicketGenerator:
    def __init__(self, key_path: Path | None = None, model: str = "gemini-3.1-flash-lite"):
        self.key_path = key_path or Path(__file__).resolve().parents[3] / "assets" / "gemini_key.txt"
        self.model = model

    def generate(self, text: str) -> Ticket:
        key = os.getenv("GEMINI_API_KEY", "").strip()
        if not key:
            try:
                key = self.key_path.read_text(encoding="utf-8").strip()
            except OSError as exc:
                raise RuntimeError(f"Could not read Gemini key from {self.key_path}.") from exc
        if not key:
            raise RuntimeError("The Gemini API key is empty.")

        endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        payload = {
            "contents": [{"parts": [{"text": "Convert this internal support email into a concise ticket. Do not invent facts.\n\n" + text}]}],
            "generationConfig": {"responseMimeType": "application/json", "responseJsonSchema": SCHEMA, "temperature": 0.1},
        }
        result = self._post(endpoint, key, payload)
        try:
            content = result["candidates"][0]["content"]["parts"][0]["text"]
            return Ticket.from_dict(json.loads(content))
        except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
            raise RuntimeError("Gemini returned an unreadable response.") from exc

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
                completed = subprocess.run(
                    ["curl", "--fail-with-body", "--silent", "--show-error", "--max-time", "30", "-H", "Content-Type: application/json", "-H", f"x-goog-api-key: {key}", "--data-binary", "@-", endpoint],
                    input=json.dumps(payload), text=True, capture_output=True, timeout=35, check=False,
                )
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
