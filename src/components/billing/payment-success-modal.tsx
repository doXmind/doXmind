"use client";

import { CheckCircle, Loader2, Sparkles } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useBillingStore } from "@/stores/billing-store";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

interface PaymentSuccessModalProps {
  open: boolean;
  onClose: () => void;
}

export function PaymentSuccessModal({ open, onClose }: PaymentSuccessModalProps) {
  const t = useTranslations("billing");
  const { plan, credits } = useBillingStore();

  const planDisplayName = plan ? t(plan as "free" | "pro" | "max") : "";

  // Still waiting for subscription to activate
  const isProcessing = plan === "free" || plan === null;

  return (
    <Modal open={open} onClose={onClose}>
      <div className="flex flex-col items-center text-center">
        {/* Icon */}
        <div
          className={cn(
            "mb-4 flex h-16 w-16 items-center justify-center rounded-full",
            isProcessing ? "bg-amber-500/10 text-amber-500" : "bg-emerald-500/10 text-emerald-500"
          )}
        >
          {isProcessing ? (
            <Loader2 className="h-8 w-8 animate-spin" />
          ) : (
            <CheckCircle className="h-8 w-8" />
          )}
        </div>

        {/* Title */}
        <h2 className="text-xl font-semibold">
          {isProcessing ? t("successProcessing") : t("successTitle")}
        </h2>

        {/* Subtitle */}
        <p className="mt-2 text-sm text-muted-foreground">
          {isProcessing ? t("successProcessingDesc") : t("successDesc", { plan: planDisplayName })}
        </p>

        {/* Plan details (shown when plan is confirmed) */}
        {!isProcessing && credits && (
          <div className="mt-4 w-full rounded-lg border border-border bg-muted/30 p-4">
            <div className="flex items-center justify-center gap-2 text-sm font-medium">
              <Sparkles className="h-4 w-4 text-primary" />
              {planDisplayName}
            </div>
            <div className="mt-2 text-2xl font-bold text-primary">
              {credits.display_remaining.toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground">{t("creditsAvailable")}</div>
          </div>
        )}

        {/* Action button */}
        <div className="mt-6 w-full">
          <Button className="w-full" onClick={onClose}>
            {isProcessing ? t("successProcessing") : t("successDismiss")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
