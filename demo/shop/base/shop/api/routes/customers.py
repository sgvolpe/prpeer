"""HTTP handlers for customers."""
from shop.orders import service


def customer_orders(customer_id: int) -> list[dict]:
    return [
        {"id": o.id, "status": o.status.value}
        for o in service._ORDERS.values()
        if o.customer_id == customer_id
    ]
