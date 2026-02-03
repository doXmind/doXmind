"use client";

import { useRef, useEffect, useMemo } from "react";
import {
  Sparkles,
  Square,
  RotateCcw,
  ArrowRight,
  Wand2,
  CheckCircle,
  Table,
  FileText,
  List,
} from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip } from "@/components/ui/tooltip";
import { ThinkingIndicator } from "@/components/ai/thinking-indicator";
import { ToolHistoryList } from "@/components/ai/tool-history-list";
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
 * Demo Chat Panel
 *
 * A polished chat panel for demo mode with elegant action buttons
 * and diff display for AI edits.
 */
export function DemoChatPanel() {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const { initDemo } = useDemoStore();
  const { endDiffReview } = useDiffReviewStore();

  const {
    messages,
    isStreaming,
    toolHistory,
    thinking,
    executeScenario,
    stopStreaming,
    clearMessages,
  } = useMockChat();

  // Scroll to bottom when messages change
  const scrollToBottom = () => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTo({
        top: scrollAreaRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, toolHistory, thinking]);

  // Handle reset - clear messages, end diff review, and reset document
  const handleReset = () => {
    clearMessages();
    endDiffReview();
    initDemo(DEMO_DOCUMENT_CONTENT);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">AI Assistant</h2>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            Demo
          </span>
        </div>
        {messages.length > 0 && (
          <Tooltip content="Reset demo" side="bottom">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleReset}
              disabled={isStreaming}
              className="h-8 w-8"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </Tooltip>
        )}
      </div>

      {/* Messages */}
      <ScrollArea ref={scrollAreaRef} className="min-h-0 flex-1 p-4">
        {messages.length === 0 ? (
          <EmptyState onSelectScenario={executeScenario} disabled={isStreaming} />
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                scenario={
                  message.scenarioId
                    ? DEMO_SCENARIOS.find((s) => s.id === message.scenarioId)
                    : undefined
                }
              />
            ))}

            {/* Thinking indicator */}
            {isStreaming && (thinking.isThinking || thinking.content) && (
              <ThinkingIndicator thinking={thinking} />
            )}

            {/* Tool indicators */}
            {isStreaming && toolHistory.length > 0 && (
              <div className="ml-11">
                <ToolHistoryList tools={toolHistory} collapseThreshold={2} />
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      {/* Action buttons - only show when there are messages */}
      {messages.length > 0 && (
        <div className="border-t border-border p-4">
          {isStreaming ? (
            <Button variant="outline" className="w-full" onClick={stopStreaming}>
              <Square className="mr-2 h-4 w-4" />
              Stop generating
            </Button>
          ) : (
            <div className="space-y-3">
              <p className="text-center text-xs text-muted-foreground">Try another action:</p>
              <div className="flex flex-wrap justify-center gap-2">
                {DEMO_SCENARIOS.map((scenario) => (
                  <ActionPill
                    key={scenario.id}
                    scenario={scenario}
                    onClick={() => executeScenario(scenario)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Empty state with prominent action cards
function EmptyState({
  onSelectScenario,
  disabled,
}: {
  onSelectScenario: (scenario: DemoScenario) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center py-4">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Sparkles className="h-6 w-6 text-primary" />
        </div>
        <h3 className="mb-1 text-lg font-semibold">Try AI Editing</h3>
        <p className="text-sm text-muted-foreground">
          Select an action to see AI edit the document
        </p>
      </div>

      <div className="w-full space-y-2">
        {DEMO_SCENARIOS.map((scenario, index) => (
          <motion.button
            key={scenario.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            onClick={() => onSelectScenario(scenario)}
            disabled={disabled}
            className={cn(
              "group flex w-full items-center gap-3 rounded-lg border border-border p-3",
              "text-left transition-all duration-200",
              "hover:border-primary/50 hover:bg-accent",
              "disabled:cursor-not-allowed disabled:opacity-50"
            )}
          >
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-muted">
              <ScenarioIcon name={scenario.icon} className="h-4 w-4 text-muted-foreground" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-medium">{scenario.label}</div>
              <div className="text-xs text-muted-foreground">{scenario.description}</div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </motion.button>
        ))}
      </div>
    </div>
  );
}

// Small pill button for actions after initial selection
function ActionPill({ scenario, onClick }: { scenario: DemoScenario; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5",
        "text-xs font-medium transition-all duration-200",
        "hover:border-primary/50 hover:bg-accent"
      )}
    >
      <ScenarioIcon name={scenario.icon} className="h-3 w-3" />
      <span>{scenario.label}</span>
    </button>
  );
}

// Message bubble component with diff display
function MessageBubble({ message, scenario }: { message: MockMessage; scenario?: DemoScenario }) {
  const isUser = message.role === "user";

  // Parse markdown for assistant messages
  const htmlContent = useMemo(() => {
    if (isUser) return null;
    const content = message.content || (message.isStreaming ? "" : "");
    return marked.parse(content, { async: false }) as string;
  }, [message.content, message.isStreaming, isUser]);

  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      {/* Avatar */}
      <div
        className={cn(
          "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted"
        )}
      >
        {isUser ? (
          <span className="text-xs font-medium">You</span>
        ) : (
          <Sparkles className="h-4 w-4" />
        )}
      </div>

      {/* Content */}
      <div className={cn("max-w-[85%]", isUser ? "text-right" : "text-left")}>
        <div
          className={cn(
            "inline-block rounded-lg px-4 py-2",
            isUser ? "bg-primary text-primary-foreground" : "bg-muted"
          )}
        >
          {isUser ? (
            <p className="text-sm">{message.content}</p>
          ) : message.isStreaming && !message.content ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
              <span>Thinking...</span>
            </div>
          ) : (
            <div
              className="prose prose-sm max-w-none dark:prose-invert [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
              dangerouslySetInnerHTML={{ __html: htmlContent || "" }}
            />
          )}
          {message.isStreaming && message.content && (
            <span className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-current" />
          )}
        </div>

        {/* Note about pending changes in editor */}
        {!isUser && scenario?.edit && !message.isStreaming && message.content && (
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-block h-2 w-2 rounded-full bg-yellow-500" />
            <span>Review changes in the editor</span>
          </div>
        )}
      </div>
    </div>
  );
}
