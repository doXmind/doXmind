"""Stripe billing service.

Handles subscription creation, management, and webhook event processing.
"""

import logging
from datetime import UTC, datetime

import stripe
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from db.database import UserSubscription, utcnow
from services.credit_service import PLAN_CREDITS, CreditService
from services.storage_tracker import PLAN_STORAGE_LIMITS, StorageTracker

logger = logging.getLogger(__name__)


def _init_stripe() -> None:
    """Initialize Stripe SDK with API key."""
    settings = get_settings()
    stripe.api_key = settings.stripe_secret_key


def _price_id_to_plan(price_id: str) -> str:
    """Map a Stripe Price ID to our plan name."""
    settings = get_settings()
    if price_id in (settings.stripe_price_pro_early_bird, settings.stripe_price_pro_regular):
        return "pro"
    if price_id == settings.stripe_price_max:
        return "max"
    return "free"


class BillingService:
    """Manages Stripe subscriptions and billing."""

    def __init__(self, db: AsyncSession):
        self.db = db
        _init_stripe()

    async def _get_or_create_subscription(self, user_id: str) -> UserSubscription:
        """Get user subscription, creating free tier default if missing."""
        result = await self.db.execute(
            select(UserSubscription).where(UserSubscription.user_id == user_id)
        )
        sub = result.scalar_one_or_none()

        if sub is None:
            sub = UserSubscription(
                user_id=user_id,
                plan="free",
                status="active",
                storage_used_bytes=0,
                storage_limit_bytes=PLAN_STORAGE_LIMITS["free"],
            )
            self.db.add(sub)
            await self.db.commit()
            await self.db.refresh(sub)

        return sub

    async def get_billing_status(self, user_id: str) -> dict:
        """Get current subscription, plan, and credit balance."""
        sub = await self._get_or_create_subscription(user_id)
        credit_service = CreditService(self.db)
        credits_info = await credit_service.get_credits_info(user_id)
        storage_tracker = StorageTracker(self.db)
        storage_info = await storage_tracker.get_usage(user_id)

        return {
            "plan": sub.plan,
            "is_early_bird": sub.is_early_bird,
            "status": sub.status,
            "period_end": sub.current_period_end.isoformat() if sub.current_period_end else None,
            "credits": credits_info,
            "storage": storage_info,
        }

    async def create_checkout_session(
        self,
        user_id: str,
        user_email: str,
        price_id: str,
        success_url: str,
        cancel_url: str,
    ) -> str:
        """Create a Stripe Checkout Session.

        Returns:
            The checkout URL to redirect the user to.
        """
        sub = await self._get_or_create_subscription(user_id)

        # Create or reuse Stripe Customer
        if not sub.stripe_customer_id:
            customer = stripe.Customer.create(
                email=user_email,
                metadata={"user_id": user_id},
            )
            sub.stripe_customer_id = customer.id
            await self.db.commit()

        session = stripe.checkout.Session.create(
            customer=sub.stripe_customer_id,
            mode="subscription",
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={"user_id": user_id},
        )

        return session.url

    async def create_portal_session(self, user_id: str, return_url: str) -> str:
        """Create a Stripe Customer Portal session.

        Returns:
            The portal URL to redirect the user to.
        """
        sub = await self._get_or_create_subscription(user_id)

        if not sub.stripe_customer_id:
            raise ValueError("User has no Stripe customer ID")

        session = stripe.billing_portal.Session.create(
            customer=sub.stripe_customer_id,
            return_url=return_url,
        )

        return session.url

    async def get_pro_price_id(self) -> str:
        """Get the correct Pro price ID based on early bird availability."""
        settings = get_settings()

        count_result = await self.db.execute(
            select(func.count()).where(UserSubscription.is_early_bird.is_(True))
        )
        early_bird_count = count_result.scalar() or 0

        if early_bird_count < settings.early_bird_limit:
            return settings.stripe_price_pro_early_bird
        return settings.stripe_price_pro_regular

    async def get_early_bird_remaining(self) -> int:
        """Get number of early bird slots remaining."""
        settings = get_settings()
        count_result = await self.db.execute(
            select(func.count()).where(UserSubscription.is_early_bird.is_(True))
        )
        early_bird_count = count_result.scalar() or 0
        return max(0, settings.early_bird_limit - early_bird_count)

    # =========================================================================
    # Stripe Webhook Handlers
    # =========================================================================

    async def handle_checkout_completed(self, session_data: dict) -> None:
        """Process checkout.session.completed webhook event.

        Creates or updates the user's subscription with the new plan.
        """
        user_id = session_data.get("metadata", {}).get("user_id")
        if not user_id:
            logger.error("checkout.session.completed missing user_id in metadata")
            return

        subscription_id = session_data.get("subscription")
        customer_id = session_data.get("customer")

        if not subscription_id:
            logger.error("checkout.session.completed missing subscription ID")
            return

        # Fetch the Stripe subscription to get plan details
        stripe_sub = stripe.Subscription.retrieve(subscription_id)
        price_id = stripe_sub["items"]["data"][0]["price"]["id"]
        plan = _price_id_to_plan(price_id)

        sub = await self._get_or_create_subscription(user_id)

        # Idempotency: skip if this checkout was already processed
        if (
            sub.stripe_subscription_id == subscription_id
            and sub.plan == plan
            and sub.status == "active"
        ):
            logger.info(f"checkout.session.completed: already processed for user={user_id}")
            return

        sub.stripe_customer_id = customer_id
        sub.stripe_subscription_id = subscription_id
        sub.plan = plan
        sub.status = "active"

        # Set billing cycle from Stripe
        sub.current_period_start = datetime.fromtimestamp(
            stripe_sub["current_period_start"], tz=UTC
        )
        sub.current_period_end = datetime.fromtimestamp(stripe_sub["current_period_end"], tz=UTC)

        # Early bird check with row locking to prevent overselling.
        # Lock all existing early bird rows so concurrent checkouts must wait.
        settings = get_settings()
        if price_id == settings.stripe_price_pro_early_bird:
            locked_result = await self.db.execute(
                select(UserSubscription.user_id)
                .where(UserSubscription.is_early_bird.is_(True))
                .with_for_update()
            )
            early_bird_count = len(locked_result.all())
            if early_bird_count < settings.early_bird_limit:
                sub.is_early_bird = True

        # Update storage limit
        sub.storage_limit_bytes = PLAN_STORAGE_LIMITS.get(plan, PLAN_STORAGE_LIMITS["free"])

        await self.db.commit()

        # Reset credits to new plan level, aligned with Stripe billing cycle
        credit_service = CreditService(self.db)
        new_limit = PLAN_CREDITS.get(plan, PLAN_CREDITS["free"])
        await credit_service.reset_credits(
            user_id, new_limit=new_limit, period_end=sub.current_period_end
        )

        logger.info(
            f"Checkout completed: user={user_id} plan={plan} early_bird={sub.is_early_bird}"
        )

    async def handle_invoice_paid(self, invoice_data: dict) -> None:
        """Process invoice.paid webhook event.

        Resets credits on subscription renewal. Idempotent: skips if the
        billing period hasn't actually changed (handles Stripe retries).
        """
        customer_id = invoice_data.get("customer")
        subscription_id = invoice_data.get("subscription")

        if not customer_id or not subscription_id:
            return

        result = await self.db.execute(
            select(UserSubscription).where(UserSubscription.stripe_customer_id == customer_id)
        )
        sub = result.scalar_one_or_none()
        if not sub:
            logger.warning(f"invoice.paid: no subscription found for customer {customer_id}")
            return

        # Update billing cycle
        stripe_sub = stripe.Subscription.retrieve(subscription_id)
        new_period_start = datetime.fromtimestamp(stripe_sub["current_period_start"], tz=UTC)
        new_period_end = datetime.fromtimestamp(stripe_sub["current_period_end"], tz=UTC)

        # Idempotency: skip if period hasn't changed (duplicate webhook)
        if sub.current_period_start and sub.current_period_start == new_period_start:
            logger.info(
                f"invoice.paid: duplicate webhook for customer {customer_id}, "
                f"period_start unchanged ({new_period_start}). Skipping."
            )
            sub.status = "active"
            await self.db.commit()
            return

        sub.current_period_start = new_period_start
        sub.current_period_end = new_period_end
        sub.status = "active"
        await self.db.commit()

        # Reset credits, aligned with Stripe billing cycle
        credit_service = CreditService(self.db)
        new_limit = PLAN_CREDITS.get(sub.plan, PLAN_CREDITS["free"])
        await credit_service.reset_credits(
            sub.user_id, new_limit=new_limit, period_end=new_period_end
        )

        logger.info(
            f"Invoice paid: user={sub.user_id} plan={sub.plan} credits reset to {new_limit}"
        )

    async def handle_subscription_updated(self, subscription_data: dict) -> None:
        """Process customer.subscription.updated webhook event.

        Handles mid-cycle plan changes (upgrades/downgrades).
        """
        subscription_id = subscription_data.get("id")

        result = await self.db.execute(
            select(UserSubscription).where(
                UserSubscription.stripe_subscription_id == subscription_id
            )
        )
        sub = result.scalar_one_or_none()
        if not sub:
            logger.warning(f"subscription.updated: no record for subscription {subscription_id}")
            return

        # Determine new plan
        price_id = subscription_data["items"]["data"][0]["price"]["id"]
        new_plan = _price_id_to_plan(price_id)
        old_plan = sub.plan

        if new_plan == old_plan:
            return  # No plan change

        is_upgrade = PLAN_CREDITS.get(new_plan, 0) > PLAN_CREDITS.get(old_plan, 0)

        sub.plan = new_plan
        sub.status = subscription_data.get("status", "active")

        # Update billing cycle
        sub.current_period_start = datetime.fromtimestamp(
            subscription_data["current_period_start"], tz=UTC
        )
        sub.current_period_end = datetime.fromtimestamp(
            subscription_data["current_period_end"], tz=UTC
        )

        # Update storage limit
        sub.storage_limit_bytes = PLAN_STORAGE_LIMITS.get(new_plan, PLAN_STORAGE_LIMITS["free"])

        await self.db.commit()

        # Update credit limits
        credit_service = CreditService(self.db)
        await credit_service.update_plan_limits(sub.user_id, new_plan, is_upgrade=is_upgrade)

        logger.info(
            f"Subscription updated: user={sub.user_id} "
            f"{old_plan} -> {new_plan} (upgrade={is_upgrade})"
        )

    async def handle_subscription_deleted(self, subscription_data: dict) -> None:
        """Process customer.subscription.deleted webhook event.

        Downgrades user to free tier.
        """
        subscription_id = subscription_data.get("id")

        result = await self.db.execute(
            select(UserSubscription).where(
                UserSubscription.stripe_subscription_id == subscription_id
            )
        )
        sub = result.scalar_one_or_none()
        if not sub:
            logger.warning(f"subscription.deleted: no record for subscription {subscription_id}")
            return

        old_plan = sub.plan
        sub.plan = "free"
        sub.status = "canceled"
        sub.stripe_subscription_id = None
        sub.canceled_at = utcnow()
        sub.storage_limit_bytes = PLAN_STORAGE_LIMITS["free"]
        await self.db.commit()

        # Downgrade credits (takes effect at next reset)
        credit_service = CreditService(self.db)
        await credit_service.update_plan_limits(sub.user_id, "free", is_upgrade=False)

        logger.info(f"Subscription deleted: user={sub.user_id} {old_plan} -> free")

    async def handle_payment_failed(self, invoice_data: dict) -> None:
        """Process invoice.payment_failed webhook event.

        Marks subscription as past_due.
        """
        customer_id = invoice_data.get("customer")

        result = await self.db.execute(
            select(UserSubscription).where(UserSubscription.stripe_customer_id == customer_id)
        )
        sub = result.scalar_one_or_none()
        if not sub:
            return

        sub.status = "past_due"
        await self.db.commit()

        logger.warning(f"Payment failed: user={sub.user_id} status=past_due")
