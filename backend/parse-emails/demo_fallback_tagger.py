#!/usr/bin/env python3
"""Run the offline rule-based tagger over the example emails - no API calls.

Usage:
    python3 demo_fallback_tagger.py [path/to/emails.txt]

Defaults to ../ubs_error_email_examples.txt. Each numbered entry ("1.", "2.",
...) in the file is treated as one email body.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from email_parser import RuleBasedTicketGenerator

DEFAULT_EXAMPLES = Path(__file__).resolve().parents[1] / "ubs_error_email_examples.txt"
_ENTRY_RE = re.compile(r"^\d+\.$")


def load_examples(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    blocks = re.split(r"\n\s*\n", text.strip())
    examples = []
    for block in blocks:
        lines = block.strip().splitlines()
        if lines and _ENTRY_RE.match(lines[0].strip()):
            body = " ".join(line.strip() for line in lines[1:]).strip()
            if body:
                examples.append(body)
    return examples


def main() -> None:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_EXAMPLES
    examples = load_examples(path)
    if not examples:
        raise SystemExit(f"No numbered email entries found in {path}")

    generator = RuleBasedTicketGenerator()
    for index, body in enumerate(examples, start=1):
        email_id = f"EMAIL-{uuid4().hex[:8].upper()}"
        ticket = generator.generate(
            body,
            ticket_id=email_id.replace("EMAIL-", "TCK-", 1),
            email_id=email_id,
            received_at=datetime.now(timezone.utc).isoformat(),
        )
        print(f"--- Example {index} ---")
        print(body)
        print(json.dumps(ticket.to_dict(), indent=2))
        print()


if __name__ == "__main__":
    main()
