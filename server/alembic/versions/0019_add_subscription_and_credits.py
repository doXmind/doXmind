"""add subscription, credits, and credit_transactions tables

Revision ID: 0019_billing
Revises: 0018_share_views
Create Date: 2026-03-07

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0019_billing"
down_revision: str | Sequence[str] | None = "0018_share_views"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create billing tables and backfill existing users."""
    bind = op.get_bind()
    inspector = sa_inspect(bind)
    existing_tables = inspector.get_table_names()

    # 1. Create user_subscriptions table
    if "user_subscriptions" not in existing_tables:
        op.create_table(
            "user_subscriptions",
            sa.Column(
                "user_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column("stripe_customer_id", sa.String(255), unique=True, nullable=True),
            sa.Column("stripe_subscription_id", sa.String(255), unique=True, nullable=True),
            sa.Column("plan", sa.String(20), nullable=False, server_default="free"),
            sa.Column(
                "is_early_bird", sa.Boolean(), nullable=False, server_default=sa.text("false")
            ),
            sa.Column("status", sa.String(20), nullable=False, server_default="active"),
            sa.Column("current_period_start", sa.DateTime(timezone=True), nullable=True),
            sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
            sa.Column("canceled_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "storage_used_bytes", sa.BigInteger(), nullable=False, server_default=sa.text("0")
            ),
            sa.Column(
                "storage_limit_bytes",
                sa.BigInteger(),
                nullable=False,
                server_default=sa.text("104857600"),
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index(
            "ix_user_subscriptions_stripe_customer_id", "user_subscriptions", ["stripe_customer_id"]
        )
        op.create_index(
            "ix_user_subscriptions_stripe_subscription_id",
            "user_subscriptions",
            ["stripe_subscription_id"],
        )

    # 2. Create user_credits table
    if "user_credits" not in existing_tables:
        op.create_table(
            "user_credits",
            sa.Column(
                "user_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column(
                "credits_remaining", sa.Integer(), nullable=False, server_default=sa.text("600")
            ),
            sa.Column("credits_limit", sa.Integer(), nullable=False, server_default=sa.text("600")),
            sa.Column(
                "period_start",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column(
                "period_end",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("NOW() + INTERVAL '30 days'"),
            ),
            sa.Column(
                "credits_used_this_period",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("0"),
            ),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    # 3. Create credit_transactions table
    if "credit_transactions" not in existing_tables:
        op.create_table(
            "credit_transactions",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "user_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("amount", sa.Integer(), nullable=False),
            sa.Column("balance_after", sa.Integer(), nullable=False),
            sa.Column("transaction_type", sa.String(20), nullable=False),
            sa.Column("service", sa.String(50), nullable=True),
            sa.Column("description", sa.String(255), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_credit_transactions_user_id", "credit_transactions", ["user_id"])
        op.create_index("ix_credit_transactions_created_at", "credit_transactions", ["created_at"])

    # 4. Backfill existing users with free tier defaults
    op.execute("""
        INSERT INTO user_subscriptions (user_id, plan, status, storage_used_bytes, storage_limit_bytes, created_at, updated_at)
        SELECT id, 'free', 'active', 0, 104857600, created_at, NOW()
        FROM users
        WHERE id NOT IN (SELECT user_id FROM user_subscriptions)
    """)
    op.execute("""
        INSERT INTO user_credits (user_id, credits_remaining, credits_limit, period_start, period_end, credits_used_this_period, updated_at)
        SELECT id, 600, 600, created_at, created_at + INTERVAL '30 days', 0, NOW()
        FROM users
        WHERE id NOT IN (SELECT user_id FROM user_credits)
    """)

    # 5. Backfill storage usage from existing KB attachments and data files
    op.execute("""
        UPDATE user_subscriptions us
        SET storage_used_bytes = COALESCE(sub.total_size, 0)
        FROM (
            SELECT c.user_id, SUM(COALESCE(ca.file_size, 0)) AS total_size
            FROM conversations c
            JOIN conversation_attachments ca ON ca.conversation_id = c.id
            WHERE ca.status != 'error'
            GROUP BY c.user_id
        ) sub
        WHERE us.user_id = sub.user_id
    """)


def downgrade() -> None:
    """Drop billing tables."""
    op.drop_table("credit_transactions")
    op.drop_table("user_credits")
    op.drop_table("user_subscriptions")
