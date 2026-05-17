import { useState, useCallback } from 'react';
import type { AppState, StampConfig, DocMeta } from './types';

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 解析公司编号
 * 格式：M.<X>.<Y>.<4位数字>.<可选字母前缀+2位版本>
 *
 * 例子：
 *   M.M.1.0028.04           机械机加件，普通版本 04
 *   M.A.1.0006.01           机械总成
 *   M.E.E.0014.04           电子板卡
 *   M.E.H.0015.02           线材
 *   M.E.0.0026.01           外购模组
 *   M.M.1.0092.PL03         胚料件（素材未后处理），第 03 版
 *   M.M.1.0123.LS01         临时物料，第 01 版
 *
 * X/Y 为单字母或单数字；4 位数字 = 零件序号；
 * 版本号 = 可选字母前缀(如 PL/LS) + 2 位数字
 */
export function parseFilenameMeta(name: string): DocMeta {
  const operator = loadSavedOperator();
  const m = name.match(/^(M\.[A-Z0-9](?:\.[A-Z0-9])?\.\d{4})(?:\.([A-Z]{0,3}\d{2}))?\b/i);
  if (m) {
    const baseNo = m[1];                                  // 例如 M.M.1.0092
    const revRaw = m[2] || '';                            // 例如 'PL03' / '04' / ''
    const revDigits = revRaw.replace(/^[A-Z]+/i, '') || '01'; // 提取数字部分作为版本号
    const fullPart = revRaw ? `${baseNo}.${revRaw}` : baseNo; // 完整零件号保留字母前缀
    return { part: fullPart, rev: revDigits, date: todayStr(), operator };
  }
  return { part: name.replace(/\.pdf$/i, ''), rev: '01', date: todayStr(), operator };
}

// 操作人记住上次输入（localStorage）
function loadSavedOperator(): string {
  try { return localStorage.getItem('ctrl-operator') || ''; } catch { return ''; }
}
function saveOperator(name: string) {
  try { localStorage.setItem('ctrl-operator', name); } catch {}
}

const STAMP_DEFAULT_TITLE = '★ 受 控 ★';
const STAMP_DEFAULT_LINES = [
  '编号：{part}',
  '版本：Rev.{rev}',
  '受控日期：{date}',
  '操作人：{operator}',
];

function defaultStamp(pageW: number, pageH: number): StampConfig {
  // 宽度按"最长一行内容刚好填满 + 留少量边距"计算
  // "受控日期：2026-05-17" 是默认最长行
  const w = 110;   // 比之前 180/120 都更贴合内容
  const h = 78;
  return {
    enabled: true,
    title: STAMP_DEFAULT_TITLE,
    lines: STAMP_DEFAULT_LINES,
    titleFontSize: 11,      // 恢复到易读尺寸
    contentFontSize: 8,
    color: '#B91C1C',
    borderWidth: 1.2,
    doubleBorder: true,
    cornerRadius: 3,
    opacity: 0.95,
    padding: 5,
    layout: {
      // 默认放在图纸右上角空白处，留 20pt 边距
      x: Math.max(20, pageW - w - 20),
      y: Math.max(20, pageH - h - 20),
      width: w,
      height: h,
    },
  };
}

const initialState: AppState = {
  pdfFileName: null,
  pdfSourcePath: null,
  pdfBytes: null,
  pdfPageCount: 0,
  currentPage: 1,
  pageWidth: 595,
  pageHeight: 842,
  meta: { part: '-', rev: '-', date: todayStr(), operator: loadSavedOperator() },
  stamp: defaultStamp(595, 842),
  applyTo: 'all',
};

export function useAppStore() {
  const [state, setState] = useState<AppState>(initialState);

  const loadPdf = useCallback(
    (
      file: File,
      bytes: ArrayBuffer,
      pageCount: number,
      pageW: number,
      pageH: number,
      sourcePath: string | null = null,
    ) => {
      const meta = parseFilenameMeta(file.name);
      setState((prev) => ({
        ...initialState,
        pdfFileName: file.name,
        pdfSourcePath: sourcePath,
        pdfBytes: bytes,
        pdfPageCount: pageCount,
        currentPage: 1,
        pageWidth: pageW,
        pageHeight: pageH,
        meta,
        stamp: { ...defaultStamp(pageW, pageH), ...prev.stamp, layout: defaultStamp(pageW, pageH).layout },
      }));
    },
    []
  );

  const updateStamp = useCallback((patch: Partial<StampConfig>) => {
    setState((s) => ({ ...s, stamp: { ...s.stamp, ...patch } }));
  }, []);

  const updateStampLayout = useCallback((patch: Partial<StampConfig['layout']>) => {
    setState((s) => ({
      ...s,
      stamp: { ...s.stamp, layout: { ...s.stamp.layout, ...patch } },
    }));
  }, []);

  const updateMeta = useCallback((patch: Partial<DocMeta>) => {
    setState((s) => ({ ...s, meta: { ...s.meta, ...patch } }));
    if (patch.operator !== undefined) saveOperator(patch.operator);
  }, []);

  const setCurrentPage = useCallback((p: number) => {
    setState((s) => ({ ...s, currentPage: Math.max(1, Math.min(p, s.pdfPageCount)) }));
  }, []);

  const setApplyTo = useCallback((v: 'current' | 'all') => {
    setState((s) => ({ ...s, applyTo: v }));
  }, []);

  return {
    state,
    loadPdf,
    updateStamp,
    updateStampLayout,
    updateMeta,
    setCurrentPage,
    setApplyTo,
  };
}

export function fillText(template: string, meta: DocMeta): string {
  return template
    .replaceAll('{part}', meta.part)
    .replaceAll('{rev}', meta.rev)
    .replaceAll('{date}', meta.date)
    .replaceAll('{operator}', meta.operator || '-');
}
