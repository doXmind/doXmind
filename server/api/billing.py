"""Billing API endpoints for subscription management and Stripe webhooks."""

import logging

import stripe
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from db.database import User, get_db
from exceptions import BadRequestError
from services.auth_service import TokenData, require_auth
from services.billing_service import BillingService

logger = logging.getLogger(__name__)
router = APIRouter()


# ============================================================================
# Request/Response Models
# ============================================================================


class CheckoutRequest(BaseModel):
    """Request to create a Stripe Checkout Session."""

    price_id: str
    success_url: str
    cancel_url: str


class PortalRequest(BaseModel):
    """Request to create a Stripe Customer Portal session."""

    return_url: str


# ============================================================================
# Billing Status
# ============================================================================


@router.get("/status")
async def get_billing_status(
    db: AsyncSession = Depends(get_db),
    auth: TokenData = Depends(require_auth),
):
    """Get current subscription, plan, and credit balance."""
    billing = BillingService(db)
    status = await billing.get_billing_status(auth.sub)

    # Include early bird availability
    early_bird_remaining = await billing.get_early_bird_remaining()
    status["early_bird_remaining"] = early_bird_remaining

    return status


# ============================================================================
# Checkout & Portal
# ============================================================================


@router.post("/checkout")
async def create_checkout(
    request: CheckoutRequest,
    db: AsyncSession = Depends(get_db),
    auth: TokenData = Depends(require_auth),
):
    """Create a Stripe Checkout Session for subscription purchase.

    Returns the checkout URL to redirect the user to.
    """
    from sqlalchemy import select

    # Validate price_id against known Stripe prices (whitelist)
    settings = get_settings()
    allowed_price_ids = {
        settings.stripe_price_pro_early_bird,
        settings.stripe_price_pro_regular,
        settings.stripe_price_max,
    }
    # Remove None/empty values from the set
    allowed_price_ids = {p for p in allowed_price_ids if p}
    if request.price_id not in allowed_price_ids:
        raise BadRequestError(message="Invalid price ID")

    # Get user email for Stripe Customer creation
    result = await db.execute(select(User.email).where(User.id == auth.sub))
    user_email = result.scalar_one_or_none()
    if not user_email:
        raise BadRequestError(message="User not found")

    billing = BillingService(db)
    checkout_url = await billing.create_checkout_session(
        user_id=auth.sub,
        user_email=user_email,
        price_id=request.price_id,
        success_url=request.success_url,
        cancel_url=request.cancel_url,
    )

    return {"checkout_url": checkout_url}


@router.post("/portal")
async def create_portal(
    request: PortalRequest,
    db: AsyncSession = Depends(get_db),
    auth: TokenData = Depends(require_auth),
):
    """Create a Stripe Customer Portal session for subscription management.

    Returns the portal URL to redirect the user to.
    """
    billing = BillingService(db)
    try:
        portal_url = await billing.create_portal_session(
            user_id=auth.sub,
            return_url=request.return_url,
        )
    except ValueError as e:
        raise BadRequestError(message=str(e))

    return {"portal_url": portal_url}


# ============================================================================
# Checkout Verification
# ============================================================================


class VerifyCheckoutRequest(BaseModel):
    """Request to verify and activate a completed Stripe Checkout Session."""

    session_id: str


@router.post("/verify-checkout")
async def verify_checkout(
    request: VerifyCheckoutRequest,
    db: AsyncSession = Depends(get_db),
    auth: TokenData = Depends(require_auth),
):
    """Verify a Stripe Checkout Session and activate the subscription.

    Called by the frontend after redirect from Stripe to ensure the
    subscription is activated even if the webhook hasn't arrived yet.
    """
    billing = BillingService(db)
    result = await billing.verify_and_activate_checkout(auth.sub, request.session_id)

    # Include early bird availability
    early_bird_remaining = await billing.get_early_bird_remaining()
    result["early_bird_remaining"] = early_bird_remaining

    return result


# ============================================================================
# Pricing Info
# ============================================================================


@router.get("/pricing")
async def get_pricing_info(
    db: AsyncSession = Depends(get_db),
):
    """Get public pricing information including early bird availability."""
    billing = BillingService(db)
    early_bird_remaining = await billing.get_early_bird_remaining()
    pro_price_id = await billing.get_pro_price_id()

    settings = get_settings()
    return {
        "early_bird_remaining": early_bird_remaining,
        "pro_price_id": pro_price_id,
        "max_price_id": settings.stripe_price_max,
        "plans": {
            "free": {
                "credits": 600,
                "display_credits": 6000,
                "storage_mb": 100,
                "price": 0,
            },
            "pro": {
                "credits": 3000,
                "display_credits": 30000,
                "storage_mb": 500,
                "price": 2.99 if early_bird_remaining > 0 else 4.99,
                "is_early_bird_available": early_bird_remaining > 0,
            },
            "max": {
                "credits": 10000,
                "display_credits": 100000,
                "storage_mb": 2048,
                "price": 14.99,
            },
        },
    }


# ============================================================================
# Stripe Webhook
# ============================================================================


@router.post("/webhook")
async def stripe_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Stripe webhook endpoint.

    Verifies the webhook signature and dispatches events to handlers.
    This endpoint does NOT require authentication - Stripe signs the payload.
    """
    settings = get_settings()
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")

    if not sig_header:
        raise BadRequestError(message="Missing Stripe signature")

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, settings.stripe_webhook_secret)
    except stripe.error.SignatureVerificationError:
        logger.warning("Stripe webhook signature verification failed")
        raise BadRequestError(message="Invalid signature")
    except ValueError:
        raise BadRequestError(message="Invalid payload")

    event_type = event["type"]
    event_data = event["data"]["object"]

    logger.info(f"Stripe webhook received: {event_type}")

    billing = BillingService(db)

    match event_type:
        case "checkout.session.completed":
            await billing.handle_checkout_completed(event_data)
        case "invoice.paid":
            await billing.handle_invoice_paid(event_data)
        case "customer.subscription.updated":
            await billing.handle_subscription_updated(event_data)
        case "customer.subscription.deleted":
            await billing.handle_subscription_deleted(event_data)
        case "invoice.payment_failed":
            await billing.handle_payment_failed(event_data)
        case _:
            logger.info(f"Unhandled Stripe event: {event_type}")

    return {"status": "ok"}
