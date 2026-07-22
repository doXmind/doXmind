# ADR-0014：无需打印机的本地 Page PDF 导出

Status: accepted
Date: 2026-07-22

## 背景

旧的 **Export as PDF** 只调用 Electron `webContents.print()`，把结果交给操作系统打印
面板。应用既不生成 PDF，也无法确定用户是保存、打印还是取消；没有配置 printer
destination 的机器会直接失败。这不满足“完全本地 Markdown workspace 自己产生可携带
导出文件”的产品目标。

Page 的事实源仍然必须是 canonical Markdown。PDF 是显式生成的派生输出，不能成为第二
份编辑状态，也不能重新引入 Page Sidecar、服务器 renderer 或 Python desktop runtime。

## 决定

Page PDF 采用一条 Electron-only 的本地导出链路：

1. renderer 确保目标 Page 已保存并挂载，等待字体、递归 Page embed、Collection、本地
   图片、数学和 Mermaid 等异步投影进入稳定状态。
2. 排版继续使用由 canonical Markdown 投影出的 live native Block DOM 和专用 print CSS；
   不实现第二套 Markdown -> HTML/PDF renderer。
3. renderer 通过窄 IPC `export_page_pdf` 只提交经过清理的建议文件名。它不能提交输出
   路径、HTML、Markdown 或 PDF bytes。
4. Electron main process 显示原生 Save dialog，并以用户选择作为唯一写入授权。取消返回
   明确的 `cancelled` 状态且不生成文件。
5. main process 调用当前 Page 的 `webContents.printToPDF()`，在进程内取得 PDF Buffer。
   该 API 不使用操作系统 printer、driver 或 spooler。
6. 输出必须具有 PDF signature。main process 拒绝 symlink 或非普通目标，通过同目录隐藏
   temporary file、`fsync` 和 rename 原子替换目标，并在失败时清理 temporary file、保留
   既有目标 bytes。
7. 成功返回明确的 destination path。导出不得修改 Markdown Page、Attachment、legacy
   `.doxmind` family 或 workspace index，也不得创建 PDF sidecar。

## 边界

- packaged Electron 是 Page PDF 的产品 Surface。browser development 没有
  `window.print()` fallback；CLI/MCP 继续只支持现有 `md`/`html` export。
- 不启动或打包 Python/FastAPI，不调用 server HTML-to-PDF，不使用 PyMuPDF、pdf-lib 或
  PDF editor runtime 生成 Page PDF。
- PDF 仍是 read-only Attachment/derived file，不成为 Page 类型，也不获得编辑、autosave、
  cache 或 sidecar stack。
- 本决定完成用户要求的本地 Markdown -> PDF 能力。Markdown -> DOCX 需要独立的
  Block -> OOXML 保真契约，不在本决定范围内。

## 验收

- 单元测试覆盖 Save/cancel、建议名、固定 `printToPDF` options、invalid Buffer、destroyed
  Page、symlink、原子失败保留旧文件、temporary cleanup 和并发串行化。
- renderer 测试证明 export 等待异步 native projections，只调用本地 IPC，不调用
  `window.print()`、FastAPI 或其他网络服务。
- packaged Electron GUI test 只控制 Save-dialog destination，不 mock `printToPDF`；它读取
  真实 PDF，验证 signature、页数和文本，并证明 Markdown 与完整 legacy artifact family
  byte-identical。取消测试必须零写。
- macOS release spot check 使用真实 Save dialog，在没有任何 printer destination 的机器上
  生成并用 Preview 打开 PDF。

## 影响

本决定取代 ADR-0011/0012、产品方向、架构和用户指南中所有把 Page PDF 定义为
desktop/system print dialog 的现行描述。它不改变这些文档关于 Markdown 单一事实源、
Electron-only desktop、Attachment read-only、legacy recovery 与无 Python packaged runtime
的其余决定。
