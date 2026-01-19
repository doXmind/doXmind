"use client";

import { useState, useCallback, useRef } from "react";
import { useChatStore, type ChatMessage, type ToolCall, type MessageContextItem } from "@/stores/chat-store";
import { useFileStore } from "@/stores/file-store";
import { useSettingsStore } from "@/stores/settings-store";
import { htmlToMarkdown, isHtml } from "@/lib/markdown";
import { processSSEStream, isAbortError, createStreamController } from "@/lib/streaming";
import { useEditOperations, type EditOperation } from "./use-edit-operations";
import { api } from "@/lib/api";

// Re-export types for convenience
export type { EditOperation } from "./use-edit-operations";

// Tool status for UI display
export interface ToolStatus {
  name: string;
  status: "running" | "completed" | "error";
  message?: string;
  toolId?: string;
  input?: string;
}

// Thinking status for UI display
export interface ThinkingStatus {
  isThinking: boolean;
  content: string;
}

// Todo item for progress tracking (aligned with Claude Code's TodoWrite)
export interface TodoItem {
  id: string;
  content: string;  // Imperative form: "Run tests"
  status: "pending" | "in_progress" | "completed";
  activeForm: string;  // Present continuous: "Running tests"
}

// Chat stream event types
interface ChatStreamEvent {
  type: string;
  content?: string;
  tool?: string;
  tool_id?: string;
  delta?: string;
  output?: string;
  success?: boolean;
  edit?: EditOperation;
  edits?: EditOperation[];
  thinking?: string | null;
  toolCalls?: ToolCall[] | null;
  model?: string;
  todos?: TodoItem[];
}

export function useChat() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentTool, setCurrentTool] = useState<ToolStatus | null>(null);
  const [toolHistory, setToolHistory] = useState<ToolStatus[]>([]);
  const [thinking, setThinking] = useState<ThinkingStatus>({ isThinking: false, content: "" });
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const streamControllerRef = useRef(createStreamController());
  const toolInputRef = useRef<string>("");

  const {
    ensureConversation,
    addMessage,
    appendToMessage,
    setMessageStreaming,
    updateMessageFull,
    saveMessageToBackend,
  } = useChatStore();
  const { getFile } = useFileStore();
  const { applyEdits } = useEditOperations();

  const sendMessage = useCallback(
    async (message: string, fileIds: string[], contexts?: MessageContextItem[] | null) => {
      const conversationId = ensureConversation(fileIds[0] || null);

      // Build the full message for AI (include text contexts)
      let messageForAI = message;
      const textContexts = contexts?.filter(c => c.type === 'selection') || [];
      if (textContexts.length > 0) {
        const contextTexts = textContexts.map((c, i) => {
          const prefix = textContexts.length > 1 ? `[Reference ${i + 1}:]\n` : '';
          return `${prefix}${c.text}`;
        }).join('\n\n');
        messageForAI = `${message}\n\n[Selected content for reference:]\n${contextTexts}`;
      }

      // Extract image contexts with base64 data for multimodal API
      const imageContexts = contexts
        ?.filter((c): c is MessageContextItem & { type: 'image'; base64: string; mediaType: string } =>
          c.type === 'image' && !!(c as { base64?: string }).base64 && !!(c as { mediaType?: string }).mediaType
        )
        .map(c => ({
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
      });

      // Save user message to backend
      // Strip base64 data from contexts before saving (too large for DB storage)
      // The src URL is preserved so images can still be displayed
      const contextsForStorage = contexts?.map(ctx => {
        if (ctx.type === 'image') {
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
        createdAt: new Date().toISOString(),
      };
      saveMessageToBackend(conversationId, userMessage);

      // Add assistant message placeholder
      const assistantMessageId = addMessage(conversationId, {
        role: "assistant",
        content: "",
        isStreaming: true,
      });

      setIsStreaming(true);
      setCurrentTool(null);
      setToolHistory([]);
      setThinking({ isThinking: false, content: "" });
      setTodos([]);
      toolInputRef.current = "";

      const signal = streamControllerRef.current.start();
      const collectedEdits: EditOperation[] = [];
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
        const files = fileIds
          .map((id) => getFile(id))
          .filter(Boolean)
          .map((f) => ({
            id: f!.id,
            name: f!.name,
            content: isHtml(f!.content) ? htmlToMarkdown(f!.content) : f!.content,
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
            images: imageContexts,  // Include image data for multimodal support
            conversationId,
            // Web search toggle (web fetch is always enabled)
            webSearchEnabled: webToolsSettings.webSearchEnabled,
          }),
          signal,
        });

        if (!response.ok) {
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
                setThinking(prev => ({
                  isThinking: true,
                  content: prev.content + parsed.content
                }));
              }
              break;

            case "thinking_end":
              setThinking(prev => ({ ...prev, isThinking: false }));
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
              setToolHistory(prev => [...prev, toolStatus]);
              break;
            }

            case "tool_input_delta": {
              toolInputRef.current += parsed.delta || "";
              setCurrentTool(prev => prev ? {
                ...prev,
                input: toolInputRef.current,
              } : null);
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
              setToolHistory(prev => {
                const newHistory = [...prev];
                const lastIndex = newHistory.findLastIndex(
                  t => (t.toolId === parsed.tool_id || t.name === parsed.tool) && t.status === "running"
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
                const editTool: ToolStatus = {
                  name: parsed.edit.type,
                  status: "completed",
                  message: `Editing ${parsed.edit.file_name}`,
                };
                setCurrentTool(editTool);
                setToolHistory(prev => [...prev, editTool]);
              }
              break;

            case "edits_batch":
              if (parsed.edits && parsed.edits.length > 0) {
                const applied = applyEdits(parsed.edits);
                const applyTool: ToolStatus = {
                  name: "apply_edits",
                  status: applied > 0 ? "completed" : "error",
                  message: applied > 0 ? `Applied ${applied} edit(s)` : "No edits applied",
                };
                setCurrentTool(applyTool);
                setToolHistory(prev => [...prev, applyTool]);
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
              break;

            case "error": {
              const errorTool: ToolStatus = {
                name: "error",
                status: "error",
                message: parsed.content,
              };
              setCurrentTool(errorTool);
              setToolHistory(prev => [...prev, errorTool]);
              break;
            }

            // Handle server-side tools (web_search, web_fetch)
            case "server_tool_start": {
              const serverToolStatus: ToolStatus = {
                name: parsed.tool || "",
                status: "running",
                toolId: parsed.tool_id,
                message: parsed.tool === "web_search" ? "Searching the web..." : "Fetching URL...",
              };
              setCurrentTool(serverToolStatus);
              setToolHistory(prev => [...prev, serverToolStatus]);
              break;
            }

            case "web_search_result": {
              const resultCount = (parsed as { results?: Array<unknown> }).results?.length || 0;
              setToolHistory(prev => {
                const newHistory = [...prev];
                const idx = newHistory.findLastIndex(t => t.toolId === parsed.tool_id);
                if (idx >= 0) {
                  newHistory[idx] = {
                    ...newHistory[idx],
                    status: "completed",
                    message: `Found ${resultCount} result${resultCount !== 1 ? 's' : ''}`,
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
              setToolHistory(prev => {
                const newHistory = [...prev];
                const idx = newHistory.findLastIndex(t => t.toolId === parsed.tool_id);
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

            case "todo_update":
              if (parsed.todos) {
                setTodos(parsed.todos);
              }
              break;
          }
        });

        // Apply any remaining collected edits
        if (collectedEdits.length > 0) {
          const applied = applyEdits(collectedEdits);
          if (applied > 0) {
            const finalTool: ToolStatus = {
              name: "apply_edits",
              status: "completed",
              message: `Applied ${applied} edit(s)`,
            };
            setCurrentTool(finalTool);
            setToolHistory(prev => [...prev, finalTool]);
          }
        }

        // Save assistant message to backend with full data
        if (summaryRef.data) {
          const assistantMessage: ChatMessage = {
            id: assistantMessageId,
            role: "assistant",
            content: summaryRef.data.content,
            createdAt: new Date().toISOString(),
            thinking: summaryRef.data.thinking,
            toolCalls: summaryRef.data.toolCalls,
            edits: summaryRef.data.edits,
            model: summaryRef.data.model,
          };

          updateMessageFull(conversationId, assistantMessageId, {
            thinking: summaryRef.data.thinking,
            toolCalls: summaryRef.data.toolCalls,
            edits: summaryRef.data.edits,
            model: summaryRef.data.model,
          });

          saveMessageToBackend(conversationId, assistantMessage);
        }

      } catch (error) {
        const errorMessage = isAbortError(error)
          ? "\n\n*[Stopped]*"
          : "\n\n*Error: Failed to get response.*";
        appendToMessage(conversationId, assistantMessageId, errorMessage);
      } finally {
        setMessageStreaming(conversationId, assistantMessageId, false);
        setIsStreaming(false);
        setCurrentTool(null);
        setThinking({ isThinking: false, content: "" });
        // Don't clear todos - keep them visible after streaming ends
        toolInputRef.current = "";
      }
    },
    [ensureConversation, addMessage, appendToMessage, setMessageStreaming, getFile, applyEdits, saveMessageToBackend, updateMessageFull]
  );

  const stopStreaming = useCallback(() => {
    streamControllerRef.current.abort();
  }, []);

  const clearTodos = useCallback(() => {
    setTodos([]);
  }, []);

  return {
    sendMessage,
    isStreaming,
    stopStreaming,
    currentTool,
    toolHistory,
    thinking,
    todos,
    clearTodos,
  };
}
