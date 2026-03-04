/**
 * Interactive tutorial document for the onboarding workflow.
 * Content is designed so each section naturally triggers a specific onboarding step.
 */
export function getTutorialDocumentMarkdown(locale?: string): string {
  if (locale === "zh") return getTutorialDocumentMarkdownZh();
  return `# Welcome to doXmind

Your AI writing assistant is ready. Follow the guided prompts to explore every feature — it only takes about 5 minutes.

## AI Autocomplete

The best part of doXmind is that AI writes alongside you in real time. Place your cursor at the end of this paragraph and wait a moment — ghost text will appear. Artificial intelligence has transformed the way we

> Press **Tab** to accept the full suggestion, **Ctrl+Space** for word-by-word, or **Esc** to dismiss.

## Slash Commands

Slash commands let you insert any type of content block instantly. Click on the empty line below and type \`/\` to open the block menu. Try inserting a heading, list, callout, or code block.



## Quick Edit

Select the sentence below, then pick an action from the popup menu that appears (like **Simplify**, **Improve Writing**, or **Make Concise**):

The implementation of the new system was done in a way that was not very efficient and could have been significantly improved by using better algorithms and data structures that would have reduced the overall computational complexity of the solution.

## AI Chat

The chat panel on the right is your AI writing partner. You can ask it to rewrite sections, summarize your document, translate text, brainstorm ideas, or answer research questions.

### Knowledge Base

Upload reference PDFs and documents through the attachment icon in the chat input — the AI will search and cite them when answering your questions. Perfect for research papers, technical docs, and long-form writing projects.

## Document Navigation

### Outline & Mindlines

The sidebar's Outline tab shows your document structure at a glance. Click any heading to jump directly to that section. You can also open the Mindmap view for a visual overview of your document's structure.

### Version History

Every edit is automatically versioned. Open the More menu (**\u2026**) in the header and click **Version History** to browse previous versions, compare changes, and restore any version with one click.

## Writing Environment

### Focus Mode

Press **F11** to enter distraction-free Focus Mode. All panels and toolbars hide so you can concentrate on your words. Press **F11** again to return to the full interface.

### Export

When you're ready to share, open the More menu (**\u2026**) in the header to export your document as **Markdown**, **PDF**, or **Word**.

---

## What's Next?

- **Keyboard shortcuts** — Press **Ctrl+/** to see all available shortcuts
- **Themes** — Toggle dark mode from the header menu
- **Templates** — Create new documents from built-in templates on the home page
- **Drag & drop** — Import files by dragging them into the editor

*This tutorial document can be deleted anytime. Enjoy writing with doXmind!*
`;
}

function getTutorialDocumentMarkdownZh(): string {
  return `# 欢迎使用 doXmind

你的 AI 写作助手已就绪。跟随引导提示探索所有功能，只需大约 5 分钟。

## AI 自动补全

doXmind 最强大的功能是 AI 会实时陪你一起写作。将光标放在本段末尾，稍等片刻，幽灵文字就会出现。人工智能已经从根本上改变了我们

> 按 **Tab** 接受完整建议，**Ctrl+Space** 逐词接受，或按 **Esc** 取消。

## 斜杠命令

斜杠命令让你可以快速插入任何类型的内容块。点击下面的空行，输入 \`/\` 打开块菜单。试着插入标题、列表、提示框或代码块。



## 快捷编辑

选中下面的句子，然后从弹出菜单中选择一个操作（如**精简**、**润色**或**缩写**）：

这个新系统的实现方式不是很高效，如果使用更好的算法和数据结构，本可以显著改善整体方案的计算复杂度，从而大幅提升系统的运行效率和响应速度。

## AI 对话

右侧的对话面板是你的 AI 写作伙伴。你可以让它改写段落、总结文档、翻译文本、头脑风暴或回答研究问题。

### 知识库

通过对话输入框的附件图标上传参考 PDF 和文档，AI 会在回答问题时搜索并引用它们。非常适合研究论文、技术文档和长篇写作项目。

## 文档导航

### 大纲与思维导图

侧边栏的大纲标签可以一目了然地查看文档结构。点击任意标题即可直接跳转到对应章节。你也可以打开思维导图视图，以可视化方式总览文档结构。

### 版本历史

每次编辑都会自动保存版本。打开顶部的更多菜单（**\u2026**），点击**版本历史**即可浏览历史版本、对比差异，一键恢复到任意版本。

## 写作环境

### 专注模式

按 **F11** 进入无干扰的专注模式。所有面板和工具栏都会隐藏，让你专注于写作。再次按 **F11** 返回完整界面。

### 导出

准备好分享时，打开顶部的更多菜单（**\u2026**），将文档导出为 **Markdown**、**PDF** 或 **Word** 格式。

---

## 接下来？

- **快捷键** — 按 **Ctrl+/** 查看所有可用快捷键
- **主题** — 从顶部菜单切换深色模式
- **模板** — 在首页使用内置模板创建新文档
- **拖放** — 直接将文件拖入编辑器即可导入

*本教程文档可随时删除。祝你用 doXmind 写作愉快！*
`;
}

export const TUTORIAL_DOCUMENT_FILENAME = "Getting Started with doXmind.md";
export const TUTORIAL_DOCUMENT_FILENAME_ZH = "doXmind 使用指南.md";
