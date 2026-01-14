import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { generateId } from "@/lib/utils";
import type { ChatMessage, Conversation, ToolCall, MessageContextItem, EditOperation } from "@/types";

// Re-export for convenience
export type { ChatMessage, Conversation, ToolCall, MessageContextItem, EditOperation } from "@/types";

interface ChatState {
  conversations: Record<string, Conversation>;
  activeConversationId: string | null;
  isLoadingHistory: boolean;

  // Actions
  ensureConversation: (fileId: string | null) => string;
  loadConversation: (fileId: string) => Promise<void>;
  addMessage: (
    conversationId: string,
    message: Omit<ChatMessage, "id" | "createdAt">
  ) => string;
  updateMessage: (
    conversationId: string,
    messageId: string,
    content: string
  ) => void;
  updateMessageFull: (
    conversationId: string,
    messageId: string,
    updates: Partial<ChatMessage>
  ) => void;
  appendToMessage: (
    conversationId: string,
    messageId: string,
    chunk: string
  ) => void;
  setMessageStreaming: (
    conversationId: string,
    messageId: string,
    isStreaming: boolean
  ) => void;
  clearConversation: (conversationId: string) => Promise<void>;
  deleteConversation: (fileId: string) => Promise<void>;
  setActiveConversation: (id: string | null) => void;
  saveMessageToBackend: (conversationId: string, message: ChatMessage) => Promise<void>;
}

export const useChatStore = create<ChatState>()(
  immer((set, get) => ({
  conversations: {},
  activeConversationId: null,
  isLoadingHistory: false,

  // Load conversation from backend
  loadConversation: async (fileId: string) => {
    const state = get();
    const key = fileId || "global";

    // Skip if already loaded
    if (state.conversations[key]?.isLoaded) {
      return;
    }

    set({ isLoadingHistory: true });

    try {
      const response = await fetch(`/api/chat/conversations/${fileId}`);
      if (!response.ok) {
        throw new Error("Failed to load conversation");
      }

      const data = await response.json();

      // Transform backend messages to frontend format
      const messages: ChatMessage[] = data.messages.map((msg: {
        id: string;
        role: "user" | "assistant";
        content: string;
        contexts?: MessageContextItem[] | null;
        thinking?: string | null;
        toolCalls?: ToolCall[] | null;
        edits?: EditOperation[] | null;
        model?: string | null;
        createdAt: string;
      }) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content || "",
        contexts: msg.contexts || null,
        createdAt: msg.createdAt,
        thinking: msg.thinking,
        toolCalls: msg.toolCalls,
        edits: msg.edits,
        model: msg.model,
      }));

      const conversation: Conversation = {
        id: data.id,
        fileId: data.fileId,
        messages,
        createdAt: data.createdAt,
        isLoaded: true,
      };

      set((state) => {
        state.conversations[key] = conversation;
        state.activeConversationId = key;
        state.isLoadingHistory = false;
      });
    } catch (error) {
      console.error("Failed to load conversation:", error);
      set({ isLoadingHistory: false });
    }
  },

  // This function is only called when sending a message, not during render
  // Returns the key (fileId or "global") used for local state management
  // The backend UUID is stored in conversation.id for API calls
  ensureConversation: (fileId: string | null) => {
    const state = get();
    const key = fileId || "global";

    if (state.conversations[key]) {
      set((draft) => {
        draft.activeConversationId = key;
      });
      return key;
    }

    const newConversation: Conversation = {
      id: key,
      fileId,
      messages: [],
      createdAt: new Date().toISOString(),
      isLoaded: false,
    };

    set((draft) => {
      draft.conversations[key] = newConversation;
      draft.activeConversationId = key;
    });

    return key;
  },

  addMessage: (conversationId, message) => {
    const id = generateId();
    const newMessage: ChatMessage = {
      ...message,
      id,
      createdAt: new Date().toISOString(),
    };

    set((draft) => {
      const conversation = draft.conversations[conversationId];

      if (!conversation) {
        // Create conversation if it doesn't exist
        draft.conversations[conversationId] = {
          id: conversationId,
          fileId: conversationId === "global" ? null : conversationId,
          messages: [newMessage],
          createdAt: new Date().toISOString(),
          isLoaded: true,
        };
      } else {
        conversation.messages.push(newMessage);
      }
    });

    return id;
  },

  updateMessage: (conversationId, messageId, content) => {
    set((draft) => {
      const msg = draft.conversations[conversationId]?.messages.find(
        (m) => m.id === messageId
      );
      if (msg) {
        msg.content = content;
      }
    });
  },

  updateMessageFull: (conversationId, messageId, updates) => {
    set((draft) => {
      const conversation = draft.conversations[conversationId];
      if (!conversation) return;

      const msgIndex = conversation.messages.findIndex((m) => m.id === messageId);
      if (msgIndex !== -1) {
        Object.assign(conversation.messages[msgIndex], updates);
      }
    });
  },

  appendToMessage: (conversationId, messageId, chunk) => {
    set((draft) => {
      const msg = draft.conversations[conversationId]?.messages.find(
        (m) => m.id === messageId
      );
      if (msg) {
        msg.content += chunk;
      }
    });
  },

  setMessageStreaming: (conversationId, messageId, isStreaming) => {
    set((draft) => {
      const msg = draft.conversations[conversationId]?.messages.find(
        (m) => m.id === messageId
      );
      if (msg) {
        msg.isStreaming = isStreaming;
      }
    });
  },

  clearConversation: async (conversationId) => {
    // Clear on backend
    try {
      await fetch(`/api/chat/conversations/${conversationId}`, {
        method: "DELETE",
      });
    } catch (error) {
      console.error("Failed to clear conversation on backend:", error);
    }

    // Clear locally
    set((draft) => {
      const conversation = draft.conversations[conversationId];
      if (conversation) {
        conversation.messages = [];
      }
    });
  },

  // Delete conversation completely when file is deleted
  deleteConversation: async (fileId) => {
    const key = fileId || "global";

    // Delete on backend
    try {
      await fetch(`/api/chat/conversations/${fileId}`, {
        method: "DELETE",
      });
    } catch (error) {
      console.error("Failed to delete conversation on backend:", error);
    }

    // Remove from local state completely
    set((draft) => {
      delete draft.conversations[key];
      if (draft.activeConversationId === key) {
        draft.activeConversationId = null;
      }
    });
  },

  setActiveConversation: (id) => {
    set((draft) => {
      draft.activeConversationId = id;
    });
  },

  // Save a message to backend
  saveMessageToBackend: async (conversationId, message) => {
    try {
      await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          role: message.role,
          content: message.content,
          contexts: message.contexts,
          thinking: message.thinking,
          toolCalls: message.toolCalls,
          edits: message.edits,
          model: message.model,
        }),
      });
    } catch (error) {
      console.error("Failed to save message to backend:", error);
    }
  },
})));
