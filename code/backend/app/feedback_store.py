"""Answer feedback — one thumbs up/down per reply, appended to a local JSONL log.

No database exists in this app beyond Qdrant (vectors only), so this follows
the same convention already used by resources/heartbeat-app/heartbeat-log.jsonl:
an append-only, gitignored JSONL file next to the code. Good enough for a
single-instance teaching app — the point is to close a loop this project
didn't have before (some place for "was this answer any good?" to go, and a
way to read it back — see GET /feedback and the Status admin view), not to
build a metrics warehouse.
"""
from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

LOG_PATH = Path(__file__).resolve().parent.parent / "feedback-log.jsonl"

_lock = threading.Lock()


def record(*, rating: str, question: str, answer: str, agent: str | None,
          mode: str | None, augmented: bool, model: str | None) -> dict:
    entry = {
        "id": str(uuid.uuid4()),
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "rating": rating,
        "question": question,
        "answer": answer,
        "agent": agent,
        "mode": mode,
        "augmented": augmented,
        "model": model,
    }
    with _lock:
        with LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    return entry


def recent(limit: int = 50) -> list[dict]:
    """Most recent first. Reads the whole file — fine at JSONL-of-feedback
    scale; a real deployment would want this in an actual database."""
    if not LOG_PATH.exists():
        return []
    with _lock:
        lines = LOG_PATH.read_text(encoding="utf-8").splitlines()
    entries = [json.loads(line) for line in lines if line.strip()]
    return list(reversed(entries))[:limit]
