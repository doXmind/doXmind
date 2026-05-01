"use client";

// i18n keys consumed by this variant (welcome.<key>):
//   continuum.metaPrefix             -> "last save"
//   continuum.metaAllOnDisk          -> "all changes on disk"
//   continuum.youStoppedHere         -> "you stopped here"
//   continuum.session                -> "SESSION"
//   continuum.sessionFraction        -> "{filled} / {total}d"
//   continuum.continueWriting        -> "Continue writing"
//   continuum.showInFolder           -> "Show file in folder"
//   continuum.history                -> "History"
//   continuum.new                    -> "new"
//   continuum.open                   -> "open"
//   continuum.openFolder             -> "open folder"
//   continuum.scannedPdf             -> "scanned pdf"
//   continuum.dragHint               -> "drag a file anywhere"
//   continuum.toContinue             -> "↵ to continue"
//   continuum.editsToday             -> "{count} edits today"
//   continuum.words                  -> "{count} words"
//   continuum.emptyTitle             -> "Pick up where you left off"
//   continuum.emptySubtitle          -> "Open a file or a folder to start a new line."

import { useMemo } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { ArrowRight, FolderOpen, Plus, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatRelativeTime, type WelcomeVariantProps } from "@/components/welcome/types";

const SESSION_DOTS = 14;
const PREVIEW_MAX = 280;

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.05 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 6 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: [0.25, 0.1, 0.25, 1] as const },
  },
};

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  // Trim at the last word boundary inside the budget so the quote doesn't
  // break mid-token.
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  return `${slice.slice(0, lastSpace > max * 0.6 ? lastSpace : max).trimEnd()}…`;
}

function parentDir(absolutePath: string): string {
  const normalized = absolutePath.replaceAll("\\", "/");
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return normalized;
  return normalized.slice(0, idx);
}

export function ContinuumWelcome({
  recentFiles,
  hasWorkspace,
  onOpenFolder,
  onCreateNew,
  onOpenRecentFile,
}: WelcomeVariantProps) {
  const t = useTranslations("welcome");

  const last = recentFiles[0];
  const filledDots = useMemo(
    () => Math.min(recentFiles.length, SESSION_DOTS),
    [recentFiles.length]
  );

  const previewText = last ? truncate(last.preview.trim(), PREVIEW_MAX) : "";
  const lastDir = last ? parentDir(last.absolutePath) : "";
  const lastRelative = last ? formatRelativeTime(last.lastOpened) : "";

  return (
    <div className="relative flex flex-1 flex-col overflow-y-auto bg-background text-foreground">
      <motion.div
        className="flex flex-1 flex-col"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {/* Top meta rail — monospaced, low-noise system facts. */}
        <motion.div
          variants={itemVariants}
          className="flex items-center justify-between px-8 py-4 font-mono text-[10.5px] uppercase tracking-[0.04em] text-muted-foreground"
        >
          <span>
            {new Date().toLocaleString(undefined, {
              weekday: "long",
              month: "short",
              day: "numeric",
            })}
          </span>
          {last ? (
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3 w-3" aria-hidden />
              {t("continuum.metaPrefix")} · {lastRelative} · {t("continuum.metaAllOnDisk")}
            </span>
          ) : null}
        </motion.div>

        {/* Hero — printed-page composition with left rule + serif quote + session rail. */}
        <div className="grid flex-1 items-center gap-0 px-14 [grid-template-columns:88px_minmax(0,1fr)_88px]">
          <motion.div
            variants={itemVariants}
            className="relative flex h-full flex-col items-center justify-start pt-20"
          >
            <span className="absolute bottom-20 left-1/2 top-20 w-px -translate-x-1/2 bg-border" />
            <span
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
              style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
            >
              {t("continuum.youStoppedHere")}
            </span>
          </motion.div>

          <motion.div variants={itemVariants} className="mx-auto w-full max-w-[720px]">
            {last ? (
              <>
                <p className="font-serif text-[30px] font-normal leading-[1.42] tracking-[-0.008em] text-foreground/90 [text-wrap:pretty]">
                  {previewText}
                  <span
                    aria-hidden
                    className="ml-1.5 inline-block h-[28px] w-[10px] -translate-y-[3px] animate-pulse bg-foreground align-middle"
                  />
                </p>

                <div className="mt-9 flex flex-wrap items-baseline gap-4 border-t border-border pt-5 font-mono text-[11px] text-muted-foreground">
                  <span className="font-sans text-[13.5px] font-medium tracking-[-0.005em] text-foreground">
                    {last.name}
                  </span>
                  <span className="truncate text-muted-foreground/70">{lastDir}</span>
                  <span className="text-muted-foreground/60">·</span>
                  <span>{t("continuum.words", { count: last.wordCount.toLocaleString() })}</span>
                  <span className="text-muted-foreground/60">·</span>
                  <span>{t("continuum.editsToday", { count: last.editCount })}</span>
                  <div className="flex-1" />
                  <span className="text-muted-foreground/70">{t("continuum.toContinue")}</span>
                </div>

                <div className="mt-7 flex flex-wrap items-center gap-2.5">
                  <Button onClick={() => onOpenRecentFile(last)} className="h-10 gap-2 px-4">
                    {t("continuum.continueWriting")}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" className="h-10 gap-2 font-mono text-xs lowercase">
                    {t("continuum.history")}
                  </Button>
                  <Button variant="ghost" className="h-10 gap-2 font-mono text-xs lowercase">
                    {t("continuum.showInFolder")}
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-start gap-3">
                <h1 className="font-serif text-[30px] font-normal leading-[1.42] tracking-[-0.008em] text-foreground/90">
                  {t("continuum.emptyTitle")}
                </h1>
                <p className="font-mono text-[12px] text-muted-foreground">
                  {t("continuum.emptySubtitle")}
                </p>
              </div>
            )}
          </motion.div>

          <motion.div
            variants={itemVariants}
            className="flex h-full flex-col items-center justify-center gap-1.5 opacity-60"
          >
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
              {t("continuum.session")}
            </span>
            <div className="mt-1 flex flex-col gap-[3px]">
              {Array.from({ length: SESSION_DOTS }).map((_, i) => (
                <span
                  key={i}
                  className={cn("h-[1.5px] w-4", i < filledDots ? "bg-foreground" : "bg-border")}
                />
              ))}
            </div>
            <span className="mt-1.5 font-mono text-[9px] text-muted-foreground">
              {t("continuum.sessionFraction", { filled: filledDots, total: SESSION_DOTS })}
            </span>
          </motion.div>
        </div>

        {/* Bottom action rail — single-folder model, only New (when a folder
            is mounted) and Open Folder. */}
        <motion.div
          variants={itemVariants}
          className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/40 px-8 py-3"
        >
          <Button
            variant="ghost"
            className="h-8 gap-2 font-mono text-xs lowercase"
            onClick={onCreateNew}
            disabled={!hasWorkspace}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("continuum.new")}
          </Button>
          <Button
            variant="ghost"
            className="h-8 gap-2 font-mono text-xs lowercase"
            onClick={onOpenFolder}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {t("continuum.openFolder")}
          </Button>
          <div className="flex-1" />
          <span className="font-mono text-[10.5px] text-muted-foreground">
            {t("continuum.dragHint")}
          </span>
        </motion.div>
      </motion.div>
    </div>
  );
}
