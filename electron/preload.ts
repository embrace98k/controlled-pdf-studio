/**
 * Preload 脚本 - 在渲染进程上下文中暴露安全 API
 */
import { contextBridge, ipcRenderer } from 'electron';

// 注意：避免暴露原始 ipcRenderer 给渲染进程，只暴露白名单方法
contextBridge.exposeInMainWorld('api', {
  // ---- 文件系统 ----
  openFileDialog: (): Promise<string | null> =>
    ipcRenderer.invoke('fs:openFileDialog'),
  openFilesDialog: (ext?: string): Promise<string[]> =>
    ipcRenderer.invoke('fs:openFilesDialog', ext),
  openFolderDialog: (): Promise<string | null> =>
    ipcRenderer.invoke('fs:openFolderDialog'),
  saveFileDialog: (defaultName?: string, ext?: string): Promise<string | null> =>
    ipcRenderer.invoke('fs:saveFileDialog', defaultName, ext),
  readFile: (path: string): Promise<Uint8Array> =>
    ipcRenderer.invoke('fs:readFile', path),
  readTextFile: (path: string): Promise<string> =>
    ipcRenderer.invoke('fs:readTextFile', path),
  writeTextFile: (path: string, content: string): Promise<void> =>
    ipcRenderer.invoke('fs:writeTextFile', path, content),
  listPdfsInDir: (dir: string, recursive: boolean): Promise<string[]> =>
    ipcRenderer.invoke('fs:listPdfsInDir', dir, recursive),
  showItemInFolder: (path: string): Promise<void> =>
    ipcRenderer.invoke('fs:showItemInFolder', path),
  pathBasename: (p: string): Promise<string> =>
    ipcRenderer.invoke('fs:basename', p),

  // ---- PDF 操作 ----
  stampPdfFile: (
    input: string,
    output: string,
    stampConfig: any,
    meta: any,
    applyTo: 'current' | 'all',
    currentPage: number,
    autoPlace?: boolean,
    skipIfStamped?: boolean
  ): Promise<{ ok: boolean; error?: string; skipped?: boolean; sizeIn?: number; sizeOut?: number }> =>
    ipcRenderer.invoke(
      'pdf:stampFile',
      input,
      output,
      stampConfig,
      meta,
      applyTo,
      currentPage,
      autoPlace,
      skipIfStamped
    ),

  checkStamped: (input: string): Promise<boolean> =>
    ipcRenderer.invoke('pdf:checkStamped', input),

  stampPdfBytes: (
    bytes: Uint8Array,
    stampConfig: any,
    meta: any,
    applyTo: 'current' | 'all',
    currentPage: number
  ): Promise<Uint8Array> =>
    ipcRenderer.invoke(
      'pdf:stampBytes',
      bytes,
      stampConfig,
      meta,
      applyTo,
      currentPage
    ),

  // ---- 模板 ----
  listTemplates: (): Promise<any[]> => ipcRenderer.invoke('tpl:list'),
  saveTemplate: (name: string, config: any): Promise<void> =>
    ipcRenderer.invoke('tpl:save', name, config),
  deleteTemplate: (name: string): Promise<void> =>
    ipcRenderer.invoke('tpl:delete', name),

  // ---- 应用配置（记住上次输出目录等） ----
  getConfig: (): Promise<any> => ipcRenderer.invoke('cfg:get'),
  setConfig: (cfg: any): Promise<void> => ipcRenderer.invoke('cfg:set', cfg),

  // ---- 右键菜单 ----
  contextMenuStatus: (): Promise<{ installed: boolean; needUpdate?: boolean; currentExe?: string }> =>
    ipcRenderer.invoke('ctx:status'),
  contextMenuInstall: (): Promise<{ ok: boolean; error?: string; exePath?: string }> =>
    ipcRenderer.invoke('ctx:install'),
  contextMenuUninstall: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('ctx:uninstall'),

  // ---- 监听来自主进程的事件 ----
  onOpenPdfFromArg: (callback: (path: string) => void) => {
    const handler = (_evt: any, p: string) => callback(p);
    ipcRenderer.on('open-pdf-from-arg', handler);
    return () => ipcRenderer.removeListener('open-pdf-from-arg', handler);
  },

  // ---- 系统 ----
  platform: process.platform,
  isElectron: true,
});

declare global {
  interface Window {
    api: {
      openFileDialog: () => Promise<string | null>;
      openFolderDialog: () => Promise<string | null>;
      readFile: (path: string) => Promise<Uint8Array>;
      listPdfsInDir: (dir: string, recursive: boolean) => Promise<string[]>;
      showItemInFolder: (path: string) => Promise<void>;
      pathBasename: (p: string) => Promise<string>;
      stampPdfFile: (
        input: string,
        output: string,
        stampConfig: any,
        meta: any,
        applyTo: 'current' | 'all',
        currentPage: number,
        autoPlace?: boolean,
        skipIfStamped?: boolean
      ) => Promise<{ ok: boolean; error?: string; skipped?: boolean; sizeIn?: number; sizeOut?: number }>;
      checkStamped: (input: string) => Promise<boolean>;
      stampPdfBytes: (
        bytes: Uint8Array,
        stampConfig: any,
        meta: any,
        applyTo: 'current' | 'all',
        currentPage: number
      ) => Promise<Uint8Array>;
      listTemplates: () => Promise<any[]>;
      saveTemplate: (name: string, config: any) => Promise<void>;
      deleteTemplate: (name: string) => Promise<void>;
      getConfig: () => Promise<any>;
      setConfig: (cfg: any) => Promise<void>;
      contextMenuStatus: () => Promise<{ installed: boolean; needUpdate?: boolean; currentExe?: string }>;
      contextMenuInstall: () => Promise<{ ok: boolean; error?: string; exePath?: string }>;
      contextMenuUninstall: () => Promise<{ ok: boolean; error?: string }>;
      onOpenPdfFromArg: (cb: (p: string) => void) => () => void;
      platform: string;
      isElectron: boolean;
    };
  }
}
