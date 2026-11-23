import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'

// round57：多页卡片流组件（word 打印预览 / word 编辑器多页预览 / 拼版打印共用）。
// 背景：word 打印预览此前是【单页窗口 + ◀/▶ 翻页】，用户只能看到当前一页，
// 报告"打印预览少页 2/3/4/6/8 等"；且缺"每版打印 N 页"拼版（1版2/4/6/8页）。
//
// 机制：
//   renderContent() 每次调用返回一份【全量内容】渲染（内容按纸内容宽缩放，
//   单页高度 = contentH，与 PrintDialog 既有切片坐标系一致）；
//   内容总高 / contentH = 总页数（与旧测量口径相同：ceil）。
//   每张纸卡 = perPage 个切片格：格 = 固定尺寸窗口(overflow hidden) +
//   内层 transform: scale(K) translateY(-(p-1)*contentH)（先平移后缩放，
//   origin top left）→ 第 p 页顶部落在格顶、整页缩放进格。
//   懒挂载：IntersectionObserver（rootMargin 800px）只渲染视口附近的纸卡，
//   未挂载卡以同尺寸占位 —— 50 页文档也只挂载 2-3 张卡的克隆，避免 O(N²) DOM。
//   mountAll=true（拼版打印/小文档）全量挂载，不做观察。

export interface PageFlowProps {
  /** 每次调用返回一份全量内容渲染（可重复调用，各次独立克隆） */
  renderContent: () => React.ReactNode
  /** 单页内容高度（与内容同坐标系，预览 px） */
  contentH: number
  /** 纸宽（预览 px） */
  paperW: number
  /** 纸高（预览 px） */
  paperH: number
  /** 纸张内边距（预览 px，上 右 下 左） */
  pad: { top: number; right: number; bottom: number; left: number }
  /** 只显示这些页码（1 基，升序）；缺省 = 全部 */
  pages?: number[]
  /** 每版页数（1/2/4/6/8）：一张纸放 N 个逻辑页 */
  perPage?: 1 | 2 | 4 | 6 | 8
  /** 页数回调（测量完成后上报总页数） */
  onCount?: (n: number) => void
  /** 全量挂载（打印/页数≤6 时），跳过懒挂载 */
  mountAll?: boolean
  testId?: string
}

interface CellGrid { cols: number; rows: number }

function gridFor(per: number): CellGrid {
  // 对标 MS Word 每版页数布局：2→2×1，4→2×2，6→2×3，8→2×4
  switch (per) {
    case 2: return { cols: 2, rows: 1 }
    case 4: return { cols: 2, rows: 2 }
    case 6: return { cols: 2, rows: 3 }
    case 8: return { cols: 2, rows: 4 }
    default: return { cols: 1, rows: 1 }
  }
}

export default function PageFlow(props: PageFlowProps) {
  const { renderContent, contentH, paperW, paperH, pad, pages, perPage = 1, onCount, mountAll, testId } = props
  const firstContentRef = useRef<HTMLDivElement>(null)
  const [total, setTotal] = useState(0)

  // 测量总高 → 总页数：量【卡 0 首格的内容包裹层】scrollHeight（即克隆全高）。
  // 旧方案是隐藏测量层 —— absolute 会被 transform 纸张 div 变成包含块（fixed 同理），
  // 13k 高的克隆把窗格滚动区撑出 10k 空白，翻页停在空白深处 → 卡片全滚出视口 →
  // 懒挂载全卸载（round57 实测）。卡 0 恒挂载保证测量源常在。
  useLayoutEffect(() => {
    const el = firstContentRef.current
    if (!el || contentH <= 0) return
    const n = Math.max(1, Math.ceil((el.scrollHeight - 2) / contentH))
    setTotal(prev => (prev === n ? prev : n))
  })
  useEffect(() => { if (total > 0) onCount?.(total) }, [total, onCount])

  const pageIdx: number[] = pages && pages.length ? pages.filter(p => p >= 1 && (!total || p <= total)) : Array.from({ length: Math.max(total || 1, 1) }, (_, i) => i + 1)

  const grid = gridFor(perPage)
  const innerW = Math.max(40, paperW - pad.left - pad.right)
  const innerH = Math.max(40, paperH - pad.top - pad.bottom)
  const cellW = innerW / grid.cols
  const cellH = innerH / grid.rows
  // 整页（innerW×contentH 内容坐标系）缩放进格：取宽高双向最小
  const K = Math.min(cellW / innerW, cellH / contentH)

  const cards: number[][] = []
  for (let i = 0; i < pageIdx.length; i += perPage) cards.push(pageIdx.slice(i, i + perPage))
  const mountThreshold = mountAll || cards.length <= 6 ? Infinity : 800

  // 懒挂载：视口附近（rootMargin）的纸卡才渲染克隆
  const [mounted, setMounted] = useState<Record<number, boolean>>(() => (mountThreshold === Infinity ? { 0: true, 1: true, 2: true } as Record<number, boolean> : { 0: true } as Record<number, boolean>))
  const cardRefs = useRef<Record<number, HTMLDivElement | null>>({})
  useEffect(() => {
    if (mountThreshold === Infinity) return
    const io = new IntersectionObserver(entries => {
      let changed = false
      const next = { ...mountedRef.current }
      for (const en of entries) {
        const ci = Number((en.target as HTMLElement).dataset.card)
        if (!Number.isFinite(ci)) continue
        const want = en.isIntersecting
        if (!!next[ci] !== want) { next[ci] = want; changed = true }
      }
      if (changed) setMounted(next)
    }, { rootMargin: `${mountThreshold}px 0px` })
    Object.values(cardRefs.current).forEach(el => el && io.observe(el))
    return () => io.disconnect()
  })
  const mountedRef = useRef(mounted)
  mountedRef.current = mounted

  return (
    <div data-testid={testId} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '4px 0 16px', width: paperW }}>
      {/* 隐藏测量层：渲染一份全量内容测总高（不进视口） */}
      {cards.map((cardPages, ci) => {
        const isMounted = ci === 0 || !!mounted[ci] || mountThreshold === Infinity
        return (
          <div
            key={ci}
            ref={el => { cardRefs.current[ci] = el }}
            data-card={ci}
            data-testid={testId ? `${testId}-card` : undefined}
            className="print-paper"
            style={{
              width: paperW, minHeight: paperH, background: '#fff', boxShadow: '0 4px 16px rgba(15,23,42,0.18)',
              padding: `${pad.top}px ${pad.right}px ${pad.bottom}px ${pad.left}px`, boxSizing: 'border-box',
              position: 'relative', flex: '0 0 auto',
            }}
          >
            {isMounted ? (
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${grid.cols}, ${cellW}px)`, gap: 6 }}>
                {cardPages.map(p => (
                  <div key={p} data-page={p} style={{ width: cellW, height: cellH, overflow: 'hidden', position: 'relative', background: '#fff' }}>
                    <div
                      ref={ci === 0 && p === cardPages[0] ? firstContentRef : undefined}
                      style={{ transform: `scale(${K}) translateY(${-(p - 1) * contentH}px)`, transformOrigin: 'top left', width: innerW }}
                    >
                      {renderContent()}
                    </div>
                  </div>
                ))}
                {/* 不足 perPage 的空格：占位保持网格形状（MS 拼版同样留空） */}
                {Array.from({ length: perPage - cardPages.length }).map((_, k) => (
                  <div key={'e' + k} style={{ width: cellW, height: cellH }} />
                ))}
              </div>
            ) : (
              <div style={{ height: innerH }} />
            )}
            <div style={{ textAlign: 'center', fontSize: 10, color: '#94a3b8', marginTop: 4 }}>- {ci + 1} -</div>
          </div>
        )
      })}
    </div>
  )
}
