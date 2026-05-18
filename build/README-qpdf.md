# qpdf 二进制配置说明

本工具用 [qpdf](https://github.com/qpdf/qpdf) 给输出 PDF 做 AES-256 加密 + 权限锁定，防止 WPS / Acrobat / Foxit 等编辑器修改受控章和图纸内容。

## 第一次开发环境准备

在项目根目录（`gui-web/`）执行：

```bash
npm run setup:qpdf
```

脚本会做这些事：

1. 从 GitHub Releases 下载 `qpdf-11.10.0-mingw64.zip`（约 22 MB）
2. 用 PowerShell `Expand-Archive` 解压
3. 把 `bin/qpdf.exe` 和依赖 DLL 复制到 `build/qpdf/`
4. 自检 `qpdf --version` 是否能跑

完成后 `build/qpdf/` 目录里应该有：

- `qpdf.exe` (约 130 KB)
- `qpdf29.dll`（约 7.5 MB，主程序库）
- `libgcc_s_seh-1.dll` / `libstdc++-6.dll` / `libwinpthread-1.dll`
- `fix-qdf.exe` / `zlib-flate.exe`（顺带的工具，可保留）

## 打包行为

`npm run dist`（或 `dist:portable`）会触发：

1. `prepack` 钩子先跑 `setup:qpdf`（如果 `build/qpdf/qpdf.exe` 已存在则跳过下载）
2. `electron-builder` 通过 `extraResources` 把 `build/qpdf/**/*` 复制到 `resources/qpdf/`
3. 运行时主进程通过 `process.resourcesPath/qpdf/qpdf.exe` 调用

## 不入 git

`build/qpdf/` 整个目录已在 `.gitignore` 里。开发者各自跑 `npm run setup:qpdf` 准备本地副本即可，避免给仓库增加 11 MB 的二进制压力。

## 许可

qpdf 采用 [Apache License 2.0](https://github.com/qpdf/qpdf/blob/main/LICENSE.txt)，允许商用 + 二次分发。打包时 `LICENSE.electron.txt` 之外建议另带一份 qpdf 的 `LICENSE.txt`（可选）。
