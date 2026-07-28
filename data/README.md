# Libra Assist Corpus — Retail Banking (Libra Bank)

Fictional retail banking knowledge base for Libra Assist (Assignment 3).
Domain: cards, mortgages, deposits, plus current accounts and general
policies. All entities, products, rates, and fees are invented for this
exercise — no real Libra Bank data.

## Documents (15)

| File | Product | Covers |
|---|---|---|
| `cards-overview.md` | cards | General product info |
| `cards-eligibility.md` | cards | Eligibility criteria |
| `cards-fees-2025.md` | cards | Old fee schedule (superseded) |
| `cards-fees-2026.md` | cards | Current fee schedule |
| `cards-blocking-procedure.md` | cards | Block/unblock procedure |
| `cards-corporate-not-offered.md` | general | Products not offered |
| `mortgages-overview.md` | mortgages | General product info |
| `mortgages-eligibility.md` | mortgages | Eligibility criteria |
| `mortgages-rates-and-fees.md` | mortgages | Current rates/fees |
| `mortgages-early-repayment.md` | mortgages | Early repayment terms |
| `mortgages-ltv-limit-changes.md` | mortgages | LTV policy change history |
| `deposits-overview.md` | deposits | General product info |
| `deposits-interest-rates.md` | deposits | Current interest rates |
| `deposits-terms-and-conditions.md` | deposits | Opening/renewal/withdrawal rules |
| `current-account-overview.md` | current-accounts | Base account info |
| `customer-complaints-procedure.md` | general | Complaints handling procedure |

*(16 files listed above — README plus 15 content documents, within the
12-25 range.)*

## Mapping to the 7 required corpus cases

| Case | Document(s) | Example question it enables |
|---|---|---|
| **A precise number** | `mortgages-early-repayment.md` | "What is the early repayment fee during the fixed-rate period?" (answer: 1%) |
| **Two documents that must be combined** | `mortgages-eligibility.md` + `mortgages-rates-and-fees.md` (also `cards-eligibility.md` + `cards-fees-2026.md`) | "I qualify for a mortgage — what rate and fees would I actually pay?" |
| **Near-duplicates that differ** | `cards-fees-2025.md` vs `cards-fees-2026.md` | "What's the foreign transaction fee on Libra Credit Gold?" (differs by year: 1% vs 0.5%) |
| **A long procedure with steps** | `cards-blocking-procedure.md`, `customer-complaints-procedure.md` | "How do I report a stolen card?" |
| **A table** | `cards-fees-2026.md`, `mortgages-rates-and-fees.md`, `deposits-interest-rates.md` | "What's the 12-month Fixed Deposit rate?" |
| **Contradiction across versions** | `mortgages-ltv-limit-changes.md` (vs the older limit stated in `mortgages-overview.md`) | "What's the max LTV for a primary residence?" (80% before 15 Jan 2026, 85% after) |
| **Something deliberately absent** | `cards-corporate-not-offered.md` | "What's the interest rate on your student loans?" (not offered) |

All seven cases are covered (the assignment requires at least five).
