# Markdown Workspace Implementation Plan

## 目标

doXmind 的文档库不再是 `~/.doxmind/doxmind.db`，而是用户选择的一个本地 markdown 文件夹。

```text
~/Documents/notes/
├── project.md
├── meeting.md
├── assets/
│   └── diagram.png
├── .project.doxmind
└── .meeting.doxmind
```

核心原则：

- `.md` 是唯一必须存在的文档真相。
- `.doxmind` 是可选增强层，保存 TipTap HTML 和富特性数据。
- 用户可以直接用 doXmind 打开已有 markdown folder，不需要 import。
- 删除 `.doxmind` 不会损坏文档。
- SQLite 只能作为 legacy 数据源或可重建 cache，不能再承载文档真相。

> 重点：**Open Folder 是核心入口，不是 import 的新皮肤。**

## 当前状态

当前代码仍然是 DB-first：

- `server/db/database.py` 的 `files` 表存 HTML、markdown cache、文件树、软删除。
- `server/api/files.py` 提供 CRUD、folder、trash、search。
- `src/stores/file-store.ts` 围绕 `/api/files` 管理文档。
- [x] `crates/sidecar` 已完成基础读写模型，并有 24 个测试通过。
- [x] `server/scripts/dump_to_disk.py` 已写好，能把现有 DB dump 成磁盘 markdown 树（Phase 5 用）。
- [x] 本 spec 已落盘 (`docs/MARKDOWN_FIRST_MIGRATION.md`)，作为 living doc。
- `src-tauri` 还没有接入 `crates/sidecar`。
- 根目录还不是 Cargo workspace。

## 目标模型

### Workspace

workspace 是用户选择的一个 folder：

```text
WorkspaceRoot = /Users/me/Documents/notes
```

doXmind 扫描 workspace 下的：

- `*.md`
- `*.markdown`

并忽略：

- hidden sidecar 文件：`.*.doxmind`
- 常规隐藏目录：`.git`、`.doxmind`、`.obsidian` 可按策略处理
- `node_modules`、构建目录等常见噪声目录

### Document Identity

每个 markdown 文件通过 YAML frontmatter 保存稳定 ID：

```md
---
id: 8c0b1a2e-6a8c-4b43-b2a7-2d04fd4b9f5d
title: Project Plan
created: 2026-04-30T12:00:00Z
updated: 2026-04-30T12:10:00Z
---

# Project Plan
```

如果打开的 `.md` 没有 `id`，doXmind 第一次保存时补齐。

### Sidecar

同目录隐藏文件：

```text
project.md
.project.doxmind
```

sidecar 保存：

```json
{
  "version": 1,
  "id": "...",
  "html": "<p>...</p>",
  "markdown_hash": "sha256:...",
  "updated_at": "2026-04-30T12:10:00Z",
  "extras": {
    "databases": {}
  }
}
```

读规则：

1. `.md` 存在，sidecar fresh：使用 sidecar HTML。
2. sidecar 不存在：markdown -> HTML。
3. sidecar hash 不匹配：外部编辑胜出，忽略 sidecar。
4. sidecar 损坏：当作不存在。

## 分阶段实施

> 每个 phase 头部用 `Status:` 行追踪进度。状态值：`todo` / `in progress` / `done`。

### Phase 1: 接通 Tauri + sidecar crate

Status: done

目标：让前端能通过 Tauri command 读写真实 `.md` 文件，但不改变现有 DB 路径。

改动：

- 根目录新增 Cargo workspace。
- `src-tauri` 添加 `doxmind-sidecar` path dependency。
- 新增 Tauri commands：
  - `doc_read(path) -> { html, markdown, meta, extras, source }`
  - `doc_write(path, payload) -> void`
- 验证：
  - `cargo test` workspace 通过。
  - `cargo check` / desktop build 不破。
  - WebView devtools 能 invoke 一个 `/tmp/test.md`。

验收标准：

- 现有 app 行为不变。
- sidecar crate 不再是孤岛。
- 可以从 Tauri 成功读写 `.md + .doxmind`。

### Phase 2: 引入 Workspace 和 StorageAdapter

Status: done

目标：前端有统一存储边界，但默认仍走 DB。

新增接口：

```ts
interface StorageAdapter {
  list(): Promise<FileItem[]>;
  read(handle: DocumentHandle): Promise<DocumentContent>;
  write(handle: DocumentHandle, payload: DocumentPayload): Promise<void>;
  create(pathOrName: string, payload?: DocumentPayload): Promise<DocumentHandle>;
  rename(handle: DocumentHandle, name: string): Promise<DocumentHandle>;
  delete(handle: DocumentHandle): Promise<void>;
  move(handle: DocumentHandle, targetFolder: string | null): Promise<DocumentHandle>;
}
```

实现：

- `DbStorageAdapter`：包装当前 `/api/files`。
- `DiskStorageAdapter`：调用 Tauri command。
- `file-store.ts` 开始依赖 adapter，而不是直接依赖 `api.files`。
- 加开发开关：默认 DB，手动切 Disk。

验收标准：

- 默认 DB 路径行为完全不变。
- Disk adapter 可以通过测试读写单个文档。
- `file-store` 开始变薄，但不大规模删除。

### Phase 3: Open Folder 作为 Workspace

Status: done

目标：用户可以选择一个已有 markdown folder 并作为 workspace 打开。

改动：

- 新增 workspace state：
  - `workspaceRoot`
  - `workspaceMode: "db" | "disk"`
  - recent workspaces
- Tauri command：
  - `workspace_scan(root) -> FileItem[]`
  - 可先简单递归扫描 `.md/.markdown`
- UI 增加：
  - Open Folder
  - Recent Workspaces
- 文件树从目录结构生成，不再从 DB parent_id 生成。

验收标准：

- 用户选择任意 markdown folder。
- doXmind 展示 folder 内 markdown 文件树。
- 点击文件可打开，无 import 流程。
- 没有 sidecar 的普通 markdown 能正常渲染。

### Phase 4: Disk 写路径成为新默认

Status: done

目标：disk workspace 下的新建、编辑、保存都写回 `.md + .doxmind`。

改动：

- 在 disk workspace 内：
  - New Document 创建真实 `.md`。
  - Rename 改真实文件名。
  - Move 改真实路径。
  - Delete 先进入系统 Trash 或 doXmind `.trash` 策略，需明确。
- Editor 保存：
  - `editor.getMarkdown()` 写入 `.md`
  - `editor.getHTML()` 写入 sidecar
  - 保持当前 debounce，先用现有 1000ms
- 外部修改检测：
  - 最小版本：窗口 focus 时重新 `doc_read`
  - 后续可加 filesystem watcher

验收标准：

- 在 doXmind 编辑后，VS Code 打开 `.md` 能看到更新。
- 在 VS Code 修改 `.md` 后，重新 focus/open，doXmind 使用 markdown 内容，旧 sidecar 失效。
- `.doxmind` 删除后文档仍可打开。

### Phase 5: Existing DB Migration

Status: todo

目标：把旧 SQLite 文档导出成 workspace markdown tree。

已有基础：

- `server/scripts/dump_to_disk.py`

需要补齐：

- UI 入口：Migrate Existing Library
- 默认输出到用户选择的 workspace 或新建 workspace。
- 导出后切换到 disk mode。
- 保留 DB 只读一段时间，作为回滚。

验收标准：

- 旧 DB 中非 trash 文档全部导出为 `.md`。
- folder 层级映射为真实目录。
- 图片 URL 尽量重写成相对 `assets/`。
- 文档 frontmatter 保留原 `id`。

### Phase 6: 富特性迁移

Status: todo

优先级从高到低：

1. Page links
   通过 frontmatter `id` 建 `index.json`，映射 `id -> relative_path`。

2. Images
   paste/upload 改成写入当前文档旁边的 `assets/`，markdown 使用相对路径。

3. DatabaseBlock
   markdown 保留占位：

   ```md
   <!-- database:uuid -->
   ```

   数据迁到 sidecar：

   ```json
   {
     "extras": {
       "databases": {
         "uuid": {
           "title": "...",
           "rows": [],
           "views": []
         }
       }
     }
   }
   ```

4. Search
   初期直接扫描 `.md`。需要 app 内全文搜索时，再做可重建 index cache。

验收标准：

- 删除 sidecar 后，database block 退化为 markdown comment，不损坏正文。
- 图片路径脱离 `/api/images`。
- page link 在 rename/move 后仍能通过 `id` 找到目标。

### Phase 7: 删除旧 DB 存储路径

Status: todo

只有在 disk workspace 默认稳定后再做。

删除或停用：

- `server/api/files.py`
- `server/api/versions.py`
- `server/api/images.py`
- `server/api/import_file.py`
- `server/api/export.py` 中依赖 DB 的路径
- `database_blocks/database_rows/database_views`
- `file-store.ts` 里的：
  - `isSynced`
  - `loadedContentIds`
  - `pendingContentLoads`
  - DB trash/folder/move 特化逻辑

保留：

- `~/.doxmind/config.json`
- recent workspace
- 可重建 index cache
- 未来需要的本地 agent backend

## 推荐开工顺序

我建议第一轮只做到 Phase 1：

1. Cargo workspace。
2. Tauri 接 `doxmind-sidecar`。
3. `doc_read/doc_write`。
4. 测试和 smoke test。

这一步没有产品行为变化，风险最低。完成后再开始 Phase 2，把前端 storage 边界抽出来。
我认为这个实施路线没有架构阻塞，关键是坚持：**Open Folder 是核心入口，不是 import 的新皮肤。**
