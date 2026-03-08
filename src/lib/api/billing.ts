/**
 * Billing API methods - extends ApiClient prototype
 */

import { ApiClient } from "./client";

// =============================================================================
// Types
// =============================================================================

export interface CreditsInfo {
  remaining: number;
  limit: number;
  used: number;
  display_remaining: number;
  display_limit: number;
  display_used: number;
  period_end: string | null;
}

export interface StorageInfo {
  used_bytes: number;
  limit_bytes: number;
}

export interface BillingStatus {
  plan: "free" | "pro" | "max";
  is_early_bird: boolean;
  status: "active" | "past_due" | "canceled";
  period_end: string | null;
  credits: CreditsInfo;
  storage: StorageInfo;
  early_bird_remaining: number;
}

export interface PlanInfo {
  credits: number;
  display_credits: number;
  storage_mb: number;
  price: number;
  is_early_bird_available?: boolean;
}

export interface PricingInfo {
  early_bird_remaining: number;
  pro_price_id: string;
  max_price_id: string;
  plans: {
    free: PlanInfo;
    pro: PlanInfo;
    max: PlanInfo;
  };
}

export interface CheckoutResponse {
  checkout_url: string;
}

export interface PortalResponse {
  portal_url: string;
}

export interface VerifyCheckoutResponse extends BillingStatus {}

// =============================================================================
// Module Augmentation
// =============================================================================

declare module "./client" {
  interface ApiClient {
    getBillingStatus(): Promise<BillingStatus>;
    getPricing(): Promise<PricingInfo>;
    createCheckout(
      priceId: string,
      successUrl: string,
      cancelUrl: string
    ): Promise<CheckoutResponse>;
    createPortal(returnUrl: string): Promise<PortalResponse>;
    verifyCheckout(sessionId: string): Promise<VerifyCheckoutResponse>;
  }
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Get current billing status including plan, credits, and storage.
 */
ApiClient.prototype.getBillingStatus = async function (this: ApiClient): Promise<BillingStatus> {
  return this.request<BillingStatus>("/api/billing/status");
};

/**
 * Get public pricing information.
 */
ApiClient.prototype.getPricing = async function (this: ApiClient): Promise<PricingInfo> {
  return this.request<PricingInfo>("/api/billing/pricing");
};

/**
 * Create a Stripe Checkout Session for subscription purchase.
 */
ApiClient.prototype.createCheckout = async function (
  this: ApiClient,
  priceId: string,
  successUrl: string,
  cancelUrl: string
): Promise<CheckoutResponse> {
  return this.request<CheckoutResponse>("/api/billing/checkout", {
    method: "POST",
    body: JSON.stringify({
      price_id: priceId,
      success_url: successUrl,
      cancel_url: cancelUrl,
    }),
  });
};

/**
 * Create a Stripe Customer Portal session for subscription management.
 */
ApiClient.prototype.createPortal = async function (
  this: ApiClient,
  returnUrl: string
): Promise<PortalResponse> {
  return this.request<PortalResponse>("/api/billing/portal", {
    method: "POST",
    body: JSON.stringify({ return_url: returnUrl }),
  });
};

/**
 * Verify a completed Stripe Checkout Session and activate the subscription.
 */
ApiClient.prototype.verifyCheckout = async function (
  this: ApiClient,
  sessionId: string
): Promise<VerifyCheckoutResponse> {
  return this.request<VerifyCheckoutResponse>("/api/billing/verify-checkout", {
    method: "POST",
    body: JSON.stringify({ session_id: sessionId }),
  });
};
