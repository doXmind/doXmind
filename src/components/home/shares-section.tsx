"use client";

import { useState, useCallback } from "react";
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
  X,
} from "lucide-react";

import { type Share, type InviteEntry, type SearchUserResult, api } from "@/lib/api";
import { UserSearchInput } from "@/components/share/user-search-input";
import { toast } from "sonner";

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
      <div className="space-y-3">
        {shares.map((share) => {
          const isExpanded = expandedShareId === share.id;
          const invites = shareInvites[share.id] || [];
          const isLoadingInvites = invitesLoading === share.id;

          return (
            <div
              key={share.id}
              className={`group rounded-xl border p-4 transition-all ${
                share.visibility === "public"
                  ? "border-emerald-500/30 bg-emerald-500/[0.03] hover:border-emerald-500/50"
                  : "border-amber-500/30 bg-amber-500/[0.03] hover:border-amber-500/50"
              }`}
            >
              <div className="flex items-center gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-[14px] font-medium text-foreground">
                      {share.title || share.file_name || "Untitled"}
                    </h3>
                    <span
                      className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        share.visibility === "public"
                          ? "bg-emerald-500/15 text-emerald-500"
                          : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                      }`}
                    >
                      {share.visibility === "public" ? (
                        <>
                          <Globe className="h-2.5 w-2.5" /> Public
                        </>
                      ) : (
                        <>
                          <Lock className="h-2.5 w-2.5" /> Private
                        </>
                      )}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-[12px] text-muted-foreground/60">
                    <span className="flex items-center gap-1">
                      <Eye className="h-3 w-3" />
                      {share.view_count} views
                    </span>
                    <span>
                      Created{" "}
                      {new Date(share.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                    {share.expires_at && (
                      <span>
                        Expires{" "}
                        {new Date(share.expires_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  {/* Manage invites (private only) */}
                  {share.visibility === "private" && (
                    <button
                      onClick={() => toggleInvitePanel(share.id)}
                      className={`rounded-lg p-2 transition-colors ${
                        isExpanded
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                      title="Manage invited users"
                    >
                      <Users className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <a
                    href={share.share_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    title="Open share link"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                  <button
                    onClick={() => handleAction(share.id, () => handleRevoke(share.id))}
                    disabled={actionLoading === share.id}
                    className="rounded-lg p-2 text-destructive/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
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
      </div>
    </>
  );
}
