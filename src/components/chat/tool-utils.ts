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
  Scale,
  Terminal,
  ListTodo,
} from "lucide-react";

/**
 * Get icon component for a tool type
 */
export function getToolIcon(toolName: string) {
  switch (toolName) {
    // Document tools
    case "view_document":
      return Eye;
    case "str_replace_editor":
      return Replace;
    case "insert_text":
    case "replace_document":
      return FileEdit;
    case "search_in_document":
      return Search;
    case "apply_edits":
      return Check;
    // Knowledge base tools
    case "search_knowledge_base":
    case "read_kb_document":
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
    // Legal tools
    case "search_court_opinions":
    case "get_court_opinion":
      return Scale;
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
