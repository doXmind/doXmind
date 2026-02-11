/**
 * Welcome document content for new users.
 * Returns markdown that serves as both a tutorial and a real writing sample.
 */
export function getWelcomeDocumentMarkdown(): string {
  return `# Welcome to doXmind

Your AI-powered writing assistant is ready. Here's a quick tour of what you can do.

## Try AI Autocomplete

Place your cursor at the end of this sentence and pause for a moment

> AI will suggest a completion as ghost text. Press **Tab** to accept, or **Esc** to dismiss.

## Try Quick Edit

Select the sentence below, then choose an action from the menu that appears:

This is a sentence that could be improved with better word choice and more concise phrasing to make it clearer for the reader who wants to understand the main point quickly.

## Try Slash Commands

Click at the end of this line and type \`/\`

## Ask the AI Chat

Open the chat panel on the right and try asking:
- "Summarize this document"
- "Add a conclusion section"
- "Translate the first paragraph to Chinese"

## Keyboard Shortcuts

- **Ctrl+K** — Command palette (search files & actions)
- **Ctrl+B** — Bold, **Ctrl+I** — Italic
- **Ctrl+F** — Search in document
- **F11** — Focus mode (distraction-free writing)

---

You can delete this document anytime. Happy writing!
`;
}

export const WELCOME_DOCUMENT_FILENAME = "Welcome to doXmind.md";
