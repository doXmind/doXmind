# Feature: Search/Replace Bottom Floating Bar

## Overview

重新设计 Cmd+F 搜索功能，将其从居中模态框改为底部浮动搜索栏，并添加替换功能、结果导航、匹配计数等缺失功能。

**核心变更：**
- 将 Document 搜索从 Command Palette 分离为独立的底部浮动组件
- 添加完整的 Find/Replace 功能（Replace、Replace All）
- 添加结果导航（Prev/Next）和匹配计数（"3 of 15"）
- 添加大小写敏感开关
- 移除背景模糊，采用非侵入式设计

## Problem Statement

当前 Cmd+F 搜索存在以下问题：

| 功能 | 当前状态 | 目标状态 |
|------|----------|----------|
| 替换 (Replace) | ❌ 缺失 | ✅ 支持 |
| 全部替换 (Replace All) | ❌ 缺失 | ✅ 支持 |
| 上/下导航 | ⚠️ 列表选择 | ✅ Enter/Shift+Enter |
| 匹配计数 | ❌ 缺失 | ✅ "3 of 15" |
| 大小写敏感 | ❌ 缺失 | ✅ 开关 |
| UI 位置 | 居中模态框（遮挡内容） | 底部浮动栏（不遮挡） |
| 背景 | 模糊遮罩 | 无遮罩 |

## Proposed Solution

### 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                     Editor Page                              │
├─────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────┐  │
│  │                    Editor Content                      │  │
│  │                                                        │  │
│  │   Text with [highlighted] matches...                   │  │
│  │                                                        │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  🔍 Search: [___________] │ 3/15 │ Aa │ ↑ ↓ │ ⌂ │ ✕  │  │
│  │  ⇄ Replace: [___________] │ [Replace] │ [Replace All] │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 快捷键分工

| 快捷键 | 功能 | 组件 |
|--------|------|------|
| **Cmd+K** | 命令面板 + 语义搜索 | CommandPalette (保持不变) |
| **Cmd+F** | 文档关键词搜索 | **SearchBar (新组件)** |
| **Cmd+H** | 打开搜索并展开替换 | SearchBar |

## Technical Approach

### Phase 1: 核心组件创建

#### 1.1 创建 SearchBar 组件

**文件:** `src/components/editor/search-bar.tsx`

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, ChevronUp, ChevronDown, X,
  CaseSensitive, Replace, RefreshCcw
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEditorRefStore } from "@/stores/editor-ref-store";
import { useLayoutStore } from "@/stores/layout-store";
import { SearchPluginKey } from "@/extensions/search";

export function SearchBar() {
  const [mounted, setMounted] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [replaceTerm, setReplaceTerm] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { editor } = useEditorRefStore();
  const { isSearchBarOpen, setSearchBarOpen } = useLayoutStore();

  // Get search state from plugin
  const pluginState = editor ? SearchPluginKey.getState(editor.state) : null;
  const resultsCount = pluginState?.results.length ?? 0;
  const currentIndex = pluginState?.currentIndex ?? 0;

  // Implementation details...
}
```

#### 1.2 更新 Layout Store

**文件:** `src/stores/layout-store.ts`

添加 SearchBar 状态管理：

```tsx
interface LayoutState {
  // ... existing state

  // Search bar (新增)
  isSearchBarOpen: boolean;
  setSearchBarOpen: (open: boolean) => void;
  toggleSearchBar: () => void;
}
```

### Phase 2: 键盘快捷键整合

#### 2.1 更新 Editor Page 快捷键

**文件:** `src/app/editor/page.tsx`

```tsx
// 将 Cmd+F 改为打开 SearchBar 而不是 CommandPalette
if ((e.ctrlKey || e.metaKey) && e.key === "f") {
  e.preventDefault();
  toggleSearchBar();  // 切换 SearchBar
  return;
}

// 新增 Cmd+H 打开并展开替换
if ((e.ctrlKey || e.metaKey) && e.key === "h") {
  e.preventDefault();
  openSearchBarWithReplace();  // 打开 SearchBar 并展开 Replace
  return;
}
```

### Phase 3: 功能实现

#### 3.1 搜索功能
- 实时关键词匹配（复用 TipTap SearchExtension）
- 黄色高亮显示匹配项
- 当前匹配项橙色高亮

#### 3.2 导航功能
- Enter: 下一个匹配
- Shift+Enter: 上一个匹配
- 点击 ↑/↓ 按钮导航
- 自动滚动到匹配位置

#### 3.3 替换功能
- Replace: 替换当前匹配并前进到下一个
- Replace All: 替换所有匹配（>50个时显示确认）
- 支持 Undo (Cmd+Z)

#### 3.4 大小写敏感
- 默认：不区分大小写
- 点击 [Aa] 切换
- 状态持久化到 localStorage

### Phase 4: 清理与集成

#### 4.1 修改 Command Palette

**文件:** `src/components/ui/command-palette.tsx`

- 移除 "document" scope 的特殊处理
- Cmd+K 只用于 "all" scope（跨文件语义搜索 + 命令）
- 移除与新 SearchBar 重复的代码

#### 4.2 更新 Editor Toolbar

**文件:** `src/components/editor/editor-toolbar.tsx`

- 将搜索按钮改为打开 SearchBar

## File Changes Summary

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/components/editor/search-bar.tsx` | **新建** | 底部浮动搜索栏组件 |
| `src/stores/layout-store.ts` | **修改** | 添加 isSearchBarOpen 状态 |
| `src/app/editor/page.tsx` | **修改** | 更新 Cmd+F/Cmd+H 快捷键 |
| `src/components/ui/command-palette.tsx` | **修改** | 移除 document scope 搜索逻辑 |
| `src/components/editor/editor-toolbar.tsx` | **修改** | 搜索按钮指向 SearchBar |
| `src/components/editor/editor.tsx` | **修改** | 渲染 SearchBar 组件 |

## Acceptance Criteria

### Functional Requirements

- [ ] Cmd+F 打开底部浮动搜索栏（非模态）
- [ ] Cmd+H 打开搜索栏并展开替换区域
- [ ] 输入搜索词时即时高亮所有匹配
- [ ] 显示匹配计数 "X of Y" 格式
- [ ] Enter 跳转到下一个匹配
- [ ] Shift+Enter 跳转到上一个匹配
- [ ] 点击 ↑/↓ 按钮进行导航
- [ ] Replace 替换当前匹配并前进
- [ ] Replace All 替换所有匹配
- [ ] Replace All 在 >50 匹配时显示确认
- [ ] Aa 按钮切换大小写敏感
- [ ] Escape 关闭搜索栏并清除高亮
- [ ] 点击编辑器时搜索栏保持打开
- [ ] Cmd+K 仍然打开 Command Palette（语义搜索）

### Non-Functional Requirements

- [ ] 搜索栏不阻挡编辑器内容
- [ ] 无背景模糊效果
- [ ] 动画流畅（slide-up 150ms）
- [ ] 支持键盘完全操作
- [ ] 符合 WCAG 2.1 A 级无障碍要求
- [ ] 大文档（10k+ 匹配）不卡顿

### Mobile Considerations

- [ ] 移动端不显示 SearchBar（保持 Command Palette）
- [ ] 或：添加工具栏搜索按钮触发移动端搜索

## UI Design Specifications

### 搜索栏布局

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 🔍 │ Find: [________________] │ 3 of 15 │ [Aa] │ [↑] [↓] │ [⌂] │ [✕] │
├─────────────────────────────────────────────────────────────────────────┤
│ ⇄  │ Replace: [_____________] │        [Replace] │ [Replace All]        │
└─────────────────────────────────────────────────────────────────────────┘
```

### 组件说明

| 元素 | 功能 | 快捷键 |
|------|------|--------|
| 🔍 | 搜索图标/指示器 | - |
| Find 输入框 | 搜索关键词输入 | 自动聚焦 |
| 3 of 15 | 匹配计数器 | - |
| [Aa] | 大小写敏感开关 | Alt+C |
| [↑] [↓] | 导航按钮 | Shift+Enter / Enter |
| [⌂] | 展开/收起替换区 | Cmd+H |
| [✕] | 关闭搜索栏 | Escape |
| Replace 输入框 | 替换文本输入 | Tab 切换 |
| [Replace] | 替换当前 | Cmd+Shift+1 |
| [Replace All] | 全部替换 | Cmd+Shift+Enter |

### 样式规格

```css
/* 定位 */
position: fixed;
bottom: 24px;           /* 距底部 24px */
left: 50%;
transform: translateX(-50%);
z-index: 45;            /* 低于 Command Palette (50), 高于编辑器 */

/* 尺寸 */
max-width: 640px;       /* 最大宽度 */
width: calc(100% - 32px); /* 两侧留 16px 边距 */

/* 外观 */
background: hsl(var(--popover));
border: 1px solid hsl(var(--border));
border-radius: 12px;
box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);

/* 动画 */
animation: slideUp 150ms ease-out;

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}
```

## Keyboard Shortcuts Reference

| 快捷键 | 搜索栏关闭时 | 搜索栏打开时 |
|--------|-------------|-------------|
| Cmd+F | 打开搜索栏 | 聚焦搜索输入框 |
| Cmd+H | 打开搜索栏+展开替换 | 切换替换区域 |
| Cmd+K | 打开 Command Palette | 关闭搜索栏，打开 Command Palette |
| Enter | - | 下一个匹配 |
| Shift+Enter | - | 上一个匹配 |
| Escape | - | 关闭搜索栏 |
| Tab | - | 在输入框/按钮间切换 |
| Cmd+Shift+1 | - | 替换当前 |
| Cmd+Shift+Enter | - | 替换所有 |

## State Management

### Layout Store 更新

```typescript
// src/stores/layout-store.ts

interface LayoutState {
  // Search Bar (新增)
  isSearchBarOpen: boolean;
  isSearchBarReplaceExpanded: boolean;
  searchBarCaseSensitive: boolean;

  // Actions
  setSearchBarOpen: (open: boolean) => void;
  toggleSearchBar: () => void;
  openSearchBarWithReplace: () => void;
  setSearchBarReplaceExpanded: (expanded: boolean) => void;
  setSearchBarCaseSensitive: (sensitive: boolean) => void;
}

// 持久化配置
partialize: (state) => ({
  // ... existing
  searchBarCaseSensitive: state.searchBarCaseSensitive,
}),
```

## Z-Index Layering

```
z-index: 50  │ Command Palette (现有)
z-index: 45  │ SearchBar (新增) ← 新组件位置
z-index: 40  │ Mobile Bottom Nav
z-index: 35  │ Bubble Menus / Popups
z-index: 30  │ Floating Toolbars
z-index: 20  │ Overlays
z-index: 10  │ Editor Content
z-index: 0   │ Base
```

## Edge Cases & Error Handling

### 边缘情况处理

| 场景 | 处理方式 |
|------|----------|
| 空文档 | 显示 "No matches"，禁用导航按钮 |
| 无匹配 | 显示 "No matches"，禁用导航和替换按钮 |
| 单个匹配 | 正常显示 "1 of 1"，导航循环到自身 |
| 大量匹配 (>1000) | 正常处理，可考虑限制高亮数量 |
| 替换为空字符串 | 允许（删除匹配文本） |
| AI 正在编辑 | 禁用搜索栏，显示提示 |
| 选中文本后 Cmd+F | 预填充选中文本到搜索框 |

### 确认对话框

Replace All 在以下情况显示确认：
- 匹配数量 > 50
- 提示："Replace all 156 matches? This cannot be undone."
- 按钮：[Cancel] [Replace All]

## Testing Requirements

### 单元测试

- [ ] SearchBar 组件渲染测试
- [ ] 搜索状态更新测试
- [ ] 替换操作测试
- [ ] 大小写敏感切换测试

### 集成测试

- [ ] Cmd+F 打开 SearchBar
- [ ] 搜索+导航流程
- [ ] 替换流程
- [ ] 与 Command Palette 交互

### E2E 测试

- [ ] 完整搜索替换工作流
- [ ] 键盘导航测试
- [ ] 移动端回退测试

## Implementation Checklist

### Phase 1: 核心组件 (Day 1-2)
- [ ] 创建 `src/components/editor/search-bar.tsx`
- [ ] 实现基础 UI 布局
- [ ] 实现搜索输入和高亮
- [ ] 实现匹配计数显示
- [ ] 实现 Escape 关闭

### Phase 2: 导航功能 (Day 2)
- [ ] 实现 Enter/Shift+Enter 导航
- [ ] 实现 ↑/↓ 按钮导航
- [ ] 实现自动滚动到匹配位置
- [ ] 实现大小写敏感切换

### Phase 3: 替换功能 (Day 3)
- [ ] 实现替换区域展开/收起
- [ ] 实现 Replace 单个替换
- [ ] 实现 Replace All 全部替换
- [ ] 实现替换确认对话框

### Phase 4: 整合清理 (Day 4)
- [ ] 更新 Layout Store
- [ ] 更新快捷键处理
- [ ] 更新 Command Palette（移除 document scope）
- [ ] 更新 Editor Toolbar
- [ ] 代码清理和优化

### Phase 5: 测试完善 (Day 5)
- [ ] 编写单元测试
- [ ] 手动测试所有场景
- [ ] 无障碍测试
- [ ] 性能测试（大文档）
- [ ] 代码审查

## References

### Internal Files
- `src/extensions/search/index.ts` - TipTap 搜索扩展
- `src/extensions/search/search-types.ts` - 搜索类型定义
- `src/components/ui/command-palette.tsx` - 现有命令面板
- `src/components/editor/diff-review-toolbar.tsx` - 浮动工具栏参考
- `src/stores/layout-store.ts` - 布局状态管理

### External References
- [VS Code Find/Replace UI](https://code.visualstudio.com/docs/editor/codebasics#_find-and-replace)
- [TipTap Commands API](https://tiptap.dev/docs/editor/api/commands)
- [Framer Motion AnimatePresence](https://www.framer.com/motion/animate-presence/)
- [WCAG 2.1 Keyboard Accessibility](https://www.w3.org/WAI/WCAG21/Understanding/keyboard)
