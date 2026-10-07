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
  /** 缩放比例（1 = 100%），用于把 getBoundingClientRect 的视觉像素归一化为布局像素 */
  zoom: number
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
  onBlockPages?: (pages: number[]) => void,
) {
  let scheduled = false
  let lastPageSig = ''
  let lastBlockPagesSig = ''

  // 测量可拆块（段落/标题/代码块）内部“行首”位置：
  // 返回 [{offset, top}]，offset 为块内字符偏移（用于换算文档 pos），
  // top 为该行首相对块顶的像素（布局像素，未缩放，与 naturalTop 同坐标系）。
  const measureLineTops = (el: HTMLElement, blockFrom: number): { offset: number; top: number; height: number }[] => {
    const res: { offset: number; top: number; height: number }[] = []
    const elTop = el.getBoundingClientRect().top
    let charOffset = 0
    const range = document.createRange()
    // 记录“已见过的最大行顶”，用它而非 res 末项做比较：
    // 若某个字符 rect 异常（空 rect / 折行空格返回 0），不会把基准拉坏，
    // 从而避免“只测出 1 行”导致整段永不断行、文字冲出下直角。
    let lastTop = Number.NEGATIVE_INFINITY
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || ''
        for (let i = 0; i < text.length; i++) {
          range.setStart(node, i)
          range.setEnd(node, i + 1)
          const rect = range.getBoundingClientRect()
          // 空 rect（width=height=0 且 top=0）为无效测量，跳过，不污染基准
          if (rect.height === 0 && rect.width === 0) continue
          const top = rect.top - elTop
          // 行首：比“已见最大行顶”明显下移（>1px）即认为是新的一行
          if (res.length === 0 || top > lastTop + 1) {
            res.push({ offset: charOffset + i, top, height: rect.height || 0 })
            lastTop = top
          } else if (top > lastTop) {
            lastTop = top
          }
        }
        charOffset += text.length
      } else {
        // 跳过分页 widget 自身，它不是正文字符，不参与行首判定与字符偏移累计
        if (
          node.nodeType === Node.ELEMENT_NODE &&
          (node as HTMLElement).classList?.contains('pg-linebreak')
        ) {
          return
        }
        for (const c of Array.from(node.childNodes)) walk(c)
      }
    }
    // 跳过分页 widget 本身，避免其影响测量
    walk(el)
    // 行高用“下一行顶 - 当前行顶”推算，比单字符 rect.height 更贴近真实视觉行高
    // （line-height 通常 > 字符高，用字符高会漏判导致整行溢出下直角）。
    const blockH = el.offsetHeight
    for (let i = 0; i < res.length; i++) {
      const next = res[i + 1]
      res[i].height = next ? next.top - res[i].top : Math.max(res[i].height || 0, blockH - res[i].top)
    }
    return res
  }

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

      const K = children.length

      // 关键不变量（业界标准分页模型，纸张高度恒定，绝不随内容变化）：
      //   - 每张纸高度 = pageHeightPx（常量），纸与纸之间间隔 = gap。
      //   - 第 n 张纸（n 从 0 起）正文内容区顶部的“编辑器相对坐标”为
      //       pageTop(n) = n * (pageHeightPx + gap) + marginTop
      //   - 分页只决定“哪里断开”，断点处的元素被推到某张纸内容区顶部，
      //     推下的 margin-top = 目标纸坐标 - 该元素自然连续坐标（一次性正向算出，无自反馈）。
      const pageHeightPx = m.pageHeightPx
      const gap = m.gap
      const pageStep = pageHeightPx + gap // 相邻纸顶间距
      // 坐标统一到“正文内容盒坐标系”（offsetTop 体系，已不含 editor 的 marginTop padding）。
      // 因此第 n 页内容区顶 = n*pageStep（不再额外加 marginTop），断点判定直接与此比较。
      const pageTopOf = (n: number) => n * pageStep
      const blockTopY = (el: HTMLElement) => {
        // 块顶相对编辑器内容的连续坐标（不含任何断页 margin）。
        // 用 getBoundingClientRect 差值而非 offsetParent 链累加 offsetTop：
        // CSS filter / transform / contain 等属性会改变子元素的 offsetParent，
        // 导致 offsetTop 累加链在不同 UI 状态（如护眼模式切换）下整体偏移，
        // 表现为“切换护眼模式/标尺后分页和行距完全不同”。
        // rect 返回的是视觉（缩放后）像素，除以 zoom 归一化为布局像素，
        // 与 pageTopOf/pageStep 的布局坐标系一致。
        const z = m.zoom > 0 ? m.zoom : 1
        return (el.getBoundingClientRect().top - dom.getBoundingClientRect().top) / z
      }
      const blockIndexOf = (pos: number) => {
        for (let k = 0; k < K; k++) {
          if (pos >= froms[k] && pos < froms[k] + nodes[k].nodeSize) return k
        }
        return K - 1
      }

      // 可拆块（普通段落 / 标题 / 代码块）：允许在内部“行边界”跨页断开；
      // 其余块（表格 / 图片 / 列表 / 文本框 / 分页符等）整块跳页，不可拆。
      const splittable = (name: string) =>
        name === 'paragraph' || name === 'heading' || name === 'code_block'

      // 测量阶段：临时把已注入的行级断点 widget margin 归零，
      // 这样读到的 offsetTop 是“纯自然连续坐标”，与上一次应用的 decoration 无关。
      // 注意：这只是读值，分页决策不依赖上一次的结果，因此不存在自反馈。
      dom.classList.add('pg-measuring')

      // 每个顶级块顶部的“自然连续坐标”（相对编辑器内容，不含断页 margin）。
      const cumTop: number[] = children.map((el) => blockTopY(el))

      // 测量可拆块内部的“行首”位置（相对块顶的像素）
      const lineTops: { offset: number; top: number; height: number }[][] = children.map(() => [])
      for (let k = 0; k < K; k++) {
        if (!splittable(nodes[k].type.name)) continue
        lineTops[k] = measureLineTops(children[k], froms[k])
      }

      dom.classList.remove('pg-measuring')

      // 用“绝对坐标 → 页码”直接映射（业界标准，参考 LibreOffice SwTextFrameBreak：
      // 内容位置决定所在页，而非累加 curPage）。坐标均为“正文内容盒坐标系”（不含 marginTop）。
      const pageOf = (y: number) => Math.max(0, Math.floor(y / pageStep))
      // 第 n 页“内容区底边”坐标（内容盒坐标系）：超过此线即溢出下直角
      const pageBottomOf = (n: number) => pageTopOf(n) + per

      const blockBreaks = new Set<number>() // 块级断点（from 位置）
      const lineBreaks = new Set<number>()  // 行级断点（文档 pos）
      const breakMargin = new Map<number, number>() // 断点 -> 需注入的 margin-top
      const blockPage: number[] = new Array(K).fill(0)

      // 记录每个块“被断点推下后”的实际底部坐标，用于最终算出真实内容总高度 → 正确页数
      let contentMaxY = 0

      for (let k = 0; k < K; k++) {
        const name = nodes[k].type.name
        const forceBreak =
          name === 'page_break' || (nodes[k].attrs && (nodes[k].attrs as any).pageBreakBefore)
        const blockTop = cumTop[k]
        const blockH = children[k].offsetHeight
        const blockPageNo = pageOf(blockTop)
        // 该块“被推下后”的实际顶部坐标（含已计算的断点 margin，用于底部累计）
        let actualTop = blockTop

        if (forceBreak || !splittable(name)) {
          // 整块跳页：块底超过"当前页内容区底边（下直角）"或强制分页时，
          // 把整块推到能容纳它的下一页顶部，保证内容不越过页面下直角标记。
          // 关键修复：原实现用 pageOf(blockBottom) > blockPageNo（块底是否跨过整页
          // 步长 pageStep）判定断页 —— 当块底落在 (下直角, 下一页步长) 区间时，
          // 内容已越过下直角却未跨过整页步长，会被误判为"无需断页"，导致最后一段/
          // 列表/表格等内容溢出页面下直角之外，不按直角标记分页。
          // 现与可拆块一致，用"块底是否超过当前页内容区底边"判定（pageBottomOf）。
          const blockBottom = blockTop + blockH
          if (forceBreak || blockBottom > pageBottomOf(blockPageNo) - 0.5) {
            // 目标页：默认推到"块顶所在页的下一页"顶部。
            // 若块高不超过一页内容区高度（能整块放下），直接推到块底自然落在的页
            // （pageOf(blockBottom)），使整块恰好放入该页内容区内、不越下直角；
            // 块高超过一页内容区（表格/长图等）时保持推一页，允许其自然溢出。
            let targetPage = blockPageNo + 1
            if (!forceBreak && blockH <= per) {
              targetPage = Math.max(targetPage, pageOf(blockBottom))
            }
            const mt = Math.max(0, pageTopOf(targetPage) - blockTop)
            if (mt > 0) {
              breakMargin.set(froms[k], mt)
              blockBreaks.add(froms[k])
            }
            actualTop = blockTop + mt
            blockPage[k] = targetPage
          } else {
            blockPage[k] = blockPageNo
          }
          contentMaxY = Math.max(contentMaxY, actualTop + blockH)
        } else {
          // 可拆块：逐行判断（LibreOffice SwTextFrameBreak::IsBreakNow 语义）。
          // 关键：比较“整行底边”（top + height）与“当前页内容区底边”。
          // 仅当整行放不下当前页时才断，断点把该行推到“下一个能容纳它的页”内容区顶，
          // 新页顶端从内容区顶开始，既不超下直角、也不留白。天然支持跨任意多页。
          let curPage = blockPageNo
          let prevLineBottom = blockTop // 上一行的底边，用于判断“本行底是否超出当前页”
          for (const ln of lineTops[k]) {
            const lineTop = blockTop + ln.top
            const lineBottom = lineTop + ln.height
            // 若本行底边超出当前页内容区底边 → 需要断到下一页
            while (lineBottom > pageBottomOf(curPage) - 0.5) {
              curPage += 1
            }
            if (curPage > blockPageNo || lineTop < prevLineBottom) {
              // 在该行首插入断点，把它推到 curPage 页内容区顶
              const pos = froms[k] + 1 + ln.offset
              const mt = Math.max(0, pageTopOf(curPage) - lineTop)
              breakMargin.set(pos, mt)
              lineBreaks.add(pos)
              prevLineBottom = pageTopOf(curPage) + ln.height // 断后本行底落到新页
            } else {
              prevLineBottom = lineBottom
            }
          }
          // 块被各断点推下后的实际底部
          const lastMt = 0
          void lastMt
          // 用块自然底 + 该块累计的最大 margin（取最大单个断点 mt 即可近似，因逐行互不重叠）
          let maxMt = 0
          for (const ln of lineTops[k]) {
            const lineTop = blockTop + ln.top
            let pg = blockPageNo
            const lineBottom = lineTop + ln.height
            while (lineBottom > pageBottomOf(pg) - 0.5) pg += 1
            const mt = Math.max(0, pageTopOf(pg) - lineTop)
            if (mt > maxMt) maxMt = mt
          }
          actualTop = blockTop + maxMt
          blockPage[k] = curPage
          contentMaxY = Math.max(contentMaxY, actualTop + blockH)
        }
      }

      // 总页数：由“真实内容最大坐标”映射，而非仅看块页码 ——
      // 保证即使块页码映射有边界误差，第二页纸也必然出现（修复“第二页纸不显示”）。
      const pageCountByContent = Math.max(
        1,
        Math.floor((contentMaxY - m.marginTop) / pageStep) + 1,
      )
      let maxPage = 0
      for (const p of blockPage) if (p > maxPage) maxPage = p
      const pageCount = Math.max(pageCountByContent, maxPage + 1)

      // 注入 decoration：块级断点用 node margin-top，行级断点用 widget margin-top
      const docSize = view.state.doc.content.size
      const decos: Decoration[] = []
      for (const p of blockBreaks) {
        const idx = froms.indexOf(p)
        if (idx < 0) continue
        if (nodes[idx].type.name === 'page_break') continue
        const from = froms[idx]
        const to = from + nodes[idx].nodeSize
        if (to > docSize) continue
        decos.push(
          Decoration.node(from, to, {
            style: 'margin-top: ' + (breakMargin.get(p) || 0) + 'px',
          }),
        )
      }
      for (const p of lineBreaks) {
        // 行级断点位置必须落在文档内部且合法（否则 Decoration 会崩溃导致整个分页失效）
        if (p < 1 || p > docSize) continue
        const mt = breakMargin.get(p) || 0
        decos.push(
          Decoration.widget(
            p,
            () => {
              const s = document.createElement('span')
              s.className = 'pg-linebreak'
              s.style.marginTop = mt + 'px'
              return s
            },
            { side: -1, marks: [] } as any,
          ),
        )
      }

      const cur = paginationKey.getState(view.state) as DecorationSet | null
      const curSig = cur
        ? cur.find().map((d: any) => d.from + ':' + d.to + (d.spec?.widget ? 'w' : '')).join('|')
        : ''
      const newSig = decos
        .map((d: any) => d.from + ':' + d.to + (d.spec?.widget ? 'w' : ''))
        .join('|')
      if (newSig !== curSig) {
        try {
          view.dispatch(
            view.state.tr
              .setMeta(paginationKey, DecorationSet.create(view.state.doc, decos))
              .setMeta('addToHistory', false),
          )
        } catch (e) {
          // 断点位置异常时降级：不应用 decoration，避免整页崩溃（至少正文可见）
          try {
            ;(window as any).go?.main?.App?.LogError?.('PAGINATION_DECO_FAIL ' + String(e))
          } catch { /* ignore */ }
        }
      }

      // 纸张矩形：高度恒为 pageHeightPx，绝对不会因为内容/跨页而变化。
      if (onPages) {
        const rects: PageRect[] = []
        for (let i = 0; i < pageCount; i++) {
          // 纸页顶（含上边距空白）相对编辑器 host 顶 = i*pageStep（content-box 体系下，
          // 第 i 页内容区顶为 i*pageStep，纸页顶比它高 marginTop，但纸页层用 bodyTop+top 定位，
          // bodyTop 已是编辑器 host 顶，故此处直接等于内容区顶偏移，无需再加/减 marginTop）。
          rects.push({ top: pageTopOf(i), height: pageHeightPx })
        }
        const sig = rects.map((r) => Math.round(r.top) + ':' + Math.round(r.height)).join('|')
        if (sig !== lastPageSig) {
          lastPageSig = sig
          onPages(rects)
        }
        onCount(pageCount)
        // 诊断：把真实坐标 dump 到全局变量，供外部脚本只读读取（不触发 wails bridge）
        try {
          ;(window as any).__pg = {
            pageCount,
            pageHeightPx: Math.round(pageHeightPx),
            gap,
            pageStep: Math.round(pageStep),
            per: Math.round(per),
            marginTop: m.marginTop,
            marginBottom: m.marginBottom,
            lineBreaks: lineBreaks.size,
            blockBreaks: blockBreaks.size,
            bodyState: 'see bodyTop elsewhere',
            firstBlockCumTop: Math.round(cumTop[0]),
            firstBlockLineCount: (lineTops[0] || []).length,
            firstBlockH: Math.round(children[0]?.offsetHeight || 0),
            contentMaxY: Math.round(contentMaxY),
            firstBlockLineTops: (lineTops[0] || []).slice(0, 4).map((l) => ({ top: Math.round(l.top), h: Math.round(l.height) })),
            pageRects: rects.map((r) => ({ top: Math.round(r.top), h: Math.round(r.height) })),
            lastLineOfFirstBlock: (lineTops[0] || []).length
              ? (() => {
                  const a = lineTops[0]
                  const ln = a[a.length - 1]
                  return { top: Math.round(ln.top), h: Math.round(ln.height), bottom: Math.round(ln.top + ln.height) }
                })()
              : null,
            bodyTop: (window as any).__bodyTop ? (window as any).__bodyTop.bodyTop : null,
          }
          try {
            const go = (window as any).go?.main?.App
            if (go?.LogError) go.LogError('PAGINATION_DEBUG ' + JSON.stringify((window as any).__pg))
          } catch { /* ignore */ }
        } catch {
          /* ignore */
        }
        if (onBlockPages) {
          const bpsig = blockPage.join(',')
          if (!lastBlockPagesSig || lastBlockPagesSig !== bpsig) {
            lastBlockPagesSig = bpsig
            onBlockPages(blockPage)
          }
        }
      } else {
        onCount(pageCount)
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
