# feat: Mindlines 从 Outline 到 Mindmap 的变形设计

**Created:** 2026-01-14
**Category:** enhancement
**Priority:** high

---

## Overview

重新设计 Mindlines 组件，实现从传统大纲视图到思维导图可视化的平滑变形效果。

**核心概念：**
- **默认状态（Outline）**: 传统的层级缩进文字列表
- **Hover/展开状态（Mindmap）**: 带有节点、分支线、视觉连接的树状图

**这不是简单的宽度变化，而是两种完全不同的可视化形态之间的变形动画。**

---

## Problem Statement

当前实现的问题：
1. ❌ 收缩状态用 dots 显示效果差，不直观
2. ❌ 展开只是显示更多文字，没有本质区别
3. ❌ 没有体现 "Mindlines" = Mind Map + Outlines 的概念

**用户期望：**
- 默认看到传统 outline（熟悉的层级列表）
- Hover 时变形成 mindmap（有视觉冲击力的树状图）
- 真正的形态转换，不只是宽度变化

---

## Proposed Solution

### 视觉形态对比

```
┌─────────────────────────────────────────────────────────────────┐
│  OUTLINE 模式 (默认)          │  MINDMAP 模式 (Hover)           │
│                               │                                  │
│  ● 项目概述                   │       ┌──────────┐               │
│    ○ 背景介绍                 │       │ 项目概述 │               │
│      ◦ 市场分析               │       └────┬─────┘               │
│      ◦ 竞品研究               │    ┌───────┴────────┐            │
│    ○ 技术方案                 │    │                │            │
│      ◦ 架构设计               │ ┌──┴──┐         ┌──┴──┐         │
│                               │ │背景 │         │技术 │         │
│  传统缩进列表                 │ └──┬──┘         └──┬──┘         │
│  点击导航                     │ ┌──┴──┬──┐     ┌──┴──┐          │
│                               │ │市场│ │竞品│ │架构│           │
│                               │ └────┘ └────┘ └────┘           │
│                               │                                  │
│                               │  节点 + 连接线 + 分支            │
└─────────────────────────────────────────────────────────────────┘
```

### 两种模式详解

#### 模式 A: Outline（默认）
- 垂直列表布局
- 层级缩进（level * 12px）
- 文字 + 层级指示符（●, ○, ◦）
- 点击导航到文档位置
- **宽度**: ~200px

#### 模式 B: Mindmap（Hover 激活）
- 树状图布局
- 节点（圆角矩形）
- Bezier 曲线连接线
- 可折叠/展开分支
- **宽度**: ~300px（浮动覆盖）

### 变形动画

```
Outline → Mindmap:
1. 容器宽度扩展 (200px → 300px, 250ms)
2. 文字项变成节点框 (缩放 + 圆角, 200ms)
3. 连接线从父节点"生长"出来 (SVG path 动画, 300ms)
4. 节点重新排列成树形布局 (Framer Motion layout, 300ms)

Mindmap → Outline:
1. 连接线"收缩"消失 (反向动画, 200ms)
2. 节点变回文字项 (250ms)
3. 容器宽度收缩 (200ms)
```

---

## Technical Approach

### 数据结构转换

**扁平数组 → 树形结构**

```typescript
// 当前: 扁平数组
interface Heading {
  id: string;
  level: number; // 1, 2, 3
  text: string;
  pos: number;
}

// 转换为: 树形结构
interface HeadingNode extends Heading {
  children: HeadingNode[];
  x?: number; // mindmap 坐标
  y?: number;
}

// 转换算法
function buildTree(headings: Heading[]): HeadingNode[] {
  const root: HeadingNode[] = [];
  const stack: HeadingNode[] = [];

  for (const heading of headings) {
    const node: HeadingNode = { ...heading, children: [] };

    // Pop until we find a lower level (parent)
    while (stack.length && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(node); // Root level
    } else {
      stack[stack.length - 1].children.push(node); // Add as child
    }

    stack.push(node);
  }

  return root;
}
```

### 布局算法

使用 **d3-hierarchy** 计算树形布局坐标：

```typescript
import * as d3 from 'd3';

function calculateTreeLayout(tree: HeadingNode[], width: number, height: number) {
  // 创建虚拟根节点（如果有多个 H1）
  const root = tree.length === 1
    ? d3.hierarchy(tree[0])
    : d3.hierarchy({ id: 'root', children: tree, text: '', level: 0, pos: 0 });

  // 使用 d3.tree() 计算布局
  const treeLayout = d3.tree<HeadingNode>()
    .size([height - 40, width - 80]); // 垂直方向的树

  treeLayout(root);

  return root.descendants();
}
```

### 连接线绘制

使用 SVG 绘制 Bezier 曲线：

```tsx
// 垂直树的 Bezier 曲线
function LinkPath({ source, target }: { source: Point; target: Point }) {
  const midY = (source.y + target.y) / 2;
  const d = `M${source.x},${source.y}
             C${source.x},${midY}
              ${target.x},${midY}
              ${target.x},${target.y}`;

  return (
    <motion.path
      d={d}
      fill="none"
      stroke="hsl(var(--border))"
      strokeWidth={2}
      initial={{ pathLength: 0 }}
      animate={{ pathLength: 1 }}
      exit={{ pathLength: 0 }}
      transition={{ duration: 0.3 }}
    />
  );
}
```

### 组件架构

```
mindlines/
├── mindlines.tsx          # 主组件，状态管理
├── outline-view.tsx       # Outline 模式渲染
├── mindmap-view.tsx       # Mindmap 模式渲染
├── mindmap-node.tsx       # 单个节点组件
├── mindmap-links.tsx      # SVG 连接线
├── use-tree.ts           # 树形数据 hook
└── index.ts              # 导出
```

---

## Acceptance Criteria

### 功能要求
- [ ] 默认显示 Outline 模式（层级缩进文字列表）
- [ ] Hover 激活 Mindmap 模式（树状图 + 连接线）
- [ ] 平滑变形动画（~300ms, spring 物理效果）
- [ ] 点击节点导航到文档位置
- [ ] 折叠/展开分支功能
- [ ] 活动节点高亮（跟随文档光标位置）

### 视觉要求
- [ ] Mindmap 节点使用圆角矩形（8px radius）
- [ ] 连接线使用 Bezier 曲线
- [ ] 节点按层级有不同大小/颜色
- [ ] 展开时有阴影提升视觉层次
- [ ] 支持 `prefers-reduced-motion`

### 交互要求
- [ ] Hover 150ms 后开始变形
- [ ] 离开 250ms 后变回 Outline
- [ ] 支持键盘导航（Tab, Arrow keys）
- [ ] 支持触摸设备（tap toggle）

### 边界情况
- [ ] 空文档：显示占位提示
- [ ] 单个标题：显示单节点
- [ ] 深层嵌套（4+ 级）：支持滚动
- [ ] 长文本：截断 + tooltip
- [ ] 多个 H1：创建虚拟根节点

---

## Implementation Phases

### Phase 1: 数据层重构
1. 创建 `use-tree.ts` hook
2. 实现扁平→树形转换算法
3. 添加 d3-hierarchy 依赖
4. 编写单元测试

### Phase 2: Outline 模式优化
1. 重构为独立 `outline-view.tsx` 组件
2. 移除 dots 显示逻辑
3. 保持传统列表样式
4. 添加折叠/展开功能

### Phase 3: Mindmap 模式实现
1. 创建 `mindmap-view.tsx` 组件
2. 实现 d3-hierarchy 布局计算
3. 创建 `mindmap-node.tsx` 节点组件
4. 创建 `mindmap-links.tsx` SVG 连接线

### Phase 4: 变形动画
1. 添加 framer-motion 依赖（如未安装）
2. 实现 Outline → Mindmap 变形
3. 实现 Mindmap → Outline 变形
4. 添加连接线绘制动画

### Phase 5: 交互完善
1. 实现 hover 触发逻辑
2. 添加键盘导航
3. 添加触摸支持
4. 处理边界情况

---

## Dependencies

### 新增依赖
```bash
npm install d3-hierarchy
# framer-motion 可能已安装，用于动画
```

### 现有依赖
- React 19
- Tailwind CSS 3.4.x
- TipTap Editor
- Zustand (状态管理)
- lucide-react (图标)

---

## Visual Design Reference

### 节点样式

```css
/* H1 节点 */
.node-h1 {
  padding: 8px 16px;
  border-radius: 8px;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  font-weight: 600;
}

/* H2 节点 */
.node-h2 {
  padding: 6px 12px;
  border-radius: 6px;
  background: hsl(var(--accent));
  font-weight: 500;
}

/* H3 节点 */
.node-h3 {
  padding: 4px 10px;
  border-radius: 4px;
  background: hsl(var(--muted));
  font-size: 0.875rem;
}
```

### 连接线样式

```css
.mindmap-link {
  stroke: hsl(var(--border));
  stroke-width: 2px;
  fill: none;
}

.mindmap-link-active {
  stroke: hsl(var(--primary));
}
```

---

## Open Questions

1. **布局方向**: 水平树（从左到右）还是垂直树（从上到下）？
   - 默认建议：**垂直树**，更适合侧边栏

2. **多 H1 处理**: 显示多棵树还是创建虚拟根节点？
   - 默认建议：**虚拟根节点**，保持单一树结构

3. **折叠状态是否在模式间共享**？
   - 默认建议：**共享**，保持一致性

4. **是否需要"锁定"mindmap 模式的功能**？
   - 默认建议：**暂不需要**，hover 交互足够

---

## File Structure After Implementation

```
src/components/editor/mindlines/
├── mindlines.tsx           # 主组件 (state orchestration)
├── outline-view.tsx        # Outline 模式
├── mindmap-view.tsx        # Mindmap 模式
├── mindmap-node.tsx        # Mindmap 节点
├── mindmap-links.tsx       # SVG 连接线
├── use-tree.ts            # 树形数据 hook
├── tree-layout.ts         # d3 布局计算
├── types.ts               # 类型定义
└── index.ts               # 导出
```

---

## References

### 内部参考
- 当前实现: `src/components/editor/mindlines/mindlines.tsx`
- 状态管理: `src/stores/layout-store.ts`
- 动画模式: `src/app/globals.css:287-300`

### 外部参考
- [D3 Hierarchy](https://github.com/d3/d3-hierarchy) - 树形布局算法
- [Framer Motion Layout](https://www.framer.com/motion/layout-animations/) - 布局动画
- [React Flow](https://reactflow.dev/) - 节点图参考（不直接使用）

### 设计灵感
- XMind 思维导图
- Notion 文档大纲
- Obsidian Graph View

---

*Generated with Claude Code - 2026-01-14*
