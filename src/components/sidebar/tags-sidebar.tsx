"use client";

import * as React from "react";
import { Hash } from "lucide-react";
import { useTranslations } from "next-intl";
import { ScrollArea } from "@/components/ui/scroll-area";
import { countTags } from "@/lib/tags";
import { useFileStore } from "@/stores/file-store";
import { useLayoutStore } from "@/stores/layout-store";

export function TagsSidebar() {
  const t = useTranslations("sidebar");
  const tCommon = useTranslations("common");
  const files = useFileStore((s) => s.files);
  const openSidebarSearch = useLayoutStore((s) => s.openSidebarSearch);

  // Sorted by count, then name: the pane is for finding the tag you use, not for reading an
  // alphabet.
  const tags = React.useMemo(() => {
    const counts = countTags(files.filter((file) => !file.isFolder && !file.isAsset));
    return [...counts.entries()].sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0])
    );
  }, [files]);

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex min-h-full flex-col px-1.5 pb-3">
        {tags.length === 0 ? (
          <p className="text-ui-xs px-2 py-6 text-center text-[var(--sidebar-icon)]">
            {tCommon("noResults")}
          </p>
        ) : (
          tags.map(([name, count]) => (
            <button
              key={name}
              type="button"
              aria-label={t("searchTag", { tag: name })}
              onClick={() => openSidebarSearch(`tag:${name}`)}
              className="text-ui-base flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left hover:bg-[var(--sidebar-hover)]"
              // Nesting is shown by indentation rather than a tree: a tag pane is a flat index of
              // everything in use, and `a` and `a/b` are both real tags a reader may want.
              style={{ paddingLeft: `${6 + name.split("/").length * 8}px` }}
            >
              <Hash className="h-3.5 w-3.5 shrink-0 text-[var(--sidebar-icon)]" />
              <span className="min-w-0 flex-1 truncate">{name}</span>
              <span className="text-ui-xs shrink-0 text-[var(--sidebar-icon)]">{count}</span>
            </button>
          ))
        )}
      </div>
    </ScrollArea>
  );
}
