import { SCORE_PREFIX, scoreFuzzyText } from "@/lib/fuzzy-match";

export type MarkdownSlashCommandId =
  | "text"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "bullet-list"
  | "numbered-list"
  | "task"
  | "quote"
  | "divider"
  | "code"
  | "table"
  | "image"
  | "equation"
  | "mermaid";

export interface MarkdownSlashCommand {
  id: MarkdownSlashCommandId;
  title: string;
  description: string;
  keywords: readonly string[];
  /** Toneless, space-free full pinyin for every Chinese keyword, so `/biaoti` finds Heading. */
  pinyin: readonly string[];
  /**
   * Pinyin initials plus the English title acronym, so `/bt` and `/h1` both find
   * Heading 1 and `/bl` finds "Bulleted list" ahead of the incidental "bl" in "Table".
   */
  initials: readonly string[];
  /** Name of a `lucide-react` export rendered as the row glyph. */
  icon: string;
  /** Markdown prefix the user could type instead, shown right-aligned on the row. */
  shortcut?: string;
}

const COMMANDS: readonly MarkdownSlashCommand[] = [
  {
    id: "text",
    title: "Text",
    description: "Plain paragraph",
    keywords: ["paragraph", "文本"],
    pinyin: ["wenben"],
    initials: ["wb"],
    icon: "Pilcrow",
  },
  {
    id: "heading-1",
    title: "Heading 1",
    description: "Large heading",
    keywords: ["h1", "标题"],
    pinyin: ["biaoti"],
    initials: ["bt", "h1"],
    icon: "Heading1",
    shortcut: "#",
  },
  {
    id: "heading-2",
    title: "Heading 2",
    description: "Medium heading",
    keywords: ["h2", "标题"],
    pinyin: ["biaoti"],
    initials: ["bt", "h2"],
    icon: "Heading2",
    shortcut: "##",
  },
  {
    id: "heading-3",
    title: "Heading 3",
    description: "Small heading",
    keywords: ["h3", "标题"],
    pinyin: ["biaoti"],
    initials: ["bt", "h3"],
    icon: "Heading3",
    shortcut: "###",
  },
  {
    id: "bullet-list",
    title: "Bulleted list",
    description: "Unordered list item",
    keywords: ["list", "bullet", "列表"],
    pinyin: ["liebiao", "wuxuliebiao"],
    initials: ["lb", "wxlb", "bl"],
    icon: "List",
    shortcut: "-",
  },
  {
    id: "numbered-list",
    title: "Numbered list",
    description: "Ordered list item",
    keywords: ["list", "ordered", "编号"],
    pinyin: ["bianhao", "youxuliebiao"],
    initials: ["bh", "yxlb", "nl"],
    icon: "ListOrdered",
    shortcut: "1.",
  },
  {
    id: "task",
    title: "To-do",
    description: "Task list item",
    keywords: ["task", "todo", "待办"],
    pinyin: ["daiban"],
    initials: ["db", "td"],
    icon: "ListChecks",
    shortcut: "- [ ]",
  },
  {
    id: "quote",
    title: "Quote",
    description: "Block quote",
    keywords: ["blockquote", "引用"],
    pinyin: ["yinyong"],
    initials: ["yy"],
    icon: "TextQuote",
    shortcut: ">",
  },
  {
    id: "divider",
    title: "Divider",
    description: "Thematic break",
    keywords: ["hr", "分隔线"],
    pinyin: ["fengexian"],
    initials: ["fgx"],
    icon: "Minus",
    shortcut: "---",
  },
  {
    id: "code",
    title: "Code",
    description: "Fenced code block",
    keywords: ["fence", "代码"],
    pinyin: ["daima"],
    initials: ["dm"],
    icon: "Code",
    shortcut: "```",
  },
  {
    id: "table",
    title: "Table",
    description: "Markdown table",
    keywords: ["grid", "表格"],
    pinyin: ["biaoge"],
    initials: ["bg"],
    icon: "Table",
  },
  {
    id: "image",
    title: "Image",
    description: "Local workspace image",
    keywords: ["picture", "asset", "图片", "图像"],
    pinyin: ["tupian", "tuxiang"],
    initials: ["tp", "tx"],
    icon: "Image",
  },
  {
    id: "equation",
    title: "Equation",
    description: "Block equation",
    keywords: ["math", "latex", "公式"],
    pinyin: ["gongshi"],
    initials: ["gs"],
    icon: "Sigma",
    // The delimiters both ways round, because that is what the user has to type to get an equation:
    // a lone `$$` is a paragraph whose text is `$$`, and the row used to advertise it as if it were
    // a shortcut.
    shortcut: "$$ $$",
  },
  {
    id: "mermaid",
    title: "Mermaid",
    description: "Local diagram",
    keywords: ["diagram", "流程图"],
    pinyin: ["liuchengtu"],
    initials: ["lct"],
    icon: "GitBranch",
  },
];

/**
 * Feishu-style relevance tiers. The insert panel puts the strongest match first
 * rather than listing declaration order, and a full-pinyin hit outranks an
 * incidental substring so `/biaoti` narrows to the Heading rows.
 */
const SCORE_INITIALS_EXACT = 90;
const SCORE_PINYIN_PREFIX = 70;
const SCORE_KEYWORD = 30;
const SCORE_DESCRIPTION = 10;

export function searchMarkdownSlashCommands(query: string): readonly MarkdownSlashCommand[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return COMMANDS;
  return COMMANDS.map((command, index) => ({
    command,
    index,
    score: scoreMarkdownSlashCommand(command, normalized),
  }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.command);
}

/**
 * Score is the maximum over every field. The checks run in descending tier
 * order, so the first hit is already that maximum.
 */
function scoreMarkdownSlashCommand(command: MarkdownSlashCommand, query: string): number {
  const title = command.title.toLocaleLowerCase();
  if (title.startsWith(query)) return SCORE_PREFIX;
  if (command.initials.some((entry) => entry.toLocaleLowerCase() === query)) {
    return SCORE_INITIALS_EXACT;
  }
  if (command.pinyin.some((entry) => entry.toLocaleLowerCase().startsWith(query))) {
    return SCORE_PINYIN_PREFIX;
  }
  // The declared pinyin and initials outrank a plain substring, so the shared tiers sit here
  // rather than at the top of the ladder.
  const text = scoreFuzzyText(title, query);
  if (text) return text;
  if (command.keywords.some((entry) => entry.toLocaleLowerCase().includes(query))) {
    return SCORE_KEYWORD;
  }
  if (command.description.toLocaleLowerCase().includes(query)) return SCORE_DESCRIPTION;
  return 0;
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
    case "divider":
      return "---";
    case "code":
      return ["```", "", "```"].join(lineEnding);
    case "table":
      return ["| Column 1 | Column 2 |", "| --- | --- |", "|  |  |"].join(lineEnding);
    case "image":
      return "![Image](assets/image.png)";
    case "equation":
      // One line, not the `$$`/blank/`$$` shape this used to write. A blank line is a Block
      // boundary, so that template parsed as two `$$` paragraphs and the command could not produce
      // an equation at all: typing into it only ever grew the first paragraph's literal `$$` text.
      // `$$ $$` is the same empty-equation shape `assembleFigureSource` collapses a cleared equation
      // to, it is a `block_math` Block the moment it lands, and it stays one as it is typed into.
      return "$$ $$";
    case "mermaid":
      return ["```mermaid", "flowchart LR", "  A --> B", "```"].join(lineEnding);
  }
}

/**
 * Caret offset inside the template returned by {@link markdownSlashCommandSource},
 * so `/code` lands on the empty body line instead of after the closing fence.
 * Every offset is derived from that same string rather than hardcoded.
 */
export function markdownSlashCommandCaret(
  id: MarkdownSlashCommandId,
  lineEnding: "\r\n" | "\n" | "\r" = "\n"
): number {
  const template = markdownSlashCommandSource(id, lineEnding);
  switch (id) {
    case "code":
    case "mermaid":
      return afterFirstLine(template, lineEnding);
    case "equation":
      return afterOpeningMathDelimiter(template);
    case "table":
      return firstCellOfLastRow(template, lineEnding);
    default:
      return template.length;
  }
}

/** Inside the delimiters of a one-line equation, where the formula goes. */
function afterOpeningMathDelimiter(template: string): number {
  const opening = template.indexOf("$$");
  return opening < 0 ? template.length : opening + "$$".length;
}

/** Start of the body line that follows an opening fence line. */
function afterFirstLine(template: string, lineEnding: "\r\n" | "\n" | "\r"): number {
  const breakAt = template.indexOf(lineEnding);
  return breakAt < 0 ? template.length : breakAt + lineEnding.length;
}

/** Inside the padded first cell of the template's trailing empty row. */
function firstCellOfLastRow(template: string, lineEnding: "\r\n" | "\n" | "\r"): number {
  const rowStart = template.lastIndexOf(lineEnding) + lineEnding.length;
  const pipe = template.indexOf("|", rowStart);
  if (pipe < 0) return template.length;
  const cell = pipe + 1;
  return template.startsWith(" ", cell) ? cell + 1 : cell;
}
