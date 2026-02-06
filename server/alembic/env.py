import sys
from logging.config import fileConfig
from pathlib import Path

from sqlalchemy import engine_from_config, pool

from alembic import context

# Add parent directory to path so we can import our models
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config import get_settings
from db.database import Base

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
target_metadata = Base.metadata


def get_database_url() -> str:
    """Get sync database URL for Alembic.

    Handles Heroku's postgres:// format and removes asyncpg driver
    since Alembic uses synchronous database connections.
    """
    settings = get_settings()
    url = settings.database_url

    # Heroku uses postgres://, convert to postgresql://
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)

    # Remove asyncpg driver (Alembic uses sync psycopg2 driver)
    if "+asyncpg" in url:
        url = url.replace("+asyncpg", "")

    return url


# Override alembic.ini URL with environment-based URL
config.set_main_option("sqlalchemy.url", get_database_url())

# Tables to exclude from autogenerate (managed externally)
EXCLUDED_TABLES = {"vectors"}


def include_object(object, name, type_, _reflected, _compare_to):
    """Filter objects for autogenerate.

    Excludes tables managed by external systems (e.g., pgvector).
    """
    if type_ == "table" and name in EXCLUDED_TABLES:
        return False
    # Also exclude indexes on excluded tables
    return not (type_ == "index" and object.table.name in EXCLUDED_TABLES)


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_object=include_object,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_object=include_object,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
