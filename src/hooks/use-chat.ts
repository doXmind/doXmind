"use client";

import { useState, useCallback, useRef } from "react";
import { useChatStore, type ChatMessage, type ToolCall } from "@/stores/chat-store";
import { useFileStore } from "@/stores/file-store";
import { useEditorStore, type PendingEdit } from "@/stores/editor-store";
import { htmlToMarkdown, isHtml } from "@/lib/markdown";
import { generateId } from "@/lib/utils";

// Types for edit operations from the backend
export interface EditOperation {
  type: "str_replace" | "insert" | "replace_all";
  file_id: string;
  file_name: string;
  success: boolean;
  error?: string;
  // For str_replace
  old_str?: string;
  new_str?: string;
  // For insert
  insert_line?: number;
  // For replace_all
  new_content?: string;
}

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

// Summary event from backend
interface SummaryEvent {
  type: "summary";
  content: string;
  thinking: string | null;
  toolCalls: ToolCall[] | null;
  edits: EditOperation[] | null;
  model: string;
}

export function useChat() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentTool, setCurrentTool] = useState<ToolStatus | null>(null);
  const [toolHistory, setToolHistory] = useState<ToolStatus[]>([]);
  const [thinking, setThinking] = useState<ThinkingStatus>({ isThinking: false, content: "" });
  const abortControllerRef = useRef<AbortController | null>(null);
  const toolInputRef = useRef<string>("");

  const {
    ensureConversation,
    addMessage,
    appendToMessage,
    setMessageStreaming,
    updateMessageFull,
    saveMessageToBackend,
  } = useChatStore();
  const { getFile, updateFile } = useFileStore();
  const { queueEdit } = useEditorStore();

  // Queue an edit operation to be applied through the editor (for undo support)
  const applyEdit = useCallback((edit: EditOperation): boolean => {
    const file = getFile(edit.file_id);
    if (!file) {
      console.error(`[useChat] File not found: ${edit.file_id}`);
      return false;
    }

    // Queue the edit to be applied through the editor
    // This ensures the edit goes through ProseMirror's transaction system
    // and can be undone with Ctrl+Z
    const pendingEdit: PendingEdit = {
      id: generateId(),
      type: edit.type,
      fileId: edit.file_id,
      oldStr: edit.old_str,
      newStr: edit.new_str,
      insertLine: edit.insert_line,
      newContent: edit.new_content,
    };

    queueEdit(pendingEdit);
    console.log(`[useChat] Queued ${edit.type} edit for ${edit.file_name}`);
    return true;
  }, [getFile, queueEdit]);

  const sendMessage = useCallback(
    async (message: string, fileIds: string[]) => {
      const conversationId = ensureConversation(fileIds[0] || null);

      // Add user message
      const userMessageId = addMessage(conversationId, {
        role: "user",
        content: message,
        fileIds,
      });

      // Save user message to backend
      const userMessage: ChatMessage = {
        id: userMessageId,
        role: "user",
        content: message,
        fileIds,
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
      toolInputRef.current = "";
      abortControllerRef.current = new AbortController();

      const collectedEdits: EditOperation[] = [];
      let summaryData: SummaryEvent | null = null;

      try {
        // Get file contents and convert HTML to markdown for AI
        const files = fileIds
          .map((id) => getFile(id))
          .filter(Boolean)
          .map((f) => {
            // Convert HTML to markdown so AI can work with it
            const content = isHtml(f!.content)
              ? htmlToMarkdown(f!.content)
              : f!.content;
            return {
              id: f!.id,
              name: f!.name,
              content: content,
            };
          });

        const response = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, files, conversationId }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) {
          throw new Error("No response body");
        }

        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;

            const data = line.slice(6);
            if (data === "[DONE]") break;

            try {
              const parsed = JSON.parse(data);

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
                    name: parsed.tool,
                    status: "running",
                    toolId: parsed.tool_id,
                    input: "",
                  };
                  setCurrentTool(toolStatus);
                  setToolHistory(prev => [...prev, toolStatus]);
                  break;
                }

                case "tool_input_delta": {
                  // Accumulate tool input for display
                  toolInputRef.current += parsed.delta || "";
                  setCurrentTool(prev => prev ? {
                    ...prev,
                    input: toolInputRef.current,
                  } : null);
                  break;
                }

                case "tool_end": {
                  const completedTool: ToolStatus = {
                    name: parsed.tool,
                    status: parsed.success === false ? "error" : "completed",
                    message: parsed.output,
                    toolId: parsed.tool_id,
                  };
                  setCurrentTool(completedTool);
                  toolInputRef.current = "";
                  // Update the last tool in history to completed
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
                  if (parsed.edits?.length > 0) {
                    let applied = 0;
                    for (const edit of parsed.edits) {
                      if (applyEdit(edit)) applied++;
                    }
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
                  // Capture summary for saving to backend
                  summaryData = parsed as SummaryEvent;
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
              }
            } catch {
              // Ignore JSON parse errors
            }
          }
        }

        // Apply any remaining collected edits
        if (collectedEdits.length > 0) {
          let applied = 0;
          for (const edit of collectedEdits) {
            if (applyEdit(edit)) applied++;
          }
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
        if (summaryData) {
          const assistantMessage: ChatMessage = {
            id: assistantMessageId,
            role: "assistant",
            content: summaryData.content,
            createdAt: new Date().toISOString(),
            thinking: summaryData.thinking,
            toolCalls: summaryData.toolCalls,
            edits: summaryData.edits as Record<string, unknown>[] | null,
            model: summaryData.model,
          };

          // Update local state with full data
          updateMessageFull(conversationId, assistantMessageId, {
            thinking: summaryData.thinking,
            toolCalls: summaryData.toolCalls,
            edits: summaryData.edits as Record<string, unknown>[] | null,
            model: summaryData.model,
          });

          // Save to backend
          saveMessageToBackend(conversationId, assistantMessage);
        }

      } catch (error) {
        const errorMessage = (error as Error).name === "AbortError"
          ? "\n\n*[Stopped]*"
          : "\n\n*Error: Failed to get response.*";
        appendToMessage(conversationId, assistantMessageId, errorMessage);
      } finally {
        setMessageStreaming(conversationId, assistantMessageId, false);
        setIsStreaming(false);
        setCurrentTool(null);
        setThinking({ isThinking: false, content: "" });
        toolInputRef.current = "";
        abortControllerRef.current = null;
      }
    },
    [ensureConversation, addMessage, appendToMessage, setMessageStreaming, getFile, applyEdit, saveMessageToBackend, updateMessageFull]
  );

  const stopStreaming = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  return {
    sendMessage,
    isStreaming,
    stopStreaming,
    currentTool,
    toolHistory,
    thinking,
  };
}
