"use client";

import { useState, useCallback, useRef } from "react";
import {
  streamingFetch,
  isAbortError,
  createStreamController,
} from "@/lib/streaming";
import { editorLogger } from "@/lib/logger";

const log = editorLogger.child("QuickEdit");

interface QuickEditEvent {
  text?: string;
}

export function useQuickEdit() {
  const [isEditing, setIsEditing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const streamControllerRef = useRef(createStreamController());

  const edit = useCallback(async (text: string, action: string) => {
    setIsEditing(true);
    setResult(null);

    let fullText = "";
    const signal = streamControllerRef.current.start();

    try {
      await streamingFetch<QuickEditEvent>(
        {
          url: "/api/edit/quick",
          body: { text, action },
          signal,
        },
        (event) => {
          if (event.text) {
            fullText += event.text;
          }
        }
      );

      setResult(fullText);
      return fullText;
    } catch (error) {
      if (!isAbortError(error)) {
        log.error("Quick edit request failed", error);
      }
      setResult(null);
      return null;
    } finally {
      setIsEditing(false);
    }
  }, []);

  const cancel = useCallback(() => {
    streamControllerRef.current.abort();
  }, []);

  return {
    edit,
    cancel,
    isEditing,
    result,
  };
}
