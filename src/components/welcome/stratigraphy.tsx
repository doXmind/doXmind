"use client";

// i18n keys consumed by this component (assumed present at welcome.<key>):
//   stratigraphyHeader        "stratigraphy"
//   stratigraphyOldestHint    "oldest ↓"
//   stratigraphyLastDocs      "last {count} opened"
//   stratigraphyWordsSuffix   "w"
//   firstRunTag               "Welcome to doxmind."
//   firstRunHeading           "A quiet place to write, on your disk."
//   firstRunStep{1,2,3}Title  bold step titles ("Choose a folder", ...)
//   firstRunStep{1,2,3}Body   one-line explanation under each step
//   actionNew                 "New"
//   actionOpenFolder          "Open Folder"

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { FolderOpen, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatRelativeTime, type WelcomeVariantProps } from "@/components/welcome/types";

const LAYER_LIMIT = 6;

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

interface FirstRunStep {
  title: string;
  body: string;
  // When provided, the row renders as a button (hover tint + focus ring +
  // pointer cursor). When omitted, the row stays purely informational.
  onClick?: () => void;
}

interface FirstRunStateProps {
  tag: string;
  heading: string;
  steps: FirstRunStep[];
}

// Brand-new-user state: 3-step onboarding card with mono index column,
// bold step titles, and a one-line explanation under each. Matches the
// "A quiet place to write, on your disk." direction.
function FirstRunState({ tag, heading, steps }: FirstRunStateProps) {
  return (
    <div className="flex flex-1 flex-col justify-center pb-12 pt-6">
      <div className="text-[13px] text-muted-foreground">{tag}</div>
      <h1 className="mt-2 text-[30px] font-semibold leading-[1.15] tracking-[-0.022em] text-foreground">
        {heading}
      </h1>

      <ol className="m-0 mt-12 flex list-none flex-col p-0">
        {steps.map((step, index) => {
          const isInteractive = typeof step.onClick === "function";
          const inner = (
            <>
              <span
                className={cn(
                  "w-5 shrink-0 text-[11px] tabular-nums tracking-[0.02em] transition-colors duration-150",
                  isInteractive
                    ? "text-muted-foreground group-hover:text-foreground group-focus-visible:text-foreground"
                    : "text-muted-foreground"
                )}
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold tracking-[-0.012em] text-foreground">
                  {step.title}
                </div>
                <div className="mt-1 text-[14px] leading-snug text-muted-foreground">
                  {step.body}
                </div>
              </div>
            </>
          );

          const liBorder = cn(
            "border-t border-border",
            index === steps.length - 1 && "border-b border-border"
          );

          if (isInteractive) {
            return (
              <li key={index} className={liBorder}>
                <button
                  type="button"
                  onClick={step.onClick}
                  className={cn(
                    "group flex w-full items-baseline gap-6 py-4 text-left transition-colors duration-150",
                    "cursor-pointer hover:bg-muted/30",
                    "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  )}
                >
                  {inner}
                </button>
              </li>
            );
          }

          return (
            <li
              key={index}
              className={cn("flex cursor-default items-baseline gap-6 py-4", liBorder)}
            >
              {inner}
            </li>
          );
        })}
      </ol>
    </div>
  );
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
            "w-5 shrink-0 text-[11px] tabular-nums tracking-[0.02em]",
            isActive ? "font-medium text-foreground" : "text-muted-foreground"
          )}
        >
          {String(index + 1).padStart(2, "0")}
        </span>

        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[15px] leading-snug tracking-[-0.012em] text-foreground",
            isActive ? "font-medium" : "font-normal"
          )}
        >
          {layer.title}
        </span>

        <span
          className={cn(
            "shrink-0 text-[11px] tabular-nums",
            isActive ? "text-muted-foreground" : "text-muted-foreground/70"
          )}
        >
          {layer.when}
        </span>

        <span
          aria-hidden="true"
          className={cn(
            "w-3.5 shrink-0 text-right text-[11px] leading-none text-foreground",
            isActive ? "opacity-100" : "opacity-0"
          )}
        >
          {"↵"}
        </span>
      </button>

      {isActive && layer.preview ? (
        <div className="max-w-[40rem] pb-3 pl-10 pr-2 text-[14.5px] leading-relaxed text-muted-foreground">
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
    onCreateNew,
    onOpenFolder,
    onStartWriting,
    onOpenRecentFile,
    onOpenRecentWorkspace,
    onDropFiles,
  } = props;
  const t = useTranslations("welcome");

  // OS file/folder drag-and-drop. We only react to "Files" drags (not internal
  // element drags) and preventDefault so Electron doesn't navigate the window
  // to the dropped file. A depth counter keeps the overlay steady while the
  // cursor crosses child elements.
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);

  const isFileDrag = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");

  const handleDragEnter = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setIsDragging(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) onDropFiles(files);
  };

  const layers = useMemo<StratigraphyLayer[]>(() => {
    // VSCode-style precedence: recent workspaces (folders) come first, then any
    // standalone files opened on their own. Documents opened inside a workspace
    // aren't recorded individually — the workspace folder represents them.
    const folderLayers: StratigraphyLayer[] = recentWorkspaces.map((workspace) => ({
      key: workspace.path,
      title: workspace.name,
      subtitle: workspace.parent,
      preview: "",
      words: 0,
      when: workspace.parent,
      isDocument: false,
      onActivate: () => onOpenRecentWorkspace(workspace.path),
    }));
    const fileLayers: StratigraphyLayer[] = recentFiles.map((file) => ({
      key: file.absolutePath,
      title: file.name,
      subtitle: file.workspacePath,
      preview: file.preview,
      words: file.wordCount,
      when: file.lastOpened ? formatRelativeTime(file.lastOpened) : file.documentType,
      isDocument: true,
      onActivate: () => onOpenRecentFile(file),
    }));
    return [...folderLayers, ...fileLayers].slice(0, LAYER_LIMIT);
  }, [recentFiles, recentWorkspaces, onOpenRecentFile, onOpenRecentWorkspace]);

  // First-run = brand-new user with no document or workspace history at all.
  // The standard list/header chrome doesn't make sense here — there's nothing
  // to label and nothing to show — so swap to a typographic welcome that
  // points at the action bar below.
  const isFirstRun = recentFiles.length === 0 && recentWorkspaces.length === 0;

  return (
    <div
      className="relative flex flex-1 flex-col overflow-hidden bg-background pt-6 text-foreground"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging ? (
        <div className="pointer-events-none absolute inset-3 z-50 flex items-center justify-center rounded-2xl bg-background/70 ring-1 ring-inset ring-border backdrop-blur-sm">
          <div className="flex items-center gap-2 rounded-full bg-muted/60 px-4 py-2 text-[13px] text-muted-foreground">
            <FolderOpen className="h-4 w-4" />
            {t("dropToOpen")}
          </div>
        </div>
      ) : null}
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col overflow-hidden px-8">
        {isFirstRun ? (
          <FirstRunState
            tag={t("firstRunTag")}
            heading={t("firstRunHeading")}
            steps={[
              {
                title: t("firstRunStep1Title"),
                body: t("firstRunStep1Body"),
                onClick: onOpenFolder,
              },
              {
                title: t("firstRunStep2Title"),
                body: t("firstRunStep2Body"),
                onClick: onStartWriting,
              },
              {
                // Row 3 stays informational — the "remember last session"
                // promise has no concrete action a brand-new user can take.
                title: t("firstRunStep3Title"),
                body: t("firstRunStep3Body"),
              },
            ]}
          />
        ) : (
          <>
            <div className="flex items-baseline">
              <div className="text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground">
                {t("stratigraphyHeader")}
                <span className="mx-2 text-muted-foreground/60">{"·"}</span>
                {t("stratigraphyLastDocs", { count: Math.max(layers.length, 1) })}
              </div>
            </div>

            <motion.div
              className="relative mt-3 flex flex-1 flex-col overflow-y-auto"
              variants={containerVariants}
              initial="hidden"
              animate="visible"
            >
              <ol className="m-0 flex list-none flex-col p-0">
                {layers.map((layer, index) => (
                  <HierarchyRow
                    key={layer.key}
                    layer={layer}
                    index={index}
                    isActive={index === 0}
                    isFirst={index === 0}
                  />
                ))}
              </ol>
            </motion.div>
          </>
        )}
      </div>

      <div className="mx-auto w-full max-w-2xl px-8">
        <div className="flex items-center gap-2 border-t border-border py-2.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCreateNew}
            className="gap-1.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("actionNew")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onOpenFolder}
            className="gap-1.5 text-xs"
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
