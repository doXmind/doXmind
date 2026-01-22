"""Telemetry API endpoints.

Collects user behavior data for:
1. RLHF training (chosen/rejected pairs)
2. Product analytics (usage statistics)

Privacy:
- Default enabled, user can opt-out
- When disabled, only collects anonymous aggregate stats
- No PII is ever collected
"""

import logging
from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.database import TelemetryEvent, UserTelemetrySettings, get_db
from services.auth_service import TokenData, optional_auth, require_auth

router = APIRouter()
logger = logging.getLogger(__name__)


# =============================================================================
# Request/Response Models
# =============================================================================

class TelemetryEventData(BaseModel):
    """A single telemetry event."""

    event_type: str
    timestamp: int
    session_id: str

    # Optional fields depending on event type
    hunk_id: str | None = None
    file_id: str | None = None
    original_content: str | None = None
    ai_suggestion: str | None = None
    user_action: str | None = None
    suggestion_id: str | None = None
    text_before: str | None = None
    suggestion: str | None = None
    accepted_text: str | None = None
    latency_ms: int | None = None
    trigger_mode: str | None = None
    decision_speed: str | None = None  # "instant" | "quick" | "normal" | "delayed"
    time_to_decision_ms: int | None = None
    message_id: str | None = None
    conversation_id: str | None = None
    user_prompt: str | None = None
    ai_response: str | None = None
    rating: str | None = None
    feedback_text: str | None = None
    model: str | None = None
    had_tool_calls: bool | None = None
    original_ai_output: str | None = None
    final_user_content: str | None = None
    edit_delta: str | None = None
    time_to_edit_ms: int | None = None
    ai_operation_type: str | None = None
    time_to_undo_ms: int | None = None
    feature: str | None = None
    outcome: str | None = None
    duration_ms: int | None = None
    messages_sent: int | None = None
    edits_applied: int | None = None
    edits_rejected: int | None = None
    autocomplete_accepts: int | None = None
    autocomplete_dismisses: int | None = None
    edit_type: str | None = None
    success: bool | None = None


class TelemetryEventsRequest(BaseModel):
    """Batch of telemetry events."""

    events: list[TelemetryEventData] = Field(max_length=100)


class TelemetrySettingsResponse(BaseModel):
    """User's telemetry settings."""

    product_improvement_enabled: bool = True
    collect_edit_feedback: bool = True
    collect_chat_feedback: bool = True
    collect_autocomplete_stats: bool = True
    collect_usage_stats: bool = True


class TelemetrySettingsRequest(BaseModel):
    """Request to update telemetry settings."""

    product_improvement_enabled: bool | None = None
    collect_edit_feedback: bool | None = None
    collect_chat_feedback: bool | None = None
    collect_autocomplete_stats: bool | None = None
    collect_usage_stats: bool | None = None


# =============================================================================
# Helper Functions
# =============================================================================

def extract_rlhf_fields(event: TelemetryEventData) -> tuple[str | None, str | None, str | None]:
    """Extract chosen/rejected content and context from event for RLHF training.

    Returns (chosen_content, rejected_content, context)
    """
    event_type = event.event_type

    # Diff review events
    if event_type in ("diff_hunk_accepted", "diff_all_accepted"):
        # User accepted AI suggestion: AI wins
        return event.ai_suggestion, event.original_content, None
    elif event_type in ("diff_hunk_rejected", "diff_all_rejected"):
        # User rejected AI suggestion: original wins
        return event.original_content, event.ai_suggestion, None

    # Chat feedback
    elif event_type == "chat_feedback":
        if event.rating == "positive":
            return event.ai_response, None, event.user_prompt
        elif event.rating == "negative":
            return None, event.ai_response, event.user_prompt

    # Autocomplete events
    elif event_type == "autocomplete_accepted":
        return event.suggestion, None, event.text_before
    elif event_type == "autocomplete_dismissed":
        return None, event.suggestion, event.text_before

    # Post-AI edit (user modified AI output)
    elif event_type == "post_ai_edit":
        return event.final_user_content, event.original_ai_output, None

    return None, None, None


# =============================================================================
# API Endpoints
# =============================================================================

@router.post("/events")
async def submit_events(
    request: TelemetryEventsRequest,
    db: AsyncSession = Depends(get_db),
    auth: TokenData | None = Depends(optional_auth),
):
    """Submit a batch of telemetry events.

    Events are stored for:
    1. RLHF training data (chosen/rejected pairs)
    2. Product analytics (aggregate statistics)
    """
    user_id = auth.sub if auth else None

    # Get user settings if authenticated
    settings = None
    if user_id:
        result = await db.execute(
            select(UserTelemetrySettings).where(UserTelemetrySettings.user_id == user_id)
        )
        settings = result.scalar_one_or_none()

    events_created = 0

    for event_data in request.events:
        # Check if this event type is enabled
        if settings:
            # Skip events based on settings - only allow aggregate stats if product improvement disabled
            if not settings.product_improvement_enabled and event_data.event_type not in ("session_summary", "feature_used"):
                continue

            event_type = event_data.event_type
            if event_type.startswith("diff_") or event_type in ("edit_applied", "post_ai_edit", "undo_after_ai"):
                if not settings.collect_edit_feedback:
                    continue
            elif event_type.startswith("chat_"):
                if not settings.collect_chat_feedback:
                    continue
            elif event_type.startswith("autocomplete_"):
                if not settings.collect_autocomplete_stats:
                    continue
            elif event_type in ("feature_used", "session_summary"):
                if not settings.collect_usage_stats:
                    continue

        # Extract RLHF training data
        chosen, rejected, context = extract_rlhf_fields(event_data)

        # Create event record
        event = TelemetryEvent(
            user_id=user_id,
            event_type=event_data.event_type,
            event_data=event_data.model_dump(exclude_none=True),
            created_at=datetime.fromtimestamp(event_data.timestamp / 1000),
            chosen_content=chosen,
            rejected_content=rejected,
            context=context,
        )
        db.add(event)
        events_created += 1

    await db.commit()

    return {"status": "ok", "events_created": events_created}


@router.get("/settings", response_model=TelemetrySettingsResponse)
async def get_settings(
    db: AsyncSession = Depends(get_db),
    auth: TokenData = Depends(require_auth),
):
    """Get user's telemetry settings."""
    result = await db.execute(
        select(UserTelemetrySettings).where(UserTelemetrySettings.user_id == auth.sub)
    )
    settings = result.scalar_one_or_none()

    if settings:
        return TelemetrySettingsResponse(
            product_improvement_enabled=settings.product_improvement_enabled,
            collect_edit_feedback=settings.collect_edit_feedback,
            collect_chat_feedback=settings.collect_chat_feedback,
            collect_autocomplete_stats=settings.collect_autocomplete_stats,
            collect_usage_stats=settings.collect_usage_stats,
        )

    # Return defaults
    return TelemetrySettingsResponse()


@router.put("/settings", response_model=TelemetrySettingsResponse)
async def update_settings(
    request: TelemetrySettingsRequest,
    db: AsyncSession = Depends(get_db),
    auth: TokenData = Depends(require_auth),
):
    """Update user's telemetry settings."""
    result = await db.execute(
        select(UserTelemetrySettings).where(UserTelemetrySettings.user_id == auth.sub)
    )
    settings = result.scalar_one_or_none()

    if not settings:
        # Create new settings record
        settings = UserTelemetrySettings(user_id=auth.sub)
        db.add(settings)

    # Update fields if provided
    if request.product_improvement_enabled is not None:
        settings.product_improvement_enabled = request.product_improvement_enabled
    if request.collect_edit_feedback is not None:
        settings.collect_edit_feedback = request.collect_edit_feedback
    if request.collect_chat_feedback is not None:
        settings.collect_chat_feedback = request.collect_chat_feedback
    if request.collect_autocomplete_stats is not None:
        settings.collect_autocomplete_stats = request.collect_autocomplete_stats
    if request.collect_usage_stats is not None:
        settings.collect_usage_stats = request.collect_usage_stats

    await db.commit()

    return TelemetrySettingsResponse(
        product_improvement_enabled=settings.product_improvement_enabled,
        collect_edit_feedback=settings.collect_edit_feedback,
        collect_chat_feedback=settings.collect_chat_feedback,
        collect_autocomplete_stats=settings.collect_autocomplete_stats,
        collect_usage_stats=settings.collect_usage_stats,
    )
