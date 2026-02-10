"use client";

import { useRef, useEffect, useImperativeHandle, forwardRef } from "react";
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

/**
 * Scrollable message container with auto-scroll behavior.
 */
export const ChatMessageList = forwardRef<ChatMessageListRef, ChatMessageListProps>(
  function ChatMessageList({ children, scrollDeps = [], className }, ref) {
    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const endRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
      if (scrollAreaRef.current) {
        scrollAreaRef.current.scrollTo({
          top: scrollAreaRef.current.scrollHeight,
          behavior: "smooth",
        });
      } else {
        endRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    };

    useImperativeHandle(ref, () => ({ scrollToBottom }));

    // Auto-scroll when dependencies change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
      scrollToBottom();
    }, scrollDeps);

    return (
      <ScrollArea ref={scrollAreaRef} className={cn("min-h-0 flex-1", className)}>
        {children}
        <div ref={endRef} />
      </ScrollArea>
    );
  }
);
