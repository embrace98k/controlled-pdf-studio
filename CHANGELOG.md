# 更新日志 · CHANGELOG

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，版本号使用 [语义化版本（SemVer）](https://semver.org/lang/zh-CN/)。

---

## [1.0.7] - 2026-05-19

### 变更 Changed
- **单文件导出改为手动选位置**：点"应用并导出"会弹 Windows 标准"保存为"对话框，不再强制写到 `<源目录>\_stamped\` 子文件夹。
- 保存对话框**默认位置 = 源 PDF 同目录**，**默认文件名 = `<原名>【受控】.pdf`**，用户可自由改路径和名字。
- 取消保存对话框 → 状态栏显示"已取消"，不报错。

### 修复 Fixed
- `buildFinalPath` 在用户选择已带 `【受控】` 的路径时会误判"文件名冲突"，输出变成 `xxx【受控】 (1).pdf`。
  现在跳过对 `originalOutput` 自身的碰撞检测，结果一致正确。

---

## [1.0.6] - 2026-05-18

### 新增 Added
- **AES-256 加密**：每份输出 PDF 用 `qpdf` 做 PDF 2.0 (R=6) AES-256 加密 + 权限锁定。WPS / Adobe Acrobat / Foxit 等编辑器**直接禁止编辑、注释、抽页、文字抽取**，仅允许打印。
- **【受控】文件名后缀**：盖章后文件名末尾自动追加 `【受控】`（如 `M.M.1.0033.pdf` → `M.M.1.0033【受控】.pdf`），肉眼一秒识别受控文件。
- **SHA256 防伪短码**：计算输出文件 SHA256，前 8 位作为审计字段显示在状态栏 / 批量列表里（不进文件名，避免文件名臃肿）。
- **系统只读位**：输出文件自动 `attrib +R`，避免无意覆写。
- **scripts/setup-qpdf.cjs**：一次性下载 qpdf v11.10.0（Windows mingw64）二进制到 `build/qpdf/`，约 11 MB。
- **scripts/smoke-test-encrypt.cjs**：端到端加密管线烟雾测试，验证加密、权限位、SHA256、只读位均生效。

### 变更 Changed
- 单文件模式输出文件名不再加 `_stamped` 后缀。
- 已盖章检测同时识别新格式 `【受控】` 和历史格式 `[8hex]`。
- `buildFinalPath` 在拼新名前先剥离 `_stamped` / `[8hex]` / `【受控】`，避免后缀堆叠。
- 元数据 `Producer` 标识由 `Controlled-PDF-Studio v1.0.5` 升级为 `v1.0.6`。
- 打包产物体积从 ~95 MB 增加到 ~97 MB（多出 qpdf + DLL）。

### 安全 Security
- **Owner 密码**：默认写死在 `electron/handlers/pdf.ts` 中，需要解锁修改时使用。**不要在公开文档里写明密码**。
- **加密能挡**：WPS / Adobe / Foxit 等主流编辑器的"删章 / 改字 / 加注释"操作。
- **加密挡不住**：网上的 PDF 解锁工具、持有 owner 密码的人。如需"任何篡改可审计"，需叠加数字签名（计划项）。

---

## [1.0.5] - 2026-05-17

### 新增 Added
- 印章信息硬约束：操作人 / 零件号 / 版本 / 受控日期任一为空，"应用并导出"按钮直接禁用，输入框红框+浅红底高亮。
- 批量模式同步硬约束：操作人空 / 输出位置空 / 列表空 时"开始处理"和"试运行"按钮都灰掉。
- 右键菜单注册修复（之前 `cmd shell` 转义 bug 导致 `reg add` 失败；改用 `spawn` + 数组参数）。
- 介绍 PDF 重新设计：封面 + 目录 + 8 页精致排版。

### 修复 Fixed
- 去掉原生 `confirm` 弹窗（在 Electron 里会卡 React 状态，改用 status 提示）。
- 右键菜单"路径不一致"假警告（中文系统下 `reg query` 是 GBK 编码导致对比永远不一致，现在只判断"是否注册"）。
- 安装版桌面图标错误（自定义 NSIS 脚本显式创建快捷方式指向 `resources\icon.ico`）。
- 开发模式与正式安装版共享 `userData` 目录的污染问题（dev 模式独立用 `controlled-pdf-studio-dev`）。

---

## [1.0.0] - 2026-05-16

### 新增 Added
- 首版发布：单文件精调 + 批量套用模板 + 模板系统 + 试运行 + 智能透明度 + 右键集成。
- Electron 42 + React 19 + Vite 8 + pdf-lib + pdf.js 技术栈。
- 输出便携版 + NSIS 安装版双形态。

---

[1.0.7]: https://github.com/embrace98k/controlled-pdf-studio/releases/tag/v1.0.7
[1.0.6]: https://github.com/embrace98k/controlled-pdf-studio/releases/tag/v1.0.6
[1.0.5]: https://github.com/embrace98k/controlled-pdf-studio/releases/tag/v1.0.5
[1.0.0]: https://github.com/embrace98k/controlled-pdf-studio/releases/tag/v1.0.0
