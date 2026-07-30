"""Cross-lingual retrieval — translate the *search query* only, never the answer.

The embedding model compares a query's vector against documents that are
English-only in this corpus. A question asked in Romanian (or anything else)
can score every passage low enough that an unrelated chunk out-ranks the one
that actually answers it — not because retrieval is broken, but because
cosine similarity between a Romanian sentence and an English paragraph is
just a weaker signal than English-to-English. Translating the query before
embedding restores that signal; the original question is untouched and still
goes to the model for the actual answer (see persona.py's language rule),
so the customer's own words are what gets responded to, in their language.

Dependency-free on purpose, matching guardrails.py and ratelimit.py: a small
keyword/diacritic heuristic decides whether the extra LLM call is worth it at
all, rather than translating every single query (most of this app's traffic
is expected to be English, and that call is not free).
"""
from __future__ import annotations

import re

from .llm import get_llm, reasoning_extras

# Diacritics are the strong signal when present, but Romanian is very often
# typed without them — the exact case that motivated this module (see the
# actual question that surfaced the bug: "80 de mii de euro pe 30 de ani si
# dobanda fixa" carries zero diacritics). So this also matches common
# function words that are vanishingly rare as standalone words in English.
_NON_ENGLISH_MARKERS = re.compile(
    r"[ăâîșşțţ]|"
    r"\b(de|pe|și|si|cu|la|un|o|ce|cum|sunt|este|din|pentru|ani|dobând[ăa]|dobanda|"
    r"credit|dup[ăa]|dupa|vreau|aș|as|dori|mulțumesc|multumesc|salut|bun[ăa]|"
    r"puteți|puteti|câți|cati|cât|cat|ce|nu|da)\b",
    re.I,
)


def looks_non_english(text: str) -> bool:
    """Two or more matches, not one — a single short word could be a false
    positive (an English sentence can contain a stray "o" or "un" as an
    abbreviation); two is a much stronger signal without needing a real
    language-detection dependency."""
    return len(_NON_ENGLISH_MARKERS.findall(text)) >= 2


_TRANSLATE_SYSTEM = (
    "Translate the user's message into English, for use as a document-search query "
    "only. Keep it short and literal, preserving the key nouns and numbers — this is "
    "a search query, not a sentence to polish or answer. If it is already in English, "
    "repeat it unchanged. Reply with the query text alone: no quotes, no preamble, "
    "no explanation."
)


def translate_for_retrieval(question: str) -> str:
    """Best-effort — a translation hiccup must never block retrieval, so any
    failure just falls back to searching with the original text."""
    if not looks_non_english(question):
        return question
    try:
        llm = get_llm()
        result = llm.chat(system=_TRANSLATE_SYSTEM, user=question, temperature=0.0,
                          max_tokens=120, extras=reasoning_extras(llm.model))
        translated = result.text.strip().strip('"')
        return translated or question
    except Exception:
        return question
