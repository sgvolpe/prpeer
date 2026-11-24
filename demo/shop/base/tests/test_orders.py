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
