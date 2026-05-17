/**
 * Electron 主进程入口
 */
import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { registerPdfHandlers } from './handlers/pdf';
import { registerFsHandlers } from './handlers/fs';
import { registerTemplateHandlers } from './handlers/template';
import { registerContextMenuHandlers } from './handlers/contextMenu';

// 显式区分 dev 和 packaged 的 userData 目录，否则会共用同一份模板/配置/操作人
app.setName('受控PDF盖章工具');
if (app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), '受控PDF盖章工具'));
} else {
  // dev 模式用独立目录，避免污染正式安装版的数据
  app.setPath('userData', path.join(app.getPath('appData'), 'controlled-pdf-studio-dev'));
}

// CJS 环境下 __dirname 直接可用
// Vite 注入的环境
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const DIST = path.join(__dirname, '../dist');
const PRELOAD = path.join(__dirname, 'preload.cjs');

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 1100,
    minHeight: 700,
    show: false,            // 先不显示，等最大化后再 show，避免闪烁
    backgroundColor: '#F3F3F3',
    title: '受控PDF盖章工具',
    autoHideMenuBar: true,
    // 开发模式从 public 加载 PNG，打包后从 resources/icon.ico
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'icon.ico')
      : path.join(__dirname, '..', 'public', 'favicon.png'),
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // 需要在 preload 里使用 Node 模块
    },
  });

  // 开发模式从 Vite dev server 加载；生产模式从打包后 dist 加载
  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(DIST, 'index.html'));
  }

  // 内容就绪后最大化 + 显示，体验丝滑
  mainWindow.once('ready-to-show', () => {
    mainWindow?.maximize();
    mainWindow?.show();
  });

  // 外部链接走系统浏览器，不在 Electron 里打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// 注册所有 IPC handler
registerPdfHandlers(ipcMain);
registerFsHandlers(ipcMain, () => mainWindow);
registerTemplateHandlers(ipcMain);
registerContextMenuHandlers(ipcMain);

// 从命令行参数中找到 PDF 路径（右键"用本工具打开"会把 PDF 路径作为参数传过来）
function findPdfArg(argv: string[]): string | null {
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a && /\.pdf$/i.test(a) && fs.existsSync(a)) return a;
  }
  return null;
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // 启动时如果命令行带了 PDF 路径，等窗口就绪后推给渲染进程
  const pdfArg = findPdfArg(process.argv);
  if (pdfArg && mainWindow) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow!.webContents.send('open-pdf-from-arg', pdfArg);
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 确保单实例
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
// 第二个实例启动（用户右键已经打开的工具又"用本工具打开"另一份 PDF）
app.on('second-instance', (_event, argv) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    const pdf = findPdfArg(argv);
    if (pdf) mainWindow.webContents.send('open-pdf-from-arg', pdf);
  }
});

// 暴露给类型用
export { fs, dialog };
