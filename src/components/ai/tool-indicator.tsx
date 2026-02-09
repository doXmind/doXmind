"use client";

import { motion } from "framer-motion";
import {
  Eye,
  Search,
  Replace,
  FileEdit,
  Check,
  AlertCircle,
  Loader2,
  Sparkles,
  BookOpen,
  Globe,
  Link2,
  Wand2,
  FileText,
  Scale,
  Terminal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolStatus } from "@/hooks/use-chat";

/**
 * Get icon component for a tool type
 */
function getToolIcon(toolName: string) {
  switch (toolName) {
    // Document tools
    case "view_document":
      return Eye;
    case "str_replace_editor":
      return Replace;
    case "insert_text":
      return FileEdit;
    case "replace_document":
      return FileEdit;
    case "search_in_document":
      return Search;
    case "apply_edits":
      return Check;
    // Knowledge base tools
    case "search_knowledge_base":
      return BookOpen;
    case "read_kb_document":
      return BookOpen;
    case "list_kb_documents":
      return BookOpen;
    // Web tools
    case "web_search":
      return Globe;
    case "web_fetch":
      return Link2;
    // Skill tools
    case "list_skills":
      return Wand2;
    case "read_skill_instructions":
      return Wand2;
    case "read_skill_template":
      return FileText;
    case "read_skill_knowledge":
      return BookOpen;
    // Legal tools
    case "search_court_opinions":
      return Scale;
    case "get_court_opinion":
      return Scale;
    // Code execution tool
    case "code_execution":
    case "Code Execution":
    case "bash_code_execution":
      return Terminal;
    // Web tools (display names)
    case "Web Search":
      return Globe;
    case "Web Fetch":
      return Link2;
    default:
      return Sparkles;
  }
}

/**
 * Get display name for a tool
 */
function getToolDisplayName(toolName: string) {
  switch (toolName) {
    // Document tools
    case "view_document":
      return "Reading document";
    case "str_replace_editor":
      return "Editing text";
    case "insert_text":
      return "Inserting text";
    case "replace_document":
      return "Replacing document";
    case "search_in_document":
      return "Searching document";
    case "apply_edits":
      return "Applying changes";
    // Knowledge base tools
    case "search_knowledge_base":
      return "Searching knowledge base";
    case "read_kb_document":
      return "Reading KB document";
    case "list_kb_documents":
      return "Listing KB documents";
    // Web tools
    case "web_search":
      return "Searching the web";
    case "web_fetch":
      return "Fetching URL";
    // Skill tools
    case "list_skills":
      return "Listing skills";
    case "read_skill_instructions":
      return "Loading skill";
    case "read_skill_template":
      return "Loading template";
    case "read_skill_knowledge":
      return "Loading knowledge";
    // Legal tools
    case "search_court_opinions":
      return "Searching court cases";
    case "get_court_opinion":
      return "Reading court opinion";
    // Code execution tool
    case "code_execution":
    case "Code Execution":
    case "bash_code_execution":
      return "Running code";
    // Web tools (display names)
    case "Web Search":
      return "Searching the web";
    case "Web Fetch":
      return "Fetching URL";
    default:
      // Format unknown tools: snake_case -> Title Case
      return toolName
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
  }
}

/** Status-based styling configuration */
const STATUS_STYLES = {
  running: {
    bg: "rgba(59, 130, 246, 0.1)",
    border: "rgba(59, 130, 246, 0.3)",
    text: "text-blue-600 dark:text-blue-400",
  },
  completed: {
    bg: "rgba(34, 197, 94, 0.1)",
    border: "rgba(34, 197, 94, 0.3)",
    text: "text-green-600 dark:text-green-400",
  },
  error: {
    bg: "rgba(239, 68, 68, 0.1)",
    border: "rgba(239, 68, 68, 0.3)",
    text: "text-red-600 dark:text-red-400",
  },
} as const;

interface ToolIndicatorProps {
  tool: ToolStatus;
}

/**
 * Tool status indicator component that displays tool execution state.
 * Similar to Claude's tool usage display.
 */
export function ToolIndicator({ tool }: ToolIndicatorProps) {
  const Icon = getToolIcon(tool.name);
  const displayName = getToolDisplayName(tool.name);
  const currentStyle = STATUS_STYLES[tool.status] || STATUS_STYLES.running;

  return (
    <motion.div
      initial={{ opacity: 0, y: 5, scale: 0.98 }}
      animate={{
        opacity: 1,
        y: 0,
        scale: 1,
        backgroundColor: currentStyle.bg,
        borderColor: currentStyle.border,
      }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      className={cn(
        "flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm md:px-3 md:py-2",
        currentStyle.text
      )}
    >
      {tool.status === "running" && (
        <>
          <div className="relative">
            <Icon className="h-4 w-4 flex-shrink-0" />
            <motion.span
              className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-blue-500"
              animate={{
                scale: [1, 1.2, 1],
                opacity: [1, 0.7, 1],
              }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
            />
          </div>
          <span className="truncate font-medium">{displayName}...</span>
          <Loader2 className="ml-auto h-3 w-3 animate-spin" />
        </>
      )}
      {tool.status === "completed" && (
        <>
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 15 }}
          >
            <Icon className="h-4 w-4 flex-shrink-0" />
          </motion.div>
          <span className="truncate">{tool.message || displayName}</span>
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 15, delay: 0.1 }}
          >
            <Check className="ml-auto h-3 w-3" />
          </motion.div>
        </>
      )}
      {tool.status === "error" && (
        <>
          <motion.div animate={{ x: [0, -2, 2, -2, 0] }} transition={{ duration: 0.4 }}>
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
          </motion.div>
          <span className="truncate">{tool.message || "Error"}</span>
        </>
      )}
    </motion.div>
  );
}
