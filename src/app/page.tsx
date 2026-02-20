"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuthStore } from "@/stores/auth-store";
import { api } from "@/lib/api";
import { HomeDashboard } from "@/components/home/home-dashboard";
import { HomeLanding } from "@/components/home/home-landing";
import { AppShell } from "@/components/layout/app-shell";
import { AnimatedLogoIcon, GlitchProvider } from "@/components/ui/animated-logo";

export default function HomePage() {
  const { isInitialized, initialize } = useAuthStore();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [showSplash, setShowSplash] = useState(() => {
    if (typeof window !== "undefined" && sessionStorage.getItem("doxmind_splash_shown")) {
      return false;
    }
    return true;
  });

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    if (isInitialized) {
      setIsAuthenticated(api.isLoggedIn());
    }
  }, [isInitialized]);

  // Logo splash → content after 800ms, skip on return visits within session
  useEffect(() => {
    if (!showSplash) return;
    const timer = setTimeout(() => {
      setShowSplash(false);
      sessionStorage.setItem("doxmind_splash_shown", "1");
    }, 800);
    return () => clearTimeout(timer);
  }, [showSplash]);

  return (
    <AnimatePresence mode="wait">
      {showSplash || !isInitialized || isAuthenticated === null ? (
        <motion.div
          key="splash"
          className="fixed inset-0 z-50 flex items-center justify-center bg-background"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <GlitchProvider>
            <AnimatedLogoIcon size={120} />
          </GlitchProvider>
        </motion.div>
      ) : (
        <motion.div
          key="content"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
        >
          {isAuthenticated ? (
            <AppShell>
              <HomeDashboard />
            </AppShell>
          ) : (
            <HomeLanding />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
