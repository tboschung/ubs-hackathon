#!/usr/bin/env python3
"""Build the static ChatGPT Sites bundle from the ontology demo."""

from pathlib import Path
import shutil


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "app" / "static" / "ontology"
DIST = ROOT / "dist"


def main() -> None:
    shutil.copytree(SOURCE, DIST, dirs_exist_ok=True)
    print(f"Built {DIST.relative_to(ROOT)}/ from {SOURCE.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
