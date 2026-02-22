"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { formatShortcut } from "@/lib/utils";

const Kbd = ({ children }: { children: React.ReactNode }) => (
  <kbd className="rounded border border-border/50 px-1 py-0.5 font-mono text-[10px]">
    {children}
  </kbd>
);

const WRITING_TIPS: React.ReactNode[] = [
  <>
    Press <Kbd>Tab</Kbd> in the editor for AI autocomplete
  </>,
  <>
    Press <Kbd>{formatShortcut("Ctrl+K")}</Kbd> to open the command palette
  </>,
  <>Select text to see AI quick edit options</>,
  <>
    Press <Kbd>{formatShortcut("Ctrl+F")}</Kbd> to find &amp; replace in your document
  </>,
  <>Drag and drop files into folders to stay organized</>,
  <>
    Use <Kbd>{formatShortcut("Alt+/")}</Kbd> to trigger AI autocomplete anywhere
  </>,
  <>Try &quot;Ask AI&quot; in the search bar to chat about your documents</>,
  <>
    Press <Kbd>{formatShortcut("Ctrl+Shift+O")}</Kbd> to toggle the document outline
  </>,
  <>Star your important documents to pin them in Favorites</>,
  <>Export your writing to Markdown, PDF, or Word from the file menu</>,
];

export function WritingTip() {
  const tip = useMemo(() => WRITING_TIPS[Math.floor(Math.random() * WRITING_TIPS.length)], []);

  return (
    <motion.div
      className="mx-auto mt-14 max-w-md text-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.8, duration: 0.5 }}
    >
      <p className="text-xs text-muted-foreground/45 dark:text-muted-foreground/55">Tip: {tip}</p>
    </motion.div>
  );
}
