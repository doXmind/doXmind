import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { api } from "@/lib/api";
import type { ChatMessage } from "@/types";
import type { GlobalConversationItem } from "@/lib/api/global-agent";

/**
 * Global Agent Store
 *
 * Manages global agent conversations - separate from the per-file chat store
 * because global agent conversations are not tied to any file (file_id=NULL).
 */

export interface GlobalConversation {
  id: string;
  messages: ChatMessage[];
  createdAt: string | null;
  isLoaded: boolean;
}

interface GlobalAgentState {
  /** All loaded conversations keyed by conversation ID */
  conversations: Record<string, GlobalConversation>;
  /** Currently active conversation ID */
  activeConversationId: string | null;
  /** Conversation list for the sidebar (lightweight, no messages) */
  conversationList: GlobalConversationItem[];
  /** Loading states */
  isLoadingList: boolean;
  isLoadingMessages: boolean;

  // Actions
  /** Fetch the list of conversations from the backend */
  loadConversationList: () => Promise<void>;
  /** Load messages for a specific conversation */
  loadConversation: (conversationId: string) => Promise<void>;
  /** Create a new conversation and set it as active */
  createConversation: () => Promise<string>;
  /** Set the active conversation */
  setActiveConversation: (id: string | null) => void;
  /** Add a message to the local state */
  addMessage: (conversationId: string, message: Omit<ChatMessage, "id" | "createdAt">) => string;
  /** Append text chunk to a streaming message */
  appendToMessage: (conversationId: string, messageId: string, chunk: string) => void;
  /** Update a message with full data (e.g., after stream summary) */
  updateMessageFull: (
    conversationId: string,
    messageId: string,
    updates: Partial<ChatMessage>
  ) => void;
  /** Mark a message as streaming or not */
  setMessageStreaming: (conversationId: string, messageId: string, isStreaming: boolean) => void;
  /** Delete a conversation */
  deleteConversation: (conversationId: string) => Promise<void>;
  /** Clear messages in a conversation */
  clearConversation: (conversationId: string) => Promise<void>;
}

let idCounter = 0;
function generateId(): string {
  return `ga-${Date.now()}-${++idCounter}`;
}

export const useGlobalAgentStore = create<GlobalAgentState>()(
  immer((set, get) => ({
    conversations: {},
    activeConversationId: null,
    conversationList: [],
    isLoadingList: false,
    isLoadingMessages: false,

    loadConversationList: async () => {
      set({ isLoadingList: true });
      try {
        const data = await api.listGlobalConversations();
        set((state) => {
          state.conversationList = data.conversations;
          state.isLoadingList = false;
        });
      } catch (error) {
        console.error("Failed to load global agent conversations", error);
        set({ isLoadingList: false });
      }
    },

    loadConversation: async (conversationId: string) => {
      const state = get();
      if (state.conversations[conversationId]?.isLoaded) {
        set((draft) => {
          draft.activeConversationId = conversationId;
        });
        return;
      }

      set({ isLoadingMessages: true });
      try {
        const data = await api.getGlobalConversationMessages(conversationId);

        const messages: ChatMessage[] = data.messages.map((msg) => ({
          id: msg.id,
          role: msg.role,
          content: msg.content || "",
          thinking: msg.thinking,
          toolCalls: msg.toolCalls,
          edits: msg.edits,
          model: msg.model,
          createdAt: msg.createdAt || new Date().toISOString(),
        }));

        set((draft) => {
          draft.conversations[conversationId] = {
            id: data.id,
            messages,
            createdAt: data.createdAt,
            isLoaded: true,
          };
          draft.activeConversationId = conversationId;
          draft.isLoadingMessages = false;
        });
      } catch (error) {
        console.error("Failed to load global agent conversation messages", error);
        set({ isLoadingMessages: false });
      }
    },

    createConversation: async () => {
      const data = await api.createGlobalConversation();
      const conv: GlobalConversation = {
        id: data.id,
        messages: [],
        createdAt: data.createdAt,
        isLoaded: true,
      };

      set((draft) => {
        draft.conversations[data.id] = conv;
        draft.activeConversationId = data.id;
        // Prepend to the list
        draft.conversationList.unshift({
          id: data.id,
          createdAt: data.createdAt,
          lastMessage: null,
        });
      });

      return data.id;
    },

    setActiveConversation: (id) => {
      set((draft) => {
        draft.activeConversationId = id;
      });
    },

    addMessage: (conversationId, message) => {
      const id = generateId();
      const newMessage: ChatMessage = {
        ...message,
        id,
        createdAt: new Date().toISOString(),
      };

      set((draft) => {
        if (!draft.conversations[conversationId]) {
          draft.conversations[conversationId] = {
            id: conversationId,
            messages: [newMessage],
            createdAt: new Date().toISOString(),
            isLoaded: true,
          };
        } else {
          draft.conversations[conversationId].messages.push(newMessage);
        }
      });

      return id;
    },

    appendToMessage: (conversationId, messageId, chunk) => {
      set((draft) => {
        const msg = draft.conversations[conversationId]?.messages.find((m) => m.id === messageId);
        if (msg) {
          msg.content += chunk;
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

    setMessageStreaming: (conversationId, messageId, isStreaming) => {
      set((draft) => {
        const msg = draft.conversations[conversationId]?.messages.find((m) => m.id === messageId);
        if (msg) {
          msg.isStreaming = isStreaming;
        }
      });
    },

    deleteConversation: async (conversationId) => {
      try {
        await api.deleteGlobalConversation(conversationId);
      } catch (error) {
        console.error("Failed to delete global agent conversation", error);
      }

      set((draft) => {
        delete draft.conversations[conversationId];
        draft.conversationList = draft.conversationList.filter((c) => c.id !== conversationId);
        if (draft.activeConversationId === conversationId) {
          draft.activeConversationId = null;
        }
      });
    },

    clearConversation: async (conversationId) => {
      try {
        await api.deleteGlobalConversation(conversationId);
      } catch (error) {
        console.error("Failed to clear global agent conversation", error);
      }

      set((draft) => {
        const conv = draft.conversations[conversationId];
        if (conv) {
          conv.messages = [];
        }
      });
    },
  }))
);
