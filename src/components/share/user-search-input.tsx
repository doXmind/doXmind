"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import { X, Search, Loader2 } from "lucide-react";
import { api, type SearchUserResult } from "@/lib/api";

interface UserSearchInputProps {
  selectedUsers: SearchUserResult[];
  onAdd: (user: SearchUserResult) => void;
  onRemove: (userId: string) => void;
}

export function UserSearchInput({ selectedUsers, onAdd, onRemove }: UserSearchInputProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchUserResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([]);
        setShowDropdown(false);
        return;
      }

      const currentSelectedIds = new Set(selectedUsers.map((u) => u.id));
      setLoading(true);
      try {
        const { users } = await api.searchUsersForInvite(q.trim());
        setResults(users.filter((u) => !currentSelectedIds.has(u.id)));
        setShowDropdown(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [selectedUsers]
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, search]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleSelect(user: SearchUserResult) {
    onAdd(user);
    setQuery("");
    setResults([]);
    setShowDropdown(false);
    inputRef.current?.focus();
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Selected users as chips */}
      {selectedUsers.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selectedUsers.map((user) => (
            <span
              key={user.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 py-1 pl-1.5 pr-2 text-[12px]"
            >
              {user.avatar_url ? (
                <Image
                  src={user.avatar_url}
                  alt=""
                  width={16}
                  height={16}
                  className="h-4 w-4 rounded-full"
                  unoptimized
                />
              ) : (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-muted text-[8px] font-bold">
                  {(user.username || user.email)[0].toUpperCase()}
                </span>
              )}
              <span className="text-foreground">{user.username || user.email}</span>
              <button
                type="button"
                onClick={() => onRemove(user.id)}
                className="ml-0.5 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.trim() && results.length > 0 && setShowDropdown(true)}
          placeholder="Search by username or email..."
          className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-9 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground/50" />
        )}
      </div>

      {/* Dropdown results */}
      {showDropdown && (
        <div className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-border bg-popover shadow-lg">
          {results.length === 0 && !loading ? (
            <div className="px-3 py-4 text-center text-sm text-muted-foreground">
              {query.trim() ? "No users found" : "Start typing to search"}
            </div>
          ) : (
            results.map((user) => (
              <button
                key={user.id}
                type="button"
                onClick={() => handleSelect(user)}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/50"
              >
                {user.avatar_url ? (
                  <Image
                    src={user.avatar_url}
                    alt=""
                    width={28}
                    height={28}
                    className="h-7 w-7 rounded-full"
                    unoptimized
                  />
                ) : (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                    {(user.username || user.email)[0].toUpperCase()}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  {user.username && (
                    <p className="truncate text-sm font-medium text-foreground">{user.username}</p>
                  )}
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
