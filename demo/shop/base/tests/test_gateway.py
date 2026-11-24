import pytest

from shop.payments import gateway


def test_charge_returns_charge():
    c = gateway.charge(1, 1000)
    assert c.amount_cents == 1000


def test_charge_rejects_zero():
    with pytest.raises(ValueError):
        gateway.charge(1, 0)
