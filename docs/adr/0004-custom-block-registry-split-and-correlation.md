# Custom Block 注册表拆分 + Block correlation 自动处理 + 报告

doXmind 有两类 **Custom Block**：**Self-contained**（mermaid、callout、math、toggle、page-link——全部状态在 markdown 文本里）和 **External-reference**（PDF 块、Excel 块——markdown 里只有占位符 + 引用外部文件 + 编辑状态住在 Extras）。两类块的复杂度差距巨大，统一注册表会让简单的块支付外部引用块的成本。

External-reference 块在 markdown 占位符、TipTap node、Extras slot 三处由一个 `id` 串联，称为 **Block correlation**。这条对应关系在用户从 doXmind 之外编辑 markdown 时容易破裂（删占位符 → 孤儿 slot；复制粘贴占位符 → 重复 id；外部添加 → 新 id 找不到 slot）。今天没有任何代码守护这条不变量，bug 表现为静默数据丢失或两个块互相覆盖。

**决定**：

1. **注册表拆成前后端两半，各管一类职责**：
   - **前端 `CustomBlockExtensions`**：所有 Custom Block（self-contained + external-reference）的完整 TipTap 扩展（markdown ↔ HTML、ProseMirror schema）
   - **后端 `ExternalRefBlockRegistry`**：**只**包含 external-reference 块。每项声明 id 提取规则、`slot_key_for_id`、hydration mode、salvage 规则、orphan/duplicate/new 策略
   - **共享契约**：`docs/sidecar-format.md` 规范 Block placeholder 语法和 block_type 词表

2. **Block correlation 在 `MarkdownDocumentState.read` 内部自动跑**：每次 read 扫一遍 markdown 提取所有 External-reference 占位符，和 Extras slot 集合做集合运算。对每种破裂事件按块类型注册的策略自动处理（**Layer 1 — Resolution**），同时把发生的事件列在 ReadOutcome 的 `correlation` 字段（**Layer 2 — Reporting**）。调用方可以忽略报告（最简路径）或消费（UI 提示、日志）。

3. **PDF 块 / Excel 块的默认策略**：`on_orphan = DISCARD`；`on_duplicate = ERROR`（拒绝读，要求用户修正 markdown）；`on_new = EMPTY`。理由分别是：用户外部删占位符是明确意图、重复 id 是数据完整性事故必须显式处理、新 id 走默认初始化最自然。

**理由**：

- **Self-contained 块本来就不需要后端协调**——HTML 注释占位符在标准 markdown→HTML 转换里自动透传，前端 TipTap 直接 parseHTML。把它们留在后端注册表里只是负担。拆分让后端注册表小到 2 项（PDF/Excel），简单到能背下来。
- **(d) per-block-type 策略 + 报告**优于纯自动（沉默数据丢失，正是 #1 想消灭的 bug 类）和纯报告（每个调用方都要写一遍处理代码，又散落了）。报告是 opt-in 的，最简调用方不感知。
- **HTML 注释占位符**让后端从不需要"懂" Custom Block 的内部，它只需要知道"如何识别 External-reference 占位符的 id"。这是 #4 设计里最大的简化机会。

**后果**：

- 添加新 Self-contained 块（如 footnote、todo-list）零后端改动。
- 添加新 External-reference 块需要前端完整扩展 + 后端最小注册（5 个字段：block_type、id 提取、slot_key、hydration、3 个策略 + salvage）。
- 任何"统一注册表 / 后端也做完整 markdown ↔ HTML 转换"的提案应该先订正这条 ADR——它绕开了"两份实现总会漂移"的教训。
- 任何"Block correlation 不主动报告，让调用方自己扫 markdown"的提案同上——会让每个调用方重新发明一遍 correlation 逻辑。
