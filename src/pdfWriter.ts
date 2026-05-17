/**
 * 浏览器内 PDF 印章写入器（使用 pdf-lib）
 * 注意：浏览器无 muhammara，所以不加密。Electron 版会启用加密。
 */
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { AppState, StampConfig } from './types';
import { fillText } from './store';

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

export async function stampPdf(state: AppState): Promise<Uint8Array> {
  if (!state.pdfBytes) throw new Error('未加载 PDF');

  // Electron 模式：走主进程（用本地字体，更快且避免重复下载）
  if (window.api?.isElectron) {
    const bytes = new Uint8Array(state.pdfBytes.slice(0));
    return await window.api.stampPdfBytes(
      bytes,
      state.stamp,
      state.meta,
      state.applyTo,
      state.currentPage
    );
  }

  // 浏览器模式：走 pdf-lib，宽容模式
  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(state.pdfBytes.slice(0), {
      ignoreEncryption: true,
      throwOnInvalidObject: false,
      updateMetadata: false,
    });
  } catch (e: any) {
    throw new Error(
      `PDF 结构无法解析。建议先用 Adobe Acrobat / Foxit 打开，另存为标准 PDF 后再试。\n原因：${e.message}`
    );
  }
  pdfDoc.registerFontkit(fontkit);

  const fontResp = await fetch('simhei.ttf');
  if (!fontResp.ok) throw new Error('字体加载失败：simhei.ttf');
  const fontBytes = await fontResp.arrayBuffer();
  const font = await pdfDoc.embedFont(fontBytes, { subset: true });

  const targetPages =
    state.applyTo === 'current'
      ? [pdfDoc.getPages()[state.currentPage - 1]]
      : pdfDoc.getPages();

  for (const page of targetPages) {
    if (state.stamp.enabled) {
      drawStamp(page, state.stamp, state, font);
    }
  }

  return await pdfDoc.save({ useObjectStreams: true });
}

function drawStamp(page: any, stamp: StampConfig, state: AppState, font: any) {
  const { x, y, width, height } = stamp.layout;
  const color = hexToRgb(stamp.color);

  // -------- 边框（无填充） --------
  const outerPath = buildRoundedRectPath(width, height, stamp.cornerRadius);
  page.drawSvgPath(outerPath, {
    x: x,
    y: y + height,
    borderColor: color,
    borderWidth: stamp.borderWidth,
    borderOpacity: stamp.opacity,
    // 不填充：通过 color 不传实现
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

  // -------- 标题（居中） --------
  const title = fillText(stamp.title, state.meta);
  const titleW = font.widthOfTextAtSize(title, stamp.titleFontSize);
  const titleX = x + (width - titleW) / 2;
  const titleY = y + height - stamp.padding - stamp.titleFontSize;
  page.drawText(title, {
    x: titleX,
    y: titleY,
    size: stamp.titleFontSize,
    font,
    color,
    opacity: stamp.opacity,
  });

  // -------- 正文（多行，左对齐） --------
  const lineGap = stamp.contentFontSize * 0.4;
  const lineHeight = stamp.contentFontSize + lineGap;
  const startY = titleY - stamp.padding * 0.6 - stamp.contentFontSize;

  const lines = stamp.lines.map((l) => fillText(l, state.meta));
  // 让正文整体居中（垂直），但左对齐
  const contentTotalH = lines.length * lineHeight - lineGap;
  const contentTop = titleY - stamp.padding * 0.6;
  const contentBottom = y + stamp.padding;
  const availH = contentTop - contentBottom;
  const offsetY = Math.max(0, (availH - contentTotalH) / 2);

  // 文字块作为一个整体水平居中（块内各行左对齐）
  // → 找到最长行宽度，所有行共用同一个起始 X 坐标
  const maxLineW = Math.max(
    ...lines.map((l) => font.widthOfTextAtSize(l, stamp.contentFontSize))
  );
  const blockStartX = x + (width - maxLineW) / 2;

  for (let i = 0; i < lines.length; i++) {
    page.drawText(lines[i], {
      x: blockStartX,
      y: startY - i * lineHeight - offsetY,
      size: stamp.contentFontSize,
      font,
      color,
      opacity: stamp.opacity,
    });
  }
}

export function downloadBlob(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([bytes.slice(0) as any], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
