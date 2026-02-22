"use client";

import { ArrowUpDown, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import type { SortOption } from "@/stores/file-store";

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "name-asc", label: "Name (A-Z)" },
  { value: "name-desc", label: "Name (Z-A)" },
  { value: "modified-newest", label: "Modified (Newest)" },
  { value: "modified-oldest", label: "Modified (Oldest)" },
  { value: "created-newest", label: "Created (Newest)" },
  { value: "created-oldest", label: "Created (Oldest)" },
];

export function HomeSortDropdown({
  sortBy,
  setSortBy,
}: {
  sortBy: SortOption;
  setSortBy: (v: SortOption) => void;
}) {
  return (
    <DropdownMenu>
      <Tooltip content="Sort files" side="bottom">
        <DropdownMenuTrigger asChild>
          <button
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Sort files"
          >
            <ArrowUpDown className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-48">
        {SORT_OPTIONS.slice(0, 2).map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            onClick={() => setSortBy(opt.value)}
            className="flex items-center justify-between"
          >
            <span>{opt.label}</span>
            {sortBy === opt.value && <Check className="h-3.5 w-3.5 text-foreground/50" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {SORT_OPTIONS.slice(2, 4).map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            onClick={() => setSortBy(opt.value)}
            className="flex items-center justify-between"
          >
            <span>{opt.label}</span>
            {sortBy === opt.value && <Check className="h-3.5 w-3.5 text-foreground/50" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {SORT_OPTIONS.slice(4).map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            onClick={() => setSortBy(opt.value)}
            className="flex items-center justify-between"
          >
            <span>{opt.label}</span>
            {sortBy === opt.value && <Check className="h-3.5 w-3.5 text-foreground/50" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
