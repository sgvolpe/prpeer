"""Order model and status machine."""
from dataclasses import dataclass, field
from enum import Enum


class Status(str, Enum):
    PENDING = "pending"
    PAID = "paid"
    SHIPPED = "shipped"
    CANCELLED = "cancelled"
    PARTIALLY_REFUNDED = "partially_refunded"
    REFUNDED = "refunded"


@dataclass
class Order:
    id: int
    customer_id: int
    total_cents: int
    status: Status = Status.PENDING
    items: list = field(default_factory=list)
    refunded_cents: int = 0

    def can_cancel(self) -> bool:
        return self.status in (Status.PENDING, Status.PAID)

    def can_refund(self) -> bool:
        return self.status in (Status.PAID, Status.SHIPPED, Status.PARTIALLY_REFUNDED)
