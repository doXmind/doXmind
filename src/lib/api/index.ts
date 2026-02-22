/**
 * API client barrel file
 *
 * Imports all mixin modules to extend ApiClient prototype,
 * then re-exports everything for consumers.
 */

// Import mixin modules to apply prototype extensions
import "./auth";
import "./files";
import "./chat";
import "./kb";
import "./shares";
import "./community";
import "./comments";
import "./data-files";

// Re-export the client class and singleton
export { ApiClient } from "./client";

// Re-export all types
export type {
  SearchResultItem,
  SearchResults,
  User,
  TokenResponse,
  AuthStatus,
  MessageResponse,
  Share,
  ShareListResponse,
  CreateShareRequest,
  SharedDocumentResponse,
  SharedFolderItem,
  SharedItemResponse,
  CommunityAuthor,
  CommunityItem,
  CommunityListResponse,
  CommunityDetailResponse,
  CommentReactionSummary,
  CommentResponse,
  CommentsListResponse,
  ForkResponse,
  ForkInfo,
  UserProfileResponse,
  InviteEntry,
  SearchUserResult,
  SharedWithMeItem,
} from "./types";

// Create and export the default client instance
import { ApiClient } from "./client";
export const api = new ApiClient();
