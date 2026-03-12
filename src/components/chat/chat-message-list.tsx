"use client";

import { useRef, useEffect, useImperativeHandle, forwardRef, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface ChatMessageListProps {
  children: React.ReactNode;
  /** Dependencies that trigger auto-scroll (e.g., messages, streaming content) */
  scrollDeps?: unknown[];
  className?: string;
}

export interface ChatMessageListRef {
  scrollToBottom: () => void;
}

/** Threshold (px) from bottom to consider the user "at the bottom" */
const NEAR_BOTTOM_THRESHOLD = 80;

/**
 * Scrollable message container with auto-scroll behavior.
 *
 * Optimized: uses instant scroll during rapid updates (streaming) and only
 * auto-scrolls when the user is already near the bottom of the list.
 */
export const ChatMessageList = forwardRef<ChatMessageListRef, ChatMessageListProps>(
  function ChatMessageList({ children, scrollDeps = [], className }, ref) {
    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const endRef = useRef<HTMLDivElement>(null);
    const rafIdRef = useRef<number | null>(null);

    const isNearBottom = useCallback(() => {
      const el = scrollAreaRef.current;
      if (!el) return true; // Default to auto-scroll if ref not ready
      return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD;
    }, []);

    const scrollToBottom = useCallback(() => {
      if (scrollAreaRef.current) {
        scrollAreaRef.current.scrollTo({
          top: scrollAreaRef.current.scrollHeight,
          behavior: "instant",
        });
      } else {
        endRef.current?.scrollIntoView({ behavior: "instant" });
      }
    }, []);

    useImperativeHandle(ref, () => ({ scrollToBottom }), [scrollToBottom]);

    // Auto-scroll when dependencies change, throttled via RAF
    useEffect(
      () => {
        if (!isNearBottom()) return;
        // Deduplicate: only schedule one RAF per frame
        if (rafIdRef.current !== null) return;
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null;
          scrollToBottom();
        });
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      scrollDeps
    );

    // Cleanup RAF on unmount
    useEffect(() => {
      return () => {
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
        }
      };
    }, []);

    return (
      <ScrollArea ref={scrollAreaRef} className={cn("min-h-0 flex-1", className)}>
        {children}
        <div ref={endRef} />
      </ScrollArea>
    );
  }
);
