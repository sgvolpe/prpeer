"""Partial refunds on top of the payment gateway: validation, tax split and bookkeeping."""
from shop.orders.models import Order, Status
from shop.payments import gateway

TAX_RATE = 0.21
MAX_REFUNDS_PER_ORDER = 5
REASONS = ("cancelled", "damaged", "not_as_described", "other")


class RefundError(Exception):
    """The payment refund was rejected."""


def refundable_cents(order: Order) -> int:
    """How much of the payment can still be refunded."""
    return order.total_cents - order.refunded_cents


def validate_refund(order: Order, amount_cents: int, reason: str) -> None:
    """Reject refunds that cannot be sent to the payment gateway."""
    if not order.can_refund():
        raise RefundError(f"order {order.id} is {order.status.value}")
    if reason not in REASONS:
        raise RefundError(f"unknown reason: {reason}")
    if amount_cents <= 0:
        raise RefundError("amount must be positive")
    if amount_cents > refundable_cents(order):
        raise RefundError("amount exceeds what is left to refund")
    if len(gateway_refunds(order)) >= MAX_REFUNDS_PER_ORDER:
        raise RefundError("too many refunds for this order")


def gateway_refunds(order: Order) -> list:
    """Refunds the gateway already holds for this order's charges."""
    out = []
    for c in gateway.charges_for(order.id):
        out.extend(gateway.refunds_for(c.id))
    return out


def split_tax(amount_cents: int) -> tuple[int, int]:
    """Split a refund into net amount and tax, rounding in the customer's favour."""
    net = round(amount_cents / (1 + TAX_RATE))
    return net, amount_cents - net


def issue_refund(order: Order, amount_cents: int, reason: str):
    """Validate, send the refund to the payment gateway and update the order."""
    validate_refund(order, amount_cents, reason)
    charges = gateway.charges_for(order.id)
    if not charges:
        raise RefundError("order has no payment to refund")
    refund = gateway.refund(charges[-1].id, amount_cents, reason)
    order.refunded_cents += amount_cents
    order.status = Status.REFUNDED if refundable_cents(order) == 0 else Status.PARTIALLY_REFUNDED
    return refund


def refund_order_partial(order: Order, amount_cents: int, reason: str = "other"):
    """Refund part of an order and return the receipt data."""
    refund = issue_refund(order, amount_cents, reason)
    net, tax = split_tax(amount_cents)
    return {
        "refund_id": refund.id,
        "amount_cents": amount_cents,
        "net_cents": net,
        "tax_cents": tax,
        "left_cents": refundable_cents(order),
    }


def refund_summary(order: Order) -> dict:
    """Totals shown in the back office for an order's refunds."""
    refunds = gateway_refunds(order)
    return {
        "count": len(refunds),
        "refunded_cents": order.refunded_cents,
        "left_cents": refundable_cents(order),
        "reasons": sorted({r.reason for r in refunds}),
    }
