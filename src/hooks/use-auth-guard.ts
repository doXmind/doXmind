"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import { api } from "@/lib/api";

/**
 * Hook to guard routes that require authentication.
 * Handles 401 responses by redirecting to login page.
 */
export function useAuthGuard() {
  const router = useRouter();
  const { logout } = useAuthStore();

  useEffect(() => {
    // Handle 401 unauthorized events from API
    const handleUnauthorized = () => {
      logout();
      router.push("/login?reason=session_expired");
    };

    window.addEventListener("auth:unauthorized", handleUnauthorized);

    // Also check on mount if token is valid
    if (!api.isLoggedIn()) {
      // In debug mode, backend allows unauthenticated access
      // So we don't redirect, just let the request go through
      // Backend will return dev-user token
    }

    return () => {
      window.removeEventListener("auth:unauthorized", handleUnauthorized);
    };
  }, [logout, router]);
}
