"""HTTP handlers for orders (plain dicts in, plain dicts out)."""
from shop.orders import service


def get_order(order_id: int) -> dict:
    o = service.get_order(order_id)
    return {"id": o.id, "status": o.status.value, "total_cents": o.total_cents}


def post_order(body: dict) -> dict:
    o = service.create_order(body["customer_id"], body.get("items", []), body["total_cents"])
    return {"id": o.id, "status": o.status.value}


def post_pay(order_id: int) -> dict:
    o = service.pay_order(order_id)
    return {"id": o.id, "status": o.status.value}
