"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/ui/logo";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

function ResetPasswordContent() {
  const t = useTranslations("auth");
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!token) {
      setError(t("invalidLink"));
      return;
    }

    if (!password || !confirmPassword) {
      setError(t("fillAllFields"));
      return;
    }

    if (password !== confirmPassword) {
      setError(t("passwordsDoNotMatch"));
      return;
    }

    if (password.length < 8) {
      setError(t("passwordMinLength"));
      return;
    }

    setIsLoading(true);
    try {
      await api.resetPassword(token, password);
      toast.success(t("passwordResetSuccess"));
      router.push("/login");
    } catch (err) {
      const message = err instanceof Error ? err.message : t("resetPasswordFailed");
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <Logo size="lg" />
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-destructive">
              {t("invalidLink")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("invalidLinkMessage")}</p>
          </div>
          <p className="text-sm text-muted-foreground">
            <Link href="/forgot-password" className="text-primary hover:underline">
              {t("requestNewResetLink")}
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <Logo size="lg" />
          <h1 className="text-2xl font-semibold tracking-tight">{t("setNewPassword")}</h1>
          <p className="text-sm text-muted-foreground">{t("resetPasswordSubtitle")}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          )}

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">
              {t("newPassword")}
            </label>
            <Input
              id="password"
              type="password"
              placeholder={t("atLeast8Characters")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              autoComplete="new-password"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="confirmPassword" className="text-sm font-medium">
              {t("confirmPassword")}
            </label>
            <Input
              id="confirmPassword"
              type="password"
              placeholder={t("confirmYourPassword")}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={isLoading}
              autoComplete="new-password"
            />
          </div>

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? t("resettingPassword") : t("resetPasswordButton")}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          <Link href="/login" className="text-primary hover:underline">
            {t("returnToLogin")}
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="animate-pulse">Loading...</div>
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
