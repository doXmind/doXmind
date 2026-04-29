"use client";

import { FolderOpen, FileText, MoreHorizontal, Moon, Sun, ListTree } from "lucide-react";
import { useTranslations } from "next-intl";
import { useThemeManager } from "@/hooks/use-theme-manager";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "@/stores/layout-store";
import { Z_INDEX } from "@/lib/constants";

interface NavButtonProps {
  icon: React.ReactNode;
  label: string;
  isActive?: boolean;
  onClick: () => void;
}

function NavButton({ icon, label, isActive, onClick }: NavButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-w-[64px] flex-col items-center justify-center gap-1 rounded-lg px-3 py-2 transition-colors",
        "active:scale-95 active:bg-accent/50",
        isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
      )}
    >
      <div className="flex h-6 w-6 items-center justify-center">{icon}</div>
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}

interface MoreMenuProps {
  isOpen: boolean;
  onClose: () => void;
}

function MoreMenu({ isOpen, onClose }: MoreMenuProps) {
  const t = useTranslations("mobile");
  const { currentTheme, toggleBaseMode } = useThemeManager();
  const { toggleMobileOutline } = useLayoutStore();

  if (!isOpen) return null;

  const handleThemeToggle = () => {
    toggleBaseMode();
    onClose();
  };

  const handleOutlineToggle = () => {
    toggleMobileOutline();
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 dark:bg-black/40"
        style={{ zIndex: Z_INDEX.MOBILE_OVERLAY }}
        onClick={onClose}
      />

      {/* Menu */}
      <div
        className="fixed bottom-16 right-4 min-w-[180px] overflow-hidden rounded-xl border border-border bg-card shadow-lg"
        style={{ zIndex: Z_INDEX.MOBILE_PANEL }}
      >
        <button
          type="button"
          onClick={handleThemeToggle}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent"
        >
          {currentTheme.baseMode === "dark" ? (
            <Sun className="h-5 w-5" />
          ) : (
            <Moon className="h-5 w-5" />
          )}
          <span className="text-sm font-medium">
            {currentTheme.baseMode === "dark" ? t("lightMode") : t("darkMode")}
          </span>
        </button>

        <div className="h-px bg-border" />

        <button
          type="button"
          onClick={handleOutlineToggle}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent"
        >
          <ListTree className="h-5 w-5" />
          <span className="text-sm font-medium">{t("documentOutline")}</span>
        </button>
      </div>
    </>
  );
}

export function MobileNavBar() {
  const t = useTranslations("mobile");
  const { isMobileSidebarOpen, setMobileSidebarOpen } = useLayoutStore();
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);

  const handleFilesClick = () => {
    setIsMoreMenuOpen(false);
    setMobileSidebarOpen(!isMobileSidebarOpen);
  };

  const handleEditorClick = () => {
    setIsMoreMenuOpen(false);
    setMobileSidebarOpen(false);
  };

  // Editor is "active" when no overlays are open
  const isEditorActive = !isMobileSidebarOpen;

  return (
    <>
      {/* More Menu */}
      <MoreMenu isOpen={isMoreMenuOpen} onClose={() => setIsMoreMenuOpen(false)} />

      {/* Bottom Navigation Bar */}
      <nav
        className={cn(
          "fixed bottom-0 left-0 right-0 border-t border-border bg-card",
          "flex items-center justify-around px-2",
          "pb-[env(safe-area-inset-bottom)]",
          "md:hidden" // Hide on desktop
        )}
        style={{ zIndex: Z_INDEX.BOTTOM_NAV, height: 56 }}
      >
        <NavButton
          icon={<FolderOpen className="h-5 w-5" />}
          label={t("files")}
          isActive={isMobileSidebarOpen}
          onClick={handleFilesClick}
        />

        <NavButton
          icon={<FileText className="h-5 w-5" />}
          label={t("editor")}
          isActive={isEditorActive}
          onClick={handleEditorClick}
        />

        <NavButton
          icon={<MoreHorizontal className="h-5 w-5" />}
          label={t("more")}
          isActive={isMoreMenuOpen}
          onClick={() => setIsMoreMenuOpen(!isMoreMenuOpen)}
        />
      </nav>
    </>
  );
}
