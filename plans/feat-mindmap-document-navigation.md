# feat: 思维导图文档导航 (Mindmap Document Navigation)

> 用思维导图替代传统大纲，帮助用户快速了解文档结构和内容，实现结构化/直观理解。

## Overview

传统的文档大纲(Outline)以线性列表形式展示标题层级，虽然功能完整但视觉上不够直观。本功能利用思维导图(Mindmap)的可视化优势，将文档的 H1-H4 标题层级以节点-连线的形式展示，让用户能够：

- **一眼看清文档全貌** - 节点大小/颜色区分层级
- **快速导航** - 点击节点跳转到对应位置
- **实时同步** - 编辑标题时导图自动更新

## Problem Statement / Motivation

**用户痛点：**
1. 长文档难以把握整体结构
2. 传统大纲视觉层次不够直观
3. 需要频繁滚动来定位章节

**产品机会：**
- 竞品(Notion/Obsidian)虽有大纲但无可视化导图
- 利用 TipTap + React Flow 技术栈可低成本实现
- 符合"Cursor for Writing"的差异化定位

## Proposed Solution

### 展示效果设计

```
┌─────────────────────────────────────────────────────────────────┐
│ [Toggle] Mindmap                                          [─][×]│
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│     ┌──────────┐                                                │
│     │ 文档标题  │ ←── H1 (大节点, 蓝色)                          │
│     │   H1     │                                                │
│     └────┬─────┘                                                │
│          │                                                      │
│    ┌─────┴─────┐                                                │
│    │           │                                                │
│ ┌──┴───┐   ┌───┴──┐                                             │
│ │第一章 │   │第二章│ ←── H2 (中节点, 青色)                        │
│ │  H2  │   │  H2  │                                             │
│ └──┬───┘   └───┬──┘                                             │
│    │           │                                                │
│ ┌──┴──┐     ┌──┴──┐                                             │
│ │1.1节│     │2.1节│ ←── H3 (小节点, 绿色)                        │
│ │ H3  │     │ H3  │                                             │
│ └─────┘     └─────┘                                             │
│                                                                 │
│ [Zoom: 100%] [Fit] [←→ LR / ↑↓ TB]                              │
└─────────────────────────────────────────────────────────────────┘
```

### 核心交互

| 操作 | 行为 |
|------|------|
| **点击节点** | 编辑器平滑滚动到对应标题位置，高亮 2 秒 |
| **编辑器滚动** | 当前可见标题在导图中高亮显示（双向同步） |
| **添加/删除标题** | 导图自动更新，动画过渡 |
| **修改标题文字** | 节点文字实时更新（300ms 防抖） |
| **缩放/平移** | 鼠标滚轮缩放，拖拽平移 |
| **布局切换** | 支持 LR(左右) / TB(上下) 两种布局 |

### 视觉层级设计

| 级别 | 节点大小 | 颜色 | 字重 |
|------|---------|------|------|
| H1 | 200×50 | `#e3f2fd` (蓝) | Bold |
| H2 | 180×44 | `#e0f7fa` (青) | Semibold |
| H3 | 160×38 | `#e8f5e9` (绿) | Normal |
| H4 | 140×32 | `#fff3e0` (橙) | Normal |

## Technical Approach

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Components                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │   Editor     │───▶│ MindmapStore │◀───│  Mindmap     │       │
│  │  (TipTap)    │    │  (Zustand)   │    │ (ReactFlow)  │       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
│         │                   │                   │               │
│         ▼                   ▼                   ▼               │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │  onUpdate    │    │  headings[]  │    │   Dagre      │       │
│  │  (debounced) │    │  activeId    │    │  (layout)    │       │
│  └──────────────┘    │  visibility  │    └──────────────┘       │
│                      └──────────────┘                           │
└─────────────────────────────────────────────────────────────────┘
```

### 数据流

```
1. Editor Content Change
   └─▶ TipTap onUpdate (debounced 300ms)
       └─▶ extractHeadings(editor.getJSON())
           └─▶ MindmapStore.setHeadings()
               └─▶ React Flow re-render
                   └─▶ Dagre layout calculation

2. Mindmap Node Click
   └─▶ onNodeClick(headingPos)
       └─▶ editor.commands.setTextSelection(pos)
           └─▶ editor.commands.scrollIntoView()
               └─▶ highlight animation

3. Editor Scroll (bidirectional sync)
   └─▶ IntersectionObserver on headings
       └─▶ MindmapStore.setActiveHeadingId()
           └─▶ Mindmap node highlight
```

### 新增文件

| 文件路径 | 说明 |
|---------|------|
| `src/components/mindmap/document-mindmap.tsx` | 主组件，包含 React Flow 渲染 |
| `src/components/mindmap/mindmap-node.tsx` | 自定义节点组件 |
| `src/components/mindmap/mindmap-controls.tsx` | 控制栏（缩放、布局切换） |
| `src/stores/mindmap-store.ts` | Zustand store |
| `src/lib/document-structure.ts` | 标题提取和层级构建工具函数 |
| `src/hooks/use-heading-sync.ts` | 编辑器与导图双向同步 hook |

### 依赖

```bash
npm install @xyflow/react @dagrejs/dagre
```

## Implementation Phases

### Phase 1: 基础功能

- [ ] 创建 `document-structure.ts` - 从 TipTap JSON 提取标题层级
- [ ] 创建 `mindmap-store.ts` - Zustand store 管理导图状态
- [ ] 创建 `document-mindmap.tsx` - React Flow 基础渲染
- [ ] 集成 Dagre 实现自动布局
- [ ] 实现点击节点导航到编辑器位置

### Phase 2: 完善体验

- [ ] 添加视觉层级样式（节点大小/颜色）
- [ ] 实现实时同步（编辑器内容变化 → 导图更新）
- [ ] 添加双向高亮（编辑器滚动 → 导图节点高亮）
- [ ] 添加展开/折叠动画
- [ ] 实现布局切换（LR/TB）

### Phase 3: 优化与打磨

- [ ] 添加空状态提示（无标题时）
- [ ] 实现节点文字截断 + Tooltip
- [ ] 添加键盘导航支持
- [ ] 性能优化（大文档虚拟化）
- [ ] 添加 `prefers-reduced-motion` 支持

## Acceptance Criteria

### 功能要求

- [ ] 打开文档时自动显示思维导图
- [ ] 点击导图节点，编辑器平滑滚动到对应位置
- [ ] 编辑标题时，导图在 500ms 内更新
- [ ] 支持 H1-H4 四个层级
- [ ] 支持切换 LR/TB 布局
- [ ] 导图面板可显示/隐藏

### 边缘情况

- [ ] 空文档显示友好提示："添加标题以查看文档结构"
- [ ] 超长标题（>50字符）截断显示，hover 展示完整
- [ ] 文档结构跳级（如 H1 直接到 H4）正常显示
- [ ] 重复标题文字通过位置区分，导航正确

### 性能要求

- [ ] 100 个标题以内，布局计算 < 100ms
- [ ] 500 个标题显示警告，提供简化视图选项
- [ ] 编辑器输入延迟 < 16ms（不阻塞主线程）

### 无障碍要求

- [ ] 键盘可导航（Tab 进入，方向键切换，Enter 激活）
- [ ] ARIA tree role 支持屏幕阅读器
- [ ] 支持 `prefers-reduced-motion`
- [ ] 节点颜色对比度符合 WCAG AA

## Success Metrics

| 指标 | 目标 |
|------|------|
| 功能采用率 | >30% 用户使用过导图面板 |
| 导航效率 | 点击节点到达目标 < 500ms |
| 用户反馈 | 正面评价 > 80% |

## Dependencies & Risks

### 依赖

- `@xyflow/react` - React Flow 可视化库
- `@dagrejs/dagre` - 图布局算法库
- TipTap `getJSON()` API 稳定性

### 风险

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|---------|
| 大文档性能问题 | 中 | 高 | 虚拟化 + 节点数量限制 |
| React Flow 学习曲线 | 低 | 中 | 参考官方 mindmap 示例 |
| 双向同步复杂性 | 中 | 中 | 先实现单向，再迭代双向 |

## References & Research

### Internal References

- 编辑器组件: `src/components/editor/editor.tsx`
- 文件状态管理: `src/stores/file-store.ts`
- 编辑器状态管理: `src/stores/editor-store.ts`
- 布局状态管理: `src/stores/layout-store.ts`
- 搜索扩展(参考遍历模式): `src/extensions/search-extension.ts`

### External References

- [React Flow Documentation](https://reactflow.dev)
- [React Flow Mindmap Tutorial](https://reactflow.dev/learn/tutorials/mind-map-app-with-react-flow)
- [TipTap getJSON API](https://tiptap.dev/docs/editor/api/editor#getjson)
- [TipTap Events](https://tiptap.dev/docs/editor/api/events)
- [Dagre Layout Algorithm](https://github.com/dagrejs/dagre)
- [W3C ARIA Tree View Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/)

### 竞品参考

- Obsidian Graph View - 全局关系图
- Notion Table of Contents - 自动生成目录
- Logseq Whiteboards - 白板式思维导图

---

## MVP Implementation

### `src/lib/document-structure.ts`

```typescript
interface HeadingNode {
  id: string;
  level: 1 | 2 | 3 | 4;
  text: string;
  pos: number;
  children: HeadingNode[];
}

export function extractHeadingsFromJSON(json: JSONNode): HeadingNode[] {
  const headings: Array<{ level: number; text: string; pos: number }> = [];
  let position = 0;

  function traverse(node: JSONNode) {
    if (node.type === 'heading' && node.attrs?.level) {
      headings.push({
        level: node.attrs.level as number,
        text: node.content?.map(c => c.text || '').join('') || '',
        pos: position,
      });
    }
    position += 1;
    node.content?.forEach(traverse);
  }

  json.content?.forEach(traverse);
  return buildHierarchy(headings);
}
```

### `src/stores/mindmap-store.ts`

```typescript
import { create } from 'zustand';
import type { HeadingNode } from '@/lib/document-structure';

interface MindmapState {
  headings: HeadingNode[];
  activeHeadingId: string | null;
  isVisible: boolean;
  layoutDirection: 'LR' | 'TB';

  setHeadings: (headings: HeadingNode[]) => void;
  setActiveHeadingId: (id: string | null) => void;
  toggleVisibility: () => void;
  setLayoutDirection: (dir: 'LR' | 'TB') => void;
}

export const useMindmapStore = create<MindmapState>((set) => ({
  headings: [],
  activeHeadingId: null,
  isVisible: true,
  layoutDirection: 'LR',

  setHeadings: (headings) => set({ headings }),
  setActiveHeadingId: (id) => set({ activeHeadingId: id }),
  toggleVisibility: () => set((s) => ({ isVisible: !s.isVisible })),
  setLayoutDirection: (dir) => set({ layoutDirection: dir }),
}));
```

### `src/components/mindmap/document-mindmap.tsx`

```typescript
'use client';

import { useCallback, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
} from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import { useMindmapStore } from '@/stores/mindmap-store';

import '@xyflow/react/dist/style.css';

export function DocumentMindmap({ onNodeClick }: { onNodeClick: (pos: number) => void }) {
  const { headings, layoutDirection, activeHeadingId } = useMindmapStore();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  useEffect(() => {
    const { flowNodes, flowEdges } = convertHeadingsToFlow(headings, activeHeadingId);
    const layouted = getLayoutedElements(flowNodes, flowEdges, layoutDirection);
    setNodes(layouted.nodes);
    setEdges(layouted.edges);
  }, [headings, layoutDirection, activeHeadingId]);

  const handleNodeClick = useCallback((_, node: Node) => {
    if (node.data.pos !== undefined) {
      onNodeClick(node.data.pos);
    }
  }, [onNodeClick]);

  if (headings.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        添加标题以查看文档结构
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={handleNodeClick}
      fitView
    >
      <Background />
      <Controls />
    </ReactFlow>
  );
}
```

---

*Plan created: 2026-01-14*
