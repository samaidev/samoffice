import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view'

export interface PageMetrics {
  /** 每页正文区高度（px）：整页高 - 上下边距 */
  pageContentPerPage: number
  /** 页与页之间的可见空白间隔（px） */
  gap: number
  /** 上边距（px） */
  marginTop: number
  /** 下边距（px） */
  marginBottom: number
  /** 整页高度（px），用于末页至少撑满一张纸 */
  pageHeightPx: number
}

/** 单张纸页矩形，坐标为“编辑器内容相对坐标”（与子节点 offsetTop 同坐标系） */
export interface PageRect {
  top: number
  height: number
}

const paginationKey = new PluginKey<DecorationSet>('pagination')

/**
 * 真正的“页面视图”分页引擎（唯一真相源）：
 * - 测量每个顶级块的真实渲染高度，逐页累加；
 * - 当累加高度超过单页正文区高度，或遇到显式分页符 / 段前分页时，在该块前“断页”；
 * - 断页节点加 margin-top，使其精确落到下一页顶部，形成干净的白边；
 * - 据实际内容位置算出每张纸页矩形（top/height），回报 React 绘制背景纸页层，
 *   从而保证“白边空白 / 背景纸页边界 / 显式分页符”三者位置完全一致。
 *
 * 关键点：测量时剔除上一次断页 margin 造成的整体下移，还原节点的“自然位置”，
 * 这样反复重算时断页判定稳定、不会因已应用的 margin 而失真。
 */
export function createPaginationPlugin(
  getMetrics: () => PageMetrics,
  onCount: (n: number) => void,
  onPages?: (rects: PageRect[]) => void,
) {
  let scheduled = false
  // 上一次已应用的断页节点位置集合（from 位置），用于还原自然位置
  let appliedBreaks = new Set<number>()
  let lastPageSig = ''

  const recompute = (view: EditorView) => {
    scheduled = false
    try {
      const m = getMetrics()
      const per = m.pageContentPerPage
      if (!per || per <= 0) return
      const dom = view.dom as HTMLElement
      const children = Array.from(dom.children) as HTMLElement[]
      const topCount = view.state.doc.childCount
      // 结构不一致时放弃分页，避免错位
      if (children.length !== topCount) return

      // 收集顶级块的位置与节点
      const froms: number[] = []
      const nodes: any[] = []
      view.state.doc.forEach((node, from) => {
        froms.push(from)
        nodes.push(node)
      })
      if (froms.length !== children.length) return

      // 断页处上下留白 = 下边距 + 可见间隔 + 上边距，使下一页内容恰好落在纸页顶部
      const M = Math.max(1, m.gap + m.marginTop + m.marginBottom)

      // 还原每个节点的“自然位置”：剔除历史上断页 margin 造成的整体下移
      const naturalTop: number[] = []
      let cnt = 0
      for (let k = 0; k < children.length; k++) {
        if (appliedBreaks.has(froms[k])) cnt++
        // offsetTop 包含其自身及之前所有断页 margin 造成的下移，逐层减回
        naturalTop[k] = children[k].offsetTop - M * cnt
      }

      // 决定新的断页点（动态累加高度 或 强制分页）
      const breaks: boolean[] = new Array(children.length).fill(false)
      let acc = 0
      for (let k = 0; k < children.length; k++) {
        const cs = getComputedStyle(children[k])
        const mb = parseFloat(cs.marginBottom) || 0
        const h = children[k].offsetHeight
        const forceBreak =
          nodes[k].type.name === 'page_break' ||
          (nodes[k].attrs && (nodes[k].attrs as any).pageBreakBefore)
        if (k > 0 && (acc + h + mb > per || forceBreak)) {
          breaks[k] = true
          acc = h + mb
        } else {
          acc += h + mb
        }
      }

      // 构建断页 decoration
      const decos: Decoration[] = []
      const newBreaks = new Set<number>()
      for (let k = 0; k < children.length; k++) {
        if (breaks[k]) {
          newBreaks.add(froms[k])
          decos.push(
            Decoration.node(froms[k], froms[k] + nodes[k].nodeSize, {
              style: 'margin-top: ' + M + 'px',
            }),
          )
        }
      }

      const cur = paginationKey.getState(view.state) as DecorationSet | null
      const curSig = cur
        ? cur.find().map((d: any) => d.from + ':' + d.to).join('|')
        : ''
      const newSig = decos.map((d: any) => d.from + ':' + d.to).join('|')
      if (newSig !== curSig) {
        view.dispatch(
          view.state.tr
            .setMeta(paginationKey, DecorationSet.create(view.state.doc, decos))
            .setMeta('addToHistory', false),
        )
      }
      appliedBreaks = newBreaks

      // 据实际内容位置计算每张纸页矩形（编辑器相对坐标）
      if (onPages) {
        const rects: PageRect[] = []
        let a = 0
        let c = 0 // 已遇断页数（即当前页之前有几处断页 margin）
        const closePage = (lastIdx: number) => {
          const top = naturalTop[a] + M * c - m.marginTop
          const bottom =
            naturalTop[lastIdx] + M * c + children[lastIdx].offsetHeight + m.marginBottom
          rects.push({ top, height: bottom - top })
        }
        for (let k = 0; k < children.length; k++) {
          if (breaks[k]) {
            closePage(k - 1) // 关闭上一页 [a, k-1]
            a = k
            c++
          }
        }
        closePage(children.length - 1) // 末页 [a, end]
        // 末页至少撑满一张纸，避免尾部出现短纸条
        if (rects.length) {
          rects[rects.length - 1].height = Math.max(
            rects[rects.length - 1].height,
            m.pageHeightPx,
          )
        }
        const sig = rects
          .map((r) => Math.round(r.top) + ':' + Math.round(r.height))
          .join('|')
        if (sig !== lastPageSig) {
          lastPageSig = sig
          onPages(rects)
        }
        onCount(rects.length)
      } else {
        onCount(breaks.filter(Boolean).length + 1)
      }
    } catch {
      /* 测量失败不影响编辑 */
    }
  }

  const schedule = (view: EditorView) => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => recompute(view))
  }

  return new Plugin<DecorationSet>({
    key: paginationKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, old) {
        const meta = tr.getMeta(paginationKey)
        if (meta !== undefined) return meta as DecorationSet
        return old.map(tr.mapping, tr.doc)
      },
    },
    props: {
      decorations(state) {
        return paginationKey.getState(state)
      },
    },
    view(editorView) {
      const initHandle = requestAnimationFrame(() => recompute(editorView))
      return {
        update: (v) => {
          schedule(v)
        },
        destroy: () => cancelAnimationFrame(initHandle),
      }
    },
  })
}
