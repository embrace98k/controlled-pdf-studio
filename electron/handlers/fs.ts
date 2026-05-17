/**
 * 文件系统 IPC handlers
 */
import type { IpcMain, BrowserWindow } from 'electron';
import { dialog, shell, app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export function registerFsHandlers(
  ipcMain: IpcMain,
  getMainWindow: () => BrowserWindow | null
) {
  ipcMain.handle('fs:openFileDialog', async () => {
    const win = getMainWindow();
    if (!win) return null;
    const r = await dialog.showOpenDialog(win, {
      title: '选择 PDF',
      properties: ['openFile'],
      filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
    });
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0];
  });

  // 支持多选 PDF
  ipcMain.handle('fs:openFilesDialog', async (_evt, ext?: string) => {
    const win = getMainWindow();
    if (!win) return [];
    const filters = ext === 'json'
      ? [{ name: 'JSON', extensions: ['json'] }]
      : [{ name: 'PDF 文件', extensions: ['pdf'] }];
    const r = await dialog.showOpenDialog(win, {
      title: '选择文件（可多选）',
      properties: ['openFile', 'multiSelections'],
      filters,
    });
    return r.canceled ? [] : r.filePaths;
  });

  // 保存文件对话框
  ipcMain.handle('fs:saveFileDialog', async (_evt, defaultName?: string, ext?: string) => {
    const win = getMainWindow();
    if (!win) return null;
    const filters = ext === 'json'
      ? [{ name: 'JSON', extensions: ['json'] }]
      : [{ name: 'PDF', extensions: ['pdf'] }];
    const r = await dialog.showSaveDialog(win, {
      title: '保存为',
      defaultPath: defaultName,
      filters,
    });
    return r.canceled || !r.filePath ? null : r.filePath;
  });

  // 写文本文件（日志/JSON）
  ipcMain.handle('fs:writeTextFile', async (_evt, filePath: string, content: string) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
  });

  // 读文本文件（JSON）
  ipcMain.handle('fs:readTextFile', async (_evt, filePath: string) => {
    return fs.readFileSync(filePath, 'utf8');
  });

  ipcMain.handle('fs:openFolderDialog', async () => {
    const win = getMainWindow();
    if (!win) return null;
    const r = await dialog.showOpenDialog(win, {
      title: '选择目录',
      properties: ['openDirectory'],
    });
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0];
  });

  ipcMain.handle('fs:readFile', async (_evt, filePath: string) => {
    const buf = fs.readFileSync(filePath);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  });

  ipcMain.handle(
    'fs:listPdfsInDir',
    async (_evt, dir: string, recursive: boolean) => {
      const out: string[] = [];
      function walk(d: string) {
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(d, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          const full = path.join(d, e.name);
          if (e.isDirectory()) {
            if (recursive) walk(full);
          } else if (e.isFile() && /\.pdf$/i.test(e.name)) {
            out.push(full);
          }
        }
      }
      walk(dir);
      return out;
    }
  );

  ipcMain.handle('fs:showItemInFolder', async (_evt, p: string) => {
    shell.showItemInFolder(p);
  });

  ipcMain.handle('fs:basename', async (_evt, p: string) => {
    return path.basename(p);
  });

  // ---- 应用配置（记住上次输出目录等） ----
  const cfgPath = path.join(app.getPath('userData'), 'config.json');

  ipcMain.handle('cfg:get', async () => {
    try {
      if (fs.existsSync(cfgPath)) {
        return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      }
    } catch {}
    return {};
  });

  ipcMain.handle('cfg:set', async (_evt, cfg: any) => {
    try {
      fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    } catch (e: any) {
      console.error('save config failed:', e.message);
    }
  });
}
