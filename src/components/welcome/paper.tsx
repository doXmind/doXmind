"use client";

// i18n keys consumed by this variant (welcome.<key>):
//   paper.deskLabel              -> "desk"
//   paper.localTag               -> "local"
//   paper.sheetCount             -> "{count} sheets"
//   paper.kbdNew                 -> "⌘N new"
//   paper.kbdOpen                -> "⌘O open"
//   paper.kbdImport              -> "⌘⇧I import"
//   paper.kbdJump                -> "⌘K jump"
//   paper.lastOpened             -> "last opened · {when}"
//   paper.stats                  -> "{words} words · {edits} edits"
//   paper.resume                 -> "resume"
//   paper.preview                -> "preview"
//   paper.showInFolder           -> "show in folder"
//   paper.toOpen                 -> "↵ to open"
//   paper.emptyTitle             -> "Your desk is empty"
//   paper.emptySubtitle          -> "Open a file or a folder to lay down your first sheet."
//   paper.openFile               -> "open file"
//   paper.openFolder             -> "open folder"
//   paper.untitled               -> "Untitled"
//   paper.emptyDocument          -> "(empty document)"

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { ArrowRight, FolderOpen, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatRelativeTime, type WelcomeVariantProps } from "@/components/welcome/types";

const PREVIEW_BODY_MAX = 360;
const ROLODEX_PREVIEW_MAX = 90;

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.05 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: [0.25, 0.1, 0.25, 1] as const },
  },
};

const sheetVariants = {
  hidden: { opacity: 0, y: 18, scale: 0.985 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.45, ease: [0.25, 0.1, 0.25, 1] as const },
  },
};

function parentDir(absolutePath: string): string {
  const normalized = absolutePath.replaceAll("\\", "/");
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return normalized;
  return normalized.slice(0, idx);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  return `${slice.slice(0, lastSpace > max * 0.6 ? lastSpace : max).trimEnd()}…`;
}

function splitDropCap(body: string): { initial: string; rest: string } {
  const trimmed = body.trimStart();
  if (!trimmed) return { initial: "", rest: "" };
  // Use the codepoint-aware iterator so emoji / accented chars don't split.
  const iter = trimmed[Symbol.iterator]();
  const first = iter.next();
  const initial = first.done ? "" : (first.value as string);
  return { initial, rest: trimmed.slice(initial.length) };
}

export function PaperWelcome({
  recentFiles,
  hasWorkspace,
  onOpenFolder,
  onCreateNew,
  onOpenRecentFile,
}: WelcomeVariantProps) {
  const t = useTranslations("welcome");

  const hero = recentFiles[0];
  const stack = recentFiles.slice(1, 5);

  const heroDir = hero ? parentDir(hero.absolutePath) : "";
  const heroRelative = hero ? formatRelativeTime(hero.lastOpened) : "";
  const heroBodyRaw = hero?.preview?.trim() ?? "";
  const heroBody = heroBodyRaw ? truncate(heroBodyRaw, PREVIEW_BODY_MAX) : "";
  const { initial: dropCap, rest: bodyRest } = splitDropCap(heroBody);

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-background text-foreground">
      <motion.div
        className="flex flex-1 flex-col"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {/* TOP RAIL — desk identity on the left, decorative kbd hints on the right. */}
        <motion.div
          variants={itemVariants}
          className="flex items-center gap-3 border-b border-border bg-muted/30 px-8 py-3.5 font-mono text-[10.5px] uppercase tracking-[0.04em] text-muted-foreground"
        >
          <span className="font-semibold tracking-[0.18em]">{t("paper.deskLabel")}</span>
          <span className="text-muted-foreground/50">·</span>
          <span className="truncate normal-case tracking-normal text-muted-foreground/80">
            {heroDir || "~"}
          </span>
          <span className="text-muted-foreground/50">·</span>
          <span className="text-muted-foreground/70">
            {t("paper.localTag")} · {t("paper.sheetCount", { count: recentFiles.length })}
          </span>
          <div className="flex-1" />
          <span className="hidden sm:inline">{t("paper.kbdNew")}</span>
          <span className="hidden sm:inline">{t("paper.kbdOpen")}</span>
          <span className="hidden md:inline">{t("paper.kbdJump")}</span>
        </motion.div>

        {/* STAGE — hero sheet with Rolodex corners peeking behind. */}
        <div className="relative flex-1 overflow-hidden">
          {hero ? (
            <>
              {/* Rolodex corners — only the top portion of each card is visible. */}
              {stack.map((card, i) => {
                const rot = -3 + i * 1.6;
                const offsetY = 26 + i * 6;
                const offsetX = (i - 1.5) * 110;
                const cardPreview = card.preview?.trim() || t("paper.emptyDocument");
                return (
                  <motion.button
                    key={card.absolutePath}
                    type="button"
                    onClick={() => onOpenRecentFile(card)}
                    title={card.absolutePath}
                    variants={sheetVariants}
                    className={cn(
                      "absolute left-1/2 h-[280px] w-[220px] overflow-hidden",
                      "rounded-sm border border-border/60 bg-card text-left",
                      "shadow-md transition-transform duration-200 ease-out",
                      "hover:-translate-y-1 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    )}
                    style={{
                      top: offsetY,
                      transform: `translateX(calc(-50% + ${offsetX}px)) rotate(${rot}deg)`,
                      zIndex: i + 1,
                    }}
                  >
                    <div className="px-4 pt-4">
                      <div className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted-foreground">
                        {formatRelativeTime(card.lastOpened)}
                      </div>
                      <div className="mt-2 truncate text-[12.5px] font-medium leading-tight text-foreground">
                        {card.name || t("paper.untitled")}
                      </div>
                      <div className="mt-2 font-serif text-[11px] leading-[1.55] text-muted-foreground">
                        {cardPreview.slice(0, ROLODEX_PREVIEW_MAX)}
                        {cardPreview.length > ROLODEX_PREVIEW_MAX ? "…" : ""}
                      </div>
                    </div>
                  </motion.button>
                );
              })}

              {/* HERO SHEET — center-stage, current document. */}
              <motion.div
                variants={sheetVariants}
                className={cn(
                  "absolute left-1/2 flex flex-col",
                  "rounded-sm border border-border/60 bg-card",
                  "shadow-xl"
                )}
                style={{
                  top: 30,
                  width: "min(640px, 70%)",
                  minHeight: 460,
                  transform: "translateX(-50%) rotate(-0.6deg)",
                  zIndex: 20,
                }}
              >
                <div className="relative flex flex-1 flex-col px-12 py-9">
                  {/* Page header — meta in mono caps, with hairline underline. */}
                  <div className="flex items-baseline justify-between border-b border-border/60 pb-3 font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted-foreground">
                    <span>{t("paper.lastOpened", { when: heroRelative })}</span>
                    <span>
                      {t("paper.stats", {
                        words: hero.wordCount.toLocaleString(),
                        edits: hero.editCount.toLocaleString(),
                      })}
                    </span>
                  </div>

                  {/* Title — serif, balanced. */}
                  <h1 className="mt-5 font-serif text-[30px] font-medium leading-[1.15] tracking-[-0.02em] text-foreground [text-wrap:balance]">
                    {hero.name || t("paper.untitled")}
                  </h1>

                  {/* Body — serif prose with a serif drop cap on the first letter. */}
                  <div className="mt-4 flex-1 font-serif text-[15px] leading-[1.62] text-foreground/85 [text-wrap:pretty]">
                    {dropCap ? (
                      <span
                        aria-hidden
                        className="float-left pr-2 pt-1 font-serif text-[56px] font-medium leading-[0.85] text-foreground"
                      >
                        {dropCap}
                      </span>
                    ) : null}
                    {bodyRest || (!dropCap ? t("paper.emptyDocument") : "")}
                  </div>

                  {/* Page corner fold — geometry only, colors via tokens. */}
                  <div
                    aria-hidden
                    className="pointer-events-none absolute right-0 top-0 h-8 w-8 bg-muted/60"
                    style={{
                      clipPath: "polygon(100% 0, 0 0, 100% 100%)",
                    }}
                  />
                  <div
                    aria-hidden
                    className="pointer-events-none absolute right-0 top-0 h-8 w-8 border-b border-l border-border/60"
                    style={{
                      clipPath: "polygon(100% 0, 0 0, 100% 100%)",
                    }}
                  />

                  {/* CTA cluster. */}
                  <div className="mt-6 flex flex-wrap items-center gap-2.5 border-t border-border/60 pt-4">
                    <Button onClick={() => onOpenRecentFile(hero)} className="h-9 gap-2 px-4">
                      {t("paper.resume")}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      className="h-9 gap-2 font-mono text-xs lowercase"
                      disabled
                    >
                      {t("paper.preview")}
                    </Button>
                    <div className="flex-1" />
                    <span className="font-mono text-[10.5px] text-muted-foreground">
                      {t("paper.toOpen")}
                    </span>
                  </div>
                </div>
              </motion.div>
            </>
          ) : (
            // Empty desk — calm, no Rolodex, just the two doorways in.
            <motion.div
              variants={itemVariants}
              className={cn(
                "absolute left-1/2 top-12 flex flex-col items-start gap-5",
                "rounded-sm border border-border/60 bg-card px-12 py-10 shadow-xl"
              )}
              style={{
                width: "min(640px, 70%)",
                transform: "translateX(-50%)",
              }}
            >
              <h1 className="font-serif text-[30px] font-medium leading-[1.15] tracking-[-0.02em] text-foreground [text-wrap:balance]">
                {t("paper.emptyTitle")}
              </h1>
              <p className="font-serif text-[15px] leading-[1.62] text-muted-foreground [text-wrap:pretty]">
                {t("paper.emptySubtitle")}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2.5">
                <Button onClick={onOpenFolder} className="h-9 gap-2 px-4">
                  <FolderOpen className="h-3.5 w-3.5" />
                  {t("paper.openFolder")}
                </Button>
                <Button
                  variant="secondary"
                  onClick={onCreateNew}
                  disabled={!hasWorkspace}
                  className="h-9 gap-2 px-4 font-mono text-xs lowercase"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("paper.kbdNew")}
                </Button>
              </div>
            </motion.div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
