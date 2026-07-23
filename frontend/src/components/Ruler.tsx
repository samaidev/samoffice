import { useCallback, useRef } from 'react'

// 1em 在标尺上的近似像素（与正文默认字号对应），用于把 em 单位的缩进换算到像素刻度。
const EM_PX = 16
// 每厘米像素（96dpi: 1 inch = 96px = 2.54cm ⇒ 1cm ≈ 37.8px）
const CM_PX = 96 / 2.54

export interface RulerIndents {
  indentLeft: number // em
  indentRight: number // em
  firstLine: number // em
  hanging: number // em
}

interface RulerProps {
  width: number // 整页宽度（px）
  marginLeft: number // 左页边距（px）
  marginRight: number // 右页边距（px）
  indents: RulerIndents
  onChange: (next: Partial<RulerIndents>) => void
}

type DragKind = 'left' | 'firstLine' | 'hanging' | 'right'

export function Ruler({ width, marginLeft, marginRight, indents, onChange }: RulerProps) {
  const dragRef = useRef<{
    kind: DragKind
    startX: number
    startVal: number
    contentLeft: number
    contentRight: number
  } | null>(null)

  const contentLeft = marginLeft
  const contentRight = width - marginRight

  const leftIndentPx = contentLeft + indents.indentLeft * EM_PX
  const rightIndentPx = contentRight - indents.indentRight * EM_PX
  const firstLinePx = leftIndentPx + indents.firstLine * EM_PX
  const hangingPx = leftIndentPx - indents.hanging * EM_PX

  // 生成厘米刻度：仅每 1cm 一条短刻度线；数字居中显示在厘米格内、且每 2cm 才标一次，保持清爽
  const ticks: { pos: number; label?: string; labelCenter?: number }[] = []
  const cmCount = Math.floor(width / CM_PX)
  for (let i = 0; i <= cmCount; i++) {
    const px = i * CM_PX
    if (px > width) break
    // 数字居中于「第 i 格」（i 到 i+1 之间），每 2cm 标一次
    const showNum = i % 2 === 0 && (i + 1) * CM_PX <= width
    ticks.push({ pos: px, label: showNum ? String(i) : undefined, labelCenter: showNum ? px + CM_PX / 2 : undefined })
  }

  const onPointerDown = useCallback(
    (e: React.PointerEvent, kind: DragKind) => {
      e.preventDefault()
      e.stopPropagation()
      const startVal =
        kind === 'left'
          ? indents.indentLeft
          : kind === 'right'
          ? indents.indentRight
          : kind === 'firstLine'
          ? indents.firstLine
          : indents.hanging
      dragRef.current = { kind, startX: e.clientX, startVal, contentLeft, contentRight }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [indents, contentLeft, contentRight],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const dxPx = e.clientX - d.startX
      const dEm = dxPx / EM_PX
      if (d.kind === 'left') {
        const next = Math.max(0, Math.min(d.contentRight - d.contentLeft, d.startVal + dEm))
        onChange({ indentLeft: round2(next) })
      } else if (d.kind === 'right') {
        const next = Math.max(0, Math.min(d.contentRight - d.contentLeft, d.startVal - dEm))
        onChange({ indentRight: round2(next) })
      } else if (d.kind === 'firstLine') {
        onChange({ firstLine: round2(d.startVal + dEm) })
      } else {
        onChange({ hanging: round2(d.startVal - dEm) })
      }
    },
    [onChange],
  )

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragRef.current = null
    try {
      ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* noop */
    }
  }, [])

  const handle = (kind: DragKind, pos: number, title: string, cls: string) => (
    <div
      onPointerDown={(e) => onPointerDown(e, kind)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      title={title}
      style={{
        position: 'absolute',
        left: pos,
        top: 0,
        width: 0,
        height: '100%',
        cursor: 'ew-resize',
        zIndex: 5,
      }}
      className={cls}
    />
  )

  return (
    <div
      style={{
        position: 'relative',
        height: 22,
        width,
        background: 'var(--color-surface, #fff)',
        borderBottom: '1px solid var(--color-border, #cbd5e1)',
        userSelect: 'none',
        overflow: 'hidden',
        margin: '0 auto',
      }}
    >
      {/* 页边距灰带 */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: marginLeft,
          height: '100%',
          background: 'rgba(148,163,184,0.35)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          width: marginRight,
          height: '100%',
          background: 'rgba(148,163,184,0.35)',
        }}
      />

      {/* 刻度线：每 1cm 一条短线 */}
      {ticks.map((tk, i) => (
        <div
          key={`tick-${i}`}
          style={{
            position: 'absolute',
            left: tk.pos,
            top: 14,
            width: 1,
            height: 6,
            background: '#cbd5e1',
          }}
        />
      ))}
      {/* 数字：居中于厘米格内，每 2cm 一个 */}
      {ticks.map((tk, i) =>
        tk.label !== undefined && tk.labelCenter !== undefined ? (
          <span
            key={`num-${i}`}
            style={{
              position: 'absolute',
              left: tk.labelCenter,
              top: 4,
              transform: 'translateX(-50%)',
              fontSize: 9,
              color: '#94a3b8',
              lineHeight: 1,
              pointerEvents: 'none',
            }}
          >
            {tk.label}
          </span>
        ) : null,
      )}

      {/* 缩进滑块：左缩进（方块）、首行缩进（上三角）、悬挂缩进（下三角）、右缩进（三角） */}
      {handle('left', leftIndentPx, '左缩进', 'ruler-left-indent')}
      {handle('firstLine', firstLinePx, '首行缩进', 'ruler-firstline')}
      {handle('hanging', hangingPx, '悬挂缩进', 'ruler-hanging')}
      {handle('right', rightIndentPx, '右缩进', 'ruler-right-indent')}
    </div>
  )
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}
