"""Credit management service.

Handles credit balance checks, deductions, period resets, and plan changes.
All credit values are stored as internal units (display = internal * 10).
"""

import logging
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from db.database import CreditTransaction, UserCredits, UserSubscription, async_session

logger = logging.getLogger(__name__)

# Plan credit allocations (internal units)
PLAN_CREDITS = {
    "free": 600,
    "pro": 3000,
    "max": 10000,
}


def _next_month_first() -> datetime:
    """Get midnight UTC of the 1st of next month.

    Used for free-tier credit period boundaries so all free users
    reset on the same calendar date (the 1st of each month).
    """
    now = datetime.now(UTC)
    if now.month == 12:
        return datetime(now.year + 1, 1, 1, tzinfo=UTC)
    return datetime(now.year, now.month + 1, 1, tzinfo=UTC)


def cost_to_credits(cost_usd: float | None) -> int:
    """Convert OpenRouter USD cost to internal credit units.

    Args:
        cost_usd: The actual cost from OpenRouter response.

    Returns:
        Number of internal credits to deduct (minimum 1).
    """
    settings = get_settings()
    if cost_usd is None or cost_usd <= 0:
        return settings.min_credits_per_request
    credits = round(cost_usd / settings.credit_cost_usd)
    return max(credits, settings.min_credits_per_request)


class CreditService:
    """Manages user credit balances."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_or_create_credits(self, user_id: str, for_update: bool = False) -> UserCredits:
        """Get user credits row, creating with free tier defaults if missing.

        Args:
            user_id: The user to get credits for.
            for_update: If True, acquires a row-level lock (SELECT FOR UPDATE)
                        to prevent concurrent modification race conditions.
        """
        query = select(UserCredits).where(UserCredits.user_id == user_id)
        if for_update:
            query = query.with_for_update()
        result = await self.db.execute(query)
        credits = result.scalar_one_or_none()

        if credits is None:
            now = datetime.now(UTC)
            credits = UserCredits(
                user_id=user_id,
                credits_remaining=PLAN_CREDITS["free"],
                credits_limit=PLAN_CREDITS["free"],
                period_start=now,
                period_end=_next_month_first(),
                credits_used_this_period=0,
            )
            self.db.add(credits)
            await self.db.commit()
            # Re-fetch with lock if needed
            if for_update:
                result = await self.db.execute(
                    select(UserCredits).where(UserCredits.user_id == user_id).with_for_update()
                )
                credits = result.scalar_one()
            else:
                await self.db.refresh(credits)

        return credits

    async def check_credits(self, user_id: str, is_byok: bool = False) -> bool:
        """Pre-flight check: does the user have credits remaining?

        BYOK users always pass for LLM usage (their cost is on their own key).
        Returns False if non-BYOK user has 0 credits or subscription is past_due.
        """
        if is_byok:
            return True

        # Check subscription status (past_due users are blocked)
        result = await self.db.execute(
            select(UserSubscription.status).where(UserSubscription.user_id == user_id)
        )
        status = result.scalar_one_or_none()
        if status == "past_due":
            return False

        credits = await self.get_or_create_credits(user_id)

        # Lazy period reset check
        await self._maybe_reset_period(credits)

        return credits.credits_remaining > 0

    async def deduct_credits(
        self,
        user_id: str,
        cost_usd: float | None,
        service: str,
        is_byok: bool = False,
    ) -> int:
        """Deduct credits based on OpenRouter cost.

        Skips deduction for BYOK LLM usage. Always deducts for server-side
        services like web_search.

        Returns:
            Credits remaining after deduction.
        """
        if is_byok and service != "web_search":
            # BYOK users don't consume credits for LLM calls
            credits = await self.get_or_create_credits(user_id)
            return credits.credits_remaining

        credits_to_deduct = cost_to_credits(cost_usd)
        return await self._apply_deduction(user_id, credits_to_deduct, service)

    async def deduct_fixed_credits(
        self,
        user_id: str,
        amount: int,
        service: str,
    ) -> int:
        """Deduct a fixed amount of credits (e.g., for web search).

        Returns:
            Credits remaining after deduction.
        """
        return await self._apply_deduction(user_id, amount, service)

    async def _apply_deduction(self, user_id: str, amount: int, service: str) -> int:
        """Apply a credit deduction and record the transaction.

        Uses SELECT FOR UPDATE to prevent concurrent deduction race conditions.
        """
        credits = await self.get_or_create_credits(user_id, for_update=True)

        # Lazy period reset check
        await self._maybe_reset_period(credits)

        # Deduct (don't go below 0)
        actual_deduction = min(amount, credits.credits_remaining)
        credits.credits_remaining -= actual_deduction
        credits.credits_used_this_period += actual_deduction
        credits.updated_at = datetime.now(UTC)

        # Record transaction
        transaction = CreditTransaction(
            id=str(uuid.uuid4()),
            user_id=user_id,
            amount=-actual_deduction,
            balance_after=credits.credits_remaining,
            transaction_type="deduction",
            service=service,
        )
        self.db.add(transaction)
        await self.db.commit()

        return credits.credits_remaining

    async def reset_credits(
        self,
        user_id: str,
        new_limit: int | None = None,
        period_end: datetime | None = None,
    ) -> None:
        """Reset credits to period limit. Called by webhook or lazy check.

        Args:
            user_id: The user whose credits to reset.
            new_limit: If provided, update the credits_limit before reset.
            period_end: Explicit period end (e.g. from Stripe billing cycle).
                        If None, defaults to the 1st of next month (free tier).
        """
        credits = await self.get_or_create_credits(user_id, for_update=True)

        if new_limit is not None:
            credits.credits_limit = new_limit

        now = datetime.now(UTC)
        old_remaining = credits.credits_remaining
        credits.credits_remaining = credits.credits_limit
        credits.credits_used_this_period = 0
        credits.period_start = now
        credits.period_end = period_end or _next_month_first()
        credits.updated_at = now

        # Record the reset
        grant_amount = credits.credits_limit - old_remaining
        transaction = CreditTransaction(
            id=str(uuid.uuid4()),
            user_id=user_id,
            amount=grant_amount,
            balance_after=credits.credits_remaining,
            transaction_type="period_reset",
            description=f"Period reset to {credits.credits_limit} credits",
        )
        self.db.add(transaction)
        await self.db.commit()

    async def _maybe_reset_period(self, credits: UserCredits) -> bool:
        """Lazy reset: check if period has ended, reset if so.

        Free users reset on the 1st of each month.
        Paid users reset according to their Stripe billing cycle.

        Returns True if a reset occurred.
        """
        now = datetime.now(UTC)
        if credits.period_end and credits.period_end <= now:
            # Period expired - determine the correct limit from user's plan
            result = await self.db.execute(
                select(UserSubscription).where(UserSubscription.user_id == credits.user_id)
            )
            sub = result.scalar_one_or_none()
            plan = sub.plan if sub else "free"
            new_limit = PLAN_CREDITS.get(plan, PLAN_CREDITS["free"])

            credits.credits_limit = new_limit
            credits.credits_remaining = new_limit
            credits.credits_used_this_period = 0
            credits.period_start = now

            # Set next period_end based on plan type
            if plan == "free":
                credits.period_end = _next_month_first()
            elif sub and sub.current_period_end and sub.current_period_end > now:
                # Paid user: align with Stripe billing cycle
                credits.period_end = sub.current_period_end
            else:
                # Fallback: 30 days from now
                credits.period_end = now + timedelta(days=30)

            credits.updated_at = now

            transaction = CreditTransaction(
                id=str(uuid.uuid4()),
                user_id=credits.user_id,
                amount=new_limit,
                balance_after=new_limit,
                transaction_type="period_reset",
                description=f"Lazy period reset ({plan} plan)",
            )
            self.db.add(transaction)
            await self.db.commit()

            logger.info(f"Lazy credit reset for user {credits.user_id}: {new_limit} credits")
            return True
        return False

    async def update_plan_limits(self, user_id: str, plan: str, is_upgrade: bool = True) -> None:
        """Update credit limits when plan changes.

        On upgrade: immediately grant the difference.
        On downgrade: take effect at next period reset.
        """
        credits = await self.get_or_create_credits(user_id)
        new_limit = PLAN_CREDITS.get(plan, PLAN_CREDITS["free"])

        if is_upgrade and new_limit > credits.credits_limit:
            # Grant additional credits immediately
            additional = new_limit - credits.credits_limit
            credits.credits_limit = new_limit
            credits.credits_remaining += additional
            credits.updated_at = datetime.now(UTC)

            transaction = CreditTransaction(
                id=str(uuid.uuid4()),
                user_id=user_id,
                amount=additional,
                balance_after=credits.credits_remaining,
                transaction_type="plan_change",
                description=f"Upgrade to {plan}: +{additional} credits",
            )
            self.db.add(transaction)
        else:
            # Downgrade: just update the limit, takes effect at next reset
            credits.credits_limit = new_limit
            credits.updated_at = datetime.now(UTC)

        await self.db.commit()

    async def get_credits_info(self, user_id: str) -> dict:
        """Get credit balance info formatted for the API response."""
        settings = get_settings()
        credits = await self.get_or_create_credits(user_id)

        # Lazy period reset check
        await self._maybe_reset_period(credits)

        multiplier = settings.credit_display_multiplier
        return {
            "remaining": credits.credits_remaining,
            "limit": credits.credits_limit,
            "used": credits.credits_used_this_period,
            "display_remaining": credits.credits_remaining * multiplier,
            "display_limit": credits.credits_limit * multiplier,
            "display_used": credits.credits_used_this_period * multiplier,
            "period_end": credits.period_end.isoformat() if credits.period_end else None,
        }


async def deduct_credits_for_usage(
    user_id: str | None,
    cost: float | None,
    service: str,
    is_byok: bool = False,
    web_search_count: int = 0,
    _retry_count: int = 0,
) -> int | None:
    """Credit deduction with retry on failure.

    Call this from any endpoint after usage is complete.
    Retries up to 2 times on transient errors to avoid silent credit leakage.

    Args:
        user_id: The user to charge.
        cost: OpenRouter USD cost (for LLM calls).
        service: Service name (chat, autocomplete, etc.).
        is_byok: Whether the user used their own API key.
        web_search_count: Number of web search calls in this request.

    Returns:
        Credits remaining after deduction, or None on error.
    """
    MAX_RETRIES = 2

    if not user_id or user_id == "anonymous":
        return None

    try:
        async with async_session() as session:
            credit_service = CreditService(session)

            remaining = None

            # Deduct LLM usage credits
            if cost is not None and cost > 0:
                remaining = await credit_service.deduct_credits(user_id, cost, service, is_byok)

            # Deduct web search credits (always charged, even for BYOK)
            if web_search_count > 0:
                settings = get_settings()
                search_credits = web_search_count * settings.serper_search_credits
                remaining = await credit_service.deduct_fixed_credits(
                    user_id, search_credits, "web_search"
                )

            return remaining

    except Exception as e:
        if _retry_count < MAX_RETRIES:
            import asyncio

            await asyncio.sleep(0.5 * (_retry_count + 1))
            logger.warning(
                f"Retrying credit deduction for {service} "
                f"(attempt {_retry_count + 2}/{MAX_RETRIES + 1}): {e}"
            )
            return await deduct_credits_for_usage(
                user_id,
                cost,
                service,
                is_byok,
                web_search_count,
                _retry_count=_retry_count + 1,
            )

        logger.error(
            f"CRITICAL: Failed to deduct credits for {service} after "
            f"{MAX_RETRIES + 1} attempts. user={user_id} cost={cost} "
            f"web_searches={web_search_count}: {e}"
        )
        return None
