"use client";

import { ExternalLink, Crown, Rocket, Zap, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useBillingStore } from "@/stores/billing-store";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

export function PlanSettings() {
  const t = useTranslations("billing");
  const { plan, status, periodEnd, credits, storage, openPricingModal } = useBillingStore();
  const [isLoadingPortal, setIsLoadingPortal] = useState(false);

  const creditsPercentage =
    credits && credits.limit > 0 ? (credits.remaining / credits.limit) * 100 : 0;
  const isLow = creditsPercentage < 20;
  const isMedium = creditsPercentage >= 20 && creditsPercentage < 50;

  const storagePercentage =
    storage && storage.limit_bytes > 0 ? (storage.used_bytes / storage.limit_bytes) * 100 : 0;

  const handleManageSubscription = async () => {
    setIsLoadingPortal(true);
    try {
      const { portal_url } = await api.createPortal(window.location.href);
      window.location.href = portal_url;
    } catch {
      toast.error(t("portalFailed"));
    } finally {
      setIsLoadingPortal(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Current Plan Card */}
      <div className="rounded-lg border border-border p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {plan === "max" ? (
              <Crown className="h-4 w-4 text-amber-500" />
            ) : plan === "pro" ? (
              <Rocket className="h-4 w-4 text-primary" />
            ) : (
              <Zap className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="text-sm font-semibold">{plan ? t(plan) : "—"}</span>
            {status && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium",
                  status === "active" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                  status === "past_due" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                  status === "canceled" && "bg-red-500/10 text-red-600 dark:text-red-400"
                )}
              >
                {status === "active"
                  ? t("active")
                  : status === "past_due"
                    ? t("pastDue")
                    : t("canceled")}
              </span>
            )}
          </div>
        </div>
        {periodEnd && plan !== "free" && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("renewsOn", { date: new Date(periodEnd).toLocaleDateString() })}
          </p>
        )}
      </div>

      {/* Credits */}
      {credits && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t("credits")}</span>
            <span
              className={cn("font-medium", isLow && "text-red-500", isMedium && "text-amber-500")}
            >
              {Math.round(creditsPercentage)}% {t("remaining")}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-border">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                isLow && "bg-red-500",
                isMedium && "bg-amber-500",
                !isLow && !isMedium && "bg-emerald-500"
              )}
              style={{ width: `${Math.max(creditsPercentage, 1)}%` }}
            />
          </div>
          {credits.period_end && (
            <p className="text-xs text-muted-foreground">
              {t("creditsResetOn", { date: new Date(credits.period_end).toLocaleDateString() })}
            </p>
          )}
        </div>
      )}

      {/* Storage */}
      {storage && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t("storage")}</span>
            <span className="font-medium">
              {Math.round(storagePercentage)}% {t("used")}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-border">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                storagePercentage > 90
                  ? "bg-red-500"
                  : storagePercentage > 70
                    ? "bg-amber-500"
                    : "bg-emerald-500"
              )}
              style={{ width: `${Math.max(storagePercentage, 1)}%` }}
            />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <Button onClick={openPricingModal} className="w-full">
          {plan === "free" ? t("upgradePlan") : t("choosePlan")}
        </Button>
        {plan !== "free" && (
          <Button
            variant="outline"
            onClick={handleManageSubscription}
            disabled={isLoadingPortal}
            className="w-full"
          >
            {isLoadingPortal ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ExternalLink className="mr-2 h-4 w-4" />
            )}
            {t("manageSub")}
          </Button>
        )}
      </div>
    </div>
  );
}
