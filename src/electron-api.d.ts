/**
 * Electron preload 暴露的 window.api 类型
 * 浏览器模式下 window.api 是 undefined
 */
export interface ElectronApi {
  // 文件系统
  openFileDialog: () => Promise<string | null>;
  openFilesDialog: (ext?: string) => Promise<string[]>;
  openFolderDialog: () => Promise<string | null>;
  saveFileDialog: (defaultName?: string, ext?: string) => Promise<string | null>;
  readFile: (path: string) => Promise<Uint8Array>;
  readTextFile: (path: string) => Promise<string>;
  writeTextFile: (path: string, content: string) => Promise<void>;
  listPdfsInDir: (dir: string, recursive: boolean) => Promise<string[]>;
  showItemInFolder: (path: string) => Promise<void>;
  pathBasename: (p: string) => Promise<string>;

  // PDF
  stampPdfFile: (
    input: string,
    output: string,
    stampConfig: any,
    meta: any,
    applyTo: 'current' | 'all',
    currentPage: number,
    autoPlace?: boolean,
    skipIfStamped?: boolean
  ) => Promise<{
    ok: boolean;
    error?: string;
    skipped?: boolean;
    sizeIn?: number;
    sizeOut?: number;
    finalPath?: string;
    hash?: string;
    encrypted?: boolean;
    readonly?: boolean;
  }>;
  checkStamped: (input: string) => Promise<boolean>;
  stampPdfBytes: (
    bytes: Uint8Array,
    stampConfig: any,
    meta: any,
    applyTo: 'current' | 'all',
    currentPage: number
  ) => Promise<Uint8Array>;

  // 模板
  listTemplates: () => Promise<Array<{ name: string; createdAt: string; stamp: any }>>;
  saveTemplate: (name: string, config: any) => Promise<void>;
  deleteTemplate: (name: string) => Promise<void>;

  // 配置
  getConfig: () => Promise<{ lastOutputDir?: string; [k: string]: any }>;
  setConfig: (cfg: any) => Promise<void>;

  // 右键菜单
  contextMenuStatus: () => Promise<{ installed: boolean; needUpdate?: boolean; currentExe?: string }>;
  contextMenuInstall: () => Promise<{ ok: boolean; error?: string; exePath?: string }>;
  contextMenuUninstall: () => Promise<{ ok: boolean; error?: string }>;
  onOpenPdfFromArg: (cb: (p: string) => void) => () => void;

  // 系统
  platform: string;
  isElectron: boolean;
}

declare global {
  interface Window {
    api?: ElectronApi;
  }
}
