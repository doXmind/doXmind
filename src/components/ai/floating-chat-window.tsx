"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChatPanel } from "./chat-panel";
import { useLayoutStore } from "@/stores/layout-store";

export function FloatingChatWindow() {
  const isChatOpen = useLayoutStore((s) => s.isChatOpen);

  return (
    <AnimatePresence>
      {isChatOpen && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 12 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className="absolute bottom-16 right-4 z-40 flex h-[520px] w-[400px] flex-col overflow-hidden rounded-xl border border-border/60 bg-background shadow-2xl"
        >
          <ChatPanel />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
