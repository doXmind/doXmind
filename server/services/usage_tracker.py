"""Fire-and-forget API usage tracking.

Provides helpers to record token usage from any OpenRouter service call.
Uses a dedicated database session to avoid coupling with request-scoped sessions.
"""

import logging
import uuid

from db.database import ApiUsage, async_session

logger = logging.getLogger(__name__)


def extract_usage(response) -> dict:
    """Extract usage dict from a non-streaming OpenAI/OpenRouter response.

    Works with ChatCompletion, CreateEmbeddingResponse, etc.

    Returns:
        {"input_tokens": int, "output_tokens": int, "cost": float | None}
    """
    usage = getattr(response, "usage", None)
    if not usage:
        return {"input_tokens": 0, "output_tokens": 0, "cost": None}

    cost = None
    if hasattr(usage, "cost"):
        cost = usage.cost
    elif hasattr(usage, "model_extra") and usage.model_extra:
        cost = usage.model_extra.get("cost")

    return {
        "input_tokens": getattr(usage, "prompt_tokens", 0) or 0,
        "output_tokens": (
            getattr(usage, "completion_tokens", 0) or getattr(usage, "total_tokens", 0) or 0
        ),
        "cost": cost,
    }


async def track_usage(
    *,
    service: str,
    model: str | None = None,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    cost: float | None = None,
    user_id: str | None = None,
    is_byok: bool = False,
) -> None:
    """Record an API usage event. Fire-and-forget — never raises."""
    try:
        async with async_session() as session:
            record = ApiUsage(
                id=str(uuid.uuid4()),
                user_id=user_id,
                service=service,
                model=model,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cost=cost,
                is_byok=is_byok,
            )
            session.add(record)
            await session.commit()
    except Exception as e:
        logger.warning(f"Failed to track usage for {service}: {e}")
