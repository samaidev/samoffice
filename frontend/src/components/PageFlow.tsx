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
    // round63 修复（用户报告：打印预览显示 3 页、实际一页）：
    // scrollHeight 量的是【未缩放】布局高（transform:scale 不改布局尺寸），
    // 除以【缩放后口径】的 contentH → 页数虚高 ~1/K 倍。按 getBoundingClientRect
    // 的视觉高（含 scale）测量，与切片口径一致；兜底 scrollHeight×K（老浏览器 rect
    // 异常时）。另加 2px 容差防临界整页多算一页。
    let visualH = 0
    try { visualH = el.getBoundingClientRect().height } catch { visualH = 0 }
    const scaled = visualH > 1 ? visualH : el.scrollHeight * K
    totalHRef.current = scaled
    const n = Math.max(1, Math.ceil((scaled - 2) / contentH))
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

  // round63（用户报告：1版2页显示的根本不是一页里显示两页内容）：
  // 旧拼版 = 一张纸排 perPage 个【完整逻辑页】（1 页文档选 1版2页只显示
  // 1 格内容 + 空格 —— 用户视之无效）。改为【内容流拼贴】：拼版时把
  // 全部内容按 contentH 切成逻辑页序列并循环填充每张纸的每个格 ——
  // 不足一格的内容也切半页，一页文档拼 1版2页 = 上下/左右各半页内容，
  // 一页里真的看到两份内容（贴近用户直觉的「两页内容拼一版」）。
  // 每版 1 页（默认）仍是完整逻辑页语义（无变化）。
  const cards: number[][] = []
  for (let i = 0; i < pageIdx.length; i += perPage) cards.push(pageIdx.slice(i, i + perPage))
  // 拼版不足补空：把后续（不存在的）页码也填上空格子序列，使每张纸都有 perPage 格；
  // 空格页码 = 负数标记，渲染时给占位样式（不查内容）。
  if (perPage > 1) {
    for (let ci = 0; ci < cards.length; ci++) {
      while (cards[ci].length < perPage) {
        // 没有更多逻辑页时：把总内容流切片延伸（第 k 个“流片”，页码延续编号）
        cards[ci].push(-cards[ci].length - (pageIdx.length ? pageIdx[pageIdx.length - 1] : 0))
      }
    }
  }
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
  // 内容视觉总高（流片判断用；测量 effect 里同步）
  const totalHRef = useRef(0)

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
                {cardPages.map(p => {
                  // round63：p<0 = 内容流延伸片（真实页码 |p|，超出逻辑页数但
                  // 在内容流高度内 —— 1 页内容拼 1版2页 的第二格显示后半页）
                  const flowP = Math.abs(p)
                  // 流片超出内容总高 → 空占位（内容不够填满最后一版）
                  if (p < 0 && (flowP - 1) * contentH > totalHRef.current) {
                    return <div key={p} data-page={p} style={{ width: cellW, height: cellH, background: '#fafafa' }} />
                  }
                  return (
                    <div key={p} data-page={p} style={{ width: cellW, height: cellH, overflow: 'hidden', position: 'relative', background: '#fff' }}>
                      <div
                        ref={ci === 0 && p === cardPages[0] ? firstContentRef : undefined}
                        style={{ transform: `scale(${K}) translateY(${-(flowP - 1) * contentH}px)`, transformOrigin: 'top left', width: innerW }}
                      >
                        {renderContent()}
                      </div>
                    </div>
                  )
                })}
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
