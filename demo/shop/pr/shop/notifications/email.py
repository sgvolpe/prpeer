"""Transactional emails."""
from shop.orders.models import Order


def _send(to: str, subject: str, body: str) -> None:
    print(f"To: {to}\nSubject: {subject}\n\n{body}")


def send_receipt(to: str, order: Order) -> None:
    _send(to, f"Receipt for order {order.id}", f"Total: {order.total_cents / 100:.2f}")


def send_shipping(to: str, order: Order) -> None:
    _send(to, f"Order {order.id} is on its way", "Your order has shipped.")


def send_refund_notice(to: str, order: Order, amount_cents: int) -> None:
    _send(to, f"Refund for order {order.id}", f"We refunded {amount_cents / 100:.2f}.")
