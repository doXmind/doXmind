"""Token usage tracking and analytics endpoints.

Provides:
- Per-user usage summary from local message data (grouped by model)
- OpenRouter Activity API proxy for server-level aggregated usage
"""

import logging
from datetime import UTC, datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import Integer, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.files import get_user_id
from config import get_settings
from db.database import ApiUsage, Conversation, Message, get_db
from services.auth_service import TokenData, require_auth

logger = logging.getLogger(__name__)
router = APIRouter()


# ============================================================================
# Response Models
# ============================================================================


class ModelUsage(BaseModel):
    """Token usage for a single model."""

    model: str
    input_tokens: int
    output_tokens: int
    total_tokens: int
    cost: float | None
    request_count: int


class UsageSummaryResponse(BaseModel):
    """Aggregated usage summary across all models."""

    models: list[ModelUsage]
    total_input_tokens: int
    total_output_tokens: int
    total_tokens: int
    total_cost: float | None
    total_requests: int
    period_days: int


# ============================================================================
# Endpoints
# ============================================================================


@router.get("/summary", response_model=UsageSummaryResponse)
async def get_usage_summary(
    days: int = Query(default=30, ge=1, le=365),
    byok: bool | None = Query(
        default=None, description="Filter by key type: true=user key, false=platform key"
    ),
    auth: TokenData = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Get per-model usage summary from local message data.

    Groups by model and sums input_tokens, output_tokens, cost
    for all assistant messages within the given period.
    """
    user_id = get_user_id(auth)
    since = datetime.now(UTC) - timedelta(days=days)

    # Query: aggregate tokens by model for this user's conversations
    # Use cast(... Integer) so SUM works even if migration hasn't run yet
    # (columns may still be VARCHAR in the database)
    input_col = cast(Message.input_tokens, Integer)
    output_col = cast(Message.output_tokens, Integer)
    message_model_col = func.coalesce(Message.model, "unknown")
    api_model_col = func.coalesce(ApiUsage.model, "unknown")

    # Build query — cost column may not exist if migration hasn't run
    has_cost_column = True
    try:
        stmt = (
            select(
                message_model_col.label("model"),
                func.coalesce(func.sum(input_col), 0).label("input_tokens"),
                func.coalesce(func.sum(output_col), 0).label("output_tokens"),
                func.sum(Message.cost).label("cost"),
                func.count(Message.id).label("request_count"),
            )
            .join(Conversation, Message.conversation_id == Conversation.id)
            .where(
                Conversation.user_id == user_id,
                Message.role == "assistant",
                Message.created_at >= since,
            )
            .group_by(message_model_col)
            .order_by(func.sum(output_col).desc())
        )
        if byok is not None:
            stmt = stmt.where(Message.is_byok == byok)
        result = await db.execute(stmt)
    except Exception:
        # Fallback: cost column doesn't exist yet
        has_cost_column = False
        await db.rollback()
        stmt = (
            select(
                message_model_col.label("model"),
                func.coalesce(func.sum(input_col), 0).label("input_tokens"),
                func.coalesce(func.sum(output_col), 0).label("output_tokens"),
                func.count(Message.id).label("request_count"),
            )
            .join(Conversation, Message.conversation_id == Conversation.id)
            .where(
                Conversation.user_id == user_id,
                Message.role == "assistant",
                Message.created_at >= since,
            )
            .group_by(message_model_col)
            .order_by(func.sum(output_col).desc())
        )
        if byok is not None:
            stmt = stmt.where(Message.is_byok == byok)
        result = await db.execute(stmt)

    rows = result.all()

    # Aggregate into a dict keyed by model for merging
    model_map: dict[str, dict] = {}
    total_input = 0
    total_output = 0
    total_cost = 0.0
    total_requests = 0
    has_cost = False

    for row in rows:
        input_t = int(row.input_tokens or 0)
        output_t = int(row.output_tokens or 0)
        cost = (
            float(row.cost)
            if has_cost_column and hasattr(row, "cost") and row.cost is not None
            else None
        )
        count = int(row.request_count or 0)

        model_map[row.model] = {
            "input_tokens": input_t,
            "output_tokens": output_t,
            "cost": cost,
            "request_count": count,
        }
        total_input += input_t
        total_output += output_t
        total_requests += count
        if cost is not None:
            has_cost = True
            total_cost += cost

    # Also query api_usage table for non-chat usage
    try:
        api_stmt = (
            select(
                api_model_col.label("model"),
                func.coalesce(func.sum(ApiUsage.input_tokens), 0).label("input_tokens"),
                func.coalesce(func.sum(ApiUsage.output_tokens), 0).label("output_tokens"),
                func.sum(ApiUsage.cost).label("cost"),
                func.count(ApiUsage.id).label("request_count"),
            )
            .where(
                ApiUsage.user_id == user_id,
                ApiUsage.created_at >= since,
            )
            .group_by(api_model_col)
        )
        if byok is not None:
            api_stmt = api_stmt.where(ApiUsage.is_byok == byok)
        api_result = await db.execute(api_stmt)

        for row in api_result.all():
            input_t = int(row.input_tokens or 0)
            output_t = int(row.output_tokens or 0)
            cost = float(row.cost) if row.cost is not None else None
            count = int(row.request_count or 0)

            if row.model in model_map:
                m = model_map[row.model]
                m["input_tokens"] += input_t
                m["output_tokens"] += output_t
                m["request_count"] += count
                if cost is not None:
                    m["cost"] = (m["cost"] or 0) + cost
            else:
                model_map[row.model] = {
                    "input_tokens": input_t,
                    "output_tokens": output_t,
                    "cost": cost,
                    "request_count": count,
                }

            total_input += input_t
            total_output += output_t
            total_requests += count
            if cost is not None:
                has_cost = True
                total_cost += cost
    except Exception as e:
        logger.warning(f"Failed to query api_usage table: {e}")

    # Build response
    models = [
        ModelUsage(
            model=model_name,
            input_tokens=data["input_tokens"],
            output_tokens=data["output_tokens"],
            total_tokens=data["input_tokens"] + data["output_tokens"],
            cost=data["cost"],
            request_count=data["request_count"],
        )
        for model_name, data in sorted(
            model_map.items(),
            key=lambda x: x[1]["output_tokens"],
            reverse=True,
        )
    ]

    return UsageSummaryResponse(
        models=models,
        total_input_tokens=total_input,
        total_output_tokens=total_output,
        total_tokens=total_input + total_output,
        total_cost=total_cost if has_cost else None,
        total_requests=total_requests,
        period_days=days,
    )


@router.get("/activity")
async def get_openrouter_activity(
    date: str | None = Query(default=None, description="UTC date YYYY-MM-DD"),
    auth: TokenData = Depends(require_auth),
):
    """Proxy to OpenRouter Activity API for server-level usage stats.

    Returns per-model, per-day aggregated data including prompt_tokens,
    completion_tokens, cost, and request counts from OpenRouter.
    """
    settings = get_settings()
    if not settings.openrouter_api_key:
        return {"error": "OpenRouter API key not configured", "data": []}

    url = "https://openrouter.ai/api/v1/activity"
    params = {}
    if date:
        params["date"] = date

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                url,
                headers={"Authorization": f"Bearer {settings.openrouter_api_key}"},
                params=params,
            )

        if response.status_code == 200:
            return response.json()
        else:
            logger.warning(f"OpenRouter Activity API returned {response.status_code}")
            return {
                "error": f"OpenRouter API returned {response.status_code}",
                "data": [],
            }

    except Exception as e:
        logger.error(f"Failed to fetch OpenRouter activity: {e}")
        return {"error": "Failed to fetch activity data", "data": []}


class ServiceUsage(BaseModel):
    """Token usage for a single service type."""

    service: str
    input_tokens: int
    output_tokens: int
    total_tokens: int
    cost: float | None
    request_count: int


class ServiceUsageResponse(BaseModel):
    """Usage breakdown by service type."""

    services: list[ServiceUsage]
    period_days: int


@router.get("/by-service", response_model=ServiceUsageResponse)
async def get_usage_by_service(
    days: int = Query(default=30, ge=1, le=365),
    byok: bool | None = Query(
        default=None, description="Filter by key type: true=user key, false=platform key"
    ),
    auth: TokenData = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Get usage breakdown by service type.

    Combines chat usage from messages table (as service="chat") with
    non-chat usage from api_usage table (autocomplete, quick_edit, etc.).
    """
    user_id = get_user_id(auth)
    since = datetime.now(UTC) - timedelta(days=days)

    service_map: dict[str, dict] = {}

    # 1) Chat usage from messages table
    input_col = cast(Message.input_tokens, Integer)
    output_col = cast(Message.output_tokens, Integer)
    has_cost_column = True
    try:
        chat_stmt = (
            select(
                func.coalesce(func.sum(input_col), 0).label("input_tokens"),
                func.coalesce(func.sum(output_col), 0).label("output_tokens"),
                func.sum(Message.cost).label("cost"),
                func.count(Message.id).label("request_count"),
            )
            .join(Conversation, Message.conversation_id == Conversation.id)
            .where(
                Conversation.user_id == user_id,
                Message.role == "assistant",
                Message.created_at >= since,
            )
        )
        if byok is not None:
            chat_stmt = chat_stmt.where(Message.is_byok == byok)
        chat_result = await db.execute(chat_stmt)
    except Exception:
        has_cost_column = False
        await db.rollback()
        chat_stmt = (
            select(
                func.coalesce(func.sum(input_col), 0).label("input_tokens"),
                func.coalesce(func.sum(output_col), 0).label("output_tokens"),
                func.count(Message.id).label("request_count"),
            )
            .join(Conversation, Message.conversation_id == Conversation.id)
            .where(
                Conversation.user_id == user_id,
                Message.role == "assistant",
                Message.created_at >= since,
            )
        )
        if byok is not None:
            chat_stmt = chat_stmt.where(Message.is_byok == byok)
        chat_result = await db.execute(chat_stmt)

    chat_row = chat_result.one_or_none()
    if chat_row:
        input_t = int(chat_row.input_tokens or 0)
        output_t = int(chat_row.output_tokens or 0)
        cost = (
            float(chat_row.cost)
            if has_cost_column and hasattr(chat_row, "cost") and chat_row.cost is not None
            else None
        )
        count = int(chat_row.request_count or 0)
        if count > 0:
            service_map["chat"] = {
                "input_tokens": input_t,
                "output_tokens": output_t,
                "cost": cost,
                "request_count": count,
            }

    # 2) Non-chat usage from api_usage table
    try:
        api_stmt = (
            select(
                ApiUsage.service,
                func.coalesce(func.sum(ApiUsage.input_tokens), 0).label("input_tokens"),
                func.coalesce(func.sum(ApiUsage.output_tokens), 0).label("output_tokens"),
                func.sum(ApiUsage.cost).label("cost"),
                func.count(ApiUsage.id).label("request_count"),
            )
            .where(
                ApiUsage.user_id == user_id,
                ApiUsage.created_at >= since,
            )
            .group_by(ApiUsage.service)
        )
        if byok is not None:
            api_stmt = api_stmt.where(ApiUsage.is_byok == byok)
        api_result = await db.execute(api_stmt)

        for row in api_result.all():
            input_t = int(row.input_tokens or 0)
            output_t = int(row.output_tokens or 0)
            cost = float(row.cost) if row.cost is not None else None
            count = int(row.request_count or 0)
            service_map[row.service] = {
                "input_tokens": input_t,
                "output_tokens": output_t,
                "cost": cost,
                "request_count": count,
            }
    except Exception as e:
        logger.warning(f"Failed to query api_usage table: {e}")

    # Build response sorted by request count
    services = [
        ServiceUsage(
            service=svc_name,
            input_tokens=data["input_tokens"],
            output_tokens=data["output_tokens"],
            total_tokens=data["input_tokens"] + data["output_tokens"],
            cost=data["cost"],
            request_count=data["request_count"],
        )
        for svc_name, data in sorted(
            service_map.items(),
            key=lambda x: x[1]["request_count"],
            reverse=True,
        )
    ]

    return ServiceUsageResponse(services=services, period_days=days)
