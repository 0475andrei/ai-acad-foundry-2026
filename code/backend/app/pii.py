"""Personal-data redaction — a banking-specific guardrail, protecting the
customer's data rather than the assistant's behaviour (that's guardrails.py).

A retail-banking chat is exactly the place someone pastes a card number, an
IBAN, or a CNP (Romanian personal numeric code) while explaining their
question — and every one of those, once typed, is on its way to a
third-party LLM provider and into `prompt_sent`/logs unless something catches
it first. Detected values are redacted in place — replaced with a
`[REDACTED-<KIND>]` placeholder — *before* the question reaches embedding,
guardrail scanning, or the model itself; the model still sees enough to
answer ("what's your policy on card replacement") without ever seeing the
actual number.

Same philosophy as guardrails.py: report, don't fail silently. The redaction
is always visible in `prompt_sent` (it happens before that text is built), and
`AskResponse.pii` names what kind of thing was found — never the value itself.

Regex-based, not a classifier. The CNP check includes real structural
validation (century digit, YYMMDD, county code) and the card check requires a
passing Luhn checksum, specifically to keep the false-positive rate down on
otherwise very generic digit runs — a bank's own reference numbers are all
over these documents and questions. Not a guarantee: a card-shaped number that
happens to be a plain reference number and happens to pass Luhn will still be
redacted. Accepted trade-off for a zero-latency, zero-cost first layer, same
as the injection guardrails.
"""
from __future__ import annotations

import re

_CARD_RE = re.compile(r"\b\d(?:[ -]?\d){12,18}\b")
_CNP_RE = re.compile(r"\b\d{13}\b")
_IBAN_RE = re.compile(r"\bRO\d{2}[A-Z]{4}[A-Z0-9]{16}\b", re.I)
_EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")
_PHONE_RE = re.compile(r"\b(?:\+4?0|0)7\d{2}[ -]?\d{3}[ -]?\d{3}\b")


def _luhn_ok(digits: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def _cnp_ok(digits: str) -> bool:
    """Structural plausibility, not the full official checksum — enough to
    reject "13 random digits" while accepting anything actually shaped like a
    Romanian CNP (century digit, a real month/day, a real county code)."""
    if digits[0] not in "123456789":
        return False
    month, day, county = int(digits[3:5]), int(digits[5:7]), int(digits[7:9])
    return 1 <= month <= 12 and 1 <= day <= 31 and 1 <= county <= 52


def scan_and_redact(text: str) -> tuple[str, list[str]]:
    """Returns (text with any personal data replaced, the kinds that were found).
    Empty list means clean — nothing was touched, `text` is returned unchanged."""
    if not text:
        return text, []

    found: list[str] = []

    def _redact_card(m: re.Match) -> str:
        digits = re.sub(r"[ -]", "", m.group())
        if not (13 <= len(digits) <= 19) or not _luhn_ok(digits):
            return m.group()
        found.append("card-number")
        return "[REDACTED-CARD]"

    text = _CARD_RE.sub(_redact_card, text)

    def _redact_cnp(m: re.Match) -> str:
        if not _cnp_ok(m.group()):
            return m.group()
        found.append("cnp")
        return "[REDACTED-CNP]"

    text = _CNP_RE.sub(_redact_cnp, text)

    if _IBAN_RE.search(text):
        found.append("iban")
        text = _IBAN_RE.sub("[REDACTED-IBAN]", text)
    if _EMAIL_RE.search(text):
        found.append("email")
        text = _EMAIL_RE.sub("[REDACTED-EMAIL]", text)
    if _PHONE_RE.search(text):
        found.append("phone")
        text = _PHONE_RE.sub("[REDACTED-PHONE]", text)

    return text, found
