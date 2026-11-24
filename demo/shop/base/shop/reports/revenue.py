"""Monthly revenue report built from gateway charges."""
from datetime import datetime

from shop.payments import gateway


def monthly_revenue(year: int, month: int) -> int:
    total = 0
    for c in gateway._LEDGER.values():
        d = datetime.fromtimestamp(c.created_at)
        if d.year == year and d.month == month:
            total += c.amount_cents
    return total


def average_ticket(year: int, month: int) -> int:
    n = sum(
        1
        for c in gateway._LEDGER.values()
        if datetime.fromtimestamp(c.created_at).month == month
    )
    return monthly_revenue(year, month) // n if n else 0
