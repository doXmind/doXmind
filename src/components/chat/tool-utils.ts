import {
  Eye,
  Search,
  Replace,
  FileEdit,
  Check,
  Sparkles,
  BookOpen,
  Globe,
  Link2,
  Wand2,
  FileText,
  Terminal,
  ListTodo,
} from "lucide-react";

/**
 * Get icon component for a tool type
 */
export function getToolIcon(toolName: string) {
  switch (toolName) {
    // Unified document tools
    case "get_outline":
      return Eye;
    case "read_content":
      return Eye;
    case "search":
      return Search;
    // Edit tools
    case "str_replace_editor":
      return Replace;
    case "insert_text":
    case "replace_document":
      return FileEdit;
    case "apply_edits":
      return Check;
    // Knowledge base tools
    case "list_kb_documents":
    case "read_skill_knowledge":
      return BookOpen;
    // Web tools
    case "web_search":
    case "Web Search":
      return Globe;
    case "web_fetch":
    case "Web Fetch":
      return Link2;
    // Skill tools
    case "list_skills":
    case "read_skill_instructions":
      return Wand2;
    case "read_skill_template":
      return FileText;
    // Code execution tool
    case "code_execution":
    case "Code Execution":
    case "bash_code_execution":
      return Terminal;
    // Todo tool
    case "TodoWrite":
      return ListTodo;
    default:
      return Sparkles;
  }
}

/**
 * Get display name for a tool
 */
export function getToolDisplayName(toolName: string) {
  switch (toolName) {
    // Unified document tools
    case "get_outline":
      return "Reading outline";
    case "read_content":
      return "Reading content";
    case "search":
      return "Searching";
    // Edit tools
    case "str_replace_editor":
      return "Editing text";
    case "insert_text":
      return "Inserting text";
    case "replace_document":
      return "Replacing document";
    case "apply_edits":
      return "Applying changes";
    // Knowledge base tools
    case "list_kb_documents":
      return "Listing KB documents";
    // Web tools
    case "web_search":
    case "Web Search":
      return "Searching the web";
    case "web_fetch":
    case "Web Fetch":
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
    // Code execution tool
    case "code_execution":
    case "Code Execution":
    case "bash_code_execution":
      return "Running code";
    // Todo tool
    case "TodoWrite":
      return "Updating tasks";
    default:
      // Format unknown tools: snake_case -> Title Case
      return toolName
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
  }
}
