"use client";

import { motion } from "framer-motion";
import { Logo } from "@/components/ui/logo";

/**
 * Shown when a folder is mounted but no file is selected. Mirrors the
 * Antigravity / VSCode "no editor open" surface — just the brand mark, no
 * Open Folder / Open File buttons (those don't make sense once you're
 * already inside a workspace; recents live in the dock menu and the file
 * tree on the left).
 */
export function EmptyEditor() {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
        className="flex flex-col items-center gap-4 text-muted-foreground/60"
      >
        <Logo variant="stacked" size="lg" animated={false} />
      </motion.div>
    </div>
  );
}
