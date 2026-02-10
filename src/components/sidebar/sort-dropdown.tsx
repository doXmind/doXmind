"use client";

import { ArrowUpDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { useFileStore, type SortOption } from "@/stores/file-store";

const sortOptions: { value: SortOption; label: string }[] = [
  { value: "name-asc", label: "Name (A-Z)" },
  { value: "name-desc", label: "Name (Z-A)" },
  { value: "modified-newest", label: "Modified (Newest)" },
  { value: "modified-oldest", label: "Modified (Oldest)" },
  { value: "created-newest", label: "Created (Newest)" },
  { value: "created-oldest", label: "Created (Oldest)" },
];

export function SortDropdown() {
  const { sortBy, setSortBy } = useFileStore();

  return (
    <DropdownMenu>
      <Tooltip content="Sort files" side="bottom">
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 md:h-9 md:w-9"
            aria-label="Sort files"
          >
            <ArrowUpDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-56">
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
