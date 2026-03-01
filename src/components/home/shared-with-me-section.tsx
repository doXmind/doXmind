"use client";

import { Users, ExternalLink, FolderOpen, FileText } from "lucide-react";
import { type SharedWithMeItem } from "@/lib/api";

interface SharedWithMeSectionProps {
  items: SharedWithMeItem[];
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50">
        <Users className="h-6 w-6 text-muted-foreground/40" />
      </div>
      <h3 className="mt-4 text-[15px] font-semibold tracking-tight text-foreground">
        Nothing shared with you yet
      </h3>
      <p className="mt-1.5 max-w-sm text-[13px] text-muted-foreground">
        When someone invites you to view their documents, they will appear here.
      </p>
    </div>
  );
}

export function SharedWithMeSection({ items }: SharedWithMeSectionProps) {
  if (items.length === 0) return <EmptyState />;

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <a
          key={item.share_id}
          href={item.share_url}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-center gap-4 rounded-xl border border-border/50 bg-card p-4 transition-all hover:border-border hover:bg-accent/30"
        >
          {/* Owner avatar */}
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
            {item.owner.avatar_url ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={item.owner.avatar_url}
                alt=""
                className="h-9 w-9 rounded-full object-cover"
              />
            ) : (
              <span className="text-[12px] font-bold text-muted-foreground">
                {(item.owner.username || "?")[0].toUpperCase()}
              </span>
            )}
          </div>

          {/* Content */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {item.is_folder ? (
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
              ) : (
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
              )}
              <h3 className="truncate text-[14px] font-medium text-foreground">
                {item.title || "Untitled"}
              </h3>
            </div>
            <div className="mt-1 flex items-center gap-3 text-[12px] text-muted-foreground/60">
              <span>
                From{" "}
                <span className="text-muted-foreground">{item.owner.username || "Unknown"}</span>
              </span>
              <span>
                Shared{" "}
                {new Date(item.invited_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
            </div>
          </div>

          {/* Open action */}
          <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
            <span className="rounded-lg p-2 text-muted-foreground transition-colors group-hover:bg-muted group-hover:text-foreground">
              <ExternalLink className="h-3.5 w-3.5" />
            </span>
          </div>
        </a>
      ))}
    </div>
  );
}
