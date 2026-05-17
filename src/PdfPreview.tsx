/**
 * PDF 预览组件 - 渲染当前页 + 在上面悬浮可拖拽/缩放的印章
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { Rnd } from 'react-rnd';
import type { AppState, StampConfig, DocMeta } from './types';
import { fillText } from './store';

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
import workerSrc from 'pdfjs-dist/legacy/build/pdf.worker.min?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

interface Props {
  state: AppState;
  onStampLayoutChange: (l: Partial<StampConfig['layout']>) => void;
}

export default function PdfPreview({ state, onStampLayoutChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<any>(null);       // 缓存的 PDFDocumentProxy，避免每次缩放都重新解析
  const renderTaskRef = useRef<any>(null); // 正在执行的 RenderTask，scale 变化时取消
  const [scale, setScale] = useState(1);
  const [autoFit, setAutoFit] = useState(true);  // 默认自动适应窗口
  const [renderedSize, setRenderedSize] = useState({ w: 0, h: 0 });
  const [selected, setSelected] = useState<boolean>(true);

  // PDF 字节变化时（打开新文件）重建 doc 缓存
  useEffect(() => {
    if (!state.pdfBytes) {
      if (docRef.current) {
        try { docRef.current.destroy(); } catch {}
        docRef.current = null;
      }
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // 释放旧 doc
        if (docRef.current) {
          try { docRef.current.destroy(); } catch {}
          docRef.current = null;
        }
        const data = new Uint8Array(state.pdfBytes!.slice(0));
        const newDoc = await pdfjsLib.getDocument({
          data,
          cMapUrl: 'pdfjs/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: 'pdfjs/standard_fonts/',
        }).promise;
        if (cancelled) { try { newDoc.destroy(); } catch {} return; }
        docRef.current = newDoc;
      } catch (e) {
        console.warn('PDF doc load error', e);
      }
    })();
    return () => { cancelled = true; };
  }, [state.pdfBytes]);

  // Ctrl + 滚轮：放大/缩小（macOS 上 Cmd 也行）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      // 退出自动适应模式
      setAutoFit(false);
      // deltaY < 0 = 向上滚 = 放大；> 0 = 向下滚 = 缩小
      const step = 0.1;
      setScale((prev) => {
        const next = e.deltaY < 0 ? prev + step : prev - step;
        return Math.max(0.25, Math.min(3, +next.toFixed(2)));
      });
    };
    // 必须用原生 addEventListener + passive:false 才能 preventDefault
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // 自动适配缩放：横版按宽度，竖版按高度
  useEffect(() => {
    if (!autoFit || !state.pdfBytes || !containerRef.current) return;
    let cancelled = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const recompute = async () => {
      if (cancelled) return;
      const wrap = containerRef.current;
      if (!wrap) return;
      // 容器还没就绪（首次渲染或隐藏）就跳过，避免算出无效 scale
      if (wrap.clientWidth < 100 || wrap.clientHeight < 100) return;
      try {
        const data = new Uint8Array(state.pdfBytes!.slice(0));
        const doc = await pdfjsLib.getDocument({
          data,
          cMapUrl: 'pdfjs/cmaps/',
          cMapPacked: true,
        }).promise;
        if (cancelled) { doc.destroy(); return; }
        const page = await doc.getPage(state.currentPage);
        const vp = page.getViewport({ scale: 1 });
        doc.destroy();
        if (cancelled) return;
        const padding = 60;
        const containerW = wrap.clientWidth - padding;
        const containerH = wrap.clientHeight - padding;
        const isLandscape = vp.width >= vp.height;
        const newScale = isLandscape
          ? containerW / vp.width
          : containerH / vp.height;
        const finalScale = Math.max(0.25, Math.min(3, newScale));
        // 只在变化明显时更新，避免微小抖动反复触发 render
        setScale((prev) => Math.abs(prev - finalScale) > 0.02 ? finalScale : prev);
      } catch {
        // ignore
      }
    };

    // 初次执行（不防抖，让 PDF 立刻显示对的尺寸）
    recompute();

    // 容器尺寸变化时防抖重算
    const ro = new ResizeObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(recompute, 120);
    });
    ro.observe(containerRef.current);
    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      ro.disconnect();
    };
  }, [autoFit, state.pdfBytes, state.currentPage]);

  // 渲染：使用缓存的 doc + 真正取消上一次未完成的 render，避免快速缩放时画面错乱
  useEffect(() => {
    if (!state.pdfBytes) return;
    let cancelled = false;
    (async () => {
      try {
        // 等待 doc 缓存就绪（首次打开时另一个 effect 在并发加载）
        let waitCount = 0;
        while (!docRef.current && waitCount < 50 && !cancelled) {
          await new Promise((r) => setTimeout(r, 30));
          waitCount++;
        }
        if (cancelled || !docRef.current) return;

        const doc = docRef.current;
        const page = await doc.getPage(state.currentPage);
        if (cancelled) return;

        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;

        // ★ 关键：如果有正在进行的 render，先取消它
        if (renderTaskRef.current) {
          try { renderTaskRef.current.cancel(); } catch {}
          renderTaskRef.current = null;
        }

        // 高 DPI 渲染：canvas 内部 buffer = CSS尺寸 × DPR × 2
        const dpr = window.devicePixelRatio || 1;
        const oversample = 2;
        const outputScale = dpr * oversample;

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = Math.floor(viewport.width) + 'px';
        canvas.style.height = Math.floor(viewport.height) + 'px';
        setRenderedSize({ w: viewport.width, h: viewport.height });

        const ctx = canvas.getContext('2d', { alpha: false })!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const transform: [number, number, number, number, number, number] =
          outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : [1, 0, 0, 1, 0, 0];

        const task = page.render({ canvasContext: ctx, viewport, transform });
        renderTaskRef.current = task;
        try {
          await task.promise;
        } catch (e: any) {
          // 被 cancel 是预期的，不打印
          if (e?.name !== 'RenderingCancelledException') {
            console.warn('render error:', e);
          }
        } finally {
          if (renderTaskRef.current === task) renderTaskRef.current = null;
        }
      } catch (e: any) {
        if (e?.name !== 'RenderingCancelledException') {
          console.warn('render outer error:', e);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch {}
        renderTaskRef.current = null;
      }
    };
  }, [state.pdfBytes, state.currentPage, scale]);

  const pt2px = scale;
  const sx = state.stamp.layout.x * pt2px;
  const sy = (state.pageHeight - state.stamp.layout.y - state.stamp.layout.height) * pt2px;
  const sw = state.stamp.layout.width * pt2px;
  const sh = state.stamp.layout.height * pt2px;

  const screenToPdf = useCallback(
    (px: number, py: number, pw: number, ph: number) => ({
      x: px / pt2px,
      y: state.pageHeight - py / pt2px - ph / pt2px,
      width: pw / pt2px,
      height: ph / pt2px,
    }),
    [pt2px, state.pageHeight]
  );

  if (!state.pdfBytes) {
    return (
      <div ref={containerRef} style={emptyStyle}>
        <div style={{ textAlign: 'center', color: '#888' }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>📄</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>把 PDF 拖到这里 · 或点上方"打开"</div>
          <div style={{ marginTop: 8 }}>支持 .pdf 文件</div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#E5E5E5',
        position: 'relative',
      }}
      onClick={() => setSelected(false)}
    >
      {/* 顶部工具栏 - flex item，固定占据顶部，不会被内容遮挡也不跟内容滚动 */}
      <div
        style={{
          flexShrink: 0,
          padding: '8px 0',
          display: 'flex',
          justifyContent: 'center',
          background: '#FAFAFA',
          borderBottom: '1px solid #E5E5E5',
          zIndex: 5,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            background: '#fff',
            padding: '4px 10px',
            borderRadius: 6,
            boxShadow: '0 2px 8px rgba(0,0,0,.1)',
          }}
        >
          <button
            style={btn}
            onClick={() => { setAutoFit(false); setScale((s) => Math.max(0.25, s - 0.1)); }}
            title="缩小"
          >−</button>
          <span style={{ minWidth: 56, textAlign: 'center' }}>
            {autoFit ? '适应 ' : ''}{Math.round(scale * 100)}%
          </span>
          <button
            style={btn}
            onClick={() => { setAutoFit(false); setScale((s) => Math.min(3, s + 0.1)); }}
            title="放大"
          >+</button>
          <button
            style={{ ...btn, background: autoFit ? '#0078D4' : '#F5F5F5', color: autoFit ? '#fff' : '#444' }}
            onClick={() => setAutoFit(true)}
            title="自动适应窗口（横版图按宽度，竖版图按高度）"
          >⤢ 适应</button>
          <button
            style={btn}
            onClick={() => { setAutoFit(false); setScale(1); }}
            title="实际尺寸 100%"
          >1:1</button>
        </div>
      </div>

      {/* 可滚动的 PDF 区域：占满剩余高度，内部用 width:max-content 让 PDF 既能居中又能溢出滚动 */}
      <div style={{ flex: 1, overflow: 'auto', minWidth: 0, minHeight: 0 }}>
        <div
          style={{
            // 内容小于容器时撑到 100%（居中）；大于容器时按内容宽度（溢出滚动）
            minWidth: '100%',
            width: 'max-content',
            minHeight: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px 30px',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              position: 'relative',
              width: renderedSize.w,
              height: renderedSize.h,
              background: '#fff',
              boxShadow: '0 4px 24px rgba(0,0,0,.15)',
              flexShrink: 0,
            }}
          >
        <canvas ref={canvasRef} style={{ display: 'block' }} />

        {state.stamp.enabled && (
          <Rnd
            size={{ width: sw, height: sh }}
            position={{ x: sx, y: sy }}
            onClick={(e: any) => { e.stopPropagation(); setSelected(true); }}
            onDragStop={(_e, d) => {
              const pdf = screenToPdf(d.x, d.y, sw, sh);
              onStampLayoutChange({ x: pdf.x, y: pdf.y });
            }}
            onResizeStop={(_e, _dir, ref, _delta, pos) => {
              const w = parseFloat(ref.style.width);
              const h = parseFloat(ref.style.height);
              const pdf = screenToPdf(pos.x, pos.y, w, h);
              onStampLayoutChange(pdf);
            }}
            bounds="parent"
            style={{
              outline: selected ? '2px dashed #0078D4' : '2px dashed transparent',
              outlineOffset: 2,
            }}
          >
            <StampPreview stamp={state.stamp} meta={state.meta} pt2px={pt2px} />
          </Rnd>
        )}
          </div>
        </div>
      </div>

      <div style={hintStyle}>
        📌 点击印章选中 · 拖动移动 · 边角拉伸调整大小 · Ctrl + 滚轮缩放
      </div>
    </div>
  );
}

/**
 * 印章渲染（透明背景 + 双线红框 + 多行红字）
 */
function StampPreview({ stamp, meta, pt2px }: {
  stamp: StampConfig; meta: DocMeta; pt2px: number;
}) {
  const title = fillText(stamp.title, meta);
  const lines = stamp.lines.map((l) => fillText(l, meta));
  const padPx = stamp.padding * pt2px;
  const titleFs = stamp.titleFontSize * pt2px * 0.85;
  const contentFs = stamp.contentFontSize * pt2px * 0.85;

  // 双线边框：外框 + 内框（CSS outline + border 组合）
  const borderColor = stamp.color;
  const borderWidthPx = stamp.borderWidth * pt2px;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: 'transparent',
        opacity: stamp.opacity,
        borderRadius: stamp.cornerRadius * pt2px,
        border: `${borderWidthPx}px solid ${borderColor}`,
        boxShadow: stamp.doubleBorder
          ? `inset 0 0 0 ${Math.max(1, borderWidthPx * 0.5)}px transparent, inset 0 0 0 ${Math.max(2, borderWidthPx * 1.5)}px ${borderColor}`
          : 'none',
        padding: padPx,
        display: 'flex',
        flexDirection: 'column',
        color: borderColor,
        boxSizing: 'border-box',
        userSelect: 'none',
        cursor: 'move',
        overflow: 'hidden',
      }}
    >
      <div style={{
        fontSize: titleFs,
        fontWeight: 800,
        textAlign: 'center',
        marginBottom: padPx * 0.5,
        letterSpacing: '0.04em',
        lineHeight: 1.1,
      }}>
        {title}
      </div>
      {/* 容器水平居中；内部块用 inline-block 自适应宽度 + 行内左对齐 */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{
          display: 'inline-flex',
          flexDirection: 'column',
          gap: contentFs * 0.4,
          fontSize: contentFs,
          fontWeight: 600,
          lineHeight: 1.15,
          textAlign: 'left',
        }}>
          {lines.map((l, i) => (
            <div key={i} style={{ whiteSpace: 'nowrap' }}>
              {l}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const emptyStyle: React.CSSProperties = {
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#F5F5F5',
};
const btn: React.CSSProperties = {
  padding: '4px 10px',
  background: '#F5F5F5',
  border: '1px solid #D1D1D1',
  borderRadius: 4,
};
const hintStyle: React.CSSProperties = {
  textAlign: 'center',
  padding: '6px',
  color: '#666',
  fontSize: 12,
  background: '#FAFAFA',
  borderTop: '1px solid #E5E5E5',
  flexShrink: 0,
};
