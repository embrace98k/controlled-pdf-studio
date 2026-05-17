/**
 * 右侧设置面板（印章版）
 */
import type { AppState, StampConfig, DocMeta } from './types';

interface Props {
  state: AppState;
  onStamp: (p: Partial<StampConfig>) => void;
  onMeta: (p: Partial<DocMeta>) => void;
  onApplyToChange: (v: 'current' | 'all') => void;
}

export default function SettingsPanel({
  state, onStamp, onMeta, onApplyToChange,
}: Props) {
  const disabled = !state.pdfBytes;
  return (
    <div style={panelStyle}>
      <div style={titleStyle}>受控印章设置</div>

      <Card title="📋 印章信息 ★ 必填">
        <Row label="零件号 {part}">
          <input
            value={state.meta.part}
            onChange={(e) => onMeta({ part: e.target.value })}
            style={requiredInputStyle(!state.meta.part?.trim())}
          />
        </Row>
        <div style={twoCol}>
          <Row label="版本 {rev}">
            <input
              value={state.meta.rev}
              onChange={(e) => onMeta({ rev: e.target.value })}
              style={requiredInputStyle(!state.meta.rev?.trim())}
            />
          </Row>
          <Row label="受控日期 {date}">
            <input
              type="date"
              value={state.meta.date}
              onChange={(e) => onMeta({ date: e.target.value })}
              style={requiredInputStyle(!state.meta.date)}
            />
          </Row>
        </div>
        <Row label="操作人 {operator}（会自动记住）">
          <input
            value={state.meta.operator}
            onChange={(e) => onMeta({ operator: e.target.value })}
            style={requiredInputStyle(!state.meta.operator?.trim())}
            placeholder="请输入你的姓名"
          />
        </Row>
        {(!state.meta.operator?.trim() || !state.meta.part?.trim() || !state.meta.rev?.trim() || !state.meta.date) && (
          <div style={{
            marginTop: 4, padding: '6px 8px',
            background: '#FEF3C7', borderRadius: 4,
            fontSize: 11, color: '#92400E',
          }}>
            ⚠ 印章信息有空字段，应用并导出按钮已锁定
          </div>
        )}
      </Card>

      <Card
        title="📌 印章样式"
        right={
          <Switch
            checked={state.stamp.enabled}
            onChange={(v) => onStamp({ enabled: v })}
            disabled={disabled}
          />
        }
      >
        <Row label="标题">
          <input
            value={state.stamp.title}
            onChange={(e) => onStamp({ title: e.target.value })}
            style={inputStyle}
            disabled={disabled || !state.stamp.enabled}
          />
        </Row>
        <Row label="详细内容（每行一项，支持占位符）">
          <textarea
            value={state.stamp.lines.join('\n')}
            onChange={(e) => onStamp({ lines: e.target.value.split('\n') })}
            rows={4}
            style={{ ...inputStyle, fontSize: 12, resize: 'vertical' }}
            disabled={disabled || !state.stamp.enabled}
          />
        </Row>

        <div style={twoCol}>
          <Row label="标题字号(pt)">
            <input
              type="number"
              min={6} max={48}
              value={state.stamp.titleFontSize}
              onChange={(e) => onStamp({ titleFontSize: +e.target.value })}
              style={inputStyle}
              disabled={disabled || !state.stamp.enabled}
            />
          </Row>
          <Row label="正文字号(pt)">
            <input
              type="number"
              min={5} max={24}
              value={state.stamp.contentFontSize}
              onChange={(e) => onStamp({ contentFontSize: +e.target.value })}
              style={inputStyle}
              disabled={disabled || !state.stamp.enabled}
            />
          </Row>
        </div>

        <div style={twoCol}>
          <Row label="边框粗细(pt)">
            <input
              type="number"
              min={0.5} max={6} step={0.5}
              value={state.stamp.borderWidth}
              onChange={(e) => onStamp({ borderWidth: +e.target.value })}
              style={inputStyle}
              disabled={disabled || !state.stamp.enabled}
            />
          </Row>
          <Row label="圆角(pt)">
            <input
              type="number"
              min={0} max={30}
              value={state.stamp.cornerRadius}
              onChange={(e) => onStamp({ cornerRadius: +e.target.value })}
              style={inputStyle}
              disabled={disabled || !state.stamp.enabled}
            />
          </Row>
        </div>

        <div style={twoCol}>
          <Row label="颜色（文字+边框）">
            <input
              type="color"
              value={state.stamp.color}
              onChange={(e) => onStamp({ color: e.target.value })}
              style={{ ...inputStyle, padding: 0, height: 28 }}
              disabled={disabled || !state.stamp.enabled}
            />
          </Row>
          <Row label="透明度">
            <input
              type="number"
              min={0.1} max={1} step={0.05}
              value={state.stamp.opacity}
              onChange={(e) => onStamp({ opacity: +e.target.value })}
              style={inputStyle}
              disabled={disabled || !state.stamp.enabled}
            />
          </Row>
        </div>

        <Row label="">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={state.stamp.doubleBorder}
              onChange={(e) => onStamp({ doubleBorder: e.target.checked })}
              disabled={disabled || !state.stamp.enabled}
            />
            双线边框（更像盖章）
          </label>
        </Row>
      </Card>

      <Card title="📄 应用范围">
        <div style={{ display: 'flex', gap: 6 }}>
          <SegBtn
            active={state.applyTo === 'current'}
            onClick={() => onApplyToChange('current')}
            disabled={disabled}
          >
            仅当前页
          </SegBtn>
          <SegBtn
            active={state.applyTo === 'all'}
            onClick={() => onApplyToChange('all')}
            disabled={disabled}
          >
            全部页 ({state.pdfPageCount || '-'})
          </SegBtn>
        </div>
      </Card>

    </div>
  );
}

function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={cardStyle}>
      <div style={cardHeader}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{title}</span>
        {right}
      </div>
      <div style={{ marginTop: 8 }}>{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 8 }}>
      {label && <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>{label}</div>}
      {children}
    </div>
  );
}

function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      disabled={disabled}
      style={{
        width: 38,
        height: 20,
        borderRadius: 10,
        background: checked ? '#0078D4' : '#CCC',
        position: 'relative',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{
        position: 'absolute',
        top: 2,
        left: checked ? 20 : 2,
        width: 16, height: 16, borderRadius: 8,
        background: '#fff',
        transition: 'left .15s',
      }} />
    </button>
  );
}

function SegBtn({ active, onClick, disabled, children }: any) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1,
        padding: '6px 10px',
        borderRadius: 4,
        background: active ? '#0078D4' : '#fff',
        color: active ? '#fff' : '#444',
        border: '1px solid ' + (active ? '#0078D4' : '#D1D1D1'),
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

const panelStyle: React.CSSProperties = {
  width: 380,
  height: '100%',
  padding: '16px',
  background: '#FAFAFA',
  borderLeft: '1px solid #E5E5E5',
  overflow: 'auto',
};
const titleStyle: React.CSSProperties = {
  fontSize: 16, fontWeight: 700, marginBottom: 14,
};
const cardStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 6,
  border: '1px solid #E5E5E5',
  padding: 12,
  marginBottom: 12,
};
const cardHeader: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '5px 8px',
  border: '1px solid #D1D1D1',
  borderRadius: 4,
  background: '#fff',
};
function requiredInputStyle(missing: boolean): React.CSSProperties {
  return {
    ...inputStyle,
    border: missing ? '1.5px solid #DC2626' : '1px solid #D1D1D1',
    background: missing ? '#FEF2F2' : '#fff',
  };
}
const twoCol: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
};
