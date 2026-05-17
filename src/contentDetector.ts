/**
 * 内容检测：渲染 PDF 指定页的目标矩形区域，统计非白像素比例
 * 用于决定章应该用何种透明度（盖在内容上 vs 盖在空白处）
 */
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
import workerSrc from 'pdfjs-dist/legacy/build/pdf.worker.min?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export interface DetectResult {
  hasContent: boolean;
  ratio: number;          // 非白像素占比 0~1
}

/**
 * 注意 vx/vy/vw/vh 是"视觉坐标系"下的章位置（左下角 + 宽高，单位 pt）
 */
export async function detectRegionContent(
  pdfBytes: ArrayBuffer | Uint8Array,
  pageNum: number,
  vx: number, vy: number, vw: number, vh: number,
  options: { threshold?: number; renderScale?: number; label?: string } = {}
): Promise<DetectResult> {
  const threshold = options.threshold ?? 0.003;   // 0.3% 非白即视为"有内容"
  const renderScale = options.renderScale ?? 1.5;
  const label = options.label || '';

  const data = pdfBytes instanceof ArrayBuffer
    ? new Uint8Array(pdfBytes)
    : pdfBytes;

  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(data),
    cMapUrl: 'pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: 'pdfjs/standard_fonts/',
  }).promise;

  try {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: renderScale });

    // 用普通 HTMLCanvasElement（兼容性最好，pdf.js 官方推荐）
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d', { alpha: false })!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;

    // 视觉坐标 (vx, vy) [左下原点] → canvas 像素 (cx, cy) [左上原点]
    const visualPageHPt = viewport.height / renderScale;
    const left = Math.max(0, Math.floor(vx * renderScale));
    const top = Math.max(0, Math.floor((visualPageHPt - vy - vh) * renderScale));
    const right = Math.min(canvas.width, Math.ceil((vx + vw) * renderScale));
    const bottom = Math.min(canvas.height, Math.ceil((visualPageHPt - vy) * renderScale));
    const sampleW = right - left;
    const sampleH = bottom - top;
    if (sampleW <= 0 || sampleH <= 0) {
      console.warn('[detect]', label, 'invalid sample region', { left, top, right, bottom });
      return { hasContent: false, ratio: 0 };
    }

    const img = ctx.getImageData(left, top, sampleW, sampleH);
    const px: Uint8ClampedArray = img.data;

    // 密集采样 + 宽松"非白"判定（浅灰、淡线都算）
    const step = 2;
    let nonWhite = 0;
    let counted = 0;
    for (let y = 0; y < sampleH; y += step) {
      for (let x = 0; x < sampleW; x += step) {
        const i = (y * sampleW + x) * 4;
        if (px[i] < 245 || px[i + 1] < 245 || px[i + 2] < 245) {
          nonWhite++;
        }
        counted++;
      }
    }
    const ratio = counted > 0 ? nonWhite / counted : 0;
    const hasContent = ratio > threshold;
    console.log(
      `[detect] ${label}`,
      `region=(${left},${top},${sampleW},${sampleH})`,
      `ratio=${(ratio * 100).toFixed(2)}%`,
      `→ ${hasContent ? '有内容' : '空白'} (阈值${(threshold * 100).toFixed(1)}%)`
    );
    return { hasContent, ratio };
  } finally {
    doc.destroy();
  }
}
