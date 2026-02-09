"use client";

import { motion } from "framer-motion";
import { Skeleton, SkeletonLine } from "@/components/ui/skeleton";

export function EditorSkeleton() {
  return (
    <motion.div
      className="flex h-full flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Toolbar skeleton */}
      <div className="flex h-12 items-center gap-1 border-b border-border px-2">
        {[...Array(8)].map((_, i) => (
          <Skeleton key={i} className="h-8 w-8 rounded-md" />
        ))}
        <div className="flex-1" />
        <Skeleton className="h-8 w-8 rounded-md" />
        <Skeleton className="h-8 w-8 rounded-md" />
      </div>

      {/* Editor content skeleton */}
      <div className="flex-1 overflow-hidden">
        <div className="mx-auto max-w-4xl space-y-6 px-4 py-4 md:px-8 md:py-6">
          {/* Title */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
          >
            <Skeleton className="mb-6 h-10 w-2/3" />
          </motion.div>

          {/* Paragraph 1 */}
          <motion.div
            className="space-y-2"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.15 }}
          >
            <SkeletonLine className="w-full" />
            <SkeletonLine className="w-11/12" />
            <SkeletonLine className="w-4/5" />
          </motion.div>

          {/* Paragraph 2 */}
          <motion.div
            className="space-y-2"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.2 }}
          >
            <SkeletonLine className="w-full" />
            <SkeletonLine className="w-10/12" />
            <SkeletonLine className="w-3/4" />
            <SkeletonLine className="w-5/6" />
          </motion.div>

          {/* Subheading */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.25 }}
          >
            <Skeleton className="mt-4 h-7 w-1/3" />
          </motion.div>

          {/* Paragraph 3 */}
          <motion.div
            className="space-y-2"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.3 }}
          >
            <SkeletonLine className="w-full" />
            <SkeletonLine className="w-9/12" />
            <SkeletonLine className="w-11/12" />
          </motion.div>

          {/* List items */}
          <motion.div
            className="space-y-2 pl-6"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.35 }}
          >
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <Skeleton className="h-2 w-2 flex-shrink-0 rounded-full" />
                <SkeletonLine className={i === 0 ? "w-2/3" : i === 1 ? "w-3/4" : "w-1/2"} />
              </div>
            ))}
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}
