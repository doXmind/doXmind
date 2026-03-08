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

import { processSSEStream, isAbortError, createStreamController } from "@/lib/streaming";
import { useEditOperations, type EditOperation } from "./use-edit-operations";
import { useDiffReviewStore } from "@/stores/diff-review-store";
import { useEditorStore } from "@/stores/editor-store";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useChatContextStore } from "@/stores/chat-context-store";
import { api } from "@/lib/api";
import { QUICK_EDIT_PROMPTS } from "@/lib/quick-edit-prompts";
import type { ChatStreamEvent } from "@/types/stream-events";

interface ChatRequestOptions {
  origin?: "inline" | "side";
  intent?: "write" | "edit" | "ask";
  requestId?: string;
}

interface ImageContextForApi {
  src?: string;
  alt?: string;
  base64: string;
  mediaType: string;
}

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
    removeMessagesAfter,
  } = useChatStore();
  const { getFile } = useFileStore();
  const { demoFile } = useDemoStore();
  const { applyEdits } = useEditOperations();

  /**
   * Core streaming helper: creates an assistant placeholder, streams SSE,
   * and handles all event processing. Extracted from sendMessage so that
   * regenerate/resend/editAndResend can reuse the same streaming logic.
   */
  const streamResponse = useCallback(
    async (
      conversationId: string,
      messageForAI: string,
      fileIds: string[],
      imageContexts: ImageContextForApi[],
      dataFileIds: string[],
      isQuickEdit: boolean,
      options?: ChatRequestOptions,
      hasSelectionContexts?: boolean
    ) => {
      const isInlineOrigin = options?.origin === "inline";
      const inlineRequestId = options?.requestId || crypto.randomUUID();

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
        const liveEditor = useEditorRefStore.getState().editor;
        const currentFileId = useFileStore.getState().currentFileId;
        const files = fileIds
          .map((id) => (id === "demo-file" ? demoFile : getFile(id)))
          .filter((f): f is NonNullable<typeof f> => f != null)
          .map((f) => {
            let liveMarkdown: string | null = null;
            try {
              if (liveEditor && currentFileId === f.id) {
                liveMarkdown = liveEditor.getMarkdown();
              }
            } catch {
              liveMarkdown = null;
            }

            return {
              id: f.id,
              name: f.name,
              // Prefer live editor markdown for the active file to avoid
              // debounce lag causing str_replace old_str mismatches.
              content: liveMarkdown !== null ? liveMarkdown : f.contentMarkdown || f.content,
            };
          });

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
            // Thinking mode toggle (deep reasoning model)
            thinkingEnabled: webToolsSettings.thinkingEnabled,
            // Data files for code execution sandbox
            dataFileIds: dataFileIds || [],
            // Quick edit mode flag for backend optimization
            isQuickEdit,
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
                if (isInlineOrigin) {
                  const editorState = useEditorStore.getState();
                  editorState.setInlineAIResponseStatus(inlineRequestId, "streaming");
                  editorState.appendInlineAIResponse(inlineRequestId, parsed.content);
                }
              }
              break;

            case "thinking_start":
              setThinking({ isThinking: true, content: "" });
              if (isInlineOrigin) {
                useEditorStore.getState().setInlineAIResponseStatus(inlineRequestId, "thinking");
              }
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
              // Update credits from stream summary
              if (parsed.credits_remaining != null) {
                import("@/stores/billing-store").then(({ useBillingStore }) => {
                  useBillingStore.getState().updateCreditsFromStream(parsed.credits_remaining!);
                });
              }
              if (isInlineOrigin) {
                useEditorStore.getState().setInlineAIResponseStatus(inlineRequestId, "ready");
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
        if (isInlineOrigin) {
          useEditorStore
            .getState()
            .setInlineAIResponseStatus(
              inlineRequestId,
              "error",
              errorMessage.replace(/^\n\n\*/, "").replace(/\*$/, "")
            );
        }
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
        if (isInlineOrigin) {
          const inlineState = useEditorStore.getState().inlineAIResponse;
          if (inlineState && inlineState.requestId === inlineRequestId) {
            if (inlineState.status === "thinking" || inlineState.status === "streaming") {
              if (!inlineState.content.trim() && collectedEdits.length > 0) {
                useEditorStore
                  .getState()
                  .appendInlineAIResponse(
                    inlineRequestId,
                    "Edits are ready in the document. Review and accept them inline."
                  );
              }
              useEditorStore.getState().setInlineAIResponseStatus(inlineRequestId, "ready");
            }
          }
        }

        if (hasSelectionContexts) {
          const contextStore = useChatContextStore.getState();
          contextStore.chatContexts
            .filter((ctx) => ctx.type === "selection")
            .forEach((ctx) => contextStore.removeChatContext(ctx.id));

          useEditorStore.getState().setSelection(null);
          const editor = useEditorRefStore.getState().editor;
          if (editor) {
            editor.commands.clearInlineAISelectionHighlight();
            const { to } = editor.state.selection;
            editor.commands.setTextSelection(to);
          }
        }
      }
    },
    [
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
      clearTodos,
    ]
  );

  const sendMessage = useCallback(
    async (
      message: string,
      fileIds: string[],
      contexts?: MessageContextItem[] | null,
      dataFileIds?: string[],
      quickEdit?: { action: string; originalText: string } | null,
      inlineReference?: {
        from: number;
        to: number;
        beforeText: string;
        afterText: string;
      } | null,
      options?: ChatRequestOptions
    ) => {
      const hasSelectionContexts = !!contexts?.some((c) => c.type === "selection");
      const isInlineOrigin = options?.origin === "inline";
      const inlineRequestId = options?.requestId || crypto.randomUUID();
      const inlineIntent = options?.intent || "ask";

      if (isInlineOrigin) {
        useEditorStore.getState().startInlineAIResponse(inlineRequestId, inlineIntent);
      }

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

        messageForAI +=
          "\n\n<selection_scope_rule>For edits, modify ONLY selected_content. Do NOT change any text outside selected_content.</selection_scope_rule>";
      }

      if (inlineReference) {
        const beforeText = inlineReference.beforeText.trim();
        const afterText = inlineReference.afterText.trim();
        const anchorBlock =
          "<cursor_anchor>\n" +
          `  <before>${beforeText}</before>\n` +
          `  <after>${afterText}</after>\n` +
          `  <range from=\"${inlineReference.from}\" to=\"${inlineReference.to}\" />\n` +
          "</cursor_anchor>\n\n" +
          "Important: If the user asks to continue/add/insert, use this anchor as the primary insertion location.";
        messageForAI = `${messageForAI}\n\n${anchorBlock}`;
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
      const imageContexts: ImageContextForApi[] =
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

      // Pass inline options through to streamResponse
      const streamOptions: ChatRequestOptions | undefined = isInlineOrigin
        ? { origin: "inline", intent: inlineIntent, requestId: inlineRequestId }
        : options;

      await streamResponse(
        conversationId,
        messageForAI,
        fileIds,
        imageContexts,
        dataFileIds || [],
        !!quickEdit,
        streamOptions,
        hasSelectionContexts
      );
    },
    [ensureConversation, addMessage, saveMessageToBackend, streamResponse]
  );

  const stopStreaming = useCallback(() => {
    clearTodos();
    streamControllerRef.current.abort();
  }, [clearTodos]);

  /** Send a quick edit action as a chat message with selection context */
  const sendQuickEditMessage = useCallback(
    async (
      action: string,
      selectedText: string,
      fileIds: string[],
      options?: ChatRequestOptions
    ) => {
      const prompt = QUICK_EDIT_PROMPTS[action];
      if (!prompt) return;

      const contexts: MessageContextItem[] = [{ type: "selection", text: selectedText }];
      const quickEdit = { action, originalText: selectedText };

      await sendMessage(prompt, fileIds, contexts, [], quickEdit, null, options);
    },
    [sendMessage]
  );

  /** Regenerate the last AI response */
  const regenerateLastResponse = useCallback(
    async (fileIds: string[]) => {
      const conversationId = fileIds[0] || null;
      if (!conversationId) return;

      const conversation = useChatStore.getState().conversations[conversationId];
      if (!conversation || conversation.messages.length === 0) return;

      const messages = conversation.messages;
      const lastMessage = messages[messages.length - 1];

      // Find the last user message
      let userMessage: ChatMessage | undefined;
      if (lastMessage.role === "assistant") {
        userMessage = [...messages].reverse().find((m) => m.role === "user");
      } else {
        userMessage = lastMessage;
      }

      if (!userMessage) return;

      // Remove the user message and everything after it locally
      // (this removes the assistant response too)
      removeMessagesAfter(conversationId, userMessage.id, true);

      // Soft-delete user message + assistant response on backend (inclusive)
      // Use relative fetch (through Next.js proxy) for reliable routing
      if (conversationId !== "demo-file") {
        try {
          const backendConvId = conversation.id || conversationId;
          await fetch("/api/chat/messages/truncate", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...api.getAuthorizationHeaders(),
            },
            body: JSON.stringify({
              conversationId: backendConvId,
              afterMessageId: userMessage.id,
              inclusive: true,
            }),
          });
        } catch (error) {
          console.warn("Failed to truncate messages on backend:", error);
        }
      }

      // Re-add the user message locally (fresh copy)
      const newUserMessageId = addMessage(conversationId, {
        role: "user",
        content: userMessage.content,
        fileIds: userMessage.fileIds || fileIds,
        contexts: userMessage.contexts,
        quickEdit: userMessage.quickEdit || null,
      });

      // Save the re-added user message to backend
      const newUserMessage: ChatMessage = {
        id: newUserMessageId,
        role: "user",
        content: userMessage.content,
        fileIds: userMessage.fileIds || fileIds,
        contexts: userMessage.contexts,
        quickEdit: userMessage.quickEdit || null,
        createdAt: new Date().toISOString(),
      };
      saveMessageToBackend(conversationId, newUserMessage);

      // Rebuild messageForAI from the stored user message content
      let messageForAI = userMessage.content;
      const textContexts = userMessage.contexts?.filter((c) => c.type === "selection") || [];
      if (textContexts.length > 0) {
        const contextTexts = textContexts
          .map((c, i) => {
            if (textContexts.length > 1) {
              return `<reference index="${i + 1}">\n${c.text}\n</reference>`;
            }
            return c.text;
          })
          .join("\n\n");
        messageForAI = `${userMessage.content}\n\n<selected_content>\n${contextTexts}\n</selected_content>`;
        messageForAI +=
          "\n\n<selection_scope_rule>For edits, modify ONLY selected_content. Do NOT change any text outside selected_content.</selection_scope_rule>";
      }

      await streamResponse(
        conversationId,
        messageForAI,
        userMessage.fileIds || fileIds,
        [],
        [],
        !!userMessage.quickEdit,
        undefined,
        false
      );
    },
    [removeMessagesAfter, addMessage, saveMessageToBackend, streamResponse]
  );

  /** Resend the last user message (retry after error/stop) */
  const resendLastUserMessage = useCallback(
    async (fileIds: string[]) => {
      const conversationId = fileIds[0] || null;
      if (!conversationId) return;

      const conversation = useChatStore.getState().conversations[conversationId];
      if (!conversation || conversation.messages.length === 0) return;

      const messages = conversation.messages;

      // Find the last user message (before any failed assistant message)
      const userMessage = [...messages].reverse().find((m) => m.role === "user");
      if (!userMessage) return;

      // Remove user message and everything after it (including failed assistant)
      removeMessagesAfter(conversationId, userMessage.id, true);

      // Soft-delete user message + partial responses on backend (inclusive)
      // Use relative fetch (through Next.js proxy) for reliable routing
      if (conversationId !== "demo-file") {
        try {
          const backendConvId = conversation.id || conversationId;
          await fetch("/api/chat/messages/truncate", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...api.getAuthorizationHeaders(),
            },
            body: JSON.stringify({
              conversationId: backendConvId,
              afterMessageId: userMessage.id,
              inclusive: true,
            }),
          });
        } catch (error) {
          console.warn("Failed to truncate messages on backend:", error);
        }
      }

      // Re-add the user message locally (fresh copy)
      const newUserMessageId = addMessage(conversationId, {
        role: "user",
        content: userMessage.content,
        fileIds: userMessage.fileIds || fileIds,
        contexts: userMessage.contexts,
        quickEdit: userMessage.quickEdit || null,
      });

      // Save the re-added user message to backend
      const newUserMessage: ChatMessage = {
        id: newUserMessageId,
        role: "user",
        content: userMessage.content,
        fileIds: userMessage.fileIds || fileIds,
        contexts: userMessage.contexts,
        quickEdit: userMessage.quickEdit || null,
        createdAt: new Date().toISOString(),
      };
      saveMessageToBackend(conversationId, newUserMessage);

      // Rebuild messageForAI
      let messageForAI = userMessage.content;
      const textContexts = userMessage.contexts?.filter((c) => c.type === "selection") || [];
      if (textContexts.length > 0) {
        const contextTexts = textContexts
          .map((c, i) => {
            if (textContexts.length > 1) {
              return `<reference index="${i + 1}">\n${c.text}\n</reference>`;
            }
            return c.text;
          })
          .join("\n\n");
        messageForAI = `${userMessage.content}\n\n<selected_content>\n${contextTexts}\n</selected_content>`;
        messageForAI +=
          "\n\n<selection_scope_rule>For edits, modify ONLY selected_content. Do NOT change any text outside selected_content.</selection_scope_rule>";
      }

      await streamResponse(
        conversationId,
        messageForAI,
        userMessage.fileIds || fileIds,
        [],
        [],
        !!userMessage.quickEdit,
        undefined,
        false
      );
    },
    [removeMessagesAfter, addMessage, saveMessageToBackend, streamResponse]
  );

  /** Edit a past user message and resend (removes all messages after it) */
  const editAndResend = useCallback(
    async (messageId: string, newContent: string, fileIds: string[]) => {
      const conversationId = fileIds[0] || null;
      if (!conversationId) return;

      const conversation = useChatStore.getState().conversations[conversationId];
      if (!conversation) return;

      // Find the original message to preserve its contexts
      const originalMessage = conversation.messages.find((m) => m.id === messageId);
      if (!originalMessage || originalMessage.role !== "user") return;

      // Optimistically remove the edited message and everything after it
      removeMessagesAfter(conversationId, messageId, true);

      // Add new user message with edited content (preserve original contexts)
      const newUserMessageId = addMessage(conversationId, {
        role: "user",
        content: newContent,
        fileIds: originalMessage.fileIds || fileIds,
        contexts: originalMessage.contexts,
        quickEdit: originalMessage.quickEdit || null,
      });

      // Soft-delete on backend (skip for demo mode)
      // Use relative fetch (through Next.js proxy) for reliable routing
      if (conversationId !== "demo-file") {
        try {
          const backendConvId = conversation.id || conversationId;
          await fetch("/api/chat/messages/truncate", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...api.getAuthorizationHeaders(),
            },
            body: JSON.stringify({
              conversationId: backendConvId,
              afterMessageId: messageId,
              inclusive: true,
            }),
          });
        } catch (error) {
          console.warn("Failed to truncate messages on backend:", error);
        }
      }

      // Save new user message to backend
      const newUserMessage: ChatMessage = {
        id: newUserMessageId,
        role: "user",
        content: newContent,
        fileIds: originalMessage.fileIds || fileIds,
        contexts: originalMessage.contexts,
        quickEdit: originalMessage.quickEdit || null,
        createdAt: new Date().toISOString(),
      };
      saveMessageToBackend(conversationId, newUserMessage);

      // Rebuild messageForAI
      let messageForAI = newContent;
      const textContexts = originalMessage.contexts?.filter((c) => c.type === "selection") || [];
      if (textContexts.length > 0) {
        const contextTexts = textContexts
          .map((c, i) => {
            if (textContexts.length > 1) {
              return `<reference index="${i + 1}">\n${c.text}\n</reference>`;
            }
            return c.text;
          })
          .join("\n\n");
        messageForAI = `${newContent}\n\n<selected_content>\n${contextTexts}\n</selected_content>`;
        messageForAI +=
          "\n\n<selection_scope_rule>For edits, modify ONLY selected_content. Do NOT change any text outside selected_content.</selection_scope_rule>";
      }

      await streamResponse(
        conversationId,
        messageForAI,
        originalMessage.fileIds || fileIds,
        [],
        [],
        !!originalMessage.quickEdit,
        undefined,
        false
      );
    },
    [removeMessagesAfter, addMessage, saveMessageToBackend, streamResponse]
  );

  return {
    sendMessage,
    sendQuickEditMessage,
    regenerateLastResponse,
    resendLastUserMessage,
    editAndResend,
    isStreaming,
    stopStreaming,
    currentTool,
    toolHistory,
    thinking,
    todos,
    clearTodos,
  };
}
