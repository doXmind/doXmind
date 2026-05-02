"use client";

// i18n keys consumed by this component (assumed present at welcome.<key>):
//   stratigraphyHeader        "stratigraphy"
//   stratigraphyOldestHint    "oldest ↓"
//   stratigraphyLastDocs      "last {count} documents"
//   stratigraphyEmptyTitle    "No layers yet"
//   stratigraphyEmptyBody     "Open a file to start the stack."
//   stratigraphyWordsSuffix   "w"
//   actionNew                 "New"
//   actionOpenFolder          "Open Folder"

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { FolderOpen, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatRelativeTime, type WelcomeVariantProps } from "@/components/welcome/types";

const LAYER_LIMIT = 6;

// Pin the Hierarchy variant to its design typography regardless of the
// app-wide font preference. Mono uses the .font-mono class which already
// maps to JetBrains Mono in this project's globals.css.
const FONT_SANS =
  '"Helvetica Neue", Helvetica, -apple-system, "SF Pro Text", system-ui, sans-serif';
const FONT_SERIF = '"Iowan Old Style", Palatino, Georgia, serif';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.12 } },
};

interface StratigraphyLayer {
  key: string;
  title: string;
  subtitle: string;
  preview: string;
  words: number;
  when: string;
  isDocument: boolean;
  onActivate: () => void;
}

interface HierarchyRowProps {
  layer: StratigraphyLayer;
  index: number;
  isActive: boolean;
  isFirst: boolean;
}

function HierarchyRow({ layer, index, isActive, isFirst }: HierarchyRowProps) {
  return (
    <li>
      <button
        type="button"
        onClick={layer.onActivate}
        title={layer.subtitle}
        className={cn(
          "flex w-full items-baseline gap-5 py-3 text-left",
          "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          !isFirst && "border-t border-border"
        )}
      >
        <span
          className={cn(
            "w-5 shrink-0 font-mono text-[11px] tabular-nums tracking-[0.02em]",
            isActive ? "font-medium text-foreground" : "text-muted-foreground"
          )}
        >
          {String(index + 1).padStart(2, "0")}
        </span>

        <span
          style={{ fontFamily: FONT_SANS }}
          className={cn(
            "min-w-0 flex-1 truncate text-[15px] leading-snug tracking-[-0.012em] text-foreground",
            isActive ? "font-medium" : "font-normal"
          )}
        >
          {layer.title}
        </span>

        <span
          className={cn(
            "shrink-0 font-mono text-[11px] tabular-nums",
            isActive ? "text-muted-foreground" : "text-muted-foreground/70"
          )}
        >
          {layer.when}
        </span>

        <span
          aria-hidden="true"
          className={cn(
            "w-3.5 shrink-0 text-right font-mono text-[11px] leading-none text-foreground",
            isActive ? "opacity-100" : "opacity-0"
          )}
        >
          {"↵"}
        </span>
      </button>

      {isActive && layer.preview ? (
        <div
          style={{ fontFamily: FONT_SERIF }}
          className="max-w-[40rem] pb-3 pl-10 pr-2 text-[14.5px] leading-relaxed text-muted-foreground"
        >
          {layer.preview}
        </div>
      ) : null}
    </li>
  );
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
        isDocument: true,
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
      isDocument: false,
      onActivate: () => onOpenRecentWorkspace(workspace.path),
    }));
  }, [recentFiles, recentWorkspaces, onOpenRecentFile, onOpenRecentWorkspace]);

  const isEmpty = layers.length === 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background pt-6 text-foreground">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col overflow-hidden px-8">
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
          className="relative mt-3 flex flex-1 flex-col overflow-y-auto"
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
            <ol className="m-0 flex list-none flex-col p-0">
              {layers.map((layer, index) => (
                <HierarchyRow
                  key={layer.key}
                  layer={layer}
                  index={index}
                  isActive={index === 0 && recentFiles.length > 0}
                  isFirst={index === 0}
                />
              ))}
            </ol>
          )}
        </motion.div>
      </div>

      <div className="mx-auto w-full max-w-2xl px-8">
        <div className="flex items-center gap-2 border-t border-border py-2.5">
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
    </div>
  );
}

export default StratigraphyWelcome;
