"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useDragControls, type PanInfo } from "framer-motion";
import {
  ChevronDown,
  SquarePen,
  History,
  X,
  Trash2,
  Loader2,
  RefreshCw,
  FileText,
  Pencil,
  BookOpen,
} from "lucide-react";
import { useGlobalAgentStore } from "@/stores/global-agent-store";
import { useGlobalAgentChat } from "@/hooks/use-global-agent-chat";
import { useAuthStore } from "@/stores/auth-store";
import { useLayoutStore } from "@/stores/layout-store";
import {
  ChatMessage,
  ChatMessageList,
  ChatComposer,
  ChatThinking,
  ChatToolSteps,
} from "@/components/chat";
import { AiLogoIcon } from "@/components/ui/ai-logo-icon";
import { cn } from "@/lib/utils";
import { MOBILE_SPRINGS, Z_INDEX } from "@/lib/constants";
import type { AffectedFile } from "@/types";
import type { GlobalConversationItem } from "@/lib/api/global-agent";

// =============================================================================
// Suggestions
// =============================================================================

interface Suggestion {
  label: string;
  prompt: string;
}

const SUGGESTION_POOL: Suggestion[] = [
  // File browsing & management
  {
    label: "What's in my workspace?",
    prompt: "List all my files and folders so I can see what I have",
  },
  {
    label: "Organize my files",
    prompt: "List my files and suggest how to organize them into folders by topic",
  },
  {
    label: "Clean up workspace",
    prompt: "List all my files and help me identify duplicates or ones I can archive",
  },
  {
    label: "Create from template",
    prompt: "Show me available writing templates and help me pick one to start a new document",
  },

  // Search & discovery
  {
    label: "Search my docs",
    prompt: "What documents do I have? Search across all of them and give me an overview",
  },
  {
    label: "Find something I wrote",
    prompt: "Help me find a document — I'll describe what it's about",
  },
  { label: "What did I write recently?", prompt: "Show me my most recently edited documents" },

  // Writing — create new
  {
    label: "Draft a blog post",
    prompt: "Help me create a new blog post document — I'll tell you the topic",
  },
  { label: "Write meeting notes", prompt: "Create a new structured meeting notes document for me" },
  { label: "Draft an email", prompt: "Help me draft a professional email in a new document" },
  {
    label: "Start a new project",
    prompt: "Help me plan and create documents for a new writing project",
  },
  {
    label: "Create a checklist",
    prompt: "Create a new document with a detailed checklist — I'll describe the project",
  },
  {
    label: "Brainstorm ideas",
    prompt: "Let's brainstorm together — help me generate ideas and save them to a new document",
  },

  // Research & web
  {
    label: "Research a topic",
    prompt: "Help me research a topic online and compile findings into a new document",
  },
  {
    label: "Find recent news",
    prompt: "Search the web for today's top news and create a summary document",
  },
  {
    label: "Compare perspectives",
    prompt: "Search the web for different viewpoints on a topic and summarize them",
  },

  // Community
  {
    label: "Explore community",
    prompt: "Show me popular documents in the community that I might find useful",
  },
  {
    label: "Get recommendations",
    prompt: "Recommend community documents based on what I've been writing about",
  },
  {
    label: "Find examples",
    prompt: "Search the community for well-written examples on a topic I'll describe",
  },

  // Data & analysis
  {
    label: "Analyze my data",
    prompt: "List my uploaded data files and help me pick one to analyze",
  },
  {
    label: "Create a chart",
    prompt: "Help me create a chart or visualization — show me my data files first",
  },
  { label: "Quick calculation", prompt: "Help me with a calculation or data analysis" },
];

const DISPLAY_COUNT = 4;

function pickRandomSuggestions(pool: Suggestion[], count: number): Suggestion[] {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// =============================================================================
// Sub-components
// =============================================================================

function ConversationDrawer({
  open,
  onClose,
  conversations,
  activeId,
  onSelect,
  onDelete,
  isLoading,
}: {
  open: boolean;
  onClose: () => void;
  conversations: GlobalConversationItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  isLoading: boolean;
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
            className="absolute bottom-0 right-0 top-0 z-50 flex w-[280px] flex-col border-l border-border/60 bg-background shadow-2xl"
          >
            <div className="flex items-center justify-between px-4 pb-3 pt-4">
              <h2 className="text-[15px] font-semibold">History</h2>
              <button
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/50" />
                </div>
              ) : conversations.length === 0 ? (
                <div className="px-4 py-12 text-center text-[13px] text-muted-foreground/60">
                  No conversations yet
                </div>
              ) : (
                <div className="space-y-0.5 px-2">
                  {conversations.map((conv) => (
                    <div
                      key={conv.id}
                      className={cn(
                        "group flex items-center gap-2 rounded-xl px-3 py-2.5 transition-colors",
                        conv.id === activeId
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                      )}
                    >
                      <button
                        onClick={() => {
                          onSelect(conv.id);
                          onClose();
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="truncate text-[13px] font-medium leading-snug">
                          {conv.lastMessage || "New conversation"}
                        </p>
                        {conv.createdAt && (
                          <p className="mt-0.5 text-[11px] text-muted-foreground/50">
                            {new Date(conv.createdAt).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </p>
                        )}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(conv.id);
                        }}
                        className="rounded-lg p-1 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function AgentEmptyState({
  suggestions,
  onSelectSuggestion,
  onRefresh,
}: {
  suggestions: Suggestion[];
  onSelectSuggestion: (prompt: string) => void;
  onRefresh: () => void;
}) {
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
    onRefresh();
  };

  return (
    <div className="flex h-full flex-col items-center justify-end px-5 pb-4">
      <motion.div
        className="flex flex-col items-center"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <AiLogoIcon
          size={36}
          className="mb-5 text-muted-foreground/25 dark:text-muted-foreground/40"
        />
        <h3 className="mb-1.5 text-[17px] font-semibold tracking-tight">What can I help with?</h3>
        <p className="mb-6 max-w-[260px] text-center text-[13px] leading-relaxed text-muted-foreground/60">
          I can search your documents, manage files, and more.
        </p>
      </motion.div>

      <motion.div
        className="w-full max-w-sm"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={refreshKey}
            className="grid grid-cols-2 gap-2"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.2 }}
          >
            {suggestions.map((s) => (
              <button
                key={s.prompt}
                type="button"
                onClick={() => onSelectSuggestion(s.prompt)}
                className="rounded-2xl border border-border/50 bg-card/60 px-3.5 py-3 text-left text-[12.5px] leading-snug text-foreground/80 transition-all hover:border-border hover:bg-card hover:shadow-sm active:scale-[0.97]"
              >
                {s.label}
              </button>
            ))}
          </motion.div>
        </AnimatePresence>

        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={handleRefresh}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] text-muted-foreground/50 transition-colors hover:bg-accent/50 hover:text-muted-foreground active:scale-95"
          >
            <RefreshCw className="h-3 w-3" />
            More suggestions
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function FileAttachments({ files }: { files: AffectedFile[] }) {
  const router = useRouter();
  const setAgentSheetOpen = useLayoutStore((s) => s.setAgentSheetOpen);

  if (files.length === 0) return null;

  const modified = files.filter((f) => f.action === "created" || f.action === "edited");
  const referenced = files.filter((f) => f.action === "referenced");

  const iconForAction = (action: AffectedFile["action"]) => {
    switch (action) {
      case "created":
        return <FileText className="h-3 w-3 text-green-500/70" />;
      case "edited":
        return <Pencil className="h-3 w-3 text-blue-500/70" />;
      case "referenced":
        return <BookOpen className="h-3 w-3 text-muted-foreground/60" />;
    }
  };

  const handleOpenFile = (fileId: string) => {
    setAgentSheetOpen(false);
    router.push(`/editor/${fileId}`);
  };

  return (
    <div className="mt-2 space-y-1.5">
      {modified.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {modified.map((file) => (
            <button
              key={file.fileId}
              onClick={() => handleOpenFile(file.fileId)}
              className="flex items-center gap-1.5 rounded-xl border border-border/50 bg-card/60 px-3 py-1.5 text-[12px] text-foreground/80 transition-all hover:border-border hover:bg-card hover:shadow-sm active:scale-[0.97]"
            >
              {iconForAction(file.action)}
              <span className="max-w-[180px] truncate">{file.fileName}</span>
            </button>
          ))}
        </div>
      )}
      {referenced.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground/40">Sources</span>
          {referenced.map((file) => (
            <button
              key={file.fileId}
              onClick={() => handleOpenFile(file.fileId)}
              className="flex items-center gap-1.5 rounded-xl border border-border/30 bg-muted/30 px-2.5 py-1 text-[11px] text-muted-foreground/70 transition-all hover:border-border/50 hover:bg-muted/50 hover:text-foreground/80 active:scale-[0.97]"
            >
              {iconForAction(file.action)}
              <span className="max-w-[160px] truncate">{file.fileName}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// AgentSheet — Bottom sheet with global agent chat
// =============================================================================

export function AgentSheet() {
  const [mounted, setMounted] = useState(false);
  const { isAgentSheetOpen, setAgentSheetOpen } = useLayoutStore();
  const { user, isInitialized } = useAuthStore();
  const dragControls = useDragControls();

  const [input, setInput] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const messageListRef = useRef<{ scrollToBottom: () => void }>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>(() =>
    pickRandomSuggestions(SUGGESTION_POOL, DISPLAY_COUNT)
  );
  const hasInitializedRef = useRef(false);

  const {
    conversations,
    activeConversationId,
    conversationList,
    isLoadingList,
    isLoadingMessages,
    loadConversationList,
    loadConversation,
    createConversation,
    deleteConversation,
  } = useGlobalAgentStore();

  const { sendMessage, stop, isStreaming, toolHistory, thinking } = useGlobalAgentChat();

  const activeConversation = activeConversationId ? conversations[activeConversationId] : null;
  const messages = activeConversation?.messages || [];

  useEffect(() => {
    setMounted(true);
  }, []);

  const refreshSuggestions = useCallback(() => {
    setSuggestions(pickRandomSuggestions(SUGGESTION_POOL, DISPLAY_COUNT));
  }, []);

  // Initialize conversations when sheet opens for the first time
  useEffect(() => {
    if (!isAgentSheetOpen || !isInitialized || !user || hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    loadConversationList().then(() => {
      const list = useGlobalAgentStore.getState().conversationList;
      if (list.length > 0) {
        loadConversation(list[0].id);
      } else {
        createConversation();
      }
    });
  }, [
    isAgentSheetOpen,
    isInitialized,
    user,
    loadConversationList,
    loadConversation,
    createConversation,
  ]);

  // Body scroll lock
  useEffect(() => {
    if (isAgentSheetOpen) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isAgentSheetOpen]);

  const handleClose = useCallback(() => {
    setAgentSheetOpen(false);
  }, [setAgentSheetOpen]);

  const handleDragEnd = useCallback(
    (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      if (info.offset.y > 100 || info.velocity.y > 300) {
        handleClose();
      }
    },
    [handleClose]
  );

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    let convId = activeConversationId;
    if (!convId) {
      convId = await createConversation();
    }

    setInput("");
    sendMessage(trimmed, convId);
  }, [input, isStreaming, activeConversationId, createConversation, sendMessage]);

  const handleSuggestion = useCallback(
    async (prompt: string) => {
      if (isStreaming) return;

      let convId = activeConversationId;
      if (!convId) {
        convId = await createConversation();
      }

      setInput("");
      sendMessage(prompt, convId);
    },
    [isStreaming, activeConversationId, createConversation, sendMessage]
  );

  const handleNewConversation = useCallback(async () => {
    if (isStreaming) return;
    await createConversation();
  }, [isStreaming, createConversation]);

  const handleSelectConversation = useCallback(
    (id: string) => {
      if (isStreaming) return;
      loadConversation(id);
    },
    [isStreaming, loadConversation]
  );

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      await deleteConversation(id);
      const list = useGlobalAgentStore.getState().conversationList;
      if (list.length > 0) {
        loadConversation(list[0].id);
      } else {
        createConversation();
      }
    },
    [deleteConversation, loadConversation, createConversation]
  );

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {isAgentSheetOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0"
            style={{ zIndex: Z_INDEX.MODAL - 1 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={handleClose}
            aria-hidden="true"
          >
            <div className="h-full w-full bg-black/40 dark:bg-black/60" />
          </motion.div>

          {/* Bottom sheet */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="AI Agent"
            className="fixed inset-x-0 bottom-0 flex flex-col overflow-hidden rounded-t-2xl border-t border-border bg-background shadow-2xl focus:outline-none"
            style={{
              zIndex: Z_INDEX.MODAL,
              height: "95dvh",
            }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", ...MOBILE_SPRINGS.SMOOTH }}
            drag="y"
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.05, bottom: 0.3 }}
            onDragEnd={handleDragEnd}
            dragListener={false}
          >
            {/* Drag handle */}
            <div
              className="flex shrink-0 cursor-grab touch-none justify-center pb-1 pt-2.5 active:cursor-grabbing"
              onPointerDown={(e) => dragControls.start(e)}
            >
              <div className="h-1 w-10 rounded-full bg-border" />
            </div>

            {/* Header */}
            <header className="relative z-10 flex flex-shrink-0 items-center justify-between px-2 pb-2">
              <button
                onClick={handleClose}
                className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-95"
                aria-label="Close agent"
              >
                <ChevronDown className="h-5 w-5" />
              </button>
              <div className="flex items-center gap-2">
                <AiLogoIcon size={18} className="text-foreground/70" />
                <span className="text-[15px] font-semibold tracking-tight">Agent</span>
              </div>
              <div className="flex items-center gap-0">
                <button
                  onClick={handleNewConversation}
                  disabled={isStreaming}
                  className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-95 disabled:opacity-40"
                  aria-label="New conversation"
                >
                  <SquarePen className="h-[18px] w-[18px]" />
                </button>
                <button
                  onClick={() => setDrawerOpen(true)}
                  className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-95"
                  aria-label="Conversation history"
                >
                  <History className="h-[18px] w-[18px]" />
                </button>
              </div>
            </header>

            {/* Messages area */}
            <div className="flex min-h-0 flex-1 flex-col">
              {isLoadingMessages ? (
                <div className="flex flex-1 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/40" />
                </div>
              ) : messages.length === 0 ? (
                <AgentEmptyState
                  suggestions={suggestions}
                  onSelectSuggestion={handleSuggestion}
                  onRefresh={refreshSuggestions}
                />
              ) : (
                <ChatMessageList
                  ref={messageListRef}
                  scrollDeps={[messages.length, messages[messages.length - 1]?.content, thinking]}
                >
                  <div className="mx-auto max-w-2xl space-y-1 px-4 py-4">
                    {messages.map((msg) => (
                      <div key={msg.id}>
                        <ChatMessage
                          role={msg.role}
                          content={msg.content}
                          isStreaming={msg.isStreaming}
                        />
                        {msg.role === "assistant" &&
                          !msg.isStreaming &&
                          msg.affectedFiles &&
                          msg.affectedFiles.length > 0 && (
                            <FileAttachments files={msg.affectedFiles} />
                          )}
                      </div>
                    ))}

                    {isStreaming && (thinking.isThinking || thinking.content) && (
                      <ChatThinking thinking={thinking} className="ml-0" />
                    )}

                    {isStreaming && toolHistory.length > 0 && (
                      <ChatToolSteps tools={toolHistory} className="ml-0" />
                    )}
                  </div>
                </ChatMessageList>
              )}
            </div>

            {/* Composer */}
            <div
              className="flex-shrink-0 px-3 pt-2"
              style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
            >
              <ChatComposer
                value={input}
                onChange={setInput}
                onSubmit={handleSend}
                onStop={stop}
                isStreaming={isStreaming}
                placeholder="Ask the agent anything..."
                disabled={isLoadingMessages}
              />
            </div>

            {/* Conversation history drawer (inside sheet) */}
            <ConversationDrawer
              open={drawerOpen}
              onClose={() => setDrawerOpen(false)}
              conversations={conversationList}
              activeId={activeConversationId}
              onSelect={handleSelectConversation}
              onDelete={handleDeleteConversation}
              isLoading={isLoadingList}
            />
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
