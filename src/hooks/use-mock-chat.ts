"use client";

import { useState, useCallback, useRef } from "react";
import { useDemoStore } from "@/stores/demo-store";
import { useDiffReviewStore } from "@/stores/diff-review-store";
import type { DemoScenario } from "@/components/demo/demo-scenarios";
import type { DiffHunk } from "@/types/diff";

export interface MockMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  createdAt: string;
  /** Scenario ID for assistant messages (used for diff display) */
  scenarioId?: string;
}

export interface MockToolStatus {
  name: string;
  status: "running" | "completed" | "error";
  message?: string;
}

export interface MockThinkingStatus {
  isThinking: boolean;
  content: string;
}

/**
 * Mock chat hook for demo mode
 * Simulates AI responses without making any API calls
 */
export function useMockChat() {
  const [messages, setMessages] = useState<MockMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentTool, setCurrentTool] = useState<MockToolStatus | null>(null);
  const [toolHistory, setToolHistory] = useState<MockToolStatus[]>([]);
  const [thinking, setThinking] = useState<MockThinkingStatus>({ isThinking: false, content: "" });

  const { demoFile } = useDemoStore();
  const { startDiffReview, isReviewMode } = useDiffReviewStore();
  const abortRef = useRef(false);

  // Simulate typing effect for text
  const streamText = useCallback(async (text: string, onChunk: (chunk: string) => void) => {
    const words = text.split(" ");
    for (let i = 0; i < words.length; i++) {
      if (abortRef.current) break;
      const word = words[i] + (i < words.length - 1 ? " " : "");
      onChunk(word);
      // Random delay between 20-60ms per word for natural feel
      await new Promise((r) => setTimeout(r, 20 + Math.random() * 40));
    }
  }, []);

  // Simulate thinking animation
  const simulateThinking = useCallback(
    async (thinkingText: string) => {
      setThinking({ isThinking: true, content: "" });

      // Stream thinking content
      await streamText(thinkingText, (chunk) => {
        if (!abortRef.current) {
          setThinking((prev) => ({ ...prev, content: prev.content + chunk }));
        }
      });

      // Brief pause after thinking
      await new Promise((r) => setTimeout(r, 300));
      setThinking((prev) => ({ ...prev, isThinking: false }));
    },
    [streamText]
  );

  // Simulate tool execution
  const simulateTools = useCallback(async (tools: DemoScenario["tools"]) => {
    for (const tool of tools) {
      if (abortRef.current) break;

      // Show tool as running
      const runningTool: MockToolStatus = {
        name: tool.name,
        status: "running",
        message: "Processing...",
      };
      setCurrentTool(runningTool);
      setToolHistory((prev) => [...prev, runningTool]);

      // Wait for tool duration
      await new Promise((r) => setTimeout(r, tool.duration));

      if (abortRef.current) break;

      // Show tool as completed
      const completedTool: MockToolStatus = {
        name: tool.name,
        status: "completed",
        message: tool.message,
      };
      setCurrentTool(completedTool);
      setToolHistory((prev) => {
        const newHistory = [...prev];
        newHistory[newHistory.length - 1] = completedTool;
        return newHistory;
      });

      // Brief pause between tools
      await new Promise((r) => setTimeout(r, 200));
    }
    setCurrentTool(null);
  }, []);

  // Start diff review for the edit (shows inline diff in editor)
  const startDiffForEdit = useCallback(
    (edit: DemoScenario["edit"]) => {
      if (!edit || !demoFile) return;

      // Only support replace type with searchText for diff view
      if (edit.type !== "replace" || !edit.searchText) return;

      const editId = `demo-edit-${Date.now()}`;
      const hunk: DiffHunk = {
        id: `hunk-${Date.now()}`,
        type: "replace",
        from: 0, // Will be resolved by diff extension using searchText
        to: 0,
        oldContent: edit.searchText,
        searchText: edit.searchText,
        newContent: edit.newContentText || edit.content,
        status: "pending",
        createdAt: new Date().toISOString(),
        editId,
      };

      // Start diff review session with the hunk
      startDiffReview(demoFile.id, [hunk], demoFile.content);
    },
    [demoFile, startDiffReview]
  );

  // Execute a demo scenario
  const executeScenario = useCallback(
    async (scenario: DemoScenario) => {
      if (isStreaming) return;

      abortRef.current = false;
      setIsStreaming(true);
      setToolHistory([]);

      // Add user message (just the label, icon is displayed separately)
      const userMessage: MockMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: scenario.label,
        createdAt: new Date().toISOString(),
        scenarioId: scenario.id,
      };
      setMessages((prev) => [...prev, userMessage]);

      // Add assistant message placeholder with scenario ID for diff display
      const assistantId = `assistant-${Date.now()}`;
      const assistantMessage: MockMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        isStreaming: true,
        createdAt: new Date().toISOString(),
        scenarioId: scenario.id,
      };
      setMessages((prev) => [...prev, assistantMessage]);

      try {
        // 1. Simulate thinking
        await simulateThinking(scenario.thinking);
        if (abortRef.current) return;

        // 2. Simulate tool calls
        await simulateTools(scenario.tools);
        if (abortRef.current) return;

        // 3. Start diff review if edit present (shows inline diff in editor)
        if (scenario.edit) {
          startDiffForEdit(scenario.edit);
        }

        // 4. Stream the response
        await streamText(scenario.response, (chunk) => {
          if (!abortRef.current) {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + chunk } : m))
            );
          }
        });
      } finally {
        // Mark message as done streaming
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, isStreaming: false } : m))
        );
        setIsStreaming(false);
        setThinking({ isThinking: false, content: "" });
        setCurrentTool(null);
      }
    },
    [isStreaming, simulateThinking, simulateTools, startDiffForEdit, streamText]
  );

  // Stop streaming
  const stopStreaming = useCallback(() => {
    abortRef.current = true;
    setIsStreaming(false);
    setThinking({ isThinking: false, content: "" });
    setCurrentTool(null);

    // Mark any streaming messages as stopped
    setMessages((prev) =>
      prev.map((m) =>
        m.isStreaming ? { ...m, isStreaming: false, content: m.content + "\n\n*[Stopped]*" } : m
      )
    );
  }, []);

  // Clear messages
  const clearMessages = useCallback(() => {
    setMessages([]);
    setToolHistory([]);
  }, []);

  return {
    messages,
    isStreaming,
    isReviewMode,
    currentTool,
    toolHistory,
    thinking,
    executeScenario,
    stopStreaming,
    clearMessages,
  };
}
