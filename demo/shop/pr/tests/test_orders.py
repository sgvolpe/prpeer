import pytest

from shop.orders import service
from shop.orders.models import Status


def test_pay_then_ship():
    o = service.create_order(1, [], 5000)
    service.pay_order(o.id)
    assert service.ship_order(o.id).status == Status.SHIPPED


def test_cannot_ship_unpaid():
    o = service.create_order(1, [], 5000)
    with pytest.raises(ValueError):
        service.ship_order(o.id)


def test_cancel_pending():
    o = service.create_order(1, [], 5000)
    assert service.cancel_order(o.id).status == Status.CANCELLED


def test_partial_refund_keeps_order_open():
    o = service.create_order(1, [], 10000)
    service.pay_order(o.id)
    receipt = service.refund_order(o.id, 2500, "damaged")
    assert receipt["left_cents"] == 7500
    assert receipt["status"] == "partially_refunded"


def test_full_refund_marks_order_refunded():
    o = service.create_order(1, [], 4000)
    service.pay_order(o.id)
    service.refund_order(o.id, 4000, "cancelled")
    assert service.get_order(o.id).status == Status.REFUNDED
