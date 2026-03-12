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

export type FileMentionContext = {
  id: string;
  type: "file_mention";
  fileId: string;
  fileName: string;
  fileSource: "document" | "data_file";
};

export type ChatContextItem =
  | SelectionContext
  | ImageContext
  | InlineResultContext
  | FileMentionContext;

// Input type for adding context (without id)
export type ChatContextInput =
  | Omit<SelectionContext, "id">
  | Omit<ImageContext, "id">
  | Omit<InlineResultContext, "id">
  | Omit<FileMentionContext, "id">;

interface ChatContextState {
  chatContexts: ChatContextItem[];
  /** Pending input text to prefill in the chat composer (consumed once on read). */
  pendingInput: string | null;

  addChatContext: (context: ChatContextInput) => void;
  removeChatContext: (id: string) => void;
  clearAllChatContexts: () => void;
  setPendingInput: (text: string) => void;
  consumePendingInput: () => string | null;
}

export const useChatContextStore = create<ChatContextState>()((set, get) => ({
  chatContexts: [],
  pendingInput: null,

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

  setPendingInput: (text) => set({ pendingInput: text }),

  consumePendingInput: () => {
    const text = get().pendingInput;
    if (text !== null) set({ pendingInput: null });
    return text;
  },
}));
