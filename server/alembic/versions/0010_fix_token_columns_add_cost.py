"""Fix token columns from String to Integer and add cost column.

Token counts were stored as String(20) which prevents aggregation queries.
Change to Integer for proper SUM/GROUP BY support. Add cost column (Float)
to store USD cost from OpenRouter API responses.

Revision ID: 0010_token_columns
Revises: 0009_share_visibility
Create Date: 2026-02-22
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0010_token_columns"
down_revision: str = "0009_share_visibility"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Convert token columns from String to Integer and add cost column."""
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == "postgresql":
        # PostgreSQL: use ALTER TYPE with USING for cast
        op.execute(
            "ALTER TABLE messages "
            "ALTER COLUMN input_tokens TYPE INTEGER "
            "USING CASE WHEN input_tokens IS NOT NULL AND input_tokens != '' "
            "THEN input_tokens::INTEGER ELSE NULL END"
        )
        op.execute(
            "ALTER TABLE messages "
            "ALTER COLUMN output_tokens TYPE INTEGER "
            "USING CASE WHEN output_tokens IS NOT NULL AND output_tokens != '' "
            "THEN output_tokens::INTEGER ELSE NULL END"
        )
    else:
        # SQLite: recreate columns (SQLite doesn't support ALTER COLUMN TYPE)
        # Alembic batch mode handles this automatically
        with op.batch_alter_table("messages") as batch_op:
            batch_op.alter_column(
                "input_tokens",
                existing_type=sa.String(20),
                type_=sa.Integer(),
                existing_nullable=True,
                postgresql_using="input_tokens::integer",
            )
            batch_op.alter_column(
                "output_tokens",
                existing_type=sa.String(20),
                type_=sa.Integer(),
                existing_nullable=True,
                postgresql_using="output_tokens::integer",
            )

    # Add cost column
    op.add_column("messages", sa.Column("cost", sa.Float(), nullable=True))


def downgrade() -> None:
    """Revert token columns to String and remove cost column."""
    op.drop_column("messages", "cost")

    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == "postgresql":
        op.execute(
            "ALTER TABLE messages "
            "ALTER COLUMN input_tokens TYPE VARCHAR(20) "
            "USING input_tokens::VARCHAR"
        )
        op.execute(
            "ALTER TABLE messages "
            "ALTER COLUMN output_tokens TYPE VARCHAR(20) "
            "USING output_tokens::VARCHAR"
        )
    else:
        with op.batch_alter_table("messages") as batch_op:
            batch_op.alter_column(
                "input_tokens",
                existing_type=sa.Integer(),
                type_=sa.String(20),
                existing_nullable=True,
            )
            batch_op.alter_column(
                "output_tokens",
                existing_type=sa.Integer(),
                type_=sa.String(20),
                existing_nullable=True,
            )
