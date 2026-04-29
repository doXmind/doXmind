"use client";

/**
 * Mobile Editor Layout Component
 *
 * Main layout wrapper for the new mobile design.
 * Includes header, bottom bar, answer bubble, and overlays.
 */

import { MobileHeader } from "./mobile-header";
import { MobileFormattingToolbar } from "./mobile-formatting-toolbar";
import { MobileBlockInsertSheet } from "./mobile-block-insert-sheet";
import { MobileSidebar } from "./mobile-sidebar";
import { MobileOutlineSheet } from "./mobile-outline-sheet";
import { useLayoutStore } from "@/stores/layout-store";
import { useFileStore } from "@/stores/file-store";
import { useKeyboardState } from "@/hooks/use-mobile-gestures";
import { FloatingOutline } from "./floating-outline";

interface MobileEditorLayoutProps {
  children: React.ReactNode;
}

export function MobileEditorLayout({ children }: MobileEditorLayoutProps) {
  const { isMobileSidebarOpen } = useLayoutStore();

  const { currentFileId } = useFileStore();
  const { isVisible: isKeyboardVisible } = useKeyboardState();

  return (
    <div className="flex h-full flex-col bg-background md:hidden">
      {/* Header - flex child, not fixed */}
      <div className="h-12 flex-shrink-0">
        <MobileHeader />
      </div>

      {/* Main scroll container - SINGLE source of scrolling */}
      <main
        data-mobile-scroll
        className="hide-scrollbar relative flex-1 overflow-y-auto overflow-x-hidden"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {children}
      </main>

      {/* Keep bottom spacing stable when the keyboard is hidden. */}
      {currentFileId && !isKeyboardVisible && <div className="h-2 flex-shrink-0" />}

      {/* Formatting toolbar - appears above keyboard when editing */}
      {currentFileId && <MobileFormattingToolbar />}

      {/* Block insert sheet */}
      <MobileBlockInsertSheet />

      {/* File Sidebar */}
      {isMobileSidebarOpen && <MobileSidebar />}

      {/* Outline Sheet — always mounted so AnimatePresence exit animation plays */}
      <MobileOutlineSheet />

      {/* Floating outline indicator (scroll-triggered) */}
      {currentFileId && <FloatingOutline />}
    </div>
  );
}
