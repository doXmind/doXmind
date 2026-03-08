"use client";

import { useEffect } from "react";
import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useBillingStore } from "@/stores/billing-store";
import { useAuthStore } from "@/stores/auth-store";

export function CreditsDisplay() {
  const { user } = useAuthStore();
  const { credits, plan, isInitialized, initialize, openUpgradeModal } = useBillingStore();

  useEffect(() => {
    if (user && !isInitialized) {
      initialize();
    }
  }, [user, isInitialized, initialize]);

  // Don't show for unauthenticated users
  if (!user || !credits) return null;

  const percentage = credits.limit > 0 ? (credits.remaining / credits.limit) * 100 : 0;
  const isLow = percentage < 20;
  const isMedium = percentage >= 20 && percentage < 50;

  const tooltipContent = `${Math.round(percentage)}% AI usage remaining`;

  return (
    <Tooltip content={tooltipContent} side="bottom">
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "h-8 gap-1.5 px-2 text-xs font-medium",
          isLow && "text-red-500 hover:text-red-600",
          isMedium && "text-amber-500 hover:text-amber-600",
          !isLow && !isMedium && "text-muted-foreground hover:text-foreground"
        )}
        onClick={() => {
          if (plan === "free" || isLow) {
            openUpgradeModal("View plan details");
          }
        }}
      >
        <Zap className={cn("h-3.5 w-3.5", isLow && "animate-pulse")} />
        <span>{Math.round(percentage)}%</span>
        {/* Mini progress bar */}
        <div className="h-1.5 w-8 overflow-hidden rounded-full bg-border">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              isLow && "bg-red-500",
              isMedium && "bg-amber-500",
              !isLow && !isMedium && "bg-emerald-500"
            )}
            style={{ width: `${Math.max(percentage, 2)}%` }}
          />
        </div>
      </Button>
    </Tooltip>
  );
}
