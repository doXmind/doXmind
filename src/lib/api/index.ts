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
import "./inline-comments";
import "./data-files";
import "./global-agent";
import "./notifications";
import "./billing";
import "./bookmarks";
import "./databases";
import "./migration";
import "./migration-oauth";

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
  InlineCommentAnchor,
  InlineCommentResponse,
  InlineCommentsListResponse,
  ForkResponse,
  ForkInfo,
  UserProfileResponse,
  FollowResponse,
  FollowUser,
  FollowListResponse,
  InviteEntry,
  SearchUserResult,
  SharedWithMeItem,
  NotificationItem,
  NotificationListResponse,
} from "./types";
export type { GlobalConversationItem, GlobalConversationMessages } from "./global-agent";
export type { BillingStatus, CreditsInfo, StorageInfo, PricingInfo, PlanInfo } from "./billing";
export type { BookmarkMetadata } from "./bookmarks";
export type {
  MigrationPreview,
  MigrationTreeNode,
  MigrationSourceFormat,
  MigrationFormatsResponse,
  MigrationEvent,
  MigrationProgressEvent,
  MigrationWarningEvent,
  MigrationCompleteEvent,
} from "./migration";
export type { RemotePage, OAuthCallbackData } from "./migration-oauth";

// Create and export the default client instance
import { ApiClient } from "./client";
export const api = new ApiClient();
