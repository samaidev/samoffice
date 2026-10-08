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
  onPages?: (rects: PageRect[], contentMaxY: number) => void,
  onBlockPages?: (pages: number[]) => void,
) {
  let scheduled = false
  let lastPageSig = ''
  let lastBlockPagesSig = ''
  let lastPgLogSig = ''
  let lastSkipSig = ''
  let lastDocSig = ''
  let lastContentMaxY = 0

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
      // 结构不一致时放弃分页，避免错位。
      // 但必须留下诊断痕迹：NodeView（如 footnote_section）可能在某些状态下改变
      // 顶级 DOM 结构，使本分支持续命中 —— 分页引擎整体“静默死亡”，装饰与纸张层
      // 永久停留旧值（表现为内容/纸张错位且不再更新）。输出 PAGINATION_SKIP 便于定位。
      if (children.length !== topCount) {
        try {
          const skipSig = children.length + '/' + topCount
          if (skipSig !== lastSkipSig) {
            lastSkipSig = skipSig
            const kinds = children.map((c) => (c as HTMLElement).className || (c as HTMLElement).tagName).join(',')
            const goS = (window as any).go?.main?.App
            if (goS?.LogError) goS.LogError('PAGINATION_SKIP dom=' + children.length + ' doc=' + topCount + ' kinds=' + kinds.slice(0, 400))
          }
        } catch { /* ignore */ }
        return
      }

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
      // 子块级可拆：表格按 table_row、列表按 listItem 跨页断开（Word/LibreOffice 语义）。
      // 旧实现把表格/列表当不可拆整块跳页：块底只要放不下当前页就整体推到下一页，
      // 在前一页留下大片空白（用户观感“表格/文献分页不正常”）；高于一页的表格还会
      // 整块溢出下直角。现在按子块拆：能放下的行/条目留在本页，放不下的推到下一页顶。
      const rowSplittable = (name: string) =>
        name === 'table' || name === 'ordered_list' || name === 'bullet_list'

      // 测量阶段：临时把已注入的行级断点 widget margin 归零，
      // 这样读到的 offsetTop 是“纯自然连续坐标”，与上一次应用的 decoration 无关。
      // 注意：这只是读值，分页决策不依赖上一次的结果，因此不存在自反馈。
      dom.classList.add('pg-measuring')

      // 每个顶级块顶部的“自然连续坐标”（相对编辑器内容，不含断页 margin）。
      const cumTop: number[] = children.map((el) => blockTopY(el))

      // 子块几何：table → tbody>tr；list → li。相对块顶的像素（布局像素）。
      // 在 pg-measuring（断点 margin/top 已剔除）下测量，得到纯自然坐标。
      const subTops: { top: number; h: number }[][] = children.map(() => [])
      // 子块文档位置：node.forEach 给出 (child, offset) —— 绝对 from = 块 from + 1 + offset
      const subPos: { pos: number; size: number }[][] = children.map(() => [])
      for (let k = 0; k < K; k++) {
        if (!rowSplittable(nodes[k].type.name)) continue
        const nd = nodes[k]
        nd.forEach((child: any, coff: number) => {
          subPos[k].push({ pos: froms[k] + 1 + coff, size: child.nodeSize })
        })
        const el = children[k]
        const elTop = el.getBoundingClientRect().top
        const z = m.zoom > 0 ? m.zoom : 1
        const rows = nd.type.name === 'table'
          ? Array.from(el.querySelectorAll('tbody > tr'))
          : Array.from(el.querySelectorAll(':scope > li'))
        for (const row of rows as HTMLElement[]) {
          const r = row.getBoundingClientRect()
          subTops[k].push({ top: (r.top - elTop) / z, h: row.offsetHeight })
        }
      }

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
      const breakDetails = new Map<number, { mt: number; landY: number; pg: number }>() // 诊断：断点落点
      const blockPage: number[] = new Array(K).fill(0)
      const actualTops: number[] = new Array(K).fill(0)

      // 记录每个块“被断点推下后”的实际底部坐标，用于最终算出真实内容总高度 → 正确页数
      let contentMaxY = 0
      // 子块级断点（表格行 / 列表条目）与表格位移补高
      const rowBreaks: { pos: number; size: number; mt: number; isTable: boolean }[] = []
      const tablePad = new Map<number, number>()

      // 纯正向一次性计算：runningShift = 前面所有块累计注入的断页推下量。
      // 测量阶段（pg-measuring）已剔除全部断页 margin（块级 .pg-brk + 行级 .pg-linebreak），
      // cumTop 是纯自然坐标；这里沿文档顺序把每个块放到“自然位置 + 前面累计推下”的
      // 渲染坐标上做判定，任何一轮重算都得到完全相同的结果 —— 无自反馈、不震荡。
      // （SUPervisor FIX 2026-10-07：根治块级断点 margin 自反馈导致的 2-cycle 震荡，
      //  即“同一文档分页结果来回跳/静置时 CPU 持续重算/护眼切换后分页行距漂移”。）
      let runningShift = 0
      // 尾部“无文字内容”的连续块豁免断页（Supervisor FIX 2026-10-08）：
      // .doc 导入常在文末产生一串空段落，它们各占一行行高、逐个被断页推挤，
      // 每跨过一页就多出一张空白纸（用户主诉“文本后面大量空白页”）。
      // 这些块不含任何可见文字，豁免它们的断页决策：
      //   - 不产生断点、不进入 runningShift / contentMaxY；
      //   - 紧跟在最后一个有内容块后自然流动，不再撑出空白纸。
      // 遇到显式 page_break 即停止豁免（显式结构是作者意图，必须尊重）。
      const tailTextless = new Set<number>()
      for (let k = K - 1; k >= 0; k--) {
        const nm = nodes[k].type.name
        if (nm === 'page_break') break
        if (rowSplittable(nm) || splittable(nm)) {
          if ((nodes[k].textContent || '').trim().length > 0) break
          tailTextless.add(k)
          continue
        }
        if (nm === 'footnote_section' || nm === 'paragraph') { tailTextless.add(k); continue }
        break
      }
      for (let k = 0; k < K; k++) {
        const name = nodes[k].type.name
        const forceBreak =
          name === 'page_break' || (nodes[k].attrs && (nodes[k].attrs as any).pageBreakBefore)
        const blockTop = cumTop[k] + runningShift
        const blockH = children[k].offsetHeight
        const blockPageNo = pageOf(blockTop)
        // 该块“被推下后”的实际顶部坐标（含已计算的断点 margin，用于底部累计）
        let actualTop = blockTop

        // 尾部无文字块：豁免断页（见上方 tailTextless 注释）
        if (tailTextless.has(k)) {
          blockPage[k] = blockPageNo
          actualTops[k] = blockTop
          continue
        }

        // 零高不可拆块（如 footnote_section：NodeView 把脚注渲染到别处，本块流内高度为 0）：
        // 完全跳过断页决策。这类块的流内 rect 会随 NodeView 锚点轻微波动，
        // 若对其断页，断点会反复加上/移除，形成 2-cycle 震荡（分页结果来回跳、
        // 静置持续重算、boot.log 以 ~2条/秒 膨胀）。零高块不可见，断页毫无意义。
        if (!splittable(name) && !forceBreak && blockH <= 0) {
          blockPage[k] = blockPageNo
          actualTops[k] = blockTop
          continue
        }

        if (rowSplittable(name) && !forceBreak) {
          // 表格 / 列表：按子块（table_row / listItem）跨页拆分。
          // - 列表条目是普通块级 li，Decoration.node 注入 margin-top 即可推到下一页顶；
          //   margin 改变流布局，后续条目自动跟随，无需逐条注入；
          // - 表格行是 table-row，CSS 不接受 margin —— 用 position:relative; top:Npx
          //   视觉位移。relative 只移动自身、不改变后续行布局，因此【断点行及其后
          //   每一行】都必须带上"累计位移"，否则断点行下移后与后续行脱节错位；
          //   最后给 table 注入 margin-bottom = 总位移，补足布局高度，
          //   保证表格后的内容正确下移。
          let subShift = 0
          let firstSubShift = 0
          let renderedSubBottom = blockTop
          let lastSubPage = blockPageNo
          const subs = subTops[k]
          const spos = subPos[k]
          const isTable = name === 'table'
          // rowShift[si] = 第 si 个子块需要携带的累计位移
          const rowShift: number[] = new Array(subs.length).fill(0)
          for (let si = 0; si < subs.length; si++) {
            const st = blockTop + subs[si].top + subShift  // 该子块渲染顶（含更早断点位移）
            const sh = Math.min(subs[si].h, per)           // 单行/单条目高钳制，防测量异常连锁
            const sb = st + sh
            let pg = pageOf(st)
            while (sb > pageBottomOf(pg) - 0.5) pg += 1
            lastSubPage = pg
            if (pg > pageOf(st)) {
              // 真正跨页：该子块推到 pg 页内容区顶
              const mt = Math.max(0, pageTopOf(pg) - st)
              const info = spos[si]
              if (info && mt > 0) {
                breakDetails.set(info.pos, { mt, landY: st + mt, pg })
              }
              subShift += mt
              if (firstSubShift === 0) firstSubShift = mt
              renderedSubBottom = pageTopOf(pg) + sh
            } else {
              renderedSubBottom = sb
            }
            rowShift[si] = subShift
          }
          // 注入子块装饰
          for (let si = 0; si < subs.length; si++) {
            const info = spos[si]
            if (!info) continue
            if (isTable) {
              // 表格行：累计位移 > 0 的每一行都要 relative top（跟随断点行）
              if (rowShift[si] > 0) {
                rowBreaks.push({ pos: info.pos, size: info.size, mt: rowShift[si], isTable: true })
              }
            } else {
              // 列表条目：只给发生跨页的条目注入 margin-top 增量
              const prev = si > 0 ? rowShift[si - 1] : 0
              const inc = rowShift[si] - prev
              if (inc > 0) {
                rowBreaks.push({ pos: info.pos, size: info.size, mt: inc, isTable: false })
              }
            }
          }
          if (subs.length === 0) {
            // 无子块（异常结构）：退化为整块处理，保证内容底计入
            renderedSubBottom = blockTop + blockH
          }
          runningShift += subShift
          actualTop = blockTop + firstSubShift
          blockPage[k] = lastSubPage
          contentMaxY = Math.max(contentMaxY, renderedSubBottom)
          if (isTable && subShift > 0) {
            tablePad.set(froms[k], subShift)
          }
        } else if (forceBreak || !splittable(name)) {
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
              // 应用补偿：Decoration 的内联 margin-top 会【替换】块自身的自然上边距
              // （与上一块 margin-bottom 折叠后的 g），而不是叠加。若只注入 mt，
              // 实际落点比模型高 g（实测 page_break 每个少 16px、表格少 12px），
              // 且每个块级断点累计一次 g，多页文档误差持续增长。
              // g = 块自然顶 - 上一块自然底（纯自然坐标，pg-measuring 下测量，无反馈）。
              const prevNatBottom = k > 0 ? cumTop[k - 1] + children[k - 1].offsetHeight : 0
              const natGap = Math.max(0, cumTop[k] - prevNatBottom)
              breakMargin.set(froms[k], mt + natGap)
              blockBreaks.add(froms[k])
            }
            breakDetails.set(froms[k], { mt, landY: blockTop + mt, pg: targetPage })
            actualTop = blockTop + mt
            runningShift += mt
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
          //
          // 修复（2026-10-07）：旧实现里 curPage 从 blockPageNo 起步、条件用
          // curPage > blockPageNo，导致“首行一旦跨页，后续所有行都被误判为跨页断行”，
          // 整段被堆到一个页顶，块高又按整块计，第二页起内容溢出下直角。
          // 现改为：每行从“上一行所在页”继续，仅当本行底边真正超出当前页底时才
          // 断到下一页；块视觉顶 = 块自然顶 + 首个断点行的推下量；内容底 = 最后一行
          // 渲染底（不是整块高度）。
          let prevLinePage = blockPageNo // 上一行所在页
          let cumShift = 0              // 块内已插入断点的累计推下量：widget margin 生效后，
                                        // 断点行及其后所有行都被推下，后续行的
                                        // “渲染坐标” = 自然坐标 + cumShift。
                                        // （SUPervisor PATCH 2026-10-07：修复多断块残留溢出）
          let firstBreakShift = 0       // 首个断点造成的块整体推下量（视觉顶偏移，诊断用）
          let renderedBottom = blockTop // 最后一行渲染后的底边（含 cumShift）
          for (const ln of lineTops[k]) {
            const lineTop = blockTop + ln.top + cumShift // 行“渲染顶”（含更早断点推下）
            const lineBottom = lineTop + ln.height       // 行渲染底
            // 本行落在哪一页：从上一行所在页继续，渲染行底超出当前页底则向后找
            let pg = prevLinePage
            while (lineBottom > pageBottomOf(pg) - 0.5) {
              pg += 1
            }
            if (pg > prevLinePage) {
              // 真正跨页：在该行首插入断点，推到 pg 页内容区顶。
              // margin 只需补“页顶 - 当前渲染顶”的增量差；
              // 若按自然坐标算，块内第二个及以后的断点会把内容
              // 多推 cumShift，整段滑出页底下直角（多断块溢出根因）。
              const pos = froms[k] + 1 + ln.offset
              const mt = Math.max(0, pageTopOf(pg) - lineTop)
              if (mt > 0) {
                breakMargin.set(pos, mt)
                lineBreaks.add(pos)
              }
              breakDetails.set(pos, { mt, landY: lineTop + mt, pg })
              if (firstBreakShift === 0) firstBreakShift = mt
              cumShift += mt
              renderedBottom = pageTopOf(pg) + ln.height
            } else {
              renderedBottom = lineBottom
            }
            prevLinePage = pg
          }
          // 本块内部注入的全部行级推下量并入全局累计，后续块从正确位置起算
          runningShift += cumShift
          actualTop = blockTop + firstBreakShift
          blockPage[k] = prevLinePage
          contentMaxY = Math.max(contentMaxY, renderedBottom)
        }
        actualTops[k] = actualTop
      }

      // 防瞬态测量异常（Supervisor FIX 2026-10-08）：
      // 字体加载/NodeView 抖动等瞬态会把某轮 contentMaxY 抬高一大截（虚增页数 →
      // 渲染出整页空白的“幽灵纸”）。文档未变时若 contentMaxY 突变超过一页步长，
      // 沿用上一轮的稳定值；文档变化（docSig 变）时总是接受新值。
      const docSig = view.state.doc.content.size + ':' + K
      if (docSig === lastDocSig && lastContentMaxY > 0 &&
          Math.abs(contentMaxY - lastContentMaxY) > pageStep * 1.5) {
        contentMaxY = lastContentMaxY
      } else {
        lastContentMaxY = contentMaxY
        lastDocSig = docSig
      }

      // 总页数：由“真实内容最大坐标”映射，而非仅看块页码 ——
      // 保证即使块页码映射有边界误差，第二页纸也必然出现（修复“第二页纸不显示”）。
      // contentMaxY 与 pageTopOf 同为“内容盒坐标系”（页 n 内容区顶 = n*pageStep），
      // 因此直接除以步长，不再减 marginTop（旧公式双重扣除，临界处少算一页）。
      const pageCountByContent = Math.max(
        1,
        Math.floor(contentMaxY / pageStep) + 1,
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
        // 关键修复（2026-10-08）：page_break 节点同样要应用 margin-top！
        // 旧代码在此 skip 掉 page_break，导致其判定出的推下量（如 mt=675）
        // 只进了 runningShift 模型、从不落到 DOM —— 自第一个显式分页符起，
        // 渲染整体比模型上浮 675px，且每个分页符再累计一次（三个分页符即 2090px）。
        // 表现：分页符之后的所有内容整体“浮”到纸张上方，大量文本落在两页之间的
        // 空隙里、压进页边距，且越往后越严重。
        // page_break 节点是普通流内块（h=37 的标记条），margin-top 语义与其它块一致：
        // 把标记条本身推到新页内容区顶，其后内容从新页顶部顺排。
        const from = froms[idx]
        const to = from + nodes[idx].nodeSize
        if (to > docSize) continue
        // 块节点的原生 inline style（table 的 border-collapse/对齐、page_break 的提示线等）
        // 必须保留：Decoration.node 的 attrs.style 是整体替换语义，先读后拼接。
        const oldStyle = (children[idx].getAttribute('style') || '').replace(/;\s*$/, '')
        decos.push(
          Decoration.node(from, to, {
            style: (oldStyle ? oldStyle + ';' : '') + 'margin-top: ' + (breakMargin.get(p) || 0) + 'px',
            class: 'pg-brk',
          }),
        )
      }
      for (const rb of rowBreaks) {
        // 子块级断点：表格行用 relative top（table-row 不接受 margin），
        // 列表条目用 margin-top（li 是普通块级盒）。
        if (rb.pos < 1 || rb.pos + rb.size > docSize) continue
        if (rb.isTable) {
          decos.push(
            Decoration.node(rb.pos, rb.pos + rb.size, {
              style: 'position: relative; top: ' + rb.mt + 'px',
              class: 'pg-brk-row',
            }),
          )
        } else {
          decos.push(
            Decoration.node(rb.pos, rb.pos + rb.size, {
              style: 'margin-top: ' + rb.mt + 'px',
              class: 'pg-brk',
            }),
          )
        }
      }
      for (const [tpos, pad] of tablePad) {
        // 表格行位移不改变布局高度：给 table 注入 margin-bottom 补足，
        // 使表格后的内容从正确的（推下后的）位置继续排布。
        // table 自带 inline style（border-collapse / 对齐 margin），
        // Decoration.node 的 style 会整体替换 —— 必须拼接原 style，不能覆盖。
        const idx = froms.indexOf(tpos)
        if (idx < 0) continue
        if (tpos < 1 || tpos + nodes[idx].nodeSize > docSize) continue
        const oldStyle = (children[idx].getAttribute('style') || '').replace(/;\s*$/, '')
        decos.push(
          Decoration.node(tpos, tpos + nodes[idx].nodeSize, {
            style: (oldStyle ? oldStyle + ';' : '') + 'margin-bottom: ' + pad + 'px',
            class: 'pg-brk-table',
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
      // 签名必须包含 style（margin/top 值）：子块断点的 pos 集合可能稳定而 mt 微调
      // （前面块高度变化），只比 from/to 会漏发 dispatch → 模型与渲染脱节。
      const decoSig = (d: any) =>
        d.from + ':' + d.to + ':' + ((d.attrs && d.attrs.style) || '') + (d.spec?.widget ? 'w' : '')
      const curSig = cur ? cur.find().map(decoSig).join('|') : ''
      const newSig = decos.map(decoSig).join('|')
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

      // 渲染真值转储：仅在分页签名变化时输出一次（延迟 250ms 等 ProseMirror
      // 完成新 decoration 的渲染），供“模型 vs 渲染”精确对账。
      // 空闲时外部周期性事务会触发重算但签名不变 —— 此时绝不输出，防止日志膨胀。
      try {
        const nowMs = Date.now()
        if (newSig !== lastPgLogSig && nowMs - ((window as any).__lastRenderDumpTs || 0) > 1500) {
          ;(window as any).__lastRenderDumpTs = nowMs
          const dumpRender = () => {
          const z = m.zoom > 0 ? m.zoom : 1
          const dRect = dom.getBoundingClientRect()
          const papers = Array.from(document.querySelectorAll('.pg-paper')).map((n: any) => {
            const r = n.getBoundingClientRect()
            return { top: Math.round(r.top), h: Math.round(r.height), inFlowTop: Math.round((r.top - dRect.top) / z) }
          })
          const container = papers.length ? (document.querySelector('.pg-paper') as HTMLElement)?.parentElement : null
          const widgets = Array.from(dom.querySelectorAll('.pg-linebreak')).slice(0, 50).map((n: any) => {
            const r = n.getBoundingClientRect()
            const cs = getComputedStyle(n)
            return { mt: parseFloat(cs.marginTop) || 0, disp: cs.display, h: Math.round(r.height), inFlowTop: Math.round((r.top - dRect.top) / z) }
          })
          const blocksR = children.slice(0, 80).map((el, k) => {
            const r = el.getBoundingClientRect()
            return { i: k, t: nodes[k].type.name, inFlowTop: Math.round((r.top - dRect.top) / z), h: Math.round(el.offsetHeight) }
          })
          const go2 = (window as any).go?.main?.App
          if (go2?.LogError) go2.LogError('PAGINATION_RENDER ' + JSON.stringify({
            domTop: Math.round(dom.getBoundingClientRect().top), zoom: z,
            containerTop: container ? Math.round(container.getBoundingClientRect().top) : -1,
            bodyTop: (window as any).__bodyTop || null,
            papers, widgets, blocksR,
          }))
          }
          setTimeout(dumpRender, 250)
        }
      } catch { /* ignore */ }

      // 纸张矩形：高度恒为 pageHeightPx，绝对不会因为内容/跨页而变化。
      if (onPages) {
        const rects: PageRect[] = []
        for (let i = 0; i < pageCount; i++) {
          // 纸页顶（含上边距空白）相对编辑器 host 顶 = i*pageStep（content-box 体系下，
          // 第 i 页内容区顶为 i*pageStep，纸页顶比它高 marginTop，但纸页层用 bodyTop+top 定位，
          // bodyTop 已是编辑器 host 顶，故此处直接等于内容区顶偏移，无需再加/减 marginTop）。
          rects.push({ top: pageTopOf(i), height: pageHeightPx })
        }
        // lastPageSig 同时包含 contentMaxY： maxY 微调而纸张数不变时也要回报 React，
        // 否则纸张过滤层停留旧值（可见纸张集合与内容脱节）。
        const sig = rects.map((r) => Math.round(r.top) + ':' + Math.round(r.height)).join('|') +
          '#y' + Math.round(contentMaxY)
        if (sig !== lastPageSig) {
          lastPageSig = sig
          onPages(rects, contentMaxY)
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
            rowBreaks: rowBreaks.length,
            tailTextless: tailTextless.size,
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
            // 逐块明细：类型/自然顶/自然底/所在页/实际顶/实际底（用于诊断第二页及之后的分页）
            blocks: children.map((el, k) => ({
              type: nodes[k].type.name,
              top: Math.round(cumTop[k]),
              h: Math.round(el.offsetHeight || 0),
              page: blockPage[k],
              actualTop: Math.round(actualTops[k]),
              actualBottom: Math.round(actualTops[k] + el.offsetHeight),
              pv: ((nodes[k].textContent || '').trim().slice(0, 10)),
            })),
            lineBreakPositions: [...lineBreaks].slice(0, 200),
            blockBreakPositions: [...blockBreaks].slice(0, 200),
            breakDetails: [...breakDetails.entries()].slice(0, 120).map(([p, v]) => ({ pos: p, mt: Math.round(v.mt), landY: Math.round(v.landY), pg: v.pg })),
            domProbe: (() => {
              try {
                const host = dom.parentElement
                const paper = document.querySelector('.pg-paper')
                const hostPad = host ? parseFloat(getComputedStyle(host).paddingTop) || 0 : -1
                return {
                  hostPadTop: hostPad,
                  domTop: Math.round(dom.getBoundingClientRect().top),
                  hostTop: host ? Math.round(host.getBoundingClientRect().top) : -1,
                  firstPaperTop: paper ? Math.round(paper.getBoundingClientRect().top) : -1,
                  firstBlockTop: Math.round(children[0].getBoundingClientRect().top),
                }
              } catch { return null }
            })(),
            blockPageArr: blockPage,
            pageBottomRects: Array.from({ length: pageCount }, (_, i) => ({
              top: Math.round(pageTopOf(i)),
              contentBottom: Math.round(pageBottomOf(i)),
            })),
          }
          // 仅在装饰签名变化（分页结果真正变化）时写诊断日志，
          // 避免外部周期性事务触发重算时以 ~2次/秒 持续膨胀 boot.log。
          // （SUPervisor PATCH 2026-10-07）
          try {
            if (newSig !== lastPgLogSig) {
              lastPgLogSig = newSig
              const go = (window as any).go?.main?.App
              if (go?.LogError) go.LogError('PAGINATION_DEBUG ' + JSON.stringify((window as any).__pg))
            }
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
