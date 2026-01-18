# feat: Outline 交互优化

## Overview

优化 doXmind Mini 的 Outline 体验，解决当前的可用性问题并添加必要的交互增强。采用最小改动原则，不引入新依赖。

## Problem Statement

### 核心问题

1. **标题显示问题** - 208px 固定宽度 + `truncate` 截断，导致长标题全是省略号，信息丢失严重
2. **折叠状态丢失** - 切换到 Mindmap 再回来，折叠状态重置
3. **缺少键盘导航** - Outline 只能鼠标点击，效率低
4. **缺少搜索** - 长文档难以快速定位

### 不需要解决的问题（YAGNI）

- ❌ 多种布局算法（径向、力导向）- 没人要求
- ❌ 视图形变动画 - 当前 fade 够用
- ❌ 移动端 Mindmap - 没有证据用户需要
- ❌ 拖拽重排 - 复杂度高，用户可在编辑器中重排
- ❌ 节点内联编辑 - 双向同步噩梦

## Proposed Solution

### 一周 MVP

```
┌─────────────────────────────────────────────┐
│  1. 修复标题显示                              │
│     - 移除 truncate，改用多行 + line-clamp   │
│     - 可拖拽调整 Outline 宽度                 │
└─────────────────────────────────────────────┘
                    ▼
┌─────────────────────────────────────────────┐
│  2. 可折叠标题                               │
│     - Chevron 图标 + 动画                    │
│     - localStorage 持久化                    │
└─────────────────────────────────────────────┘
                    ▼
┌─────────────────────────────────────────────┐
│  3. 键盘导航                                 │
│     - j/k 上下移动                           │
│     - Enter 跳转                             │
│     - ←/→ 折叠/展开                          │
└─────────────────────────────────────────────┘
                    ▼
┌─────────────────────────────────────────────┐
│  4. 搜索过滤（可选）                          │
│     - 顶部搜索框                             │
│     - 实时过滤标题                           │
└─────────────────────────────────────────────┘
```

## Technical Approach

### 1. 修复标题显示问题

**当前问题：**
```tsx
// outline-view.tsx:62
<span className="min-w-0 truncate">
  {heading.text || "Untitled"}
</span>
```

208px 宽度下，超过约 15 个字符就会被截断。

**解决方案 A：多行显示（推荐）**

```tsx
// 改为 2 行 clamp，超出才省略
<span className="min-w-0 line-clamp-2 break-words">
  {heading.text || "Untitled"}
</span>
```

**解决方案 B：可调节宽度**

```tsx
// mindlines.tsx - 添加拖拽调整宽度
const [width, setWidth] = useState(MINDLINES_WIDTH.COLLAPSED);

<ResizeHandle
  onResize={(delta) => setWidth(w => Math.max(160, Math.min(400, w + delta)))}
/>
```

**建议：两者结合** - 默认多行显示 + 可拖拽调整宽度

### 2. 可折叠标题

**数据结构：**
```typescript
// types.ts - 扩展 Heading 类型
interface HeadingNode extends Heading {
  children: HeadingNode[];
}

// 新增 hook
function useOutlineState(documentId: string) {
  const [collapsedNodes, setCollapsedNodes] = useLocalStorage<Set<string>>(
    `outline-collapsed-${documentId}`,
    new Set()
  );

  const toggle = (id: string) => {
    setCollapsedNodes(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return { collapsedNodes, toggle };
}
```

**UI 组件：**
```tsx
// outline-item.tsx
function OutlineItem({ node, depth, collapsedNodes, onToggle, onNavigate }) {
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsedNodes.has(node.id);

  return (
    <>
      <div
        className="flex items-center gap-1 py-1.5 px-2 hover:bg-accent/50 rounded"
        style={{ paddingLeft: depth * 16 }}
      >
        {/* Chevron - 只在有子节点时显示 */}
        {hasChildren ? (
          <button onClick={() => onToggle(node.id)} className="p-0.5">
            <motion.div animate={{ rotate: isCollapsed ? 0 : 90 }}>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            </motion.div>
          </button>
        ) : (
          <div className="w-4" />
        )}

        {/* 标题文本 - 多行显示 */}
        <button
          onClick={() => onNavigate(node)}
          className="flex-1 text-left line-clamp-2 break-words text-sm"
        >
          {node.text}
        </button>

        {/* 折叠时显示子节点数量 */}
        {hasChildren && isCollapsed && (
          <span className="text-xs text-muted-foreground">
            {node.children.length}
          </span>
        )}
      </div>

      {/* 子节点 - 折叠时隐藏 */}
      <AnimatePresence>
        {hasChildren && !isCollapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
          >
            {node.children.map(child => (
              <OutlineItem key={child.id} node={child} depth={depth + 1} {...props} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
```

### 3. 键盘导航

**复用 Mindmap 的模式：**
```typescript
// use-outline-keyboard.ts
function useOutlineKeyboard(
  headings: HeadingNode[],
  selectedId: string | null,
  collapsedNodes: Set<string>,
  callbacks: {
    onSelect: (id: string) => void;
    onNavigate: (heading: Heading) => void;
    onToggle: (id: string) => void;
  }
) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedId) return;

      const flatList = flattenVisibleNodes(headings, collapsedNodes);
      const currentIndex = flatList.findIndex(h => h.id === selectedId);

      switch (e.key) {
        case "j":
        case "ArrowDown":
          if (currentIndex < flatList.length - 1) {
            callbacks.onSelect(flatList[currentIndex + 1].id);
          }
          break;
        case "k":
        case "ArrowUp":
          if (currentIndex > 0) {
            callbacks.onSelect(flatList[currentIndex - 1].id);
          }
          break;
        case "Enter":
          callbacks.onNavigate(flatList[currentIndex]);
          break;
        case "ArrowLeft":
          callbacks.onToggle(selectedId); // 折叠
          break;
        case "ArrowRight":
          callbacks.onToggle(selectedId); // 展开
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [headings, selectedId, collapsedNodes, callbacks]);
}
```

### 4. 共享折叠状态

**修复 Window Event 反模式：**

当前代码使用 `window.dispatchEvent` 处理折叠状态，这是反模式。改用共享 store：

```typescript
// stores/outline-store.ts
interface OutlineState {
  collapsedNodes: Record<string, Set<string>>; // documentId -> collapsed node IDs
  selectedNode: string | null;

  toggleCollapse: (documentId: string, nodeId: string) => void;
  setSelected: (nodeId: string | null) => void;
}

export const useOutlineStore = create<OutlineState>()(
  persist(
    (set) => ({
      collapsedNodes: {},
      selectedNode: null,

      toggleCollapse: (docId, nodeId) => set((state) => {
        const docNodes = state.collapsedNodes[docId] || new Set();
        const newNodes = new Set(docNodes);
        if (newNodes.has(nodeId)) newNodes.delete(nodeId);
        else newNodes.add(nodeId);
        return {
          collapsedNodes: { ...state.collapsedNodes, [docId]: newNodes }
        };
      }),

      setSelected: (nodeId) => set({ selectedNode: nodeId }),
    }),
    { name: "outline-state" }
  )
);
```

**在 Mindmap 中使用同一 store：**
```tsx
// mindmap-flow.tsx
const { collapsedNodes, toggleCollapse } = useOutlineStore();

// 替换 window.dispatchEvent，直接调用 store action
<HeadingNode
  data={{
    ...nodeData,
    onToggleCollapse: () => toggleCollapse(documentId, nodeData.id)
  }}
/>
```

## File Changes

```
src/components/editor/mindlines/
├── outline-view.tsx          # 重构：递归渲染 + 多行显示
├── outline-item.tsx          # 新增：单个标题项组件
├── use-outline-keyboard.ts   # 新增：键盘导航 hook
├── mindmap-flow.tsx          # 修改：使用 shared store
└── flow-nodes/
    └── heading-node.tsx      # 修改：移除 window.dispatchEvent

src/stores/
└── outline-store.ts          # 新增：折叠状态 store

src/lib/constants.ts          # 修改：添加 OUTLINE_* 常量
```

## Dependencies

**不添加任何新依赖。** 使用现有的：
- `framer-motion` - 折叠动画
- `zustand` + `persist` - 状态持久化

## Acceptance Criteria

### 必须完成

- [ ] 长标题显示 2 行，超出才省略
- [ ] 有子标题的节点显示 chevron 折叠图标
- [ ] 点击 chevron 折叠/展开子节点，带动画
- [ ] 折叠状态保存到 localStorage，刷新后保留
- [ ] 切换到 Mindmap 再回来，折叠状态保留
- [ ] j/k 上下导航，Enter 跳转到编辑器
- [ ] ←/→ 折叠/展开当前节点

### 可选完成

- [ ] 可拖拽调整 Outline 宽度（160-400px）
- [ ] 顶部搜索框过滤标题
- [ ] Ctrl+Shift+[ 全部折叠，Ctrl+Shift+] 全部展开

### 不做

- ❌ 多种 Mindmap 布局算法
- ❌ 视图形变动画
- ❌ 移动端 Mindmap
- ❌ 拖拽重排
- ❌ 节点内联编辑
- ❌ 任何新依赖

## Estimated Effort

| 任务 | 预估 |
|------|------|
| 修复标题显示 + 多行 | 2h |
| 递归组件 + 折叠 UI | 4h |
| 状态持久化 store | 2h |
| 键盘导航 | 3h |
| 修复 window.dispatchEvent | 2h |
| 测试 & 调试 | 3h |
| **总计** | **~2 天** |

## Success Metrics

| Metric | Before | After |
|--------|--------|-------|
| 可见标题文字量 | ~15 字/行 | ~30 字/2行 |
| 状态持久性 | 0% | 100% |
| 键盘可达性 | 仅 Mindmap | Outline + Mindmap |

## References

### Internal
- `/src/components/editor/mindlines/outline-view.tsx` - 当前实现
- `/src/components/editor/mindlines/use-mindmap-keyboard.ts` - 键盘导航参考
- `/src/stores/layout-store.ts` - Zustand store 模式参考

### External
- [Framer Motion AnimatePresence](https://motion.dev/docs/react-animate-presence)
- [Zustand Persist Middleware](https://zustand.docs.pmnd.rs/middlewares/persist)
