"""Payment gateway client: charges cards and reports the result."""
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


_LEDGER: dict[str, Charge] = {}


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
