"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2, Crown, Zap, Rocket, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { PricingInfo } from "@/lib/api/billing";
import { useAuthStore } from "@/stores/auth-store";
import { useBillingStore } from "@/stores/billing-store";
import { useTranslations } from "next-intl";

interface PricingCardProps {
  name: string;
  icon: React.ReactNode;
  price: number;
  originalPrice?: number;
  period: string;
  description: string;
  features: string[];
  isCurrent: boolean;
  isPopular?: boolean;
  isLoading: boolean;
  onSelect: () => void;
  badge?: string;
  ctaLabel: string;
}

function PricingCard({
  name,
  icon,
  price,
  originalPrice,
  period,
  description,
  features,
  isCurrent,
  isPopular,
  isLoading,
  onSelect,
  badge,
  ctaLabel,
}: PricingCardProps) {
  return (
    <div
      className={cn(
        "relative flex flex-col rounded-xl border bg-card p-6 transition-shadow",
        isPopular ? "border-primary shadow-lg" : "border-border shadow-sm",
        isCurrent && "ring-2 ring-primary/20"
      )}
    >
      {badge && (
        <span className="absolute -top-3 left-4 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
          {badge}
        </span>
      )}
      <div className="mb-4 flex items-center gap-2">
        {icon}
        <h3 className="text-lg font-semibold">{name}</h3>
      </div>
      <div className="mb-2 flex items-baseline gap-1">
        <span className="text-4xl font-bold">${price}</span>
        {originalPrice && originalPrice > price && (
          <span className="text-lg text-muted-foreground line-through">${originalPrice}</span>
        )}
        <span className="text-sm text-muted-foreground">{period}</span>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">{description}</p>
      <ul className="mb-6 flex-1 space-y-2.5">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            {feature}
          </li>
        ))}
      </ul>
      <Button
        size="lg"
        variant={isPopular ? "default" : "outline"}
        className="w-full"
        disabled={isCurrent || isLoading}
        onClick={onSelect}
      >
        {isLoading ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : isCurrent ? (
          "Current Plan"
        ) : (
          ctaLabel
        )}
      </Button>
    </div>
  );
}

export default function PricingPage() {
  const router = useRouter();
  const t = useTranslations("billing");
  const { user, initialize: initAuth, isInitialized: authInitialized } = useAuthStore();
  const { plan, initialize: initBilling } = useBillingStore();
  const [pricing, setPricing] = useState<PricingInfo | null>(null);
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);

  useEffect(() => {
    initAuth();
  }, [initAuth]);

  useEffect(() => {
    if (authInitialized && user) {
      initBilling();
    }
  }, [authInitialized, user, initBilling]);

  useEffect(() => {
    api
      .getPricing()
      .then(setPricing)
      .catch(() => {});
  }, []);

  const handleUpgrade = async (targetPlan: "pro" | "max") => {
    if (!user) {
      window.location.href = "/login";
      return;
    }
    if (!pricing) return;

    setLoadingPlan(targetPlan);
    try {
      const priceId = targetPlan === "pro" ? pricing.pro_price_id : pricing.max_price_id;
      if (!priceId) {
        toast.error("Pricing not configured.");
        return;
      }
      const origin = window.location.origin;
      const { checkout_url } = await api.createCheckout(
        priceId,
        `${origin}/editor?billing=success&session_id={CHECKOUT_SESSION_ID}`,
        `${origin}/editor?billing=canceled`
      );
      window.location.href = checkout_url;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start checkout");
    } finally {
      setLoadingPlan(null);
    }
  };

  const earlyBirdRemaining = pricing?.early_bird_remaining ?? 0;
  const proPrice = pricing?.plans.pro.price ?? 4.99;
  const isEarlyBirdAvailable = earlyBirdRemaining > 0;

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="border-b border-border/40 bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2">
            <Logo variant="icon" size="sm" className="h-6 w-6" />
            <span className="font-semibold">doXmind</span>
          </Link>
          <div className="flex items-center gap-3">
            {!user && (
              <>
                <Link
                  href="/login"
                  className="inline-flex h-8 items-center rounded-md px-3 text-xs font-medium hover:bg-foreground/[0.06]"
                >
                  Log in
                </Link>
                <Link
                  href="/login"
                  className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground shadow hover:bg-primary/90"
                >
                  Sign up
                </Link>
              </>
            )}
            <button
              onClick={() => router.back()}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-foreground/[0.06]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </nav>

      {/* Header */}
      <div className="mx-auto max-w-5xl px-6 pt-16 text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("pricingTitle")}</h1>
        <p className="mt-3 text-lg text-muted-foreground">{t("pricingSubtitle")}</p>

        {isEarlyBirdAvailable && (
          <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-4 py-1.5 text-sm font-medium text-amber-600 dark:text-amber-400">
            <Crown className="h-4 w-4" />
            {t("earlyBirdDesc", { count: earlyBirdRemaining, price: "2.99" })}
          </div>
        )}
      </div>

      {/* Pricing Cards */}
      <div className="mx-auto mt-12 grid max-w-5xl grid-cols-1 gap-6 px-6 pb-20 md:grid-cols-3">
        <PricingCard
          name={t("free")}
          icon={<Zap className="h-5 w-5 text-muted-foreground" />}
          price={0}
          period={t("month")}
          description="For personal use and exploration."
          features={[
            "All AI features",
            "Chat, inline edit, autocomplete",
            "Knowledge base & web search",
            "100 MB storage",
            "PDF / DOCX / Markdown export",
          ]}
          isCurrent={plan === "free"}
          isLoading={false}
          onSelect={() => {
            if (!user) window.location.href = "/login";
          }}
          ctaLabel={user ? "Current Plan" : t("getStarted")}
        />

        <PricingCard
          name={t("pro")}
          icon={<Rocket className="h-5 w-5 text-primary" />}
          price={proPrice}
          originalPrice={isEarlyBirdAvailable ? 4.99 : undefined}
          period={t("month")}
          description="For regular writers and professionals."
          features={[
            "Everything in Free",
            "5x more AI usage",
            "500 MB storage",
            "14 premium themes",
            "Exclusive avatar frames",
            "Priority support",
          ]}
          isCurrent={plan === "pro"}
          isPopular
          isLoading={loadingPlan === "pro"}
          onSelect={() => handleUpgrade("pro")}
          badge={isEarlyBirdAvailable ? t("earlyBird") : t("popular")}
          ctaLabel={t("upgrade")}
        />

        <PricingCard
          name={t("max")}
          icon={<Crown className="h-5 w-5 text-amber-500" />}
          price={14.99}
          period={t("month")}
          description="For power users and teams."
          features={[
            "Everything in Pro",
            "15x more AI usage",
            "2 GB storage",
            "Animated avatar frames",
            "Early access to new features",
          ]}
          isCurrent={plan === "max"}
          isLoading={loadingPlan === "max"}
          onSelect={() => handleUpgrade("max")}
          ctaLabel={t("upgrade")}
        />
      </div>
    </div>
  );
}
