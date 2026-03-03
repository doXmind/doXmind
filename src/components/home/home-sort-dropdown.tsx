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
import { useTranslations } from "next-intl";

type SortLabelKey =
  | "sortNameAsc"
  | "sortNameDesc"
  | "sortModifiedNewest"
  | "sortModifiedOldest"
  | "sortCreatedNewest"
  | "sortCreatedOldest";

const SORT_OPTIONS: { value: SortOption; labelKey: SortLabelKey }[] = [
  { value: "name-asc", labelKey: "sortNameAsc" },
  { value: "name-desc", labelKey: "sortNameDesc" },
  { value: "modified-newest", labelKey: "sortModifiedNewest" },
  { value: "modified-oldest", labelKey: "sortModifiedOldest" },
  { value: "created-newest", labelKey: "sortCreatedNewest" },
  { value: "created-oldest", labelKey: "sortCreatedOldest" },
];

export function HomeSortDropdown({
  sortBy,
  setSortBy,
}: {
  sortBy: SortOption;
  setSortBy: (v: SortOption) => void;
}) {
  const t = useTranslations("home");
  return (
    <DropdownMenu>
      <Tooltip content={t("sortFiles")} side="bottom">
        <DropdownMenuTrigger asChild>
          <button
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
            aria-label={t("sortFiles")}
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
            <span>{t(opt.labelKey)}</span>
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
            <span>{t(opt.labelKey)}</span>
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
            <span>{t(opt.labelKey)}</span>
            {sortBy === opt.value && <Check className="h-3.5 w-3.5 text-foreground/50" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
