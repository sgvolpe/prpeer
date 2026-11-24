"""Payment gateway client: charges cards, issues refunds and reports the result."""
import time
from dataclasses import dataclass

API_URL = "https://api.pagos.example/v2"


@dataclass
class Charge:
    id: str
    order_id: int
    amount_cents: int
    currency: str
    created_at: float


@dataclass
class Refund:
    id: str
    charge_id: str
    amount_cents: int
    reason: str
    created_at: float


_LEDGER: dict[str, Charge] = {}
_REFUNDS: dict[str, Refund] = {}


def charge(order_id: int, amount_cents: int, currency: str = "USD") -> Charge:
    """Charge the customer's card for an order (payment capture)."""
    if amount_cents <= 0:
        raise ValueError("amount must be positive")
    now = time.time()
    c = Charge(
        id=f"ch_{order_id}_{int(now)}",
        order_id=order_id,
        amount_cents=amount_cents,
        currency=currency,
        created_at=now,
    )
    _LEDGER[c.id] = c
    return c


def get_charge(charge_id: str) -> Charge:
    """Look up a previous charge."""
    return _LEDGER[charge_id]


def charges_for(order_id: int) -> list[Charge]:
    """Every charge made for an order."""
    return [c for c in _LEDGER.values() if c.order_id == order_id]


def refund(charge_id: str, amount_cents: int, reason: str) -> Refund:
    """Send a refund for part (or all) of a payment back to the card."""
    c = get_charge(charge_id)
    if amount_cents <= 0:
        raise ValueError("refund amount must be positive")
    if amount_cents > c.amount_cents - refunded_cents(charge_id):
        raise ValueError("refund exceeds the charged amount")
    now = time.time()
    r = Refund(
        id=f"re_{charge_id}_{len(_REFUNDS) + 1}",
        charge_id=charge_id,
        amount_cents=amount_cents,
        reason=reason,
        created_at=now,
    )
    _REFUNDS[r.id] = r
    return r


def refunds_for(charge_id: str) -> list[Refund]:
    """Every refund already sent for a charge."""
    return [r for r in _REFUNDS.values() if r.charge_id == charge_id]


def refunded_cents(charge_id: str) -> int:
    """Total already refunded on a charge."""
    return sum(r.amount_cents for r in refunds_for(charge_id))


def net_charged(order_id: int) -> int:
    """What the customer actually paid for an order after refunds."""
    return sum(c.amount_cents - refunded_cents(c.id) for c in charges_for(order_id))
