"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/ui/logo";
import { useAuthStore } from "@/stores/auth-store";
import { toast } from "sonner";

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("auth");
  const { handleOAuthCallback } = useAuthStore();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams.get("token");

    if (!token) {
      setError(t("noAuthToken"));
      return;
    }

    handleOAuthCallback(token)
      .then(() => {
        toast.success(t("loginSuccessful"));
        router.push("/");
      })
      .catch((err) => {
        console.error("OAuth callback error:", err);
        setError(err.message || t("authFailed"));
      });
  }, [searchParams, handleOAuthCallback, router, t]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <Logo size="lg" />
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-destructive">
              {t("authFailed")}
            </h1>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
          <button onClick={() => router.push("/login")} className="text-primary hover:underline">
            {t("returnToLogin")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <Logo size="lg" />
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{t("completingSignIn")}</h1>
          <p className="text-sm text-muted-foreground">{t("verifyingAccount")}</p>
        </div>
        <div className="flex justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
        </div>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  const tc = useTranslations("common");
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background px-4">
          <div className="w-full max-w-sm space-y-6 text-center">
            <Logo size="lg" />
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight">{tc("loading")}</h1>
            </div>
            <div className="flex justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
            </div>
          </div>
        </div>
      }
    >
      <AuthCallbackContent />
    </Suspense>
  );
}
