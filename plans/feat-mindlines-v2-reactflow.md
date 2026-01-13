# feat: Mindlines v2 - React Flow Mindmap Modal

**Created:** 2026-01-14
**Category:** enhancement
**Priority:** high

---

## Overview

Redesign Mindlines to separate the traditional outline (always visible in sidebar) from an expanded mindmap visualization (triggered by toggle button, displayed in modal/overlay using React Flow).

**Core Changes:**
1. Remove hover-triggered view transformation
2. Keep outline as the default sidebar view
3. Add toggle button to open full-screen mindmap modal
4. Replace d3-hierarchy + SVG with React Flow for mindmap

---

## Problem Statement

当前实现的问题：
1. **狭窄容器限制** - Mindmap 受限于 288px 宽度的侧边栏，无法展示复杂文档结构
2. **Hover 干扰浏览** - 悬停触发的变形影响用户正常使用传统 outline 导航
3. **用户期望不匹配** - 用户希望 outline 和 mindmap 是独立的模式，而非自动切换

**用户期望：**
- 默认使用传统 outline 进行日常文档导航
- 需要时通过按钮打开全屏 mindmap 查看整体结构
- Mindmap 有足够空间展示完整的文档层级关系

---

## Proposed Solution

### 架构变更

```
┌─────────────────────────────────────────────────────────────────┐
│  BEFORE (v1)                    │  AFTER (v2)                   │
│                                 │                               │
│  [Sidebar: 288px]               │  [Sidebar: Fixed Width]       │
│  ┌─────────────┐                │  ┌─────────────┐              │
│  │ Outline     │ ←hover→        │  │ Outline     │              │
│  │ (default)   │                │  │ (always)    │              │
│  │             │                │  │             │              │
│  │ Mindmap     │                │  │ [🗺️ Map]    │ ← toggle     │
│  │ (expanded)  │                │  └─────────────┘   button     │
│  └─────────────┘                │                               │
│                                 │  ┌─────────────────────────┐  │
│                                 │  │   Mindmap Modal         │  │
│                                 │  │   (Full-screen React    │  │
│                                 │  │    Flow visualization)  │  │
│                                 │  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 两种模式详解

#### Outline View (侧边栏，始终可用)
- 保持当前 `outline-view.tsx` 实现
- 移除 hover 变形逻辑
- 添加 "Open Mindmap" 按钮

#### Mindmap View (Modal，按需打开)
- 全屏/大尺寸 Modal 容器
- 使用 React Flow 渲染交互式树状图
- 支持 Pan/Zoom、MiniMap、Controls
- 点击节点导航到文档位置并关闭 Modal

---

## Technical Approach

### 依赖变更

```bash
# 新增
npm install @xyflow/react @dagrejs/dagre

# 可选移除（如果不再使用）
npm uninstall d3-hierarchy  # 保留也可以，use-tree.ts 仍可复用
```

### 组件架构

```
mindlines/
├── index.ts                  # 导出
├── types.ts                  # 类型定义 (保留)
├── use-tree.ts              # 树形数据 hook (保留)
├── use-headings.ts          # 新增: 从 editor 提取 headings 的 hook
├── mindlines.tsx            # 重构: 简化为 outline + toggle
├── outline-view.tsx         # 保留: 传统列表视图
├── mindmap-modal.tsx        # 新增: Modal 容器
├── mindmap-flow.tsx         # 新增: React Flow 组件
├── flow-nodes/
│   └── heading-node.tsx     # 新增: 自定义 heading 节点
└── utils/
    └── layout.ts            # 新增: dagre 布局计算
```

### 数据流

```
TipTap Editor
    │
    ▼ (useHeadings hook)
Heading[] (flat array)
    │
    ├──► OutlineView (直接使用)
    │
    └──► MindmapModal
            │
            ▼ (buildTree + toFlowElements)
        { nodes: Node[], edges: Edge[] }
            │
            ▼ (dagre layout)
        Positioned nodes
            │
            ▼
        React Flow Render
```

### 核心实现

#### 1. useHeadings Hook (新增)

```typescript
// use-headings.ts
export function useHeadings(editor: Editor | null) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Extract headings from editor (从 mindlines.tsx 提取)
  useEffect(() => { /* ... */ }, [editor]);

  // Track cursor position (从 mindlines.tsx 提取)
  useEffect(() => { /* ... */ }, [editor, headings]);

  const navigateTo = useCallback((heading: Heading) => {
    editor?.chain().focus().setTextSelection(heading.pos).scrollIntoView().run();
  }, [editor]);

  return { headings, activeId, navigateTo };
}
```

#### 2. Mindlines Container (简化)

```typescript
// mindlines.tsx
export function Mindlines({ editor }: MindlinesProps) {
  const { isMindlinesOpen } = useLayoutStore();
  const { headings, activeId, navigateTo } = useHeadings(editor);
  const [isMindmapOpen, setMindmapOpen] = useState(false);

  if (!isMindlinesOpen || !editor) return null;

  return (
    <aside className="w-52 border-r h-full flex flex-col">
      <OutlineView
        headings={headings}
        activeId={activeId}
        onNavigate={navigateTo}
      />
      <div className="p-2 border-t">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setMindmapOpen(true)}
          className="w-full"
        >
          <Map className="w-4 h-4 mr-2" />
          Open Mindmap
        </Button>
      </div>
      <MindmapModal
        open={isMindmapOpen}
        onClose={() => setMindmapOpen(false)}
        headings={headings}
        activeId={activeId}
        onNavigate={(heading) => {
          navigateTo(heading);
          setMindmapOpen(false);
        }}
      />
    </aside>
  );
}
```

#### 3. MindmapModal (新增)

```typescript
// mindmap-modal.tsx
export function MindmapModal({
  open,
  onClose,
  headings,
  activeId,
  onNavigate,
}: MindmapModalProps) {
  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} className="max-w-[90vw] h-[85vh]">
      <ModalHeader onClose={onClose}>
        <span className="flex items-center gap-2">
          <GitBranch className="w-5 h-5" />
          Document Mindmap
        </span>
      </ModalHeader>
      <div className="flex-1 min-h-0">
        <MindmapFlow
          headings={headings}
          activeId={activeId}
          onNodeClick={onNavigate}
        />
      </div>
    </Modal>
  );
}
```

#### 4. MindmapFlow (新增，核心)

```typescript
// mindmap-flow.tsx
'use client';

import { useCallback, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  MiniMap,
  Background,
  useNodesState,
  useEdgesState,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { HeadingNode } from './flow-nodes/heading-node';
import { convertToFlowElements, applyDagreLayout } from './utils/layout';

// Define OUTSIDE component to prevent re-renders
const nodeTypes = { heading: HeadingNode };

function MindmapFlowInner({ headings, activeId, onNodeClick }) {
  const { fitView } = useReactFlow();

  // Convert headings to React Flow format
  const { initialNodes, initialEdges } = useMemo(
    () => convertToFlowElements(headings),
    [headings]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges] = useEdgesState([]);

  // Apply layout and update nodes
  useEffect(() => {
    const { nodes: layouted, edges: layoutedEdges } = applyDagreLayout(
      initialNodes,
      initialEdges,
      'TB'  // Top to Bottom layout
    );
    setNodes(layouted);
    setEdges(layoutedEdges);
  }, [initialNodes, initialEdges]);

  // Fit view after layout
  useEffect(() => {
    if (nodes.length > 0) {
      fitView({ padding: 0.2, duration: 300 });
    }
  }, [nodes.length, fitView]);

  // Handle node click
  const handleNodeClick = useCallback(
    (event, node) => {
      onNodeClick?.({
        id: node.id,
        level: node.data.level,
        text: node.data.label,
        pos: node.data.pos,
      });
    },
    [onNodeClick]
  );

  return (
    <ReactFlow
      nodes={nodes.map((n) => ({
        ...n,
        data: { ...n.data, isActive: n.id === activeId },
      }))}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeClick={handleNodeClick}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.1}
      maxZoom={2}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
    >
      <Background variant="dots" gap={20} size={1} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeStrokeWidth={3} />
    </ReactFlow>
  );
}

export function MindmapFlow(props) {
  return (
    <ReactFlowProvider>
      <MindmapFlowInner {...props} />
    </ReactFlowProvider>
  );
}
```

#### 5. HeadingNode (自定义节点)

```typescript
// flow-nodes/heading-node.tsx
import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';

interface HeadingNodeData {
  label: string;
  level: number;
  isActive?: boolean;
}

export const HeadingNode = memo(function HeadingNode({
  data,
}: NodeProps<HeadingNodeData>) {
  return (
    <div
      className={cn(
        'px-4 py-2 rounded-lg border shadow-sm transition-all',
        'hover:shadow-md cursor-pointer',
        // Level-based styling
        data.level === 1 && 'bg-primary text-primary-foreground font-semibold text-base',
        data.level === 2 && 'bg-accent font-medium text-sm',
        data.level === 3 && 'bg-muted text-muted-foreground text-sm',
        // Active state
        data.isActive && 'ring-2 ring-primary ring-offset-2'
      )}
    >
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <span className="block max-w-[200px] truncate">{data.label}</span>
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </div>
  );
});
```

#### 6. Layout Utils

```typescript
// utils/layout.ts
import dagre from '@dagrejs/dagre';
import type { Node, Edge } from '@xyflow/react';
import type { Heading, HeadingNode as HeadingTreeNode } from '../types';
import { buildTree } from '../use-tree';

// Convert flat headings to React Flow nodes/edges
export function convertToFlowElements(headings: Heading[]) {
  const tree = buildTree(headings);
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  function traverse(item: HeadingTreeNode, parentId?: string) {
    nodes.push({
      id: item.id,
      type: 'heading',
      position: { x: 0, y: 0 },
      data: {
        label: item.text,
        level: item.level,
        pos: item.pos,
      },
    });

    if (parentId) {
      edges.push({
        id: `${parentId}-${item.id}`,
        source: parentId,
        target: item.id,
        type: 'smoothstep',
      });
    }

    item.children.forEach((child) => traverse(child, item.id));
  }

  tree.forEach((root) => traverse(root));
  return { initialNodes: nodes, initialEdges: edges };
}

// Apply dagre layout
export function applyDagreLayout(
  nodes: Node[],
  edges: Edge[],
  direction: 'TB' | 'LR' = 'TB'
) {
  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));

  g.setGraph({
    rankdir: direction,
    nodesep: 50,
    ranksep: 80,
  });

  nodes.forEach((node) => {
    g.setNode(node.id, { width: 200, height: 40 });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const isHorizontal = direction === 'LR';
  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      targetPosition: isHorizontal ? 'left' : 'top',
      sourcePosition: isHorizontal ? 'right' : 'bottom',
      position: {
        x: pos.x - 100,
        y: pos.y - 20,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}
```

---

## Acceptance Criteria

### 功能要求
- [ ] 传统 outline 作为默认视图，无 hover 变形
- [ ] Toggle 按钮打开 Mindmap Modal
- [ ] Mindmap 使用 React Flow 渲染
- [ ] 支持 Pan/Zoom 操作
- [ ] 显示 MiniMap 导航
- [ ] 点击节点导航到文档位置
- [ ] 导航后自动关闭 Modal
- [ ] Escape 键关闭 Modal

### 视觉要求
- [ ] Modal 占据 90vw x 85vh
- [ ] 节点按层级有不同样式 (H1/H2/H3)
- [ ] 活动节点高亮显示
- [ ] Smoothstep 连接线
- [ ] Dots 背景

### 性能要求
- [ ] 支持 50+ 节点无卡顿
- [ ] Layout 计算 < 100ms
- [ ] 平滑的 fitView 动画

---

## Implementation Phases

### Phase 1: 准备工作
1. 安装 `@xyflow/react` 和 `@dagrejs/dagre`
2. 创建 `use-headings.ts` hook（从 mindlines.tsx 提取）
3. 导入 React Flow CSS

### Phase 2: 简化 Mindlines
1. 重构 `mindlines.tsx` 移除 hover 逻辑
2. 保持 `outline-view.tsx` 不变
3. 添加 "Open Mindmap" toggle 按钮

### Phase 3: 实现 Mindmap Modal
1. 创建 `mindmap-modal.tsx` 使用现有 Modal 组件
2. 创建 `mindmap-flow.tsx` React Flow 容器
3. 创建 `flow-nodes/heading-node.tsx` 自定义节点
4. 创建 `utils/layout.ts` dagre 布局函数

### Phase 4: 集成和测试
1. 连接所有组件
2. 测试导航功能
3. 测试键盘交互 (Escape 关闭)
4. 性能测试

### Phase 5: 清理 (可选)
1. 移除 `mindmap-view.tsx` (旧实现)
2. 评估是否移除 d3-hierarchy 依赖

---

## Dependencies

### 新增依赖
```bash
npm install @xyflow/react @dagrejs/dagre
```

### 现有依赖 (保留)
- React 19
- Next.js 15
- framer-motion (Modal 动画)
- TipTap Editor
- Tailwind CSS

---

## Open Questions

1. **布局方向**: 默认 TB (从上到下) 还是 LR (从左到右)?
   - 建议: **TB**，更符合文档层级的阅读习惯

2. **Modal 尺寸**: 90vw x 85vh 是否合适?
   - 建议: 可以，留有边距避免压迫感

3. **是否保留 keyboard shortcut 打开 mindmap?**
   - 建议: 可以添加，如 `Cmd+Shift+M`

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `package.json` | Modify | 添加 @xyflow/react, @dagrejs/dagre |
| `use-headings.ts` | Create | 从 editor 提取 headings 的 hook |
| `mindlines.tsx` | Modify | 移除 hover 逻辑，添加 toggle |
| `mindmap-modal.tsx` | Create | Modal 容器组件 |
| `mindmap-flow.tsx` | Create | React Flow 组件 |
| `flow-nodes/heading-node.tsx` | Create | 自定义节点 |
| `utils/layout.ts` | Create | dagre 布局 |
| `mindmap-view.tsx` | Delete | 移除旧实现 |

---

## References

### 内部参考
- 当前实现: `src/components/editor/mindlines/`
- Modal 组件: `src/components/ui/modal.tsx`
- Layout Store: `src/stores/layout-store.ts`

### 外部参考
- [React Flow Documentation](https://reactflow.dev/learn)
- [React Flow Mindmap Tutorial](https://reactflow.dev/learn/tutorials/mind-map-app-with-react-flow)
- [Dagre Layout Example](https://reactflow.dev/examples/layout/dagre)
- [React Flow GitHub](https://github.com/xyflow/xyflow)

---

*Generated with Claude Code - 2026-01-14*
