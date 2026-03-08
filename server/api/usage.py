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
from db.database import ApiUsage, Conversation, FileVersion, File, Message, get_db
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


class DailyActivity(BaseModel):
    """Activity data for a single day."""

    date: str
    ai_requests: int
    tokens: int
    characters: int


class DailyActivityResponse(BaseModel):
    """Daily activity timeline."""

    days: list[DailyActivity]
    period_days: int


class DailyServiceBreakdown(BaseModel):
    """Per-day per-service token breakdown."""

    date: str
    services: dict[str, int]


class DailyServiceResponse(BaseModel):
    """Daily activity with service-level breakdown."""

    days: list[DailyServiceBreakdown]
    period_days: int


# ============================================================================
# Endpoints
# ============================================================================


@router.get("/daily", response_model=DailyActivityResponse)
async def get_daily_activity(
    days: int = Query(default=30, ge=1, le=365),
    auth: TokenData = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Get daily activity breakdown combining AI usage and document edits."""
    user_id = get_user_id(auth)
    since = datetime.now(UTC) - timedelta(days=days)
    date_trunc = func.date(Message.created_at)

    # 1) Daily AI requests & tokens from messages
    msg_stmt = (
        select(
            date_trunc.label("day"),
            func.count(Message.id).label("ai_requests"),
            func.coalesce(
                func.sum(cast(Message.input_tokens, Integer))
                + func.sum(cast(Message.output_tokens, Integer)),
                0,
            ).label("tokens"),
        )
        .join(Conversation, Message.conversation_id == Conversation.id)
        .where(
            Conversation.user_id == user_id,
            Message.role == "assistant",
            Message.created_at >= since,
        )
        .group_by(date_trunc)
    )
    msg_rows = {str(r.day): {"ai_requests": int(r.ai_requests), "tokens": int(r.tokens)} for r in (await db.execute(msg_stmt)).all()}

    # 2) Daily AI requests & tokens from api_usage
    api_date_trunc = func.date(ApiUsage.created_at)
    try:
        api_stmt = (
            select(
                api_date_trunc.label("day"),
                func.count(ApiUsage.id).label("ai_requests"),
                func.coalesce(
                    func.sum(ApiUsage.input_tokens) + func.sum(ApiUsage.output_tokens),
                    0,
                ).label("tokens"),
            )
            .where(ApiUsage.user_id == user_id, ApiUsage.created_at >= since)
            .group_by(api_date_trunc)
        )
        for r in (await db.execute(api_stmt)).all():
            day_str = str(r.day)
            if day_str in msg_rows:
                msg_rows[day_str]["ai_requests"] += int(r.ai_requests)
                msg_rows[day_str]["tokens"] += int(r.tokens)
            else:
                msg_rows[day_str] = {"ai_requests": int(r.ai_requests), "tokens": int(r.tokens)}
    except Exception as e:
        logger.warning(f"Failed to query api_usage for daily: {e}")

    # 3) Daily characters written — user messages (what the user typed)
    char_map: dict[str, int] = {}
    try:
        user_msg_trunc = func.date(Message.created_at)
        char_stmt = (
            select(
                user_msg_trunc.label("day"),
                func.coalesce(func.sum(func.length(Message.content)), 0).label("chars"),
            )
            .join(Conversation, Message.conversation_id == Conversation.id)
            .where(
                Conversation.user_id == user_id,
                Message.role == "user",
                Message.created_at >= since,
            )
            .group_by(user_msg_trunc)
        )
        char_map = {str(r.day): int(r.chars) for r in (await db.execute(char_stmt)).all()}
    except Exception as e:
        logger.warning(f"Failed to query user message chars for daily: {e}")

    # 4) Daily characters from document edits (FileVersion content length)
    try:
        fv_date_trunc = func.date(FileVersion.created_at)
        fv_stmt = (
            select(
                fv_date_trunc.label("day"),
                func.coalesce(func.sum(func.length(FileVersion.content)), 0).label("chars"),
            )
            .join(File, FileVersion.file_id == File.id)
            .where(File.user_id == user_id, FileVersion.created_at >= since)
            .group_by(fv_date_trunc)
        )
        for r in (await db.execute(fv_stmt)).all():
            day_str = str(r.day)
            char_map[day_str] = char_map.get(day_str, 0) + int(r.chars)
    except Exception as e:
        logger.warning(f"Failed to query file_versions chars for daily: {e}")

    # Build complete timeline (fill missing days with zeros)
    result_days: list[DailyActivity] = []
    for i in range(days):
        d = (datetime.now(UTC) - timedelta(days=days - 1 - i)).strftime("%Y-%m-%d")
        msg_data = msg_rows.get(d, {"ai_requests": 0, "tokens": 0})
        result_days.append(
            DailyActivity(
                date=d,
                ai_requests=msg_data["ai_requests"],
                tokens=msg_data["tokens"],
                characters=char_map.get(d, 0),
            )
        )

    return DailyActivityResponse(days=result_days, period_days=days)


@router.get("/daily-by-service", response_model=DailyServiceResponse)
async def get_daily_by_service(
    days: int = Query(default=30, ge=1, le=365),
    auth: TokenData = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Get daily token usage broken down by service type."""
    user_id = get_user_id(auth)
    since = datetime.now(UTC) - timedelta(days=days)

    # day_str -> { service -> tokens }
    day_service: dict[str, dict[str, int]] = {}

    # 1) Chat tokens from Messages table
    date_trunc = func.date(Message.created_at)
    input_col = cast(Message.input_tokens, Integer)
    output_col = cast(Message.output_tokens, Integer)
    chat_stmt = (
        select(
            date_trunc.label("day"),
            func.coalesce(func.sum(input_col) + func.sum(output_col), 0).label("tokens"),
        )
        .join(Conversation, Message.conversation_id == Conversation.id)
        .where(
            Conversation.user_id == user_id,
            Message.role == "assistant",
            Message.created_at >= since,
        )
        .group_by(date_trunc)
    )
    for r in (await db.execute(chat_stmt)).all():
        d = str(r.day)
        day_service.setdefault(d, {})
        day_service[d]["chat"] = int(r.tokens)

    # 2) Non-chat tokens from ApiUsage table (grouped by day + service)
    try:
        api_trunc = func.date(ApiUsage.created_at)
        api_stmt = (
            select(
                api_trunc.label("day"),
                ApiUsage.service,
                func.coalesce(
                    func.sum(ApiUsage.input_tokens) + func.sum(ApiUsage.output_tokens), 0
                ).label("tokens"),
            )
            .where(ApiUsage.user_id == user_id, ApiUsage.created_at >= since)
            .group_by(api_trunc, ApiUsage.service)
        )
        for r in (await db.execute(api_stmt)).all():
            d = str(r.day)
            day_service.setdefault(d, {})
            svc = r.service or "other"
            day_service[d][svc] = day_service[d].get(svc, 0) + int(r.tokens)
    except Exception as e:
        logger.warning(f"Failed to query api_usage for daily-by-service: {e}")

    # Build timeline
    result: list[DailyServiceBreakdown] = []
    for i in range(days):
        d = (datetime.now(UTC) - timedelta(days=days - 1 - i)).strftime("%Y-%m-%d")
        result.append(DailyServiceBreakdown(date=d, services=day_service.get(d, {})))

    return DailyServiceResponse(days=result, period_days=days)


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
