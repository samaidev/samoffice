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
import { Node as PMNode } from 'prosemirror-model'
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
  }

  /** 应用 table 节点属性到 <table>（与 schema.table.toDOM 同源）。 */
  private syncAttrs(node: PMNode) {
    const align = node.attrs.align
    let style = 'border-collapse: collapse; margin: 8px 0'
    if (align === 'center') style += '; margin-left: auto; margin-right: auto'
    else if (align === 'right') style += '; margin-left: auto'
    else if (align === 'left') style += '; margin-right: auto'
    const grid = buildGrid(node)
    const allW = grid.cols > 0 && grid.colWidths.every((w) => (w || 0) > 0)
    if (allW) {
      const sum = grid.colWidths.reduce((a: number, w) => a + (w || 0), 0)
      if (sum > 0) style += '; table-layout: fixed; width: ' + Math.round(sum) + 'px'
    }
    this.table.style.cssText = style
    this.table.className = 'pm-table'
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

  update(node: PMNode): boolean {
    if (node.type.name !== 'table') return false
    this.node = node
    this.syncAttrs(node)
    return true
  }

  /** 左上角全选手柄（对齐 MS Word 表格移动手柄）：悬停表格时出现，点击全选。
   * 悬停稳定性（修复"移动上去就消失"）：
   * 1. 手柄部分重叠表格左上角（CSS left/top 负值一半在表内），鼠标从表格内部移向手柄
   *    的路径连续覆盖——悬停手柄时经 DOM 祖先链 tableWrapper:hover 依然成立，不会中途消失。
   * 2. JS 驱动可见性（pm-shown 类挂在手柄自身）：分页装饰会整体重写 wrapper 的
   *    class/style（pg-brk-table / margin-bottom），挂在 wrapper 上的状态类会被冲掉导致
   *    闪烁——手柄自身类不受装饰影响。document mousemove 按表格包围盒判定：
   *    在表内或左上角 26px 热区 → 显示；离开 → 180ms 宽限后隐藏（鼠标斜向移动不闪烁）。 */
  private attachHandle() {
    const h = document.createElement('div')
    h.className = 'pm-table-handle'
    h.setAttribute('contenteditable', 'false')
    h.setAttribute('title', '点击全选表格')
    h.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 0 L8 2.2 H4 Z M6 12 L4 9.8 H8 Z M0 6 L2.2 4 V8 Z M12 6 L9.8 8 V4 Z" fill="currentColor"/><rect x="4.6" y="4.6" width="2.8" height="2.8" fill="currentColor"/></svg>'
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
    // document 级兜底：wrapper class 被装饰重写/重建时 hover 判定仍可靠（按几何而非类名）
    const onDocMove = (e: MouseEvent) => {
      const r = this.table.getBoundingClientRect()
      const inTable = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
      // 左上角热区：容忍鼠标在表格外侧朝手柄移动
      const inCorner = e.clientX >= r.left - 26 && e.clientX <= r.left + 26 && e.clientY >= r.top - 26 && e.clientY <= r.top + 26
      if (inTable || inCorner) show()
      else if (h.classList.contains('pm-shown')) scheduleHide()
    }
    window.document.addEventListener('mousemove', onDocMove)
    this.destroyFn = () => {
      window.document.removeEventListener('mousemove', onDocMove)
      if (hideTimer) clearTimeout(hideTimer)
    }
    h.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const pos = this.getPos()
      const v = this.view
      if (pos === undefined || pos < 0) return
      const doc = v.state.doc
      const tableNode = doc.nodeAt(pos)
      if (!tableNode || tableNode.childCount === 0) return
      // 全表 CellSelection：anchor = 首行首格，head = 末行末格
      let lastRowStart = pos + 1
      let lastRow: PMNode | null = null
      tableNode.forEach((row: PMNode, off: number) => { lastRowStart = pos + 1 + off; lastRow = row })
      if (!lastRow) return
      let lastCellStart = lastRowStart + 1
      const lr: PMNode = lastRow
      lr.forEach((cell: PMNode, off: number) => { lastCellStart = Math.max(lastCellStart, lastRowStart + 1 + off) })
      try {
        const tr = v.state.tr.setSelection(CellSelection.create(doc, pos + 2, lastCellStart))
        v.dispatch(tr.scrollIntoView())
        v.focus()
      } catch (err) {
        // 全选失败必须有痕迹：否则手柄点击静默无效果，难以定位
        try { console.error('TABLE_HANDLE_SELECT_FAIL', err) } catch { /* ignore */ }
      }
    })
    this.dom.appendChild(h)
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
          if (w > 0) tr.setNodeMarkup(cellOff, undefined, { ...cell.attrs, colwidth: Math.max(CELL_MIN_W, Math.round(w)) })
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
    tableEl.style.cursor = ''
  }

  const finishDrag = () => {
    if (!drag) return
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
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
          if (w > 0) tr.setNodeMarkup(cellOff, undefined, { ...cell.attrs, colwidth: Math.max(CELL_MIN_W, Math.round(w)) })
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

  return new Plugin({
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
          // 悬停检测：光标靠近边框 → resize 光标（对齐 MS Word）
          const ctx = findTableCtx(view, e)
          if (!ctx) {
            if (hoverTable) { hoverTable.style.cursor = ''; hoverTable = null }
            return false
          }
          if (hoverTable && hoverTable !== ctx.tableEl) hoverTable.style.cursor = ''
          hoverTable = ctx.tableEl
          const z = Math.max(0.1, getZoom() || 1)
          const tRect = ctx.tableEl.getBoundingClientRect()
          const lx = (e.clientX - tRect.left) / z
          const ly = (e.clientY - tRect.top) / z
          const nearX = nearestIdx(colBoundaries(ctx.tableEl, z).xs, lx, EDGE_TOLERANCE)
          const nearY = nearestIdx(rowBoundaries(ctx.tableEl, z), ly, EDGE_TOLERANCE)
          ctx.tableEl.style.cursor = nearX >= 0 ? 'col-resize' : nearY >= 0 ? 'row-resize' : ''
          return false
        },
        mousedown(view: EditorView, event: Event): boolean {
          const e = event as MouseEvent
          if (e.button !== 0 || drag) return false
          const ctx = findTableCtx(view, e)
          if (!ctx) return false
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
      if (w > 0) tr.setNodeMarkup(cellOff, undefined, { ...cell.attrs, colwidth: Math.max(CELL_MIN_W, Math.round(w)) })
      c += cs
      cellOff += cell.nodeSize
    })
    rowOff += row.nodeSize
  })
  view.dispatch(tr)
  return true
}
