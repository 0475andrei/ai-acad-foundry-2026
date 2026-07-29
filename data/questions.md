# Libra Assist — Golden Question Set (15)

Run against the `default` persona, `use_rag: true`, `top_k: 4`, provider `azure` /
`gpt-5-mini`, on 2026-07-29 against the live 50-point `libra_rag` collection. Every
answer below is copy-pasted from the real `/ask` response — nothing here is invented
or "what it should say."

**Score:** 13 / 15 fully correct, 2 / 15 partially correct (both honest, both explained).
No hallucinations anywhere in the set — every wrong or incomplete answer under-claimed
rather than inventing a number.

---

## A · Simple retrieval (7)

### A1. What fee does Libra Bank charge for early mortgage repayment during the fixed-rate period?
**Expected:** 1% of the amount repaid early. **Source:** `mortgages-early-repayment.md`
**Assistant:** "Libra Bank charges an early repayment fee of 1% of the amount repaid early
during the fixed-rate period... the first 5 years of a Libra Fixed Mortgage..."
**Verdict:** ✅ Correct.

### A2. How many consecutive failed PIN attempts cause a Libra Bank card to be blocked automatically?
**Expected:** Three. **Source:** `cards-blocking-procedure.md`
**Assistant:** "A Libra Bank card is blocked automatically after three consecutive failed
PIN attempts... whether the failures occur at an ATM, a POS terminal, or during online
verification."
**Verdict:** ✅ Correct.

### A3. What is the current annual interest rate for a 12-month Libra Fixed Deposit?
**Expected:** 4.7%. **Source:** `deposits-interest-rates.md`
**Assistant:** "The current annual interest rate for a 12-month Libra Fixed Deposit is
4.7% per annum (rates effective 1 February 2026)... locked for the full term at the rate
in effect on the day the deposit is opened."
**Verdict:** ✅ Correct.

### A4. What is the monthly maintenance fee for a Libra Current Account if I don't receive my salary into it or keep a 1,000 RON balance?
**Expected:** 9 RON/month. **Source:** `current-account-overview.md`
**Assistant:** "The monthly maintenance fee is 9 RON if you do not receive your salary
into the account and do not maintain the minimum balance of 1,000 RON."
**Verdict:** ✅ Correct.

### A5. What is the minimum net monthly household income required to apply for a Libra Bank mortgage?
**Expected:** 4,000 RON. **Source:** `mortgages-eligibility.md`
**Assistant:** "The minimum documented net monthly household income required to apply is
4,000 RON... applicants must also pass Libra Bank's debt-to-income assessment (≤45% of
net household income)."
**Verdict:** ✅ Correct. (Retrieval also pulled in `cards-eligibility.md` and
`mortgages-ltv-limit-changes.md` as noise — didn't affect the answer, but is exactly the
kind of near-miss a metadata/product filter in Part 5 would clean up.)

### A6. Within how many business days does Libra Bank acknowledge a new customer complaint?
**Expected:** 2 business days. **Source:** `customer-complaints-procedure.md`
**Assistant:** "Libra Bank sends a written acknowledgement of a new customer complaint
within 2 business days... includes a reference number the customer can use to track the
complaint."
**Verdict:** ✅ Correct.

### A7. What is the annual fee for a Libra Credit Gold card under the current fee schedule?
**Expected:** 250 RON. **Source:** `cards-fees-2026.md`
**Assistant:** "The annual fee for a Libra Credit Gold card under the current fee
schedule (effective 1 January 2026) is 250 RON."
**Verdict:** ✅ Correct.

---

## B · Multi-step (5)

### B1. I have a Libra Fixed Mortgage still in its fixed-rate period and want to repay 50,000 RON early. How much will the early repayment fee cost, and would it be different if I were already in the variable-rate period?
*Hard because: retrieval, then arithmetic, then a second conditional case.*
**Expected:** 1% × 50,000 = 500 RON in the fixed-rate period; 0 RON in the variable-rate
period. **Source:** `mortgages-early-repayment.md`
**Assistant:** "...the early repayment fee is 1% of the amount repaid — 1% × 50,000 RON =
500 RON. If you were already in the variable-rate period, no early repayment fee
applies, so the fee would be 0 RON."
**Verdict:** ✅ Correct — right number, right arithmetic, right conditional.

### B2. What is the foreign transaction fee on a Libra Credit Gold card, and has it changed recently?
*Hard because: two near-duplicate documents (2025 vs 2026 fee schedules) must be told apart.*
**Expected:** 0.5% now, reduced from 1% on 1 Jan 2026. **Source:** `cards-fees-2026.md` +
`cards-fees-2025.md`
**Assistant:** "The foreign transaction fee on the Libra Credit Gold card is 0.5%
(effective 1 January 2026)... reduced from 1% to 0.5% as a promotional benefit for
premium cardholders."
**Verdict:** ✅ Correct — resolved the near-duplicate correctly, cited both years.

### B3. What is the maximum loan-to-value for a primary residence mortgage today, and was it always that number?
*Hard because: current value and its history live in different documents, one
explicitly superseding the other.*
**Expected:** 85% today (from 15 Jan 2026); 80% before that. **Source:**
`mortgages-ltv-limit-changes.md` + `mortgages-overview.md`
**Assistant:** "...today is 85% (i.e., a minimum 15% down payment), effective 15 January
2026... It was not always 85% — prior to 15 January 2026 the maximum LTV... was 80%
(20% down)."
**Verdict:** ✅ Correct — used the more-authoritative, dated document rather than the
general overview.

### B4. If I take a Libra Fixed Mortgage for 200,000 RON, what interest rate applies in the first 5 years, and what would the arrangement fee be?
*Hard because: retrieval, then a percentage calculation, then a floor comparison
(0.5% vs the 500 RON minimum).*
**Expected:** 6.2%; arrangement fee = 0.5% × 200,000 = 1,000 RON (above the 500 RON
minimum, so 1,000 RON applies). **Source:** `mortgages-rates-and-fees.md`
**Assistant:** "...a fixed interest rate of 6.2% for the first 5 years... The arrangement
fee is 0.5% of the loan amount (minimum 500 RON). For a 200,000 RON loan that equals
0.005 × 200,000 = 1,000 RON, which is above the minimum."
**Verdict:** ✅ Correct — got the floor comparison right, not just the multiplication.

### B5. If I withdraw my full Libra Fixed Deposit before maturity, do I get the accrued interest? Would it be different for a Libra Flexible Deposit?
*Hard because: two products' early-withdrawal rules, both in the same document,
must be told apart.*
**Expected:** Fixed Deposit — no, forfeits all accrued interest for the term, principal
only. Flexible Deposit — yes, a full withdrawal closes the deposit and pays out interest
accrued to date at the Flexible rate. **Source:** `deposits-terms-and-conditions.md`
**Assistant:** Got the Fixed Deposit half right ("forfeit the accrued interest for that
term"), but on the Flexible Deposit half it said: "the retrieved passages do not state
the bank's policy for a full early withdrawal of a Flexible Deposit... To answer that I
need the Flexible Deposit early-termination clause."
**Verdict:** ⚠️ Partially correct. The Fixed Deposit answer is right. The Flexible
Deposit answer is honestly incomplete rather than invented — no hallucination — but the
fact genuinely is in the corpus and retrieval didn't surface it: `top_k=4` across three
retrieved documents left too little room for the specific paragraph (chunk index 2 of
`deposits-terms-and-conditions.md`) that states it. This is the same category of miss as
C1 below — see NOTES.md for the fix.

---

## C · Must refuse (3)

### C1. What is the interest rate on your student loans?
**Expected:** Libra Bank does not offer student loans at all (directs customers to
Personal Loan or external programs) — the correct refusal names the actual reason, not
just "no number found." **Source:** `cards-corporate-not-offered.md`
**Assistant:** "The retrieved documents don't contain any information about student loan
interest rates — they only show deposit rates and mortgage rates/fees... Please provide
the student-loan product name or the current rate bulletin..."
**Verdict:** ⚠️ Partially correct — and the most useful failure in this set. No number
was invented (good), but the assistant never found the one document that actually
answers the question, so it asked the user for a rate sheet that will never exist
instead of saying "we don't offer that." Checked directly against `/search` at
`top_k=10`: `cards-corporate-not-offered` scores **0.3238** for this query and ranks
**5th** — just below the `top_k=4` cutoff (4th place: 0.3288). Every score in this
query is low (0.29–0.41) because "interest rate on student loans" shares almost no
vocabulary with "Libra Bank does not offer dedicated student loan products." A score
threshold alone wouldn't fix this (nothing crosses a high bar); what would: raising
`top_k` to 5–6 for this corpus size, or query rewriting (Part 5, #4) so "interest rate
on X" becomes "does Libra Bank offer X."

### C2. Can I open a mortgage denominated in EUR instead of RON?
**Expected:** No — Libra Bank mortgages are RON-only. **Source:**
`cards-corporate-not-offered.md`
**Assistant:** "No. All Libra Bank mortgages are issued in RON only; the bank does not
offer EUR- or USD-denominated mortgage loans to retail customers."
**Verdict:** ✅ Correct — refused the premise and named the actual policy, citing the
right document.

### C3. Do you support cryptocurrency wallets or crypto trading accounts?
**Expected:** No — not offered. **Source:** `cards-corporate-not-offered.md`
**Assistant:** "No. Libra Bank does not provide custody, trading, or accounts
denominated in cryptocurrency."
**Verdict:** ✅ Correct.

---

## Summary

| Group | Correct | Partial | Wrong |
|---|---|---|---|
| A · simple retrieval (7) | 7 | 0 | 0 |
| B · multi-step (5) | 4 | 1 | 0 |
| C · must refuse (3) | 2 | 1 | 0 |
| **Total (15)** | **13** | **2** | **0** |

The two partial scores (B5, C1) share one root cause, not two: `top_k=4` is too small
once the right passage isn't an obvious lexical match for the question. Both failures
were *safe* — the assistant under-claimed instead of inventing a fee or a policy — which
is the behavior `refuse_when_unsupported` is meant to produce. The fix belongs in Part 5
(retrieval), not in the persona.
