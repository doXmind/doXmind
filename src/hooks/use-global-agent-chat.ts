"use client";

import { useCallback, useEffect, useRef } from "react";
import { useGlobalAgentStore } from "@/stores/global-agent-store";
import { useStreamingStore, type ToolStatus } from "@/stores/streaming-store";
import { processSSEStream, isAbortError, createStreamController } from "@/lib/streaming";
import { api } from "@/lib/api";
import { useSettingsStore } from "@/stores/settings-store";
import type { ChatStreamEvent } from "@/types/stream-events";
import type { AffectedFile } from "@/types";

/**
 * Hook for managing global agent chat streaming.
 *
 * Similar to useChat but adapted for the global agent:
 * - Uses useGlobalAgentStore instead of useChatStore
 * - Streams to /api/global-agent/stream
 * - No edit operations (global agent manages files server-side)
 */
export function useGlobalAgentChat() {
  const {
    isStreaming,
    currentTool,
    toolHistory,
    thinking,
    todos,
    setStreaming,
    setCurrentTool,
    setToolHistory,
    setThinking,
    setTodos,
    clearTodos,
  } = useStreamingStore();

  const streamControllerRef = useRef(createStreamController());
  const toolInputRef = useRef<string>("");

  const {
    activeConversationId,
    addMessage,
    appendToMessage,
    setMessageStreaming,
    updateMessageFull,
  } = useGlobalAgentStore();

  // Abort in-flight stream on unmount
  useEffect(() => {
    const controller = streamControllerRef.current;
    return () => {
      controller.abort();
    };
  }, []);

  const sendMessage = useCallback(
    async (message: string, conversationId: string) => {
      // Add user message to local state
      addMessage(conversationId, {
        role: "user",
        content: message,
      });

      // Save user message to backend
      api.saveGlobalMessage(conversationId, message).catch(() => {});

      // Add assistant message placeholder
      const assistantMessageId = addMessage(conversationId, {
        role: "assistant",
        content: "",
        isStreaming: true,
      });

      setStreaming(true);
      setCurrentTool(null);
      setToolHistory([]);
      setThinking({ isThinking: false, content: "" });

      const existingTodos = useStreamingStore.getState().todos;
      const hasIncompleteTodos = existingTodos.some(
        (t) => t.status === "pending" || t.status === "in_progress"
      );
      if (!hasIncompleteTodos) {
        setTodos([]);
      }
      toolInputRef.current = "";
      const affectedFilesRef: AffectedFile[] = [];

      const signal = streamControllerRef.current.start();
      const summaryRef: {
        data: {
          content: string;
          thinking: string | null;
          toolCalls: unknown[] | null;
          model: string;
        } | null;
      } = { data: null };

      try {
        const response = await fetch("/api/global-agent/stream", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...api.getAuthorizationHeaders(),
          },
          body: JSON.stringify({
            message,
            conversationId,
            files: [],
            images: [],
            webSearchEnabled: useSettingsStore.getState().webSearchEnabled,
            thinkingEnabled: useSettingsStore.getState().thinkingEnabled,
          }),
          signal,
        });

        if (!response.ok) {
          if (response.status === 401) {
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent("auth:unauthorized"));
            }
            throw new Error("Session expired. Please log in again.");
          }
          throw new Error(`HTTP ${response.status}`);
        }

        await processSSEStream<ChatStreamEvent>(response, (parsed) => {
          switch (parsed.type) {
            case "text":
              if (parsed.content) {
                appendToMessage(conversationId, assistantMessageId, parsed.content);
              }
              break;

            case "thinking_start":
              setThinking({ isThinking: true, content: "" });
              break;

            case "thinking":
              if (parsed.content) {
                setThinking((prev) => ({
                  isThinking: true,
                  content: prev.content + parsed.content,
                }));
              }
              break;

            case "thinking_end":
              setThinking((prev) => ({ ...prev, isThinking: false }));
              break;

            case "tool_start": {
              toolInputRef.current = "";
              const toolStatus: ToolStatus = {
                name: parsed.tool || "",
                status: "running",
                toolId: parsed.tool_id,
                input: "",
              };
              setCurrentTool(toolStatus);
              setToolHistory((prev) => [...prev, toolStatus]);
              break;
            }

            case "tool_input_delta": {
              toolInputRef.current += parsed.delta || "";
              setCurrentTool((prev) => (prev ? { ...prev, input: toolInputRef.current } : null));
              break;
            }

            case "tool_end": {
              const completedTool: ToolStatus = {
                name: parsed.tool || "",
                status: parsed.success === false ? "error" : "completed",
                message: parsed.output,
                toolId: parsed.tool_id,
              };
              setCurrentTool(completedTool);
              toolInputRef.current = "";
              setToolHistory((prev) => {
                const newHistory = [...prev];
                const lastIndex = newHistory.findLastIndex(
                  (t) =>
                    (t.toolId === parsed.tool_id || t.name === parsed.tool) &&
                    t.status === "running"
                );
                if (lastIndex >= 0) {
                  newHistory[lastIndex] = completedTool;
                }
                return newHistory;
              });

              // Collect affected files
              if (parsed.file_id && parsed.success !== false) {
                const action = parsed.file_action || "referenced";
                const existing = affectedFilesRef.find((f) => f.fileId === parsed.file_id);
                if (existing) {
                  // Upgrade action: referenced -> edited -> created
                  if (
                    action === "created" ||
                    (action === "edited" && existing.action === "referenced")
                  ) {
                    existing.action = action;
                  }
                } else {
                  affectedFilesRef.push({
                    fileId: parsed.file_id!,
                    fileName: parsed.file_name || "Untitled",
                    action,
                  });
                }
              }
              break;
            }

            case "summary":
              summaryRef.data = {
                content: parsed.content || "",
                thinking: parsed.thinking || null,
                toolCalls: parsed.toolCalls || null,
                model: parsed.model || "",
              };
              if (parsed.todos) {
                setTodos(parsed.todos);
              }
              break;

            case "error": {
              // Handle credit exhaustion
              if (parsed.code === "INSUFFICIENT_CREDITS") {
                import("@/stores/billing-store").then(({ useBillingStore }) => {
                  useBillingStore.getState().openUpgradeModal(parsed.content);
                });
              }
              const errorTool: ToolStatus = {
                name: "error",
                status: "error",
                message: parsed.content,
              };
              setCurrentTool(errorTool);
              setToolHistory((prev) => [...prev, errorTool]);
              break;
            }

            case "server_tool_start": {
              let displayName = parsed.tool || "";
              let message = "Processing...";
              if (parsed.tool === "web_search") {
                displayName = "Web Search";
                message = "Searching the web...";
              } else if (parsed.tool === "web_fetch") {
                displayName = "Web Fetch";
                message = "Fetching URL...";
              } else if (
                parsed.tool === "bash_code_execution" ||
                parsed.tool === "code_execution"
              ) {
                displayName = "Code Execution";
                message = "Running code...";
              }
              const serverToolStatus: ToolStatus = {
                name: displayName,
                status: "running",
                toolId: parsed.tool_id,
                message,
              };
              setCurrentTool(serverToolStatus);
              setToolHistory((prev) => [...prev, serverToolStatus]);
              break;
            }

            case "server_tool_end": {
              const endedTool: ToolStatus = {
                name: parsed.tool || "",
                status: parsed.success === false ? "error" : "completed",
                message: parsed.output,
                toolId: parsed.tool_id,
              };
              setToolHistory((prev) => {
                const newHistory = [...prev];
                const idx = newHistory.findLastIndex(
                  (t) => t.toolId === parsed.tool_id && t.status === "running"
                );
                if (idx >= 0) {
                  newHistory[idx] = {
                    ...newHistory[idx],
                    status: endedTool.status,
                    message: endedTool.message,
                  };
                }
                return newHistory;
              });
              setCurrentTool(null);
              break;
            }

            case "web_search_result": {
              const resultCount = (parsed as { results?: Array<unknown> }).results?.length || 0;
              setToolHistory((prev) => {
                const newHistory = [...prev];
                const idx = newHistory.findLastIndex((t) => t.toolId === parsed.tool_id);
                if (idx >= 0) {
                  newHistory[idx] = {
                    ...newHistory[idx],
                    status: "completed",
                    message: `Found ${resultCount} result${resultCount !== 1 ? "s" : ""}`,
                  };
                }
                return newHistory;
              });
              setCurrentTool(null);
              break;
            }

            case "web_fetch_result": {
              const url = (parsed as { url?: string }).url || "";
              const displayUrl = url.length > 40 ? url.substring(0, 40) + "..." : url;
              setToolHistory((prev) => {
                const newHistory = [...prev];
                const idx = newHistory.findLastIndex((t) => t.toolId === parsed.tool_id);
                if (idx >= 0) {
                  newHistory[idx] = {
                    ...newHistory[idx],
                    status: "completed",
                    message: displayUrl ? `Fetched: ${displayUrl}` : "Content fetched",
                  };
                }
                return newHistory;
              });
              setCurrentTool(null);
              break;
            }

            case "code_execution_result": {
              const returnCode = (parsed as { return_code?: number }).return_code ?? 0;
              const files = (parsed as { files?: { filename: string }[] }).files || [];
              const fileCount = files.length;
              setToolHistory((prev) => {
                const newHistory = [...prev];
                const idx = newHistory.findLastIndex((t) => t.toolId === parsed.tool_id);
                if (idx >= 0) {
                  newHistory[idx] = {
                    ...newHistory[idx],
                    status: returnCode === 0 ? "completed" : "error",
                    message:
                      returnCode === 0
                        ? fileCount > 0
                          ? `Executed (${fileCount} file(s) created)`
                          : "Executed successfully"
                        : "Execution failed",
                  };
                }
                return newHistory;
              });
              setCurrentTool(null);
              break;
            }

            case "todo_update":
              if (parsed.todos) {
                setTodos(parsed.todos);
              }
              break;
          }
        });

        // Update frontend state with full message data
        const messageUpdates: Record<string, unknown> = {};
        if (summaryRef.data) {
          messageUpdates.thinking = summaryRef.data.thinking;
          messageUpdates.model = summaryRef.data.model;
        }
        if (affectedFilesRef.length > 0) {
          messageUpdates.affectedFiles = [...affectedFilesRef];
        }
        if (Object.keys(messageUpdates).length > 0) {
          updateMessageFull(conversationId, assistantMessageId, messageUpdates);
        }
      } catch (error) {
        let errorMessage: string;
        if (isAbortError(error)) {
          errorMessage = "\n\n*[Stopped]*";
        } else if (error instanceof Error && error.message) {
          errorMessage = `\n\n*Error: ${error.message}*`;
        } else {
          errorMessage = "\n\n*Error: Failed to get response.*";
        }
        appendToMessage(conversationId, assistantMessageId, errorMessage);
      } finally {
        setMessageStreaming(conversationId, assistantMessageId, false);
        setStreaming(false);
        setCurrentTool(null);
        setThinking({ isThinking: false, content: "" });

        const finalTodos = useStreamingStore.getState().todos;
        const allCompleted =
          finalTodos.length > 0 && finalTodos.every((t) => t.status === "completed");
        if (allCompleted) {
          setTimeout(() => {
            const current = useStreamingStore.getState().todos;
            if (current.length > 0 && current.every((t) => t.status === "completed")) {
              clearTodos();
            }
          }, 3000);
        }
        toolInputRef.current = "";
      }
    },
    [
      addMessage,
      appendToMessage,
      setMessageStreaming,
      updateMessageFull,
      setStreaming,
      setCurrentTool,
      setToolHistory,
      setThinking,
      setTodos,
      clearTodos,
    ]
  );

  const stop = useCallback(() => {
    clearTodos();
    streamControllerRef.current.abort();
  }, [clearTodos]);

  return {
    sendMessage,
    stop,
    isStreaming,
    currentTool,
    toolHistory,
    thinking,
    todos,
    activeConversationId,
  };
}
