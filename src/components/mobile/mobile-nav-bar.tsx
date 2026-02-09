"use client";

import { FolderOpen, FileText, Sparkles, MoreHorizontal, Moon, Sun, ListTree } from "lucide-react";
import { useTheme } from "next-themes";
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
  const { theme, setTheme } = useTheme();
  const { toggleMobileOutline } = useLayoutStore();

  if (!isOpen) return null;

  const handleThemeToggle = () => {
    setTheme(theme === "dark" ? "light" : "dark");
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
          {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          <span className="text-sm font-medium">
            {theme === "dark" ? "Light Mode" : "Dark Mode"}
          </span>
        </button>

        <div className="h-px bg-border" />

        <button
          type="button"
          onClick={handleOutlineToggle}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent"
        >
          <ListTree className="h-5 w-5" />
          <span className="text-sm font-medium">Document Outline</span>
        </button>
      </div>
    </>
  );
}

export function MobileNavBar() {
  const { isMobileSidebarOpen, isMobileChatOpen, setMobileSidebarOpen, setMobileChatOpen } =
    useLayoutStore();
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);

  const handleFilesClick = () => {
    setIsMoreMenuOpen(false);
    setMobileSidebarOpen(!isMobileSidebarOpen);
    // Close chat if open
    if (isMobileChatOpen) {
      setMobileChatOpen(false);
    }
  };

  const handleEditorClick = () => {
    setIsMoreMenuOpen(false);
    // Close any open panels to focus on editor
    setMobileSidebarOpen(false);
    setMobileChatOpen(false);
  };

  const handleAIClick = () => {
    setIsMoreMenuOpen(false);
    setMobileChatOpen(!isMobileChatOpen);
    // Close sidebar if open
    if (isMobileSidebarOpen) {
      setMobileSidebarOpen(false);
    }
  };

  // Editor is "active" when no overlays are open
  const isEditorActive = !isMobileSidebarOpen && !isMobileChatOpen;

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
          label="Files"
          isActive={isMobileSidebarOpen}
          onClick={handleFilesClick}
        />

        <NavButton
          icon={<FileText className="h-5 w-5" />}
          label="Editor"
          isActive={isEditorActive}
          onClick={handleEditorClick}
        />

        <NavButton
          icon={<Sparkles className="h-5 w-5" />}
          label="AI"
          isActive={isMobileChatOpen}
          onClick={handleAIClick}
        />

        <NavButton
          icon={<MoreHorizontal className="h-5 w-5" />}
          label="More"
          isActive={isMoreMenuOpen}
          onClick={() => setIsMoreMenuOpen(!isMoreMenuOpen)}
        />
      </nav>
    </>
  );
}
