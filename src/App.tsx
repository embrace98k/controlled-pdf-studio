/**
 * 主界面：左侧导航 + 中央内容 + 底部状态栏
 * 模式：单文件精调 / 批量套模板
 */
import { useEffect, useRef, useState } from 'react';
import PdfPreview from './PdfPreview';
import SettingsPanel from './SettingsPanel';
import BatchPanel from './BatchPanel';
import { useAppStore, parseFilenameMeta } from './store';
import { stampPdf, downloadBlob } from './pdfWriter';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
import { detectRegionContent } from './contentDetector';

type Mode = 'single' | 'batch' | 'templates' | 'settings';

interface Template {
  name: string;
  createdAt: string;
  stamp: any;
}

export default function App() {
  const store = useAppStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string>('就绪');
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<Mode>('single');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [lastSavedPath, setLastSavedPath] = useState<string | null>(null);
  const [stampedWarning, setStampedWarning] = useState<boolean>(false);
  const [tplModalOpen, setTplModalOpen] = useState<boolean>(false);
  const [tplName, setTplName] = useState<string>('');
  const isElectron = !!window.api?.isElectron;

  useEffect(() => {
    if (isElectron) {
      window.api!.listTemplates().then(setTemplates);
      // 监听"右键用本工具打开"传过来的 PDF 路径
      const off = window.api!.onOpenPdfFromArg(async (filePath) => {
        try {
          const bytes = await window.api!.readFile(filePath);
          const fileName = await window.api!.pathBasename(filePath);
          const file = new File([new Uint8Array(bytes)], fileName, { type: 'application/pdf' });
          setMode('single');
          await loadPdfFile(file, bytes.buffer as ArrayBuffer, filePath);
        } catch (e: any) {
          setStatus(`打开失败：${e.message}`);
        }
      });
      return off;
    }
  }, [isElectron]);

  const reloadTemplates = () => {
    if (isElectron) window.api!.listTemplates().then(setTemplates);
  };

  // ---------- 单文件模式 ----------
  const handleOpenFile = async () => {
    if (isElectron) {
      const filePath = await window.api!.openFileDialog();
      if (!filePath) return;
      const bytes = await window.api!.readFile(filePath);
      const fileName = await window.api!.pathBasename(filePath);
      const file = new File([new Uint8Array(bytes)], fileName, { type: 'application/pdf' });
      await loadPdfFile(file, bytes.buffer as ArrayBuffer, filePath);
    } else {
      fileInputRef.current?.click();
    }
  };

  const loadPdfFile = async (file: File, bytes: ArrayBuffer, sourcePath: string | null = null) => {
    setLastSavedPath(null);
    setStampedWarning(false);
    setStatus(`正在打开 ${file.name} ...`);
    try {
      const doc = await pdfjsLib.getDocument({
        data: new Uint8Array(bytes.slice(0)),
        cMapUrl: 'pdfjs/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: 'pdfjs/standard_fonts/',
      }).promise;
      const page = await doc.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      store.loadPdf(file, bytes, doc.numPages, viewport.width, viewport.height, sourcePath);

      // 检测是否已加过章
      // 桌面版有 sourcePath → 用 IPC 检测；浏览器版没有 sourcePath → 直接用 pdf-lib 检测元数据
      let stamped = false;
      try {
        if (sourcePath && isElectron) {
          stamped = await window.api!.checkStamped(sourcePath);
        } else {
          // 简易检测：读 PDF 的 Producer 元数据
          const { PDFDocument } = await import('pdf-lib');
          const d = await PDFDocument.load(new Uint8Array(bytes.slice(0)), {
            ignoreEncryption: true,
            throwOnInvalidObject: false,
            updateMetadata: false,
          });
          const producer = d.getProducer() || '';
          const keywords = (d.getKeywords() || '').toString();
          stamped = producer.includes('Controlled-PDF-Studio') || keywords.includes('controlled-stamped');
        }
      } catch {}
      setStampedWarning(stamped);

      setStatus(`已加载：${file.name} · 共 ${doc.numPages} 页 · ${Math.round(viewport.width)}×${Math.round(viewport.height)} pt`);
    } catch (e: any) {
      setStatus(`打开失败：${e.message}`);
    }
  };

  const handleFile = async (file: File) => {
    const bytes = await file.arrayBuffer();
    await loadPdfFile(file, bytes);
  };

  // 校验印章信息完整性 - 缺任意字段都不允许导出
  const validationError = (() => {
    if (!store.state.pdfBytes) return null; // 没 PDF 时按钮本来就 disabled
    const m = store.state.meta;
    if (!m.operator?.trim()) return '请填操作人';
    if (!m.part?.trim()) return '请填零件号';
    if (!m.rev?.trim()) return '请填版本号';
    if (!m.date) return '请填受控日期';
    return null;
  })();

  const handleSave = async () => {
    if (!store.state.pdfBytes) return;
    if (validationError) {
      setStatus(`⚠ ${validationError}`);
      return;
    }
    setSaving(true);
    setLastSavedPath(null);
    setStatus('正在分析印章位置 ...');
    try {
      // 智能透明度检测
      const ab = store.state.pdfBytes.slice(0);
      const det = await detectRegionContent(
        ab, store.state.currentPage,
        store.state.stamp.layout.x, store.state.stamp.layout.y,
        store.state.stamp.layout.width, store.state.stamp.layout.height,
        { label: store.state.pdfFileName || 'single' }
      );
      const effectiveStamp = {
        ...store.state.stamp,
        opacity: det.hasContent ? 0.6 : 0.95,
      };
      setStatus(
        `正在生成 PDF ... 非白 ${(det.ratio * 100).toFixed(1)}% → 透明度 ${det.hasContent ? '0.6' : '0.95'}`
      );

      // 默认保存到源 PDF 同目录；文件名预填 【受控】 后缀；用户可改路径/名字
      const baseName = (store.state.pdfFileName || 'output.pdf').replace(/\.pdf$/i, '');
      const cleanBase = baseName
        .replace(/\s*【受控】\s*(?:\(\d+\))?\s*$/, '')           // 已带【受控】的剥掉再加
        .replace(/_stamped\s*$/i, '')                            // 老版 _stamped
        .replace(/\s*\[[0-9a-f]{8}\](?:\s*\(\d+\))?\s*$/i, '')   // 老版 [8hex]
        .trim();
      const suggestedName = `${cleanBase}【受控】.pdf`;

      if (isElectron && store.state.pdfSourcePath) {
        const srcPath = store.state.pdfSourcePath;
        const srcDir = srcPath.replace(/[\\/][^\\/]+$/, '');
        // 弹保存对话框（默认路径 = 源目录 + 建议名）
        const defaultPath = `${srcDir}\\${suggestedName}`;
        const outPath = await window.api!.saveFileDialog(defaultPath, 'pdf');
        if (!outPath) {
          setStatus('已取消');
          return;
        }
        const result = await window.api!.stampPdfFile(
          srcPath,
          outPath,
          effectiveStamp,
          store.state.meta,
          store.state.applyTo,
          store.state.currentPage,
          false,   // autoPlace=false：单文件模式尊重用户调好的位置
          false,   // skipIfStamped=false：单文件模式总是处理
        );
        if (result.ok) {
          const final = result.finalPath || outPath;
          setLastSavedPath(final);
          const sizeKB = ((result.sizeOut || 0) / 1024).toFixed(0);
          const flags: string[] = [];
          if (result.encrypted) flags.push('已加密');
          if (result.readonly) flags.push('只读');
          if (result.hash) flags.push(`SHA256: ${result.hash}`);
          const tail = flags.length ? ` · ${flags.join(' · ')}` : '';
          setStatus(`✓ 已保存：${final} · ${sizeKB} KB${tail}`);
        } else {
          setStatus(`✗ 失败：${result.error}`);
        }
      } else {
        // 浏览器模式 fallback：用 pdf-lib 直接生成 + 下载（无 Electron 时）
        const bytes = await stampPdf({ ...store.state, stamp: effectiveStamp });
        downloadBlob(bytes, suggestedName);
        setStatus(`✓ 已下载：${suggestedName} · ${(bytes.length / 1024).toFixed(1)} KB`);
      }
    } catch (e: any) {
      setStatus(`✗ 失败：${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && /\.pdf$/i.test(file.name)) await handleFile(file);
  };

  // ---------- 模板管理 ----------
  const handleSaveTemplate = () => {
    if (!isElectron) {
      alert('模板功能仅在桌面版可用');
      return;
    }
    setTplName(`模板${templates.length + 1}`);
    setTplModalOpen(true);
  };

  const confirmSaveTemplate = async () => {
    const name = tplName.trim();
    if (!name) return;
    await window.api!.saveTemplate(name, store.state.stamp);
    await reloadTemplates();
    setTplModalOpen(false);
    setStatus(`✓ 模板"${name}"已保存`);
  };

  const handleApplyTemplate = (tpl: Template) => {
    store.updateStamp(tpl.stamp);
    setStatus(`已套用模板：${tpl.name}`);
  };

  const handleDeleteTemplate = async (name: string) => {
    if (!confirm(`删除模板"${name}"？`)) return;
    await window.api!.deleteTemplate(name);
    await reloadTemplates();
  };

  const handleExportTemplates = async () => {
    if (!isElectron) return;
    if (templates.length === 0) {
      alert('当前没有模板可导出');
      return;
    }
    const out = await window.api!.saveFileDialog(
      `controlled-pdf-templates-${new Date().toISOString().slice(0, 10)}.json`,
      'json',
    );
    if (!out) return;
    await window.api!.writeTextFile(out, JSON.stringify(templates, null, 2));
    alert(`已导出 ${templates.length} 个模板到：\n${out}`);
  };

  const handleImportTemplates = async () => {
    if (!isElectron) return;
    const files = await window.api!.openFilesDialog('json');
    if (files.length === 0) return;
    let imported = 0;
    let failed = 0;
    for (const f of files) {
      try {
        const text = await window.api!.readTextFile(f);
        const arr = JSON.parse(text);
        if (!Array.isArray(arr)) throw new Error('JSON 格式错误：不是数组');
        for (const t of arr) {
          if (t.name && t.stamp) {
            await window.api!.saveTemplate(t.name, t.stamp);
            imported++;
          }
        }
      } catch (e: any) {
        failed++;
        console.error('导入模板失败：', f, e);
      }
    }
    await reloadTemplates();
    alert(`已导入 ${imported} 个模板${failed > 0 ? `（${failed} 个文件失败）` : ''}`);
  };

  return (
    <div
      style={layoutStyle}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <header style={headerStyle}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>
          📄 受控PDF盖章工具 {isElectron ? '· 桌面版 v1.0.7' : '· Web 版 v1.0.7'}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {mode === 'single' && (
            <>
              <button style={btnStyle} onClick={handleOpenFile}>📂 打开 PDF</button>
              <button
                style={{
                  ...btnStyle,
                  background: (validationError || !store.state.pdfBytes) ? '#CCC' : '#0078D4',
                  color: '#fff',
                  borderColor: (validationError || !store.state.pdfBytes) ? '#CCC' : '#0078D4',
                  cursor: (validationError || !store.state.pdfBytes || saving) ? 'not-allowed' : 'pointer',
                }}
                onClick={handleSave}
                disabled={!store.state.pdfBytes || saving || !!validationError}
                title={validationError || (store.state.pdfBytes ? '导出加章后的 PDF' : '请先打开 PDF')}
              >
                {saving
                  ? '处理中...'
                  : validationError
                  ? `⚠ ${validationError}`
                  : '💾 应用并导出'}
              </button>
              {isElectron && lastSavedPath && (
                <button
                  style={{ ...btnStyle, background: '#10B981', color: '#fff', borderColor: '#10B981' }}
                  onClick={() => window.api!.showItemInFolder(lastSavedPath)}
                >
                  📂 打开输出位置
                </button>
              )}
              {isElectron && (
                <button style={btnStyle} onClick={handleSaveTemplate} disabled={!store.state.pdfBytes}>
                  ⭐ 保存为模板
                </button>
              )}
            </>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
      </header>

      <div style={bodyStyle}>
        {/* 左侧导航 */}
        <nav style={navStyle}>
          <NavBtn icon="📄" label="单文件" active={mode === 'single'} onClick={() => setMode('single')} />
          <NavBtn icon="📁" label="批量" active={mode === 'batch'} onClick={() => setMode('batch')} />
          <NavBtn icon="⭐" label="模板" active={mode === 'templates'} onClick={() => setMode('templates')} />
          <NavBtn icon="⚙" label="设置" active={mode === 'settings'} onClick={() => setMode('settings')} />
        </nav>

        {/* 中央 + 右侧 */}
        <main style={{ flex: 1, display: 'grid', gridTemplateRows: 'minmax(0, 1fr)', overflow: 'hidden', minHeight: 0, minWidth: 0 }}>
          {mode === 'single' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 380px', gridTemplateRows: 'minmax(0, 1fr)', overflow: 'hidden', minHeight: 0 }}>
              <section style={previewSectionStyle}>
                {stampedWarning && (
                  <div style={stampedBannerStyle}>
                    <span>⚠ <strong>此 PDF 已加过受控章</strong>。如继续应用并导出，会生成一份新的副本（原文件不变）。</span>
                    <button
                      onClick={() => setStampedWarning(false)}
                      style={{
                        marginLeft: 'auto', background: 'transparent', border: 'none',
                        color: '#92400E', cursor: 'pointer', fontSize: 14, padding: 0,
                      }}
                      title="关闭提示"
                    >✕</button>
                  </div>
                )}
                <PdfPreview
                  state={store.state}
                  onStampLayoutChange={store.updateStampLayout}
                />
              </section>
              <aside style={{ minHeight: 0, overflow: 'hidden' }}>
                <SettingsPanel
                  state={store.state}
                  onStamp={store.updateStamp}
                  onMeta={store.updateMeta}
                  onApplyToChange={store.setApplyTo}
                />
              </aside>
            </div>
          )}
          {mode === 'batch' && (
            <BatchPanel
              defaultStamp={store.state.stamp}
              buildMeta={(name) => {
                const meta = parseFilenameMeta(name);
                return { part: meta.part, rev: meta.rev };
              }}
            />
          )}
          {mode === 'templates' && (
            <TemplatesView
              templates={templates}
              onApply={handleApplyTemplate}
              onDelete={handleDeleteTemplate}
              onExport={handleExportTemplates}
              onImport={handleImportTemplates}
              isElectron={isElectron}
            />
          )}
          {mode === 'settings' && <SettingsView isElectron={isElectron} />}
        </main>
      </div>

      <footer style={footerStyle}>
        <span>{status}</span>
        <span style={{ color: '#666' }}>v1.0.7 {isElectron ? '桌面版' : 'Web 版'}</span>
      </footer>

      {tplModalOpen && (
        <div style={modalBackdropStyle} onClick={() => setTplModalOpen(false)}>
          <div style={modalCardStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>⭐ 保存为模板</div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 14 }}>
              当前印章的所有样式将被保存，下次可在批量模式或单文件模式套用。
            </div>
            <input
              autoFocus
              value={tplName}
              onChange={(e) => setTplName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmSaveTemplate();
                if (e.key === 'Escape') setTplModalOpen(false);
              }}
              placeholder="模板名称（例如：A4 竖版-右上角）"
              style={{
                width: '100%', padding: '8px 10px',
                border: '1px solid #D1D1D1', borderRadius: 4, fontSize: 13,
                boxSizing: 'border-box',
              }}
            />
            <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setTplModalOpen(false)}
                style={{ padding: '6px 16px', background: '#fff', border: '1px solid #D1D1D1', borderRadius: 4, cursor: 'pointer' }}
              >取消</button>
              <button
                onClick={confirmSaveTemplate}
                disabled={!tplName.trim()}
                style={{
                  padding: '6px 16px',
                  background: tplName.trim() ? '#0078D4' : '#CCC',
                  color: '#fff', border: 'none', borderRadius: 4,
                  cursor: tplName.trim() ? 'pointer' : 'default', fontWeight: 600,
                }}
              >保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsView({ isElectron }: { isElectron: boolean }) {
  const [ctxStatus, setCtxStatus] = useState<{ installed: boolean; needUpdate?: boolean; currentExe?: string } | null>(null);
  const [ctxMsg, setCtxMsg] = useState<string>('');

  const refresh = async () => {
    if (!isElectron) return;
    const s = await window.api!.contextMenuStatus();
    setCtxStatus(s);
  };
  useEffect(() => { refresh(); }, [isElectron]);

  const install = async () => {
    if (!isElectron) return;
    setCtxMsg('正在安装...');
    const r = await window.api!.contextMenuInstall();
    setCtxMsg(r.ok ? `✓ 已安装！现在可以在资源管理器右键 PDF → "用受控PDF工具打开"` : `✗ ${r.error}`);
    await refresh();
  };
  const uninstall = async () => {
    if (!isElectron) return;
    if (!confirm('确定卸载右键菜单？')) return;
    const r = await window.api!.contextMenuUninstall();
    setCtxMsg(r.ok ? '✓ 已卸载' : `✗ ${r.error}`);
    await refresh();
  };

  if (!isElectron) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>设置功能仅在桌面版可用</div>;
  }

  return (
    <div style={{ padding: 24, overflow: 'auto' }}>
      <h2 style={{ marginBottom: 16 }}>⚙ 设置</h2>

      {/* 右键菜单集成 */}
      <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #E5E5E5', padding: 16, maxWidth: 700 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>📂 资源管理器右键菜单集成</div>
        <div style={{ fontSize: 12, color: '#666', lineHeight: 1.6, marginBottom: 12 }}>
          安装后，在 Windows 资源管理器中右键 PDF 文件，可以看到 <strong>"用受控PDF工具打开"</strong> 菜单项。<br/>
          Windows 11 用户：可能在 <strong>"显示更多选项"</strong> 下面。<br/>
          注册到 <code style={{ background: '#F5F5F5', padding: '1px 4px' }}>HKEY_CURRENT_USER</code>，不需要管理员权限。
        </div>

        {ctxStatus && (
          <div style={{ fontSize: 12, color: ctxStatus.installed ? '#0F7B0F' : '#888', marginBottom: 12 }}>
            状态：{ctxStatus.installed ? '✓ 已安装' : '○ 未安装'}
            {ctxStatus.currentExe && (
              <div style={{ marginTop: 4, color: '#999' }}>当前 .exe: {ctxStatus.currentExe}</div>
            )}
            {ctxStatus.installed && (
              <div style={{ marginTop: 4, color: '#888', fontSize: 11 }}>
                如果你换了安装位置或更新了版本，点"重新安装"刷新注册路径
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={install}
            style={{
              padding: '8px 16px', background: '#0078D4', color: '#fff',
              border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600,
            }}
          >
            {ctxStatus?.installed ? '🔄 重新安装（更新路径）' : '➕ 安装右键菜单'}
          </button>
          {ctxStatus?.installed && (
            <button
              onClick={uninstall}
              style={{
                padding: '8px 16px', background: '#fff', color: '#444',
                border: '1px solid #D1D1D1', borderRadius: 4, cursor: 'pointer',
              }}
            >
              ➖ 卸载
            </button>
          )}
        </div>

        {ctxMsg && (
          <div style={{
            marginTop: 12, padding: 10,
            background: ctxMsg.startsWith('✓') ? '#DFF6DD' : ctxMsg.startsWith('✗') ? '#FDE7E9' : '#F0F0F0',
            color: ctxMsg.startsWith('✗') ? '#A4262C' : '#202020',
            borderRadius: 4, fontSize: 12,
          }}>
            {ctxMsg}
          </div>
        )}
      </div>

      <div style={{ marginTop: 20, fontSize: 11, color: '#999' }}>
        受控PDF盖章工具 v1.0.7 · Electron 桌面版 · © 2026 深圳市无穹创新科技有限公司
      </div>
    </div>
  );
}

function NavBtn({ icon, label, active, onClick }: any) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? '#E8F2FB' : 'transparent',
        color: active ? '#0078D4' : '#444',
        border: 'none',
        width: 56,
        height: 56,
        borderRadius: 6,
        margin: '4px 0',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
      }}
    >
      <span style={{ fontSize: 18 }}>{icon}</span>
      <span style={{ fontSize: 10, fontWeight: active ? 700 : 400 }}>{label}</span>
    </button>
  );
}

function TemplatesView({ templates, onApply, onDelete, onExport, onImport, isElectron }: any) {
  if (!isElectron) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>
        模板功能仅在桌面版可用
      </div>
    );
  }
  return (
    <div style={{ padding: 24, overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>⭐ 我的模板</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onImport}
            style={{
              padding: '6px 14px', background: '#fff', border: '1px solid #D1D1D1',
              borderRadius: 4, cursor: 'pointer',
            }}
          >
            📥 导入 JSON
          </button>
          <button
            onClick={onExport}
            style={{
              padding: '6px 14px', background: '#fff', border: '1px solid #D1D1D1',
              borderRadius: 4, cursor: 'pointer',
            }}
            disabled={templates.length === 0}
          >
            📤 导出 JSON
          </button>
        </div>
      </div>
      {templates.length === 0 ? (
        <div style={{ color: '#888', padding: 40, textAlign: 'center', border: '1px dashed #DDD', borderRadius: 6 }}>
          还没有模板。在"单文件"模式调好印章后，点工具栏的 <strong>⭐ 保存为模板</strong> 即可创建。
          <div style={{ marginTop: 10, fontSize: 12 }}>或者点右上角 <strong>📥 导入 JSON</strong> 从别的机器导入模板。</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {templates.map((t: Template) => (
            <div key={t.name} style={{
              background: '#fff', border: '1px solid #E5E5E5', borderRadius: 8, padding: 16,
            }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>⭐ {t.name}</div>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 10 }}>
                创建于 {new Date(t.createdAt).toLocaleString('zh-CN')}
              </div>
              <div style={{ fontSize: 11, color: '#666', marginBottom: 12 }}>
                {t.stamp.layout.width.toFixed(0)} × {t.stamp.layout.height.toFixed(0)} pt
                {' · '}{t.stamp.titleFontSize}/{t.stamp.contentFontSize}pt
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => onApply(t)} style={{
                  flex: 1, padding: '6px', background: '#0078D4', color: '#fff', border: 'none', borderRadius: 4, fontSize: 12,
                }}>套用</button>
                <button onClick={() => onDelete(t.name)} style={{
                  padding: '6px 10px', background: '#fff', border: '1px solid #D1D1D1', borderRadius: 4, fontSize: 12,
                }}>删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const layoutStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateRows: '48px 1fr 28px',
  height: '100vh',
};
const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 16px',
  background: 'rgba(255,255,255,.85)',
  borderBottom: '1px solid #E5E5E5',
  backdropFilter: 'blur(10px)',
};
const bodyStyle: React.CSSProperties = {
  display: 'flex',
  overflow: 'hidden',
};
const navStyle: React.CSSProperties = {
  width: 64,
  padding: '8px 4px',
  background: '#FAFAFA',
  borderRight: '1px solid #E5E5E5',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
};
const previewSectionStyle: React.CSSProperties = {
  overflow: 'hidden',
  position: 'relative',
  minWidth: 0,
  minHeight: 0,
  // 用 flex column 让 banner 和 PdfPreview 正确分配高度
  display: 'flex',
  flexDirection: 'column',
};
const footerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 16px',
  background: 'rgba(255,255,255,.7)',
  borderTop: '1px solid #E5E5E5',
  fontSize: 11,
  color: '#444',
};
const btnStyle: React.CSSProperties = {
  padding: '6px 14px',
  background: '#fff',
  border: '1px solid #D1D1D1',
  borderRadius: 4,
};
const modalBackdropStyle: React.CSSProperties = {
  position: 'fixed', inset: 0,
  background: 'rgba(0,0,0,.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1000,
};
const modalCardStyle: React.CSSProperties = {
  background: '#fff', borderRadius: 8, padding: 20,
  minWidth: 360, maxWidth: 500,
  boxShadow: '0 10px 40px rgba(0,0,0,.25)',
};
const stampedBannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 14px',
  background: '#FEF3C7',
  borderBottom: '1px solid #F59E0B',
  color: '#92400E',
  fontSize: 13,
};
