import { useState } from 'react'

interface Props {
  node: any
  onChange: (attrs: Record<string, any>) => void
  onClose: () => void
}

const SHAPES: { v: string; label: string }[] = [
  { v: 'rect', label: '矩形' },
  { v: 'roundRect', label: '圆角矩形' },
  { v: 'ellipse', label: '椭圆' },
  { v: 'triangle', label: '三角' },
  { v: 'diamond', label: '菱形' },
  { v: 'rightArrow', label: '右箭头' },
  { v: 'star5', label: '五角星' },
  { v: 'heart', label: '心形' },
]

const LINE_STYLES: { v: string; label: string }[] = [
  { v: 'solid', label: '实线' },
  { v: 'dash', label: '虚线' },
  { v: 'dot', label: '点线' },
  { v: 'dashDot', label: '点划线' },
]

export function TextBoxStylePanel({ node, onChange, onClose }: Props) {
  const a = node.attrs
  const [shape, setShape] = useState(a.shape || 'rect')
  const [lineStyle, setLineStyle] = useState(a.lineStyle || 'solid')
  const [borderW, setBorderW] = useState(Number(a.borderW) || 1)
  const [borderColor, setBorderColor] = useState(a.borderColor || '#f59e0b')
  const [bgColor, setBgColor] = useState(a.bgColor || '#fef3c7')
  const [width, setWidth] = useState(Number(a.width) || 0)
  const [floatV, setFloatV] = useState(a.float || '')

  const commit = (patch: Record<string, any>) => onChange(patch)

  return (
    <div
      className="fixed z-[60] w-64 rounded-xl shadow-2xl overflow-hidden"
      style={{
        right: 16,
        top: 96,
        background: 'var(--color-surface)',
        color: 'var(--color-text)',
        border: '1px solid var(--color-border)',
      }}
    >
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ background: 'var(--color-bg-alt)', borderBottom: '1px solid var(--color-border)' }}
      >
        <span className="text-sm font-semibold">文本框样式</span>
        <button className="text-lg leading-none hover:text-red-500" onClick={onClose} title="关闭">
          ×
        </button>
      </div>

      <div className="p-3 flex flex-col gap-3 max-h-[70vh] overflow-y-auto">
        {/* 形状 */}
        <div>
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--color-text-muted)' }}>形状</label>
          <div className="grid grid-cols-4 gap-1">
            {SHAPES.map((s) => (
              <button
                key={s.v}
                className="text-xs py-1.5 rounded"
                style={{
                  background: shape === s.v ? 'var(--color-primary)' : 'var(--color-bg-alt)',
                  color: shape === s.v ? 'white' : 'var(--color-text)',
                  border: '1px solid var(--color-border)',
                }}
                onClick={() => { setShape(s.v); commit({ shape: s.v }) }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* 边框宽度 */}
        <div>
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--color-text-muted)' }}>
            边框宽度 {borderW.toFixed(1)} pt
          </label>
          <input
            type="range" min={0} max={12} step={0.5} value={borderW}
            className="w-full"
            onChange={(e) => { const v = Number(e.target.value); setBorderW(v); commit({ borderW: v }) }}
          />
        </div>

        {/* 线型 */}
        <div>
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--color-text-muted)' }}>线条样式</label>
          <div className="grid grid-cols-2 gap-1">
            {LINE_STYLES.map((l) => (
              <button
                key={l.v}
                className="text-xs py-1.5 rounded"
                style={{
                  background: lineStyle === l.v ? 'var(--color-primary)' : 'var(--color-bg-alt)',
                  color: lineStyle === l.v ? 'white' : 'var(--color-text)',
                  border: '1px solid var(--color-border)',
                }}
                onClick={() => { setLineStyle(l.v); commit({ lineStyle: l.v }) }}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        {/* 边框色 */}
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>边框色</label>
          <input
            type="color" value={borderColor}
            onChange={(e) => { setBorderColor(e.target.value); commit({ borderColor: e.target.value }) }}
            className="w-10 h-7 rounded cursor-pointer border-0"
          />
        </div>

        {/* 填充色 */}
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>填充色</label>
          <div className="flex items-center gap-1">
            <button
              className="text-xs px-2 py-1 rounded"
              style={{ background: 'var(--color-bg-alt)', border: '1px solid var(--color-border)' }}
              onClick={() => { setBgColor(''); commit({ bgColor: '' }) }}
            >
              无
            </button>
            <input
              type="color" value={bgColor || '#ffffff'}
              onChange={(e) => { setBgColor(e.target.value); commit({ bgColor: e.target.value }) }}
              className="w-10 h-7 rounded cursor-pointer border-0"
            />
          </div>
        </div>

        {/* 宽度 */}
        <div>
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--color-text-muted)' }}>
            宽度 {width === 0 ? '自动' : width + ' px'}
          </label>
          <input
            type="range" min={0} max={600} step={10} value={width}
            className="w-full"
            onChange={(e) => { const v = Number(e.target.value); setWidth(v); commit({ width: v }) }}
          />
        </div>

        {/* 绕排 */}
        <div>
          <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--color-text-muted)' }}>文字绕排</label>
          <div className="grid grid-cols-3 gap-1">
            {[
              { v: '', label: '无' },
              { v: 'left', label: '左' },
              { v: 'right', label: '右' },
            ].map((f) => (
              <button
                key={f.v}
                className="text-xs py-1.5 rounded"
                style={{
                  background: floatV === f.v ? 'var(--color-primary)' : 'var(--color-bg-alt)',
                  color: floatV === f.v ? 'white' : 'var(--color-text)',
                  border: '1px solid var(--color-border)',
                }}
                onClick={() => { setFloatV(f.v); commit({ float: f.v }) }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
