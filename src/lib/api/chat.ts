/**
 * Chat API methods - extends ApiClient prototype
 */

import type { MessageContextItem, ToolCall, EditOperation } from "@/types";
import { ApiClient } from "./client";

declare module "./client" {
  interface ApiClient {
    getConversation(fileId: string): Promise<{
      id: string;
      fileId: string;
      messages: {
        id: string;
        role: "user" | "assistant";
        content: string;
        contexts?: MessageContextItem[] | null;
        thinking?: string | null;
        toolCalls?: ToolCall[] | null;
        edits?: EditOperation[] | null;
        model?: string | null;
        createdAt: string;
      }[];
      createdAt: string;
    }>;
    simpleChat(message: string, system?: string, model?: string): Promise<{ response: string }>;
    truncateMessages(
      conversationId: string,
      afterMessageId: string,
      inclusive?: boolean
    ): Promise<{ success: boolean; deleted: number }>;
    healthCheck(): Promise<{ status: string }>;
  }
}

// Chat API

ApiClient.prototype.getConversation = async function (
  this: ApiClient,
  fileId: string
): Promise<{
  id: string;
  fileId: string;
  messages: {
    id: string;
    role: "user" | "assistant";
    content: string;
    contexts?: MessageContextItem[] | null;
    thinking?: string | null;
    toolCalls?: ToolCall[] | null;
    edits?: EditOperation[] | null;
    model?: string | null;
    createdAt: string;
  }[];
  createdAt: string;
}> {
  return this.request(`/api/chat/conversations/${fileId}`);
};

ApiClient.prototype.simpleChat = async function (
  this: ApiClient,
  message: string,
  system?: string,
  model?: string
) {
  return this.request<{ response: string }>("/api/chat/simple", {
    method: "POST",
    body: JSON.stringify({ message, system, model }),
  });
};

// Truncate messages (for regenerate/resend/edit-and-resend)
ApiClient.prototype.truncateMessages = async function (
  this: ApiClient,
  conversationId: string,
  afterMessageId: string,
  inclusive: boolean = false
) {
  return this.request<{ success: boolean; deleted: number }>("/api/chat/messages/truncate", {
    method: "POST",
    body: JSON.stringify({ conversationId, afterMessageId, inclusive }),
  });
};

// Health check
ApiClient.prototype.healthCheck = async function (this: ApiClient) {
  return this.request<{ status: string }>("/health");
};
