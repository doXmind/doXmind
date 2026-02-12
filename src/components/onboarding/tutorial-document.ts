/**
 * Interactive tutorial document for the onboarding workflow.
 * Content is designed so each section naturally triggers a specific onboarding step.
 */
export function getTutorialDocumentMarkdown(): string {
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

export const TUTORIAL_DOCUMENT_FILENAME = "Getting Started with doXmind.md";
