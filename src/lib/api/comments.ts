/**
 * Comments API methods - extends ApiClient prototype
 */

import { ApiClient } from "./client";
import type { CommentsListResponse, CommentResponse, CommentReactionSummary } from "./types";

declare module "./client" {
  interface ApiClient {
    getComments(
      shareToken: string,
      limit?: number,
      offset?: number,
      sort?: "oldest" | "newest"
    ): Promise<CommentsListResponse>;
    getCommentReplies(
      shareToken: string,
      commentId: string,
      limit?: number,
      offset?: number
    ): Promise<CommentsListResponse>;
    createComment(
      shareToken: string,
      content: string,
      parentId?: string | null,
      mentions?: string[]
    ): Promise<CommentResponse>;
    editComment(
      shareToken: string,
      commentId: string,
      content: string,
      mentions?: string[]
    ): Promise<CommentResponse>;
    deleteComment(
      shareToken: string,
      commentId: string
    ): Promise<{ status: string; comment_id: string }>;
    toggleReaction(
      shareToken: string,
      commentId: string,
      emoji: string
    ): Promise<{ reacted: boolean; reactions: CommentReactionSummary[] }>;
  }
}

ApiClient.prototype.getComments = async function (
  this: ApiClient,
  shareToken: string,
  limit = 50,
  offset = 0,
  sort: "oldest" | "newest" = "oldest"
): Promise<CommentsListResponse> {
  return this.request<CommentsListResponse>(
    `/api/comments/${shareToken}?limit=${limit}&offset=${offset}&sort=${sort}`
  );
};

ApiClient.prototype.getCommentReplies = async function (
  this: ApiClient,
  shareToken: string,
  commentId: string,
  limit = 50,
  offset = 0
): Promise<CommentsListResponse> {
  return this.request<CommentsListResponse>(
    `/api/comments/${shareToken}/${commentId}/replies?limit=${limit}&offset=${offset}`
  );
};

ApiClient.prototype.createComment = async function (
  this: ApiClient,
  shareToken: string,
  content: string,
  parentId?: string | null,
  mentions?: string[]
): Promise<CommentResponse> {
  return this.request<CommentResponse>(`/api/comments/${shareToken}`, {
    method: "POST",
    body: JSON.stringify({
      content,
      parent_id: parentId || null,
      mentions: mentions || null,
    }),
  });
};

ApiClient.prototype.editComment = async function (
  this: ApiClient,
  shareToken: string,
  commentId: string,
  content: string,
  mentions?: string[]
): Promise<CommentResponse> {
  return this.request<CommentResponse>(`/api/comments/${shareToken}/${commentId}`, {
    method: "PUT",
    body: JSON.stringify({ content, mentions: mentions || null }),
  });
};

ApiClient.prototype.deleteComment = async function (
  this: ApiClient,
  shareToken: string,
  commentId: string
): Promise<{ status: string; comment_id: string }> {
  return this.request<{ status: string; comment_id: string }>(
    `/api/comments/${shareToken}/${commentId}`,
    { method: "DELETE" }
  );
};

ApiClient.prototype.toggleReaction = async function (
  this: ApiClient,
  shareToken: string,
  commentId: string,
  emoji: string
): Promise<{ reacted: boolean; reactions: CommentReactionSummary[] }> {
  return this.request<{ reacted: boolean; reactions: CommentReactionSummary[] }>(
    `/api/comments/${shareToken}/${commentId}/react`,
    { method: "POST", body: JSON.stringify({ emoji }) }
  );
};
