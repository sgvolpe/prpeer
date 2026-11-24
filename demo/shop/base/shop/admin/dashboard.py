"""Back-office dashboard numbers."""
from shop.orders.models import Order


def orders_by_status(orders: list[Order]) -> dict[str, int]:
    counts = {"pending": 0, "paid": 0, "shipped": 0, "cancelled": 0}
    for o in orders:
        counts[o.status.value] += 1
    return counts
