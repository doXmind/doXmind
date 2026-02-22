"use client";

import { useEffect } from "react";
import { useDataFilesStore } from "@/stores/data-files-store";

/**
 * Ensures data file polling intervals are cleaned up when the component unmounts.
 * This prevents memory leaks from orphaned setInterval timers when the
 * chat panel or attachment menu is closed.
 */
export function useDataFilePollingCleanup(conversationId: string | null) {
  useEffect(() => {
    return () => {
      if (conversationId) {
        useDataFilesStore.getState().stopPollingClaudeStatus(conversationId);
      }
    };
  }, [conversationId]);
}
