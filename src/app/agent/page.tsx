"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLayoutStore } from "@/stores/layout-store";

/**
 * /agent route — redirects to home and opens the agent sheet.
 * Kept as a thin redirect so direct URL access still works.
 */
export default function AgentPage() {
  const router = useRouter();
  const setAgentSheetOpen = useLayoutStore((s) => s.setAgentSheetOpen);

  useEffect(() => {
    setAgentSheetOpen(true);
    router.replace("/");
  }, [setAgentSheetOpen, router]);

  return null;
}
