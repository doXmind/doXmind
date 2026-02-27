/**
 * Global Agent API methods - extends ApiClient prototype
 */

import type { ChatMessage } from "@/types";
import { ApiClient } from "./client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GlobalConversationItem {
  id: string;
  createdAt: string | null;
  lastMessage: string | null;
}

export interface GlobalConversationMessages {
  id: string;
  createdAt: string | null;
  messages: {
    id: string;
    role: "user" | "assistant";
    content: string;
    thinking?: string | null;
    toolCalls?: ChatMessage["toolCalls"];
    edits?: ChatMessage["edits"];
    model?: string | null;
    createdAt: string | null;
  }[];
}

// ---------------------------------------------------------------------------
// Module augmentation
// ---------------------------------------------------------------------------

declare module "./client" {
  interface ApiClient {
    /** Create a new global agent conversation */
    createGlobalConversation(): Promise<{ id: string; createdAt: string | null }>;

    /** List all global agent conversations for the current user */
    listGlobalConversations(): Promise<{ conversations: GlobalConversationItem[] }>;

    /** Get messages for a global agent conversation */
    getGlobalConversationMessages(conversationId: string): Promise<GlobalConversationMessages>;

    /** Save a user message to a global agent conversation */
    saveGlobalMessage(
      conversationId: string,
      content: string
    ): Promise<{
      id: string;
      conversationId: string;
      role: string;
      content: string;
      createdAt: string | null;
    }>;

    /** Delete a global agent conversation */
    deleteGlobalConversation(
      conversationId: string
    ): Promise<{ deleted: boolean; messagesDeleted?: number }>;
  }
}

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------

ApiClient.prototype.createGlobalConversation = async function (this: ApiClient) {
  return this.request("/api/global-agent/conversations", { method: "POST" });
};

ApiClient.prototype.listGlobalConversations = async function (this: ApiClient) {
  return this.request("/api/global-agent/conversations");
};

ApiClient.prototype.getGlobalConversationMessages = async function (
  this: ApiClient,
  conversationId: string
) {
  return this.request(`/api/global-agent/conversations/${conversationId}/messages`);
};

ApiClient.prototype.saveGlobalMessage = async function (
  this: ApiClient,
  conversationId: string,
  content: string
) {
  return this.request("/api/global-agent/messages", {
    method: "POST",
    body: JSON.stringify({ conversationId, role: "user", content }),
  });
};

ApiClient.prototype.deleteGlobalConversation = async function (
  this: ApiClient,
  conversationId: string
) {
  return this.request(`/api/global-agent/conversations/${conversationId}`, {
    method: "DELETE",
  });
};
