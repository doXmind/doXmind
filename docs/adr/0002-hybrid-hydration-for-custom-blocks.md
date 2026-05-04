# Custom Block 采用混合 hydration mode（eager 默认 + lazy opt-in）

打开一个 Document 时，**Custom Block** 的状态从 Sidecar 的 **Extras** 加载到内存，有两种合理策略：

- **全 eager**：所有块的状态一次性加载。简单、可预测、写入永远 replace。
- **全 lazy**：所有块按需加载。省内存、写入永远 slot-aware merge。

**决定**：默认 **Eager**，少数重量块（PDF 块、Excel 块等）在注册时声明自己是 **Lazy**。Hydration mode 是 Custom Block 类型的属性，不是 caller 可选项。

**理由**：本地桌面 IDE 的 Document 体量受用户硬盘文件大小约束，绝大多数块（database、callout、math、mermaid、page-link）都很轻，eager 是更简单的默认。但嵌入的 PDF / Excel 块的 parsed cache 和 cell edits 容易达到几 MB / 几万条，强制 eager 会拖慢打开。让块类型自己声明 hydration mode，把 trade-off 局部化在适配器内部，调用方无需感知。

**后果**：写入接口必须同时支持 replace（给 eager 块）和 slot-aware merge（给 lazy 块）。任何"统一改成全 eager / 全 lazy"的提案应该先来订正这条 ADR。
