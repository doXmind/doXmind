/**
 * Community, Invite, Fork, Bookmark, and User Profile API methods - extends ApiClient prototype
 */

import { ApiClient } from "./client";
import type {
  CommunityListResponse,
  CommunityDetailResponse,
  CommunityItem,
  CommunityAuthor,
  ForkResponse,
  ForkInfo,
  SearchUserResult,
  InviteEntry,
  SharedWithMeItem,
  UserProfileResponse,
} from "./types";

declare module "./client" {
  interface ApiClient {
    // Community
    getCommunityTags(limit?: number): Promise<{ tags: { tag: string; count: number }[] }>;
    getCommunityItems(params?: {
      sort?: string;
      search?: string;
      tag?: string;
      limit?: number;
      offset?: number;
    }): Promise<CommunityListResponse>;
    getCommunityDetail(shareToken: string): Promise<CommunityDetailResponse>;
    getCommunityRecommendations(params?: {
      limit?: number;
      offset?: number;
    }): Promise<CommunityListResponse>;

    // Invite
    searchUsersForInvite(query: string): Promise<{ users: SearchUserResult[] }>;
    inviteUsers(
      shareId: string,
      userIds?: string[],
      emails?: string[]
    ): Promise<{ status: string; added: number }>;
    removeInvite(shareId: string, userId: string): Promise<{ status: string }>;
    listInvites(shareId: string): Promise<{ invites: InviteEntry[]; count: number }>;
    getSharedWithMe(): Promise<{ shares: SharedWithMeItem[]; count: number }>;

    // Fork
    forkDocument(shareToken: string, targetFolderId?: string): Promise<ForkResponse>;
    syncFork(
      forkId: string,
      options?: { force?: boolean; create_backup?: boolean }
    ): Promise<{
      status: "up_to_date" | "synced" | "conflict" | "error";
      message: string;
      has_local_changes?: boolean;
      backup_file_id?: string | null;
    }>;
    getMyForks(): Promise<{ forks: ForkInfo[] }>;

    // Bookmark
    toggleBookmark(shareToken: string): Promise<{ bookmarked: boolean; bookmark_count: number }>;
    getBookmarks(
      limit?: number,
      offset?: number
    ): Promise<{ items: CommunityItem[]; total: number }>;

    // User Profile
    getUserProfile(userId: string): Promise<UserProfileResponse>;
    getUserPublished(
      userId: string,
      sort?: string,
      limit?: number,
      offset?: number
    ): Promise<CommunityListResponse>;

    // Comments - mention search
    searchMentions(query: string): Promise<{ users: CommunityAuthor[] }>;
  }
}

// ==========================================================================
// Community API
// ==========================================================================

ApiClient.prototype.getCommunityTags = async function (
  this: ApiClient,
  limit = 20
): Promise<{ tags: { tag: string; count: number }[] }> {
  return this.request<{ tags: { tag: string; count: number }[] }>(
    `/api/community/tags?limit=${limit}`
  );
};

ApiClient.prototype.getCommunityItems = async function (
  this: ApiClient,
  params: {
    sort?: string;
    search?: string;
    tag?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<CommunityListResponse> {
  const searchParams = new URLSearchParams();
  if (params.sort) searchParams.set("sort", params.sort);
  if (params.search) searchParams.set("search", params.search);
  if (params.tag) searchParams.set("tag", params.tag);
  if (params.limit) searchParams.set("limit", params.limit.toString());
  if (params.offset) searchParams.set("offset", params.offset.toString());

  const url = `/api/community/discover?${searchParams.toString()}`;
  return this.request<CommunityListResponse>(url);
};

ApiClient.prototype.getCommunityDetail = async function (
  this: ApiClient,
  shareToken: string
): Promise<CommunityDetailResponse> {
  return this.request<CommunityDetailResponse>(`/api/community/discover/${shareToken}`);
};

ApiClient.prototype.getCommunityRecommendations = async function (
  this: ApiClient,
  params: { limit?: number; offset?: number } = {}
): Promise<CommunityListResponse> {
  const searchParams = new URLSearchParams();
  if (params.limit) searchParams.set("limit", params.limit.toString());
  if (params.offset) searchParams.set("offset", params.offset.toString());

  const url = `/api/community/recommendations?${searchParams.toString()}`;
  return this.request<CommunityListResponse>(url);
};

// ==========================================================================
// Invite API
// ==========================================================================

ApiClient.prototype.searchUsersForInvite = async function (
  this: ApiClient,
  query: string
): Promise<{ users: SearchUserResult[] }> {
  return this.request<{ users: SearchUserResult[] }>(
    `/api/shares/search-users?q=${encodeURIComponent(query)}`
  );
};

ApiClient.prototype.inviteUsers = async function (
  this: ApiClient,
  shareId: string,
  userIds?: string[],
  emails?: string[]
): Promise<{ status: string; added: number }> {
  return this.request<{ status: string; added: number }>(`/api/shares/${shareId}/invite`, {
    method: "POST",
    body: JSON.stringify({ user_ids: userIds, emails }),
  });
};

ApiClient.prototype.removeInvite = async function (
  this: ApiClient,
  shareId: string,
  userId: string
): Promise<{ status: string }> {
  return this.request<{ status: string }>(`/api/shares/${shareId}/invite/${userId}`, {
    method: "DELETE",
  });
};

ApiClient.prototype.listInvites = async function (
  this: ApiClient,
  shareId: string
): Promise<{ invites: InviteEntry[]; count: number }> {
  return this.request<{ invites: InviteEntry[]; count: number }>(`/api/shares/${shareId}/invites`);
};

ApiClient.prototype.getSharedWithMe = async function (
  this: ApiClient
): Promise<{ shares: SharedWithMeItem[]; count: number }> {
  return this.request<{ shares: SharedWithMeItem[]; count: number }>("/api/shares/shared-with-me");
};

// ==========================================================================
// Fork API
// ==========================================================================

ApiClient.prototype.forkDocument = async function (
  this: ApiClient,
  shareToken: string,
  targetFolderId?: string
): Promise<ForkResponse> {
  return this.request<ForkResponse>(`/api/community/${shareToken}/fork`, {
    method: "POST",
    body: JSON.stringify({ target_folder_id: targetFolderId || null }),
  });
};

ApiClient.prototype.syncFork = async function (
  this: ApiClient,
  forkId: string,
  options?: { force?: boolean; create_backup?: boolean }
): Promise<{
  status: "up_to_date" | "synced" | "conflict" | "error";
  message: string;
  has_local_changes?: boolean;
  backup_file_id?: string | null;
}> {
  return this.request(`/api/community/forks/${forkId}/sync`, {
    method: "POST",
    body: JSON.stringify(options ?? {}),
  });
};

ApiClient.prototype.getMyForks = async function (this: ApiClient): Promise<{ forks: ForkInfo[] }> {
  return this.request<{ forks: ForkInfo[] }>("/api/community/forks");
};

// ==========================================================================
// Bookmark API
// ==========================================================================

ApiClient.prototype.toggleBookmark = async function (
  this: ApiClient,
  shareToken: string
): Promise<{ bookmarked: boolean; bookmark_count: number }> {
  return this.request<{ bookmarked: boolean; bookmark_count: number }>(
    `/api/community/${shareToken}/bookmark`,
    { method: "POST" }
  );
};

ApiClient.prototype.getBookmarks = async function (
  this: ApiClient,
  limit = 50,
  offset = 0
): Promise<{ items: CommunityItem[]; total: number }> {
  return this.request<{ items: CommunityItem[]; total: number }>(
    `/api/community/bookmarks?limit=${limit}&offset=${offset}`
  );
};

// ==========================================================================
// User Profile API
// ==========================================================================

ApiClient.prototype.getUserProfile = async function (
  this: ApiClient,
  userId: string
): Promise<UserProfileResponse> {
  return this.request<UserProfileResponse>(`/api/community/users/${userId}`);
};

ApiClient.prototype.getUserPublished = async function (
  this: ApiClient,
  userId: string,
  sort = "newest",
  limit = 20,
  offset = 0
): Promise<CommunityListResponse> {
  return this.request<CommunityListResponse>(
    `/api/community/users/${userId}/published?sort=${sort}&limit=${limit}&offset=${offset}`
  );
};

// ==========================================================================
// Mention Search (used by comments but lives under community endpoint)
// ==========================================================================

ApiClient.prototype.searchMentions = async function (
  this: ApiClient,
  query: string
): Promise<{ users: CommunityAuthor[] }> {
  return this.request<{ users: CommunityAuthor[] }>(
    `/api/comments/mentions/search?q=${encodeURIComponent(query)}`
  );
};
