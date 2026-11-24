"""HTTP handlers for orders (plain dicts in, plain dicts out)."""
from shop.orders import service
from shop.payments import refunds


def get_order(order_id: int) -> dict:
    o = service.get_order(order_id)
    return {
        "id": o.id,
        "status": o.status.value,
        "total_cents": o.total_cents,
        "refunded_cents": o.refunded_cents,
    }


def post_order(body: dict) -> dict:
    o = service.create_order(body["customer_id"], body.get("items", []), body["total_cents"])
    return {"id": o.id, "status": o.status.value}


def post_pay(order_id: int) -> dict:
    o = service.pay_order(order_id)
    return {"id": o.id, "status": o.status.value}


def post_refund(order_id: int, body: dict) -> dict:
    """POST /orders/<id>/refund with {"amount_cents": int, "reason": str}."""
    try:
        return service.refund_order(order_id, body["amount_cents"], body.get("reason", "other"))
    except refunds.RefundError as e:
        return {"error": str(e)}
