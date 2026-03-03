"use client";

import { useAuthStore } from "@/stores/auth-store";
import { SuccessAnimation } from "@/components/ui/success-animation";
import { useTranslations } from "next-intl";

/**
 * Global logout animation overlay
 * Shows a success checkmark when user logs out
 */
export function LogoutAnimation() {
  const t = useTranslations("sidebar");
  const showLogoutAnimation = useAuthStore((state) => state.showLogoutAnimation);
  const setShowLogoutAnimation = useAuthStore((state) => state.setShowLogoutAnimation);

  return (
    <SuccessAnimation
      show={showLogoutAnimation}
      variant="overlay"
      message={t("loggedOut")}
      onComplete={() => setShowLogoutAnimation(false)}
    />
  );
}
