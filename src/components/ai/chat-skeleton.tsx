"use client";

import { motion } from "framer-motion";
import { Skeleton, SkeletonLine, SkeletonCircle } from "@/components/ui/skeleton";

export function ChatSkeleton() {
  return (
    <motion.div
      className="flex flex-col h-full"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Header */}
      <div className="h-12 border-b border-border flex items-center justify-between px-3">
        <Skeleton className="h-5 w-16" />
        <div className="flex gap-1">
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 p-4 space-y-4 overflow-hidden">
        {/* User message */}
        <motion.div
          className="flex justify-end"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <div className="max-w-[80%] space-y-2">
            <Skeleton className="h-16 w-48 rounded-2xl rounded-br-md" />
          </div>
        </motion.div>

        {/* AI message 1 */}
        <motion.div
          className="flex gap-2"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.15 }}
        >
          <SkeletonCircle className="h-8 w-8 flex-shrink-0" />
          <div className="max-w-[80%] space-y-2">
            <Skeleton className="h-24 w-56 rounded-2xl rounded-tl-md" />
          </div>
        </motion.div>

        {/* User message 2 */}
        <motion.div
          className="flex justify-end"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
        >
          <div className="max-w-[80%] space-y-2">
            <Skeleton className="h-12 w-32 rounded-2xl rounded-br-md" />
          </div>
        </motion.div>

        {/* AI message 2 */}
        <motion.div
          className="flex gap-2"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.25 }}
        >
          <SkeletonCircle className="h-8 w-8 flex-shrink-0" />
          <div className="max-w-[80%] space-y-2">
            <Skeleton className="h-20 w-64 rounded-2xl rounded-tl-md" />
          </div>
        </motion.div>
      </div>

      {/* Input area */}
      <div className="p-3 border-t border-border">
        <div className="flex items-end gap-2">
          <Skeleton className="flex-1 h-10 rounded-xl" />
          <Skeleton className="h-10 w-10 rounded-full" />
        </div>
      </div>
    </motion.div>
  );
}
