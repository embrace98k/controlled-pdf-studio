export interface WatermarkLayout {
  // 位置和尺寸都用"PDF 坐标系下的 pt 值"存储（左下角原点）
  x: number;      // 左下角 X
  y: number;      // 左下角 Y
  width: number;
  height: number;
}

export interface StampConfig {
  enabled: boolean;
  title: string;             // 标题行（粗体大字）
  lines: string[];           // 详细行（支持 {part} {rev} {date} {operator}）
  titleFontSize: number;     // pt
  contentFontSize: number;   // pt
  color: string;             // 边框 + 文字色 #rrggbb
  borderWidth: number;       // pt
  doubleBorder: boolean;     // 是否双线边框
  cornerRadius: number;      // pt
  opacity: number;           // 0~1
  padding: number;           // 内边距 pt
  layout: WatermarkLayout;
}

export interface DocMeta {
  part: string;
  rev: string;
  date: string;
  operator: string;
}

export interface AppState {
  pdfFileName: string | null;
  pdfSourcePath: string | null;   // Electron 模式下保留源文件路径，用于直接写到同目录
  pdfBytes: ArrayBuffer | null;
  pdfPageCount: number;
  currentPage: number;       // 1-based
  pageWidth: number;          // pt
  pageHeight: number;         // pt
  meta: DocMeta;
  stamp: StampConfig;
  applyTo: 'current' | 'all';
}
