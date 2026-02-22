/**
 * API client - re-exports from modular api/ directory
 *
 * This file exists for backward compatibility.
 * All implementation is in src/lib/api/ directory.
 */
export { ApiClient, api } from "./api/index";
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
} from "./api/index";
