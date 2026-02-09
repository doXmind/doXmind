"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AnimatedLogoIcon, GlitchProvider } from "@/components/ui/animated-logo";
import { SidebarSkeleton } from "@/components/sidebar/sidebar-skeleton";
import { EditorSkeleton } from "@/components/editor/editor-skeleton";
import { ChatSkeleton } from "@/components/ai/chat-skeleton";
import { AppShell } from "@/components/layout/app-shell";
import { useLayoutStore } from "@/stores/layout-store";
import { cn } from "@/lib/utils";

interface LoadingScreenProps {
  isLoading: boolean;
  children: React.ReactNode;
  isMobile?: boolean;
}

type LoadingPhase = "logo" | "skeleton" | "content";

export function LoadingScreen({ isLoading, children, isMobile = false }: LoadingScreenProps) {
  const [phase, setPhase] = useState<LoadingPhase>("logo");
  const [hasInitialized, setHasInitialized] = useState(false);
  const { isChatOpen, isSidebarOpen } = useLayoutStore();

  useEffect(() => {
    // Only run the logo animation once on initial mount
    if (hasInitialized) return;

    // Phase 1: Logo animation (1.5s for animation + 0.5s pause)
    const logoTimer = setTimeout(() => {
      setPhase("skeleton");
    }, 2000);

    return () => clearTimeout(logoTimer);
  }, [hasInitialized]);

  useEffect(() => {
    // Phase 2 -> 3: When data is loaded, transition to content
    if (phase === "skeleton" && !isLoading) {
      const contentTimer = setTimeout(() => {
        setPhase("content");
        setHasInitialized(true);
      }, 300); // Small delay for smooth transition

      return () => clearTimeout(contentTimer);
    }
  }, [phase, isLoading]);

  // After initial load, skip directly to content
  if (hasInitialized) {
    return <>{children}</>;
  }

  return (
    <AnimatePresence mode="wait">
      {phase === "logo" && (
        <motion.div
          key="logo"
          className="fixed inset-0 z-50 flex items-center justify-center bg-background"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <GlitchProvider>
            <AnimatedLogoIcon size={120} />
          </GlitchProvider>
        </motion.div>
      )}

      {phase === "skeleton" && (
        <motion.div
          key="skeleton"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          {isMobile ? (
            <MobileSkeletonLayout />
          ) : (
            <DesktopSkeletonLayout isSidebarOpen={isSidebarOpen} isChatOpen={isChatOpen} />
          )}
        </motion.div>
      )}

      {phase === "content" && (
        <motion.div
          key="content"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function DesktopSkeletonLayout({
  isSidebarOpen,
  isChatOpen,
}: {
  isSidebarOpen: boolean;
  isChatOpen: boolean;
}) {
  return (
    <AppShell>
      <div className="flex h-full">
        {/* Sidebar skeleton */}
        <aside
          className={cn(
            "w-64 flex-shrink-0 border-r border-border bg-card transition-all duration-300",
            !isSidebarOpen && "w-0 overflow-hidden opacity-0"
          )}
        >
          <SidebarSkeleton />
        </aside>

        {/* Main Editor skeleton */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <EditorSkeleton />
        </main>

        {/* Chat Panel skeleton */}
        <aside
          className={cn(
            "w-96 flex-shrink-0 border-l border-border bg-card transition-all duration-300",
            !isChatOpen && "w-0 overflow-hidden opacity-0"
          )}
        >
          <ChatSkeleton />
        </aside>
      </div>
    </AppShell>
  );
}

function MobileSkeletonLayout() {
  return (
    <AppShell>
      <div className="flex h-full flex-col pb-14">
        {/* Editor skeleton - always visible on mobile */}
        <main className="flex-1 overflow-hidden">
          <EditorSkeleton />
        </main>
      </div>

      {/* Mobile bottom nav skeleton */}
      <div className="fixed bottom-0 left-0 right-0 flex h-14 items-center justify-around border-t border-border bg-card px-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <div className="h-6 w-6 animate-pulse rounded-md bg-muted" />
            <div className="h-2 w-8 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </AppShell>
  );
}
