"""Migration 0007: track refunds on orders and keep every refund row."""


def upgrade(conn):
    conn.execute("ALTER TABLE orders ADD COLUMN refunded_cents INTEGER NOT NULL DEFAULT 0")
    conn.execute(
        "CREATE TABLE refunds ("
        " id TEXT PRIMARY KEY,"
        " order_id INTEGER NOT NULL REFERENCES orders(id),"
        " amount_cents INTEGER NOT NULL,"
        " reason TEXT NOT NULL,"
        " created_at REAL NOT NULL)"
    )
    conn.execute("CREATE INDEX refunds_order ON refunds(order_id)")
    backfill(conn)
    create_views(conn)


def backfill(conn):
    """Orders cancelled after being paid were refunded by hand: record them."""
    conn.execute(
        "INSERT INTO refunds (id, order_id, amount_cents, reason, created_at) "
        "SELECT 're_legacy_' || id, id, total_cents, 'cancelled', strftime('%s', 'now') "
        "FROM orders WHERE status = 'cancelled' AND paid_at IS NOT NULL"
    )
    conn.execute(
        "UPDATE orders SET refunded_cents = total_cents "
        "WHERE status = 'cancelled' AND paid_at IS NOT NULL"
    )


def create_views(conn):
    conn.execute(
        "CREATE VIEW order_refund_totals AS "
        "SELECT order_id, COUNT(*) AS refunds, SUM(amount_cents) AS refunded_cents "
        "FROM refunds GROUP BY order_id"
    )


def downgrade(conn):
    conn.execute("DROP VIEW order_refund_totals")
    conn.execute("DROP TABLE refunds")
    conn.execute("ALTER TABLE orders DROP COLUMN refunded_cents")
