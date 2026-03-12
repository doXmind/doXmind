"""add database block tables

Revision ID: 0023
Revises: 0022
Create Date: 2026-03-10
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers
revision = "0023_database_tables"
down_revision = "0022_cover_image"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "database_blocks",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("title", sa.String(255), nullable=False, server_default="Untitled Database"),
        sa.Column("icon", sa.String(10), nullable=True),
        sa.Column("properties_schema", sa.JSON, nullable=False, server_default="[]"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )

    op.create_table(
        "database_rows",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "database_id",
            sa.String(36),
            sa.ForeignKey("database_blocks.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("properties", sa.JSON, nullable=False, server_default="{}"),
        sa.Column("position", sa.Integer, server_default="0"),
        sa.Column(
            "page_file_id",
            sa.String(36),
            sa.ForeignKey("files.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "idx_db_rows_database_position",
        "database_rows",
        ["database_id", "position"],
    )

    op.create_table(
        "database_views",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "database_id",
            sa.String(36),
            sa.ForeignKey("database_blocks.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(255), nullable=False, server_default="Table View"),
        sa.Column("type", sa.String(20), nullable=False, server_default="table"),
        sa.Column("config", sa.JSON, nullable=False, server_default="{}"),
        sa.Column("position", sa.Integer, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "idx_db_views_database_position",
        "database_views",
        ["database_id", "position"],
    )


def downgrade() -> None:
    op.drop_table("database_views")
    op.drop_table("database_rows")
    op.drop_table("database_blocks")
