"use client";

// i18n keys consumed by this component (assumed present at welcome.<key>):
//   stratigraphyWordsSuffix   "w"
//   firstRunTag               "Welcome to doxmind."
//   firstRunHeading           "A quiet place to write, on your disk."
//   firstRunNewTitle          title for the untitled-buffer action
//   firstRunNewBody           body for the untitled-buffer action
//   firstRunOpenFolderTitle   title for the workspace-folder action
//   firstRunOpenFolderBody    body for the workspace-folder action
//   firstRunLocalNote         quiet filesystem promise under the actions
//   recentTag                 "Welcome back."
//   recentHeading             heading for the recent-project state
//   recentBody                short body for the recent-project state
//   recentSectionTitle        "Recent"
//   recentStatus              "Last opened"
//   quickActions              "Quick actions"
//   actionNew                 "New"
//   actionOpenFolder          "Open Folder"

import { useMemo, useRef, useState, type ComponentType } from "react";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { ArrowUpRight, FilePlus2, FileText, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRelativeTime, type WelcomeVariantProps } from "@/components/welcome/types";

const LAYER_LIMIT = 6;

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.12 } },
};

interface RecentEntry {
  key: string;
  title: string;
  subtitle: string;
  preview: string;
  words: number;
  when: string;
  isDocument: boolean;
  onActivate: () => void;
}

interface FirstRunAction {
  title: string;
  body: string;
  icon: ComponentType<{ className?: string }>;
  onClick: () => void;
}

interface FirstRunStateProps {
  tag: string;
  heading: string;
  note: string;
  actions: FirstRunAction[];
}

interface RecentStateProps {
  tag: string;
  heading: string;
  body: string;
  sectionTitle: string;
  recentStatus: string;
  quickActionsTitle: string;
  entries: RecentEntry[];
  actionNew: string;
  actionOpenFolder: string;
  onCreateNew: () => void;
  onOpenFolder: () => void;
}

// Brand-new-user state: a compact launch surface with only real actions.
// No numbered onboarding: the first screen should behave like a workbench,
// not a tutorial pretending every sentence is clickable.
function FirstRunState({ tag, heading, note, actions }: FirstRunStateProps) {
  return (
    <div className="flex flex-1 flex-col justify-center pb-12 pt-6">
      <div className="text-[13px] text-muted-foreground">{tag}</div>
      <h1 className="mt-2 text-[30px] font-semibold leading-[1.15] tracking-[-0.022em] text-foreground">
        {heading}
      </h1>

      <div className="mt-12 grid gap-3 sm:grid-cols-2">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.title}
              type="button"
              onClick={action.onClick}
              aria-label={action.title}
              className={cn(
                "group flex min-h-[126px] flex-col justify-between rounded-lg border border-border bg-background/40 p-4 text-left",
                "transition-colors duration-150 hover:border-foreground/25 hover:bg-muted/35",
                "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              )}
            >
              <Icon className="h-5 w-5 text-muted-foreground transition-colors group-hover:text-foreground" />
              <span>
                <span className="block text-[16px] font-semibold tracking-[-0.012em] text-foreground">
                  {action.title}
                </span>
                <span className="mt-1.5 block text-[13.5px] leading-snug text-muted-foreground">
                  {action.body}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-5 max-w-[34rem] border-t border-border pt-4 text-[13.5px] leading-relaxed text-muted-foreground">
        {note}
      </p>
    </div>
  );
}

function RecentState({
  tag,
  heading,
  body,
  sectionTitle,
  recentStatus,
  quickActionsTitle,
  entries,
  actionNew,
  actionOpenFolder,
  onCreateNew,
  onOpenFolder,
}: RecentStateProps) {
  return (
    <div className="flex flex-1 flex-col justify-center pb-12 pt-6">
      <div className="text-[13px] text-muted-foreground">{tag}</div>
      <h1 className="mt-2 text-[30px] font-semibold leading-[1.15] tracking-[-0.022em] text-foreground">
        {heading}
      </h1>
      <p className="mt-3 max-w-[34rem] text-[14px] leading-relaxed text-muted-foreground">{body}</p>

      <div className="mt-9 grid gap-5 md:grid-cols-[minmax(0,1fr)_220px]">
        <section className="min-w-0">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              {sectionTitle}
            </h2>
            <span className="text-[11px] text-muted-foreground/70">{recentStatus}</span>
          </div>

          <motion.ol
            className="m-0 list-none overflow-hidden rounded-lg border border-border bg-background/35 p-0"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            {entries.map((entry, index) => {
              const Icon = entry.isDocument ? FileText : FolderOpen;
              return (
                <li key={entry.key} className={index === 0 ? "" : "border-t border-border"}>
                  <button
                    type="button"
                    onClick={entry.onActivate}
                    title={entry.subtitle}
                    className={cn(
                      "group flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors duration-150 hover:bg-muted/35",
                      "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    )}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/45 text-muted-foreground transition-colors group-hover:text-foreground">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold tracking-[-0.012em] text-foreground">
                        {entry.title}
                      </span>
                      <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">
                        {entry.subtitle}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground/75">
                      {entry.when}
                    </span>
                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                  {index === 0 && entry.preview ? (
                    <div className="border-t border-border/70 px-14 py-2 text-[13px] leading-relaxed text-muted-foreground">
                      {entry.preview}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </motion.ol>
        </section>

        <section>
          <h2 className="mb-2 text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {quickActionsTitle}
          </h2>
          <div className="grid gap-2">
            <button
              type="button"
              onClick={onCreateNew}
              className={cn(
                "flex h-11 items-center gap-2 rounded-lg border border-border bg-background/35 px-3 text-left text-[13.5px] font-medium text-foreground",
                "transition-colors hover:border-foreground/25 hover:bg-muted/35",
                "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              )}
            >
              <FilePlus2 className="h-4 w-4 text-muted-foreground" />
              {actionNew}
            </button>
            <button
              type="button"
              onClick={onOpenFolder}
              className={cn(
                "flex h-11 items-center gap-2 rounded-lg border border-border bg-background/35 px-3 text-left text-[13.5px] font-medium text-foreground",
                "transition-colors hover:border-foreground/25 hover:bg-muted/35",
                "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              )}
            >
              <FolderOpen className="h-4 w-4 text-muted-foreground" />
              {actionOpenFolder}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

export function StratigraphyWelcome(props: WelcomeVariantProps) {
  const {
    recentFiles,
    recentWorkspaces,
    onCreateNew,
    onOpenFolder,
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

  const recentEntries = useMemo<RecentEntry[]>(() => {
    // VSCode-style precedence: recent workspaces (folders) come first, then any
    // standalone files opened on their own. Documents opened inside a workspace
    // aren't recorded individually — the workspace folder represents them.
    const folderEntries: RecentEntry[] = recentWorkspaces.map((workspace) => ({
      key: workspace.path,
      title: workspace.name,
      subtitle: workspace.parent,
      preview: "",
      words: 0,
      when: workspace.parent,
      isDocument: false,
      onActivate: () => onOpenRecentWorkspace(workspace.path),
    }));
    const fileEntries: RecentEntry[] = recentFiles.map((file) => ({
      key: file.absolutePath,
      title: file.name,
      subtitle: file.workspacePath,
      preview: file.preview,
      words: file.wordCount,
      when: file.lastOpened ? formatRelativeTime(file.lastOpened) : file.documentType,
      isDocument: true,
      onActivate: () => onOpenRecentFile(file),
    }));
    return [...folderEntries, ...fileEntries].slice(0, LAYER_LIMIT);
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
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden px-8">
        {isFirstRun ? (
          <FirstRunState
            tag={t("firstRunTag")}
            heading={t("firstRunHeading")}
            note={t("firstRunLocalNote")}
            actions={[
              {
                title: t("firstRunNewTitle"),
                body: t("firstRunNewBody"),
                icon: FilePlus2,
                onClick: onCreateNew,
              },
              {
                title: t("firstRunOpenFolderTitle"),
                body: t("firstRunOpenFolderBody"),
                icon: FolderOpen,
                onClick: onOpenFolder,
              },
            ]}
          />
        ) : (
          <RecentState
            tag={t("recentTag")}
            heading={t("recentHeading")}
            body={t("recentBody")}
            sectionTitle={t("recentSectionTitle")}
            recentStatus={t("recentStatus")}
            quickActionsTitle={t("quickActions")}
            entries={recentEntries}
            actionNew={t("actionNew")}
            actionOpenFolder={t("actionOpenFolder")}
            onCreateNew={onCreateNew}
            onOpenFolder={onOpenFolder}
          />
        )}
      </div>
    </div>
  );
}

export default StratigraphyWelcome;
