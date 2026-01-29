"use client";

import { useState, useEffect } from "react";
import { Copy, Check, Link, Trash2, Clock, Eye } from "lucide-react";
import { Modal, ModalHeader } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { api, type Share, type ShareListResponse } from "@/lib/api";

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  fileId: string;
  fileName: string;
}

export function ShareDialog({
  open,
  onClose,
  fileId,
  fileName,
}: ShareDialogProps) {
  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expiresIn, setExpiresIn] = useState<string>("never");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchShares() {
      try {
        setLoading(true);
        setError(null);
        const response: ShareListResponse = await api.listFileShares(fileId);
        setShares(response.shares);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load shares");
      } finally {
        setLoading(false);
      }
    }

    if (open && fileId) {
      fetchShares();
    }
  }, [open, fileId]);

  async function createShare() {
    try {
      setCreating(true);
      setError(null);
      const expiresInDays = expiresIn === "never" ? null : parseInt(expiresIn);

      const share = await api.createShare({
        file_id: fileId,
        expires_in_days: expiresInDays,
        content_mode: "live",
      });

      setShares([share, ...shares]);

      // Show toast notification (simplified)
      showToast("Share link created successfully");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create share");
    } finally {
      setCreating(false);
    }
  }

  async function revokeShare(shareId: string) {
    try {
      setError(null);
      await api.revokeShare(shareId);
      setShares(shares.filter((s) => s.id !== shareId));

      showToast("Share link revoked successfully");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke share");
    }
  }

  function copyToClipboard(url: string, shareId: string) {
    navigator.clipboard.writeText(url);
    setCopiedId(shareId);
    setTimeout(() => setCopiedId(null), 2000);

    showToast("Link copied to clipboard");
  }

  function showToast(message: string) {
    // Simple toast implementation - could be replaced with a proper toast library
    const toast = document.createElement("div");
    toast.className =
      "fixed bottom-4 right-4 bg-card border border-border text-foreground px-4 py-2 rounded-lg shadow-lg z-50 animate-in fade-in slide-in-from-bottom-5";
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.add("animate-out", "fade-out", "slide-out-to-bottom-5");
      setTimeout(() => document.body.removeChild(toast), 300);
    }, 3000);
  }

  function formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  return (
    <Modal open={open} onClose={onClose} className="max-w-2xl">
      <ModalHeader onClose={onClose}>Share &quot;{fileName}&quot;</ModalHeader>

      <p className="text-sm text-muted-foreground mb-6">
        Create a read-only link to share this document. Anyone with the link can
        view it.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-lg">
          {error}
        </div>
      )}

      <div className="space-y-6">
        {/* Create New Share */}
        <div className="space-y-3 border-b border-border pb-6">
          <label className="text-sm font-medium text-foreground">
            Create new share link
          </label>
          <div className="flex gap-2">
            <select
              value={expiresIn}
              onChange={(e) => setExpiresIn(e.target.value)}
              className="flex-1 h-10 px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={creating}
            >
              <option value="never">Never expires</option>
              <option value="1">1 day</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
            </select>
            <Button onClick={createShare} disabled={creating || loading}>
              <Link className="w-4 h-4 mr-2" />
              {creating ? "Creating..." : "Create Link"}
            </Button>
          </div>
        </div>

        {/* Active Shares */}
        <div className="space-y-3">
          <label className="text-sm font-medium text-foreground">
            Active shares ({shares.length})
          </label>

          {loading ? (
            <div className="py-8 text-center text-muted-foreground">
              Loading shares...
            </div>
          ) : shares.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">
                No active shares. Create one above to get started.
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {shares.map((share) => (
                <div
                  key={share.id}
                  className="flex items-center gap-2 p-3 border border-border rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                  {/* Share URL */}
                  <input
                    value={share.share_url}
                    readOnly
                    className="flex-1 px-3 py-2 text-xs font-mono bg-background border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary cursor-text"
                    onClick={(e) => e.currentTarget.select()}
                  />

                  {/* Copy Button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => copyToClipboard(share.share_url, share.id)}
                    className="h-10 w-10 flex-shrink-0"
                    title="Copy link"
                  >
                    {copiedId === share.id ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>

                  {/* Delete Button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => revokeShare(share.id)}
                    className="h-10 w-10 flex-shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                    title="Revoke link"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>

                  {/* Stats */}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground ml-2 flex-shrink-0">
                    <span className="flex items-center gap-1" title="View count">
                      <Eye className="w-3 h-3" />
                      {share.view_count}
                    </span>
                    {share.expires_at && (
                      <span className="flex items-center gap-1" title="Expires">
                        <Clock className="w-3 h-3" />
                        {formatDate(share.expires_at)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
