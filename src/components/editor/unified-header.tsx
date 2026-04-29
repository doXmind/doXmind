"use client";

import Link from "next/link";
import {
  Search,
  MoreHorizontal,
  PanelLeft,
  Check,
  Clock,
  Download,
  Keyboard,
  Palette,
  SpellCheck,
  Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { Tooltip } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { ThemePickerPanel } from "@/components/shared/shared-theme-toggle";
import { cn, formatShortcut } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useLayoutStore } from "@/stores/layout-store";
import { useFileStore } from "@/stores/file-store";
import { useEditorStore } from "@/stores/editor-store";
import { api } from "@/lib/api";

export function UnifiedHeader() {
  const {
    isFilesSidebarOpen,
    isVersionHistoryOpen,
    isSearchBarOpen,
    toggleFilesSidebar,
    toggleVersionHistory,
    toggleSearchBar,
    setKeyboardShortcutsOpen,
    setPresentationMode,
  } = useLayoutStore();
  const { currentFileId, files } = useFileStore();
  const { spellcheckEnabled, setSpellcheckEnabled } = useEditorStore();
  const tSettings = useTranslations("settings");
  const t = useTranslations("editor");

  const currentFile = files.find((f) => f.id === currentFileId);

  const handleExport = (format: "markdown" | "pdf" | "docx") => {
    if (!currentFile) return;
    const formatLabel = format === "markdown" ? "Markdown" : format.toUpperCase();

    toast.promise(
      api.exportFile(currentFile.id, format).then((blob) => {
        const baseName = currentFile.name.replace(/\.md$/, "");
        const extension = format === "markdown" ? "md" : format;
        const filename = `${baseName}.${extension}`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }),
      {
        loading: t("exportingAs", { format: formatLabel }),
        success: t("exportedAs", { format: formatLabel }),
        error: t("failedToExportAs", { format: formatLabel }),
      }
    );
  };

  return (
    <>
      <header className="relative z-20 flex h-11 shrink-0 items-center justify-between border-b border-border/30 bg-background/95 px-3">
        {/* Left: app identity + global sidebar toggle */}
        <div className="flex min-w-0 items-center gap-1.5">
          <Tooltip content="doXmind" side="bottom">
            <Link
              href="/editor"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-accent/70"
              aria-label="doXmind"
            >
              <Logo variant="icon" size="sm" className="h-6 w-6" />
            </Link>
          </Tooltip>
          <Tooltip content={isFilesSidebarOpen ? t("hideFiles") : t("showFiles")} side="bottom">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground",
                isFilesSidebarOpen && "bg-accent/70 text-foreground"
              )}
              onClick={toggleFilesSidebar}
              aria-label={isFilesSidebarOpen ? t("hideFiles") : t("showFiles")}
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
          </Tooltip>
        </div>

        {/* Right: Action buttons — only when a file is open */}
        <div className="flex items-center gap-1">
          {currentFile && (
            <>
              {/* Present */}
              <Tooltip content={t("present")} side="bottom">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => setPresentationMode(true)}
                  aria-label={t("present")}
                >
                  <Play className="h-4 w-4" />
                </Button>
              </Tooltip>

              {/* Search */}
              <Tooltip
                content={t("findTooltip", { shortcut: formatShortcut("Ctrl+F") })}
                side="bottom"
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-8 w-8 text-muted-foreground hover:text-foreground",
                    isSearchBarOpen && "bg-accent text-accent-foreground"
                  )}
                  onClick={toggleSearchBar}
                  aria-label={t("findTooltip", { shortcut: formatShortcut("Ctrl+F") })}
                >
                  <Search className="h-4 w-4" />
                </Button>
              </Tooltip>

              {/* More Menu */}
              <DropdownMenu>
                <Tooltip content={t("moreTooltip")} side="bottom">
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      aria-label={t("moreActions")}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </Tooltip>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onClick={() => setSpellcheckEnabled(!spellcheckEnabled)}>
                    <SpellCheck className="mr-2 h-4 w-4" />
                    {t("spellCheck")}
                    {spellcheckEnabled && <Check className="ml-auto h-4 w-4" />}
                  </DropdownMenuItem>

                  <DropdownMenuSeparator />

                  {/* Theme */}
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Palette className="mr-2 h-4 w-4" />
                      {tSettings("appearance")}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent side="left" className="w-[280px] p-3">
                      <ThemePickerPanel />
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>

                  <DropdownMenuSeparator />

                  {/* Version History */}
                  <DropdownMenuItem onClick={toggleVersionHistory}>
                    <Clock className="mr-2 h-4 w-4" />
                    {t("versionHistory")}
                    {isVersionHistoryOpen && <Check className="ml-auto h-4 w-4" />}
                  </DropdownMenuItem>

                  <DropdownMenuSeparator />

                  {/* Export */}
                  <DropdownMenuItem onClick={() => handleExport("markdown")}>
                    <Download className="mr-2 h-4 w-4" />
                    {t("exportAsMarkdown")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("pdf")}>
                    <Download className="mr-2 h-4 w-4" />
                    {t("exportAsPDF")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("docx")}>
                    <Download className="mr-2 h-4 w-4" />
                    {t("exportAsWord")}
                  </DropdownMenuItem>

                  <DropdownMenuSeparator />

                  {/* Keyboard Shortcuts */}
                  <DropdownMenuItem onClick={() => setKeyboardShortcutsOpen(true)}>
                    <Keyboard className="mr-2 h-4 w-4" />
                    {t("keyboardShortcuts")}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {formatShortcut("Ctrl+?")}
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="mx-1 h-5 w-px bg-border/30" />
            </>
          )}
        </div>
      </header>
    </>
  );
}
