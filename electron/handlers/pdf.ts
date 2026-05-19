/**
 * PDF 处理 IPC handlers - 主进程版
 *
 * 处理流程（防篡改强化版 v1.0.7）：
 *   1) pdf-lib 在内存里把章绘制进 PDF 内容流
 *   2) 写到临时文件
 *   3) 用 qpdf 对临时文件做"加密 + 权限锁定"
 *      - 用户密码空 → 任何人都能打开看
 *      - Owner 密码非空 → WPS / Acrobat / Foxit 等编辑器拒绝编辑/抽页/注释
 *   4) 计算最终文件 SHA256，前 8 位作为防伪短码插入文件名
 *   5) 设为系统只读，避免无意覆盖
 */
import type { IpcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { app } from 'electron';
import {
  PDFDocument,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  concatTransformationMatrix,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

// ===== Owner 密码（写死在程序里）=====
// 仅用于阻止"无心 / 顺手"的编辑；不是真正的高强度密码。
// 任何持有这个密码的人可以解除权限锁。
const OWNER_PASSWORD = 'skyland-ADMIN1';

// 加章后文件名后缀（中文方括号）
const STAMPED_SUFFIX = '【受控】';

// 标识"已加章"的元数据 marker
const STAMP_PRODUCER = 'Controlled-PDF-Studio v1.0.7';
const STAMP_MARKER_PREFIX = 'Controlled-PDF-Studio';

// Windows 自带中文字体（开发机）；打包时会复制到 resources/
function resolveFontPath(): string {
  const candidates = [
    path.join(process.resourcesPath || '', 'fonts', 'simhei.ttf'),
    'C:/Windows/Fonts/simhei.ttf',
    path.join(__dirname, '..', '..', 'public', 'simhei.ttf'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('找不到中文字体 simhei.ttf');
}

let _fontBytes: Buffer | null = null;
function getFontBytes(): Buffer {
  if (_fontBytes) return _fontBytes;
  _fontBytes = fs.readFileSync(resolveFontPath());
  return _fontBytes;
}

// ===== qpdf 解析 =====
let _qpdfPath: string | null = null;
function resolveQpdfPath(): string {
  if (_qpdfPath) return _qpdfPath;
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath || '', 'qpdf', 'qpdf.exe')]
    : [
        path.join(__dirname, '..', 'build', 'qpdf', 'qpdf.exe'),
        path.join(__dirname, '..', '..', 'build', 'qpdf', 'qpdf.exe'),
      ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      _qpdfPath = p;
      return p;
    }
  }
  throw new Error(
    `找不到 qpdf.exe。请在项目根目录运行 "node scripts/setup-qpdf.cjs" 下载，或确认打包配置已包含 build/qpdf/`
  );
}

function hexToRgb(hex: string) {
  const m = hex.replace('#', '').match(/.{1,2}/g)!;
  return rgb(parseInt(m[0], 16) / 255, parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255);
}

function buildRoundedRectPath(w: number, h: number, radius: number) {
  const r = Math.min(radius, w / 2, h / 2);
  if (r <= 0) return `M 0 0 h ${w} v ${h} h ${-w} Z`;
  return `M ${r} 0 ` +
    `h ${w - 2 * r} ` +
    `a ${r} ${r} 0 0 1 ${r} ${r} ` +
    `v ${h - 2 * r} ` +
    `a ${r} ${r} 0 0 1 ${-r} ${r} ` +
    `h ${-(w - 2 * r)} ` +
    `a ${r} ${r} 0 0 1 ${-r} ${-r} ` +
    `v ${-(h - 2 * r)} ` +
    `a ${r} ${r} 0 0 1 ${r} ${-r} Z`;
}

function fillText(template: string, meta: any): string {
  return template
    .replaceAll('{part}', meta.part || '-')
    .replaceAll('{rev}', meta.rev || '-')
    .replaceAll('{date}', meta.date || '-')
    .replaceAll('{operator}', meta.operator || '-');
}

async function checkStamped(bytes: Uint8Array): Promise<boolean> {
  try {
    const doc = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      throwOnInvalidObject: false,
      updateMetadata: false,
    });
    const producer = doc.getProducer() || '';
    const keywords = (doc.getKeywords() || '').toString();
    return producer.includes(STAMP_MARKER_PREFIX) || keywords.includes('controlled-stamped');
  } catch {
    return false;
  }
}

// 文件名匹配 "...【受控】.pdf" 或老格式 "... [8hex].pdf" → 视为本工具已处理
function filenameLooksStamped(filePath: string): boolean {
  const name = path.basename(filePath);
  if (name.includes(STAMPED_SUFFIX)) return true;
  if (/\[[0-9a-f]{8}\]\.pdf$/i.test(name)) return true;
  return false;
}

// 读取文件 SHA256 前 8 位（小写 hex）
function sha256Short(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  return hash.slice(0, 8);
}

// 文件名 foo.pdf → foo【受控】.pdf；处理重名时追加 (1) (2)
// 如果原文件名已经带 【受控】 / [8hex] / _stamped 等冗余后缀，先剥离
// 注意：本函数只是计算"理想最终名"，碰撞检测会跳过 originalOutput 本身，
//      因为 originalOutput 是 qpdf 刚写出的临时文件，下游会 rename 到 final
function buildFinalPath(originalOutput: string): string {
  const dir = path.dirname(originalOutput);
  const baseExt = path.extname(originalOutput);
  let base = path.basename(originalOutput, baseExt);
  base = base
    .replace(/\s*\[[0-9a-f]{8}\](?:\s*\(\d+\))?\s*$/i, '')   // [8hex] 或 [8hex] (1)
    .replace(/_stamped\s*$/i, '')                             // 旧版 _stamped 后缀
    .replace(/【受控】\s*(?:\(\d+\))?\s*$/, '')                // 去掉再重新加（防堆叠）
    .trim();
  const originalLower = path.resolve(originalOutput).toLowerCase();
  let candidate = path.join(dir, `${base}${STAMPED_SUFFIX}${baseExt}`);
  let n = 1;
  while (fs.existsSync(candidate) && path.resolve(candidate).toLowerCase() !== originalLower) {
    candidate = path.join(dir, `${base}${STAMPED_SUFFIX} (${n})${baseExt}`);
    n++;
  }
  return candidate;
}

// Windows 标记只读位（attrib +R）
function setReadonlyWindows(filePath: string) {
  try {
    spawnSync('attrib.exe', ['+R', filePath], { windowsHide: true });
  } catch {
    // 失败不致命，光是 qpdf 权限位已经能挡掉大多数编辑器
  }
}

// 用 qpdf 加密文件
function encryptWithQpdf(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const qpdf = resolveQpdfPath();
    // qpdf 256-bit 默认就是 AES（--use-aes 只用于 128-bit）
    const args = [
      '--encrypt',
      '',                // user password 空 → 打开不需要密码
      OWNER_PASSWORD,
      '256',
      '--modify=none',   // 禁止任何修改
      '--extract=n',     // 禁止文字/图形抽取
      '--print=full',    // 允许高质量打印
      '--annotate=n',    // 禁止注释/填表
      '--assemble=n',    // 禁止文档组装（拆页/重排）
      '--',
      input,
      output,
    ];
    const child = spawn(qpdf, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString('utf-8'); });
    child.on('error', reject);
    child.on('close', (code) => {
      // qpdf 可能用 code 3 表示 warning（成功但有警告），这里只视为错误才拒绝
      if (code === 0 || code === 3) resolve();
      else reject(new Error(`qpdf 加密失败 (exit ${code}): ${stderr || '无 stderr'}`));
    });
  });
}

async function stampBytes(
  inputBytes: Uint8Array,
  stamp: any,
  meta: any,
  applyTo: 'current' | 'all',
  currentPage: number,
  autoPlace: boolean = false
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(inputBytes, {
    ignoreEncryption: true,
    throwOnInvalidObject: false,
    updateMetadata: false,
  });
  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(getFontBytes(), { subset: true });

  const pages = pdfDoc.getPages();
  const targets = applyTo === 'current' ? [pages[currentPage - 1]] : pages;

  for (const page of targets) {
    if (!stamp.enabled) continue;

    // 横版图纸常用 /Rotate=90 标记；包一层图形状态栈应用反向变换矩阵
    // 让后续绘制工作在"视觉坐标系"下，章在用户视觉的右上角且方向正立
    const rotation = ((page.getRotation().angle % 360) + 360) % 360;
    const pw = page.getWidth();
    const ph = page.getHeight();
    const vw = (rotation === 90 || rotation === 270) ? ph : pw;
    const vh = (rotation === 90 || rotation === 270) ? pw : ph;

    let { x, y, width, height } = stamp.layout;
    const margin = 20;
    if (autoPlace || x < 0 || y < 0 || x + width > vw || y + height > vh) {
      width = Math.min(width, vw - margin * 2);
      height = Math.min(height, vh - margin * 2);
      x = vw - width - margin;
      y = vh - height - margin;
    }

    if (rotation !== 0) {
      let cm: [number, number, number, number, number, number];
      if (rotation === 90) cm = [0, 1, -1, 0, pw, 0];
      else if (rotation === 180) cm = [-1, 0, 0, -1, pw, ph];
      else cm = [0, -1, 1, 0, 0, ph];
      page.pushOperators(
        pushGraphicsState(),
        concatTransformationMatrix(...cm)
      );
    }

    const color = hexToRgb(stamp.color);

    const outerPath = buildRoundedRectPath(width, height, stamp.cornerRadius);
    page.drawSvgPath(outerPath, {
      x: x,
      y: y + height,
      borderColor: color,
      borderWidth: stamp.borderWidth,
      borderOpacity: stamp.opacity,
    });

    if (stamp.doubleBorder) {
      const offset = Math.max(2, stamp.borderWidth * 1.5);
      const innerW = width - offset * 2;
      const innerH = height - offset * 2;
      if (innerW > 0 && innerH > 0) {
        const innerRadius = Math.max(0, stamp.cornerRadius - offset);
        const innerPath = buildRoundedRectPath(innerW, innerH, innerRadius);
        page.drawSvgPath(innerPath, {
          x: x + offset,
          y: y + height - offset,
          borderColor: color,
          borderWidth: Math.max(0.3, stamp.borderWidth * 0.4),
          borderOpacity: stamp.opacity,
        });
      }
    }

    const title = fillText(stamp.title, meta);
    const titleW = font.widthOfTextAtSize(title, stamp.titleFontSize);
    const titleX = x + (width - titleW) / 2;
    const titleY = y + height - stamp.padding - stamp.titleFontSize;
    page.drawText(title, {
      x: titleX, y: titleY,
      size: stamp.titleFontSize,
      font, color, opacity: stamp.opacity,
    });

    const lineGap = stamp.contentFontSize * 0.4;
    const lineHeight = stamp.contentFontSize + lineGap;
    const startY = titleY - stamp.padding * 0.6 - stamp.contentFontSize;
    const lines = stamp.lines.map((l: string) => fillText(l, meta));
    const contentTotalH = lines.length * lineHeight - lineGap;
    const contentTop = titleY - stamp.padding * 0.6;
    const contentBottom = y + stamp.padding;
    const availH = contentTop - contentBottom;
    const offsetY = Math.max(0, (availH - contentTotalH) / 2);
    const maxLineW = Math.max(
      ...lines.map((l: string) => font.widthOfTextAtSize(l, stamp.contentFontSize))
    );
    const blockStartX = x + (width - maxLineW) / 2;
    for (let i = 0; i < lines.length; i++) {
      page.drawText(lines[i], {
        x: blockStartX,
        y: startY - i * lineHeight - offsetY,
        size: stamp.contentFontSize,
        font, color, opacity: stamp.opacity,
      });
    }

    if (rotation !== 0) {
      page.pushOperators(popGraphicsState());
    }
  }

  pdfDoc.setProducer(STAMP_PRODUCER);
  pdfDoc.setKeywords([
    'controlled-stamped',
    `part:${meta.part}`,
    `rev:${meta.rev}`,
    `controlled:${meta.date}`,
    `operator:${meta.operator}`,
  ]);
  pdfDoc.setModificationDate(new Date());

  return await pdfDoc.save({ useObjectStreams: true });
}

export interface StampFileResult {
  ok: boolean;
  error?: string;
  skipped?: boolean;
  sizeIn?: number;
  sizeOut?: number;
  finalPath?: string;   // 真正输出的最终文件路径（含 [hash]）
  hash?: string;        // SHA256 前 8 位
  encrypted?: boolean;  // 是否成功加密
  readonly?: boolean;   // 是否成功设为只读
}

export function registerPdfHandlers(ipcMain: IpcMain) {
  ipcMain.handle(
    'pdf:stampFile',
    async (
      _evt,
      input: string,
      output: string,
      stamp: any,
      meta: any,
      applyTo: 'current' | 'all',
      currentPage: number,
      autoPlace?: boolean,
      skipIfStamped?: boolean
    ): Promise<StampFileResult> => {
      let tmpPath = '';
      try {
        const srcBytes = fs.readFileSync(input);

        // 防重复盖章：文件名匹配 [8hex].pdf 或元数据 marker
        if (skipIfStamped) {
          if (filenameLooksStamped(input) || (await checkStamped(srcBytes))) {
            return { ok: true, skipped: true, sizeIn: srcBytes.length };
          }
        }

        // 1) 内存里盖章
        const stampedBytes = await stampBytes(
          srcBytes, stamp, meta, applyTo, currentPage, !!autoPlace
        );

        // 2) 写到临时文件（与目标同目录，方便 qpdf 操作）
        fs.mkdirSync(path.dirname(output), { recursive: true });
        tmpPath = path.join(
          path.dirname(output),
          `.~tmp-${Date.now()}-${path.basename(output)}`
        );
        fs.writeFileSync(tmpPath, stampedBytes);

        // 3) qpdf 加密
        const preEncryptedOutput = output;  // qpdf 输出位置（无 [hash] 后缀）
        await encryptWithQpdf(tmpPath, preEncryptedOutput);
        fs.unlinkSync(tmpPath);
        tmpPath = '';

        // 4) 重命名加 【受控】 后缀；hash 仅作审计返回，不进文件名
        const hash = sha256Short(preEncryptedOutput);
        const finalPath = buildFinalPath(preEncryptedOutput);
        fs.renameSync(preEncryptedOutput, finalPath);
        const sizeOut = fs.statSync(finalPath).size;

        // 5) 设系统只读位
        setReadonlyWindows(finalPath);
        // 检查只读位是否真的生效
        let readonly = false;
        try {
          const mode = fs.statSync(finalPath).mode;
          readonly = (mode & 0o200) === 0;
        } catch {}

        return {
          ok: true,
          sizeIn: srcBytes.length,
          sizeOut,
          finalPath,
          hash,
          encrypted: true,
          readonly,
        };
      } catch (e: any) {
        if (tmpPath && fs.existsSync(tmpPath)) {
          try { fs.unlinkSync(tmpPath); } catch {}
        }
        return { ok: false, error: e.message };
      }
    }
  );

  ipcMain.handle('pdf:checkStamped', async (_evt, input: string) => {
    try {
      if (filenameLooksStamped(input)) return true;
      const bytes = fs.readFileSync(input);
      return await checkStamped(bytes);
    } catch {
      return false;
    }
  });

  // 单文件浏览器 fallback 路径用：只盖章不加密
  // （渲染进程拿到字节后是浏览器下载场景，无法加 owner 密码也没意义）
  ipcMain.handle(
    'pdf:stampBytes',
    async (
      _evt, bytes: Uint8Array, stamp: any, meta: any,
      applyTo: 'current' | 'all', currentPage: number
    ) => {
      return await stampBytes(bytes, stamp, meta, applyTo, currentPage);
    }
  );
}
