"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import {
  Sparkles,
  Square,
  X,
  RotateCcw,
  ChevronUp,
  Wand2,
  CheckCircle,
  Table,
  FileText,
  List,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatThinking, ChatToolSteps } from "@/components/chat";
import { useMockChat, type MockMessage } from "@/hooks/use-mock-chat";
import { useDemoStore } from "@/stores/demo-store";
import { useDiffReviewStore } from "@/stores/diff-review-store";
import {
  DEMO_SCENARIOS,
  DEMO_DOCUMENT_CONTENT,
  type DemoScenario,
  type IconName,
} from "./demo-scenarios";
import { cn } from "@/lib/utils";
import { marked } from "marked";

// Map icon names to actual Lucide icons
const iconMap: Record<IconName, React.ComponentType<{ className?: string }>> = {
  wand: Wand2,
  "check-circle": CheckCircle,
  table: Table,
  "file-text": FileText,
  list: List,
};

function ScenarioIcon({ name, className }: { name: IconName; className?: string }) {
  const Icon = iconMap[name] || Sparkles;
  return <Icon className={className} />;
}

/**
 * Mobile Demo Chat Panel
 *
 * A bottom sheet style chat panel for mobile demo mode.
 * Shows as a collapsed bar that expands on tap.
 */
export function MobileDemoChatPanel() {
  const [isExpanded, setIsExpanded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const { initDemo } = useDemoStore();
  const { endDiffReview } = useDiffReviewStore();

  const {
    messages,
    isStreaming,
    currentTool,
    toolHistory,
    thinking,
    executeScenario,
    stopStreaming,
    clearMessages,
  } = useMockChat();

  // Auto-expand when streaming starts
  useEffect(() => {
    if (isStreaming && !isExpanded) {
      setIsExpanded(true);
    }
  }, [isStreaming, isExpanded]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (scrollAreaRef.current && isExpanded) {
      scrollAreaRef.current.scrollTo({
        top: scrollAreaRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages, currentTool, toolHistory, thinking, isExpanded]);

  const handleReset = () => {
    clearMessages();
    endDiffReview();
    initDemo(DEMO_DOCUMENT_CONTENT);
  };

  const handleScenarioClick = (scenario: DemoScenario) => {
    setIsExpanded(true);
    executeScenario(scenario);
  };

  return (
    <>
      {/* Collapsed bar */}
      <AnimatePresence>
        {!isExpanded && (
          <motion.div
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 100 }}
            className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card p-3"
            style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
          >
            <button
              onClick={() => setIsExpanded(true)}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary/10 py-3 text-sm font-medium text-primary"
            >
              <Sparkles className="h-4 w-4" />
              Try AI Features
              <ChevronUp className="h-4 w-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Expanded panel */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[70vh] flex-col rounded-t-2xl border-t border-border bg-card shadow-xl"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border p-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">AI Assistant</span>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                  Demo
                </span>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleReset}
                    disabled={isStreaming}
                    className="h-8 w-8"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsExpanded(false)}
                  className="h-8 w-8"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Messages */}
            <ScrollArea ref={scrollAreaRef} className="min-h-0 flex-1 p-3">
              {messages.length === 0 ? (
                <div className="py-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    Select an action below to see AI in action
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {messages.map((message) => (
                    <MobileMessageBubble key={message.id} message={message} />
                  ))}

                  {isStreaming && (thinking.isThinking || thinking.content) && (
                    <ChatThinking thinking={thinking} />
                  )}

                  {isStreaming && toolHistory.length > 0 && (
                    <ChatToolSteps tools={toolHistory} collapseThreshold={2} />
                  )}

                  <div ref={messagesEndRef} />
                </div>
              )}
            </ScrollArea>

            {/* Actions */}
            <div className="border-t border-border p-3">
              {isStreaming ? (
                <Button variant="outline" className="w-full" onClick={stopStreaming}>
                  <Square className="mr-2 h-4 w-4" />
                  Stop
                </Button>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {DEMO_SCENARIOS.map((scenario) => (
                    <button
                      key={scenario.id}
                      onClick={() => handleScenarioClick(scenario)}
                      className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
                    >
                      <ScenarioIcon name={scenario.icon} className="h-3 w-3" />
                      <span>{scenario.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Backdrop */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !isStreaming && setIsExpanded(false)}
            className="fixed inset-0 z-40 bg-black/50"
          />
        )}
      </AnimatePresence>
    </>
  );
}

// Mobile message bubble
function MobileMessageBubble({ message }: { message: MockMessage }) {
  const isUser = message.role === "user";

  // Parse markdown for assistant messages
  const htmlContent = useMemo(() => {
    if (isUser) return null;
    const content = message.content || (message.isStreaming ? "..." : "");
    return marked.parse(content, { async: false }) as string;
  }, [message.content, message.isStreaming, isUser]);

  return (
    <div className={cn("flex gap-2", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted"
        )}
      >
        {isUser ? "U" : <Sparkles className="h-3 w-3" />}
      </div>
      <div
        className={cn(
          "max-w-[80%] rounded-lg px-3 py-2 text-sm",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted"
        )}
      >
        {isUser ? (
          <p>{message.content}</p>
        ) : (
          <div
            className="prose prose-sm max-w-none dark:prose-invert [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
            dangerouslySetInnerHTML={{ __html: htmlContent || "" }}
          />
        )}
        {message.isStreaming && (
          <span className="ml-1 inline-block h-3 w-0.5 animate-pulse bg-current" />
        )}
      </div>
    </div>
  );
}
