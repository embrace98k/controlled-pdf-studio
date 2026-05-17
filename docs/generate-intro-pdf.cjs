/**
 * 项目介绍 PDF 生成器（精致版）
 * 用法：node docs/generate-intro-pdf.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

// ============ 页面规格 ============
const W = 595.28;
const H = 841.89;
const PADDING = 50;
const CONTENT_W = W - PADDING * 2;

// ============ 设计系统 ============
const COLOR = {
  primary: rgb(0.482, 0.227, 0.929),    // 主紫 #7C3AED
  primaryLight: rgb(0.925, 0.91, 0.992), // 浅紫 #ECE8FD
  accent: rgb(0.925, 0.282, 0.6),        // 强调粉 #EC4899
  accentLight: rgb(0.992, 0.91, 0.953),  // 浅粉
  ink: rgb(0.106, 0.122, 0.169),         // 深墨 #1B1F2B
  text: rgb(0.2, 0.22, 0.27),            // 正文 #333845
  muted: rgb(0.45, 0.48, 0.55),          // 弱化 #737B8C
  hint: rgb(0.6, 0.63, 0.68),            // 提示 #989FAC
  divider: rgb(0.9, 0.91, 0.93),         // 分隔线
  cardBg: rgb(0.972, 0.976, 0.984),      // 卡片背景 #F8F9FB
  cardBorder: rgb(0.925, 0.933, 0.945),  // 卡片边框
  white: rgb(1, 1, 1),
  black: rgb(0, 0, 0),
  // 状态色
  green: rgb(0.094, 0.486, 0.357),       // #187C5B
  greenLight: rgb(0.88, 0.965, 0.918),   // #E0F6EA
  blue: rgb(0, 0.471, 0.831),
  blueLight: rgb(0.918, 0.957, 1),
  amber: rgb(0.706, 0.43, 0.04),
  amberLight: rgb(1, 0.965, 0.886),
  red: rgb(0.725, 0.114, 0.114),
};

const FONT_SIZE = {
  cover: 36,
  display: 26,
  h1: 19,
  h2: 14,
  h3: 11,
  body: 10,
  small: 9,
  tiny: 8,
};

// ============ 主流程 ============
(async () => {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const fontBytes = fs.readFileSync(path.join(__dirname, '..', 'public', 'simhei.ttf'));
  const FONT = await pdfDoc.embedFont(fontBytes, { subset: true });
  const FONT_EN = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const FONT_EN_BOLD = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // 状态
  const ctx = { pdfDoc, font: FONT, fontEN: FONT_EN, fontENBold: FONT_EN_BOLD };

  // 渲染各页
  drawCoverPage(ctx);
  drawTocPage(ctx);
  drawSection1(ctx);
  drawSection2(ctx);
  drawSection3(ctx);
  drawSection4_5(ctx);
  drawSection6(ctx);

  // 给所有页面加页脚
  const pages = pdfDoc.getPages();
  for (let i = 0; i < pages.length; i++) {
    if (i === 0) continue; // 封面不加
    drawFooter(pages[i], FONT, FONT_EN, i + 1, pages.length);
  }

  const outPath = path.join(__dirname, '受控PDF盖章工具-使用说明-v1.0.5.pdf');
  const bytes = await pdfDoc.save({ useObjectStreams: true });
  fs.writeFileSync(outPath, bytes);
  console.log('✓', outPath);
  console.log('  大小:', (bytes.length / 1024).toFixed(1), 'KB');
  console.log('  页数:', pages.length);
})();

// ============ 通用绘图工具 ============
function wrapText(text, font, size, maxW) {
  const out = [];
  for (const raw of text.split('\n')) {
    let line = '';
    for (const ch of raw) {
      const test = line + ch;
      if (font.widthOfTextAtSize(test, size) > maxW) {
        out.push(line);
        line = ch;
      } else {
        line = test;
      }
    }
    out.push(line);
  }
  return out;
}

function drawFooter(page, font, fontEN, pageNum, total) {
  // 顶部细色块
  page.drawRectangle({
    x: PADDING, y: H - 28, width: 30, height: 3,
    color: COLOR.primary,
  });
  page.drawText('受控PDF盖章工具', {
    x: PADDING + 38, y: H - 25, size: 8, font, color: COLOR.muted,
  });
  page.drawText('v1.0.5  ·  使用说明', {
    x: PADDING + 38 + font.widthOfTextAtSize('受控PDF盖章工具', 8) + 8,
    y: H - 25, size: 8, font, color: COLOR.hint,
  });
  // 底部页码
  page.drawText(String(pageNum), {
    x: W - PADDING - 20, y: 20, size: 9, font: fontEN, color: COLOR.muted,
  });
  page.drawText(`/ ${total}`, {
    x: W - PADDING - 5, y: 20, size: 8, font: fontEN, color: COLOR.hint,
  });
  // 底部公司
  page.drawText('© 2026 深圳市无穹创新科技有限公司', {
    x: PADDING, y: 20, size: 8, font, color: COLOR.hint,
  });
}

// ==================== 封面页 ====================
function drawCoverPage({ pdfDoc, font, fontEN, fontENBold }) {
  const page = pdfDoc.addPage([W, H]);

  // 渐变背景（用多个矩形堆叠模拟）
  const bgSteps = 30;
  for (let i = 0; i < bgSteps; i++) {
    const t = i / bgSteps;
    page.drawRectangle({
      x: 0, y: H - (i + 1) * (H * 0.55 / bgSteps),
      width: W, height: H * 0.55 / bgSteps + 1,
      color: rgb(
        0.482 + (0.925 - 0.482) * t,
        0.227 + (0.282 - 0.227) * t,
        0.929 + (0.6 - 0.929) * t
      ),
    });
  }

  // 装饰几何 - 右上角圆环
  page.drawCircle({ x: W - 50, y: H - 80, size: 80, borderColor: rgb(1, 1, 1), borderWidth: 1, opacity: 0.15 });
  page.drawCircle({ x: W - 50, y: H - 80, size: 50, borderColor: rgb(1, 1, 1), borderWidth: 1, opacity: 0.2 });
  page.drawCircle({ x: W - 50, y: H - 80, size: 25, color: rgb(1, 1, 1), opacity: 0.1 });

  // 装饰点阵
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 12; c++) {
      page.drawCircle({
        x: 30 + c * 12, y: H - 200 - r * 12,
        size: 1.2,
        color: rgb(1, 1, 1), opacity: 0.18,
      });
    }
  }

  // 顶部小标签
  page.drawRectangle({
    x: PADDING, y: H - 95, width: 110, height: 26, color: rgb(1, 1, 1), opacity: 0.18,
  });
  page.drawText('CONTROLLED PDF STUDIO', {
    x: PADDING + 8, y: H - 88, size: 9, font: fontENBold, color: rgb(1, 1, 1),
  });

  // 主标题
  page.drawText('受控PDF盖章工具', {
    x: PADDING, y: H - 160, size: 36, font, color: rgb(1, 1, 1),
  });

  // 副标题
  page.drawText('给机械零件受控库 PDF 一键加盖电子受控印章', {
    x: PADDING, y: H - 195, size: 12, font, color: rgb(0.95, 0.93, 1),
  });

  // 一条短色块
  page.drawRectangle({
    x: PADDING, y: H - 220, width: 40, height: 3, color: rgb(1, 1, 1),
  });

  // 版本信息
  page.drawText('v1.0.5', {
    x: PADDING, y: H - 250, size: 14, font: fontENBold, color: rgb(1, 1, 1),
  });
  page.drawText('Windows · 桌面应用', {
    x: PADDING + 50, y: H - 248, size: 10, font, color: rgb(0.95, 0.93, 1),
  });

  // ========== 中段：关键数据卡片 ==========
  const dataCards = [
    { num: '671', label: '受控 PDF\n图纸总数' },
    { num: '4', label: '核心模块' },
    { num: '<1s', label: '单文件加章\n平均耗时' },
    { num: '100%', label: '中文图纸\n兼容' },
  ];
  const cardY = H * 0.45;
  const cardW = (CONTENT_W - 30) / 4;
  for (let i = 0; i < dataCards.length; i++) {
    const d = dataCards[i];
    const x = PADDING + i * (cardW + 10);
    page.drawRectangle({
      x, y: cardY - 90, width: cardW, height: 90,
      color: COLOR.white,
      borderColor: COLOR.cardBorder, borderWidth: 0.5,
    });
    page.drawText(d.num, {
      x: x + 12, y: cardY - 38, size: 22, font: fontENBold, color: COLOR.primary,
    });
    const labelLines = d.label.split('\n');
    for (let li = 0; li < labelLines.length; li++) {
      page.drawText(labelLines[li], {
        x: x + 12, y: cardY - 56 - li * 11, size: 9, font, color: COLOR.muted,
      });
    }
  }

  // ========== 下段：4 个核心特性 ==========
  const features = [
    ['📄', '单文件精调', '拖拽印章 · 实时预览 · 智能适应'],
    ['📁', '批量处理',   '多图幅自适应 · 自动跳过已加章'],
    ['⭐', '模板系统',   '保存常用配置 · JSON 团队共享'],
    ['🎯', '智能透明度', '检测目标区域，自动调整透明度'],
  ];
  const featStartY = cardY - 130;
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    const x = PADDING + (i % 2) * (CONTENT_W / 2 + 5);
    const y = featStartY - Math.floor(i / 2) * 70;
    page.drawRectangle({
      x, y: y - 56, width: CONTENT_W / 2 - 5, height: 56,
      color: COLOR.cardBg,
      borderColor: COLOR.divider, borderWidth: 0.5,
    });
    page.drawText(f[0], { x: x + 14, y: y - 28, size: 18, font });
    page.drawText(f[1], { x: x + 44, y: y - 22, size: 11, font, color: COLOR.ink });
    page.drawText(f[2], { x: x + 44, y: y - 40, size: 8.5, font, color: COLOR.muted });
  }

  // 底部色条
  page.drawRectangle({
    x: 0, y: 0, width: W, height: 50, color: COLOR.ink,
  });
  page.drawRectangle({
    x: 0, y: 50, width: W, height: 3, color: COLOR.accent,
  });
  page.drawText('深圳市无穹创新科技有限公司', {
    x: PADDING, y: 27, size: 10, font, color: rgb(1, 1, 1),
  });
  page.drawText('Shenzhen Wuqiong Innovation Technology Co., Ltd.', {
    x: PADDING, y: 12, size: 7.5, font: fontEN, color: rgb(0.7, 0.72, 0.78),
  });
  page.drawText('© 2026', {
    x: W - PADDING - 35, y: 27, size: 9, font: fontEN, color: rgb(0.7, 0.72, 0.78),
  });
}

// ==================== 目录页 ====================
function drawTocPage({ pdfDoc, font, fontEN, fontENBold }) {
  const page = pdfDoc.addPage([W, H]);
  let y = H - 80;

  // 页眉
  page.drawText('TABLE OF CONTENTS', {
    x: PADDING, y: y, size: 9, font: fontENBold, color: COLOR.primary,
  });
  y -= 30;
  page.drawText('目', { x: PADDING, y, size: 36, font, color: COLOR.ink });
  page.drawText('录', { x: PADDING + 50, y, size: 36, font, color: COLOR.ink });
  y -= 30;
  page.drawRectangle({ x: PADDING, y, width: 60, height: 3, color: COLOR.primary });
  y -= 50;

  const toc = [
    ['01', '项目背景',         '为什么需要这个工具',                 3],
    ['02', '核心功能',         '5 大模块功能概述',                   3],
    ['03', '使用说明',         '安装 · 单文件 · 批量 全流程指引',    4],
    ['04', '印章设计',         '编号格式 / 文件名解析规则',          5],
    ['05', '常见问题',         '高频问题答疑',                       5],
    ['06', '技术栈',           '开源依赖致谢',                       5],
  ];

  for (const [num, title, sub, pn] of toc) {
    // 序号
    page.drawText(num, {
      x: PADDING, y: y, size: 22, font: fontENBold, color: COLOR.primary,
    });
    // 标题
    page.drawText(title, {
      x: PADDING + 50, y: y + 4, size: 16, font, color: COLOR.ink,
    });
    // 副标题
    page.drawText(sub, {
      x: PADDING + 50, y: y - 14, size: 9, font, color: COLOR.muted,
    });
    // 虚线 + 页码
    const dotsX = PADDING + 50 + font.widthOfTextAtSize(title, 16) + 12;
    const dotsEndX = W - PADDING - 20;
    for (let dx = dotsX; dx < dotsEndX; dx += 5) {
      page.drawCircle({ x: dx, y: y + 8, size: 0.6, color: COLOR.hint });
    }
    page.drawText(String(pn), {
      x: W - PADDING - 12, y, size: 14, font: fontENBold, color: COLOR.primary,
    });
    y -= 50;
  }
}

// ==================== 通用：内容页绘图状态 ====================
class PageState {
  constructor(pdfDoc, font, fontEN, fontENBold) {
    this.pdfDoc = pdfDoc;
    this.font = font;
    this.fontEN = fontEN;
    this.fontENBold = fontENBold;
    this.page = null;
    this.y = 0;
    this.newPage();
  }

  newPage() {
    this.page = this.pdfDoc.addPage([W, H]);
    this.y = H - 70;
  }

  ensure(needed) {
    if (this.y - needed < 60) this.newPage();
  }

  // 大章节标题 "01" + 标题
  chapter(num, title, subtitle) {
    this.ensure(90);
    // 大号灰色序号
    this.page.drawText(num, {
      x: PADDING, y: this.y - 36, size: 56, font: this.fontENBold,
      color: COLOR.primaryLight,
    });
    // 中号标题，右侧
    this.page.drawText(title, {
      x: PADDING + 95, y: this.y - 16, size: 22, font: this.font, color: COLOR.ink,
    });
    if (subtitle) {
      this.page.drawText(subtitle, {
        x: PADDING + 95, y: this.y - 36, size: 10, font: this.font, color: COLOR.muted,
      });
    }
    // 装饰线
    this.page.drawRectangle({
      x: PADDING + 95, y: this.y - 48, width: 30, height: 2, color: COLOR.primary,
    });
    this.y -= 70;
  }

  // 二级标题 - 带左侧色块
  h2(text) {
    this.ensure(34);
    this.page.drawRectangle({
      x: PADDING, y: this.y - 14, width: 4, height: 14, color: COLOR.primary,
    });
    this.page.drawText(text, {
      x: PADDING + 12, y: this.y - 12, size: FONT_SIZE.h2,
      font: this.font, color: COLOR.ink,
    });
    this.y -= 24;
  }

  // 三级标题
  h3(text) {
    this.ensure(20);
    this.page.drawText(text, {
      x: PADDING, y: this.y - 10, size: FONT_SIZE.h3,
      font: this.font, color: COLOR.primary,
    });
    this.y -= 18;
  }

  // 正文段落
  p(text, opts = {}) {
    const size = opts.size || FONT_SIZE.body;
    const color = opts.color || COLOR.text;
    const lh = size * 1.6;
    const indent = opts.indent || 0;
    const x0 = PADDING + indent;
    const wrapW = CONTENT_W - indent;
    const lines = wrapText(text, this.font, size, wrapW);
    for (const line of lines) {
      this.ensure(lh);
      this.page.drawText(line, { x: x0, y: this.y - size, size, font: this.font, color });
      this.y -= lh;
    }
    this.y -= 2;
  }

  // 列表项 - 圆点
  li(text) {
    this.ensure(18);
    const size = FONT_SIZE.body;
    this.page.drawCircle({ x: PADDING + 5, y: this.y - 5, size: 2, color: COLOR.primary });
    const lines = wrapText(text, this.font, size, CONTENT_W - 16);
    let first = true;
    for (const line of lines) {
      this.ensure(size * 1.55);
      this.page.drawText(line, {
        x: PADDING + 14, y: this.y - size,
        size, font: this.font, color: first ? COLOR.text : COLOR.muted,
      });
      this.y -= size * 1.55;
      first = false;
    }
  }

  // 步骤项 - 带圆形数字
  step(num, title, desc) {
    this.ensure(36);
    // 圆形数字徽章
    this.page.drawCircle({
      x: PADDING + 10, y: this.y - 12, size: 10, color: COLOR.primary,
    });
    this.page.drawText(String(num), {
      x: PADDING + 6, y: this.y - 16, size: 11, font: this.fontENBold, color: COLOR.white,
    });
    // 标题
    this.page.drawText(title, {
      x: PADDING + 28, y: this.y - 10, size: 11, font: this.font, color: COLOR.ink,
    });
    this.y -= 16;
    // 描述
    const lines = wrapText(desc, this.font, FONT_SIZE.small, CONTENT_W - 30);
    for (const ln of lines) {
      this.ensure(15);
      this.page.drawText(ln, {
        x: PADDING + 28, y: this.y - FONT_SIZE.small, size: FONT_SIZE.small,
        font: this.font, color: COLOR.muted,
      });
      this.y -= 14;
    }
    this.y -= 6;
  }

  // 提示卡片
  callout(kind, title, text) {
    const cfg = {
      info: { bg: COLOR.blueLight, accent: COLOR.blue, icon: '💡' },
      success: { bg: COLOR.greenLight, accent: COLOR.green, icon: '✓' },
      warn: { bg: COLOR.amberLight, accent: COLOR.amber, icon: '⚠' },
      tip: { bg: COLOR.primaryLight, accent: COLOR.primary, icon: '★' },
    }[kind] || { bg: COLOR.cardBg, accent: COLOR.text, icon: '·' };
    const lines = wrapText(text, this.font, FONT_SIZE.small, CONTENT_W - 50);
    const h = 12 + 16 + lines.length * 14 + 8;
    this.ensure(h + 10);
    // 背景
    this.page.drawRectangle({
      x: PADDING, y: this.y - h, width: CONTENT_W, height: h,
      color: cfg.bg,
    });
    // 左侧 accent 竖条
    this.page.drawRectangle({
      x: PADDING, y: this.y - h, width: 3, height: h, color: cfg.accent,
    });
    // 标题
    this.page.drawText(`${cfg.icon} ${title}`, {
      x: PADDING + 14, y: this.y - 16, size: 10.5, font: this.font, color: cfg.accent,
    });
    // 正文
    let ty = this.y - 30;
    for (const ln of lines) {
      this.page.drawText(ln, {
        x: PADDING + 14, y: ty, size: FONT_SIZE.small, font: this.font, color: COLOR.text,
      });
      ty -= 14;
    }
    this.y -= h + 10;
  }

  // 表格（带斑马纹）
  table(headers, rows, colWidths) {
    const rowH = 26;
    const headerH = 28;
    const total = headers.length;
    if (!colWidths) {
      colWidths = new Array(total).fill(CONTENT_W / total);
    }
    this.ensure(headerH + rows.length * rowH + 10);

    // 表头
    this.page.drawRectangle({
      x: PADDING, y: this.y - headerH, width: CONTENT_W, height: headerH,
      color: COLOR.primary,
    });
    let x = PADDING;
    for (let i = 0; i < headers.length; i++) {
      this.page.drawText(headers[i], {
        x: x + 10, y: this.y - 18,
        size: 10, font: this.font, color: COLOR.white,
      });
      x += colWidths[i];
    }
    this.y -= headerH;

    // 行
    for (let r = 0; r < rows.length; r++) {
      if (r % 2 === 0) {
        this.page.drawRectangle({
          x: PADDING, y: this.y - rowH, width: CONTENT_W, height: rowH,
          color: COLOR.cardBg,
        });
      }
      x = PADDING;
      for (let i = 0; i < headers.length; i++) {
        const cellLines = wrapText(String(rows[r][i] ?? ''), this.font, 9, colWidths[i] - 16);
        for (let li = 0; li < Math.min(2, cellLines.length); li++) {
          this.page.drawText(cellLines[li], {
            x: x + 10, y: this.y - 14 - li * 11,
            size: 9, font: this.font, color: COLOR.text,
          });
        }
        x += colWidths[i];
      }
      // 下边线
      this.page.drawRectangle({
        x: PADDING, y: this.y - rowH, width: CONTENT_W, height: 0.5,
        color: COLOR.divider,
      });
      this.y -= rowH;
    }
    this.y -= 10;
  }

  vspace(h) { this.y -= h; }
}

// ==================== Section 1: 项目背景 ====================
function drawSection1(ctx) {
  const s = new PageState(ctx.pdfDoc, ctx.font, ctx.fontEN, ctx.fontENBold);
  s.chapter('01', '项目背景', 'Project Background');

  s.p('公司机械零件受控库存有 671 份 PDF 图纸，涵盖 CAD 机加件、塑胶件、PCBA、外购模组等多种类型。传统人工区分"受控 vs 非受控"依赖目录命名 + 口头约定，混淆风险高。');
  s.vspace(4);

  s.callout('warn', '业务痛点',
    '一份过期的或未受控的图纸如果被误传到供应商，可能直接导致投产返工。受控库管理的核心诉求是"任何人看到 PDF 第一眼就能识别这是不是公司官方受控件"。');

  s.h2('解决目标');
  s.p('给受控库每一份 PDF 自动加盖统一格式的电子受控印章，印章包含：');

  // 关键字段卡片
  const fields = [
    { name: '编号', value: 'M.M.1.0028.04' },
    { name: '版本', value: 'Rev.04' },
    { name: '受控日期', value: '2026-05-17' },
    { name: '操作人', value: '冯智超' },
  ];
  const cardW = (CONTENT_W - 30) / 4;
  s.ensure(70);
  for (let i = 0; i < fields.length; i++) {
    const x = PADDING + i * (cardW + 10);
    s.page.drawRectangle({
      x, y: s.y - 60, width: cardW, height: 60,
      color: COLOR.primaryLight,
    });
    s.page.drawText(fields[i].name, {
      x: x + 12, y: s.y - 20, size: 9, font: s.font, color: COLOR.primary,
    });
    s.page.drawText(fields[i].value, {
      x: x + 12, y: s.y - 42, size: 10, font: s.font, color: COLOR.ink,
    });
  }
  s.y -= 70;

  s.callout('tip', '自动化',
    '所有字段从文件名自动解析，支持公司全部前缀格式：M.M / M.A / M.E.E / M.E.H / M.E.0，以及版本号字母前缀（PL 胚料 / LS 临时）。');
}

// ==================== Section 2: 核心功能 ====================
function drawSection2(ctx) {
  const s = new PageState(ctx.pdfDoc, ctx.font, ctx.fontEN, ctx.fontENBold);
  s.chapter('02', '核心功能', 'Core Features');

  const modules = [
    { icon: '📄', name: '单文件模式', desc: '拖拽印章·实时预览·自动适应窗口·Ctrl+滚轮缩放·印章信息不完整时按钮锁定' },
    { icon: '📁', name: '批量模式',   desc: '选目录或多选文件·自动跳过已加章·按各自图幅自适应位置·支持仅首页·处理后生成日志' },
    { icon: '⭐', name: '模板系统',   desc: '保存常用印章样式·JSON 导出/导入·便于多台机器或团队成员共享' },
    { icon: '🎯', name: '智能透明度', desc: '盖章前渲染目标区域统计非白像素，盖在空白处用实色 0.95，覆盖文字自动半透明 0.6' },
    { icon: '🖱', name: '右键集成',   desc: '设置页一键安装到 HKEY_CURRENT_USER，右键 PDF "用受控PDF工具打开"，不需要管理员' },
  ];
  for (const m of modules) {
    s.ensure(60);
    s.page.drawRectangle({
      x: PADDING, y: s.y - 50, width: CONTENT_W, height: 50,
      color: COLOR.cardBg,
      borderColor: COLOR.divider, borderWidth: 0.5,
    });
    s.page.drawRectangle({
      x: PADDING, y: s.y - 50, width: 3, height: 50, color: COLOR.primary,
    });
    s.page.drawText(m.icon, { x: PADDING + 16, y: s.y - 30, size: 20, font: s.font });
    s.page.drawText(m.name, {
      x: PADDING + 48, y: s.y - 18, size: 12, font: s.font, color: COLOR.ink,
    });
    const descLines = wrapText(m.desc, s.font, 9, CONTENT_W - 70);
    let dy = s.y - 32;
    for (const ln of descLines.slice(0, 2)) {
      s.page.drawText(ln, {
        x: PADDING + 48, y: dy, size: 9, font: s.font, color: COLOR.muted,
      });
      dy -= 12;
    }
    s.y -= 58;
  }
}

// ==================== Section 3: 使用说明 ====================
function drawSection3(ctx) {
  const s = new PageState(ctx.pdfDoc, ctx.font, ctx.fontEN, ctx.fontENBold);
  s.chapter('03', '使用说明', 'User Guide');

  s.h2('安装版本选择');

  // 对比表格
  s.table(
    ['版本',         '适用场景',                       '推荐'],
    [
      ['📦 安装版',  '日常工作用 · 桌面快捷方式 · 右键菜单 · 一键卸载', '⭐⭐⭐'],
      ['💼 便携版',  '临时使用 · U 盘携带 · 不希望系统留痕',           '⭐⭐'],
    ],
    [110, 360, 75]
  );

  s.callout('warn', 'Windows 安全提示',
    '由于没有购买代码签名证书，Windows 可能弹"不受信任的发布者"对话框。点 "更多信息 → 仍要运行" 即可。所有源码在公司 Git 仓库可审计。');

  s.h2('单文件流程（5 步）');
  s.step(1, '打开 PDF', '点工具栏 "📂 打开 PDF" 或直接把文件拖入窗口');
  s.step(2, '填写印章信息', '右侧"印章信息"卡片：零件号 / 版本 / 受控日期 / 操作人 (操作人会自动记住，下次打开自动填)');
  s.step(3, '调整印章', '在预览中拖动印章 / 拉伸边角调整大小 / 右侧面板改字号或颜色');
  s.step(4, '应用并导出', '点蓝色 "💾 应用并导出"，输出到源 PDF 同目录的 _stamped/ 子文件夹');
  s.step(5, '查看结果', '完成后顶部出现绿色 "📂 打开输出位置"，点击直接定位到输出文件');

  s.h2('批量流程（7 步）');
  s.step(1, '切到批量模式', '左侧导航点 "📁 批量"');
  s.step(2, '添加文件', '"选择目录"（含递归选项）或 "选择文件（多选）"');
  s.step(3, '选印章模板', '默认用单文件模式调好的样式；或选择已保存的模板');
  s.step(4, '填写操作人和受控日期', '操作人为空时按钮会锁定，无法运行');
  s.step(5, '设置输出位置', '上次的位置会自动记住，可手动改');
  s.step(6, '试运行（推荐）', '点紫色 "🔍 试运行"，不写文件，先看会处理哪些 + 智能透明度结果');
  s.step(7, '正式处理', '检查无误后点 "▶ 开始处理 N 个文件"');
}

// ==================== Section 4 & 5: 印章设计 + 常见问题 ====================
function drawSection4_5(ctx) {
  const s = new PageState(ctx.pdfDoc, ctx.font, ctx.fontEN, ctx.fontENBold);
  s.chapter('04', '印章设计', 'Stamp Design');

  s.h2('印章布局');
  s.p('印章默认包含 5 行信息，整体为带双线红框的矩形卡片，水平居中布局，文字块块整体居中、行内左对齐。');

  s.h2('编号格式表');
  s.table(
    ['前缀模式',     '业务含义',        '示例'],
    [
      ['M.M.1.XXXX.YY', '机加件',     'M.M.1.0028.04'],
      ['M.A.1.XXXX.YY', '机械总成',   'M.A.1.0006.01'],
      ['M.E.E.XXXX.YY', '电子板卡',   'M.E.E.0014.04'],
      ['M.E.H.XXXX.YY', '线材',       'M.E.H.0015.02'],
      ['M.E.0.XXXX',    '外购模组',   'M.E.0.0026'],
      ['M.M.1.XXXX.PL03', '胚料件（未后处理）', 'M.M.1.0092.PL03'],
      ['M.M.1.XXXX.LS01', '临时物料',  'M.M.1.0123.LS01'],
    ],
    [180, 200, 165]
  );

  s.callout('info', '正则规则',
    '/^(M\\.[A-Z0-9](?:\\.[A-Z0-9])?\\.\\d{4})(?:\\.([A-Z]{0,3}\\d{2}))?\\b/  匹配前缀 + 4 位零件号 + 可选字母前缀 + 2 位版本号。');

  s.chapter('05', '常见问题', 'FAQ');

  const faqs = [
    {
      q: '已加章的 PDF 重新打开有警告？',
      a: '系统通过 PDF 元数据识别"是否曾被本工具加章"。重新加章会生成新副本（原文件不变）。'
    },
    {
      q: '批量某些 PDF 处理失败？',
      a: '通常是 PDF 内部结构非标准（如 Word/旧版工具导出）。建议先用 Acrobat 打开另存为标准 PDF 再处理。'
    },
    {
      q: '输出 PDF 能编辑/复制吗？',
      a: '矢量印章写入 PDF 内容流深层，Acrobat 编辑工具难直接选中删除。内部使用场景下足够防误操作。'
    },
    {
      q: '多台机器共享模板？',
      a: '模板页点 "📤 导出 JSON"，把 JSON 给同事，对方 "📥 导入 JSON" 即可。'
    },
  ];
  for (const f of faqs) {
    s.ensure(50);
    s.page.drawText('Q', {
      x: PADDING, y: s.y - 10, size: 14, font: s.fontENBold, color: COLOR.primary,
    });
    s.page.drawText(f.q, {
      x: PADDING + 18, y: s.y - 10, size: 11, font: s.font, color: COLOR.ink,
    });
    s.y -= 18;
    s.page.drawText('A', {
      x: PADDING, y: s.y - 10, size: 14, font: s.fontENBold, color: COLOR.accent,
    });
    const lines = wrapText(f.a, s.font, 9.5, CONTENT_W - 22);
    for (const ln of lines) {
      s.page.drawText(ln, {
        x: PADDING + 18, y: s.y - 10, size: 9.5, font: s.font, color: COLOR.text,
      });
      s.y -= 14;
    }
    s.y -= 10;
  }
}

// ==================== Section 6: 技术栈 ====================
function drawSection6(ctx) {
  const s = new PageState(ctx.pdfDoc, ctx.font, ctx.fontEN, ctx.fontENBold);
  s.chapter('06', '技术栈 & 致谢', 'Tech Stack & Credits');

  const stacks = [
    { layer: '桌面运行时', tech: 'Electron 42',                  desc: 'Chromium + Node.js 跨平台框架' },
    { layer: '渲染进程',   tech: 'React 19 + TypeScript + Vite 8', desc: '现代前端开发体验，HMR 热更新' },
    { layer: 'PDF 写入',   tech: 'pdf-lib + @pdf-lib/fontkit',   desc: '纯 JS 操作 PDF，矢量印章 + 字体子集化' },
    { layer: 'PDF 渲染',   tech: 'pdf.js (Mozilla, legacy)',     desc: '浏览器端 PDF 显示 + 内容检测' },
    { layer: '中文字体',   tech: 'SimHei (思源黑体)',            desc: '系统自带 + 子集化嵌入，输出 PDF 跨设备无差异' },
    { layer: '打包',       tech: 'electron-builder + NSIS',      desc: 'portable + 标准安装包两种格式' },
  ];
  for (const it of stacks) {
    s.ensure(48);
    s.page.drawRectangle({
      x: PADDING, y: s.y - 40, width: CONTENT_W, height: 40,
      color: COLOR.cardBg,
    });
    s.page.drawRectangle({
      x: PADDING, y: s.y - 40, width: 70, height: 40,
      color: COLOR.primary,
    });
    s.page.drawText(it.layer, {
      x: PADDING + 8, y: s.y - 22, size: 9, font: s.font, color: COLOR.white,
    });
    s.page.drawText(it.tech, {
      x: PADDING + 80, y: s.y - 16, size: 11, font: s.font, color: COLOR.ink,
    });
    s.page.drawText(it.desc, {
      x: PADDING + 80, y: s.y - 32, size: 9, font: s.font, color: COLOR.muted,
    });
    s.y -= 48;
  }

  s.vspace(20);

  s.callout('tip', '感谢',
    '本工具基于多个优秀的开源项目构建。所有依赖遵循其原始许可协议（详见 node_modules / LICENSES.chromium.html）。');

  // 结尾签名
  s.ensure(80);
  s.page.drawRectangle({
    x: PADDING, y: s.y - 50, width: CONTENT_W, height: 50,
    color: COLOR.ink,
  });
  s.page.drawText('深圳市无穹创新科技有限公司', {
    x: PADDING + 20, y: s.y - 24, size: 12, font: s.font, color: rgb(1, 1, 1),
  });
  s.page.drawText('Shenzhen Wuqiong Innovation Technology Co., Ltd.', {
    x: PADDING + 20, y: s.y - 40, size: 8, font: s.fontEN, color: rgb(0.7, 0.72, 0.78),
  });
  s.page.drawText('v1.0.5', {
    x: W - PADDING - 60, y: s.y - 28, size: 18, font: s.fontENBold, color: COLOR.accent,
  });
}
