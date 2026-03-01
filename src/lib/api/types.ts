/**
 * Type definitions for the API client
 */

// Search result types
export interface SearchResultItem {
  id: string;
  content: string;
  metadata: {
    file_id: string;
    chunk_index: number;
    name?: string;
    start?: number;
    end?: number;
  };
  distance?: number;
}

export interface SearchResults {
  results: SearchResultItem[];
}

// Auth types
export interface User {
  id: string;
  email: string;
  username?: string;
  avatar_url?: string;
  bio?: string;
  website?: string;
  social_links?: { github?: string; twitter?: string; linkedin?: string };
  is_verified: boolean;
  oauth_provider?: string;
  created_at?: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user?: User;
}

export interface AuthStatus {
  authenticated: boolean;
  auth_type?: string;
  user?: User;
  debug_mode: boolean;
}

export interface MessageResponse {
  success: boolean;
  message: string;
}

// Share types
export interface Share {
  id: string;
  file_id: string;
  file_name?: string | null;
  share_token: string;
  share_url: string;
  expires_at: string | null;
  is_active: boolean;
  is_published: boolean;
  visibility: "public" | "private";
  title?: string | null;
  description?: string | null;
  tags?: string[] | null;
  content_mode: string;
  view_count: number;
  created_at: string;
}

export interface ShareListResponse {
  shares: Share[];
  count: number;
  total?: number;
}

export interface CreateShareRequest {
  file_id: string;
  expires_in_days: number | null;
  content_mode: "live";
  visibility: "public" | "private";
  // Public mode fields
  title?: string;
  description?: string;
  tags?: string[];
  // Private mode fields
  invited_user_ids?: string[];
  invited_emails?: string[];
}

export interface SharedDocumentResponse {
  name: string;
  content: string;
  created_at: string;
  updated_at: string;
  is_snapshot: boolean;
  owner_name?: string;
}

export interface SharedFolderItem {
  id: string;
  name: string;
  is_folder: boolean;
  icon: string | null;
  updated_at: string;
  created_at: string;
}

export interface SharedItemResponse {
  name: string;
  is_folder: boolean;
  created_at: string;
  updated_at: string;
  is_snapshot: boolean;
  visibility?: "public" | "private";
  owner_name?: string;
  owner_avatar_url?: string;
  // Document fields (when is_folder is false)
  content?: string;
  // Folder fields (when is_folder is true)
  items?: SharedFolderItem[];
  breadcrumbs?: SharedFolderItem[];
  root_folder_name?: string;
}

// Community types
export interface CommunityAuthor {
  id: string;
  username: string | null;
  avatar_url: string | null;
  bio?: string | null;
}

export interface CommunityItem {
  share_id: string;
  share_token: string;
  title: string;
  description: string | null;
  tags: string[];
  owner: CommunityAuthor;
  is_folder: boolean;
  view_count: number;
  fork_count: number;
  bookmark_count: number;
  comment_count: number;
  published_at: string;
  updated_at: string;
  is_bookmarked: boolean;
  is_forked: boolean;
  content_preview: string | null;
  word_count: number;
  reading_time: number;
}

export interface CommunityListResponse {
  items: CommunityItem[];
  total: number;
  has_more: boolean;
}

export interface CommunityDetailResponse extends CommunityItem {
  fork_id: string | null;
}

export interface CommentReactionSummary {
  emoji: string;
  count: number;
  has_reacted: boolean;
}

export interface CommentResponse {
  id: string;
  content: string;
  author: CommunityAuthor;
  parent_id: string | null;
  mentions: string[] | null;
  reactions: CommentReactionSummary[];
  reply_count: number;
  is_deleted: boolean;
  is_edited: boolean;
  created_at: string;
  updated_at: string;
}

export interface CommentsListResponse {
  comments: CommentResponse[];
  total: number;
  has_more: boolean;
}

export interface ForkResponse {
  fork_id: string;
  forked_file_id: string;
  forked_file_name: string;
  source_share_id: string;
  created_at: string;
}

export interface ForkInfo {
  id: string;
  source_share_id: string | null;
  source_file_id: string | null;
  forked_file_id: string;
  forked_file_name: string;
  source_title: string | null;
  source_author: string | null;
  last_synced_at: string | null;
  created_at: string;
}

export interface UserProfileResponse {
  id: string;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  website: string | null;
  social_links: { github?: string; twitter?: string; linkedin?: string } | null;
  created_at: string;
  stats: {
    total_published: number;
    total_views: number;
    total_forks_received: number;
    total_bookmarks_received: number;
  };
}

export interface InviteEntry {
  id: string;
  user_id: string;
  username: string | null;
  email: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface SearchUserResult {
  id: string;
  username: string | null;
  email: string;
  avatar_url: string | null;
}

export interface SharedWithMeItem {
  share_id: string;
  share_token: string;
  title: string;
  share_url: string;
  is_folder: boolean;
  view_count: number;
  owner: CommunityAuthor;
  invited_at: string;
  created_at: string;
  updated_at: string;
}
