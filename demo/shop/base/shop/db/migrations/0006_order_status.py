"""Migration 0006: add a status column to orders."""


def upgrade(conn):
    conn.execute("ALTER TABLE orders ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'")


def downgrade(conn):
    conn.execute("ALTER TABLE orders DROP COLUMN status")
