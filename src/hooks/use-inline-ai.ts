"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { QUICK_EDIT_PROMPTS } from "@/lib/quick-edit-prompts";
import { createStreamController, isAbortError, processSSEStream } from "@/lib/streaming";
import { useEditOperations } from "@/hooks/use-edit-operations";
import { useFileStore } from "@/stores/file-store";
import { useDemoStore } from "@/stores/demo-store";
import { useEditorStore } from "@/stores/editor-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useEditSnapshotStore } from "@/stores/edit-snapshot-store";
import type { ChatStreamEvent } from "@/types/stream-events";
import type { EditOperation } from "@/types";

interface InlineSelectionPayload {
  text: string;
  from: number;
  to: number;
}

interface InlineAnchorPayload {
  beforeText: string;
  afterText: string;
}

interface SendInlineRequestOptions {
  intent: "ask" | "edit" | "insert";
  instruction: string;
  fileId: string;
  requestId: string;
  selection?: InlineSelectionPayload | null;
  anchor?: InlineAnchorPayload | null;
}

export function useInlineAI() {
  const [isStreaming, setIsStreaming] = useState(false);

  const { getFile } = useFileStore();
  const demoFile = useDemoStore((s) => s.demoFile);
  const thinkingEnabled = useSettingsStore((s) => s.thinkingEnabled);
  const { applyEdits } = useEditOperations();
  const streamControllerRef = useRef(createStreamController());

  const startInlineAIResponse = useEditorStore((s) => s.startInlineAIResponse);
  const setInlineAIResponseStatus = useEditorStore((s) => s.setInlineAIResponseStatus);
  const appendInlineAIResponse = useEditorStore((s) => s.appendInlineAIResponse);
  const clearInlineAIResponse = useEditorStore((s) => s.clearInlineAIResponse);

  const stopStreaming = useCallback(() => {
    streamControllerRef.current.abort();
  }, []);

  const sendInlineRequest = useCallback(
    async ({
      intent,
      instruction,
      fileId,
      requestId,
      selection,
      anchor,
    }: SendInlineRequestOptions) => {
      // Pre-check: block if AI is locked (credits exhausted)
      const { useBillingStore } = await import("@/stores/billing-store");
      if (useBillingStore.getState().isAILocked()) {
        useBillingStore.getState().openUpgradeModal("Upgrade to use AI editing");
        return;
      }

      const file = fileId === "demo-file" ? demoFile : getFile(fileId);
      if (!file) {
        throw new Error("File not found");
      }

      let liveMarkdown: string | null = null;
      try {
        const liveEditor = useEditorRefStore.getState().editor;
        const currentFileId = useFileStore.getState().currentFileId;
        if (liveEditor && currentFileId === file.id) {
          liveMarkdown = liveEditor.getMarkdown();
        }
      } catch {
        liveMarkdown = null;
      }

      const effectiveFileContent =
        liveMarkdown !== null ? liveMarkdown : file.contentMarkdown || file.content;

      // Preserve the exact markdown sent to the server for diff-review matching
      useEditSnapshotStore.getState().setSnapshot(file.id, effectiveFileContent);

      startInlineAIResponse(requestId, intent === "insert" ? "write" : intent);
      setIsStreaming(true);

      const signal = streamControllerRef.current.start();
      const collectedEdits: EditOperation[] = [];

      try {
        const response = await fetch("/api/inline/stream", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...api.getAuthorizationHeaders(),
          },
          signal,
          body: JSON.stringify({
            requestId,
            intent,
            instruction,
            file: {
              id: file.id,
              name: file.name,
              content: effectiveFileContent,
            },
            selection: selection
              ? {
                  text: selection.text,
                  from_pos: selection.from,
                  to_pos: selection.to,
                }
              : null,
            anchor: anchor || null,
            options: {
              toolProfile: intent === "ask" ? "inline_ask" : "inline_edit",
              thinkingEnabled,
              persistHistory: false,
            },
            conversationId: null,
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        await processSSEStream<ChatStreamEvent>(response, (event) => {
          switch (event.type) {
            case "thinking_start":
              setInlineAIResponseStatus(requestId, "thinking");
              break;
            case "thinking":
              setInlineAIResponseStatus(requestId, "thinking");
              break;
            case "thinking_end":
              break;
            case "tool_start":
              break;
            case "tool_end":
              break;
            case "text":
              setInlineAIResponseStatus(requestId, "streaming");
              appendInlineAIResponse(requestId, event.content || "");
              break;
            case "edit":
              if (event.edit) {
                // Ask mode must never mutate the document.
                if (intent !== "ask") {
                  collectedEdits.push(event.edit as never);
                  applyEdits([event.edit]);
                }
              }
              break;
            case "summary":
              if (!useEditorStore.getState().inlineAIResponse?.content && event.content) {
                appendInlineAIResponse(requestId, event.content);
              }
              setInlineAIResponseStatus(requestId, "ready");
              break;
            case "error":
              // Handle credit exhaustion
              if (event.code === "INSUFFICIENT_CREDITS") {
                import("@/stores/billing-store").then(({ useBillingStore }) => {
                  useBillingStore.getState().openUpgradeModal(event.content);
                });
              }
              setInlineAIResponseStatus(
                requestId,
                "error",
                event.content || "Inline request failed"
              );
              break;
          }
        });

        const finalState = useEditorStore.getState().inlineAIResponse;
        if (finalState?.requestId === requestId && finalState.status !== "ready") {
          if (intent !== "ask" && !finalState.content.trim() && collectedEdits.length > 0) {
            appendInlineAIResponse(
              requestId,
              "Edits are ready in the document. Review and accept them inline."
            );
          }
          setInlineAIResponseStatus(requestId, "ready");
        }
      } catch (error) {
        if (isAbortError(error)) {
          setInlineAIResponseStatus(requestId, "error", "Stopped");
        } else {
          setInlineAIResponseStatus(
            requestId,
            "error",
            error instanceof Error ? error.message : "Inline request failed"
          );
        }
      } finally {
        setIsStreaming(false);
      }
    },
    [
      demoFile,
      getFile,
      thinkingEnabled,
      startInlineAIResponse,
      setInlineAIResponseStatus,
      appendInlineAIResponse,
      applyEdits,
    ]
  );

  const runInlineQuickEdit = useCallback(
    async (params: {
      action: string;
      fileId: string;
      requestId: string;
      selection: InlineSelectionPayload;
      anchor?: InlineAnchorPayload | null;
    }) => {
      const prompt = QUICK_EDIT_PROMPTS[params.action];
      if (!prompt) throw new Error("Unsupported quick edit action");

      return sendInlineRequest({
        intent: "edit",
        instruction: prompt,
        fileId: params.fileId,
        requestId: params.requestId,
        selection: params.selection,
        anchor: params.anchor,
      });
    },
    [sendInlineRequest]
  );

  const apiRef = useMemo(
    () => ({
      isStreaming,
      stopStreaming,
      clearInlineAIResponse,
      sendInlineRequest,
      runInlineQuickEdit,
    }),
    [isStreaming, stopStreaming, clearInlineAIResponse, sendInlineRequest, runInlineQuickEdit]
  );

  return apiRef;
}
