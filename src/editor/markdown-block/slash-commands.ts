import { markdownToggleTemplate } from "@/editor/markdown-block/markdown-toggle";

export type MarkdownSlashCommandId =
  | "text"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "bullet-list"
  | "numbered-list"
  | "task"
  | "quote"
  | "toggle"
  | "callout"
  | "divider"
  | "code"
  | "table"
  | "collection"
  | "collection-board"
  | "collection-calendar"
  | "image"
  | "equation"
  | "mermaid"
  | "wiki-link"
  | "embed";

export interface MarkdownSlashCommand {
  id: MarkdownSlashCommandId;
  title: string;
  description: string;
  keywords: readonly string[];
}

const COMMANDS: readonly MarkdownSlashCommand[] = [
  { id: "text", title: "Text", description: "Plain paragraph", keywords: ["paragraph", "文本"] },
  { id: "heading-1", title: "Heading 1", description: "Large heading", keywords: ["h1", "标题"] },
  { id: "heading-2", title: "Heading 2", description: "Medium heading", keywords: ["h2", "标题"] },
  { id: "heading-3", title: "Heading 3", description: "Small heading", keywords: ["h3", "标题"] },
  {
    id: "bullet-list",
    title: "Bulleted list",
    description: "Unordered list item",
    keywords: ["list", "bullet", "列表"],
  },
  {
    id: "numbered-list",
    title: "Numbered list",
    description: "Ordered list item",
    keywords: ["list", "ordered", "编号"],
  },
  { id: "task", title: "To-do", description: "Task list item", keywords: ["task", "todo", "待办"] },
  { id: "quote", title: "Quote", description: "Block quote", keywords: ["blockquote", "引用"] },
  {
    id: "toggle",
    title: "Toggle",
    description: "Portable collapsible details",
    keywords: ["details", "collapse", "折叠", "展开"],
  },
  {
    id: "callout",
    title: "Callout",
    description: "Portable note callout",
    keywords: ["note", "提示"],
  },
  { id: "divider", title: "Divider", description: "Thematic break", keywords: ["hr", "分隔线"] },
  { id: "code", title: "Code", description: "Fenced code block", keywords: ["fence", "代码"] },
  { id: "table", title: "Table", description: "Markdown table", keywords: ["grid", "表格"] },
  {
    id: "collection",
    title: "Collection table",
    description: "Table view of Pages by properties",
    keywords: ["database", "query", "table", "数据集", "数据库", "表格"],
  },
  {
    id: "collection-board",
    title: "Collection board",
    description: "Board grouped by a Page property",
    keywords: ["database", "kanban", "board", "看板"],
  },
  {
    id: "collection-calendar",
    title: "Collection calendar",
    description: "Calendar grouped by a Page date property",
    keywords: ["database", "calendar", "date", "日历"],
  },
  {
    id: "image",
    title: "Image",
    description: "Local workspace image",
    keywords: ["picture", "asset", "图片", "图像"],
  },
  {
    id: "equation",
    title: "Equation",
    description: "Block equation",
    keywords: ["math", "latex", "公式"],
  },
  {
    id: "mermaid",
    title: "Mermaid",
    description: "Local diagram",
    keywords: ["diagram", "流程图"],
  },
  {
    id: "wiki-link",
    title: "Wiki link",
    description: "Link to a Page",
    keywords: ["page", "link", "链接"],
  },
  {
    id: "embed",
    title: "Embed Page",
    description: "Read-only Page transclusion",
    keywords: ["transclude", "嵌入"],
  },
];

export function searchMarkdownSlashCommands(query: string): readonly MarkdownSlashCommand[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return COMMANDS;
  return COMMANDS.filter((command) =>
    [command.title, command.description, ...command.keywords].some((value) =>
      value.toLocaleLowerCase().includes(normalized)
    )
  );
}

export function markdownSlashCommandSource(
  id: MarkdownSlashCommandId,
  lineEnding: "\r\n" | "\n" | "\r" = "\n"
): string {
  switch (id) {
    case "text":
      return "";
    case "heading-1":
      return "# ";
    case "heading-2":
      return "## ";
    case "heading-3":
      return "### ";
    case "bullet-list":
      return "- ";
    case "numbered-list":
      return "1. ";
    case "task":
      return "- [ ] ";
    case "quote":
      return "> ";
    case "toggle":
      return markdownToggleTemplate(lineEnding);
    case "callout":
      return `> [!NOTE] Note${lineEnding}> `;
    case "divider":
      return "---";
    case "code":
      return ["```", "", "```"].join(lineEnding);
    case "table":
      return ["| Column 1 | Column 2 |", "| --- | --- |", "|  |  |"].join(lineEnding);
    case "collection":
      return collectionTemplate("table", lineEnding);
    case "collection-board":
      return collectionTemplate("board", lineEnding);
    case "collection-calendar":
      return collectionTemplate("calendar", lineEnding);
    case "image":
      return "![Image](assets/image.png)";
    case "equation":
      return ["$$", "", "$$"].join(lineEnding);
    case "mermaid":
      return ["```mermaid", "flowchart LR", "  A --> B", "```"].join(lineEnding);
    case "wiki-link":
      return "[[Page]]";
    case "embed":
      return "![[Page]]";
  }
}

function collectionTemplate(
  view: "table" | "board" | "calendar",
  lineEnding: "\r\n" | "\n" | "\r"
): string {
  const viewField =
    view === "board"
      ? ['  "groupBy": "status",']
      : view === "calendar"
        ? ['  "dateBy": "date",']
        : [];
  const columns = view === "board" ? ["status"] : view === "calendar" ? ["date"] : [];
  return [
    "```doxmind-collection",
    "{",
    '  "version": 2,',
    `  "view": "${view}",`,
    ...viewField,
    '  "filters": [],',
    `  "columns": ${JSON.stringify(columns)},`,
    '  "sort": []',
    "}",
    "```",
  ].join(lineEnding);
}
