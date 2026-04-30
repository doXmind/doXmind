/**
 * doXmind user guide document.
 */
export function getTutorialDocumentMarkdown(locale?: string): string {
  if (locale === "zh") return getTutorialDocumentMarkdownZh();
  return `# doXmind User Guide

Welcome to doXmind. The local desktop edition focuses on files, structured writing, databases, presentation, and export, with core work handled on your machine.

## 1. Start a Document

- Create a blank file from Home, start from a template, or import \.md / \.docx / \.pdf files.
- Organize projects with folders, and pin important docs to Favorites.

## 2. Editor Basics

- Type **/** to insert headings, lists, quotes, code blocks, callouts, math, Mermaid charts, tables, and more.
- Select text for format tools and block actions.
- Use **Ctrl/Cmd+F** for in-document find.

## 3. Databases

- Insert inline databases for tasks, research, contacts, and checklists.
- Use table and board views, properties, sorting, and filters.
- Import CSV data and keep editing it locally.

## 4. Search and Navigation

- **Ctrl/Cmd+K**: Command Palette.
- **Ctrl/Cmd+Tab**: Quick file switcher.
- **Ctrl/Cmd+F**: Find in current document.
- **Ctrl/Cmd+Shift+O**: Toggle outline.

## 5. Document Management

- Use folders for project structure.
- Use Version History to compare snapshots and restore.
- Export from the More menu as **Markdown**, **PDF**, or **Word**.

## 6. Presentation Mode

- Press **F5** (or click the toolbar button) to start presentation mode.
- Use **---** between sections to split slides.
- Use arrow keys to navigate and **Esc** to exit.

## 7. Outline and Mindlines

- **Ctrl/Cmd+Shift+O** toggles the outline panel.
- Use Outline / Mindlines to jump across structure quickly.

## 8. Personalization and Sharing

- Customize theme, typography, and editor width.
- Share read-only links for collaboration and review.

## 9. Recommended Workflow

1. Draft a rough outline.
2. Organize content with headings, callouts, tables, and databases.
3. Save important milestones with Version History.
4. Use Outline and Mindlines to review structure.
5. Present, export, or share.

## 10. Useful Shortcuts

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

欢迎使用 doXmind。本地桌面版专注于文件管理、结构化写作、数据库、演示和导出，核心工作都在本机完成。

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

## 3. 数据库与结构化内容

- 在文档中插入表格型数据库，管理任务、资料、联系人或清单；
- 支持表格、看板、属性、排序和筛选；
- 可从 CSV 导入数据并在本地继续整理。

## 4. 搜索与导航

- **Ctrl/Cmd+K**：打开命令面板；
- **Ctrl/Cmd+Tab**：快速切换最近文档；
- **Ctrl/Cmd+F**：文档内查找；
- **Ctrl/Cmd+Shift+O**：切换大纲侧栏。

## 5. 文档管理

- 支持文件夹与批量管理；
- 支持导入、模板创建、回收站恢复；
- 支持导出为 **Markdown**、**PDF**、**Word**。

## 6. 演示模式（Presentation Mode）

- 按 **F5** 或点击工具栏按钮进入演示模式；
- 使用 **---** 分隔线控制幻灯片切分；
- 方向键切换页面，按 **Esc** 退出演示。

## 7. 专注与导出

- 按 **F11** 进入专注模式；
- 在右上角更多菜单导出为 **Markdown**、**PDF** 或 **Word**。

## 8. 大纲与 Mindlines

- **Ctrl/Cmd+Shift+O** 可切换大纲侧栏；
- 用大纲和 Mindlines 快速浏览和跳转章节。

## 9. 个性化与分享

- 可自定义主题、排版、编辑器宽度与拼写检查；
- 可生成只读分享链接，便于他人查看与演示。

## 10. 推荐写作流程

1. 先用 3-5 分钟列出大纲；
2. 用标题、引用、表格和数据库组织内容；
3. 通过版本历史保存关键节点；
4. 用大纲和 Mindlines 检查结构；
5. 选择演示、导出或分享。

## 11. 常用快捷键

- **Ctrl/Cmd+K**：打开命令面板
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
