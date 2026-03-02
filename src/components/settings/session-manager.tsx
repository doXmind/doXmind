"use client";

/**
 * Session Manager Component
 *
 * Displays all active sessions (devices) for the current user.
 * Allows users to revoke sessions from other devices (dual-token authentication).
 */

import { useState, useEffect } from "react";
import { Monitor, Smartphone, Tablet, Trash2, Loader2, MapPin, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { Session } from "@/lib/api/types";
import { formatDistanceToNow } from "date-fns";
import { GridPagination } from "@/components/home/grid-pagination";

function getDeviceIcon(deviceName: string) {
  const name = deviceName.toLowerCase();
  if (name.includes("mobile") || name.includes("android") || name.includes("iphone")) {
    return Smartphone;
  }
  if (name.includes("tablet") || name.includes("ipad")) {
    return Tablet;
  }
  return Monitor;
}

export function SessionManager() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Pagination state
  const [page, setPage] = useState(0);
  const ITEMS_PER_PAGE = 5;

  const loadSessions = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.listSessions();
      setSessions(data);
    } catch (err) {
      console.error("[SessionManager] Failed to load sessions:", err);
      setError(err instanceof Error ? err.message : "Failed to load sessions");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  const handleRevokeSession = async (sessionId: string, deviceName: string) => {
    if (!window.confirm(`Revoke session from ${deviceName}?\n\nThis device will be logged out.`)) {
      return;
    }

    setRevokingId(sessionId);
    setError(null);

    try {
      await api.revokeSession(sessionId);
      // Remove from local state
      setSessions(sessions.filter((s) => s.id !== sessionId));
    } catch (err) {
      console.error("[SessionManager] Failed to revoke session:", err);
      setError(err instanceof Error ? err.message : "Failed to revoke session");
    } finally {
      setRevokingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-medium">Active Sessions</h3>
          <p className="text-sm text-muted-foreground">
            Manage devices that have access to your account
          </p>
        </div>
        <Button onClick={loadSessions} variant="outline" size="sm">
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}

      {sessions.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <Monitor className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">No active sessions found</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {sessions.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE).map((session) => {
              const DeviceIcon = getDeviceIcon(session.device_name);
              const lastUsed = formatDistanceToNow(new Date(session.last_used_at), {
                addSuffix: true,
              });
              const createdAt = formatDistanceToNow(new Date(session.created_at), {
                addSuffix: true,
              });

              return (
                <div
                  key={session.id}
                  className={`rounded-lg border p-4 transition-colors ${
                    session.is_current
                      ? "border-primary/50 bg-primary/5"
                      : "border-border hover:bg-accent/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <div className="mt-1 flex-shrink-0">
                        <DeviceIcon
                          className={`h-5 w-5 ${
                            session.is_current ? "text-primary" : "text-muted-foreground"
                          }`}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="truncate text-sm font-medium">{session.device_name}</h4>
                          {session.is_current && (
                            <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                              Current
                            </span>
                          )}
                        </div>
                        <div className="mt-1 space-y-0.5">
                          {session.ip_address && (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <MapPin className="h-3 w-3" />
                              <span>{session.ip_address}</span>
                            </div>
                          )}
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            <span>Last active {lastUsed}</span>
                          </div>
                          <div className="text-xs text-muted-foreground">Created {createdAt}</div>
                        </div>
                      </div>
                    </div>

                    {!session.is_current && (
                      <Button
                        onClick={() => handleRevokeSession(session.id, session.device_name)}
                        disabled={revokingId === session.id}
                        variant="ghost"
                        size="sm"
                        className="flex-shrink-0"
                      >
                        {revokingId === session.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Trash2 className="mr-1 h-4 w-4" />
                            Revoke
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination controls */}
          {Math.ceil(sessions.length / ITEMS_PER_PAGE) > 1 && (
            <GridPagination
              page={page}
              totalPages={Math.ceil(sessions.length / ITEMS_PER_PAGE)}
              onPageChange={setPage}
            />
          )}
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Sessions expire after 30 days of inactivity. Revoking a session will log out that device
        immediately.
      </p>
    </div>
  );
}
