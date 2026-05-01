"use client";

// i18n keys consumed by this component (assumed present at welcome.<key>):
//   stratigraphyHeader        "stratigraphy"
//   stratigraphyOldestHint    "oldest ↓"
//   stratigraphyLastDocs      "last {count} documents"
//   stratigraphyEmptyTitle    "No layers yet"
//   stratigraphyEmptyBody     "Open a file to start the stack."
//   stratigraphyResume        "Resume"
//   stratigraphyWordsSuffix   "w"
//   actionNew                 "New"
//   actionOpen                "Open"
//   actionOpenFolder          "Open Folder"
//   actionImport              "Import"
//   recentWorkspaces          (already exists)
//   noRecentWorkspaces        (already exists)

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { ArrowRight, FolderOpen, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  formatRelativeTime,
  type WelcomeRecentFile,
  type WelcomeVariantProps,
} from "@/components/welcome/types";

const LAYER_LIMIT = 6;
// 96px ribbon cap mirrors the prototype gauge; 250 words ~ "a paragraph" feels
// like the right inflection point so most docs land in the visible range.
const RIBBON_MAX_PX = 96;
const RIBBON_REFERENCE_WORDS = 2500;

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.04 },
  },
};

const layerVariants = {
  hidden: { opacity: 0, y: 6 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.32, ease: [0.25, 0.1, 0.25, 1] as const },
  },
};

function ribbonWidth(words: number): number {
  if (!Number.isFinite(words) || words <= 0) return 6;
  const ratio = Math.min(1, words / RIBBON_REFERENCE_WORDS);
  return Math.max(6, Math.round(ratio * RIBBON_MAX_PX));
}

interface StratigraphyLayer {
  key: string;
  title: string;
  subtitle: string;
  preview: string;
  words: number;
  when: string;
  onActivate: () => void;
}

export function StratigraphyWelcome(props: WelcomeVariantProps) {
  const {
    recentFiles,
    recentWorkspaces,
    hasWorkspace,
    onCreateNew,
    onOpenFolder,
    onOpenRecentFile,
    onOpenRecentWorkspace,
  } = props;
  const t = useTranslations("welcome");

  const layers = useMemo<StratigraphyLayer[]>(() => {
    if (recentFiles.length > 0) {
      return recentFiles.slice(0, LAYER_LIMIT).map((file) => ({
        key: file.absolutePath,
        title: file.name,
        subtitle: file.workspacePath,
        preview: file.preview,
        words: file.wordCount,
        when: formatRelativeTime(file.lastOpened),
        onActivate: () => onOpenRecentFile(file),
      }));
    }
    return recentWorkspaces.slice(0, LAYER_LIMIT).map((workspace) => ({
      key: workspace.path,
      title: workspace.name,
      subtitle: workspace.parent,
      preview: "",
      words: 0,
      when: workspace.path,
      onActivate: () => onOpenRecentWorkspace(workspace.path),
    }));
  }, [recentFiles, recentWorkspaces, onOpenRecentFile, onOpenRecentWorkspace]);

  const topFile: WelcomeRecentFile | undefined = recentFiles[0];
  const isEmpty = layers.length === 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background px-7 pt-6 text-foreground">
      <div className="flex items-baseline justify-between">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground">
          {t("stratigraphyHeader")}
          <span className="mx-2 text-muted-foreground/60">{"·"}</span>
          {t("stratigraphyLastDocs", { count: Math.max(layers.length, 1) })}
        </div>
        <div className="font-mono text-[10.5px] text-muted-foreground">
          {t("stratigraphyOldestHint")}
        </div>
      </div>

      <motion.div
        className="relative mt-5 flex flex-1 flex-col overflow-y-auto"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {isEmpty ? (
          <div className="flex flex-1 items-center justify-center px-6 py-12">
            <div className="max-w-sm border-t border-border bg-muted/40 px-6 py-10 text-center">
              <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground">
                {t("stratigraphyEmptyTitle")}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{t("stratigraphyEmptyBody")}</p>
            </div>
          </div>
        ) : (
          layers.map((layer, index) => {
            const isTop = index === 0 && recentFiles.length > 0;
            // Each successive layer is inset by 18px on both sides so the
            // stack reads as paper poking out from underneath the topmost.
            const inset = index * 18;
            return (
              <motion.button
                key={layer.key}
                type="button"
                variants={layerVariants}
                onClick={layer.onActivate}
                style={{ marginLeft: inset, marginRight: inset }}
                className={cn(
                  "group relative flex items-center gap-5 border-t border-border text-left transition-colors",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isTop
                    ? "bg-card px-6 pb-6 pt-5 hover:bg-accent/60"
                    : index % 2 === 1
                      ? "bg-muted/30 px-6 py-3 hover:bg-muted/60"
                      : "bg-muted/10 px-6 py-3 hover:bg-muted/40",
                  index > 0 && "-mt-px"
                )}
              >
                <div className="w-20 shrink-0 font-mono text-[10.5px] text-muted-foreground">
                  <div
                    className={cn(
                      "font-medium",
                      isTop ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {String(index + 1).padStart(2, "0")}
                  </div>
                  <div className="mt-0.5 truncate" title={layer.subtitle || layer.when}>
                    {layer.when}
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "truncate tracking-tight text-foreground",
                      isTop ? "text-[22px] font-medium" : "text-sm font-normal"
                    )}
                  >
                    {layer.title}
                  </div>
                  {isTop && layer.preview ? (
                    <div className="mt-2 line-clamp-2 font-serif text-[14.5px] leading-snug text-muted-foreground">
                      {layer.preview}
                    </div>
                  ) : null}
                  {!isTop && layer.subtitle ? (
                    <div className="mt-0.5 truncate text-xs text-muted-foreground/70">
                      {layer.subtitle}
                    </div>
                  ) : null}
                </div>

                <div className="relative hidden shrink-0 sm:block" style={{ width: RIBBON_MAX_PX }}>
                  <div
                    className={cn("transition-all", isTop ? "h-10 bg-foreground" : "h-1 bg-border")}
                    style={{ width: ribbonWidth(layer.words) }}
                  />
                  <div
                    className={cn(
                      "absolute right-0 font-mono text-[10px] text-muted-foreground",
                      isTop ? "-top-4" : "-top-3.5"
                    )}
                  >
                    {layer.words.toLocaleString()}
                    {t("stratigraphyWordsSuffix")}
                  </div>
                </div>

                {isTop && topFile ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenRecentFile(topFile);
                    }}
                    className="ml-2 shrink-0 gap-1.5"
                  >
                    {t("stratigraphyResume")}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </motion.button>
            );
          })
        )}
      </motion.div>

      <div className="mt-3 flex items-center gap-2 border-t border-border py-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCreateNew}
          disabled={!hasWorkspace}
          className="gap-1.5 font-mono text-xs"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("actionNew")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onOpenFolder}
          className="gap-1.5 font-mono text-xs"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          {t("actionOpenFolder")}
        </Button>
      </div>
    </div>
  );
}

export default StratigraphyWelcome;
