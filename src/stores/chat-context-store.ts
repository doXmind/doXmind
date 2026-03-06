import { create } from "zustand";

// Single context item for "Ask in Chat" feature
export type SelectionContext = {
  id: string;
  type: "selection";
  text: string;
  from: number;
  to: number;
};

export type ImageContext = {
  id: string;
  type: "image";
  src: string;
  alt?: string;
  base64?: string; // Base64 encoded image data (without data:... prefix)
  mediaType?: string; // MIME type (image/jpeg, image/png, etc.)
};

export type InlineResultContext = {
  id: string;
  type: "inline_result";
  text: string;
};

export type ChatContextItem = SelectionContext | ImageContext | InlineResultContext;

// Input type for adding context (without id)
export type ChatContextInput =
  | Omit<SelectionContext, "id">
  | Omit<ImageContext, "id">
  | Omit<InlineResultContext, "id">;

interface ChatContextState {
  chatContexts: ChatContextItem[];

  addChatContext: (context: ChatContextInput) => void;
  removeChatContext: (id: string) => void;
  clearAllChatContexts: () => void;
}

export const useChatContextStore = create<ChatContextState>()((set) => ({
  chatContexts: [],

  addChatContext: (context) =>
    set((state) => ({
      chatContexts: [
        ...state.chatContexts,
        { ...context, id: crypto.randomUUID() } as ChatContextItem,
      ],
    })),

  removeChatContext: (id) =>
    set((state) => ({
      chatContexts: state.chatContexts.filter((c) => c.id !== id),
    })),

  clearAllChatContexts: () => set({ chatContexts: [] }),
}));
