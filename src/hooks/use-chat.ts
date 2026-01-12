"use client";

import { useState, useCallback, useRef } from "react";
import { useChatStore, type ChatMessage, type ToolCall, type MessageContextItem } from "@/stores/chat-store";
import { useFileStore } from "@/stores/file-store";
import { useEditorStore } from "@/stores/editor-store";
import { htmlToMarkdown, isHtml } from "@/lib/markdown";
import { computeDiffHunks } from "@/lib/diff-utils";
import type { DiffHunk, EditOperation as DiffEditOperation } from "@/types/diff";
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
  const { startDiffReview, isReviewMode, addHunksToDiffSession, diffSession } = useEditorStore();

  // Apply multiple edit operations at once to avoid async state issues
  // Collects all hunks first, then starts/updates diff review session once
  const applyEdits = useCallback((edits: EditOperation[]): number => {
    if (edits.length === 0) return 0;

    // Group edits by file_id
    const editsByFile = new Map<string, EditOperation[]>();
    for (const edit of edits) {
      const existing = editsByFile.get(edit.file_id) || [];
      existing.push(edit);
      editsByFile.set(edit.file_id, existing);
    }

    let totalApplied = 0;

    // Process each file's edits
    for (const [fileId, fileEdits] of editsByFile) {
      const file = getFile(fileId);
      if (!file) {
        console.error(`[useChat] File not found: ${fileId}`);
        continue;
      }

      // Collect all hunks for this file
      const allHunks: DiffHunk[] = [];
      for (const edit of fileEdits) {
        const diffEdit: DiffEditOperation = {
          type: edit.type,
          file_id: edit.file_id,
          file_name: edit.file_name,
          success: edit.success,
          old_str: edit.old_str,
          new_str: edit.new_str,
          insert_line: edit.insert_line,
          new_content: edit.new_content,
        };

        const hunks = computeDiffHunks(file.content, diffEdit);
        if (hunks.length > 0) {
          allHunks.push(...hunks);
          totalApplied++;
        } else {
          console.warn(`[useChat] No diff hunks computed for ${edit.type} edit`);
        }
      }

      if (allHunks.length === 0) continue;

      // Check if we're already in review mode for this file
      if (isReviewMode && diffSession?.fileId === fileId) {
        // Add all hunks to existing session at once
        addHunksToDiffSession(allHunks);
        console.log(`[useChat] Added ${allHunks.length} hunk(s) to existing diff review`);
      } else {
        // Start a new diff review session with all hunks
        startDiffReview(fileId, allHunks, file.content);
        console.log(`[useChat] Started diff review with ${allHunks.length} hunk(s) for ${fileEdits[0].file_name}`);
      }
    }

    return totalApplied;
  }, [getFile, isReviewMode, diffSession, startDiffReview, addHunksToDiffSession]);

  const sendMessage = useCallback(
    async (message: string, fileIds: string[], contexts?: MessageContextItem[] | null) => {
      const conversationId = ensureConversation(fileIds[0] || null);

      // Build the full message for AI (include all contexts if present)
      let messageForAI = message;
      if (contexts && contexts.length > 0) {
        const contextTexts = contexts.map((c, i) => {
          const prefix = contexts.length > 1 ? `[Reference ${i + 1}:]\n` : '';
          if (c.type === 'image') {
            return `${prefix}[Image: ${c.src}${c.alt ? ` (alt: ${c.alt})` : ''}]`;
          }
          return `${prefix}${c.text}`;
        }).join('\n\n');
        messageForAI = `${message}\n\n[Selected content for reference:]\n${contextTexts}`;
      }

      // Add user message (with contexts for display, but clean content)
      const userMessageId = addMessage(conversationId, {
        role: "user",
        content: message,  // Store only the user's question
        fileIds,
        contexts,  // Store contexts separately for display
      });

      // Save user message to backend
      const userMessage: ChatMessage = {
        id: userMessageId,
        role: "user",
        content: message,
        fileIds,
        contexts,
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
          body: JSON.stringify({ message: messageForAI, files, conversationId }),
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

        // Apply any remaining collected edits (all at once to avoid async state issues)
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
    [ensureConversation, addMessage, appendToMessage, setMessageStreaming, getFile, applyEdits, saveMessageToBackend, updateMessageFull]
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
