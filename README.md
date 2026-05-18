# 受控PDF盖章工具 · Controlled PDF Studio

> 给机械零件受控库 PDF 一键加盖电子受控印章的 Windows 桌面工具。

![version](https://img.shields.io/badge/version-1.0.6-blue) ![platform](https://img.shields.io/badge/platform-Windows-blue) ![electron](https://img.shields.io/badge/electron-42-9feaf9) ![react](https://img.shields.io/badge/react-19-61dafb) ![encrypted](https://img.shields.io/badge/AES--256-encrypted-success)

---

## 一、项目背景

公司机械零件受控库存有 671 份 PDF 图纸（CAD 机加件、塑胶件、PCBA、外购模组等），传统人工区分"受控 vs 非受控"靠目录命名 + 口头约定，混淆风险高。

本工具的目标：给受控库每一份 PDF **自动加盖统一格式的电子受控印章**，让任何人看到 PDF 第一眼就能识别这是"公司受控库的官方件"。

---

## 二、核心功能

| 模块 | 说明 |
|---|---|
| 📄 **单文件精调** | 拖拽印章 / 实时预览 / 自动适应窗口 / Ctrl+滚轮缩放 |
| 📁 **批量套用模板** | 选目录或多选文件 / 自动跳过已加章 / 多图幅自适配 |
| ⭐ **模板系统** | 保存常用印章样式 / JSON 导入导出 |
| 🔍 **试运行** | 不写文件先预检测，损坏 PDF 提前暴露 |
| 🎯 **智能透明度** | 检测目标区域内容密度，覆盖文字自动半透明 |
| 🖱 **右键集成** | 资源管理器右键 PDF → "用受控PDF工具打开" |
| 🔒 **AES-256 加密 + 权限锁定** | 输出 PDF 用 qpdf 加密，WPS / Acrobat / Foxit **无法编辑或删章** |
| 🪪 **SHA256 防伪码** | 输出文件名自动追加哈希短码（如 `[a1b2c3d4]`），防止替换 |
| 🛡 **系统只读** | 输出文件自动设为只读，避免无意覆盖 |

---

## 三、技术栈

```text
Electron 42       桌面运行时
React 19 + TS     渲染进程 UI
Vite 8            构建系统
pdf-lib           PDF 写入（矢量印章）
pdf.js (legacy)   PDF 渲染 + 内容检测
@pdf-lib/fontkit  中文字体子集化
思源黑体 / SimHei  中文字体
electron-builder  打包 portable + NSIS 安装包
```

---

## 四、开发与构建

### 环境要求
- Node.js >= 18
- Windows 10/11（仅支持 Windows，主要因右键菜单 + simhei 字体路径）

### 安装依赖
```bash
npm install
npm run setup:qpdf     # 下载 qpdf 二进制（一次性）
```

### 开发模式
```bash
npm run dev
```
Vite 热更新 + Electron 窗口同时启动。

### 生产打包
```bash
# 同时打 portable + NSIS 两个版本
npm run dist:portable
```

输出位置：`release/`
- `受控PDF盖章工具-v1.0.6-便携版.exe` — 单文件免安装
- `受控PDF盖章工具-v1.0.6-安装版.exe` — NSIS 标准安装（推荐）

---

## 五、目录结构

```text
gui-web/
├── electron/             Electron 主进程
│   ├── main.ts           窗口生命周期 / IPC 注册
│   ├── preload.ts        渲染进程安全桥 (window.api)
│   └── handlers/         IPC 处理函数
│       ├── pdf.ts        PDF 写入印章
│       ├── fs.ts         文件系统 / 配置
│       ├── template.ts   模板持久化
│       └── contextMenu.ts 右键菜单注册表
├── src/                  渲染进程 (React)
│   ├── App.tsx           主布局 + 路由
│   ├── PdfPreview.tsx    PDF 预览 + 印章拖拽
│   ├── SettingsPanel.tsx 右侧印章设置面板
│   ├── BatchPanel.tsx    批量模式
│   ├── store.ts          状态管理 + 文件名解析
│   ├── pdfWriter.ts      浏览器 fallback 印章写入
│   ├── contentDetector.ts 智能透明度检测
│   └── stampPlacement.ts 视觉坐标 → PDF 坐标变换
├── build/
│   ├── icon.ico          应用图标
│   └── installer.nsh     NSIS 自定义脚本（快捷方式图标）
├── public/
│   ├── simhei.ttf        中文字体
│   └── pdfjs/            pdf.js 字符映射表 + 标准字体
└── docs/
    └── 受控PDF盖章工具-使用说明-v1.0.6.pdf  用户使用手册
```

---

## 六、关键设计

### 编号自动解析
支持公司全部前缀格式：

| 文件名示例 | 解析结果 |
|---|---|
| `M.M.1.0028.04 手柄-按键CNC.pdf` | M.M.1.0028.04 / Rev.04 |
| `M.M.1.0092.PL03 HD320-外壳(胚料).pdf` | M.M.1.0092.PL03 / Rev.03 |
| `M.M.1.0123.LS01 临时件.pdf` | M.M.1.0123.LS01 / Rev.01 |
| `M.E.H.0015.02-XT30电源线.pdf` | M.E.H.0015.02 / Rev.02 |
| `M.E.0.0001-Livox手册.pdf` | M.E.0.0001 / Rev.01 |

正则：`/^(M\.[A-Z0-9](?:\.[A-Z0-9])?\.\d{4})(?:\.([A-Z]{0,3}\d{2}))?\b/i`

### 智能透明度
- 用 pdf.js 把目标章区域渲染到 HTMLCanvas
- 步长采样统计非白像素（r/g/b < 245 视为非白）
- 非白占比 > 0.3% → 视为有内容 → opacity = 0.6
- 否则 → opacity = 0.95（实色像真盖章）

### 横版/旋转 PDF 适配
- 读取 `page.getRotation().angle`
- 在物理坐标系下应用反向变换矩阵 `q...cm...Q`
- 让印章在用户视觉的右上角且方向正立

### Dev / Packaged userData 隔离
- dev：`%APPDATA%\controlled-pdf-studio-dev\`
- 打包：`%APPDATA%\受控PDF盖章工具\`
- 避免开发期数据污染正式版

---

## 七、已知限制

- **不支持加密 PDF**：muhammara native 模块在 Windows 下编译复杂，已舍弃。需要加密的 PDF 请先用 Acrobat 解密
- **NSIS 安装版需要点"更多信息 → 仍要运行"**：因为没有买代码签名证书。内部使用场景下没问题
- **portable .exe 不建议安装右键菜单**：每次解压临时路径都变，右键菜单失效。请用 NSIS 安装版

---

## 八、开发者

深圳市无穹创新科技有限公司  
© 2026 All Rights Reserved
