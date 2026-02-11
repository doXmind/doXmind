"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Logo } from "@/components/ui/logo";
import { useAuthStore } from "@/stores/auth-store";
import { toast } from "sonner";

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { handleOAuthCallback } = useAuthStore();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams.get("token");

    if (!token) {
      setError("No authentication token received");
      return;
    }

    handleOAuthCallback(token)
      .then(() => {
        toast.success("Login successful!");
        router.push("/");
      })
      .catch((err) => {
        console.error("OAuth callback error:", err);
        setError(err.message || "Authentication failed");
      });
  }, [searchParams, handleOAuthCallback, router]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <Logo size="lg" />
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-destructive">
              Authentication Failed
            </h1>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
          <button onClick={() => router.push("/login")} className="text-primary hover:underline">
            Return to login
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
          <h1 className="text-2xl font-semibold tracking-tight">Completing sign in...</h1>
          <p className="text-sm text-muted-foreground">Please wait while we verify your account</p>
        </div>
        <div className="flex justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
        </div>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background px-4">
          <div className="w-full max-w-sm space-y-6 text-center">
            <Logo size="lg" />
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight">Loading...</h1>
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
