"use client";

import { motion } from "framer-motion";
import { Skeleton, SkeletonLine } from "@/components/ui/skeleton";

export function SidebarSkeleton() {
  return (
    <motion.div
      className="flex flex-col h-full"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Header */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <Skeleton className="h-4 w-12 hidden md:block" />
          <div className="flex items-center gap-1 w-full md:w-auto justify-end">
            <Skeleton className="h-9 w-9 rounded-md" />
            <Skeleton className="h-9 w-9 rounded-md" />
          </div>
        </div>

        {/* Search box */}
        <Skeleton className="h-9 w-full rounded-md" />
      </div>

      {/* File list */}
      <div className="flex-1 p-2 space-y-1">
        {[...Array(6)].map((_, i) => (
          <motion.div
            key={i}
            className="flex items-center gap-2 px-2 py-2 rounded-md"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: i * 0.05 }}
          >
            <Skeleton className="h-4 w-4 rounded flex-shrink-0" />
            <SkeletonLine className={`h-4 ${i % 3 === 0 ? "w-3/4" : i % 3 === 1 ? "w-2/3" : "w-4/5"}`} />
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
