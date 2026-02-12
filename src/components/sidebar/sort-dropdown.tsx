"use client";

import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useFileStore, type SortOption } from "@/stores/file-store";

const sortOptions: { value: SortOption; label: string; shortLabel: string }[] = [
  { value: "name-asc", label: "Name (A-Z)", shortLabel: "Name" },
  { value: "name-desc", label: "Name (Z-A)", shortLabel: "Name" },
  { value: "modified-newest", label: "Modified (Newest)", shortLabel: "Modified" },
  { value: "modified-oldest", label: "Modified (Oldest)", shortLabel: "Modified" },
  { value: "created-newest", label: "Created (Newest)", shortLabel: "Created" },
  { value: "created-oldest", label: "Created (Oldest)", shortLabel: "Created" },
];

export function SortDropdown() {
  const { sortBy, setSortBy } = useFileStore();
  const currentOption = sortOptions.find((o) => o.value === sortBy);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Sort files"
        >
          <span>{currentOption?.shortLabel ?? "Sort"}</span>
          <ChevronDown className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {sortOptions.slice(0, 2).map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => setSortBy(option.value)}
            className="flex items-center justify-between"
          >
            <span>{option.label}</span>
            {sortBy === option.value && <Check className="h-4 w-4" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {sortOptions.slice(2, 4).map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => setSortBy(option.value)}
            className="flex items-center justify-between"
          >
            <span>{option.label}</span>
            {sortBy === option.value && <Check className="h-4 w-4" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {sortOptions.slice(4).map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => setSortBy(option.value)}
            className="flex items-center justify-between"
          >
            <span>{option.label}</span>
            {sortBy === option.value && <Check className="h-4 w-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
