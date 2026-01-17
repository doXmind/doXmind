# feat: Unify Search to Cmd+K

## Problem

4 search entry points cause user confusion:
- Sidebar search box
- Cmd+F (in-document toolbar)
- Cmd+K (command palette)
- KB search (AI tool)

## Solution

One entry point: **Cmd+K** opens unified search showing all results grouped.

```
┌─────────────────────────────────────────────────────┐
│ 🔍 Search...                                  ⌘K   │
├─────────────────────────────────────────────────────┤
│ 📄 Files (2)                                       │
│   meeting-notes.md — "discussed API..."            │
│   project-plan.md — 85% match                      │
├─────────────────────────────────────────────────────┤
│ 📝 In Document (3)                                 │
│   Line 42: "authentication flow..."                │
│   Line 78: "login process..."                      │
├─────────────────────────────────────────────────────┤
│ ⚡ Commands                                         │
│   New Document                                     │
└─────────────────────────────────────────────────────┘
```

## Implementation

1. **Edit `command-palette.tsx`** - Add search API calls with 300ms debounce
2. **Cmd+F → Cmd+K** - Make Cmd+F open the same palette (optionally scroll to "In Document" section)
3. **Delete Sidebar search** - Remove search input from `sidebar.tsx`
4. **Simplify search-toolbar** - Keep only for replace functionality, remove search input
5. **Add error handling** - Show inline error with retry button on API failure

## Files to Change

| File | Action |
|------|--------|
| `src/components/ui/command-palette.tsx` | Add search API integration |
| `src/components/sidebar/sidebar.tsx` | Remove search input and related state |
| `src/components/editor/search-toolbar.tsx` | Remove search input, keep replace only |
| `src/lib/api.ts` | Add AbortSignal support to request method |

## Out of Scope

- Search history
- Fuzzy matching libraries
- Mobile-specific UI
- Relevance threshold configuration
- KB source transparency
- Vim-style navigation
- Session storage persistence

## Done When

- [ ] Cmd+K is the only search entry point
- [ ] Sidebar search box is deleted
- [ ] Search-toolbar is replace-only
- [ ] API errors show retry button

---

🤖 Generated with [Claude Code](https://claude.com/code)
