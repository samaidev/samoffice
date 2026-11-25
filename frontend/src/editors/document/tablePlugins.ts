// 表格交互增强（对齐 MS Word）：
// 1. DocTableView —— 表格 NodeView（div.tableWrapper > table > colgroup + tbody），
//    支持固定列宽（colgroup/td width + table-layout:fixed），并承载左上角全选手柄。
//    （结构对齐 prosemirror-tables TableView：wrapper 是分页装饰 pg-brk-table 的落点，
//      tbody 是分页引擎按 tbody>tr 测量的依赖。）
// 2. 左上角 ⊞ 手柄：悬停表格时出现（CSS hover 控制），点击全选整个表格
//    （CellSelection 覆盖全部单元格，视觉与 Word 全选一致）。
// 3. createTableDragResizePlugin —— 拖拽竖直边框调列宽、水平边框调行高：
//    悬停边框时光标变为 col-resize / row-resize，按下实时跟随、松开一次性提交事务。
// 4. autoFitTable —— 自动调整：根据内容调整表格 / 根据窗口调整表格 / 固定列宽。
import { Plugin } from 'prosemirror-state'
import { Node as PMNode, Fragment } from 'prosemirror-model'
import { CellSelection } from 'prosemirror-tables'
import type { EditorView } from 'prosemirror-view'

const CELL_MIN_W = 24   // 列最小宽度（px）
const ROW_MIN_H = 24    // 行最小高度（px）
const EDGE_TOLERANCE = 4 // 边框命中容差（布局 px）

// ============ 表格网格模型 ============

interface GridCell { from: number; to: number; colspan: number; width: number }
interface TableGrid {
  cols: number
  colWidths: (number | null)[]
}

/** 从表格节点构建网格列宽（首行单元格 colwidth 均摊到其跨越的网格列；null = 自动）。 */
function buildGrid(table: PMNode): TableGrid {
  let cols = 0
  const firstRow = table.childCount > 0 ? table.child(0) : null
  if (firstRow) {
    let c = 0
    firstRow.forEach((cell: PMNode) => { c += cell.attrs.colspan || 1 })
    cols = Math.max(cols, c)
  }
  // 兜底：其它行可能更宽（异常结构）
  table.forEach((row: PMNode) => {
    let c = 0
    row.forEach((cell: PMNode) => { c += cell.attrs.colspan || 1 })
    cols = Math.max(cols, c)
  })
  const colWidths: (number | null)[] = new Array(cols).fill(null)
  if (firstRow) {
    let g = 0
    firstRow.forEach((cell: PMNode) => {
      const cs = cell.attrs.colspan || 1
      const w = Number(cell.attrs.colwidth) || 0
      if (w > 0) {
        const per = w / cs
        for (let k = 0; k < cs && g + k < cols; k++) colWidths[g + k] = per
      }
      g += cs
    })
  }
  return { cols, colWidths }
}

// ============ NodeView（div.tableWrapper 包裹 + colgroup + 全选手柄） ============

/**
 * 表格 NodeView：与 prosemirror-tables TableView 等价的包装结构。
 * - wrapper div（pagination 的 pg-brk-table / margin 补高装饰落点 + 手柄容器）
 * - colgroup（固定列宽模式驱动 table-layout:fixed）
 * - tbody 作为 contentDOM（HTML 合法性 + 分页引擎按 tbody>tr 测量依赖）
 */
export class DocTableView {
  node: PMNode
  dom: HTMLElement
  contentDOM: HTMLElement
  table: HTMLTableElement
  colgroup: HTMLElement
  view: EditorView
  getPos: () => number | undefined
  private destroyFn: (() => void) | null = null

  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node
    this.view = view
    this.getPos = getPos
    this.dom = document.createElement('div')
    this.dom.className = 'tableWrapper'
    this.table = document.createElement('table')
    this.dom.appendChild(this.table)
    this.colgroup = document.createElement('colgroup')
    this.table.appendChild(this.colgroup)
    this.contentDOM = document.createElement('tbody')
    this.table.appendChild(this.contentDOM)
    this.syncAttrs(node)
    this.attachHandle()
    this.attachResizeHandle()
  }

  /** 应用 table 节点属性到 <table>（与 schema.table.toDOM 同源）。
   * round64 修复（用户报告：表格无法拖边框调行高列宽）：
   * 旧实现 style.cssText = ... 全量覆写 —— 拖边框插件在 table 上设置的
   * cursor（col-resize/row-resize）随任何 NodeView update() 被清掉
   * （拖拽/对齐等任何事务都触发 update），光标闪烁/消失，用户感知
   * 「拖不动」。改为逐属性赋值：cursor 等运行时状态与布局属性解耦。 */
  private syncAttrs(node: PMNode) {
    const align = node.attrs.align
    const st = this.table.style
    st.borderCollapse = 'collapse'
    st.margin = '8px 0'
    if (align === 'center') { st.marginLeft = 'auto'; st.marginRight = 'auto' }
    else if (align === 'right') { st.marginLeft = 'auto'; st.marginRight = '' }
    else if (align === 'left') { st.marginRight = 'auto'; st.marginLeft = '' }
    else { st.marginLeft = ''; st.marginRight = '' }
    const grid = buildGrid(node)
    const allW = grid.cols > 0 && grid.colWidths.every((w) => (w || 0) > 0)
    if (allW) {
      const sum = grid.colWidths.reduce((a: number, w) => a + (w || 0), 0)
      if (sum > 0) { st.tableLayout = 'fixed'; st.width = Math.round(sum) + 'px' }
    } else {
      st.tableLayout = ''; st.width = ''
    }
    if (!this.table.classList.contains('pm-table')) this.table.classList.add('pm-table')
    this.table.setAttribute('data-align', (align || 'left') as string)
    this.syncColgroup(grid, allW)
  }

  private syncColgroup(grid: TableGrid, allW: boolean) {
    if (!allW) {
      if (this.colgroup.childElementCount) this.colgroup.innerHTML = ''
      return
    }
    while (this.colgroup.childElementCount < grid.cols) this.colgroup.appendChild(document.createElement('col'))
    while (this.colgroup.childElementCount > grid.cols) this.colgroup.removeChild(this.colgroup.lastChild as Element)
    Array.from(this.colgroup.children).forEach((col: Element, i: number) => {
      ;(col as HTMLElement).style.width = Math.round(grid.colWidths[i] || 0) + 'px'
    })
  }

  /**
   * round64：右下角整体缩放手柄（用户报告：表格无法调整整体大小）。
   * 悬停表格显示（同手柄显示条件），拖动改变表格【总宽】——列宽按当前
   * 比例分配（Word 拖右下角控点的语义：等比缩放，不改变列宽比）。
   * 高度不锁定：行高由内容决定，拖动仅改宽度。拖动中 rAF 提交
   * （addToHistory:false），松开一次正式提交（一步撤销）。
   */
  private attachResizeHandle() {
    const rh = document.createElement('div')
    rh.className = 'pm-table-resize'
    rh.setAttribute('contenteditable', 'false')
    rh.title = '拖动调整表格整体大小'
    rh.style.cssText = 'position:absolute;width:10px;height:10px;background:#2563eb;border:2px solid #fff;border-radius:2px;cursor:nwse-resize;z-index:20;display:none;pointer-events:auto'
    const host = this.view.dom.parentElement
    if (!host) { this.dom.appendChild(rh); return }
    host.appendChild(rh)
    // 与全选手柄共用几何同步节流（表格位置变化时跟随右下角）
    let syncRaf = 0
    const syncPos = () => {
      if (syncRaf) return
      syncRaf = requestAnimationFrame(() => {
        syncRaf = 0
        if (!rh.isConnected || !this.dom.isConnected) return
        const tr2 = this.table.getBoundingClientRect()
        const hr = host.getBoundingClientRect()
        rh.style.left = (tr2.right - hr.left - 5) + 'px'
        rh.style.top = (tr2.bottom - hr.top - 5) + 'px'
        rh.style.display = rh.classList.contains('pm-shown') ? 'block' : 'none'
      })
    }
    const ro = new ResizeObserver(syncPos)
    ro.observe(this.table)
    const scheduleSync = () => syncPos()
    window.addEventListener('resize', scheduleSync)
    const scrollRoot = this.view.dom.closest('.overflow-auto')
    scrollRoot?.addEventListener('scroll', scheduleSync, { passive: true })
    // 显示管理：表格悬停显示（与全选手柄一致），离开隐藏 —— 同样走
    // pm-shown 类；resize 手柄与全选手柄互不干扰（不同元素）。
    let hideTimer = 0
    const show = () => {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = 0 }
      rh.classList.add('pm-shown')
      syncPos()
    }
    const scheduleHide = () => {
      if (hideTimer) clearTimeout(hideTimer)
      hideTimer = window.setTimeout(() => { hideTimer = 0; rh.classList.remove('pm-shown'); syncPos() }, 180)
    }
    this.dom.addEventListener('mouseenter', show)
    this.dom.addEventListener('mouseleave', scheduleHide)
    this.table.addEventListener('mouseenter', show)
    this.table.addEventListener('mouseleave', scheduleHide)
    rh.addEventListener('mouseenter', show)
    rh.addEventListener('mouseleave', scheduleHide)
    // document 级几何兜底（与全选手柄 onDocMove 同法）：mouseenter 链在
    // 分步移动/触屏下不完整 —— 按坐标判定表格包围盒 ±26px 热区显示。
    const onDocMove = (e: MouseEvent) => {
      const r = this.table.getBoundingClientRect()
      const inTable = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
      const inCorner = e.clientX >= r.right - 26 && e.clientX <= r.right + 26 && e.clientY >= r.bottom - 26 && e.clientY <= r.bottom + 26
      const inHandle = (() => { const hr = rh.getBoundingClientRect(); return e.clientX >= hr.left && e.clientX <= hr.right && e.clientY >= hr.top && e.clientY <= hr.bottom })()
      if (inTable || inCorner || inHandle) show()
      else if (rh.classList.contains('pm-shown')) scheduleHide()
    }
    window.document.addEventListener('mousemove', onDocMove)

    rh.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const startX = e.clientX
      const startW = this.table.getBoundingClientRect().width
      const zoomRatio = Math.max(0.1, (window as any).__docZoom || 1)
      let pending = 0
      let raf = 0
      const commit = () => {
        raf = 0
        if (!pending) return
        const w = pending
        const pos = this.getPos()
        if (pos === undefined || pos < 0) return
        const node = this.view.state.doc.nodeAt(pos)
        if (!node) return
        const grid = buildGrid(node)
        // 未固化列宽：先按当前渲染比例初始化，再缩放
        let widths: number[] = []
        const allSet = grid.colWidths.length > 0 && grid.colWidths.every((c) => (c || 0) > 0)
        if (allSet) {
          const sum = grid.colWidths.reduce((a: number, b: number | null) => a + (b || 0), 0)
          widths = grid.colWidths.map((c) => Math.round((c || 0) * w / sum))
        } else {
          const firstRow = this.table.rows[0]
          if (!firstRow) return
          const tRect = this.table.getBoundingClientRect()
          let prev = 0
          let g = 0
          for (const td of Array.from(firstRow.cells)) {
            const cs = parseInt(td.getAttribute('colspan') || '1', 10) || 1
            const r = td.getBoundingClientRect()
            const right = (r.right - tRect.left) / zoomRatio
            const cw = Math.max(CELL_MIN_W, Math.round(right - prev))
            for (let k = 0; k < cs && g + k < grid.cols; k++) widths[g + k] = cw
            prev = right
            g += cs
          }
          const sumW = widths.reduce((a, b) => a + (b || 0), 0)
          widths = widths.map((c) => Math.max(CELL_MIN_W, Math.round((c || CELL_MIN_W) * w / (sumW || w))))
        }
        // 末列吸收取整误差
        const diff = Math.round(w - widths.reduce((a, b) => a + (b || 0), 0))
        if (widths.length) widths[widths.length - 1] = Math.max(CELL_MIN_W, widths[widths.length - 1] + diff)
        const tr3 = this.view.state.tr
        let rowOff = pos + 1
        node.forEach((row: PMNode) => {
          let cellOff = rowOff + 1
          let c = 0
          row.forEach((cell: PMNode) => {
            const cs = cell.attrs.colspan || 1
            let cw = 0
            for (let k = 0; k < cs; k++) cw += widths[c + k] || 0
            if (cw > 0) tr3.setNodeMarkup(cellOff, undefined, { ...cell.attrs, colwidth: Math.max(CELL_MIN_W, Math.round(cw)) }, [])
            c += cs
            cellOff += cell.nodeSize
          })
          rowOff += row.nodeSize
        })
        this.view.dispatch(tr3.setMeta('addToHistory', false))
      }
      const onMove = (ev: MouseEvent) => {
        const dw = (ev.clientX - startX) / zoomRatio
        pending = Math.max(3 * CELL_MIN_W, Math.round(startW + dw))
        if (!raf) raf = requestAnimationFrame(commit)
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        if (raf) cancelAnimationFrame(raf)
        raf = 0
        // 最终提交（进历史）：把 pending 置 0 前再 commit 一次正式事务
        const w = pending
        pending = 0
        if (w > 0) {
          const pos = this.getPos()
          if (pos !== undefined && pos >= 0) {
            const node = this.view.state.doc.nodeAt(pos)
            if (node) {
              const tr3 = this.view.state.tr
              // 用最后一次视觉宽度重建 widths（与 commit 同算法，正式入历史）
              const firstRow = this.table.rows[0]
              const grid = buildGrid(node)
              let widths: number[] = []
              const allSet = grid.colWidths.length > 0 && grid.colWidths.every((c) => (c || 0) > 0)
              if (allSet) {
                const sum = grid.colWidths.reduce((a: number, b: number | null) => a + (b || 0), 0)
                widths = grid.colWidths.map((c) => Math.round((c || 0) * w / sum))
              } else if (firstRow) {
                const tRect = this.table.getBoundingClientRect()
                let prev = 0
                let g = 0
                for (const td of Array.from(firstRow.cells)) {
                  const cs = parseInt(td.getAttribute('colspan') || '1', 10) || 1
                  const r = td.getBoundingClientRect()
                  const right = (r.right - tRect.left) / zoomRatio
                  const cw = Math.max(CELL_MIN_W, Math.round(right - prev))
                  for (let k = 0; k < cs && g + k < grid.cols; k++) widths[g + k] = cw
                  prev = right
                  g += cs
                }
                const sumW = widths.reduce((a, b) => a + (b || 0), 0)
                widths = widths.map((c) => Math.max(CELL_MIN_W, Math.round((c || CELL_MIN_W) * w / (sumW || w))))
              }
              const diff = Math.round(w - widths.reduce((a, b) => a + (b || 0), 0))
              if (widths.length) widths[widths.length - 1] = Math.max(CELL_MIN_W, widths[widths.length - 1] + diff)
              let rowOff = pos + 1
              node.forEach((row: PMNode) => {
                let cellOff = rowOff + 1
                let c = 0
                row.forEach((cell: PMNode) => {
                  const cs = cell.attrs.colspan || 1
                  let cw = 0
                  for (let k = 0; k < cs; k++) cw += widths[c + k] || 0
                  if (cw > 0) tr3.setNodeMarkup(cellOff, undefined, { ...cell.attrs, colwidth: Math.max(CELL_MIN_W, Math.round(cw)) }, [])
                  c += cs
                  cellOff += cell.nodeSize
                })
                rowOff += row.nodeSize
              })
              this.view.dispatch(tr3)
            }
          }
        }
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    })

    const prevDestroy = this.destroyFn
    this.destroyFn = () => {
      try { prevDestroy?.() } catch { /* */ }
      if (hideTimer) clearTimeout(hideTimer)
      if (syncRaf) cancelAnimationFrame(syncRaf)
      window.removeEventListener('resize', scheduleSync)
      scrollRoot?.removeEventListener('scroll', scheduleSync)
      window.document.removeEventListener('mousemove', onDocMove)
      ro.disconnect()
      rh.remove()
    }
  }

  update(node: PMNode): boolean {
    if (node.type.name !== 'table') return false
    this.node = node
    this.syncAttrs(node)
    return true
  }

  /**
   * round64 修复（用户报告：表格无法拖边框调行高列宽）：
   * PM 的 DOM Observer 监听到 <table> 上 class/attribute 变化（拖拽插件
   * 写入 pm-col-resize / pm-row-resize 光标类）时，默认视为【外部 DOM 篡改】
   * —— 触发 view desc 重建，<table> 元素被整体替换，刚写入的 class 丢失，
   * 拖拽光标/拖拽会话瞬间失效（探针实测：class 写入成功 → 500ms 内元素
   * 换新）。ignoreMutation 告知 PM：本 NodeView 自有属性（class/style/
   * colgroup 变化）都在掌控内，不要重建。这是自定义 NodeView 的 PM 标准
   * 义务（TableView 原版未覆盖 —— 其列宽走 col attrs 由 PM 同步）。
   */
  ignoreMutation(mutation: any): boolean {
    if (mutation.type === 'childList' && mutation.target === this.contentDOM) return false // 内容编辑走 PM 正常流程
    if (mutation.type === 'attributes' && mutation.target === this.table) return true // class/style/colgroup 自有属性
    if (mutation.type === 'attributes') return true // wrapper 上的装饰属性（分页 pg-brk 等）
    return mutation.type !== 'childList' || !this.dom.contains(mutation.target)
  }

  /** 左上角全选/移动手柄（对齐 MS Word 表格移动十字柄）：悬停表格时出现。
   * round39 修复两项用户反馈：
   * a) "点击无效" —— 手柄（z-index:20）被 pm-table-clickbridge 接收层
   *    （盖在表格几何上、z-index:7，但层挂 pm-host 直属且手柄在 wrapper 内
   *    合成器死区）拦截，mousedown 到不了手柄。修法：手柄 mousedown 里
   *    stopPropagation 已不够 —— 改为手柄自身提到 host 直属层（脱离死区），
   *    由 NodeView 几何同步定位（与桥层同法，r34_probe16 直属路径 hit-test 正常）。
   * b) "不能按住拖动移动表格" —— 新增拖拽会话：按住手柄移动（>5px 阈值）
   *    显示段落插入指示线，松开把整个表格移动到目标段落前后。
   * 悬停稳定性（修复"移动上去就消失"）：
   * 1. 手柄部分重叠表格左上角（一半在表内），鼠标从表格内部移向手柄
   *    的路径连续覆盖——经几何判定维持显示。
   * 2. JS 驱动可见性（pm-shown 类）：分页装饰会整体重写 wrapper 的
   *    class/style，挂在 wrapper 上的状态类会被冲掉。document mousemove
   *    按表格包围盒判定：在表内或左上角 26px 热区 → 显示；离开 → 180ms
   *    宽限后隐藏（鼠标斜向移动不闪烁）。 */
  private attachHandle() {
    const h = document.createElement('div')
    h.className = 'pm-table-handle'
    h.setAttribute('contenteditable', 'false')
    h.setAttribute('title', '点击全选表格；按住拖动移动表格')
    h.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 0 L8 2.2 H4 Z M6 12 L4 9.8 H8 Z M0 6 L2.2 4 V8 Z M12 6 L9.8 8 V4 Z" fill="currentColor"/><rect x="4.6" y="4.6" width="2.8" height="2.8" fill="currentColor"/></svg>'
    // round39：手柄脱离 wrapper（合成器死区），挂到 view.dom.parentElement（pm-host）
    // 直属 —— 与桥层同路径（r34_probe16 实锤可命中）。NodeView 销毁时移除。
    const host = this.view.dom.parentElement
    if (!host) { this.dom.appendChild(h); return }
    // 几何同步：手柄贴表格左上角（视觉同旧版：左移 9px 上移 1px）。
    // 每帧同步太贵 —— 滚动/resize/MutationObserver 三路触发 rAF 节流同步。
    let syncRaf = 0
    const syncPos = () => {
      if (syncRaf) return
      syncRaf = requestAnimationFrame(() => {
        syncRaf = 0
        if (!h.isConnected || !this.dom.isConnected) return
        const tr = this.table.getBoundingClientRect()
        const hr = host.getBoundingClientRect()
        h.style.left = (tr.left - hr.left - 9) + 'px'
        h.style.top = (tr.top - hr.top - 1) + 'px'
      })
    }
    const ro = new ResizeObserver(syncPos)
    ro.observe(this.table)
    const scheduleSync = () => syncPos()
    window.addEventListener('resize', scheduleSync)
    const scrollRoot = this.view.dom.closest('.overflow-auto')
    scrollRoot?.addEventListener('scroll', scheduleSync, { passive: true })
    host.appendChild(h)
    syncPos()
    // JS 悬停管理：宽限期隐藏，悬停手柄即续期
    let hideTimer = 0
    const show = () => {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = 0 }
      h.classList.add('pm-shown')
    }
    const scheduleHide = () => {
      if (hideTimer) clearTimeout(hideTimer)
      hideTimer = window.setTimeout(() => { hideTimer = 0; h.classList.remove('pm-shown') }, 180)
    }
    this.dom.addEventListener('mouseenter', show)
    this.dom.addEventListener('mouseleave', scheduleHide)
    h.addEventListener('mouseenter', show)
    h.addEventListener('mouseleave', scheduleHide)
    this.table.addEventListener('mouseenter', show)
    this.table.addEventListener('mouseleave', scheduleHide)
    // document 级兜底：wrapper class 被装饰重写/重建时 hover 判定仍可靠（按几何而非类名）
    const onDocMove = (e: MouseEvent) => {
      const r = this.table.getBoundingClientRect()
      const inTable = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
      // 左上角热区：容忍鼠标在表格外侧朝手柄移动
      const inCorner = e.clientX >= r.left - 26 && e.clientX <= r.left + 26 && e.clientY >= r.top - 26 && e.clientY <= r.top + 26
      const inHandle = (() => { const hr = h.getBoundingClientRect(); return e.clientX >= hr.left && e.clientX <= hr.right && e.clientY >= hr.top && e.clientY <= hr.bottom })()
      if (inTable || inCorner || inHandle) show()
      else if (h.classList.contains('pm-shown')) scheduleHide()
    }
    window.document.addEventListener('mousemove', onDocMove)
    this.destroyFn = () => {
      window.document.removeEventListener('mousemove', onDocMove)
      if (hideTimer) clearTimeout(hideTimer)
      if (syncRaf) cancelAnimationFrame(syncRaf)
      window.removeEventListener('resize', scheduleSync)
      scrollRoot?.removeEventListener('scroll', scheduleSync)
      ro.disconnect()
      h.remove()
    }
    // ---- round39：点击全选 + 按住拖动移动表格 ----
    h.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const view = this.view
      const startPos = this.getPos()
      if (startPos === undefined || startPos < 0) return
      // ---- 拖拽移动会话（Word 式）----
      const startClientX = e.clientX
      const startClientY = e.clientY
      let armed = false
      const indicator = document.createElement('div')
      indicator.style.cssText = 'position:absolute;height:2.5px;background:#2563eb;display:none;z-index:30;pointer-events:none;border-radius:2px'
      host.appendChild(indicator)
      const cleanDrag = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        indicator.remove()
      }
      const onMove = (ev: MouseEvent) => {
        if (!armed) {
          if (Math.abs(ev.clientY - startClientY) < 5 && Math.abs(ev.clientX - startClientX) < 5) return
          armed = true
          h.classList.add('pm-dragging')
        }
        // 目标段落判定：鼠标 y 落在 pm-host 内哪个顶层块上（表格自身跳过）。
        // 命中块的上半 → 插到其前；下半 → 插到其后；空白区 → 最近块。
        const pm = view.dom
        const blocks = Array.from(pm.children) as HTMLElement[]
        let targetIdx = -1
        let insertAfter = false
        let lineY = 0
        let lineL = 0
        let lineW = 0
        const hostR = host.getBoundingClientRect()
        for (let i = 0; i < blocks.length; i++) {
          const blk = blocks[i]
          const r = blk.getBoundingClientRect()
          if (ev.clientY >= r.top && ev.clientY <= r.bottom) {
            // 跳过表格自身的 wrapper（PM 注入的 .ProseMirror 子树内）与装饰层
            targetIdx = i
            insertAfter = ev.clientY > r.top + r.height / 2
            lineY = insertAfter ? r.bottom + 2 : r.top - 3
            lineL = r.left - hostR.left
            lineW = Math.max(80, r.width)
            break
          }
        }
        if (targetIdx < 0) {
          // 空白区：找最近块（表格自身所在块除外）
          let best = -1; let bestD = Infinity; let bestAfter = false
          for (let i = 0; i < blocks.length; i++) {
            const r = blocks[i].getBoundingClientRect()
            if (r.height < 2) continue
            const d = ev.clientY < r.top ? r.top - ev.clientY : ev.clientY - r.bottom
            if (d < bestD) { bestD = d; best = i; bestAfter = ev.clientY > r.bottom }
          }
          if (best >= 0) {
            const r = blocks[best].getBoundingClientRect()
            targetIdx = best; insertAfter = bestAfter
            lineY = bestAfter ? r.bottom + 2 : r.top - 3
            lineL = r.left - hostR.left
            lineW = Math.max(80, r.width)
          }
        }
        indicator.style.display = targetIdx >= 0 ? 'block' : 'none'
        if (targetIdx >= 0) {
          indicator.style.top = (lineY - hostR.top) + 'px'
          indicator.style.left = lineL + 'px'
          indicator.style.width = lineW + 'px'
          ;(h as any).__moveTarget = { idx: targetIdx, after: insertAfter }
        } else {
          ;(h as any).__moveTarget = null
        }
      }
      const onUp = () => {
        cleanDrag()
        h.classList.remove('pm-dragging')
        if (!armed) {
          // ---- 未拖动：点击全选 ----
          const doc = view.state.doc
          const tableNode = doc.nodeAt(startPos)
          if (!tableNode || tableNode.childCount === 0) return
          let lastRowStart = startPos + 1
          let lastRow: PMNode | null = null
          tableNode.forEach((row: PMNode, off: number) => { lastRowStart = startPos + 1 + off; lastRow = row })
          if (!lastRow) return
          let lastCellStart = lastRowStart + 1
          const lr: PMNode = lastRow
          lr.forEach((cell: PMNode, off: number) => { lastCellStart = Math.max(lastCellStart, lastRowStart + 1 + off) })
          try {
            // round46：全选后不再 scrollIntoView —— 锚点是表格首格，长表格跨多页时
            // 视口会跳到表格首页（用户报告"选择表格跳到很远的其他页面"）。
            // Word 行为：点表格把手全选，视口保持原地。focus 同理禁止滚动。
            const tr = view.state.tr.setSelection(CellSelection.create(doc, startPos + 2, lastCellStart))
            view.dispatch(tr)
            ;(view.dom as HTMLElement).focus({ preventScroll: true })
          } catch (err) {
            try { console.error('TABLE_HANDLE_SELECT_FAIL', err) } catch { /* ignore */ }
          }
          return
        }
        // ---- 拖动结束：移动表格 ----
        const target = (h as any).__moveTarget as { idx: number; after: boolean } | null
        ;(h as any).__moveTarget = null
        if (!target) return
        try {
          // 拖拽指示的块 idx → 文档 pos：遍历顶层块累计偏移。
          // 指示线不落在表格自身所在块上（命中时跳过——onMove 未排除，
          // 提交前校验：目标 pos == 表格自身位置区间 → 原地不动）。
          const doc = view.state.doc
          let pos = 0
          let idx = -1
          for (let i = 0; i < doc.childCount; i++) {
            const child = doc.child(i)
            const isTableBlock = child.type.name === 'table'
            const r = view.nodeDOM(pos) as HTMLElement | null
            const domEl = r && (r.classList?.contains('tableWrapper') ? r : (r as any))
            void isTableBlock; void domEl
            idx++
            if (idx === target.idx) {
              pos = target.after ? pos + child.nodeSize : pos
              break
            }
            pos += child.nodeSize
          }
          if (idx !== target.idx) return
          const tableNode = doc.nodeAt(startPos)
          if (!tableNode) return
          const tableEnd = startPos + tableNode.nodeSize
          // 原地判定：目标 pos 在表格区间内（含前后贴邻）→ 不动
          if (pos > startPos && pos < tableEnd) return
          if (pos === startPos || pos === tableEnd) return
          // 移动：删除原表 → 在目标 pos 插入。删除后目标 pos 若在表格之后需前移。
          let insertPos = pos
          if (insertPos > tableEnd) insertPos -= tableNode.nodeSize
          const tr = view.state.tr.delete(startPos, tableEnd)
          tr.insert(insertPos, tableNode)
          view.dispatch(tr.scrollIntoView())
          // round46：scrollIntoView 已定位移动后的表格；focus 禁止再滚到原生选区起点（双重滚动打架）
          ;(view.dom as HTMLElement).focus({ preventScroll: true })
        } catch (err) {
          try { console.error('TABLE_HANDLE_MOVE_FAIL', err) } catch { /* ignore */ }
        }
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    })
  }

  destroy() {
    // 清理 document 级 mousemove 监听（手柄悬停兜底），避免节点删除后泄漏
    if (this.destroyFn) { this.destroyFn(); this.destroyFn = null }
  }
}

// ============ 边框拖拽调列宽/行高 ============

interface DragState {
  kind: 'col' | 'row'
  view: EditorView
  tablePos: number
  tableEl: HTMLTableElement
  zoom: () => number
  // 列拖拽
  grid: TableGrid
  boundary: number          // 0=左表缘，cols=右表缘，内部=左列/右列增减
  startX: number
  // 行拖拽
  rowIndex: number
  baseH: number
  startDy: number
  // 待提交的值（rAF 节流事务写入节点属性，避免实时改 DOM 被分页重渲染冲掉）
  pendingWidths: number[] | null
  pendingRowH: number
  raf: number
}

function tablePosFromEl(view: EditorView, tableEl: Element): number {
  let found = -1
  view.state.doc.forEach((node: PMNode, from: number) => {
    if (found >= 0) return
    if (node.type.name === 'table') {
      const d = view.nodeDOM(from)
      if (d && (d === tableEl || (d as HTMLElement).contains?.(tableEl))) found = from
    }
  })
  return found
}

/**
 * 首行单元格几何 → 网格列边界（布局 px，相对 table 左缘，已除缩放）。
 * xs[0] = 左表缘（x=0，网格列 0），xs[i] = 第 i 个首行单元格右缘 → 网格列 gridIdx[i]（累计跨列）。
 * 返回 { xs, gridIdx }，两数组等长：拖拽边界 xs[i] 对应网格边界 gridIdx[i]。
 */
function colBoundaries(tableEl: HTMLTableElement, z: number): { xs: number[]; gridIdx: number[] } {
  const xs: number[] = [0]
  const gridIdx: number[] = [0]
  const firstRow = tableEl.rows && tableEl.rows[0]
  if (!firstRow) return { xs, gridIdx }
  const tRect = tableEl.getBoundingClientRect()
  let cum = 0
  for (const td of Array.from(firstRow.cells)) {
    const r = td.getBoundingClientRect()
    xs.push((r.right - tRect.left) / z)
    cum += parseInt(td.getAttribute('colspan') || '1', 10) || 1
    gridIdx.push(cum)
  }
  return { xs, gridIdx }
}

/** 行边界 Y（布局 px，相对 table 顶，已除缩放）：[0, 行0底, 行1底, ...]。
 * 必须用 getBoundingClientRect 相对 table rect 计算 —— tr.offsetTop 以
 * position:relative 的 tableWrapper 为 offsetParent，含表格 margin 偏差。 */
function rowBoundaries(tableEl: HTMLTableElement, z: number): number[] {
  const out: number[] = [0]
  const tRect = tableEl.getBoundingClientRect()
  for (const tr of Array.from(tableEl.rows)) {
    const r = tr.getBoundingClientRect()
    out.push((r.bottom - tRect.top) / z)
  }
  return out
}

function nearestIdx(arr: number[], x: number, tol: number): number {
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < arr.length; i++) {
    const d = Math.abs(arr[i] - x)
    if (d < bestD) { bestD = d; best = i }
  }
  return bestD <= tol ? best : -1
}



/** 边界 b 处按 dx 求新列宽数组。 */
function widthsAfterDrag(grid: TableGrid, b: number, dx: number): number[] {
  const widths = grid.colWidths.map((w) => (w || 0))
  const clampW = (w: number) => Math.max(CELL_MIN_W, w)
  if (b === 0) widths[0] = clampW((grid.colWidths[0] || CELL_MIN_W) - dx)
  else if (b === grid.cols) widths[grid.cols - 1] = clampW((grid.colWidths[grid.cols - 1] || CELL_MIN_W) + dx)
  else {
    widths[b - 1] = clampW((grid.colWidths[b - 1] || CELL_MIN_W) + dx)
    widths[b] = clampW((grid.colWidths[b] || CELL_MIN_W) - dx)
  }
  return widths
}

// ============ 行拖拽换位置（对齐 MS Word：选中行后拖到目标行） ============
// round34：由本插件的 mousedown（CellSelection 上按下左键）驱动。
// 旧架构（round26~33）从点击代理层启动；代理层删除后，PM 的
// handleDOMEvents.mousedown 在 tableEditing 处理之前先收到事件：
// 若是 CellSelection 区域内的按下 → preventDefault 保留行选并启动
// 拖拽会话；否则放行（原生光标定位 / 框选交给 PM）。

/** 在 CellSelection（行选中）上开始行拖拽会话：拖动显示插入指示线，
 * 松开把选中行区间移动到目标行。返回 true 表示会话已启动（调用方应
 * preventDefault 并保留 CellSelection）。 */
export function startRowDragSession(view: EditorView, clientX: number, clientY: number): boolean {
  const sel = view.state.selection as any
  if (!sel || !sel.$anchorCell || !sel.$headCell) return false
  // 点击的 td
  // 找 table 位置（anchor cell 向上回溯）
  let tablePos = -1
  view.state.doc.forEach((n, off) => {
    if (tablePos < 0 && n.type.name === 'table') {
      const d = view.nodeDOM(off) as HTMLElement | null
      if (d) {
        const ad = view.nodeDOM(selAnchorPos(view, sel)) as HTMLElement | null
        if (ad && (d === ad.closest('.tableWrapper') || d.contains(ad.closest('.tableWrapper')))) tablePos = off
      }
    }
  })
  if (tablePos < 0) return false
  const table = view.state.doc.nodeAt(tablePos)
  if (!table || table.childCount < 2) return false
  // 行索引：$anchorCell/$headCell 相对 table 开头的深度回溯
  // 行索引 = 兄弟序号（字节偏移会误判行号，r27_m11/m12 实锤）
  const rowOf = ($cell: any) => {
    for (let d = $cell.depth; d >= 2; d--) {
      if ($cell.node(d).type.name === 'table_row') {
        const theRow = $cell.node(d)
        let idx = -1
        $cell.node(d - 1).forEach((rw: PMNode, _o: number, i: number) => { if (rw === theRow) idx = i })
        return idx
      }
    }
    return -1
  }
  const fromRow = Math.min(rowOf(sel.$anchorCell), rowOf(sel.$headCell))
  const toRow = Math.max(rowOf(sel.$anchorCell), rowOf(sel.$headCell))
  if (fromRow < 0 || toRow < 0) return false
  if (toRow - fromRow + 1 >= table.childCount) return false
  // nodeDOM(table) 返回 NodeView 的 dom（即 .tableWrapper 本身）—— 
  // 不能在它内部 querySelector（找不到自己）；取它或其内部首个 wrapper。
  const nd = view.nodeDOM(tablePos) as HTMLElement | null
  const wrap = nd && (nd.classList.contains('tableWrapper') ? nd : nd.querySelector?.('.tableWrapper')) as HTMLElement | null
  const host = view.dom.parentElement
  if (!wrap || !host) return false

  const indicator = document.createElement('div')
  indicator.className = 'pm-row-move-indicator'
  indicator.style.cssText = 'position:absolute;height:2px;background:#2563eb;display:none;z-index:8;pointer-events:none;border-radius:1px'
  host.appendChild(indicator)

  let armed = false
  let targetRow = -1
  // ★ wrap 不能闭包缓存：PM 更新会重建 NodeView（新 wrapper 节点），
  // 旧节点 rect 全 0 导致 target 误判为末尾（r27_targetdbg5 实锤）。
  const liveWrap = (): HTMLElement | null => {
    const nd = view.nodeDOM(tablePos) as HTMLElement | null
    if (!nd) return null
    return nd.classList.contains('tableWrapper') ? nd : (nd.querySelector?.('.tableWrapper') as HTMLElement | null)
  }
  const onMove = (ev: MouseEvent) => {
    if (!armed) {
      if (Math.abs(ev.clientY - clientY) < 5 && Math.abs(ev.clientX - clientX) < 5) return
      armed = true
    }
    const wNow = liveWrap()
    if (!wNow) return
    const trs = wNow.querySelectorAll('tr')
    // 目标行判定（防错设计 r27）：elementFromPoint 反查（所见即所得，
    // 不受 rect 缓存/拖拽中 scrollIntoView 引起的整体位移影响）—— 
    // 点击点落在行 X 的上半 → 插到 X 前；下半 → 插到 X+1 前；表外下方 → 末尾。
    let target = trs.length
    const hitEl = window.document.elementFromPoint(ev.clientX, ev.clientY)
    const hitTr = hitEl?.closest?.('tr') as HTMLElement | null
    if (hitTr && wNow.contains(hitTr)) {
      const idx = Array.prototype.indexOf.call(trs, hitTr)
      const r = hitTr.getBoundingClientRect()
      target = ev.clientY < r.top + r.height / 2 ? idx : idx + 1
    } else {
      // 表格下方空白 → 末尾（clientY 超过末行中点才算）
      const lastR = (trs[trs.length - 1] as HTMLElement).getBoundingClientRect()
      if (ev.clientY < lastR.top + lastR.height / 2) {
        // 落点不在任何行上但在表格范围内（间隙）—— 按线性扫描兜底
        for (let i = 0; i < trs.length; i++) {
          const r = (trs[i] as HTMLElement).getBoundingClientRect()
          if (ev.clientY < r.top + r.height / 2) { target = i; break }
        }
      } else target = trs.length
    }
    targetRow = target
    // 调试注入（r27_matrix2）：确认 mousemove 的 clientY 与几何
    const hostR = host.getBoundingClientRect()
    let indY: number
    if (target === 0) indY = (trs[0] as HTMLElement).getBoundingClientRect().top - hostR.top
    else indY = (trs[Math.min(target, trs.length) - 1] as HTMLElement).getBoundingClientRect().bottom - hostR.top
    indicator.style.display = 'block'
    indicator.style.top = indY + 'px'
    indicator.style.left = (wNow.getBoundingClientRect().left - hostR.left) + 'px'
    indicator.style.width = wNow.getBoundingClientRect().width + 'px'
  }
  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    indicator.remove()
    if (!armed || targetRow < 0) return
    // 原地判定（r27_matrix6 修正）：target 语义 =「插到原行序第 target 行前」，
    // target ∈ [fromRow, toRow+1]（选区前缘..后缘+1）均为原地。
    if (targetRow >= fromRow && targetRow <= toRow + 1) return
    // 映射到移除选区后的 rest 坐标：目标在选区后方时前移选区长度
    let insertAt = targetRow > toRow + 1 ? targetRow - (toRow - fromRow + 1) : targetRow
    try {
      const t2 = view.state.doc.nodeAt(tablePos)
      if (!t2) return
      void wrap // 闭包 wrap 仅作初始存在性校验，拖拽期间用 liveWrap()
      const rowsArr: PMNode[] = []
      t2.forEach((rw: PMNode) => rowsArr.push(rw))
      const moved = rowsArr.slice(fromRow, toRow + 1)
      const rest = rowsArr.slice(0, fromRow).concat(rowsArr.slice(toRow + 1))
      const newRows = rest.slice(0, insertAt).concat(moved, rest.slice(insertAt))
      const tr = view.state.tr.replaceWith(tablePos, tablePos + t2.nodeSize, t2.copy(Fragment.fromArray(newRows)))
      view.dispatch(tr.scrollIntoView())
      // round46：同上 —— focus 禁止再滚到原生选区起点
      ;(view.dom as HTMLElement).focus({ preventScroll: true })
    } catch { /* 移动失败静默 */ }
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
  return true
}

/** CellSelection anchor cell 的文档位置（-1 找不到）。 */
function selAnchorPos(view: EditorView, sel: any): number {
  try { return sel.$anchorCell.pos - 1 } catch { return -1 }
}

export function createTableDragResizePlugin(getZoom: () => number) {
  let drag: DragState | null = null
  let hoverTable: HTMLTableElement | null = null

  const findTableCtx = (view: EditorView, e: MouseEvent) => {
    const target = e.target as HTMLElement
    const td = target.closest?.('td, th') as HTMLElement | null
    if (!td || !view.dom.contains(td)) return null
    const tableEl = td.closest('table') as HTMLTableElement | null
    if (!tableEl) return null
    return { td, tableEl }
  }

  const commitPending = () => {
    if (!drag) return
    const d = drag
    const node = d.view.state.doc.nodeAt(d.tablePos)
    if (!node) return
    const tr = d.view.state.tr
    if (d.kind === 'col' && d.pendingWidths) {
      const widths = d.pendingWidths
      let rowOff = d.tablePos + 1
      node.forEach((row: PMNode) => {
        let cellOff = rowOff + 1
        let c = 0
        row.forEach((cell: PMNode) => {
          const cs = cell.attrs.colspan || 1
          let w = 0
          for (let k = 0; k < cs; k++) w += widths[c + k] || 0
          if (w > 0) tr.setNodeMarkup(cellOff, undefined, { ...cell.attrs, colwidth: Math.max(CELL_MIN_W, Math.round(w)) }, [])
          c += cs
          cellOff += cell.nodeSize
        })
        rowOff += row.nodeSize
      })
    } else if (d.kind === 'row' && d.pendingRowH > 0) {
      let rowOff = d.tablePos + 1
      let i = 0
      let target = -1
      node.forEach((row: PMNode) => {
        if (i === d.rowIndex) target = rowOff
        i++
        rowOff += row.nodeSize
      })
      if (target >= 0) {
        const rowNode = d.view.state.doc.nodeAt(target)
        if (rowNode) tr.setNodeMarkup(target, undefined, { ...rowNode.attrs, height: Math.max(ROW_MIN_H, Math.round(d.pendingRowH)) })
      }
    } else {
      return
    }
    d.view.dispatch(tr.setMeta('addToHistory', false))
  }

  const scheduleCommit = () => {
    if (!drag || drag.raf) return
    drag.raf = requestAnimationFrame(() => {
      if (drag) { drag.raf = 0; commitPending() }
    })
  }

  const startDrag = (view: EditorView, e: MouseEvent, kind: 'col' | 'row', tableEl: HTMLTableElement, tablePos: number, idx: number) => {
    const zoomRatio = Math.max(0.1, getZoom() || 1)
    if (kind === 'col') {
      // 首次拖拽：表格尚无固定列宽 → 先用当前渲染宽度初始化 colwidth（一次性事务），
      // 布局切到 fixed 后再实时拖拽。与 Word「拖动即固化列宽」行为一致。
      const node = view.state.doc.nodeAt(tablePos)
      if (!node) return
      let hasW = false
      if (node.childCount > 0) {
        node.child(0).forEach((cell: PMNode) => { if ((Number(cell.attrs.colwidth) || 0) > 0) hasW = true })
      }
      if (!hasW) {
        const tr = view.state.tr
        let rowOff = tablePos + 1
        node.forEach((row: PMNode) => {
          let cellOff = rowOff + 1
          row.forEach((cell: PMNode) => {
            const el = view.nodeDOM(cellOff) as HTMLElement | null
            if (el) {
              const rect = el.getBoundingClientRect()
              const w = Math.max(CELL_MIN_W, Math.round(rect.width / zoomRatio))
              tr.setNodeMarkup(cellOff, undefined, { ...cell.attrs, colwidth: w })
            }
            cellOff += cell.nodeSize
          })
          rowOff += row.nodeSize
        })
        view.dispatch(tr.setMeta('addToHistory', false))
      }
      const node2 = view.state.doc.nodeAt(tablePos)
      if (!node2) return
      const grid = buildGrid(node2)
      drag = {
        kind: 'col', view, tablePos, tableEl, zoom: getZoom, grid, boundary: idx, startX: e.clientX,
        rowIndex: -1, baseH: 0, startDy: 0, pendingWidths: null, pendingRowH: 0, raf: 0,
      }
    } else {
      const rows = Array.from(tableEl.rows)
      const rowEl = rows[idx - 1]
      if (!rowEl) return
      drag = {
        kind: 'row', view, tablePos, tableEl, zoom: getZoom,
        grid: { cols: 0, colWidths: [] }, boundary: 0, startX: 0,
        rowIndex: idx - 1,
        baseH: rowEl.offsetHeight / zoomRatio, startDy: e.clientY,
        pendingWidths: null, pendingRowH: 0, raf: 0,
      }
    }
    document.body.style.cursor = kind === 'col' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
  }

  const finishDrag = () => {
    if (!drag) return
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    if (drag.tableEl) { drag.tableEl.classList.remove('pm-col-resize', 'pm-row-resize'); drag.tableEl.classList.add(drag.kind === 'col' ? 'pm-col-resize' : 'pm-row-resize') }
    const d = drag
    drag = null
    if (d.raf) cancelAnimationFrame(d.raf)
    const v = d.view
    // 松开：提交最终值（进撤销历史）。中间值已在拖拽过程中以 addToHistory:false 写入，
    // 最终一次提交落入历史 —— Word 语义：一次拖拽 = 一步撤销。
    const node = v.state.doc.nodeAt(d.tablePos)
    if (!node) return
    const tr = v.state.tr
    if (d.kind === 'col' && d.pendingWidths) {
      const widths = d.pendingWidths
      let rowOff = d.tablePos + 1
      node.forEach((row: PMNode) => {
        let cellOff = rowOff + 1
        let c = 0
        row.forEach((cell: PMNode) => {
          const cs = cell.attrs.colspan || 1
          let w = 0
          for (let k = 0; k < cs; k++) w += widths[c + k] || 0
          if (w > 0) tr.setNodeMarkup(cellOff, undefined, { ...cell.attrs, colwidth: Math.max(CELL_MIN_W, Math.round(w)) }, [])
          c += cs
          cellOff += cell.nodeSize
        })
        rowOff += row.nodeSize
      })
      v.dispatch(tr)
    } else if (d.kind === 'row' && d.pendingRowH > 0) {
      let rowOff = d.tablePos + 1
      let i = 0
      let target = -1
      node.forEach((row: PMNode) => {
        if (i === d.rowIndex) target = rowOff
        i++
        rowOff += row.nodeSize
      })
      if (target >= 0) {
        const rowNode = v.state.doc.nodeAt(target)
        if (rowNode) tr.setNodeMarkup(target, undefined, { ...rowNode.attrs, height: Math.max(ROW_MIN_H, Math.round(d.pendingRowH)) })
        v.dispatch(tr)
      }
    }
  }

  // round64 修复（用户报告：表格无法拖边框调行高列宽）：
  // clickbridge 接管层（z-index:7，悬停格上 pointer-events:auto）挂在
  // view.dom.parentElement 上 —— 事件 target 是层时【不在 view.dom 子树】，
  // PM 的 eventBelongsToView 判 false，handleDOMEvents 永远收不到
  // mousemove/mousedown —— 拖拽插件在表格上"失聪"。补 document 级
  // capture 监听（与插件 handler 同逻辑），层截获场景仍能拖拽。
  let docListenersBound = false
  const bindDocListeners = (getView: () => EditorView | null) => {
    if (docListenersBound) return
    docListenersBound = true
    const pierce = (e: MouseEvent, view: EditorView): HTMLTableElement | null => {
      // round64：桥层是无内容 DIV —— 事件 target 不在 td 里，用 elementsFromPoint
      // 穿层定位真实 TD/表格（层的下方元素）。返回 null = 该点不在任何表格边框。
      const stack = (document as any).elementsFromPoint(e.clientX, e.clientY) as HTMLElement[]
      const td = (stack || []).find(el => el.tagName === 'TD' || el.tagName === 'TH')
      if (!td) return null
      const tableEl = td.closest('table') as HTMLTableElement | null
      if (!tableEl || !view.dom.contains(tableEl)) return null
      return tableEl
    }
    const onMouseMove = (e: MouseEvent) => {
      const view = getView()
      if (!view || view.isDestroyed) return
      if (drag) return // 拖拽会话已由插件 handler 驱动（真实事件路径）
      // 仅当事件 target 在桥层/非 view.dom 子树（被层截获）时接管
      const t = e.target as HTMLElement | null
      if (!t) return
      if (view.dom.contains(t)) return // 正常路径走插件 handleDOMEvents
      // round65（用户反馈：真实 WebView 里 hover 边框无双箭头光标——
      // headless 探针全绿但 WebView 不出）：target 判定放宽。桥层默认
      // pointer-events:none、悬停真实格才被 PE 管理器临时激活 —— 真实
      // WebView 的 hit-test 差异可能让 target 落在 host/装饰层等非层元素，
      // 旧守卫 t.closest('.pm-table-clickbridge') 直接 return，hover 光标
      // 从未写入。改为几何接管：坐标穿层命中表格即处理（不在表格内时
      // 顺带清理所有表格的 resize 类，避免残留）。
      if (t.closest('[contenteditable="false"]')) return // 静态 UI 不接管
      const tableEl = pierce(e, view)
      if (!tableEl) {
        // 移出全部表格：清 hover 残留（防光标卡在 col/row-resize）
        view.dom.querySelectorAll('table.pm-col-resize, table.pm-row-resize').forEach(el => el.classList.remove('pm-col-resize', 'pm-row-resize'))
        return
      }
      const z = Math.max(0.1, getZoom() || 1)
      const tRect = tableEl.getBoundingClientRect()
      const lx = (e.clientX - tRect.left) / z
      const ly = (e.clientY - tRect.top) / z
      const nearX = nearestIdx(colBoundaries(tableEl, z).xs, lx, EDGE_TOLERANCE)
      const nearY = nearestIdx(rowBoundaries(tableEl, z), ly, EDGE_TOLERANCE)
      tableEl.classList.toggle('pm-col-resize', nearX >= 0)
      tableEl.classList.toggle('pm-row-resize', nearY >= 0 && nearX < 0)
    }
    // round64：mousedown 同样被层截获（拖拽启动失效 —— 用户报告拖不动）。
    // 层截获的 mousedown → 穿层找到表格 → 边框命中 → 启动与插件 handler
    // 等价的 startDrag 会话（同一闭包，直接调用）。
    const onMouseDown = (e: MouseEvent) => {
      const view = getView()
      if (!view || view.isDestroyed) return
      if (e.button !== 0 || drag) return
      const t = e.target as HTMLElement | null
      if (!t) return
      if (view.dom.contains(t)) return // 正常路径走插件 handleDOMEvents
      // round65：同 hover 守卫放宽 —— 真实 WebView 的 hit-test 差异可能
      // 让层上 mousedown 的 target 落在 host/装饰层而非桥层本体；几何
      // 穿层命中边框即接管（点击 UI 按钮等必然穿层不到表格，不受影响）。
      if (t.closest('button, input, select, textarea, [contenteditable="false"]')) return // 静态 UI 不接管
      const tableEl = pierce(e, view)
      if (!tableEl) return
      const z = Math.max(0.1, getZoom() || 1)
      const tRect = tableEl.getBoundingClientRect()
      const lx = (e.clientX - tRect.left) / z
      const ly = (e.clientY - tRect.top) / z
      const { xs, gridIdx } = colBoundaries(tableEl, z)
      const ys = rowBoundaries(tableEl, z)
      const nearX = nearestIdx(xs, lx, EDGE_TOLERANCE)
      const nearY = nearestIdx(ys, ly, EDGE_TOLERANCE)
      let kind: 'col' | 'row' | null = null
      let idx = -1
      if (nearX >= 0 && (nearY < 0 || Math.abs(xs[nearX] - lx) <= Math.abs(ys[nearY] - ly))) { kind = 'col'; idx = nearX }
      else if (nearY >= 0) { kind = 'row'; idx = nearY }
      if (!kind || idx < 0) return
      if (kind === 'row' && idx === 0) return // 表格上缘不调整
      const tablePos = tablePosFromEl(view, tableEl)
      if (tablePos < 0) return
      e.preventDefault()
      startDrag(view, e, kind, tableEl, tablePos, kind === 'col' ? (gridIdx[idx] ?? idx) : idx)
      // 拖拽会话的 move/up 监听（与插件 handler 的路径等价）
      const onMove2 = (ev: MouseEvent) => {
        if (!drag) return
        const z2 = Math.max(0.1, drag.zoom() || 1)
        if (drag.kind === 'col' && drag.boundary !== undefined) {
          const dx = (ev.clientX - drag.startX) / z2
          drag.pendingWidths = widthsAfterDrag(drag.grid, drag.boundary, dx)
        } else if (drag.kind === 'row') {
          const dy = (ev.clientY - drag.startDy) / z2
          drag.pendingRowH = Math.max(ROW_MIN_H, Math.round(drag.baseH + dy))
        }
        scheduleCommit()
      }
      const onUp2 = () => {
        window.removeEventListener('mousemove', onMove2)
        window.removeEventListener('mouseup', onUp2)
        finishDrag()
      }
      window.addEventListener('mousemove', onMove2)
      window.addEventListener('mouseup', onUp2)
    }
    window.document.addEventListener('mousemove', onMouseMove, true)
    window.document.addEventListener('mousedown', onMouseDown, true)
  }

  return new Plugin({
    view(view: EditorView) {
      // 惰性绑定 document 监听（getZoom 闭包已在外层）
      bindDocListeners(() => view)
      return { destroy() { /* 监听与 view 同生命周期由 PM 管理；window 级监听在插件销毁时移除 */ } }
    },
    props: {
      handleDOMEvents: {
        mousemove(view: EditorView, event: Event) {
          const e = event as MouseEvent
          if (drag) {
            const z = Math.max(0.1, drag.zoom() || 1)
            if (drag.kind === 'col' && drag.boundary !== undefined) {
              const dx = (e.clientX - drag.startX) / z
              drag.pendingWidths = widthsAfterDrag(drag.grid, drag.boundary, dx)
            } else if (drag.kind === 'row') {
              const dy = (e.clientY - drag.startDy) / z
              // tr height 为“最小高度”语义：拖大生效，内容更高时浏览器自动钳制
              drag.pendingRowH = Math.max(ROW_MIN_H, Math.round(drag.baseH + dy))
            }
            scheduleCommit()
            e.preventDefault()
            return true
          }
          // 悬停检测：光标靠近边框 → resize 光标（对齐 MS Word）。
          // round64 修复：cursor 不再直接写 table.style.cursor —— 分页装饰/
          // NodeView update 会整体重写 wrapper 级 style/class，写入即被冲掉
          //（探针实测 mousemove 设置成功、随后被清空）。改由 class 驱动：
          // .pm-col-resize / .pm-row-resize 挂在 table 上，CSS 规则渲染光标
          //（class 由 NodeView 维护，装饰只动 wrapper 不动 table 的 class）。
          const ctx = findTableCtx(view, e)
          if (!ctx) {
            if (hoverTable) { hoverTable.classList.remove('pm-col-resize', 'pm-row-resize'); hoverTable = null }
            return false
          }
          if (hoverTable && hoverTable !== ctx.tableEl) hoverTable.classList.remove('pm-col-resize', 'pm-row-resize')
          hoverTable = ctx.tableEl
          const z = Math.max(0.1, getZoom() || 1)
          const tRect = ctx.tableEl.getBoundingClientRect()
          const lx = (e.clientX - tRect.left) / z
          const ly = (e.clientY - tRect.top) / z
          const nearX = nearestIdx(colBoundaries(ctx.tableEl, z).xs, lx, EDGE_TOLERANCE)
          const nearY = nearestIdx(rowBoundaries(ctx.tableEl, z), ly, EDGE_TOLERANCE)
          ctx.tableEl.classList.toggle('pm-col-resize', nearX >= 0)
          ctx.tableEl.classList.toggle('pm-row-resize', nearY >= 0 && nearX < 0)
          return false
        },
        mousedown(view: EditorView, event: Event): boolean {
          const e = event as MouseEvent
          if (e.button !== 0 || drag) return false
          const ctx = findTableCtx(view, e)
          if (!ctx) return false
          // round34 行拖拽（原代理层职责）：已有 CellSelection（整行/多行
          // 选中）时在选中区域内按下左键 → 启动行拖拽会话（preventDefault
          // 保留 CellSelection，不被 tableEditing 压成光标）。点击选中区
          // 之外 → 放行，让 PM 原生改选（与 Word 行为一致）。
          {
            const curSel = view.state.selection as any
            if (curSel && curSel.$anchorCell && curSel.$headCell) {
              const rowOf = ($cell: any) => {
                try {
                  for (let d = $cell.depth; d >= 2; d--) {
                    if ($cell.node(d).type.name === 'table_row') {
                      const theRow = $cell.node(d)
                      let idx = -1
                      $cell.node(d - 1).forEach((rw: PMNode, _o: number, i: number) => { if (rw === theRow) idx = i })
                      return idx
                    }
                  }
                } catch { /* */ }
                return -1
              }
              const selFromRow = Math.min(rowOf(curSel.$anchorCell), rowOf(curSel.$headCell))
              const selToRow = Math.max(rowOf(curSel.$anchorCell), rowOf(curSel.$headCell))
              // 命中行的索引（事件 target → tr 在表格中的序号）
              const hitTr = (e.target as HTMLElement).closest?.('tr') as HTMLTableRowElement | null
              const trs: HTMLTableRowElement[] = Array.from(ctx.tableEl.querySelectorAll('tr'))
              const hitRow = hitTr ? trs.indexOf(hitTr) : -1
              // round65：全表选中（CellSelection 覆盖全部行，如左上角手柄
              // 全选）→ 点击表内 = 取消全选放光标。此时不能 preventDefault/
              // 起拖拽（全表拖不动也无意义），必须放行事件让 PM 原生把
              // CellSelection 改成光标（用户反馈"全选后点表内没反应"）。
              const fullTableSelected = selFromRow >= 0 && selToRow - selFromRow + 1 >= trs.length
              if (!fullTableSelected && hitRow >= 0 && selFromRow >= 0 && hitRow >= selFromRow && hitRow <= selToRow) {
                e.preventDefault()
                startRowDragSession(view, e.clientX, e.clientY)
                return true
              }
            }
          }
          const z = Math.max(0.1, getZoom() || 1)
          const tRect = ctx.tableEl.getBoundingClientRect()
          const lx = (e.clientX - tRect.left) / z
          const ly = (e.clientY - tRect.top) / z
          const { xs, gridIdx } = colBoundaries(ctx.tableEl, z)
          const ys = rowBoundaries(ctx.tableEl, z)
          const nearX = nearestIdx(xs, lx, EDGE_TOLERANCE)
          const nearY = nearestIdx(ys, ly, EDGE_TOLERANCE)
          // 更近者优先（十字交叉点命中取距离小的一侧）
          let kind: 'col' | 'row' | null = null
          let idx = -1
          if (nearX >= 0 && (nearY < 0 || Math.abs(xs[nearX] - lx) <= Math.abs(ys[nearY] - ly))) {
            kind = 'col'; idx = nearX
          } else if (nearY >= 0) {
            kind = 'row'; idx = nearY
          }
          if (!kind || idx < 0) return false
          // 表格上缘（行边界 0）不调整
          if (kind === 'row' && idx === 0) return false
          const tablePos = tablePosFromEl(view, ctx.tableEl)
          if (tablePos < 0) return false
          // 合并单元格场景：边界序号 → 网格列序号（拖拽按网格列增减宽度）
          startDrag(view, e, kind, ctx.tableEl, tablePos, kind === 'col' ? (gridIdx[idx] ?? idx) : idx)
          e.preventDefault()
          const onMove = (ev: MouseEvent) => {
            if (!drag) return
            const z2 = Math.max(0.1, drag.zoom() || 1)
            if (drag.kind === 'col' && drag.boundary !== undefined) {
              const dx = (ev.clientX - drag.startX) / z2
              drag.pendingWidths = widthsAfterDrag(drag.grid, drag.boundary, dx)
            } else if (drag.kind === 'row') {
              const dy = (ev.clientY - drag.startDy) / z2
              drag.pendingRowH = Math.max(ROW_MIN_H, Math.round(drag.baseH + dy))
            }
            scheduleCommit()
          }
          const onUp = () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
            finishDrag()
          }
          window.addEventListener('mousemove', onMove)
          window.addEventListener('mouseup', onUp)
          return true
        },
      },
    },
  })
}

// ============ AutoFit（对齐 MS Word「自动调整」） ============

/**
 * 自动调整表格列宽（光标需在表格内）。
 * mode:
 *  - 'content' 根据内容调整表格：克隆表以 auto 布局测自然列宽，写回 colwidth（超宽按比例压缩到内容区宽）
 *  - 'window'  根据窗口调整表格：总宽 = 页面正文区宽，按当前列宽比例分配
 *  - 'fixed'   固定列宽：以当前渲染宽度固化 colwidth（切 fixed 布局）
 */
export function autoFitTable(view: EditorView, mode: 'content' | 'window' | 'fixed', contentWidthPx: number): boolean {
  const { state } = view
  const { $from } = state.selection
  let tablePos = -1
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'table') { tablePos = $from.before(d); break }
  }
  if (tablePos < 0) return false
  const node = state.doc.nodeAt(tablePos)
  if (!node) return false
  const tableEl = view.nodeDOM(tablePos) as HTMLElement | null
  const innerTable = tableEl ? ((tableEl as unknown as HTMLTableElement).tagName === 'TABLE' ? tableEl : tableEl.querySelector('table')) : null
  if (!innerTable) return false
  const zoomRatio = Math.max(0.1, (typeof (window as any).__docZoom === 'number' && (window as any).__docZoom > 0.1) ? (window as any).__docZoom : 1)

  const grid = buildGrid(node)
  let widths: number[] = []
  const allSet = grid.colWidths.length > 0 && grid.colWidths.every((w) => (w || 0) > 0)
  if (allSet) {
    widths = grid.colWidths.map((w) => Math.round(w || 0))
  } else {
    // 从首行几何测当前列宽
    const fr = (innerTable as HTMLTableElement).rows?.[0]
    if (!fr) return false
    const tRect = (innerTable as HTMLElement).getBoundingClientRect()
    let prev = 0
    let g = 0
    for (const td of Array.from(fr.cells)) {
      const cs = parseInt(td.getAttribute('colspan') || '1', 10) || 1
      const r = td.getBoundingClientRect()
      const right = (r.right - tRect.left) / zoomRatio
      const w = Math.max(CELL_MIN_W, Math.round(right - prev))
      for (let k = 0; k < cs; k++) widths[g + k] = Math.max(CELL_MIN_W, Math.round(w / cs))
      prev = right
      g += cs
    }
    for (let i = 0; i < grid.cols; i++) if (!widths[i]) widths[i] = CELL_MIN_W
  }

  if (mode === 'content') {
    // 隐藏克隆表（auto 布局、去宽度约束）测自然列宽 —— Word「根据内容调整表格」
    const clone = (innerTable as HTMLTableElement).cloneNode(true) as HTMLTableElement
    clone.style.position = 'absolute'
    clone.style.left = '-99999px'
    clone.style.top = '0'
    clone.style.visibility = 'hidden'
    clone.style.tableLayout = 'auto'
    clone.style.width = 'auto'
    const cg = clone.querySelector('colgroup')
    if (cg) cg.remove()
    clone.querySelectorAll('td, th').forEach((el: Element) => { (el as HTMLElement).style.width = '' })
    document.body.appendChild(clone)
    let measured: number[] = []
    try {
      const fr = clone.rows?.[0]
      if (fr) {
        const cRect = clone.getBoundingClientRect()
        let prev = 0
        let g = 0
        for (const td of Array.from(fr.cells)) {
          const cs = parseInt(td.getAttribute('colspan') || '1', 10) || 1
          const r = td.getBoundingClientRect()
          const right = (r.right - cRect.left) / zoomRatio
          const w = Math.max(CELL_MIN_W, Math.round(right - prev))
          for (let k = 0; k < cs; k++) measured[g + k] = Math.max(CELL_MIN_W, Math.round(w / cs))
          prev = right
          g += cs
        }
      }
    } finally {
      clone.remove()
    }
    if (measured.length === grid.cols) widths = measured
    const sum = widths.reduce((a, w) => a + w, 0)
    if (sum > contentWidthPx && sum > 0) {
      widths = widths.map((w) => Math.max(CELL_MIN_W, Math.round((w * contentWidthPx) / sum)))
    }
  } else if (mode === 'window') {
    const sum = widths.reduce((a, w) => a + w, 0)
    if (sum > 0) {
      widths = widths.map((w) => Math.max(CELL_MIN_W, Math.round((w * contentWidthPx) / sum)))
      const diff = contentWidthPx - widths.reduce((a, w) => a + w, 0)
      widths[widths.length - 1] = Math.max(CELL_MIN_W, widths[widths.length - 1] + diff)
    }
  }
  // 'fixed'：保持当前宽度（仅固化 + 切 fixed 布局）

  const tr = state.tr
  let rowOff = tablePos + 1
  node.forEach((row: PMNode) => {
    let cellOff = rowOff + 1
    let c = 0
    row.forEach((cell: PMNode) => {
      const cs = cell.attrs.colspan || 1
      let w = 0
      for (let k = 0; k < cs; k++) w += widths[c + k] || 0
      if (w > 0) tr.setNodeMarkup(cellOff, undefined, { ...cell.attrs, colwidth: Math.max(CELL_MIN_W, Math.round(w)) }, [])
      c += cs
      cellOff += cell.nodeSize
    })
    rowOff += row.nodeSize
  })
  view.dispatch(tr)
  return true
}

