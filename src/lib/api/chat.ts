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
    simpleChat(message: string, system?: string): Promise<{ response: string }>;
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
  system?: string
) {
  return this.request<{ response: string }>("/api/chat/simple", {
    method: "POST",
    body: JSON.stringify({ message, system }),
  });
};

// Health check
ApiClient.prototype.healthCheck = async function (this: ApiClient) {
  return this.request<{ status: string }>("/health");
};
