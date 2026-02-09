"use client";

import { motion } from "framer-motion";
import { Skeleton, SkeletonLine } from "@/components/ui/skeleton";

export function SidebarSkeleton() {
  return (
    <motion.div
      className="flex h-full flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Header */}
      <div className="border-b border-border p-3">
        <div className="mb-3 flex items-center justify-between">
          <Skeleton className="hidden h-4 w-12 md:block" />
          <div className="flex w-full items-center justify-end gap-1 md:w-auto">
            <Skeleton className="h-9 w-9 rounded-md" />
            <Skeleton className="h-9 w-9 rounded-md" />
          </div>
        </div>

        {/* Search box */}
        <Skeleton className="h-9 w-full rounded-md" />
      </div>

      {/* File list */}
      <div className="flex-1 space-y-1 p-2">
        {[...Array(6)].map((_, i) => (
          <motion.div
            key={i}
            className="flex items-center gap-2 rounded-md px-2 py-2"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: i * 0.05 }}
          >
            <Skeleton className="h-4 w-4 flex-shrink-0 rounded" />
            <SkeletonLine
              className={`h-4 ${i % 3 === 0 ? "w-3/4" : i % 3 === 1 ? "w-2/3" : "w-4/5"}`}
            />
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
