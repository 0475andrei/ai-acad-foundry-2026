"""Plain amortization / compound-interest math — no model call, no external
service, just arithmetic. Exists because a fixed-rate loan question ("80,000
euros, 30 years, fixed rate — what's my payment?") has one exact right answer,
and an LLM reading retrieved passages is the wrong tool to compute it: these
functions are, so /tools/loan-payment etc. can hand back a real number instead
of a guess.
"""
from __future__ import annotations

import math


def loan_payment(principal: float, annual_rate_percent: float, years: float) -> dict:
    """Standard fixed-rate amortization: the monthly payment that pays off
    `principal` over `years`, given a fixed nominal annual rate."""
    months = round(years * 12)
    r = annual_rate_percent / 100 / 12
    if r == 0:
        payment = principal / months
    else:
        payment = principal * r / (1 - (1 + r) ** -months)
    total_paid = payment * months
    return {
        "monthly_payment": round(payment, 2),
        "months": months,
        "total_paid": round(total_paid, 2),
        "total_interest": round(total_paid - principal, 2),
    }


def loan_payoff(principal: float, annual_rate_percent: float, monthly_payment: float) -> dict:
    """The inverse of loan_payment: given what you can actually pay each month,
    how long until the loan is gone. Raises ValueError if the payment doesn't
    even cover the interest accruing each month — the loan would never end."""
    r = annual_rate_percent / 100 / 12
    if r == 0:
        months = math.ceil(principal / monthly_payment)
    else:
        if monthly_payment <= principal * r:
            raise ValueError(
                f"A payment of {monthly_payment:g} doesn't even cover the "
                f"{round(principal * r, 2):g} in interest accruing each month "
                "at this rate — the loan would never pay off."
            )
        months = math.ceil(-math.log(1 - (principal * r) / monthly_payment) / math.log(1 + r))
    total_paid = monthly_payment * months
    return {
        "months": months,
        "years": round(months / 12, 2),
        "total_paid": round(total_paid, 2),
        "total_interest": round(total_paid - principal, 2),
    }


def savings_growth(principal: float, annual_rate_percent: float, years: float,
                    monthly_contribution: float = 0) -> dict:
    """Compound growth of a starting deposit plus a fixed monthly contribution
    added at the end of each month, compounded monthly."""
    months = round(years * 12)
    r = annual_rate_percent / 100 / 12
    if r == 0:
        final_balance = principal + monthly_contribution * months
    else:
        fv_principal = principal * (1 + r) ** months
        fv_contributions = monthly_contribution * (((1 + r) ** months - 1) / r)
        final_balance = fv_principal + fv_contributions
    total_contributed = principal + monthly_contribution * months
    return {
        "final_balance": round(final_balance, 2),
        "total_contributed": round(total_contributed, 2),
        "total_interest": round(final_balance - total_contributed, 2),
    }
