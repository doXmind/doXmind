"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import {
  Eye,
  Globe,
  Lock,
  Trash2,
  ExternalLink,
  Link2,
  Loader2,
  Users,
  UserPlus,
  Pencil,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLazyList } from "@/hooks/use-lazy-list";
import { useGridPageSize } from "@/hooks/use-grid-page-size";
import { GridPagination } from "./grid-pagination";

import { type Share, type InviteEntry, type SearchUserResult, api } from "@/lib/api";
import { EditShareModal, type EditableShareItem } from "@/components/community/edit-share-modal";
import { UserSearchInput } from "@/components/share/user-search-input";
import { toast } from "sonner";
import { ConfirmModal } from "@/components/ui/confirm-modal";

interface SharesSectionProps {
  shares: Share[];
  onSharesChange: (updater: (prev: Share[]) => Share[]) => void;
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50">
        <Link2 className="h-6 w-6 text-muted-foreground/40" />
      </div>
      <h3 className="mt-4 text-[15px] font-semibold tracking-tight text-foreground">
        No active shares
      </h3>
      <p className="mt-1.5 max-w-sm text-[13px] text-muted-foreground">
        Create share links from your documents to see them here.
      </p>
    </div>
  );
}

export function SharesSection({ shares, onSharesChange }: SharesSectionProps) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [editingShare, setEditingShare] = useState<EditableShareItem | null>(null);
  const [revokingShareId, setRevokingShareId] = useState<string | null>(null);

  // Pagination
  const [page, setPage] = useState(0);
  const pageSize = useGridPageSize();
  const totalPages = Math.max(1, Math.ceil(shares.length / pageSize));
  const pagedShares = useMemo(
    () => shares.slice(page * pageSize, (page + 1) * pageSize),
    [shares, page, pageSize]
  );

  // Reset page when shares list changes (e.g. after revocation)
  useEffect(() => {
    setPage(0);
  }, [shares.length]);

  // Clamp page if out of bounds
  useEffect(() => {
    if (page >= totalPages) setPage(Math.max(0, totalPages - 1));
  }, [page, totalPages]);

  // Invite management
  const [expandedShareId, setExpandedShareId] = useState<string | null>(null);
  const [shareInvites, setShareInvites] = useState<Record<string, InviteEntry[]>>({});
  const [invitesLoading, setInvitesLoading] = useState<string | null>(null);

  const fetchInvites = useCallback(async (shareId: string) => {
    setInvitesLoading(shareId);
    try {
      const { invites } = await api.listInvites(shareId);
      setShareInvites((prev) => ({ ...prev, [shareId]: invites }));
    } catch {
      toast.error("Failed to load invited users");
    } finally {
      setInvitesLoading(null);
    }
  }, []);

  function toggleInvitePanel(shareId: string) {
    if (expandedShareId === shareId) {
      setExpandedShareId(null);
    } else {
      setExpandedShareId(shareId);
      if (!shareInvites[shareId]) {
        fetchInvites(shareId);
      }
    }
  }

  async function handleAddInvite(shareId: string, user: SearchUserResult) {
    try {
      await api.inviteUsers(shareId, [user.id]);
      const newEntry: InviteEntry = {
        id: user.id,
        user_id: user.id,
        username: user.username,
        email: user.email,
        avatar_url: user.avatar_url,
        created_at: new Date().toISOString(),
      };
      setShareInvites((prev) => ({
        ...prev,
        [shareId]: [...(prev[shareId] || []), newEntry],
      }));
      toast.success(`${user.username || user.email} invited`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to invite user");
    }
  }

  async function handleRemoveInvite(shareId: string, userId: string) {
    try {
      await api.removeInvite(shareId, userId);
      setShareInvites((prev) => ({
        ...prev,
        [shareId]: (prev[shareId] || []).filter((i) => i.user_id !== userId),
      }));
      toast.success("User removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove user");
    }
  }

  const { visibleItems: visibleShares, sentinelRef, hasMore } = useLazyList(pagedShares);

  if (shares.length === 0) return <EmptyState />;

  const handleAction = async (id: string, action: () => void | Promise<void>) => {
    setActionLoading(id);
    try {
      await action();
    } finally {
      setActionLoading(null);
    }
  };

  const handleRevoke = async (shareId: string) => {
    try {
      await api.revokeShare(shareId);
      onSharesChange((prev) => prev.filter((s) => s.id !== shareId));
      if (expandedShareId === shareId) setExpandedShareId(null);
      toast.success("Share link revoked");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke");
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {visibleShares.map((share) => {
          const isExpanded = expandedShareId === share.id;
          const invites = shareInvites[share.id] || [];
          const isLoadingInvites = invitesLoading === share.id;

          return (
            <div
              key={share.id}
              className="group rounded-xl border border-border/50 bg-card px-4 py-3.5 transition-all hover:border-border"
            >
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-[14px] font-medium text-foreground">
                    {share.title || share.file_name || "Untitled"}
                  </h3>
                  <div className="mt-1 flex items-center gap-2 text-[12px] text-muted-foreground/60">
                    <span className="flex items-center gap-1">
                      {share.visibility === "public" ? (
                        <Globe className="h-3 w-3" />
                      ) : (
                        <Lock className="h-3 w-3" />
                      )}
                      {share.visibility === "public" ? "Public" : "Private"}
                    </span>
                    <span className="text-muted-foreground/30">&middot;</span>
                    <span className="flex items-center gap-1">
                      <Eye className="h-3 w-3" />
                      {share.view_count}
                    </span>
                    <span className="text-muted-foreground/30">&middot;</span>
                    <span>
                      {new Date(share.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 max-sm:opacity-100">
                  {share.visibility === "private" && (
                    <button
                      onClick={() => toggleInvitePanel(share.id)}
                      className={cn(
                        "rounded-lg p-1.5 transition-colors",
                        isExpanded
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                      title="Manage invited users"
                    >
                      <Users className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {share.visibility === "public" && (
                    <button
                      onClick={() =>
                        setEditingShare({
                          shareId: share.id,
                          title: share.title || share.file_name || "Untitled",
                          description: share.description ?? null,
                          tags: share.tags ?? [],
                        })
                      }
                      className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      title="Edit description & tags"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <a
                    href={share.share_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    title="Open share link"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                  <button
                    onClick={() => setRevokingShareId(share.id)}
                    disabled={actionLoading === share.id}
                    className="rounded-lg p-1.5 text-destructive/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
                    title="Revoke share link"
                  >
                    {actionLoading === share.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Invite management panel (private shares) */}
              {share.visibility === "private" && isExpanded && (
                <div className="mt-3 rounded-lg border border-border bg-background/50 p-3">
                  {isLoadingInvites ? (
                    <div className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Loading users...
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {invites.length > 0 && (
                        <div className="space-y-1">
                          {invites.map((invite) => (
                            <div
                              key={invite.user_id}
                              className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/30"
                            >
                              {invite.avatar_url ? (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img
                                  src={invite.avatar_url}
                                  alt=""
                                  className="h-5 w-5 rounded-full"
                                />
                              ) : (
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[9px] font-bold text-muted-foreground">
                                  {(invite.username || invite.email || "?")[0].toUpperCase()}
                                </span>
                              )}
                              <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">
                                {invite.username || invite.email}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleRemoveInvite(share.id, invite.user_id)}
                                className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                                title="Remove access"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {invites.length === 0 && (
                        <p className="py-1 text-[12px] text-muted-foreground">
                          No users invited yet.
                        </p>
                      )}

                      <div>
                        <span className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
                          <UserPlus className="mr-1 inline h-3 w-3" />
                          Add users
                        </span>
                        <UserSearchInput
                          selectedUsers={invites.map((i) => ({
                            id: i.user_id,
                            username: i.username || "",
                            email: i.email || "",
                            avatar_url: i.avatar_url,
                          }))}
                          onAdd={(user) => handleAddInvite(share.id, user)}
                          onRemove={(userId) => handleRemoveInvite(share.id, userId)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {hasMore && <div ref={sentinelRef} className="h-px" />}
      </div>

      <GridPagination page={page} totalPages={totalPages} onPageChange={setPage} />

      {editingShare && (
        <EditShareModal
          open={!!editingShare}
          onClose={() => setEditingShare(null)}
          item={editingShare}
          onSave={(updated) => {
            onSharesChange((prev) =>
              prev.map((s) =>
                s.id === editingShare.shareId
                  ? {
                      ...s,
                      title: updated.title,
                      description: updated.description,
                      tags: updated.tags,
                    }
                  : s
              )
            );
            setEditingShare(null);
          }}
        />
      )}

      <ConfirmModal
        open={!!revokingShareId}
        onClose={() => setRevokingShareId(null)}
        onConfirm={() =>
          revokingShareId && handleAction(revokingShareId, () => handleRevoke(revokingShareId))
        }
        title="Revoke share link?"
        description="This share link will be permanently deactivated. Anyone with the link will no longer be able to access the document."
        confirmLabel="Revoke"
      />
    </>
  );
}
