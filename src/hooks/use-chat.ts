"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  useChatStore,
  type ChatMessage,
  type ToolCall,
  type MessageContextItem,
} from "@/stores/chat-store";
import { useFileStore } from "@/stores/file-store";
import { useDemoStore } from "@/stores/demo-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useStreamingStore, type ToolStatus } from "@/stores/streaming-store";
import { htmlToMarkdown, isHtml } from "@/lib/markdown";
import { processSSEStream, isAbortError, createStreamController } from "@/lib/streaming";
import { useEditOperations, type EditOperation } from "./use-edit-operations";
import { useDiffReviewStore } from "@/stores/diff-review-store";
import { api } from "@/lib/api";
import { QUICK_EDIT_PROMPTS } from "@/lib/quick-edit-prompts";
import type { ChatStreamEvent } from "@/types/stream-events";

// Re-export types for convenience
export type { EditOperation } from "./use-edit-operations";
export type { ToolStatus, ThinkingStatus } from "@/stores/streaming-store";
export type { TodoItem } from "@/types/stream-events";

export function useChat() {
  // Use global streaming store instead of local state
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

  // Abort in-flight stream on unmount to prevent memory leaks
  useEffect(() => {
    const controller = streamControllerRef.current;
    return () => {
      controller.abort();
    };
  }, []);

  const {
    ensureConversation,
    addMessage,
    appendToMessage,
    setMessageStreaming,
    updateMessageFull,
    saveMessageToBackend,
  } = useChatStore();
  const { getFile } = useFileStore();
  const { demoFile } = useDemoStore();
  const { applyEdits } = useEditOperations();

  const sendMessage = useCallback(
    async (
      message: string,
      fileIds: string[],
      contexts?: MessageContextItem[] | null,
      dataFileIds?: string[],
      quickEdit?: { action: string; originalText: string } | null
    ) => {
      const conversationId = ensureConversation(fileIds[0] || null);

      // Build the full message for AI (include text contexts with XML tags)
      let messageForAI = message;
      const textContexts = contexts?.filter((c) => c.type === "selection") || [];
      if (textContexts.length > 0) {
        const contextTexts = textContexts
          .map((c, i) => {
            if (textContexts.length > 1) {
              return `<reference index="${i + 1}">\n${c.text}\n</reference>`;
            }
            return c.text;
          })
          .join("\n\n");
        messageForAI = `${message}\n\n<selected_content>\n${contextTexts}\n</selected_content>`;
      }

      // Inject edit feedback from previous diff review session
      const editFeedback = useDiffReviewStore.getState().consumePendingFeedback();
      if (editFeedback.length > 0) {
        const feedbackLines = editFeedback
          .map((f, i) => {
            const oldSnippet = f.oldContent ? `"${f.oldContent}"` : "(empty)";
            const newSnippet = f.newContent ? `"${f.newContent}"` : "(delete)";
            const status = f.decision === "accepted" ? "ACCEPTED" : "REJECTED";
            return `${i + 1}. ${f.editType} ${oldSnippet} → ${newSnippet}: ${status}`;
          })
          .join("\n");

        const feedbackContext =
          "[Edit review results from your previous response:]\n" +
          feedbackLines +
          "\n\nNote: Rejected changes were NOT applied. The document still contains the original text.\n\n";

        messageForAI = feedbackContext + messageForAI;
      }

      // Extract image contexts with base64 data for multimodal API
      const imageContexts =
        contexts
          ?.filter(
            (c): c is MessageContextItem & { type: "image"; base64: string; mediaType: string } =>
              c.type === "image" &&
              !!(c as { base64?: string }).base64 &&
              !!(c as { mediaType?: string }).mediaType
          )
          .map((c) => ({
            src: c.src,
            alt: (c as { alt?: string }).alt,
            base64: c.base64,
            mediaType: c.mediaType,
          })) || [];

      // Add user message
      const userMessageId = addMessage(conversationId, {
        role: "user",
        content: message,
        fileIds,
        contexts,
        quickEdit: quickEdit || null,
      });

      // Track onboarding step
      import("@/stores/onboarding-store")
        .then(({ useOnboardingStore }) => {
          useOnboardingStore.getState().completeStep("ai-chat");
        })
        .catch(() => {});

      // Save user message to backend
      // Strip base64 data from contexts before saving (too large for DB storage)
      // The src URL is preserved so images can still be displayed
      const contextsForStorage =
        contexts?.map((ctx) => {
          if (ctx.type === "image") {
            // Keep src and alt, remove base64 and mediaType (only needed for AI API)
            return { type: ctx.type, src: ctx.src, alt: (ctx as { alt?: string }).alt };
          }
          return ctx;
        }) || null;

      const userMessage: ChatMessage = {
        id: userMessageId,
        role: "user",
        content: message,
        fileIds,
        contexts: contextsForStorage,
        quickEdit: quickEdit || null,
        createdAt: new Date().toISOString(),
      };
      saveMessageToBackend(conversationId, userMessage);

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
      // Preserve incomplete todos across messages (clear only if all completed)
      const existingTodos = useStreamingStore.getState().todos;
      const hasIncompleteTodos = existingTodos.some(
        (t) => t.status === "pending" || t.status === "in_progress"
      );
      if (!hasIncompleteTodos) {
        setTodos([]);
      }
      toolInputRef.current = "";

      const signal = streamControllerRef.current.start();
      const collectedEdits: EditOperation[] = [];
      let editsAppliedIncrementally = false;
      const summaryRef: {
        data: {
          content: string;
          thinking: string | null;
          toolCalls: ToolCall[] | null;
          edits: EditOperation[] | null;
          model: string;
        } | null;
      } = { data: null };

      try {
        // Get file contents and convert HTML to markdown for AI
        // Support demo mode by checking demoFile for "demo-file" id
        const files = fileIds
          .map((id) => (id === "demo-file" ? demoFile : getFile(id)))
          .filter((f): f is NonNullable<typeof f> => f != null)
          .map((f) => ({
            id: f.id,
            name: f.name,
            // Prefer cached markdown (from editor.getMarkdown() on save).
            // Fallback to Turndown conversion for files not yet re-saved since upgrade.
            content:
              f.contentMarkdown || (isHtml(f.content) ? htmlToMarkdown(f.content) : f.content),
          }));

        // Get web tools settings
        const webToolsSettings = useSettingsStore.getState().getWebToolsSettings();

        const response = await fetch("/api/chat/stream", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...api.getAuthorizationHeaders(),
          },
          body: JSON.stringify({
            message: messageForAI,
            files,
            images: imageContexts, // Include image data for multimodal support
            conversationId,
            // Web search toggle (web fetch is always enabled)
            webSearchEnabled: webToolsSettings.webSearchEnabled,
            // Data files for code execution sandbox
            dataFileIds: dataFileIds || [],
            // Quick edit mode flag for backend optimization
            isQuickEdit: !!quickEdit,
          }),
          signal,
        });

        if (!response.ok) {
          // Handle 401 Unauthorized
          if (response.status === 401) {
            // Check if we're in demo mode (fileIds contains "demo-file")
            const isDemoMode = fileIds.includes("demo-file");
            if (!isDemoMode) {
              // Only trigger auth redirect for non-demo mode
              if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent("auth:unauthorized"));
              }
            }
            throw new Error(
              isDemoMode
                ? "Demo mode requires backend configuration for anonymous access."
                : "Session expired. Please log in again."
            );
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
              setCurrentTool((prev) =>
                prev
                  ? {
                      ...prev,
                      input: toolInputRef.current,
                    }
                  : null
              );
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
              break;
            }

            case "edit":
              if (parsed.edit) {
                collectedEdits.push(parsed.edit);
                // Apply edit immediately for real-time diff display
                applyEdits([parsed.edit]);
                editsAppliedIncrementally = true;
                const editTool: ToolStatus = {
                  name: parsed.edit.type,
                  status: "completed",
                  message: `Editing ${parsed.edit.file_name}`,
                };
                setCurrentTool(editTool);
                setToolHistory((prev) => [...prev, editTool]);
              }
              break;

            case "edits_batch":
              // Edits already applied individually via "edit" events;
              // only apply any extra edits not seen as individual events
              if (parsed.edits && parsed.edits.length > 0) {
                const newEdits = parsed.edits.slice(collectedEdits.length);
                if (newEdits.length > 0) {
                  const applied = applyEdits(newEdits);
                  const applyTool: ToolStatus = {
                    name: "apply_edits",
                    status: applied > 0 ? "completed" : "error",
                    message: applied > 0 ? `Applied ${applied} edit(s)` : "No edits applied",
                  };
                  setCurrentTool(applyTool);
                  setToolHistory((prev) => [...prev, applyTool]);
                }
              }
              break;

            case "summary":
              summaryRef.data = {
                content: parsed.content || "",
                thinking: parsed.thinking || null,
                toolCalls: parsed.toolCalls || null,
                edits: parsed.edits || null,
                model: parsed.model || "",
              };
              // Sync final todo state from summary
              if (parsed.todos) {
                setTodos(parsed.todos);
              }
              break;

            case "error": {
              const errorTool: ToolStatus = {
                name: "error",
                status: "error",
                message: parsed.content,
              };
              setCurrentTool(errorTool);
              setToolHistory((prev) => [...prev, errorTool]);
              break;
            }

            // Handle server-side tools (web_search, web_fetch, code_execution)
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

        // Apply any remaining collected edits (only if not already applied incrementally)
        if (collectedEdits.length > 0 && !editsAppliedIncrementally) {
          const applied = applyEdits(collectedEdits);
          if (applied > 0) {
            const finalTool: ToolStatus = {
              name: "apply_edits",
              status: "completed",
              message: `Applied ${applied} edit(s)`,
            };
            setCurrentTool(finalTool);
            setToolHistory((prev) => [...prev, finalTool]);
          }
        }

        // Update frontend state with full message data (backend saves message with token usage)
        if (summaryRef.data) {
          updateMessageFull(conversationId, assistantMessageId, {
            thinking: summaryRef.data.thinking,
            toolCalls: summaryRef.data.toolCalls,
            edits: summaryRef.data.edits,
            model: summaryRef.data.model,
          });
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
        // Don't clear todos - keep them visible after streaming ends
        // Auto-clear fully-completed todos after a delay (visual feedback)
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
      ensureConversation,
      addMessage,
      appendToMessage,
      setMessageStreaming,
      getFile,
      applyEdits,
      updateMessageFull,
      setStreaming,
      setCurrentTool,
      setToolHistory,
      setThinking,
      setTodos,
      demoFile,
      saveMessageToBackend,
      clearTodos,
    ]
  );

  const stopStreaming = useCallback(() => {
    streamControllerRef.current.abort();
  }, []);

  /** Send a quick edit action as a chat message with selection context */
  const sendQuickEditMessage = useCallback(
    async (action: string, selectedText: string, fileIds: string[]) => {
      const prompt = QUICK_EDIT_PROMPTS[action];
      if (!prompt) return;

      const contexts: MessageContextItem[] = [{ type: "selection", text: selectedText }];
      const quickEdit = { action, originalText: selectedText };

      await sendMessage(prompt, fileIds, contexts, [], quickEdit);
    },
    [sendMessage]
  );

  return {
    sendMessage,
    sendQuickEditMessage,
    isStreaming,
    stopStreaming,
    currentTool,
    toolHistory,
    thinking,
    todos,
    clearTodos,
  };
}
