"use client";

import { motion } from "framer-motion";
import { AiLogoIcon } from "@/components/ui/ai-logo-icon";
import { haptics } from "@/lib/haptics";
import { useLayoutStore } from "@/stores/layout-store";
import { MOBILE_SPRINGS, Z_INDEX } from "@/lib/constants";

export function MobileFAB() {
  const toggleAgentSheet = useLayoutStore((s) => s.toggleAgentSheet);

  return (
    <div
      className="fixed bottom-[72px] right-5 md:hidden"
      style={{
        zIndex: Z_INDEX.FLOATING_BUTTON,
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <motion.button
        className="flex h-14 w-14 items-center justify-center rounded-full bg-foreground text-background shadow-xl ring-1 ring-foreground/10 active:scale-95"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{
          type: "spring",
          ...MOBILE_SPRINGS.BOUNCY,
          delay: 0.6,
        }}
        whileTap={{ scale: 0.9 }}
        onClick={() => {
          haptics.light();
          toggleAgentSheet();
        }}
        aria-label="Open AI Agent"
      >
        <AiLogoIcon size={28} />
      </motion.button>
    </div>
  );
}
