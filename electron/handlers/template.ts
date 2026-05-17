/**
 * 模板系统 IPC handlers - 模板存到 userData/templates.json
 */
import type { IpcMain } from 'electron';
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

interface Template {
  name: string;
  createdAt: string;
  stamp: any;
}

function getTemplateFilePath(): string {
  return path.join(app.getPath('userData'), 'templates.json');
}

function loadAll(): Template[] {
  const fp = getTemplateFilePath();
  try {
    if (fs.existsSync(fp)) {
      return JSON.parse(fs.readFileSync(fp, 'utf8'));
    }
  } catch (e: any) {
    console.error('load templates failed:', e.message);
  }
  return [];
}

function saveAll(templates: Template[]) {
  const fp = getTemplateFilePath();
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(templates, null, 2));
}

export function registerTemplateHandlers(ipcMain: IpcMain) {
  ipcMain.handle('tpl:list', async () => loadAll());

  ipcMain.handle('tpl:save', async (_evt, name: string, stampConfig: any) => {
    const all = loadAll();
    const existing = all.findIndex((t) => t.name === name);
    const entry: Template = {
      name,
      createdAt: new Date().toISOString(),
      stamp: stampConfig,
    };
    if (existing >= 0) all[existing] = entry;
    else all.push(entry);
    saveAll(all);
  });

  ipcMain.handle('tpl:delete', async (_evt, name: string) => {
    const all = loadAll().filter((t) => t.name !== name);
    saveAll(all);
  });
}
