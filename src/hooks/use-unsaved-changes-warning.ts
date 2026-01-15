"use client";

import { useEffect } from "react";
import { useEditorStore } from "@/stores/editor-store";

/**
 * Hook to warn users when they try to leave the page with unsaved changes.
 * Uses the browser's native beforeunload event to show a confirmation dialog.
 */
export function useUnsavedChangesWarning() {
  const isDirty = useEditorStore((state) => state.isDirty);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        // Standard way to show browser's native "unsaved changes" dialog
        e.preventDefault();
        // Chrome requires returnValue to be set
        e.returnValue = "";
        return "";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isDirty]);
}
