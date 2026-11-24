"""Order workflows: create, pay, ship, cancel and refund."""
from shop.orders.models import Order, Status
from shop.payments import gateway, refunds

_ORDERS: dict[int, Order] = {}
_NEXT_ID = 1


def create_order(customer_id: int, items: list, total_cents: int) -> Order:
    global _NEXT_ID
    order = Order(id=_NEXT_ID, customer_id=customer_id, total_cents=total_cents, items=items)
    _ORDERS[order.id] = order
    _NEXT_ID += 1
    return order


def get_order(order_id: int) -> Order:
    return _ORDERS[order_id]


def pay_order(order_id: int) -> Order:
    order = get_order(order_id)
    if order.status != Status.PENDING:
        raise ValueError("only pending orders can be paid")
    gateway.charge(order.id, order.total_cents)
    order.status = Status.PAID
    return order


def ship_order(order_id: int) -> Order:
    order = get_order(order_id)
    if order.status != Status.PAID:
        raise ValueError("only paid orders can be shipped")
    order.status = Status.SHIPPED
    return order


def cancel_order(order_id: int) -> Order:
    order = get_order(order_id)
    if not order.can_cancel():
        raise ValueError("order can no longer be cancelled")
    if order.status == Status.PAID:
        refunds.refund_order_partial(order, order.total_cents, reason="cancelled")
    order.status = Status.CANCELLED
    return order


def refund_order(order_id: int, amount_cents: int, reason: str) -> dict:
    """Refund part of an order; the order keeps shipping state apart from the money."""
    order = get_order(order_id)
    receipt = refunds.refund_order_partial(order, amount_cents, reason)
    receipt["status"] = order.status.value
    return receipt
