"use client";

import { usePathname } from "next/navigation";
import { MobileFAB } from "@/components/home/mobile-fab";
import { AgentSheet } from "./agent-sheet";

/**
 * Global overlay that renders the MobileFAB and AgentSheet.
 * Placed in root layout so the agent is accessible from any page.
 *
 * The FAB is hidden on:
 * - Editor pages (/editor/*)
 * - Login page (/login)
 * - Demo page (/demo)
 * - Static pages (/help, /privacy, /terms)
 */
export function GlobalAgentOverlay() {
  const pathname = usePathname();

  const hideFAB =
    pathname.startsWith("/editor") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/demo") ||
    pathname.startsWith("/help") ||
    pathname.startsWith("/privacy") ||
    pathname.startsWith("/terms");

  return (
    <>
      {!hideFAB && <MobileFAB />}
      <AgentSheet />
    </>
  );
}
