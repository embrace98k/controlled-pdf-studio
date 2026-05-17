/**
 * 计算章在视觉空间下的最终位置
 * （与 electron/handlers/pdf.ts 中的同名逻辑保持一致）
 */
import type { WatermarkLayout } from './types';

export interface ResolvedLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  visualW: number;
  visualH: number;
  rotation: number;
}

export function resolveStampLayout(
  pdfPageWidth: number,
  pdfPageHeight: number,
  rotation: number,
  base: WatermarkLayout,
  autoPlace: boolean,
  margin = 20
): ResolvedLayout {
  const r = ((rotation % 360) + 360) % 360;
  const vw = (r === 90 || r === 270) ? pdfPageHeight : pdfPageWidth;
  const vh = (r === 90 || r === 270) ? pdfPageWidth : pdfPageHeight;

  let { x, y, width, height } = base;
  if (autoPlace || x < 0 || y < 0 || x + width > vw || y + height > vh) {
    width = Math.min(width, vw - margin * 2);
    height = Math.min(height, vh - margin * 2);
    x = vw - width - margin;
    y = vh - height - margin;
  }
  return { x, y, width, height, visualW: vw, visualH: vh, rotation: r };
}
