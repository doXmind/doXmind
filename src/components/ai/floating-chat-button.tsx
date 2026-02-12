"use client";

import { useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PanelRight, AppWindow, Check } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useLayoutStore } from "@/stores/layout-store";

// doXmind logo quadrant paths
const iconPaths = [
  "M6 0 Q0 0 0 6 L0 32 L40 40 L32 0 Z",
  "M48 0 L40 40 L80 32 L80 6 Q80 0 74 0 Z",
  "M0 48 L40 40 L32 80 L6 80 Q0 80 0 74 Z",
  "M40 40 L80 48 L80 74 Q80 80 74 80 L48 80 Z",
];

export function FloatingChatButton() {
  const { isChatOpen, toggleChat, chatMode, setChatMode } = useLayoutStore();
  const [isHovered, setIsHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setMenuOpen(true);
  }, []);

  return (
    <AnimatePresence>
      {!isChatOpen && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className="absolute bottom-5 right-5 z-30"
        >
          <DropdownMenu
            open={menuOpen}
            onOpenChange={(v) => {
              if (!v) setMenuOpen(false);
            }}
          >
            <Tooltip content="Ask AI · Right-click for options" side="left">
              <DropdownMenuTrigger asChild>
                <button
                  onPointerUp={(e) => {
                    if (e.button === 0 && !menuOpen) {
                      toggleChat();
                    }
                  }}
                  onContextMenu={handleContextMenu}
                  onMouseEnter={() => setIsHovered(true)}
                  onMouseLeave={() => setIsHovered(false)}
                  data-onboarding="chat-toggle"
                  aria-label="Open AI Chat"
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-border/60 bg-background shadow-md transition-all duration-200 hover:border-border hover:shadow-lg"
                >
                  {/* Logo icon with glitch on hover */}
                  <div className="relative">
                    {/* Cyan ghost layer */}
                    <motion.svg
                      viewBox="0 0 80 80"
                      width={24}
                      height={24}
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0"
                      animate={
                        isHovered
                          ? {
                              x: [0, -2, -1.5, -2, 0],
                              opacity: [0, 0.7, 0.5, 0.7, 0],
                            }
                          : { x: 0, opacity: 0 }
                      }
                      transition={{ duration: 0.2, ease: "easeInOut" }}
                    >
                      {iconPaths.map((d, i) => (
                        <path key={i} d={d} fill="#00f2ea" />
                      ))}
                    </motion.svg>

                    {/* Red ghost layer */}
                    <motion.svg
                      viewBox="0 0 80 80"
                      width={24}
                      height={24}
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0"
                      animate={
                        isHovered
                          ? {
                              x: [0, 2, 1.5, 2, 0],
                              opacity: [0, 0.7, 0.5, 0.7, 0],
                            }
                          : { x: 0, opacity: 0 }
                      }
                      transition={{ duration: 0.2, ease: "easeInOut" }}
                    >
                      {iconPaths.map((d, i) => (
                        <path key={i} d={d} fill="#ff0050" />
                      ))}
                    </motion.svg>

                    {/* Main logo */}
                    <motion.svg
                      viewBox="0 0 80 80"
                      width={24}
                      height={24}
                      aria-hidden="true"
                      className="relative z-10 text-foreground"
                      animate={isHovered ? { x: [0, -1, 1, -0.5, 0.5, 0] } : { x: 0 }}
                      transition={{ duration: 0.2, ease: "easeInOut" }}
                    >
                      {iconPaths.map((d, i) => (
                        <motion.path
                          key={i}
                          d={d}
                          fill="currentColor"
                          animate={
                            isHovered
                              ? {
                                  scale: [1, 0.7, 1],
                                  rotate: [0, -90, 0],
                                }
                              : { scale: 1, rotate: 0 }
                          }
                          transition={{
                            duration: 0.4,
                            delay: i * 0.04,
                            ease: [0.34, 1.56, 0.64, 1],
                          }}
                          style={{ transformOrigin: "40px 40px" }}
                        />
                      ))}
                    </motion.svg>
                  </div>
                </button>
              </DropdownMenuTrigger>
            </Tooltip>
            <DropdownMenuContent align="end" side="top">
              <DropdownMenuItem
                onClick={() => {
                  setChatMode("sidebar");
                  toggleChat();
                }}
              >
                <PanelRight className="mr-2 h-3.5 w-3.5" />
                Sidebar
                {chatMode === "sidebar" && <Check className="ml-auto h-3.5 w-3.5" />}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setChatMode("floating");
                  toggleChat();
                }}
              >
                <AppWindow className="mr-2 h-3.5 w-3.5" />
                Floating
                {chatMode === "floating" && <Check className="ml-auto h-3.5 w-3.5" />}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
