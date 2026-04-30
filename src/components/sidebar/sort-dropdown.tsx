"use client";

import { useTranslations } from "next-intl";
import { Check, ChevronDown, ListFilter } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useFileStore, type SortOption } from "@/stores/file-store";

const sortOptions: { value: SortOption; labelKey: string; shortLabelKey: string }[] = [
  { value: "name-asc", labelKey: "sortNameAsc", shortLabelKey: "sortByName" },
  { value: "name-desc", labelKey: "sortNameDesc", shortLabelKey: "sortByName" },
  { value: "modified-newest", labelKey: "sortModifiedNewest", shortLabelKey: "sortShortModified" },
  { value: "modified-oldest", labelKey: "sortModifiedOldest", shortLabelKey: "sortShortModified" },
  { value: "created-newest", labelKey: "sortCreatedNewest", shortLabelKey: "sortShortCreated" },
  { value: "created-oldest", labelKey: "sortCreatedOldest", shortLabelKey: "sortShortCreated" },
];

interface SortDropdownProps {
  iconOnly?: boolean;
  ariaLabel?: string;
}

export function SortDropdown({ iconOnly = false, ariaLabel }: SortDropdownProps) {
  const t = useTranslations("sidebar");
  const { sortBy, setSortBy } = useFileStore();
  const currentOption = sortOptions.find((o) => o.value === sortBy);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={
            iconOnly
              ? "sidebar-action-button flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
              : "flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          }
          aria-label={ariaLabel ?? t("sortFiles")}
        >
          {iconOnly ? (
            <ListFilter className="h-4 w-4" />
          ) : (
            <>
              <span>{currentOption ? t(currentOption.shortLabelKey) : t("sort")}</span>
              <ChevronDown className="h-3 w-3" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {sortOptions.slice(0, 2).map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => setSortBy(option.value)}
            className="flex items-center justify-between"
          >
            <span>{t(option.labelKey)}</span>
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
            <span>{t(option.labelKey)}</span>
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
            <span>{t(option.labelKey)}</span>
            {sortBy === option.value && <Check className="h-4 w-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
