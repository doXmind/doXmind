import { create } from "zustand";
import { generateId } from "@/lib/utils";

export interface ToolCall {
  name: string;
  toolId?: string;
  input: string;
  output: string | null;
  success: boolean | null;
}

// Single context item attached to a user message (from "Ask in Chat" feature)
export type MessageContextItem =
  | {
      type: 'selection';
      text: string;
    }
  | {
      type: 'image';
      src: string;
      alt?: string;
    };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  fileIds?: string[];
  createdAt: string;
  isStreaming?: boolean;
  // User message specific fields
  contexts?: MessageContextItem[] | null;  // Selected text contexts from "Ask in Chat" (supports multiple)
  // AI response specific fields
  thinking?: string | null;
  toolCalls?: ToolCall[] | null;
  edits?: Record<string, unknown>[] | null;
  model?: string | null;
}

export interface Conversation {
  id: string;
  fileId: string | null;
  messages: ChatMessage[];
  createdAt: string;
  isLoaded?: boolean;  // Whether messages have been loaded from backend
}

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
  setActiveConversation: (id: string | null) => void;
  saveMessageToBackend: (conversationId: string, message: ChatMessage) => Promise<void>;
}

export const useChatStore = create<ChatState>()((set, get) => ({
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
        thinking?: string | null;
        toolCalls?: ToolCall[] | null;
        edits?: Record<string, unknown>[] | null;
        model?: string | null;
        createdAt: string;
      }) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content || "",
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

      set((state) => ({
        conversations: {
          ...state.conversations,
          [key]: conversation,
        },
        activeConversationId: key,
        isLoadingHistory: false,
      }));
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
      set({ activeConversationId: key });
      return key;  // Always return key, not conversation.id
    }

    const newConversation: Conversation = {
      id: key,
      fileId,
      messages: [],
      createdAt: new Date().toISOString(),
      isLoaded: false,
    };

    set((state) => ({
      conversations: {
        ...state.conversations,
        [key]: newConversation,
      },
      activeConversationId: key,
    }));

    return key;
  },

  addMessage: (conversationId, message) => {
    const id = generateId();
    const newMessage: ChatMessage = {
      ...message,
      id,
      createdAt: new Date().toISOString(),
    };

    set((state) => {
      const conversation = state.conversations[conversationId];

      // Create conversation if it doesn't exist
      if (!conversation) {
        const newConversation: Conversation = {
          id: conversationId,
          fileId: conversationId === "global" ? null : conversationId,
          messages: [newMessage],
          createdAt: new Date().toISOString(),
          isLoaded: true,
        };
        return {
          conversations: {
            ...state.conversations,
            [conversationId]: newConversation,
          },
        };
      }

      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...conversation,
            messages: [...conversation.messages, newMessage],
          },
        },
      };
    });

    return id;
  },

  updateMessage: (conversationId, messageId, content) => {
    set((state) => {
      const conversation = state.conversations[conversationId];
      if (!conversation) return state;

      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...conversation,
            messages: conversation.messages.map((msg) =>
              msg.id === messageId ? { ...msg, content } : msg
            ),
          },
        },
      };
    });
  },

  updateMessageFull: (conversationId, messageId, updates) => {
    set((state) => {
      const conversation = state.conversations[conversationId];
      if (!conversation) return state;

      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...conversation,
            messages: conversation.messages.map((msg) =>
              msg.id === messageId ? { ...msg, ...updates } : msg
            ),
          },
        },
      };
    });
  },

  appendToMessage: (conversationId, messageId, chunk) => {
    set((state) => {
      const conversation = state.conversations[conversationId];
      if (!conversation) return state;

      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...conversation,
            messages: conversation.messages.map((msg) =>
              msg.id === messageId ? { ...msg, content: msg.content + chunk } : msg
            ),
          },
        },
      };
    });
  },

  setMessageStreaming: (conversationId, messageId, isStreaming) => {
    set((state) => {
      const conversation = state.conversations[conversationId];
      if (!conversation) return state;

      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...conversation,
            messages: conversation.messages.map((msg) =>
              msg.id === messageId ? { ...msg, isStreaming } : msg
            ),
          },
        },
      };
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
    set((state) => {
      const conversation = state.conversations[conversationId];
      if (!conversation) return state;

      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...conversation,
            messages: [],
          },
        },
      };
    });
  },

  setActiveConversation: (id) => {
    set({ activeConversationId: id });
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
}));
