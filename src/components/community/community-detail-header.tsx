"use client";

import Link from "next/link";
import Image from "next/image";
import { CommunityDetailResponse } from "@/lib/api";
import { Eye, Calendar } from "lucide-react";

interface CommunityDetailHeaderProps {
  detail: CommunityDetailResponse;
}

export function CommunityDetailHeader({ detail }: CommunityDetailHeaderProps) {
  const publishedDate = detail.published_at
    ? new Date(detail.published_at).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{detail.title}</h1>

      {detail.description && <p className="mt-2 text-muted-foreground">{detail.description}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
        {/* Author */}
        <Link
          href={`/profile/${detail.owner.id}`}
          className="flex items-center gap-2 transition-colors hover:text-foreground"
        >
          {detail.owner.avatar_url ? (
            <Image
              src={detail.owner.avatar_url}
              alt=""
              width={24}
              height={24}
              className="h-6 w-6 rounded-full"
              unoptimized
            />
          ) : (
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-medium">
              {(detail.owner.username || "?")[0].toUpperCase()}
            </div>
          )}
          <span>{detail.owner.username || "Anonymous"}</span>
        </Link>

        <span className="flex items-center gap-1">
          <Calendar className="h-3.5 w-3.5" />
          {publishedDate}
        </span>

        <span className="flex items-center gap-1">
          <Eye className="h-3.5 w-3.5" />
          {detail.view_count} views
        </span>
      </div>

      {/* Tags */}
      {detail.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {detail.tags.map((tag) => (
            <Link
              key={tag}
              href={`/community?tag=${encodeURIComponent(tag)}`}
              className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80"
            >
              {tag}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
