# feat: Outline Click-to-Toggle Interaction

## Overview

优化 Outline 的折叠/展开交互方式，移除专门的 toggle 按钮，改为让整个折叠区域可点击切换状态。这种设计更符合 Notion 等现代应用的交互模式。

## Problem Statement / Motivation

**当前问题**:
- 折叠状态下，用户必须点击一个小的 toggle 按钮才能展开
- 按钮目标较小，不符合触摸友好设计
- 交互不够直观，用户可能不知道如何展开

**目标**:
- 折叠状态下，点击整个区域即可展开
- 展开状态下，点击 header 区域即可折叠
- 点击 heading 时同时导航并展开（更好的用户体验）

## Proposed Solution

### 交互设计

| 状态 | 点击位置 | 行为 |
|------|----------|------|
| **折叠 (48px)** | Header 区域 | 展开 |
| **折叠 (48px)** | Heading 指示线 | **导航 + 展开** |
| **折叠 (48px)** | 空白区域 | 展开 |
| **展开 (280px)** | Header 区域（非按钮） | 折叠 |
| **展开 (280px)** | Heading 项 | 仅导航（不折叠） |
| **展开 (280px)** | 内容滚动区域 | 无操作 |

### 视觉反馈

- 折叠状态 hover 时显示 `cursor: pointer` + 淡色背景
- Header 区域 hover 时显示折叠/展开提示

## Technical Approach

### 文件修改清单

| 文件 | 修改内容 |
|------|----------|
| `src/components/editor/mindlines/mindlines.tsx` | 添加容器级 onClick 处理 |
| `src/components/editor/mindlines/mindlines-header.tsx` | 简化折叠状态 header，添加可点击区域 |
| `src/components/editor/mindlines/outline-collapsed.tsx` | heading 点击改为导航+展开 |

### Phase 1: 修改 mindlines.tsx - 容器点击处理

```tsx
// src/components/editor/mindlines/mindlines.tsx

// 在 motion.aside 上添加点击处理
<motion.aside
  className={cn(
    // ... 现有样式
    // 折叠状态时添加 hover 效果和指针样式
    isMindlinesCollapsed && !isExpanded && "cursor-pointer hover:bg-accent/30"
  )}
  onClick={
    isMindlinesCollapsed && !isExpanded
      ? toggleMindlinesCollapsed  // 点击折叠区域时展开
      : undefined
  }
  // ...
>
```

### Phase 2: 修改 mindlines-header.tsx - 可点击 Header

```tsx
// src/components/editor/mindlines/mindlines-header.tsx

export function MindlinesHeader({
  mode,
  isCollapsed,
  onToggle,
  onToggleCollapse,
  onClose,
  headingsCount,
}: MindlinesHeaderProps) {
  const isExpanded = mode === "expanded";

  // 折叠状态：整个 header 可点击展开
  if (isCollapsed && !isExpanded) {
    return (
      <div
        className="flex cursor-pointer items-center justify-center border-b border-border/50 px-2 py-2 transition-colors hover:bg-accent/50"
        onClick={onToggleCollapse}
        title="Click to expand outline"
        role="button"
        aria-expanded={false}
        aria-label="Expand outline"
      >
        <List className="h-4 w-4 text-muted-foreground" />
      </div>
    );
  }

  // 展开状态：header 区域可点击折叠，按钮除外
  return (
    <div
      className={cn(
        "flex shrink-0 cursor-pointer items-center justify-between border-b border-border/50 px-3 py-2 transition-colors hover:bg-accent/30",
        isExpanded && "cursor-default px-4 py-3 hover:bg-transparent"
      )}
      onClick={!isExpanded ? onToggleCollapse : undefined}
      role={!isExpanded ? "button" : undefined}
      aria-expanded={!isExpanded ? true : undefined}
      aria-label={!isExpanded ? "Collapse outline" : undefined}
    >
      {/* Title with icon */}
      <div className="flex items-center gap-2 pointer-events-none">
        {/* ... icon and title */}
      </div>

      {/* Action buttons - 阻止事件冒泡 */}
      {!isExpanded && (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Button onClick={onToggle} title="Expand to mindmap">
            <Maximize2 />
          </Button>
          <Button onClick={onClose} title="Close outline">
            <X />
          </Button>
        </div>
      )}
    </div>
  );
}
```

### Phase 3: 修改 outline-collapsed.tsx - Heading 点击导航+展开

```tsx
// src/components/editor/mindlines/outline-collapsed.tsx

interface OutlineCollapsedProps {
  headings: Heading[];
  activeId: string | null;
  onNavigate: (heading: Heading) => void;
  onExpand: () => void;  // 新增：展开回调
}

export function OutlineCollapsed({
  headings,
  activeId,
  onNavigate,
  onExpand,
}: OutlineCollapsedProps) {
  const handleHeadingClick = useCallback(
    (e: React.MouseEvent, heading: Heading) => {
      e.stopPropagation();  // 阻止冒泡到容器
      onNavigate(heading);  // 先导航
      onExpand();           // 再展开
    },
    [onNavigate, onExpand]
  );

  // ... 其余代码

  return (
    <div className="flex flex-col gap-0.5 py-2">
      {headings.map((heading) => (
        <button
          key={heading.id}
          className={cn(/* ... */)}
          onClick={(e) => handleHeadingClick(e, heading)}
          title={`${heading.text || "Untitled"} - Click to navigate and expand`}
        >
          <div className="outline-line-indicator" />
        </button>
      ))}
    </div>
  );
}
```

### Phase 4: 更新 mindlines.tsx - 传递 onExpand

```tsx
// 在 mindlines.tsx 中更新 OutlineCollapsed 的调用

<OutlineCollapsed
  headings={headings}
  activeId={activeId}
  onNavigate={navigateTo}
  onExpand={() => setMindlinesCollapsed(false)}  // 新增
/>
```

## Acceptance Criteria

### Functional Requirements

- [ ] 折叠状态下，点击任意位置（header、heading、空白区域）都能展开
- [ ] 折叠状态下，点击 heading 时同时导航到对应位置并展开
- [ ] 展开状态下，点击 header 区域（按钮除外）能折叠
- [ ] 展开状态下，点击 heading 只导航不折叠
- [ ] Mindmap 按钮和关闭按钮保持原有功能

### Non-Functional Requirements

- [ ] 折叠/展开动画流畅（使用现有 Framer Motion 配置）
- [ ] 支持 `prefers-reduced-motion` 设置
- [ ] hover 状态有明显视觉反馈
- [ ] 保持键盘可访问性（Tab + Enter 可操作）

### Quality Gates

- [ ] 状态持久化到 localStorage 正常工作
- [ ] 刷新页面后状态保持
- [ ] TypeScript 类型检查通过
- [ ] ESLint 检查通过

## Dependencies & Prerequisites

- 现有的 `isMindlinesCollapsed` 状态和 `toggleMindlinesCollapsed` action（已实现）
- Framer Motion 动画库（已集成）
- 现有的 `MINDLINES_WIDTH` 常量（已定义）

## Risk Analysis & Mitigation

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 事件冒泡导致双重触发 | 点击 heading 时可能同时触发容器 onClick | 使用 `e.stopPropagation()` |
| 动画过程中的点击 | 可能导致状态不一致 | Framer Motion 自动处理动画中断 |
| 移动端触摸冲突 | 滑动可能被误判为点击 | 移动端使用独立的 `isMobileOutlineOpen` 状态 |

## Implementation Notes

### Event Propagation Strategy

```
Container (motion.aside)
  └── onClick: toggleMindlinesCollapsed (仅折叠状态)
      │
      ├── Header
      │   └── onClick: toggleMindlinesCollapsed (展开状态)
      │       │
      │       └── Buttons div
      │           └── onClick: stopPropagation()
      │               ├── Mindmap Button
      │               └── Close Button
      │
      └── Content
          └── OutlineCollapsed
              └── Heading buttons
                  └── onClick: stopPropagation() + navigate + expand
```

### 键盘交互

| 按键 | 折叠状态 | 展开状态 |
|------|----------|----------|
| Tab | 聚焦到 header | 聚焦到 heading 项 |
| Enter/Space (在 header 上) | 展开 | 折叠 |
| Enter (在 heading 上) | 导航 + 展开 | 导航 |

## References & Research

### Internal References
- Layout store: `src/stores/layout-store.ts:89-90` (isMindlinesCollapsed state)
- Constants: `src/lib/constants.ts:90-95` (MINDLINES_WIDTH)
- Header component: `src/components/editor/mindlines/mindlines-header.tsx`
- Collapsed view: `src/components/editor/mindlines/outline-collapsed.tsx`

### External References
- [Notion sidebar collapse pattern](https://www.notion.com/help/navigate-with-the-sidebar)
- [Material Design Navigation Rail](https://m3.material.io/components/navigation-rail/overview)
- [Framer Motion layout animations](https://motion.dev/docs/react-layout-animations)
- [WCAG aria-expanded](https://www.w3.org/WAI/GL/wiki/Using_the_WAI-ARIA_aria-expanded_state_to_mark_expandable_and_collapsible_regions)
