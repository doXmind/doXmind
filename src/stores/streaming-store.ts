import { create } from "zustand";
import type { TodoItem } from "@/types/stream-events";

/**
 * Streaming Store
 *
 * Global state for AI streaming status, tool history, and todos.
 * This allows multiple components to react to streaming state changes.
 */

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

// Re-export TodoItem for backward compatibility
export type { TodoItem } from "@/types/stream-events";

interface StreamingState {
  // Streaming state
  isStreaming: boolean;
  currentTool: ToolStatus | null;
  toolHistory: ToolStatus[];
  thinking: ThinkingStatus;
  todos: TodoItem[];

  // Actions
  setStreaming: (isStreaming: boolean) => void;
  setCurrentTool: (
    tool: ToolStatus | null | ((prev: ToolStatus | null) => ToolStatus | null)
  ) => void;
  setToolHistory: (history: ToolStatus[] | ((prev: ToolStatus[]) => ToolStatus[])) => void;
  addToToolHistory: (tool: ToolStatus) => void;
  updateToolInHistory: (toolId: string, updates: Partial<ToolStatus>) => void;
  setThinking: (thinking: ThinkingStatus | ((prev: ThinkingStatus) => ThinkingStatus)) => void;
  appendThinkingContent: (content: string) => void;
  setTodos: (todos: TodoItem[]) => void;
  clearTodos: () => void;
  resetStreamingState: () => void;
}

export const useStreamingStore = create<StreamingState>()((set) => ({
  // Initial state
  isStreaming: false,
  currentTool: null,
  toolHistory: [],
  thinking: { isThinking: false, content: "" },
  todos: [],

  // Actions
  setStreaming: (isStreaming) => set({ isStreaming }),

  setCurrentTool: (toolOrUpdater) => {
    if (typeof toolOrUpdater === "function") {
      set((state) => ({ currentTool: toolOrUpdater(state.currentTool) }));
    } else {
      set({ currentTool: toolOrUpdater });
    }
  },

  setToolHistory: (historyOrUpdater) => {
    if (typeof historyOrUpdater === "function") {
      set((state) => ({ toolHistory: historyOrUpdater(state.toolHistory) }));
    } else {
      set({ toolHistory: historyOrUpdater });
    }
  },

  addToToolHistory: (tool) => set((state) => ({ toolHistory: [...state.toolHistory, tool] })),

  updateToolInHistory: (toolId, updates) =>
    set((state) => ({
      toolHistory: state.toolHistory.map((t) => (t.toolId === toolId ? { ...t, ...updates } : t)),
    })),

  setThinking: (thinkingOrUpdater) => {
    if (typeof thinkingOrUpdater === "function") {
      set((state) => ({ thinking: thinkingOrUpdater(state.thinking) }));
    } else {
      set({ thinking: thinkingOrUpdater });
    }
  },

  appendThinkingContent: (content) =>
    set((state) => ({
      thinking: {
        ...state.thinking,
        content: state.thinking.content + content,
      },
    })),

  setTodos: (todos) => set({ todos }),

  clearTodos: () => set({ todos: [] }),

  resetStreamingState: () =>
    set({
      isStreaming: false,
      currentTool: null,
      toolHistory: [],
      thinking: { isThinking: false, content: "" },
    }),
}));
