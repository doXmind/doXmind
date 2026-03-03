"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { formatShortcut } from "@/lib/utils";

const TIPS: { key: string; params?: Record<string, string> }[] = [
  { key: "tipTabAutocomplete" },
  { key: "tipCommandPalette", params: { shortcut: formatShortcut("Ctrl+K") } },
  { key: "tipQuickEdit" },
  { key: "tipFindReplace", params: { shortcut: formatShortcut("Ctrl+F") } },
  { key: "tipDragDrop" },
  { key: "tipAltAutocomplete", params: { shortcut: formatShortcut("Alt+/") } },
  { key: "tipAskAI" },
  { key: "tipOutline", params: { shortcut: formatShortcut("Ctrl+Shift+O") } },
  { key: "tipStar" },
  { key: "tipExport" },
];

export function WritingTip() {
  const t = useTranslations("home");

  const tip = useMemo(() => TIPS[Math.floor(Math.random() * TIPS.length)], []);

  return (
    <motion.div
      className="mx-auto mt-14 max-w-md text-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.8, duration: 0.5 }}
    >
      <p className="text-xs text-muted-foreground/45 dark:text-muted-foreground/55">
        {t("tip")} {t(tip.key as Parameters<typeof t>[0], tip.params)}
      </p>
    </motion.div>
  );
}
