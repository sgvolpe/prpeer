"""Order model and status machine."""
from dataclasses import dataclass, field
from enum import Enum


class Status(str, Enum):
    PENDING = "pending"
    PAID = "paid"
    SHIPPED = "shipped"
    CANCELLED = "cancelled"


@dataclass
class Order:
    id: int
    customer_id: int
    total_cents: int
    status: Status = Status.PENDING
    items: list = field(default_factory=list)

    def can_cancel(self) -> bool:
        return self.status in (Status.PENDING, Status.PAID)
