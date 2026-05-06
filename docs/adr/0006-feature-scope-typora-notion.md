# 功能广度：大于 Typora，小于 Notion

doXmind 在能做和不能做之间没有显式的边界。任何"能加一个 Notion 风的小 feature"的提案都很容易通过——单看每个 feature 都不重，但叠在一起会让产品偏离"本地 markdown IDE"的定位，重蹈 Notion 的功能膨胀。

之所以记录这条决定，是因为这个边界一旦松动就回不来：每个加进来的 feature 都有对应的 sidecar 字段、UI 入口、序列化路径。等再来一次"我们其实不需要这个"的产品收敛时，要拆掉的代码面积已经成倍了。

**决定**：

1. **底线（floor）**——任何标准 markdown 文件在 doXmind 里的**浏览体验**至少和 Typora 等同。这是**不可让步**的：用户拿一个 GitHub README 进来打开，应该看到正确渲染、正确分段、正确表格、正确代码高亮。
2. **上限（ceiling）**——不引入只在 Notion 文档系统里成立的 feature。例如：跨文档 backlink 自动反查、databases 作为视图层（已计划移除）、嵌套 page 的 access control、@mention with notification、comments、suggestions/track changes、collaborative cursor。这些不会被加进来，加进来也会被砍。
3. **原则冲突时**——保 markdown 浏览。具体说：当一条 Notion 风的便捷功能（自动转换、quick action、智能建议）会改变标准 markdown 的解读方式时，那条功能要么不加，要么作用域被显式约束。

**应用过的例子**：

### Math equation 的作用域

doXmind 支持两种 math 表达：

- **Inline math**：`$<latex>$`（同行，与文本混排）
- **Block math**：`$$<latex>$$`（独占一块）

**作用域（在哪些上下文 doXmind 会自动识别 `$...$` / `$$...$$`）**：

| 上下文                             | inline `$...$` | block `$$...$$` | 备注                                             |
| ---------------------------------- | -------------- | --------------- | ------------------------------------------------ |
| 段落                               | ✅             | ✅              | 默认                                             |
| 标题（h1–h6）                      | ✅             | —               | block 不能进 inline 上下文                       |
| 列表项（ul / ol / task）           | ✅             | ✅              |                                                  |
| Blockquote                         | ✅             | ✅              |                                                  |
| Callout 内容                       | ✅             | ✅              |                                                  |
| Toggle 内容                        | ✅             | ✅              |                                                  |
| 多列布局（columns）                | ✅             | ✅              |                                                  |
| **Table cell / header**            | ❌             | ❌              | **显式约束**，理由见下                           |
| Code block（fenced ` ```...``` `） | ❌             | ❌              | 由 marked / ProseMirror 的 verbatim 语义自然屏蔽 |
| Inline code（`` `...` ``）         | ❌             | —               | 同上                                             |

**为什么 cell 内不识别**：用户在 cell 里打 `$100`、`$x`、`$myvar` 是高频的金额、占位符、Shell 变量表达；把它们识别成 LaTeX 破坏 markdown 浏览体验。cell 内写公式是非常长尾的需求，收益远小于代价。

**实现**（[`inline-math.ts`](../../src/extensions/math/inline-math.ts), [`block-math.ts`](../../src/extensions/math/block-math.ts), [`markdown.ts`](../../src/lib/markdown.ts), [`disk-storage-adapter.ts`](../../src/lib/storage/disk-storage-adapter.ts)）—— cell 内禁用，四条路径都堵：

| 路径                        | 触发场景                                                                            | 实现                                                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **InputRule**               | 用户在 cell 里键入 `$x$ `                                                           | handler 里调 `isInsideTableCell(state.doc, range.from)` 时 `return null`                                                                    |
| **PasteRule**               | 用户往 cell 里粘贴含 `$...$` 的文本                                                 | 同上                                                                                                                                        |
| **Markdown 读盘**（client） | `markdownToHtml` 用 `marked` 解析 `.md`，cell 内的 `$...$` 被 tokenize 成 math span | `unwrapMathInTableCells(html)` 在出口扫 DOM，把 `:is(td,th) [data-type="inline-math"                                                        | "block-math"]`反 unwrap 成`$<latex>$` 文本节点 |
| **Server / sidecar HTML**   | 后端 `markdown_to_html` 现解析 + 直接吐 sidecar `html` 字段                         | 同一个 `unwrapMathInTableCells` 在 [`disk-storage-adapter.read`](../../src/lib/storage/disk-storage-adapter.ts) 的 `result.html` 边界跑一遍 |

**Round-trip 性质**：cell 里出现的 `$x$` 永远是普通字符序列。保存回 markdown 仍是 `$x$`，下次再读 → marked 解析 → 仍被 `unwrapMathInTableCells` 反 unwrap → 文本。文件内容不变形，编辑器视图也不变形。

**未实现的路径（明确不做）**：

- **TipTap 的程序化插入**（`editor.commands.insertContent({ type: 'inlineMath' })` 在 cell 内）—— 不堵。理由：这是 doXmind 内部代码主动插入，不是用户路径；调用方有责任。
- **Schema 层禁止 `inlineMath` / `blockMath` 出现在 `tableCell.content`** —— 不做。理由：会让历史编辑器 state 在加载时 schema reject，造成数据丢失。当前 4 条用户路径全堵已经覆盖所有合法入口。

**后果**：

- 任何"是否要加 X feature"的讨论先回答两个问题：(a) X 在标准 markdown 文件浏览路径上是中性的，还是改变解读？(b) X 是不是只在 Notion 文档协作场景下才有意义？任一答案是"是"，默认不加。
- 已有功能里那些**只服务 Notion 体验、不服务 markdown 浏览**的部分（如 page-link 的 cover banner 预览、document icon、cover image）位于"上限"附近。它们今天没被砍是因为代价低（局部、可关），但任何**扩张**它们的提案都要重新走这条 ADR。
- 这条 ADR 不阻止 Notion 风的**编辑增强**——slash command、block handle、bubble menu 这些让"在 doXmind 里写 markdown"比 vim 顺手的能力都是合理的，因为它们提升的是**编辑**而不是改变浏览语义。
