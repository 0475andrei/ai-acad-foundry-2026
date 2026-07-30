# Libra Assist — presentation answers

## 0. Project description

Libra Assist is a RAG assistant for a fictional retail bank (Libra Bank): a FastAPI
backend over Qdrant vector search and Azure AI Foundry (gpt-5-mini + text-embedding-3-small),
with a React chat frontend. The problem it solves: customers and staff need fast,
accurate answers about mortgages, cards, deposits and current accounts, without waiting
on a branch — but a plain LLM will confidently invent a rate or fee it was never told,
which is unacceptable in banking.

Every answer is grounded in a small, deliberately-designed banking corpus, cited by
source, and built to refuse rather than invent when the answer genuinely isn't there.
Two agent modes exist (local execution, or the hosted Azure AI Foundry Agent Service),
and two personas ship — a general assistant and a product-comparison specialist —
selectable per request.

## 1. What did you build?

**Persona:** `andrei-dobrin-agent` ("Andrei's Product Specialist") — a retail banking
product-comparison specialist (`app/agents/personas/andrei-dobrin-agent.json`): lays every
relevant Libra Bank product side by side before recommending one, under 150 words, requires
citations, refuses when unsupported.

**Corpus:** 15 fictional Markdown documents in `data/`, covering mortgages, cards,
deposits, current accounts and complaints, deliberately including all 7 break-the-pipeline
cases from the assignment — an exact number, a two-document combination, near-duplicate
fee schedules (2025 vs 2026), a stepped procedure, a rate table, an LTV policy that changed
across a date, and deliberately-absent products (EUR mortgages, crypto, student loans).

**Interface:** React (Vite) console + FastAPI backend + Qdrant, on Azure AI Foundry.
Start with `docker compose up qdrant -d`, `az login`, then
`uv run uvicorn app.main:app --reload --port 7799` for the API and the console via
`npm run dev` or `scripts/dev.ps1`.

## 2. What did you measure, and what came out?

The golden set is `data/questions.md` — 15 questions in three groups (A · simple
retrieval, 7; B · multi-step, 5; C · must refuse, 3). Run 2026-07-29 against the
`default` persona, `use_rag=true`, `top_k=4`, azure/gpt-5-mini, on the live 50-point
collection: **13/15 fully correct, 2/15 partially correct, 0 wrong, zero hallucinations**
— every miss under-claimed rather than inventing a number.

Both partial misses (B5, C1) traced to one cause: `top_k=4` is too small once the right
passage isn't an obvious lexical match. Confirmed directly against `/search`: the correct
C1 document scored 0.3238 and ranked 5th, just below the top-4 cutoff at 0.3288.

I raised `top_k` to 6 afterward specifically to fix this, but never re-ran the 15
questions against it — so I have the diagnosis and the fix, not a verified "after" score.
Saying that plainly rather than estimating one.

## 3. Which parts are yours?

11 of this repo's 49 commits are mine (`git log --author="Andrei Liviu Dobrin"`),
2026-07-28 to 2026-07-30. Three most substantial:

1. **The corpus** — 15 retail-banking documents plus `data/README.md`, deliberately
   covering all 7 required cases, and the "Product Specialist" persona for comparing
   products instead of just answering from the first match.
2. **Ingestion and retrieval fixes** — `scripts/load_corpus.py` (ingests the whole corpus
   in one command), stable per-chunk ids in `vectorstore.py` (re-ingesting now replaces
   chunks instead of duplicating them), and real per-chunk metadata (title/product/
   audience/effective/version).
3. **The chat experience and its evaluation** — multi-turn history, conversation import/
   export/rename, a dark UI, voice input/output, and the golden 15-question set with
   recorded results.

A fourth, later batch added role-based UI, prompt-injection/PII guardrails, cross-lingual
retrieval, rate limiting, and answer feedback logging.

## 4. How did you use AI while building this?

I used Claude Code (Claude Sonnet 5, via its agent harness) as an active pair-programmer
for most of the backend and frontend work — not autocomplete. It read the existing
codebase, implemented whole new modules end-to-end from a plain-language description
(rate limiter, prompt-injection scanner, PII redactor, cross-lingual query translation,
thumbs-up/down feedback logging), wired them into FastAPI routes and the React chat UI,
and verified its own work by running the app's test client and curling the live local
backend rather than guessing — including reading real `/search` scores to diagnose why a
Romanian mortgage question wasn't retrieving the right document. It also declined a
destructive action on its own initiative (deleting the live Qdrant collection) until I
explicitly confirmed it, which I never actually did. This document was drafted with its
help, from the real repository state.

## 5. What is unfinished, broken, or would fail on a clean clone?

Being unkind on purpose: `NOTES.md`, which Part 4/5 explicitly require for a before/after
retrieval comparison, doesn't exist anywhere in this repo — I never wrote it. The golden
set's "after" score for the `top_k` fix was never re-run, so that improvement has a
diagnosis, not a number. A stray junk vector-store entry (`source: "retail-faq"`, plain
test text) is still polluting live retrieval; I found it and never deleted it. There is
no real backend authentication — the admin/user split is enforced only in the React UI,
and every API route, including wiping the whole collection, is reachable with no
credentials. The rate limiter is in-memory and per-process: it resets on restart and
wouldn't coordinate if this were ever scaled. Foundry (hosted) mode has no way to control
reasoning effort at all, unlike local mode. There are no automated tests — everything was
checked by hand, in conversation. A clean clone needs its own `.env`, an `az login`, and a
Foundry identity before the hosted lane or embeddings work at all.
