/**
 * 批量模式 - 选多个 PDF + 套用模板 + 一键处理
 */
import { useEffect, useState } from 'react';
import type { StampConfig } from './types';
import { detectRegionContent } from './contentDetector';
import { resolveStampLayout } from './stampPlacement';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';

interface BatchItem {
  path: string;
  name: string;
  status: 'pending' | 'processing' | 'done' | 'skipped' | 'error';
  message?: string;
  sizeIn?: number;
  sizeOut?: number;
  outPath?: string;
}

interface Template {
  name: string;
  createdAt: string;
  stamp: StampConfig;
}

interface Props {
  defaultStamp: StampConfig;
  buildMeta: (fileName: string) => any;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function BatchPanel({ defaultStamp, buildMeta }: Props) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTpl, setSelectedTpl] = useState<string>('__default__');
  const [outputDir, setOutputDir] = useState<string>('');
  const [recursive, setRecursive] = useState(false);
  const [running, setRunning] = useState(false);
  const [operator, setOperator] = useState<string>(() => localStorage.getItem('ctrl-operator') || '');
  const [date, setDate] = useState<string>(todayStr());
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [skipStamped, setSkipStamped] = useState(true);   // 默认跳过已加章
  const [pageScope, setPageScope] = useState<'all' | 'firstOnly'>('all');
  const [runningMode, setRunningMode] = useState<'real' | 'dry' | null>(null);
  const [useTplPosition, setUseTplPosition] = useState(false); // 是否用模板里的精确位置（默认 autoPlace 右上角）
  const [tplExpanded, setTplExpanded] = useState(true);  // 印章模板卡片是否展开

  useEffect(() => {
    if (!window.api?.isElectron) return;
    window.api.listTemplates().then(setTemplates);
    window.api.getConfig().then((cfg) => {
      if (cfg.lastOutputDir) setOutputDir(cfg.lastOutputDir);
    });
  }, []);

  if (!window.api?.isElectron) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>📁</div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>批量模式仅在桌面版可用</div>
        <div style={{ marginTop: 8, fontSize: 12 }}>请打包成 .exe 后使用</div>
      </div>
    );
  }

  const pickFolder = async () => {
    const dir = await window.api!.openFolderDialog();
    if (!dir) return;
    const files = await window.api!.listPdfsInDir(dir, recursive);
    addItems(files);
    if (!outputDir) setOutputDir(dir + '_stamped');
  };

  const pickFiles = async () => {
    const files = await window.api!.openFilesDialog('pdf');
    if (files.length === 0) return;
    addItems(files);
    if (!outputDir) {
      // 默认输出到第一个文件所在目录的 _stamped/
      const dir = files[0].replace(/[\\/][^\\/]+$/, '');
      setOutputDir(dir + '\\_stamped');
    }
  };

  const addItems = (filePaths: string[]) => {
    setItems((prev) => {
      // 智能行为：
      //   - 列表为空 → 直接添加
      //   - 上一批全部已处理完（无 pending）→ 视为"开始新一批"，自动清空
      //   - 半途想再添加几个（还有 pending）→ 追加到当前批次
      const allDone = prev.length > 0 && !prev.some((it) => it.status === 'pending');
      const base = allDone ? [] : prev;
      const existing = new Set(base.map((it) => it.path));
      const newOnes: BatchItem[] = filePaths
        .filter((p) => !existing.has(p))
        .map((p) => ({
          path: p,
          name: p.split(/[\\/]/).pop()!,
          status: 'pending',
        }));
      return [...base, ...newOnes];
    });
  };

  const clearItems = () => setItems([]);

  const pickOutputDir = async () => {
    const dir = await window.api!.openFolderDialog();
    if (dir) {
      setOutputDir(dir);
      window.api!.setConfig({ lastOutputDir: dir });
    }
  };

  const removeItem = (i: number) => {
    setItems((arr) => arr.filter((_, idx) => idx !== i));
  };

  const getStampConfig = (): StampConfig => {
    if (selectedTpl === '__default__') return defaultStamp;
    const tpl = templates.find((t) => t.name === selectedTpl);
    return tpl ? tpl.stamp : defaultStamp;
  };

  const runBatch = async (isDryRun: boolean) => {
    if (items.length === 0) return;
    if (!outputDir) return;
    if (!operator?.trim()) return;

    setRunning(true);
    setRunningMode(isDryRun ? 'dry' : 'real');
    setProgress({ done: 0, total: items.length });
    // 重置所有项的状态（用户可能是处理完一批后想换模板重跑）
    setItems((arr) => arr.map((it) => ({
      ...it,
      status: 'pending',
      message: undefined,
      sizeOut: undefined,
      outPath: undefined,
    })));
    const stamp = getStampConfig();

    for (let i = 0; i < items.length; i++) {
      setItems((arr) => arr.map((it, idx) => idx === i ? { ...it, status: 'processing' } : it));
      const item = items[i];
      const meta = { ...buildMeta(item.name), date, operator };
      // 输出路径：保持文件名，输出到 outputDir
      const outPath = outputDir.replace(/[/\\]$/, '') + '\\' + item.name;
      try {
        // 1) 读 PDF 字节
        const bytes = await window.api!.readFile(item.path);

        // 2) 智能透明度检测：渲染目标章区域，看是否有内容
        //    异常不再吞掉，直接显示在 UI 让问题暴露
        let effectiveStamp = stamp;
        let detectMsg = '';
        try {
          // 给每次 pdf.js 调用独立的 buffer 拷贝，避免 detach 问题
          const ab1 = bytes.slice().buffer as ArrayBuffer;
          const ab2 = bytes.slice().buffer as ArrayBuffer;

          const doc = await pdfjsLib.getDocument({
            data: new Uint8Array(ab1),
            cMapUrl: 'pdfjs/cmaps/',
            cMapPacked: true,
            standardFontDataUrl: 'pdfjs/standard_fonts/',
          }).promise;
          const page = await doc.getPage(1);
          const rotation = (page as any).rotate || 0;
          const pdfPw = page.view[2] - page.view[0];
          const pdfPh = page.view[3] - page.view[1];
          doc.destroy();

          const layout = resolveStampLayout(pdfPw, pdfPh, rotation, stamp.layout, !useTplPosition);
          const det = await detectRegionContent(
            ab2, 1, layout.x, layout.y, layout.width, layout.height,
            { label: item.name }
          );
          effectiveStamp = { ...stamp, opacity: det.hasContent ? 0.6 : 0.95 };
          detectMsg = `非白${(det.ratio * 100).toFixed(1)}% → ${
            det.hasContent ? '半透明(0.6)' : '实心(0.95)'
          }`;
        } catch (e: any) {
          detectMsg = `⚠ 检测失败: ${e.message}`;
          console.error('content detect failed:', item.name, e);
        }
        setItems((arr) =>
          arr.map((it, idx) => idx === i ? { ...it, message: detectMsg } : it)
        );

        if (isDryRun) {
          // 试运行：预检测两件事 - 是否已加章 / PDF 能否被处理
          //   已加章 → skipped；无法加载 → error；正常 → done
          let dryStatus: BatchItem['status'] = 'done';
          let dryMessage = (detectMsg || '试运行') + ' · → ' + outPath;

          // 1) 检查是否已加章（如果用户勾了"跳过已加章"）
          if (skipStamped) {
            try {
              const stamped = await window.api!.checkStamped(item.path);
              if (stamped) {
                dryStatus = 'skipped';
                dryMessage = '已加过章 · 跳过';
              }
            } catch {}
          }

          // 2) 没被标 skipped 的话，检查 PDF 是否可被 pdf-lib 加载
          if (dryStatus !== 'skipped') {
            try {
              const { PDFDocument } = await import('pdf-lib');
              const ab3 = bytes.slice().buffer as ArrayBuffer;
              await PDFDocument.load(new Uint8Array(ab3), {
                ignoreEncryption: true,
                throwOnInvalidObject: false,
                updateMetadata: false,
              });
            } catch (loadErr: any) {
              dryStatus = 'error';
              dryMessage = '⚠ PDF 无法处理：' + (loadErr.message || '结构损坏，正式处理会失败');
            }
          }

          setItems((arr) =>
            arr.map((it, idx) =>
              idx === i
                ? {
                    ...it,
                    status: dryStatus,
                    sizeIn: bytes.length,
                    message: dryMessage,
                    outPath: dryStatus === 'done' ? outPath : undefined,
                  }
                : it
            )
          );
        } else {
          const applyTo = pageScope === 'firstOnly' ? 'current' : 'all';
          const result = await window.api!.stampPdfFile(
            item.path,
            outPath,
            effectiveStamp,
            meta,
            applyTo,
            1,                  // 仅首页时 currentPage=1
            !useTplPosition,    // autoPlace：默认右上角，勾"套用模板位置"时关闭
            skipStamped,
          );
          if (result.ok) {
            const finalOut = result.finalPath || outPath;
            const flags: string[] = [];
            if (result.encrypted) flags.push('已加密');
            if (result.readonly) flags.push('只读');
            if (result.hash) flags.push(result.hash);
            const doneMsg = (detectMsg ? detectMsg + ' · ' : '') + flags.join(' · ');
            setItems((arr) =>
              arr.map((it, idx) =>
                idx === i
                  ? result.skipped
                    ? { ...it, status: 'skipped', message: '已加过章，跳过', sizeIn: result.sizeIn, outPath: finalOut }
                    : {
                        ...it,
                        status: 'done',
                        sizeIn: result.sizeIn,
                        sizeOut: result.sizeOut,
                        outPath: finalOut,
                        message: doneMsg,
                      }
                  : it
              )
            );
          } else {
            setItems((arr) =>
              arr.map((it, idx) =>
                idx === i ? { ...it, status: 'error', message: result.error } : it
              )
            );
          }
        }
      } catch (e: any) {
        setItems((arr) =>
          arr.map((it, idx) =>
            idx === i ? { ...it, status: 'error', message: e.message } : it
          )
        );
      }
      setProgress({ done: i + 1, total: items.length });
    }

    // 记住输出目录
    try {
      const cfg = await window.api!.getConfig();
      await window.api!.setConfig({ ...cfg, lastOutputDir: outputDir });
    } catch {}

    // 写处理日志（_stamp-log.json）
    if (!isDryRun) {
      try {
        await writeBatchLog(outputDir);
      } catch (e) {
        console.warn('write log failed:', e);
      }
    }

    setRunning(false);
    setRunningMode(null);
  };

  const writeBatchLog = async (dir: string) => {
    if (!window.api) return;
    const snapshot = {
      timestamp: new Date().toISOString(),
      outputDir: dir,
      operator,
      date,
      template: selectedTpl === '__default__' ? '默认' : selectedTpl,
      pageScope,
      skipStamped,
      total: items.length,
      stats: {
        done: items.filter((i) => i.status === 'done').length,
        skipped: items.filter((i) => i.status === 'skipped').length,
        error: items.filter((i) => i.status === 'error').length,
      },
      files: items.map((it) => ({
        path: it.path,
        name: it.name,
        status: it.status,
        message: it.message,
        sizeIn: it.sizeIn,
        sizeOut: it.sizeOut,
        outPath: it.outPath,
      })),
    };
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const logPath = `${dir.replace(/[\\/]$/, '')}\\_stamp-log-${ts}.json`;
    await window.api.writeTextFile(logPath, JSON.stringify(snapshot, null, 2));
  };

  // 校验：缺任一关键字段都不允许执行
  const batchError = (() => {
    if (items.length === 0) return '请先添加 PDF 文件';
    if (!outputDir?.trim()) return '请选择输出位置';
    if (!operator?.trim()) return '请填写操作人';
    if (!date) return '请选择受控日期';
    return null;
  })();

  const okCount = items.filter((i) => i.status === 'done').length;
  const errCount = items.filter((i) => i.status === 'error').length;
  const skipCount = items.filter((i) => i.status === 'skipped').length;
  const pendingCount = items.filter((i) => i.status === 'pending').length;
  const semiCount = items.filter((i) => i.message?.includes('半透明')).length;
  const solidCount = items.filter((i) => i.message?.includes('实心')).length;
  const detectFailCount = items.filter((i) => i.message?.includes('⚠')).length;

  return (
    <div style={wrap}>
      <h2 style={{ marginBottom: 16 }}>📁 批量加章</h2>

      {/* 来源 */}
      <div style={card}>
        <div style={cardTitle}>来源</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
          <button onClick={pickFolder} style={primaryBtn} disabled={running}>
            📁 选择目录
          </button>
          <button onClick={pickFiles} style={btnSecondary} disabled={running}>
            📄 选择文件（多选）
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={recursive}
              onChange={(e) => setRecursive(e.target.checked)}
              disabled={running}
            />
            包含子目录
          </label>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#666' }}>
            共 <b>{items.length}</b> 个 PDF
          </span>
        </div>
      </div>

      {/* 印章模板 + 元信息 - 可折叠 */}
      <div style={card}>
        {/* 卡片标题 - 点击折叠/展开 */}
        <div
          onClick={() => setTplExpanded((v) => !v)}
          style={{
            ...cardTitle,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            userSelect: 'none',
          }}
        >
          <span style={{
            display: 'inline-block',
            transition: 'transform .15s',
            transform: tplExpanded ? 'rotate(90deg)' : 'rotate(0)',
            fontSize: 10,
            color: '#888',
          }}>▶</span>
          <span>印章模板</span>
          {/* 折叠时显示当前选择的模板 + 颜色块，让用户不展开也能看到 */}
          {!tplExpanded && (() => {
            const cur = getStampConfig();
            const tplName = selectedTpl === '__default__' ? '默认' : selectedTpl;
            return (
              <span style={{
                marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 11, color: '#666', fontWeight: 400,
              }}>
                <span style={{
                  display: 'inline-block', width: 12, height: 12, borderRadius: 2,
                  background: cur.color, border: '1px solid #999',
                }} />
                <span>⭐ {tplName} · {cur.titleFontSize}/{cur.contentFontSize}pt</span>
                <span style={{ color: '#999' }}>· {operator || '未填操作人'} · {date}</span>
              </span>
            );
          })()}
        </div>

        {tplExpanded && (
          <>
            <select
              value={selectedTpl}
              onChange={(e) => setSelectedTpl(e.target.value)}
              style={{ ...inputBox, marginTop: 8 }}
              disabled={running}
            >
              <option value="__default__">默认（当前单文件模式调好的样式）</option>
              {templates.map((t) => (
                <option key={t.name} value={t.name}>⭐ {t.name}</option>
              ))}
            </select>

            {/* 当前选中模板的摘要 */}
            {(() => {
              const cur = getStampConfig();
              return (
                <div style={{
                  marginTop: 8, padding: '8px 10px',
                  background: '#F5F9FF', borderRadius: 4,
                  fontSize: 11, color: '#444',
                  display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                }}>
                  <span style={{
                    display: 'inline-block', width: 14, height: 14, borderRadius: 2,
                    background: cur.color, border: '1px solid #999',
                  }} title={cur.color} />
                  <span>标题 <b>{cur.titleFontSize}pt</b></span>
                  <span>正文 <b>{cur.contentFontSize}pt</b></span>
                  <span>章宽×高 <b>{Math.round(cur.layout.width)}×{Math.round(cur.layout.height)}pt</b></span>
                  <span>透明度 <b>{cur.opacity}</b></span>
                  <span style={{ color: '#888' }}>· 内容 "{cur.title}"</span>
                </div>
              );
            })()}

            <label style={{
              marginTop: 8, display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 12, color: '#444',
            }}>
              <input
                type="checkbox"
                checked={useTplPosition}
                onChange={(e) => setUseTplPosition(e.target.checked)}
                disabled={running}
              />
              套用模板里的精确位置
              <span style={{ color: '#888', fontSize: 11 }}>
                （默认关闭：每页自动放右上角，适配不同图幅；勾选后用模板的 x/y/宽高）
              </span>
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
              <div>
                <div style={lbl}>受控日期</div>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  style={inputBox}
                  disabled={running}
                />
              </div>
              <div>
                <div style={lbl}>操作人 ★ 必填</div>
                <input
                  value={operator}
                  onChange={(e) => {
                    setOperator(e.target.value);
                    localStorage.setItem('ctrl-operator', e.target.value);
                  }}
                  placeholder="请输入"
                  style={{
                    ...inputBox,
                    border: !operator?.trim() ? '1.5px solid #DC2626' : '1px solid #D1D1D1',
                    background: !operator?.trim() ? '#FEF2F2' : '#fff',
                  }}
                  disabled={running}
                />
              </div>
            </div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>
              零件号 / 版本号 会从每个文件名自动解析
            </div>
          </>
        )}
      </div>

      {/* 输出 */}
      <div style={card}>
        <div style={cardTitle}>输出位置</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={outputDir}
            onChange={(e) => setOutputDir(e.target.value)}
            placeholder="选一个输出目录"
            style={{ ...inputBox, flex: 1 }}
            disabled={running}
          />
          <button onClick={pickOutputDir} style={btnSecondary} disabled={running}>浏览</button>
          {outputDir && !running && (
            <button
              onClick={() => window.api!.showItemInFolder(outputDir + '\\')}
              style={btnSecondary}
            >
              📂 打开
            </button>
          )}
        </div>
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#444' }}>
            <input
              type="checkbox"
              checked={skipStamped}
              onChange={(e) => setSkipStamped(e.target.checked)}
              disabled={running}
            />
            跳过已加过章的 PDF（推荐勾选；不勾则强制重新处理）
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#444' }}>
            <span>页面范围：</span>
            <SegBtn active={pageScope === 'all'} onClick={() => setPageScope('all')} disabled={running}>
              全部页
            </SegBtn>
            <SegBtn active={pageScope === 'firstOnly'} onClick={() => setPageScope('firstOnly')} disabled={running}>
              仅首页（多页 PDF 只盖首页）
            </SegBtn>
          </div>
        </div>
      </div>

      {/* 执行 + 进度 */}
      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={() => runBatch(false)}
          style={{
            ...primaryBtn,
            fontSize: 14, padding: '10px 24px',
            background: (running || batchError) ? '#CCC' : '#0078D4',
            cursor: (running || batchError) ? 'not-allowed' : 'pointer',
          }}
          disabled={running || !!batchError}
          title={batchError || '正式生成加章后的 PDF'}
        >
          {runningMode === 'real'
            ? `处理中 ${progress.done}/${progress.total}`
            : batchError
            ? `⚠ ${batchError}`
            : `▶ 开始处理 ${items.length} 个文件`}
        </button>
        <button
          onClick={() => runBatch(true)}
          style={{ ...btnSecondary, padding: '10px 16px' }}
          disabled={running || !!batchError}
          title={batchError || '只检测、不写文件——可以先看会处理哪些 + 智能透明度结果'}
        >
          {runningMode === 'dry' ? `试运行中 ${progress.done}/${progress.total}` : '🔍 试运行'}
        </button>
        {items.length > 0 && !running && (
          <button
            onClick={clearItems}
            style={{ ...btnSecondary, padding: '10px 16px' }}
            title="清空当前文件列表"
          >
            🗑 清空列表
          </button>
        )}
        {running && (
          <div style={{ flex: 1, height: 8, background: '#E5E5E5', borderRadius: 4 }}>
            <div style={{
              width: progress.total > 0 ? `${(progress.done / progress.total) * 100}%` : 0,
              height: '100%',
              background: runningMode === 'dry' ? '#9333EA' : '#0078D4',
              borderRadius: 4,
              transition: 'width .2s',
            }} />
          </div>
        )}
      </div>

      {/* 处理统计 - 跟随每次正式/试运行刷新 */}
      {items.length > 0 && (
        <div style={{
          marginTop: 8, padding: '8px 12px',
          background: '#FAFAFA', borderRadius: 4,
          fontSize: 12, color: '#666',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <span>
            共 {items.length} · 待处理 <b>{pendingCount}</b>
            {' · '}完成 <b style={{ color: '#0F7B0F' }}>{okCount}</b>
            {skipCount > 0 && (
              <> · 跳过 <b style={{ color: '#0078D4' }}>{skipCount}</b></>
            )}
            {' · '}失败 <b style={{ color: '#A4262C' }}>{errCount}</b>
          </span>
          {(semiCount + solidCount + detectFailCount) > 0 && (
            <span style={{
              padding: '2px 8px', background: '#EAF6FF', borderRadius: 4, color: '#0078D4',
            }}>
              智能透明度：半透明 <b>{semiCount}</b> · 实心 <b>{solidCount}</b>
              {detectFailCount > 0 && <> · ⚠检测失败 <b>{detectFailCount}</b></>}
            </span>
          )}
        </div>
      )}

      {/* 文件列表 */}
      {items.length > 0 && (
        <div style={{ marginTop: 16, flex: 1, overflow: 'auto', border: '1px solid #E5E5E5', borderRadius: 6, background: '#fff' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, background: '#F5F5F5' }}>
              <tr>
                <th style={th}>状态</th>
                <th style={{ ...th, textAlign: 'left' }}>文件名</th>
                <th style={th}>智能透明度</th>
                <th style={th}>大小</th>
                <th style={th}>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #EEE' }}>
                  <td style={td}>
                    <StatusBadge status={it.status} message={it.message} />
                  </td>
                  <td style={{ ...td, textAlign: 'left' }}>
                    <div title={it.path} style={{ maxWidth: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {it.name}
                    </div>
                  </td>
                  <td style={{ ...td, fontSize: 11, color: '#555' }}>
                    {it.message || '-'}
                  </td>
                  <td style={td}>
                    {it.sizeOut ? `${(it.sizeIn! / 1024).toFixed(0)}→${(it.sizeOut / 1024).toFixed(0)} KB` : '-'}
                  </td>
                  <td style={td}>
                    {!running && it.status === 'pending' && (
                      <button onClick={() => removeItem(i)} style={smallBtn}>移除</button>
                    )}
                    {(it.status === 'done' || it.status === 'skipped') && it.outPath && (
                      <button
                        onClick={() => window.api!.showItemInFolder(it.outPath!)}
                        style={smallBtn}
                      >
                        定位
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SegBtn({ active, onClick, disabled, children }: any) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '4px 10px',
        borderRadius: 4,
        background: active ? '#0078D4' : '#fff',
        color: active ? '#fff' : '#444',
        border: '1px solid ' + (active ? '#0078D4' : '#D1D1D1'),
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        fontSize: 11,
      }}
    >
      {children}
    </button>
  );
}

function StatusBadge({ status, message }: { status: BatchItem['status']; message?: string }) {
  const cfg = {
    pending: { bg: '#F0F0F0', fg: '#666', text: '待处理' },
    processing: { bg: '#FFF4CE', fg: '#9D5D00', text: '处理中' },
    done: { bg: '#DFF6DD', fg: '#0F7B0F', text: '✓ 完成' },
    skipped: { bg: '#E1F0FF', fg: '#0078D4', text: '⊘ 跳过' },
    error: { bg: '#FDE7E9', fg: '#A4262C', text: '✗ 失败' },
  }[status];
  return (
    <span title={message} style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 10,
      background: cfg.bg, color: cfg.fg, fontSize: 11, fontWeight: 600, minWidth: 56, textAlign: 'center',
    }}>{cfg.text}</span>
  );
}

const wrap: React.CSSProperties = {
  height: '100%',
  padding: 24,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'auto',
};
const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #E5E5E5',
  borderRadius: 6,
  padding: 12,
  marginBottom: 12,
};
const cardTitle: React.CSSProperties = { fontWeight: 600, fontSize: 13, marginBottom: 8 };
const inputBox: React.CSSProperties = {
  width: '100%', padding: '6px 10px', border: '1px solid #D1D1D1', borderRadius: 4,
};
const lbl: React.CSSProperties = { fontSize: 11, color: '#666', marginBottom: 4 };
const primaryBtn: React.CSSProperties = {
  padding: '8px 16px', background: '#0078D4', color: '#fff',
  border: 'none', borderRadius: 4, fontWeight: 600, cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  padding: '6px 12px', background: '#fff',
  border: '1px solid #D1D1D1', borderRadius: 4,
};
const smallBtn: React.CSSProperties = {
  padding: '2px 8px', background: '#fff', border: '1px solid #D1D1D1',
  borderRadius: 4, fontSize: 11, marginLeft: 4,
};
const th: React.CSSProperties = { padding: '8px 12px', fontWeight: 600, fontSize: 11, textAlign: 'center', color: '#444' };
const td: React.CSSProperties = { padding: '6px 12px', textAlign: 'center', color: '#333' };
