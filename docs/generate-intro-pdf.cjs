/**
 * 用 pdf-lib + 思源黑体生成项目介绍 PDF
 * 节省第三方依赖，复用项目自身能力
 * 用法：node docs/generate-intro-pdf.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN_X = 60;
const MARGIN_TOP = 60;
const MARGIN_BOTTOM = 50;
const CONTENT_W = A4_W - MARGIN_X * 2;

// 主题色
const C_PRIMARY = rgb(0.482, 0.227, 0.929);   // 紫
const C_ACCENT = rgb(0.925, 0.282, 0.6);       // 粉
const C_RED = rgb(0.725, 0.114, 0.114);
const C_TEXT = rgb(0.13, 0.13, 0.13);
const C_GREY = rgb(0.4, 0.4, 0.4);
const C_LIGHT_GREY = rgb(0.92, 0.92, 0.92);
const C_BG_TIP = rgb(0.949, 0.973, 1);         // 浅蓝底
const C_BG_WARN = rgb(0.996, 0.953, 0.78);     // 浅黄底

(async () => {
  const fontBytes = fs.readFileSync(path.join(__dirname, '..', 'public', 'simhei.ttf'));

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(fontBytes, { subset: true });
  const fontEN = await pdfDoc.embedFont(StandardFonts.Helvetica);

  let page = pdfDoc.addPage([A4_W, A4_H]);
  let y = A4_H - MARGIN_TOP;
  let pageNum = 1;

  // ---------- 工具函数 ----------
  function newPageIfNeeded(needed) {
    if (y - needed < MARGIN_BOTTOM) {
      drawPageFooter(page, pageNum);
      page = pdfDoc.addPage([A4_W, A4_H]);
      pageNum++;
      y = A4_H - MARGIN_TOP;
    }
  }

  function drawPageFooter(p, n) {
    p.drawText(`受控PDF盖章工具 · 使用说明`, {
      x: MARGIN_X, y: 24, size: 8, font, color: C_GREY,
    });
    p.drawText(`第 ${n} 页`, {
      x: A4_W - MARGIN_X - 40, y: 24, size: 8, font, color: C_GREY,
    });
  }

  // 段落标题
  function h1(text) {
    newPageIfNeeded(40);
    page.drawRectangle({
      x: MARGIN_X - 8, y: y - 22,
      width: 4, height: 22,
      color: C_PRIMARY,
    });
    page.drawText(text, {
      x: MARGIN_X + 2, y: y - 18,
      size: 16, font, color: C_PRIMARY,
    });
    y -= 32;
  }

  function h2(text) {
    newPageIfNeeded(28);
    page.drawText('● ' + text, {
      x: MARGIN_X, y: y - 12,
      size: 12, font, color: C_TEXT,
    });
    y -= 22;
  }

  // 正文段
  function p(text, opts = {}) {
    const size = opts.size || 10;
    const color = opts.color || C_TEXT;
    const indent = opts.indent || 0;
    const x0 = MARGIN_X + indent;
    const wrapWidth = CONTENT_W - indent;
    const lines = wrapText(text, font, size, wrapWidth);
    for (const line of lines) {
      newPageIfNeeded(size + 4);
      page.drawText(line, { x: x0, y: y - size, size, font, color });
      y -= size + 4;
    }
    y -= 4;
  }

  // 字符级换行
  function wrapText(text, fnt, size, maxW) {
    const out = [];
    for (const raw of text.split('\n')) {
      let line = '';
      for (const ch of raw) {
        const test = line + ch;
        if (fnt.widthOfTextAtSize(test, size) > maxW) {
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

  // 列表项
  function li(text) {
    p('• ' + text, { indent: 12 });
  }

  // 提示框
  function tipBox(title, text, bg = C_BG_TIP, border = C_PRIMARY) {
    const lines = wrapText(text, font, 9, CONTENT_W - 20);
    const h = 18 + lines.length * 13 + 8;
    newPageIfNeeded(h);
    page.drawRectangle({
      x: MARGIN_X, y: y - h, width: CONTENT_W, height: h,
      color: bg,
      borderColor: border, borderWidth: 0.5,
    });
    page.drawText(title, { x: MARGIN_X + 10, y: y - 14, size: 10, font, color: border });
    let ty = y - 28;
    for (const ln of lines) {
      page.drawText(ln, { x: MARGIN_X + 10, y: ty, size: 9, font, color: C_TEXT });
      ty -= 13;
    }
    y -= h + 8;
  }

  // 间隔
  function vspace(h) { y -= h; }

  // ============= 封面 =============
  // 顶部紫色色块
  page.drawRectangle({ x: 0, y: A4_H - 220, width: A4_W, height: 220, color: C_PRIMARY });
  page.drawRectangle({ x: 0, y: A4_H - 230, width: A4_W, height: 10, color: C_ACCENT });

  page.drawText('受控PDF盖章工具', {
    x: MARGIN_X, y: A4_H - 110, size: 32, font, color: rgb(1, 1, 1),
  });
  page.drawText('Controlled PDF Studio', {
    x: MARGIN_X, y: A4_H - 140, size: 14, font: fontEN, color: rgb(0.92, 0.92, 1),
  });
  page.drawText('给机械零件受控库 PDF 一键加盖电子受控印章', {
    x: MARGIN_X, y: A4_H - 175, size: 11, font, color: rgb(1, 1, 1),
  });
  page.drawText('v1.0.5  ·  桌面版（Windows）', {
    x: MARGIN_X, y: A4_H - 200, size: 10, font, color: rgb(0.95, 0.92, 1),
  });

  // 封面中央：核心特性卡片
  y = A4_H - 280;
  const features = [
    ['📄', '单文件精调', '所见即所得，可拖拽印章 / 实时预览 / 智能透明度'],
    ['📁', '批量套用模板', '选目录批量处理，跳过已加章，多图幅自适应右上角'],
    ['⭐', '模板系统',     '保存常用印章样式 · JSON 导入导出 · 团队共享'],
    ['🔍', '试运行',       '不写文件先预检测，损坏 PDF 提前暴露，避免覆盖'],
    ['🎯', '智能透明度',   '检测目标区域内容密度，覆盖文字自动半透明'],
    ['🖱', '右键集成',     '资源管理器右键 PDF → 用本工具打开'],
  ];
  for (let i = 0; i < features.length; i++) {
    const it = features[i];
    const row = Math.floor(i / 2);
    const col = i % 2;
    const cx = MARGIN_X + col * (CONTENT_W / 2 + 5);
    const cy = y - row * 95;
    page.drawRectangle({
      x: cx, y: cy - 80,
      width: CONTENT_W / 2 - 5, height: 80,
      color: rgb(0.98, 0.98, 1),
      borderColor: C_LIGHT_GREY, borderWidth: 0.5,
    });
    page.drawText(it[0], { x: cx + 12, y: cy - 30, size: 22, font });
    page.drawText(it[1], { x: cx + 45, y: cy - 25, size: 12, font, color: C_PRIMARY });
    const descLines = wrapText(it[2], font, 9, CONTENT_W / 2 - 60);
    let dy = cy - 45;
    for (const ln of descLines) {
      page.drawText(ln, { x: cx + 45, y: dy, size: 9, font, color: C_GREY });
      dy -= 12;
    }
  }

  // 封面底部：公司信息
  page.drawRectangle({ x: 0, y: 0, width: A4_W, height: 50, color: rgb(0.13, 0.13, 0.13) });
  page.drawText('深圳市无穹创新科技有限公司', {
    x: MARGIN_X, y: 26, size: 10, font, color: rgb(1, 1, 1),
  });
  page.drawText('© 2026  All Rights Reserved', {
    x: MARGIN_X, y: 12, size: 8, font: fontEN, color: rgb(0.8, 0.8, 0.8),
  });

  // ============= 内容页 =============
  page = pdfDoc.addPage([A4_W, A4_H]);
  pageNum++;
  y = A4_H - MARGIN_TOP;

  h1('一、项目背景');
  p('公司机械零件受控库存有 671 份 PDF 图纸（CAD 加工件、塑胶件、PCBA、外购模组等），传统人工区分"受控/非受控"靠目录命名、靠口头约定，容易混淆。本工具的目标是给受控库每一份 PDF 自动加盖统一格式的电子受控印章，让任何人看到 PDF 第一眼就能识别这是"公司受控库的官方件"。');
  p('印章包含：编号 / 版本 / 受控日期 / 操作人。所有信息从文件名自动解析，支持 M.X.X.XXXX.YY 全部前缀格式（含 PL 胚料 / LS 临时 等版本前缀）。');

  h1('二、核心功能');

  h2('1. 单文件模式');
  li('打开 PDF → 自动适应窗口（横版按宽度，竖版按高度）');
  li('印章默认放在视觉右上角，可拖动 / 拉伸 / 改字号 / 改颜色');
  li('实时预览：所见即所得');
  li('Ctrl + 滚轮缩放，可双向滚动查看大图');
  li('印章信息不完整时按钮锁定，避免误导出');

  h2('2. 批量模式');
  li('选目录（递归）或多选文件');
  li('自动跳过已加章的 PDF');
  li('每张 PDF 按各自图幅自适应印章位置（A4 竖、A4 横、A3、A0 全支持）');
  li('支持仅首页或全部页');
  li('试运行：不写文件，先看会处理哪些 + 是否有损坏 PDF');
  li('处理后自动生成 _stamp-log.json 日志');

  h2('3. 模板系统');
  li('单文件模式调好印章后 → 保存为模板');
  li('批量模式选模板套用样式（颜色、字号、宽高、内容文字）');
  li('支持 JSON 导出/导入，便于多台机器共享');

  h2('4. 智能透明度');
  li('盖章前先渲染目标区域，检测非白像素占比');
  li('盖在空白处 → 实色 0.95（像真盖章）');
  li('覆盖文字/线条 → 半透明 0.6（不遮挡内容）');

  h2('5. 右键菜单集成');
  li('设置页一键安装，写入 HKEY_CURRENT_USER（不需要管理员）');
  li('资源管理器右键 PDF → "用受控PDF工具打开"');
  li('Windows 11 用户：在"显示更多选项"下面');

  // 第3页
  h1('三、使用说明');

  h2('1. 安装');
  p('两个版本可选，发给同事时按需求选一个即可：');
  li('便携版（受控PDF盖章工具-v1.0.5-便携版.exe）：单文件，双击运行，免安装。适合临时用、U 盘携带。');
  li('安装版（受控PDF盖章工具-v1.0.5-安装版.exe）：走标准安装流程，桌面快捷方式 + 开始菜单 + 卸载条目 + 右键菜单。推荐日常使用。');

  tipBox('💡 推荐使用安装版',
    'Windows 可能弹"不受信任的发布者"提示（因为没有代码签名证书），点"更多信息 → 仍要运行"即可。这不影响安全性——所有源码都在公司 Git 仓库内可审计。');

  h2('2. 单文件流程');
  li('① 点"📂 打开 PDF" 或拖拽到窗口');
  li('② 右侧"印章信息"必填四项：零件号 / 版本 / 受控日期 / 操作人（操作人会自动记住）');
  li('③ 印章预览中可拖动/拉伸/调字号');
  li('④ 点"💾 应用并导出" → 输出到源 PDF 同目录的 _stamped/ 子文件夹');
  li('⑤ 完成后点绿色"📂 打开输出位置"直接定位');

  h2('3. 批量流程');
  li('① 切到"📁 批量" 标签');
  li('② "选择目录" 或 "选择文件（多选）" 添加 PDF');
  li('③ 选择印章模板（可选）+ 填写操作人 / 受控日期');
  li('④ 设置输出位置（会自动记住上次的）');
  li('⑤ 选页面范围（全部页 / 仅首页）');
  li('⑥ 推荐先点 "🔍 试运行" 看会处理哪些');
  li('⑦ 试运行没问题后，点 "▶ 开始处理"');

  // 第4页
  h1('四、印章设计说明');

  p('印章默认包含四行信息：');
  li('标题：★ 受 控 ★ （可自定义）');
  li('编号：M.M.1.0028.04（从文件名自动解析）');
  li('版本：Rev.04');
  li('受控日期：2026-05-17（默认为工具运行日期）');
  li('操作人：（必填，会自动记住）');

  h2('编号格式说明');
  li('M.M.1.XXXX.YY  → 机加件');
  li('M.A.1.XXXX.YY  → 机械总成');
  li('M.E.E.XXXX.YY  → 电子板卡');
  li('M.E.H.XXXX.YY  → 线材');
  li('M.E.0.XXXX     → 外购模组');
  li('M.M.1.XXXX.PL03 → 胚料件（素材，未做后处理）');
  li('M.M.1.XXXX.LS01 → 临时物料');

  h1('五、常见问题');

  h2('Q: 已加章的 PDF 重新打开有警告？');
  p('A: 系统通过 PDF 元数据识别"是否曾被本工具加章"。重新加章会生成新的副本（原文件不变）。');

  h2('Q: 批量模式中某些 PDF 处理失败？');
  p('A: 通常是 PDF 内部结构非标准（如 Word/旧版工具导出）。建议先用 Adobe Acrobat 打开另存为标准 PDF 再处理。');

  h2('Q: 输出 PDF 能不能编辑/复制？');
  p('A: 矢量印章写入 PDF 内容流深层，使用 Acrobat 编辑工具无法直接选中删除。但本工具不做强加密保护——内部使用场景下足够避免误操作。');

  h2('Q: 多台机器怎么用同一套印章模板？');
  p('A: 模板页点"📤 导出 JSON"，把生成的 JSON 给同事，对方在自己工具里"📥 导入 JSON"即可。');

  h1('六、技术栈 & 致谢');
  p('Electron 42 + React 19 + TypeScript + Vite + pdf-lib + pdf.js');
  p('字体：思源黑体（开源）/ Windows 系统自带 SimHei');
  p('PDF 渲染：Mozilla pdf.js  ·  PDF 写入：pdf-lib');

  drawPageFooter(page, pageNum);

  // ---------- 保存 ----------
  const outPath = path.join(__dirname, '受控PDF盖章工具-使用说明-v1.0.5.pdf');
  const bytes = await pdfDoc.save({ useObjectStreams: true });
  fs.writeFileSync(outPath, bytes);
  console.log('✓ 生成:', outPath);
  console.log('  大小:', (bytes.length / 1024).toFixed(1), 'KB');
  console.log('  页数:', pdfDoc.getPageCount());
})();
