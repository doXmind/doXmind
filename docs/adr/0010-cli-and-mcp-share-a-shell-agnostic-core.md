# CLI 与 MCP 是新的 shell，三个前端共用一套 shell 无关的 core

doXmind 要新增两个入口：一个面向人/脚本的 `doxmind` **CLI**（完整文档工具箱），
一个面向外部 AI agent 的 **MCP server**（完整工作区控制）。在此之前，全部文档
操作只通过一个 shell 暴露：Electron 调 FastAPI sidecar 的 `POST
/api/workspace/invoke` 命令分发器，背后是 `server/api/workspace.py` 里一组纯处理
函数（`workspace_scan` / `read_doc` / `doc_create` …）转调 `server/services/`。

新增 CLI 和 MCP，有三种接法：

- **(a) 各自直连 services**：CLI、MCP 各自 import services，自己拼装 workspace 操作
  （路径校验、sidecar 合并、index 失效）。命令语义会在三个 shell 里各写一遍。
- **(b) 通过 HTTP 调运行中的 sidecar**：CLI/MCP 当 HTTP 客户端，连桌面 app 的后端。
  与正在编辑的 app 共享内存缓存，但要求 app 必须开着。
- **(c) 共用一个 shell 无关的 core**：抽一层 `server/core/` 操作门面，作为命令词汇的
  唯一真相源；FastAPI 路由、CLI、MCP **三者都调 core**，core 直接 import services，
  各 shell 自带进程、无需 app 在跑。

**决定**：选 **(c) 独立进程 + 共用 core**。

- 新增 `server/core/`，承载 shell 无关的操作（workspace / documents / convert /
  exporting）。CLI、MCP、FastAPI 路由都调用 core，命令语义只有一份。
- CLI 与 MCP 都是**独立 Python 进程，直接 import services**，硬盘上的 `.md` + 隐藏
  `.doxmind` sidecar 仍是唯一真相源；**不要求桌面 app 在运行**。
- 语言用 **Python**，直接复用全部 services；不引入 TS 侧重复实现。

**理由**：

1. **单一操作词汇**：`doc_read` / `doc_write_workspace` / `doc_create` 这套语义只在
   core 里定义一次。(a) 会让三个 shell 各自漂移，沦为三套隐性 contract——正是
   ADR-0003 "不允许 browser-dev 和 desktop 各自形成隐性 contract" 想避免的事。
2. **无需 app 在跑**：CLI 在脚本/CI 里、MCP 被 Claude 拉起时，桌面 app 通常没开。
   (b) 把 "app 必须开着" 变成硬依赖，不可接受。独立进程读写磁盘是本地 IDE 的自然
   形态。
3. **承重点已验证**：`_invoke(command, payload)`（`api/workspace.py`）是纯函数，背后
   处理函数抛的是 `ValueError` / `CorruptSidecarError` 这类业务异常而非
   `HTTPException`（HTTP 映射只在路由层）。`import api.workspace` 只构造一个空
   `APIRouter()`，无副作用。core 第一版可薄薄转调这些处理函数，路由不动；后续把纯
   处理函数下沉到 core，让 `api/` 反过来调 core，完成真正去重。

## MCP 不是被移除的 "应用内 AI runtime"

CLAUDE.md 的 "Removed Surface" 明确禁止重建 _应用内置的 AI runtime / agents /
providers_。本 ADR 的 MCP server **方向相反**：它把 doXmind _暴露给外部 agent_
（Claude Desktop / Claude Code 等），doXmind 自身不嵌入任何模型或 AI 运行时。这是
一次**显式的产品决策**——doXmind 仍是 fully-local 文档 IDE，MCP 只是让外部工具能
按本地文件契约操作工作区。

## 暴露面

- **CLI = 完整文档工具箱**：`ls` / `search` / `read` / `new` / `import` / `mv` /
  `rm` / `mkdir` / `export` / `convert` / `serve` / `index rebuild`。全局
  `--root` / `--json`。框架用 Typer。
- **MCP = 完整工作区控制**：读（`search_documents` / `read_document` /
  `list_workspace` / `read_pdf` / `read_excel` / `export_document`）+ 写
  （`create_document` / `edit_document` / `rename_document` / `move_document` /
  `delete_document` / `create_folder` / `import_document`）。工作区文档以
  `doc://<id>` 暴露为 MCP resource。SDK 用官方 `mcp`（FastMCP），stdio 传输。

## 安全与并发边界（独立进程 + 完整控制的代价）

1. **工作区越界防护**：完整控制 MCP 必须把所有路径**限定在 workspace root 内**
   （拒绝 `../` 逃逸、symlink 逃逸）。这是 MCP 的头号安全项，且要先于其它写操作落地。
   现有 asset handler 仅注释 "Phase 3 会限定"，本工作要补齐这层。
2. **与开着的 app 并发写**：独立进程直接读写磁盘。doXmind 已把 "外部改 `.md`" 当
   权威（`markdown_hash` 不匹配 → SidecarStale → 重生成 HTML），且 services 用
   atomic write（temp + rename），所以外部写 markdown 是安全的。残留风险：同一文档
   在 app 与 CLI/MCP 同时编辑可能丢写——作为**已知 caveat 写进文档**，不为此引入跨
   进程锁。
3. **破坏性操作**：删除统一走 `send2trash`（延续 ADR-0005，不硬删）。CLI 的 `rm` /
   `mv` 默认需确认；MCP 的 `delete_document` 在工具描述里明确 "移到系统废纸篓"。

## 分发

**两种都提供**：

- `pyproject.toml` 增加 `[project.scripts]`：`doxmind = "cli.__main__:main"`、
  `doxmind-mcp = "mcp.server:main"`，供 pip / pipx / uvx 安装（开发者友好、易迭代）。
- PyInstaller 单文件二进制，对齐现有 `doxmind-server` 打包，供无 Python 环境的用户
  与 Claude 接入（最省心）。

## 分阶段与验收

1. **`core/` 门面** — 验收：pytest 直接 import core，跑通 scan / read / write /
   create，全程不起 HTTP。
2. **CLI** — 验收：`ls` / `read` / `search` / `new` / `export` 在真实临时工作区端到端
   通过 + CLI 测试。
3. **MCP server** — 验收：MCP Inspector 连上，每个 tool 走通一次往返；读写后磁盘
   sidecar 形态正确（延续 ADR-0003 的 markdown shape）。
4. **打包** — `[project.scripts]` 两个入口 + 两个 PyInstaller 二进制 + Claude 接入
   文档（`claude mcp add` / Claude Desktop config 片段）。
5. **安全加固** — workspace-root 限定的单元测试（逃逸用例）；删除走 trash 的断言。
