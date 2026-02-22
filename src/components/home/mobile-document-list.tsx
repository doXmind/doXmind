"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { FileItem } from "@/stores/file-store";
import { MobileDocumentRow } from "./mobile-document-row";

interface MobileDocumentListProps {
  files: FileItem[];
  isSearchActive: boolean;
  searchMatchMap: Map<string, { snippet: string; score: number }>;
  searchQuery: string;
  onResultClick?: (fileId: string, position: number, score: number) => void;
}

export function MobileDocumentList({
  files,
  isSearchActive,
  searchMatchMap,
  searchQuery,
  onResultClick: _onResultClick,
}: MobileDocumentListProps) {
  return (
    <motion.div className="pb-24 sm:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div
        className={cn(
          "overflow-hidden rounded-xl will-change-transform",
          "border border-border/50",
          "bg-card/60"
        )}
      >
        {files.map((file, i) => (
          <motion.div
            key={file.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{
              opacity: 1,
              y: 0,
              transition: {
                duration: 0.35,
                delay: Math.min(i * 0.04, 0.3),
                ease: [0.16, 1, 0.3, 1] as const,
              },
            }}
            className={cn(i > 0 && "border-t border-border/30")}
          >
            <MobileDocumentRow
              file={file}
              searchMatch={
                isSearchActive && searchMatchMap.has(file.id)
                  ? {
                      ...searchMatchMap.get(file.id)!,
                      query: searchQuery,
                    }
                  : undefined
              }
            />
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
