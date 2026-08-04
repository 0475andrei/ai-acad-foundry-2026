"""Contract key-fact extraction — PDF in, the practically important bits out.

A one-shot tool, not part of the RAG pipeline: a personal contract (credit,
employment, real estate, or anything else) is read, summarized, and returned —
never ingested into Qdrant, never mixed into the bank's shared knowledge base.
"""
from __future__ import annotations

import io
import json

from pypdf import PdfReader

# Keeps the extraction call small and fast. A long contract gets the first ~15k
# characters, which covers the operative clauses in the vast majority of real
# contracts — the rest is typically boilerplate/signature pages. Truncation is
# reported back, not hidden.
CHAR_CAP = 15000

SYSTEM_PROMPT = (
    "You extract the practically important facts from a contract (credit, employment, "
    "real estate, or any other legal agreement) written in dense, formal language, so a "
    "non-lawyer can see what actually matters at a glance. Read the contract text and "
    "return ONLY a JSON object with exactly these keys: "
    '"document_type" (a short guess, e.g. "credit", "employment", "real estate", "other"), '
    '"parties" (array of strings - who is bound by this contract), '
    '"duration" (string or null - the term/period, e.g. "30 years", "12 months", "indefinite"), '
    '"amounts" (array of strings - every sum, rate, or fee that matters, plainly stated), '
    '"key_obligations" (array of strings - what each party must actually do), '
    '"penalties" (array of strings - fees, penalties, or termination conditions), '
    '"warnings" (array of strings - anything unusual, one-sided, or worth a second look; '
    "empty array if nothing stands out). "
    "Never invent a fact that is not in the text - if a field genuinely isn't present, use "
    "an empty array or null. Write every value in the same language as the contract text. "
    "Return raw JSON only, no markdown fences, no commentary."
)


class PdfUnreadable(Exception):
    pass


def extract_text(data: bytes) -> tuple[str, bool]:
    """Returns (text, truncated). Raises PdfUnreadable if the bytes aren't a
    parseable PDF, or no text layer exists (e.g. a scanned image with no OCR)."""
    try:
        reader = PdfReader(io.BytesIO(data))
        pages = [page.extract_text() or "" for page in reader.pages]
    except Exception as e:
        raise PdfUnreadable(f"Could not read this file as a PDF: {e}")
    text = "\n\n".join(pages).strip()
    truncated = len(text) > CHAR_CAP
    return text[:CHAR_CAP], truncated


def parse_response(text: str) -> dict:
    """The model is asked for raw JSON; markdown fences are stripped defensively
    in case it adds them anyway. Raises ValueError (with the raw text attached)
    on anything unparsable, so the caller can surface something honest instead
    of a bare 500."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:]
        cleaned = cleaned.strip()
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as e:
        raise ValueError(f"The model's response wasn't valid JSON ({e}). Raw: {text[:300]!r}")
    return {
        "document_type": data.get("document_type") or "other",
        "parties": data.get("parties") or [],
        "duration": data.get("duration"),
        "amounts": data.get("amounts") or [],
        "key_obligations": data.get("key_obligations") or [],
        "penalties": data.get("penalties") or [],
        "warnings": data.get("warnings") or [],
    }
