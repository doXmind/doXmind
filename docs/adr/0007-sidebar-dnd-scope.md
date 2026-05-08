# Sidebar DnD：三条作用域硬边界

## 背景

Sidebar 的 drag-and-drop 体验从 "只能拖 file 行 / folder 不能拖 / 不接外部 drop" 拉到 VSCode 主流水平的过程中，有几条 "看似可以顺手做" 的功能被显式拒绝。它们之所以单独立 ADR，是因为每一条都对着一个有名有姓的对照系统（Notion、VSCode、Obsidian）说 "我们不那样做"，下次再有 "为什么 doXmind 不像 X 那样" 的提案时，应该回到这条 ADR 重新论证，而不是悄悄把边界推回去。

三条决定**互相独立**，各自的精度和理由不一样，所以分三节写。

详细的 PRD 在 [#63](https://github.com/doXmind/local-desk/issues/63)。本 ADR 把其中作用域级别的决定固化下来。

## 决定 1：Sibling 顺序由 `sortBy` 决定，不接受用户拖拽手动排序

**决定**：sidebar 里同级 item 的顺序永远由现有的 `sortBy` setting（按名字、修改时间等）决定。drag-and-drop 用来**改 parent**（move 一个 file/folder 到另一个 folder 下），不用来**改 sibling 顺序**。Notion 风的 "拖动到两个 sibling 中间产生新顺序" 不做。

**理由**：

延续 [ADR 0001](0001-markdown-is-the-only-first-class-document.md) "用户硬盘 = 真相来源"。Sibling 顺序在硬盘上**没有自然存放点**——POSIX 文件系统不存目录内的顺序，列目录的结果由 inode 决定，每个工具（Finder、`ls`、VSCode、git）都按自己的 sort 重新排。要保留用户的手动顺序就必须在 doXmind 内部存一份索引（per-folder `.doxmind-order` 文件，或 `.doxmind/index.json` 加一个 ordering 字段），这立刻产生**第二个真相来源**：

- 用户在 Finder 里改了文件名，doXmind 的 order 索引里那一项是孤儿。
- 用户在外部加了个新文件，索引里没它，要 fallback 到某种默认位置——又回到 sortBy。
- 索引和硬盘不同步时哪个赢？无论选谁都违反 "硬盘 = 真相"。

这条与 [ADR 0006](0006-feature-scope-typora-notion.md) 也同向：手动排序是 Notion 文档系统的核心交互之一（database 视图、page tree 内的 ordering），不是标准 markdown 文件浏览路径上的能力。doXmind 的定位在 markdown IDE，不复刻 Notion 的 page tree 模型。

**考虑过的替代**：

- **per-folder `.doxmind-order` 索引文件**——拒绝。每个目录多一个 doXmind 写的文件，污染用户硬盘视图；用户在 Finder 里 rename / move 时索引立刻 drift；和 ADR 0001 的 "用户文件 vs doXmind 文件" 边界冲突。
- **统一存到 `~/.doxmind/index.json` 或 sidecar `extras` 里**——拒绝。同样的双真相问题，只是把孤儿索引集中到一个文件。`index.json` 这个槽位是为 id 稳定性设计的（让 doXmind 在 file 被外部 rename 后还能通过 stable id 识别它），不是 UI 顺序的家。
- **拖到两个 sibling 中间触发自动 rename（前缀加数字 `01-`、`02-`）**——拒绝。这把"我想换顺序"翻译成"我想批量改文件名"，对用户的真实文件做了 doXmind 自己的强约定，也违反 ADR 0001。

**后果**：

- sidebar DnD 没有 "插入线" 视觉反馈（drop 落点之间的横线），也不会有。插入线意味着精度，而我们在那个轴上没有精度。
- 任何 "用户希望手动排顺序" 的 issue 默认引到这条 ADR；要重新打开必须给出新理由，并且同时论证为什么双真相问题这次能解决。
- 未来如果要做 Notion 风的 page tree（跨 doc 的层级 + 顺序），那是另一个产品决策，需要先回到 ADR 0001 / ADR 0006 重新订正——不是顺手在 sidebar 加一个交互。

## 决定 2：External DnD 永远 copy，不支持修饰键 Move

**决定**：从 OS 文件管理器（Finder / Explorer）拖 `.md` / `.pdf` / `.xlsx` 进 sidebar 时，行为永远是 **copy**——源文件保留在原位置，新副本进 workspace。不实现 "按住 ⌘ / Shift / Ctrl 改成 move" 的修饰键语义。

**理由**：

HTML5 DnD 和 Tauri 2 都**没法可靠地展示 "修饰键感知" 的光标**。具体的失败模式：

- HTML5 `dragstart` 时设的 `effectAllowed` 和 `dragover` 时改的 `dropEffect` 在 macOS / Windows / Linux 之间不一致。某些组合下浏览器自己接管光标渲染，忽略 JS 的 dropEffect。
- Tauri 2 的 `tauri://drag-drop` 事件不暴露当前修饰键状态——drop 落地时才能从 OS event 读到，但那时光标已经定型。
- 用户按下 ⌘ 的瞬间，光标不会立即翻成 "move" 形态——他在**看到 copy 光标**的状态下松手，但代码里收到的是 "move 意图"。

后果是用户**看到光标说 copy 但实际 move**，或反过来。在 copy / move 这条轴上**说谎**，错误代价不对称：

- 错把 copy 当 move：用户预期 Downloads 里那份会消失，结果还在——多一个文件，恼人但**可恢复**（手动删掉就行）。
- 错把 move 当 copy：用户的 Downloads / Desktop 上的源文件**被静默删除**——这是 "用户硬盘 = 真相来源" 模型下最严重的失败模式。

`always copy` 把决策从 "光标对不对得上修饰键" 这条不可靠的轴上移开。worst case 是 workspace 里多一份用户能看见、能删的副本；不会出现 "我源文件去哪了" 这种隐蔽损失。

**考虑过的替代**：

- **drop 时读修饰键，按当时的状态决定 copy/move**——拒绝。光标在 drop 之前撒过谎了，决策窗口已经错过；用户不会因为 drop 那一瞬间代码读对了修饰键就回溯改变意图。
- **应用内显示一个 banner / overlay "当前是 Copy，按 ⌘ 切换 Move"**——拒绝。drop 决策发生在松手那一刻，不是 hover 那一刻。banner 文案再好，用户在松手前最后一眼看到的是**系统光标**，banner 提供的信息从来不是判断依据。
- **复制 Obsidian 的 "Move to system Trash / Permanently delete" 模式给一个明确 dropdown**——和 sidebar DnD 的体验目标冲突（"拖一下就完事"）；引入一次 modal 反问 "要 copy 还是 move" 等于告诉用户 DnD 不可靠。

**后果**：

- 用户想要 move 语义时只能走 OS 文件管理器手动剪切粘贴。我们承担了这个体验损失，换来"DnD 永远不删用户源文件"的硬保证。
- 如果 HTML5 DnD / Tauri 未来在某个版本里支持了可靠的修饰键光标，这条规则可以重新评估——但需要先在三个 OS 上都验证过光标语义，再来订正这条 ADR。
- 配套的 collision 处理（重名时弹 `ImportConflictModal` 让用户选 Cancel / Replace / Keep both）是这条决定的延伸：copy 唯一的副作用面是目标文件名空间，所以我们在那一面上提供**显式选择**，绝不静默覆盖。

## 决定 3：Folder 重名拒绝，不做 Merge / Replace

**决定**：把 folder A 拖到一个**已有同名 folder** 的目标位置时，操作 reject——toast 提示 "Folder already exists at destination"，不做任何动作。**不**实现 VSCode 风的 "merge：把 A 内容合并进目标 folder" 也**不**实现 Replace。要继续就必须先手动 rename。

文件层面的重名（拖 `Notes.md` 到已有 `Notes.md` 的目标）走 `ImportConflictModal` 让用户选 Cancel / Replace / Keep both——那是另一条规则，由决定 2 的延伸覆盖。本节只管 folder。

**理由**：

VSCode 在 explorer 里支持 folder 重名时弹一个 "Merge / Replace / Cancel" 对话框，folder 内容递归合并，sub-file 重名再问一次。它在开发者场景里是合理的：

- 开发者重组源码树时，merge 是有明确意图的操作（"把 `src/utils/` 合并进 `src/lib/`"）。
- 开发者熟悉 git，merge 出问题随时能 reset。
- 文件系统对开发者来说**就是工作台**，不是文档收纳。

doXmind 的用户拖 folder 不是这个场景。延续 [ADR 0006](0006-feature-scope-typora-notion.md) "notes-IDE 而不是 Notion / 不是 VSCode" 的定位：notes 用户在 workspace 里拖 folder 是**整理笔记**，他对 folder 的心智模型是 Finder 式的——"同一个位置不能有两个同名的东西，不然我自己也找不到"。在这个心智模型里，silent merge 会**打乱用户的导航路径**：

- 用户以为 "Old Notes/" 还是那个独立的子树，下次找不到了，因为它已经被 merge 进 "Notes/"。
- merge 的 sub-file 重名又会触发二级决策，用户做完 folder 那次决策之后还要做 N 次 file 决策，错一次就丢东西。
- 没有 git 兜底，没有显式 undo。

reject 这条简单到不需要解释——用户立刻知道 "我得先 rename 一个再来"，符合 Finder / OS 习惯。

**考虑过的替代**：

- **VSCode 风格 Merge + 二级冲突解决 UI**——拒绝。在 notes 场景下是重 UI 解决长尾 case；并且 silent-merge 的失败模式（用户事后发现东西被搬到不预期的位置）属于 "用户的真相被静默动过" 这一类，跟 [ADR 0005](0005-delete-uses-os-trash.md) 拒绝 doXmind 内部 trash 是同一系列原则：用户文件不被悄悄重组。
- **Replace folder（删掉目标 folder + 把源 folder 放过去）**——拒绝。递归删 folder 里所有文件 + sidecar 是高破坏性操作，没有显著意义上的 "undo"（OS trash 里会有几十条散乱的条目，恢复路径远不如 rename 清楚）。
- **自动 rename `Old Notes (2)/`**——拒绝。用户拖 folder 的意图通常是 "搬到这里"，不是 "搬到这里并改个奇怪名字"。自动改名生成的 `(2)` 后缀在 file 重名场景里是 keep-both 的明确选项，但在 folder 场景下变成系统替用户做了语义决策（"你显然是想保留两个独立的 Old Notes"），多数情况下不对。

**后果**：

- folder 重名永远要手动 rename 一边，没有 silent path。这是显式的体验摩擦换 "用户文件不被悄悄重组" 的硬保证。
- 这条规则和 file 层面的 Replace（决定 2 延伸的 `ImportConflictModal`）**不对称**——file 层面允许 Replace 是因为 sidecar 的 Stale / Salvage 路径（[ADR 0002](0002-hybrid-hydration-for-custom-blocks.md)）兜底了 Extras；folder 层面没有对等机制（folder 没有 sidecar，没有 Salvage）。这个不对称是有意的，不是疏漏。
- 任何 "VSCode 都做了我们为什么不做" 的提案要先回答两个问题：(a) doXmind 的目标用户是开发者还是 notes 用户？(b) 我们准备好承担 silent-merge 的失败模式（用户事后发现被搬过的子树）了吗？任一答案让我们犹豫，就维持 reject。

## 关联

- [ADR 0001 — Markdown 是唯一的 first-class document type](0001-markdown-is-the-only-first-class-document.md) — "用户硬盘 = 真相" 是决定 1 的直接依据
- [ADR 0002 — Custom Block 混合 hydration mode](0002-hybrid-hydration-for-custom-blocks.md) — 决定 2 中 file Replace 的 sidecar 处理走 Stale / Salvage 路径，不破坏 Extras
- [ADR 0005 — Delete 走 OS 回收站](0005-delete-uses-os-trash.md) — "用户文件不被悄悄动" 这条原则的同系列决定，folder 不 merge 与之同向
- [ADR 0006 — 功能广度：大于 Typora，小于 Notion](0006-feature-scope-typora-notion.md) — 决定 1 拒绝手动排序、决定 3 拒绝 folder merge 都引用了这条产品定位
- 触发这次决定的 PRD：[#63](https://github.com/doXmind/local-desk/issues/63)
- 本 ADR 对应 issue：[#64](https://github.com/doXmind/local-desk/issues/64)
