"""FastAPI Dependencies — local desktop edition (no auth)."""

import logging
from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import async_session

logger = logging.getLogger(__name__)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        yield session


DbSession = Annotated[AsyncSession, Depends(get_db)]

