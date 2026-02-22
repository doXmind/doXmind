"use client";

import { useEffect } from "react";
import { useKBStore } from "@/stores/kb-store";

/**
 * Ensures KB polling intervals are cleaned up when the component unmounts.
 * This prevents memory leaks from orphaned setInterval timers when the
 * knowledge base panel or chat panel is closed.
 */
export function useKBPollingCleanup(conversationId: string | null) {
  useEffect(() => {
    return () => {
      if (conversationId) {
        useKBStore.getState().stopPolling(conversationId);
      }
    };
  }, [conversationId]);
}
