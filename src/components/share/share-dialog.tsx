"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  Copy,
  Check,
  Trash2,
  Clock,
  Eye,
  Globe,
  Lock,
  Loader2,
  Users,
  ChevronDown,
  X,
  Plus,
  GitFork,
} from "lucide-react";
import { toast } from "sonner";
import { Modal, ModalHeader } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { UserSearchInput } from "@/components/share/user-search-input";
import {
  api,
  type Share,
  type ShareListResponse,
  type SearchUserResult,
  type InviteEntry,
} from "@/lib/api";

const EXPIRATION_OPTIONS = [
  { value: "never", labelKey: "neverExpires" },
  { value: "1", labelKey: "oneDay" },
  { value: "7", labelKey: "sevenDays" },
  { value: "30", labelKey: "thirtyDays" },
  { value: "90", labelKey: "ninetyDays" },
] as const;

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  fileId: string;
  fileName: string;
  isFolder?: boolean;
}

export function ShareDialog({ open, onClose, fileId, fileName, isFolder }: ShareDialogProps) {
  const t = useTranslations("share");
  const tc = useTranslations("common");

  // Existing shares list
  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // New share form (collapsible)
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [expiresIn, setExpiresIn] = useState<string>("never");
  // Public fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  // Fork permission
  const [allowFork, setAllowFork] = useState(true);
  // Private fields
  const [invitedUsers, setInvitedUsers] = useState<SearchUserResult[]>([]);

  // Invite management for existing private shares
  const [expandedShareId, setExpandedShareId] = useState<string | null>(null);
  const [shareInvites, setShareInvites] = useState<Record<string, InviteEntry[]>>({});
  const [invitesLoading, setInvitesLoading] = useState<string | null>(null);

  const hasPublicShare = shares.some((s) => s.visibility === "public");

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setTitle(fileName.replace(/\.md$/, ""));
      setDescription("");
      setTags("");
      setInvitedUsers([]);
      setAllowFork(true);
      setError(null);
      setExpandedShareId(null);
      setShareInvites({});
      setShowCreateForm(false);
    }
  }, [open, fileName]);

  // Fetch existing shares
  useEffect(() => {
    async function fetchShares() {
      try {
        setLoading(true);
        setError(null);
        const response: ShareListResponse = await api.listFileShares(fileId);
        setShares(response.shares);
        // Auto-show creation form when no shares exist
        if (response.shares.length === 0) {
          setShowCreateForm(true);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : t("loadSharesFailed");
        setError(message);
      } finally {
        setLoading(false);
      }
    }

    if (open && fileId) {
      fetchShares();
    }
  }, [open, fileId, t]);

  // Smart default: switch to private when public share already exists
  useEffect(() => {
    if (hasPublicShare && showCreateForm) {
      setVisibility("private");
    }
  }, [hasPublicShare, showCreateForm]);

  // Fetch invites for a specific share
  const fetchInvites = useCallback(
    async (shareId: string) => {
      setInvitesLoading(shareId);
      try {
        const { invites } = await api.listInvites(shareId);
        setShareInvites((prev) => ({ ...prev, [shareId]: invites }));
      } catch {
        toast.error(t("loadInvitedFailed"));
      } finally {
        setInvitesLoading(null);
      }
    },
    [t]
  );

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
      toast.success(t("userInvited", { name: user.username || user.email }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("failedToInvite"));
    }
  }

  async function handleRemoveInvite(shareId: string, userId: string) {
    try {
      await api.removeInvite(shareId, userId);
      setShareInvites((prev) => ({
        ...prev,
        [shareId]: (prev[shareId] || []).filter((i) => i.user_id !== userId),
      }));
      toast.success(t("userRemoved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("failedToRemoveUser"));
    }
  }

  async function handleCreate() {
    try {
      setCreating(true);
      setError(null);
      const expiresInDays =
        visibility === "public" || expiresIn === "never" ? null : parseInt(expiresIn);

      const tagList = tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);

      const share = await api.createShare({
        file_id: fileId,
        expires_in_days: expiresInDays,
        content_mode: "live",
        visibility,
        allow_fork: allowFork,
        ...(visibility === "public"
          ? {
              title: title || undefined,
              description: description || undefined,
              tags: tagList.length > 0 ? tagList : undefined,
            }
          : {
              invited_user_ids: invitedUsers.map((u) => u.id),
            }),
      });

      setShares([share, ...shares]);
      setShowCreateForm(false);

      try {
        await navigator.clipboard.writeText(share.share_url);
        setCopiedId(share.id);
        setTimeout(() => setCopiedId(null), 2000);
      } catch {
        /* clipboard may not be available */
      }

      toast.success(visibility === "public" ? t("publishedToCommunity") : t("privateShareCreated"));

      // Reset form
      setInvitedUsers([]);
      setAllowFork(true);
      setTitle(fileName.replace(/\.md$/, ""));
      setDescription("");
      setTags("");
    } catch (err) {
      const message = err instanceof Error ? err.message : t("failedToCreateShare");
      setError(message);
      toast.error(message);
    } finally {
      setCreating(false);
    }
  }

  async function revokeShare(shareId: string) {
    try {
      setError(null);
      await api.revokeShare(shareId);
      setShares(shares.filter((s) => s.id !== shareId));
      if (expandedShareId === shareId) setExpandedShareId(null);
      toast.success(t("shareRevoked"));
    } catch (err) {
      const message = err instanceof Error ? err.message : t("failedToRevokeShare");
      toast.error(message);
    }
  }

  function copyToClipboard(url: string, shareId: string) {
    navigator.clipboard.writeText(url);
    setCopiedId(shareId);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success(t("linkCopiedToClipboard"));
  }

  function formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  return (
    <Modal open={open} onClose={onClose} className="max-w-2xl">
      <ModalHeader onClose={onClose}>{t("shareFileName", { name: fileName })}</ModalHeader>

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-5">
        {/* ── SECTION 1: Existing Shares (top, prominent) ── */}
        {loading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
            {t("loadingShares")}
          </div>
        ) : shares.length > 0 ? (
          <div className="space-y-3">
            {shares.map((share) => {
              const isExpanded = expandedShareId === share.id;
              const invites = shareInvites[share.id] || [];
              const isLoadingInvites = invitesLoading === share.id;

              return (
                <div
                  key={share.id}
                  className={`rounded-lg border p-3 ${
                    share.visibility === "public"
                      ? "border-primary/20 bg-primary/[0.03]"
                      : "border-amber-500/20 bg-amber-500/[0.03]"
                  }`}
                >
                  {/* Row 1: Badge + meta + revoke */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          share.visibility === "public"
                            ? "bg-primary/10 text-primary"
                            : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        }`}
                      >
                        {share.visibility === "public" ? (
                          <>
                            <Globe className="h-2.5 w-2.5" /> {t("public")}
                          </>
                        ) : (
                          <>
                            <Lock className="h-2.5 w-2.5" /> {t("private")}
                          </>
                        )}
                      </span>
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Eye className="h-3 w-3" />
                        {t("views", { count: share.view_count })}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {formatDate(share.created_at)}
                      </span>
                      {share.expires_at && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {t("expiresOn", { date: formatDate(share.expires_at) })}
                        </span>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => revokeShare(share.id)}
                      className="h-7 w-7 text-destructive/60 hover:bg-destructive/10 hover:text-destructive"
                      title={t("revokeShare")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {/* Row 2: URL + copy */}
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      value={share.share_url}
                      readOnly
                      className="min-w-0 flex-1 cursor-text rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-primary"
                      onClick={(e) => e.currentTarget.select()}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard(share.share_url, share.id)}
                      className="h-8 gap-1.5 px-3 text-[12px]"
                    >
                      {copiedId === share.id ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-green-500" /> {t("copied")}
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" /> {t("copyLink")}
                        </>
                      )}
                    </Button>
                  </div>

                  {/* Row 3: Invite management (private only) */}
                  {share.visibility === "private" && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => toggleInvitePanel(share.id)}
                        className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                      >
                        <Users className="h-3.5 w-3.5" />
                        {invites.length > 0
                          ? t("invitedCount", { count: invites.length })
                          : t("manageUsers")}
                        <ChevronDown
                          className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                        />
                      </button>

                      {isExpanded && (
                        <div className="mt-2 rounded-md border border-border bg-background/50 p-3">
                          {isLoadingInvites ? (
                            <div className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              {t("loadingUsers")}
                            </div>
                          ) : (
                            <div className="space-y-2">
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
                              {invites.length === 0 && (
                                <p className="py-1 text-[12px] text-muted-foreground">
                                  {t("noUsersInvited")}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : !loading ? (
          <p className="py-2 text-center text-[13px] text-muted-foreground">
            {t("noActiveShares")}
          </p>
        ) : null}

        {/* ── SECTION 2: Create New Share (collapsible) ── */}
        {shares.length > 0 && <div className="border-t border-border" />}

        {!showCreateForm ? (
          <button
            type="button"
            onClick={() => setShowCreateForm(true)}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border py-3 text-[13px] text-muted-foreground transition-colors hover:border-foreground/20 hover:bg-accent/30 hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
            {t("newShare")}
          </button>
        ) : (
          <div className="space-y-4">
            {/* Header with collapse button */}
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium text-foreground">{t("newShare")}</span>
              {shares.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                  title={tc("cancel")}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Visibility Toggle */}
            <div className="flex rounded-lg border border-border p-1">
              <button
                type="button"
                onClick={() => !hasPublicShare && setVisibility("public")}
                disabled={hasPublicShare}
                className={`flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all ${
                  visibility === "public"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : hasPublicShare
                      ? "cursor-not-allowed text-muted-foreground/40"
                      : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Globe className="h-4 w-4" />
                {t("public")}
                {hasPublicShare && (
                  <span className="text-[10px] font-normal opacity-60">{t("publicExists")}</span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setVisibility("private")}
                className={`flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all ${
                  visibility === "private"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Lock className="h-4 w-4" />
                {t("private")}
              </button>
            </div>

            {/* Description text */}
            <p className="text-[12px] text-muted-foreground">
              {visibility === "public"
                ? t("anyoneCanDiscover", { type: isFolder ? t("folder") : t("document") })
                : t("onlyInvitedUsers", { type: isFolder ? t("folder") : t("document") })}
            </p>

            {/* Public mode fields */}
            {visibility === "public" && (
              <div className="space-y-3">
                <div>
                  <label className="mb-1.5 block text-[13px] font-medium text-foreground">
                    {t("title")}
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t("titlePlaceholder")}
                    className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[13px] font-medium text-foreground">
                    {t("description")}{" "}
                    <span className="font-normal text-muted-foreground">
                      {t("descriptionOptional")}
                    </span>
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t("descriptionPlaceholder")}
                    rows={2}
                    maxLength={500}
                    className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[13px] font-medium text-foreground">
                    {t("tags")}{" "}
                    <span className="font-normal text-muted-foreground">
                      {t("tagsCommaSeparated")}
                    </span>
                  </label>
                  <input
                    type="text"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder={t("tagsPlaceholder")}
                    className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>
            )}

            {/* Private mode fields */}
            {visibility === "private" && (
              <div className="space-y-3">
                <label className="block text-[13px] font-medium text-foreground">
                  {t("inviteUsers")}
                </label>
                <UserSearchInput
                  selectedUsers={invitedUsers}
                  onAdd={(user) => setInvitedUsers((prev) => [...prev, user])}
                  onRemove={(id) => setInvitedUsers((prev) => prev.filter((u) => u.id !== id))}
                />
              </div>
            )}

            {/* Expiration — only for private shares */}
            {visibility === "private" && (
              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-foreground">
                  {t("expiration")}
                </label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={creating}
                      className="flex h-9 w-full items-center justify-between rounded-lg border border-border bg-background px-3 text-sm text-foreground transition-colors hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                    >
                      <span>
                        {EXPIRATION_OPTIONS.find((o) => o.value === expiresIn)?.labelKey &&
                          t(EXPIRATION_OPTIONS.find((o) => o.value === expiresIn)!.labelKey)}
                      </span>
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-[200px]">
                    {EXPIRATION_OPTIONS.map((option) => (
                      <DropdownMenuItem
                        key={option.value}
                        onClick={() => setExpiresIn(option.value)}
                        className={expiresIn === option.value ? "bg-accent/50 font-medium" : ""}
                      >
                        {t(option.labelKey)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}

            {/* Fork Permission */}
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <div className="flex items-center gap-2">
                <GitFork className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-[13px] font-medium text-foreground">{t("allowFork")}</p>
                  <p className="text-[11px] text-muted-foreground">{t("allowForkDescription")}</p>
                </div>
              </div>
              <Switch checked={allowFork} onCheckedChange={setAllowFork} />
            </div>

            {/* Create Button */}
            <Button
              onClick={handleCreate}
              disabled={
                creating ||
                loading ||
                (visibility === "public" && hasPublicShare) ||
                (visibility === "private" && invitedUsers.length === 0)
              }
              className="w-full"
            >
              {creating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : visibility === "public" ? (
                <Globe className="mr-2 h-4 w-4" />
              ) : (
                <Lock className="mr-2 h-4 w-4" />
              )}
              {creating
                ? t("creating")
                : visibility === "public"
                  ? t("publishToCommunity")
                  : t("sharePrivately")}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
