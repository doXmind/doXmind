/**
 * doXmind user guide document.
 */
export function getTutorialDocumentMarkdown(locale?: string): string {
  if (locale === "zh") return getTutorialDocumentMarkdownZh();
  return `# doXmind User Guide

Welcome to doXmind. This guide covers every core feature so you can go from first idea to final output quickly and clearly.

## 1. Start a Document

- Create a blank file from Home, start from a template, or import \.md / \.docx / \.pdf files.
- Organize projects with folders, and pin important docs to Favorites.

## 2. Editor Basics

- Type **/** to insert headings, lists, quotes, code blocks, callouts, and more.
- Select text for format tools and block actions.
- Use **Ctrl/Cmd+F** for in-document find.

## 3. Inline AI (In-Editor AI)

- On an empty new line, press **Space** to open Inline AI in write mode.
- Select text and press **Ctrl/Cmd+J** to ask or edit in place.
- You can also right-click selected text and choose **Ask Inline AI**.
- Inline AI works directly in the editor, so you can review and keep editing without switching context.

## 4. Quick Edit

- Select any text to run instant rewrites (improve, simplify, shorten, expand, adjust tone, translate).

## 5. AI Autocomplete

- AI suggests continuations while you type.
- Press **Tab** to accept a full suggestion.
- Press **Ctrl+Space** to accept word-by-word.
- Press **Esc** to dismiss a suggestion.
- Press **Alt+/** to trigger autocomplete manually.
- Press **Ctrl+Shift+Space** to force long-form completion.

## 6. AI Chat Collaboration

Use the right panel or floating input as your writing copilot for:

- outlining,
- rewriting,
- summarizing,
- translating,
- brainstorming,
- style alignment.

Tip: include audience, tone, and target length in prompts for better first drafts.

## 7. Diff Review

- When AI proposes edits, review changes in diff mode and accept/reject line by line or in bulk.

## 8. Attachments and Context

- Upload files or images in chat to provide session context.
- Ask for output in a specific format (for example: "Give me conclusion + evidence").

## 9. Search and Navigation

- **Ctrl/Cmd+K**: Command Palette.
- **Ctrl/Cmd+Tab**: Quick file switcher.
- **Ctrl/Cmd+Shift+F**: Semantic search.
- **Ctrl/Cmd+F**: Find in current document.

## 10. Document Management

- Use folders for project structure.
- Use Version History to compare snapshots and restore.
- Export from the More menu as **Markdown**, **PDF**, or **Word**.

## 11. Presentation Mode

- Press **F5** (or click the toolbar button) to start presentation mode.
- Use **---** between sections to split slides.
- You can present the original content or generate an AI-simplified presentation version.
- Use arrow keys to navigate and **Esc** to exit.

## 12. Outline, Mindlines, and Review

- **Ctrl/Cmd+Shift+O** toggles the outline panel.
- Use Outline / Mindlines to jump across structure quickly.
- Run Writing Review for structure, clarity, and readability checks.

## 13. Personalization and Sharing

- Customize theme, typography, editor width, and spellcheck.
- Share read-only links for collaboration and review.

## 14. Recommended Workflow

1. Draft a rough outline.
2. Expand sections with Inline AI, chat, or autocomplete.
3. Refine key paragraphs with Quick Edit.
4. Review diffs and run Writing Review.
5. Present, export, or share.

## 15. Useful Shortcuts

- **Ctrl+K**: open quick switcher
- **Ctrl+F**: find in document
- **Ctrl+/**: open shortcuts panel
- **F11**: toggle Focus Mode

---

You can keep this guide as a reference or delete it anytime.
`;
}

function getTutorialDocumentMarkdownZh(): string {
  return `# 欢迎使用 doXmind

欢迎使用 doXmind。本指南覆盖完整功能清单与推荐工作流，帮助你从写作到演示一站完成。

## 1. 快速开始

- 在首页新建空白文档，或直接从模板开始；
- 支持导入 \`.md\`、\`.docx\`、\`.pdf\` 文件继续编辑；
- 用文件夹管理项目，用收藏固定高频文档。

## 2. 编辑器核心能力

### 斜杠命令

输入 **/** 可快速插入标题、列表、引用、代码块等常用内容块。

### 基础编辑与查找

- 支持常用文本格式与块级操作；
- 可通过右键菜单快速操作当前内容；
- 按 **Ctrl/Cmd+F** 在文档内快速查找。

### 文档管理与回溯

- **版本历史**：查看并恢复历史版本；
- **大纲 / Mindlines**：快速定位章节结构；
- **文档内搜索**：快速找到关键词位置。

## 3. Inline AI（内联 AI）

- 在空白新行按 **Space** 可打开内联 AI（写入模式）；
- 选中文本后按 **Ctrl/Cmd+J** 可直接发起内联提问或改写；
- 也可右键选中文本，使用 **Ask Inline AI**；
- 内联 AI 在编辑区原位工作，减少来回切换。

## 4. 快捷编辑

选中文本后可一键执行润色、精简、扩写、改写语气、翻译等操作。

## 5. AI 自动补全

- AI 会在写作过程中实时给出续写建议；
- 按 **Tab** 接受整段建议；
- 按 **Ctrl+Space** 逐词接受；
- 按 **Esc** 取消建议。
- 按 **Alt+/** 手动触发自动补全；
- 按 **Ctrl/Cmd+Shift+Space** 强制触发长文补全。

## 6. AI 对话协作

右侧 AI 对话面板可用于：

- 生成大纲，
- 改写段落，
- 总结文档，
- 翻译内容，
- 头脑风暴，
- 统一全文语气。

建议在提问时明确目标读者、语气和篇幅，例如“面向产品经理，800 字，专业但易读”。

## 7. Diff 审阅

当 AI 生成修改时，可在差异审阅中逐条接受/拒绝，也可批量处理。

## 8. 附件与上下文

你可以在对话框中上传文件或图片，作为当前会话的上下文信息，帮助 AI 更贴合你的素材进行写作与改写。

建议：

- 上传结构清晰、信息完整的素材；
- 提问时说明任务范围和输出格式；
- 让 AI 按“结论 + 依据”输出，便于核对。

## 9. 搜索与导航

- **Ctrl/Cmd+K**：打开命令面板；
- **Ctrl/Cmd+Tab**：快速切换最近文档；
- **Ctrl/Cmd+Shift+F**：语义搜索；
- **Ctrl/Cmd+F**：文档内查找。

## 10. 文档管理

- 支持文件夹与批量管理；
- 支持导入、模板创建、回收站恢复；
- 支持导出为 **Markdown**、**PDF**、**Word**。

## 11. 演示模式（Presentation Mode）

- 按 **F5** 或点击工具栏按钮进入演示模式；
- 使用 **---** 分隔线控制幻灯片切分；
- 可选择原文演示，或生成 AI 简化演示版本；
- 方向键切换页面，按 **Esc** 退出演示。

## 12. 审阅、专注与导出

- **写作审阅**：用 AI 检查结构、表达和可读性；
- 按 **F11** 进入专注模式；
- 在右上角更多菜单导出为 **Markdown**、**PDF** 或 **Word**。

## 13. 大纲与 Mindlines

- **Ctrl/Cmd+Shift+O** 可切换大纲侧栏；
- 用大纲和 Mindlines 快速浏览和跳转章节。

## 14. 个性化与分享

- 可自定义主题、排版、编辑器宽度与拼写检查；
- 可生成只读分享链接，便于他人查看与演示。

## 15. 推荐写作流程

1. 先用 3-5 分钟列出大纲；
2. 用内联 AI、自动补全或对话扩写每一段；
3. 用快捷编辑打磨重点段落；
4. 用 Diff 审阅和写作审阅完成最后检查；
5. 选择演示、导出或分享。

## 16. 常用快捷键

- **Ctrl/Cmd+K**：打开命令面板
- **Ctrl/Cmd+J**：打开内联 AI（基于当前选区/光标）
- **Ctrl/Cmd+F**：文档内搜索
- **Ctrl/Cmd+/**：查看快捷键面板
- **F5**：开始演示
- **F11**：切换专注模式

---

这篇使用指南会自动出现在你的文件列表中，可随时保留或删除。
`;
}

export const TUTORIAL_DOCUMENT_FILENAME = "doXmind User Guide.md";
export const TUTORIAL_DOCUMENT_FILENAME_ZH = "doXmind 使用指南.md";
