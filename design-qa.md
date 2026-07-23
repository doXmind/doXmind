# Block editor design QA

## Evidence

- Reference target: `/Users/wangzhangwu/.codex/generated_images/019f85a3-4c9d-7ea0-9229-6b3537339fe5/call_q2lpkXGYTSjZInwx3fOWHC79.png`
- Packaged Electron capture: `test-results/electron-gui-acceptance/block-editor-parity.png`
- Same-state comparison: `test-results/electron-gui-acceptance/block-editor-visual-comparison.png`

## Visual acceptance

- The active Block is seamless: no textarea border, focus ring, permanent type selector, or right-side action strip.
- Hover exposes only the left add control and six-dot grip; the row background settles to fully transparent before evidence capture.
- Selected text uses native selection color and a compact toolbar positioned above the selection with a verified minimum gap.
- The toolbar provides direct Block type, bold, italic, strike, link, code, and more actions with Lucide icons.
- Supported inline Markdown is rendered semantically while editing; source delimiters stay hidden without becoming HTML state.
- Heading rhythm, body leading, divider contrast, nested-list indentation, and dark-theme contrast remain readable and calm.
- The compact six-dot menu, searchable Turn into view, and type dropdown are usable by mouse and keyboard.

## Interaction acceptance

- Block selection supports Escape, Shift+Arrow, Shift+click, second Mod+A, copy, cut, duplicate, delete, move, paste, undo, and redo.
- List operations expand to the complete descendant subtree and preserve hierarchy.
- Tab, Shift+Tab, empty-list Enter, and nested-list Backspace preserve source-backed structure.
- Multi-Block paste is one atomic Markdown operation with CRLF normalization and one-step undo.
- Packaged Electron assertions verify exact on-disk Markdown after direct manipulation.

## Verification

- Vitest: 86 files, 801 tests passed.
- Chromium GUI: 6 tests passed.
- Packaged Electron GUI: 23 checks passed, including startup failure and forced Renderer crash recovery.
- TypeScript, ESLint, Prettier, Next production build, and unsigned arm64 Electron packaging passed.
- No TipTap or ProseMirror package/source dependency is present in the edited surface.

final result: passed
