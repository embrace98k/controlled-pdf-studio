/**
 * Windows 资源管理器右键菜单集成
 * 写入 HKEY_CURRENT_USER（用户级，不需要管理员）
 * 注册项位置：
 *   HKCU\Software\Classes\SystemFileAssociations\.pdf\shell\OpenWithControlledPDFStudio
 */
import type { IpcMain } from 'electron';
import { app } from 'electron';
import { spawn } from 'node:child_process';

const REG_KEY = 'HKCU\\Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\OpenWithControlledPDFStudio';
const MENU_LABEL = '用受控PDF工具打开';

function getExePath(): string {
  return process.execPath;
}

/** spawn reg.exe + 数组参数，避免 shell 引号转义 bug */
function runReg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn('reg', args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d.toString()));
    p.stderr.on('data', (d) => (stderr += d.toString()));
    p.on('error', (e) => reject(e));
    p.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`reg ${args.join(' ')} 退出 ${code}: ${stderr || stdout}`));
    });
  });
}

async function regAdd(key: string, value: string, data: string): Promise<void> {
  const args = value === ''
    ? ['add', key, '/ve', '/d', data, '/f']
    : ['add', key, '/v', value, '/d', data, '/f'];
  await runReg(args);
}

async function regDelete(key: string): Promise<void> {
  try {
    await runReg(['delete', key, '/f']);
  } catch {
    // 不存在也算成功
  }
}

async function regQuery(key: string): Promise<string | null> {
  try {
    return await runReg(['query', key]);
  } catch {
    return null;
  }
}

export function registerContextMenuHandlers(ipcMain: IpcMain) {
  // 安装右键菜单
  ipcMain.handle('ctx:install', async () => {
    if (!app.isPackaged) {
      return {
        ok: false,
        error: '开发模式不支持安装右键菜单（路径指向 electron.exe 而非最终应用）。请先打包成 .exe 后再安装。',
      };
    }
    try {
      const exe = getExePath();
      // 1) 主菜单项：(Default) = "用受控PDF工具打开"
      await regAdd(REG_KEY, '', MENU_LABEL);
      // 2) 图标：用 .exe 自身（索引 0）
      await regAdd(REG_KEY, 'Icon', `${exe},0`);
      // 3) 命令：注册表里要写 "exe路径" "%1"（含引号）。直接传给 spawn 即可
      const commandValue = `"${exe}" "%1"`;
      await regAdd(`${REG_KEY}\\command`, '', commandValue);
      return { ok: true, exePath: exe };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  // 卸载右键菜单
  ipcMain.handle('ctx:uninstall', async () => {
    try {
      await regDelete(REG_KEY);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  // 查询状态
  // 只判断"是否已注册"，不比对路径——因为 reg query 在中文系统下用 GBK 输出，
  // Node 按 UTF-8 解析会乱码，路径比对永远不一致，给用户造成假警告。
  // 用户随时可以点"重新安装"刷新到最新路径。
  ipcMain.handle('ctx:status', async () => {
    const output = await regQuery(`${REG_KEY}\\command`);
    return { installed: !!output, currentExe: getExePath() };
  });
}
