/**
 * PDF 处理 IPC handlers - 主进程版（用 pdf-lib + 内置中文字体）
 */
import type { IpcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
  PDFDocument,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  concatTransformationMatrix,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

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

// 写入完整版本号到 PDF 元数据
const STAMP_PRODUCER = 'Controlled-PDF-Studio v1.0.5';
// 检测时只看前缀，兼容历史版本
const STAMP_MARKER_PREFIX = 'Controlled-PDF-Studio';

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

    // ★ 处理 PDF rotation：横版图纸常用 /Rotate=90 标记
    // 我们把所有绘制工作"包"在一个图形状态栈里，应用反向变换矩阵
    // 让后续绘制工作在"视觉坐标系"下，章在用户视觉的右上角且方向正立
    const rotation = ((page.getRotation().angle % 360) + 360) % 360;
    const pw = page.getWidth();
    const ph = page.getHeight();
    // 用户视觉空间的尺寸（横版/竖版的"显示"宽高）
    const vw = (rotation === 90 || rotation === 270) ? ph : pw;
    const vh = (rotation === 90 || rotation === 270) ? pw : ph;

    let { x, y, width, height } = stamp.layout;
    const margin = 20;
    // autoPlace=true（批量模式）或章超出页面边界 → 强制放在视觉空间的右上角
    if (autoPlace || x < 0 || y < 0 || x + width > vw || y + height > vh) {
      width = Math.min(width, vw - margin * 2);
      height = Math.min(height, vh - margin * 2);
      x = vw - width - margin;
      y = vh - height - margin;
    }

    // 推入图形状态 + 反向变换矩阵
    // 视觉坐标系 → 物理坐标系的映射
    if (rotation !== 0) {
      let cm: [number, number, number, number, number, number];
      if (rotation === 90) cm = [0, 1, -1, 0, pw, 0];
      else if (rotation === 180) cm = [-1, 0, 0, -1, pw, ph];
      else cm = [0, -1, 1, 0, 0, ph]; // 270
      page.pushOperators(
        pushGraphicsState(),
        concatTransformationMatrix(...cm)
      );
    }

    const color = hexToRgb(stamp.color);

    // 外框
    const outerPath = buildRoundedRectPath(width, height, stamp.cornerRadius);
    page.drawSvgPath(outerPath, {
      x: x,
      y: y + height,
      borderColor: color,
      borderWidth: stamp.borderWidth,
      borderOpacity: stamp.opacity,
    });

    // 双线内框
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

    // 标题（居中）
    const title = fillText(stamp.title, meta);
    const titleW = font.widthOfTextAtSize(title, stamp.titleFontSize);
    const titleX = x + (width - titleW) / 2;
    const titleY = y + height - stamp.padding - stamp.titleFontSize;
    page.drawText(title, {
      x: titleX, y: titleY,
      size: stamp.titleFontSize,
      font, color, opacity: stamp.opacity,
    });

    // 正文块整体居中（块内左对齐）
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

    // 关闭图形状态栈（恢复物理坐标系）
    if (rotation !== 0) {
      page.pushOperators(popGraphicsState());
    }
  }

  // 元数据 marker（标识"已加章"，跳过判断用）
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

export function registerPdfHandlers(ipcMain: IpcMain) {
  // 文件 → 文件（autoPlace=true 用于批量模式：每页自动放视觉右上角）
  // skipIfStamped=true 时若检测到 PDF 已加过章则跳过
  ipcMain.handle(
    'pdf:stampFile',
    async (_evt, input: string, output: string, stamp: any, meta: any,
      applyTo: 'current' | 'all', currentPage: number,
      autoPlace?: boolean, skipIfStamped?: boolean) => {
      try {
        const srcBytes = fs.readFileSync(input);
        if (skipIfStamped) {
          const alreadyStamped = await checkStamped(srcBytes);
          if (alreadyStamped) {
            return { ok: true, skipped: true, sizeIn: srcBytes.length };
          }
        }
        const out = await stampBytes(srcBytes, stamp, meta, applyTo, currentPage, !!autoPlace);
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, out);
        return { ok: true, sizeIn: srcBytes.length, sizeOut: out.length };
      } catch (e: any) {
        return { ok: false, error: e.message };
      }
    }
  );

  // 检测 PDF 是否已加过章（用元数据中的 Producer marker 判断）
  ipcMain.handle('pdf:checkStamped', async (_evt, input: string) => {
    try {
      const bytes = fs.readFileSync(input);
      return await checkStamped(bytes);
    } catch {
      return false;
    }
  });

  // 字节 → 字节（用于单文件预览模式：渲染进程已经持有 ArrayBuffer）
  ipcMain.handle(
    'pdf:stampBytes',
    async (_evt, bytes: Uint8Array, stamp: any, meta: any,
      applyTo: 'current' | 'all', currentPage: number) => {
      return await stampBytes(bytes, stamp, meta, applyTo, currentPage);
    }
  );
}
