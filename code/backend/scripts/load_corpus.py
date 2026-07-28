"""
Corpus loader for Libra Assist.

Walks data/, reads every Markdown document, strips its YAML front matter,
and POSTs it to the running RAG Teaching API's /ingest endpoint.

Usage:
    uv run python code/backend/scripts/load_corpus.py
    uv run python code/backend/scripts/load_corpus.py --strategy heading_aware
    uv run python code/backend/scripts/load_corpus.py --api http://localhost:7799

Requires the backend to be running (docker compose up, or uv run uvicorn ...).
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

import requests

# data/ lives two levels above this script: code/backend/scripts/ -> repo root
REPO_ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = REPO_ROOT / "data"

FRONT_MATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n(.*)$", re.DOTALL)


@dataclass
class Document:
    path: Path
    source: str
    metadata: dict
    text: str


def parse_front_matter(raw: str) -> tuple[dict, str]:
    """Split a Markdown file into its YAML front matter dict and body text.

    Deliberately dependency-free (no PyYAML requirement) since the front
    matter here is always flat `key: value` pairs.
    """
    match = FRONT_MATTER_RE.match(raw)
    if not match:
        return {}, raw.strip()

    header_block, body = match.groups()
    metadata: dict[str, str] = {}
    for line in header_block.splitlines():
        line = line.strip()
        if not line or ":" not in line:
            continue
        key, _, value = line.partition(":")
        metadata[key.strip()] = value.strip()

    return metadata, body.strip()


def load_documents() -> list[Document]:
    if not DATA_DIR.is_dir():
        sys.exit(f"No data/ directory found at {DATA_DIR}")

    docs = []
    for path in sorted(DATA_DIR.glob("*.md")):
        if path.name.upper() == "README.md".upper():
            continue  # not a corpus document
        raw = path.read_text(encoding="utf-8")
        metadata, body = parse_front_matter(raw)
        source = path.stem  # e.g. "cards-fees-2026"
        docs.append(Document(path=path, source=source, metadata=metadata, text=body))
    return docs


def ingest(doc: Document, api: str, strategy: str) -> None:
    payload = {
        "text": doc.text,
        "strategy": strategy,
        "source": doc.source,
        # Improvement #2 (real metadata): forwarded so the backend can store
        # title/product/effective/version in the vector payload once
        # /ingest and vectorstore.upsert() are updated to accept it.
        "metadata": doc.metadata,
    }
    resp = requests.post(f"{api}/ingest", json=payload, timeout=30)
    if resp.status_code >= 400:
        print(f"  FAILED ({resp.status_code}): {doc.source} -> {resp.text[:200]}")
    else:
        body = resp.json()
        chunks = body.get("chunks", body.get("chunk_count", "?"))
        print(f"  ok: {doc.source} ({chunks} chunks)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default="http://localhost:7799", help="Backend base URL")
    parser.add_argument("--strategy", default="dynamic", help="Chunking strategy to use")
    args = parser.parse_args()

    docs = load_documents()
    if not docs:
        sys.exit(f"No .md documents found in {DATA_DIR}")

    print(f"Ingesting {len(docs)} documents from {DATA_DIR} into {args.api} "
          f"(strategy={args.strategy})")
    for doc in docs:
        ingest(doc, api=args.api, strategy=args.strategy)

    print("Done.")


if __name__ == "__main__":
    main()
