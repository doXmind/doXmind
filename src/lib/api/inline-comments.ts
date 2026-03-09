/**
 * Inline Comments API methods - extends ApiClient prototype
 */

import { ApiClient } from "./client";
import type { InlineCommentResponse, InlineCommentsListResponse } from "./types";

declare module "./client" {
  interface ApiClient {
    getInlineComments(
      shareToken: string,
      includeResolved?: boolean
    ): Promise<InlineCommentsListResponse>;
    createInlineComment(
      shareToken: string,
      content: string,
      anchorFrom: number,
      anchorTo: number,
      anchorText: string,
      anchorContextBefore?: string | null,
      anchorContextAfter?: string | null,
      mentions?: string[]
    ): Promise<InlineCommentResponse>;
    resolveInlineComment(
      shareToken: string,
      commentId: string
    ): Promise<{ id: string; is_resolved: boolean }>;
    unresolveInlineComment(
      shareToken: string,
      commentId: string
    ): Promise<{ id: string; is_resolved: boolean }>;
  }
}

ApiClient.prototype.getInlineComments = async function (
  this: ApiClient,
  shareToken: string,
  includeResolved = false
): Promise<InlineCommentsListResponse> {
  return this.request<InlineCommentsListResponse>(
    `/api/comments/${shareToken}/inline?include_resolved=${includeResolved}`
  );
};

ApiClient.prototype.createInlineComment = async function (
  this: ApiClient,
  shareToken: string,
  content: string,
  anchorFrom: number,
  anchorTo: number,
  anchorText: string,
  anchorContextBefore?: string | null,
  anchorContextAfter?: string | null,
  mentions?: string[]
): Promise<InlineCommentResponse> {
  return this.request<InlineCommentResponse>(`/api/comments/${shareToken}`, {
    method: "POST",
    body: JSON.stringify({
      content,
      anchor_from: anchorFrom,
      anchor_to: anchorTo,
      anchor_text: anchorText,
      anchor_context_before: anchorContextBefore || null,
      anchor_context_after: anchorContextAfter || null,
      mentions: mentions || null,
    }),
  });
};

ApiClient.prototype.resolveInlineComment = async function (
  this: ApiClient,
  shareToken: string,
  commentId: string
): Promise<{ id: string; is_resolved: boolean }> {
  return this.request(`/api/comments/${shareToken}/${commentId}/resolve`, {
    method: "POST",
  });
};

ApiClient.prototype.unresolveInlineComment = async function (
  this: ApiClient,
  shareToken: string,
  commentId: string
): Promise<{ id: string; is_resolved: boolean }> {
  return this.request(`/api/comments/${shareToken}/${commentId}/unresolve`, {
    method: "POST",
  });
};
