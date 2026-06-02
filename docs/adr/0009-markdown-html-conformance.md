# Markdown→HTML 三份实现的一致性基线与收敛路线

doXmind 把同一套 **markdown → 编辑器 HTML** 转换实现了**三遍**，靠人工保持行为一致：

1. **Rust** — `crates/sidecar/src/lib.rs`（`pulldown-cmark`）。Tauri 桌面运行时的**进程内**路径（`doc_read` / `doc_write`），最高频的 markdown 编辑路径走它。
2. **Python** — `server/services/sidecar_io.py`（`markdown` 库）。非 Tauri 的浏览器 / `npm run dev` 后端路径，以及移植到 Rust 后尚未退役的遗留。
3. **前端 `marked`** — `src/lib/markdown.ts`。侧栏浏览预览导入器，也是块级源保留（#149）的 lexer。

功能分工本身合理：**Rust 管 markdown 核心**（进程内、零 IPC、无需 Python 运行时），**Python 管 PDF / Excel**（PyMuPDF、openpyxl，无 Rust 等价物），由 Tauri shell spawn 出来。问题在于 **markdown→HTML 这一层被实现了三遍且无共享契约**——任何 markdown 行为改动都要三处各改一遍，且会静默漂移。#149/#151 修一个 raw-HTML 行为就被迫改三处、各写一套测试；ADR-0004 也早已警告过"两份实现总会漂移"。

**决定**：

1. **先建一致性基线，而不是立刻收敛到一份实现**（收敛的目标实现取决于 Tauri vs Electron 迁移方向，是更大的产品决策）。基线由 `conformance/` 固化：
   - `conformance/corpus.json` — 覆盖各种块/行内形态的共享语料。
   - `conformance/expected/{rust,python,marked}.json` — 三个导入器的输出快照。
   - 三个语言各一个 pinning 测试（TS→frontend CI、Python→backend CI、Rust→`cargo test`），任一实现漂移即在该语言 lane 失败；`DOXMIND_UPDATE_CONFORMANCE=1` 刷新快照。
   - `conformance/REPORT.md` — 分叉清单。
2. **当前分叉记录在案**（24 例：14 一致、3 外观、7 语义）。语义分叉是真正要收敛的目标，按性质分两类处理：
   - **明确的 bug（与方向无关，应尽快修）**：Python 不渲染 `~~删除线~~`（缺 GFM strikethrough）；Python 把 2 空格缩进的嵌套列表拍平成同级。这些只影响 web/dev 路径，但都是错误行为。
   - **表达差异（需配合编辑器层 + 方向决策）**：task list（Python 出 `data-type=taskList`，Rust/marked 出 GFM `<input>`）；`$math$` 与 `mermaid` 在 marked 里直接成节点、在 Rust/Python 里留作文本/代码块（靠编辑器迁移插件 / parseHTML 兜底）。收敛这些要先定权威实现。
3. **方向已定：Rust 为权威**（留 Tauri）。Rust 已是唯一的*生产*（Tauri 运行时）markdown→HTML 引擎，本 ADR 的 conformance 基线把 Python 与 `marked` 钉住防漂移——这就是该决定当下安全、不破坏现状的实质，#152 据此收尾。
   - **真正折叠成单份实现是后续工作，见 #154。** 之所以不能简单删掉另外两份：Python `markdown_to_html` 是 web/dev（浏览器 / `npm run dev`）的编辑器打开路径（该进程内没有 Rust），前端 `marked` 还用于模板新建文件与源保留 lexer。要收敛到一份，须把 Rust 核心做成 **CLI/wasm** 给 Python 服务和前端共用，再删除两者——这是与 Tauri→Electron 迁移耦合的工程，单列 #154 跟踪。

**理由**：

- 一致性基线**与方向无关、零风险、立刻有价值**：把现状显式化并防漂移，是任何收敛方案的前提，也是这次 #149 raw-HTML 三处改动这类隐性税的护栏。
- 不在本 ADR 里拍板"删哪一份"，因为那要么提前替 Tauri-vs-Electron 拍板、要么动到打包的 Python sidecar 依赖（如为 strikethrough 引入 `pymdownx`），都超出"基线"这一步的安全范围。

**后果**：

- 改动任一导入器的 markdown→HTML 行为，必须同步更新对应的 `conformance/expected/*.json`（在 diff 里可见），否则该语言 CI 失败。
- 新增覆盖用例时，往 `conformance/corpus.json` 加一条并用 `DOXMIND_UPDATE_CONFORMANCE=1` 刷新三份快照，再人工核对 `REPORT.md` 的新分叉。
- 真正"收敛到一份实现"的提案应基于本 ADR 的分叉清单推进，并明确选定权威实现 + 迁移方向。
