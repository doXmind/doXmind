# feat: Mindlines - 增强型文档大纲

> 基于传统 Outline 改造，在有限空间内最大化用户交互和阅览体验。

## Design Philosophy

**不是 Mindmap，而是更好的 Outline。**

- ❌ 不需要：放大缩小、拖拽、复杂图形
- ✅ 需要：紧凑、快速导航、上下文感知、层级清晰

## Visual Design

### 核心布局

Mindlines 显示在**编辑器左侧边缘**，作为紧凑的浮动面板：

```
┌─────────────────────────────────────────────────────────────────────┐
│ ┌── Mindlines ──────┐                                               │
│ │ ▼ 文档标题        │  # 文档标题                                    │
│ │   ├─ 第一章      ◀│                                               │
│ │   │  ├─ 1.1 节    │  这是一段介绍文字...                           │
│ │   │  └─ 1.2 节    │                                               │
│ │   ├─ 第二章       │  ## 第一章                                     │
│ │   │  ├─ 2.1 节    │                                               │
│ │   │  └─ 2.2 节    │  第一章内容...                                  │
│ │   └─ 第三章       │                                               │
│ └───────────────────┘  ### 1.1 小节                                  │
│                                                                     │
│                        小节内容...                                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

◀ 表示当前阅读位置
```

### 三种显示模式

用户可切换不同的信息密度：

#### 模式 1: 极简 (Mini)
仅显示层级指示器，悬浮在左侧边缘

```
│●            # 标题
│├○           ## 第一章
││├◦          ### 1.1
││└◦          ### 1.2
│└○           ## 第二章
```

#### 模式 2: 紧凑 (Compact) - 默认
显示截断的标题文字

```
│● 文档标题
│├○ 第一章
││├◦ 1.1 节
││└◦ 1.2 节
│└○ 第二章
```

#### 模式 3: 完整 (Full)
展开的侧边栏面板

```
┌─ Document Outline ──────┐
│ ▼ 文档标题              │
│   ├─ 第一章             │
│   │  ├─ 1.1 节内容简介   │
│   │  └─ 1.2 另一个小节   │
│   └─ 第二章             │
│      └─ 2.1 节          │
└─────────────────────────┘
```

### 视觉元素

#### 层级指示

| 层级 | 图标 | 缩进 | 字号 | 字重 |
|------|------|------|------|------|
| H1 | `●` | 0px | 14px | Bold |
| H2 | `○` | 12px | 13px | Semibold |
| H3 | `◦` | 24px | 12px | Normal |
| H4 | `·` | 36px | 11px | Normal |

#### 连接线样式

```css
.mindline-connector {
  border-left: 1px solid var(--border);
  margin-left: 6px;
}

.mindline-branch {
  width: 8px;
  height: 1px;
  background: var(--border);
}
```

#### 当前位置指示

```
当前阅读位置用 accent 颜色高亮:

│● 文档标题
│├○ 第一章
││├◦ 1.1 节    ← 普通状态
││└◦ 1.2 节    ← [高亮背景 + 左侧指示条]
│└○ 第二章
```

### 颜色方案

使用现有 CSS 变量保持一致性：

```css
--mindline-h1: hsl(var(--primary));
--mindline-h2: hsl(var(--accent));
--mindline-h3: hsl(var(--muted-foreground));
--mindline-h4: hsl(var(--muted-foreground) / 0.7);
--mindline-active: hsl(var(--accent));
--mindline-connector: hsl(var(--border));
```

## Interaction Design

### 核心交互

| 操作 | 行为 | 反馈 |
|------|------|------|
| **点击条目** | 编辑器滚动到对应位置 | 目标标题闪烁高亮 2s |
| **Hover 条目** | 显示完整标题 Tooltip | 条目背景变色 |
| **编辑器滚动** | 自动追踪当前位置 | 对应条目高亮 |
| **点击折叠图标** | 折叠/展开子级 | 平滑动画 |
| **双击条目** | 进入编辑该标题 | 光标定位到标题 |

### 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Cmd/Ctrl + Shift + O` | 切换 Mindlines 显示 |
| `Cmd/Ctrl + Shift + [` | 切换显示模式 |
| `↑ / ↓` (焦点在 Mindlines 时) | 导航条目 |
| `Enter` | 跳转到选中条目 |
| `←` | 折叠当前节点 |
| `→` | 展开当前节点 |

### 自动行为

1. **智能折叠**：文档 >10 个 H2 时，默认折叠非活跃分支
2. **位置追踪**：滚动时自动展开当前位置所在分支
3. **模式记忆**：记住用户选择的显示模式

## Technical Approach

### Component Structure

```
src/components/editor/
├── mindlines/
│   ├── mindlines.tsx           # 主容器
│   ├── mindline-item.tsx       # 单个条目
│   ├── mindline-connector.tsx  # 连接线组件
│   ├── mindline-tooltip.tsx    # Hover Tooltip
│   └── use-mindlines.ts        # 状态和逻辑 Hook
```

### State Management

```typescript
// src/stores/mindlines-store.ts
interface MindlinesState {
  // 显示状态
  isVisible: boolean;
  mode: 'mini' | 'compact' | 'full';

  // 内容状态
  headings: HeadingNode[];
  activeHeadingId: string | null;
  collapsedIds: Set<string>;

  // Actions
  toggleVisibility: () => void;
  setMode: (mode: 'mini' | 'compact' | 'full') => void;
  setActiveHeading: (id: string | null) => void;
  toggleCollapse: (id: string) => void;
  setHeadings: (headings: HeadingNode[]) => void;
}
```

### Key Implementation

#### 1. 标题提取

```typescript
// src/lib/document-structure.ts
export interface HeadingNode {
  id: string;
  level: 1 | 2 | 3 | 4;
  text: string;
  pos: number;           // TipTap 位置
  children: HeadingNode[];
}

export function extractHeadings(editor: Editor): HeadingNode[] {
  const headings: { level: number; text: string; pos: number }[] = [];

  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      headings.push({
        level: node.attrs.level,
        text: node.textContent,
        pos,
      });
    }
  });

  return buildHierarchy(headings);
}
```

#### 2. 位置追踪

```typescript
// src/components/editor/mindlines/use-mindlines.ts
export function useMindlines(editor: Editor | null) {
  const { headings, setHeadings, setActiveHeading } = useMindlinesStore();

  // 提取标题 (防抖)
  useEffect(() => {
    if (!editor) return;

    const updateHeadings = debounce(() => {
      setHeadings(extractHeadings(editor));
    }, 300);

    editor.on('update', updateHeadings);
    updateHeadings(); // 初始化

    return () => editor.off('update', updateHeadings);
  }, [editor]);

  // 追踪当前位置
  useEffect(() => {
    if (!editor) return;

    const handleScroll = throttle(() => {
      const { from } = editor.state.selection;

      // 找到当前位置对应的标题
      let activeHeading: HeadingNode | null = null;
      const flatHeadings = flattenHeadings(headings);

      for (let i = flatHeadings.length - 1; i >= 0; i--) {
        if (flatHeadings[i].pos <= from) {
          activeHeading = flatHeadings[i];
          break;
        }
      }

      setActiveHeading(activeHeading?.id ?? null);
    }, 100);

    editor.on('selectionUpdate', handleScroll);
    return () => editor.off('selectionUpdate', handleScroll);
  }, [editor, headings]);

  return { headings };
}
```

#### 3. 导航跳转

```typescript
function handleItemClick(heading: HeadingNode) {
  if (!editor) return;

  // 跳转到位置
  editor.chain()
    .focus()
    .setTextSelection(heading.pos)
    .scrollIntoView()
    .run();

  // 高亮动画
  const headingElement = editor.view.domAtPos(heading.pos).node as HTMLElement;
  headingElement.classList.add('highlight-flash');
  setTimeout(() => headingElement.classList.remove('highlight-flash'), 2000);
}
```

### CSS Styles

```css
/* src/components/editor/mindlines/mindlines.css */

.mindlines {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 10;
  background: hsl(var(--background) / 0.95);
  backdrop-filter: blur(8px);
  border-right: 1px solid hsl(var(--border));
  transition: width 200ms ease;
}

.mindlines--mini { width: 24px; }
.mindlines--compact { width: 160px; }
.mindlines--full { width: 280px; }

.mindline-item {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  cursor: pointer;
  border-radius: 4px;
  transition: background 150ms;
}

.mindline-item:hover {
  background: hsl(var(--accent) / 0.1);
}

.mindline-item--active {
  background: hsl(var(--accent) / 0.15);
  border-left: 2px solid hsl(var(--accent));
}

.mindline-icon {
  flex-shrink: 0;
  width: 12px;
  text-align: center;
  color: hsl(var(--muted-foreground));
}

.mindline-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mindline-connector {
  border-left: 1px solid hsl(var(--border));
  margin-left: 6px;
  padding-left: 6px;
}

/* 高亮闪烁动画 */
@keyframes highlight-flash {
  0%, 100% { background: transparent; }
  50% { background: hsl(var(--accent) / 0.3); }
}

.highlight-flash {
  animation: highlight-flash 500ms ease 2;
}
```

## Implementation Phases

### Phase 1: 基础功能

- [ ] 创建 `mindlines-store.ts`
- [ ] 创建 `mindlines.tsx` 主组件
- [ ] 实现标题提取 (`document-structure.ts`)
- [ ] 实现基础列表渲染 (Compact 模式)
- [ ] 实现点击跳转功能
- [ ] 集成到编辑器布局

### Phase 2: 交互完善

- [ ] 实现当前位置追踪和高亮
- [ ] 实现折叠/展开功能
- [ ] 添加 Hover Tooltip
- [ ] 实现三种显示模式切换
- [ ] 添加键盘导航支持

### Phase 3: 优化打磨

- [ ] 添加平滑动画
- [ ] 实现智能折叠逻辑
- [ ] 添加空状态处理
- [ ] 性能优化 (虚拟列表)
- [ ] 响应式适配
- [ ] 添加 Toggle 开关到工具栏

## Acceptance Criteria

### 功能要求

- [ ] 显示文档 H1-H4 标题层级
- [ ] 点击条目跳转到对应位置
- [ ] 自动追踪当前阅读位置
- [ ] 支持折叠/展开子级
- [ ] 支持三种显示模式切换
- [ ] 编辑标题时实时更新

### 交互要求

- [ ] 跳转后目标标题高亮闪烁
- [ ] Hover 显示完整标题 Tooltip
- [ ] 支持键盘导航
- [ ] 滚动时当前条目始终可见

### 视觉要求

- [ ] 层级缩进清晰
- [ ] 连接线显示父子关系
- [ ] 当前位置有明显指示
- [ ] 动画流畅自然

### 边缘情况

- [ ] 空文档：显示"添加标题..."提示
- [ ] 超长标题：截断 + Tooltip
- [ ] 深层嵌套 (H4 下还有内容)：正常显示

## Success Metrics

| 指标 | 目标 |
|------|------|
| 使用率 | >40% 用户保持开启 |
| 导航效率 | 跳转响应 <100ms |
| 满意度 | 正面反馈 >85% |

## File Structure

```
src/
├── components/
│   └── editor/
│       └── mindlines/
│           ├── index.ts
│           ├── mindlines.tsx
│           ├── mindline-item.tsx
│           ├── mindline-connector.tsx
│           ├── mindline-tooltip.tsx
│           ├── mindlines.css
│           └── use-mindlines.ts
├── stores/
│   └── mindlines-store.ts
└── lib/
    └── document-structure.ts
```

---

## Quick Reference: MVP Code

### mindlines.tsx (核心组件)

```tsx
'use client';

import { useMindlinesStore } from '@/stores/mindlines-store';
import { useMindlines } from './use-mindlines';
import { MindlineItem } from './mindline-item';
import { cn } from '@/lib/utils';
import './mindlines.css';

interface MindlinesProps {
  editor: Editor | null;
}

export function Mindlines({ editor }: MindlinesProps) {
  const { isVisible, mode, activeHeadingId, collapsedIds } = useMindlinesStore();
  const { headings } = useMindlines(editor);

  if (!isVisible) return null;

  return (
    <div className={cn('mindlines', `mindlines--${mode}`)}>
      {headings.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">
          添加标题以查看文档结构
        </div>
      ) : (
        <nav className="py-2" aria-label="Document outline">
          {headings.map(heading => (
            <MindlineItem
              key={heading.id}
              heading={heading}
              isActive={heading.id === activeHeadingId}
              isCollapsed={collapsedIds.has(heading.id)}
              mode={mode}
              editor={editor}
            />
          ))}
        </nav>
      )}
    </div>
  );
}
```

---

*Plan created: 2026-01-14*
*Design philosophy: Better Outline, not another Mindmap*
