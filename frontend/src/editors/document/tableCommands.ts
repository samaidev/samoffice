// 表格操作命令：合并、拆分、添加/删除行列
// 参考 prosemirror-tables 的核心逻辑，简化实现
import { Transaction, NodeSelection } from 'prosemirror-state'

// 获取当前选区所在的表格信息
interface TableInfo {
  tablePos: number
  tableNode: any
  startRow: number
  startCol: number
  endRow: number
  endCol: number
}

function getTableInfo(state: any): TableInfo | null {
  const { $from, $to } = state.selection
  let tableDepth = -1
  let tablePos = -1
  let tableNode: any = null

  // 找到表格节点
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type.name === 'table') {
      tableDepth = d
      tablePos = $from.before(d)
      tableNode = node
      break
    }
  }
  if (!tableNode) return null

  // 构建"单元格起始位置 → 行列号"映射（考虑 rowspan/colspan 占位）。
  // 注意：doc 位置偏移（pos - tablePos）与"第几个单元格"是两回事，
  // 旧实现 findRowCol 用单元格序号去比位置偏移，永远匹配不上，
  // 导致光标在单元格内时 getTableInfo 返回 null —— 边框等命令全部静默失效。
  const cellPosMap = new Map<number, { row: number; col: number }>()
  const occupied: number[][] = []
  let rowOffset = 0
  for (let r = 0; r < tableNode.childCount; r++) {
    const row = tableNode.child(r)
    let c = 0
    while (occupied[r] && occupied[r][c]) c++
    let cellOffset = 0
    for (let i = 0; i < row.childCount; i++) {
      const cell = row.child(i)
      const rs = cell.attrs.rowspan || 1
      const cs = cell.attrs.colspan || 1
      cellPosMap.set(tablePos + 1 + rowOffset + 1 + cellOffset, { row: r, col: c })
      for (let ri = r; ri < r + rs; ri++) {
        if (!occupied[ri]) occupied[ri] = []
        for (let ci = c; ci < c + cs; ci++) occupied[ri][ci] = 1
      }
      c += cs
      cellOffset += cell.nodeSize
    }
    rowOffset += row.nodeSize
  }

  // 计算选中范围的行列
  let startRow = Infinity, startCol = Infinity, endRow = -1, endCol = -1
  let cellFound = false

  // CellSelection（行/列/框选单元格）的 from/to 只覆盖第一个 range，
  // 必须用 $anchorCell/$headCell 求矩形范围，否则边框等命令只作用于一个格子。
  const anySel = state.selection as any
  if (anySel.$anchorCell && anySel.$headCell) {
    const a = cellPosMap.get(anySel.$anchorCell.pos)
    const h = cellPosMap.get(anySel.$headCell.pos)
    if (a && h) {
      startRow = Math.min(a.row, h.row)
      startCol = Math.min(a.col, h.col)
      endRow = Math.max(a.row, h.row)
      endCol = Math.max(a.col, h.col)
      cellFound = true
    }
  }

  if (!cellFound) {
    state.doc.nodesBetween($from.pos, $to.pos, (node: any, pos: number) => {
      if (node.type.name === 'table_cell') {
        // pos 为单元格节点起始位置
        const rc = cellPosMap.get(pos)
        if (rc) {
          cellFound = true
          startRow = Math.min(startRow, rc.row)
          startCol = Math.min(startCol, rc.col)
          endRow = Math.max(endRow, rc.row + (node.attrs.rowspan || 1) - 1)
          endCol = Math.max(endCol, rc.col + (node.attrs.colspan || 1) - 1)
        }
      }
    })
  }

  if (!cellFound) {
    // 单光标在单元格内
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d)
      if (node.type.name === 'table_cell') {
        const rc = cellPosMap.get($from.before(d))
        if (rc) {
          startRow = endRow = rc.row
          startCol = endCol = rc.col
          cellFound = true
        }
        break
      }
    }
  }

  if (!cellFound) return null
  return { tablePos, tableNode, startRow, startCol, endRow, endCol }
}

// ============================================================
// round52（问题3）：网格模型工具 —— 合并/拆分的正确算法基础。
//
// 旧 mergeCells/splitCell 的错乱根因（e2e 实锤：4x4 合并 2x2 变成 5 行
// [3,2,4,4,4]，拆分变成 6 行）：
//   1. 多步 replaceWith 全部用旧 doc 的位置 —— 第一步替换后后续位置全部偏移；
//   2. 行位置用 r * row.nodeSize —— 行高不同/含合并格时 nodeSize 不是等差，
//      必须累加每行 nodeSize；
//   3. splitCell 的 rowspan>1 分支用 tableNode.child(r)（旧结构）拼新行，
//      与已替换的行叠加出新行。
//
// 新算法（与 prosemirror-tables 同思路）：
//   表格先展开为二维网格（每格记录源单元格 + 网格行列），
//   在网格上做合并/拆分变换，最后一次性 replaceWith 整个表格。
//   单步事务、无位置漂移、无行数膨胀。
// ============================================================

// 网格单元：源单元格 + 它在网格中的锚点行列
interface GridCell {
  cell: any        // 源 table_cell 节点（PM node）
  anchorRow: number // rowspan 扩展的锚点行（= 所在行）
  anchorCol: number
}

// 把表格展开为 rows x cols 网格。grid[r][c] = 源单元格（同一合并格的
// 所有被覆盖格都指向同一个源 cell + 锚点）。返回 { grid, rows, cols }。
function expandGrid(tableNode: any): { grid: (GridCell | null)[][]; rows: number; cols: number } {
  const rows = tableNode.childCount
  const occupied: (GridCell | null)[][] = []
  let maxCols = 0
  for (let r = 0; r < rows; r++) {
    const row = tableNode.child(r)
    if (!occupied[r]) occupied[r] = []
    let c = 0
    for (let i = 0; i < row.childCount; i++) {
      const cell = row.child(i)
      const rs = cell.attrs.rowspan || 1
      const cs = cell.attrs.colspan || 1
      while (occupied[r][c]) c++
      const gc: GridCell = { cell, anchorRow: r, anchorCol: c }
      for (let ri = r; ri < r + rs; ri++) {
        if (!occupied[ri]) occupied[ri] = []
        for (let ci = c; ci < c + cs; ci++) occupied[ri][ci] = gc
      }
      c += cs
      if (c > maxCols) maxCols = c
    }
  }
  return { grid: occupied, rows, cols: maxCols }
}

// 网格 → 新表格行数组（每个网格格生成一个 table_cell 节点；content 取
// 源 cell 内容 —— 合并/拆分不丢文字）。rowType 用源行（保 height attr）。
function gridToRows(grid: (GridCell | null)[][], rows: number, cols: number, srcTable: any) {
  const cellType = srcTable.child(0).child(0).type
  const rowType = srcTable.child(0).type
  const outRows: any[] = []
  for (let r = 0; r < rows; r++) {
    const cells: any[] = []
    for (let c = 0; c < cols; c++) {
      const gc = grid[r][c]
      if (!gc) {
        // 网格空洞（结构异常兜底）：空段落格
        cells.push(cellType.create({ rowspan: 1, colspan: 1, isHeader: false, align: '' }, cellType.schema.nodes.paragraph.create()))
        continue
      }
      if (gc.anchorRow === r && gc.anchorCol === c) {
        // 锚点：真实渲染的格（attrs 保留源格，但 rowspan/colspan 由网格扩展重算）
        let rs = 1, cs = 1
        while (r + rs < rows && grid[r + rs][c] === gc) rs++
        while (c + cs < cols && grid[r][c + cs] === gc) cs++
        const src = gc.cell
        const newAttrs: any = { ...src.attrs }
        if (newAttrs.rowspan !== rs || newAttrs.colspan !== cs) {
          newAttrs.rowspan = rs
          newAttrs.colspan = cs
        }
        // colspan=1/rowspan=1 是默认值 —— 显式写 1 保持一致（schema 默认 1）
        cells.push(cellType.create(newAttrs, src.content))
      }
      // 非锚点：被合并覆盖的网格位，不生成节点（由锚点格的 span 覆盖）
    }
    // round52（问题3）：整行被 rowspan 覆盖（无物理格）也必须保留行节点 ——
    // schema table_row content 已放宽为 table_cell*（对齐 prosemirror-tables 上游），
    // 丢弃行会让后续行的 rowspan 语义错乱。
    const srcRow = srcTable.child(Math.min(r, srcTable.childCount - 1))
    outRows.push(rowType.create({ ...srcRow.attrs }, cells))
  }
  return outRows
}

// 一次性替换整个表格（单步事务 —— 修复位置漂移的根）
function replaceTable(state: any, dispatch: any, tablePos: number, tableNode: any, newRows: any[]): boolean {
  if (newRows.length === 0) return false
  const newTable = tableNode.type.create({ ...tableNode.attrs }, newRows)
  const tr = state.tr.replaceWith(tablePos, tablePos + tableNode.nodeSize, newTable)
  // 把选区放回表格内（合并后光标落第一个受影响格子）
  const $pos = tr.doc.resolve(tablePos + 2)
  try {
    const TextSelection = (state.selection.constructor as any) // TextSelection
    if (TextSelection && TextSelection.near) tr.setSelection(TextSelection.near($pos))
  } catch { /* 选区放置失败不影响结构替换 */ }
  dispatch(tr)
  return true
}

// 合并选中单元格（round52 重写：网格算法）
export function mergeCells(state: any, dispatch: any): boolean {
  const info = getTableInfo(state)
  if (!info) return false
  if (info.startRow === info.endRow && info.startCol === info.endCol) return false

  const { tablePos, tableNode, startRow, startCol, endRow, endCol } = info
  const { grid, rows, cols } = expandGrid(tableNode)

  // 选区矩形内所有源格子收集（去重 —— 合并格可能只占部分）
  const covered = new Set<any>()
  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      const gc = grid[r][c]
      if (gc) covered.add(gc)
    }
  }
  if (covered.size < 2 && grid[startRow][startCol] && grid[startRow][startCol].cell.attrs.rowspan === endRow - startRow + 1 && grid[startRow][startCol].cell.attrs.colspan === endCol - startCol + 1) return false

  // 内容拼接：按网格行列顺序（先锚点格内容，再其余），全部合进锚点格。
  // 每个源格的块内容直接搬（空段落跳过 —— 避免合并格出现成串空行）。
  const mergedContent: any[] = []
  const sorted = Array.from(covered).sort((a: any, b: any) => (a.anchorRow - b.anchorRow) || (a.anchorCol - b.anchorCol))
  for (const gc of sorted) {
    gc.cell.forEach((child: any) => {
      if (child.type.name === 'paragraph' && child.content.size === 0) return
      mergedContent.push(child)
    })
  }
  if (mergedContent.length === 0) {
    mergedContent.push(tableNode.child(0).child(0).type.schema.nodes.paragraph.create())
  }

  // 构造合并格（锚点 = 选区左上角网格位）
  const cellType = tableNode.child(0).child(0).type
  const anchorSrc = grid[startRow][startCol]!.cell
  const mergedCell = cellType.create(
    { ...anchorSrc.attrs, rowspan: endRow - startRow + 1, colspan: endCol - startCol + 1 },
    mergedContent,
  )

  // 重建网格：选区矩形内全部指向新的合并格
  const mergedGC: GridCell = { cell: mergedCell, anchorRow: startRow, anchorCol: startCol }
  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) grid[r][c] = mergedGC
  }

  const newRows = gridToRows(grid, rows, cols, tableNode)
  return replaceTable(state, dispatch, tablePos, tableNode, newRows)
}

// 拆分单元格（round52 重写：网格算法）
// 支持选区内多个合并格同时拆分（对齐 Word：框选拆分作用于全部选中格）。
export function splitCell(state: any, dispatch: any): boolean {
  const info = getTableInfo(state)
  if (!info) return false
  const { tablePos, tableNode, startRow, startCol, endRow, endCol } = info
  const { grid, rows, cols } = expandGrid(tableNode)

  // 找出选区覆盖的所有源合并格（span>1 才需要拆）
  const toSplit = new Set<any>()
  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      const gc = grid[r][c]
      if (!gc) continue
      const rs = gc.cell.attrs.rowspan || 1
      const cs = gc.cell.attrs.colspan || 1
      if (rs > 1 || cs > 1) toSplit.add(gc)
    }
  }
  if (toSplit.size === 0) return false

  const cellType = tableNode.child(0).child(0).type
  for (const gc of toSplit) {
    const src = gc.cell
    const r0 = gc.anchorRow, c0 = gc.anchorCol
    let rs = 1, cs = 1
    while (r0 + rs < rows && grid[r0 + rs][c0] === gc) rs++
    while (c0 + cs < cols && grid[r0][c0 + cs] === gc) cs++
    // 拆分：锚点位保留源内容 + span=1，其余每格一个空段落格（置 null，
    // gridToRows 的 null 分支生成空格）
    const keepAttrs = { ...src.attrs, rowspan: 1, colspan: 1 }
    const keepCell = cellType.create(keepAttrs, src.content)
    grid[r0][c0] = { cell: keepCell, anchorRow: r0, anchorCol: c0 }
    for (let r = r0; r < r0 + rs; r++) {
      for (let c = c0; c < c0 + cs; c++) {
        if (r === r0 && c === c0) continue
        grid[r][c] = null
      }
    }
  }

  const newRows = gridToRows(grid, rows, cols, tableNode)
  return replaceTable(state, dispatch, tablePos, tableNode, newRows)
}

// 添加行
export function addRowAfter(state: any, dispatch: any): boolean {
  const { $from } = state.selection
  let rowNode: any = null
  let rowPos = -1
  let tableNode: any = null
  let tablePos = -1

  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type.name === 'table_row' && !rowNode) {
      rowNode = node
      rowPos = $from.before(d)
    }
    if (node.type.name === 'table') {
      tableNode = node
      tablePos = $from.before(d)
      break
    }
  }
  if (!rowNode) return false

  const colCount = rowNode.childCount
  const cellType = rowNode.child(0).type
  const newCells: any[] = []
  for (let i = 0; i < colCount; i++) {
    newCells.push(cellType.create(
      { rowspan: 1, colspan: 1, isHeader: false, align: '' },
      cellType.schema.nodes.paragraph.create()
    ))
  }
  const newRow = rowNode.type.create(null, newCells)
  const tr = state.tr.insert(rowPos + rowNode.nodeSize, newRow)
  dispatch(tr)
  return true
}

// 添加列
export function addColumnAfter(state: any, dispatch: any): boolean {
  const { $from } = state.selection
  let tableNode: any = null
  let tablePos = -1
  let cellIdxInRow = -1

  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type.name === 'table_cell' && cellIdxInRow < 0) {
      // 找列索引
      const row = $from.node(d - 1)
      row.forEach((child: any, _offset: number, idx: number) => {
        if (child === node) cellIdxInRow = idx
      })
    }
    if (node.type.name === 'table') {
      tableNode = node
      tablePos = $from.before(d)
      break
    }
  }
  if (!tableNode || cellIdxInRow < 0) return false

  const tr = state.tr
  let rowOffset = tablePos + 1

  tableNode.forEach((row: any, _rOffset: number, rIdx: number) => {
    const cellType = row.child(0).type
    const newCell = cellType.create(
      { rowspan: 1, colspan: 1, isHeader: rIdx === 0, align: '' },
      cellType.schema.nodes.paragraph.create()
    )
    // 找到该行第 cellIdxInRow 个单元格的位置
    let cellPos = rowOffset
    for (let i = 0; i <= cellIdxInRow; i++) {
      cellPos += row.child(i).nodeSize
    }
    tr.insert(cellPos, newCell)
    rowOffset += row.nodeSize
  })

  dispatch(tr)
  return true
}

// 删除行
export function deleteRow(state: any, dispatch: any): boolean {
  const { $from } = state.selection
  let rowNode: any = null
  let rowPos = -1
  let tableNode: any = null

  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type.name === 'table_row' && !rowNode) {
      rowNode = node
      rowPos = $from.before(d)
    }
    if (node.type.name === 'table') {
      tableNode = node
      break
    }
  }
  if (!rowNode || tableNode.childCount <= 1) return false

  const tr = state.tr.delete(rowPos, rowPos + rowNode.nodeSize)
  dispatch(tr)
  return true
}

// 删除列
export function deleteColumn(state: any, dispatch: any): boolean {
  const { $from } = state.selection
  let tableNode: any = null
  let tablePos = -1
  let cellIdxInRow = -1

  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type.name === 'table_cell' && cellIdxInRow < 0) {
      const row = $from.node(d - 1)
      row.forEach((child: any, _offset: number, idx: number) => {
        if (child === node) cellIdxInRow = idx
      })
    }
    if (node.type.name === 'table') {
      tableNode = node
      tablePos = $from.before(d)
      break
    }
  }
  if (!tableNode || cellIdxInRow < 0) return false

  // 检查是否只剩一列
  if (tableNode.child(0).childCount <= 1) return false

  const tr = state.tr
  // 从后往前删除每行对应列
  const rowsToDelete: { pos: number; size: number }[] = []
  let rowOffset = tablePos + 1

  tableNode.forEach((row: any) => {
    let cellPos = rowOffset
    for (let i = 0; i < cellIdxInRow; i++) {
      cellPos += row.child(i).nodeSize
    }
    const cellSize = row.child(cellIdxInRow).nodeSize
    rowsToDelete.push({ pos: cellPos, size: cellSize })
    rowOffset += row.nodeSize
  })

  for (let i = rowsToDelete.length - 1; i >= 0; i--) {
    tr.delete(rowsToDelete[i].pos, rowsToDelete[i].pos + rowsToDelete[i].size)
  }

  dispatch(tr)
  return true
}

// 设置单元格对齐
export function setCellAlign(state: any, dispatch: any, align: string): boolean {
  const { $from } = state.selection
  let cellNode: any = null
  let cellPos = -1

  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type.name === 'table_cell') {
      cellNode = node
      cellPos = $from.before(d)
      break
    }
  }
  if (!cellNode) return false

  const tr = state.tr.setNodeMarkup(cellPos, undefined, { ...cellNode.attrs, align }, [])
  dispatch(tr)
  return true
}

// 设置单元格垂直对齐（顶/中/底，对齐 MS Word 表格工具的"垂直对齐方式"）。
// 与 setCellAlign 不同：支持选区内多个单元格同时设置（框选多格后一键对齐）。
export function setCellVAlign(state: any, dispatch: any, vAlign: string): boolean {
  const { $from, $to } = state.selection
  const tr = state.tr
  let changed = false
  state.doc.nodesBetween($from.pos, $to.pos, (node: any, pos: number) => {
    if (node.type.name === 'table_cell') {
      // 跳过被 rowspan 覆盖的占位（nodeAt 命中即真实单元格）
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, vAlign }, [])
      changed = true
      return false // 不深入单元格内部
    }
    return true
  })
  if (!changed) {
    // 光标在单元格内但选区未跨单元格：回退到单格路径
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d)
      if (node.type.name === 'table_cell') {
        tr.setNodeMarkup($from.before(d), undefined, { ...node.attrs, vAlign }, [])
        changed = true
        break
      }
    }
  }
  if (!changed) return false
  dispatch(tr)
  return true
}

// ============ 单元格边框（对齐 MS Word 表格工具"边框"预设） ============
// 边框四边编码：上/右/下/左（'1'=有线 '0'=无线），与 schema.table_cell.borders 一致。

// 遍历表格全部单元格（考虑 rowspan/colspan 占位），回调 (cell, r, c, docPos, tr)。
// 返回值：是否有任何单元格被回调（= 表格与选区有效）。
function forEachCellInSelection(state: any, tr: any, fn: (cell: any, r: number, c: number, pos: number, tr: any) => void): boolean {
  const info = getTableInfo(state)
  if (!info) return false
  const { tablePos, tableNode, startRow, startCol, endRow, endCol } = info
  let rowOffset = 0
  const occupied: number[][] = []
  for (let r = 0; r < tableNode.childCount; r++) {
    const row = tableNode.child(r)
    let c = 0
    while (occupied[r] && occupied[r][c]) c++
    let cellOffset = 0
    for (let i = 0; i < row.childCount; i++) {
      const cell = row.child(i)
      const rs = cell.attrs.rowspan || 1
      const cs = cell.attrs.colspan || 1
      const inSel = r >= startRow && r <= endRow && c >= startCol && c <= endCol
      if (inSel) {
        const pos = tablePos + 1 + rowOffset + 1 + cellOffset
        fn(cell, r, c, pos, tr)
      }
      for (let ri = r; ri < r + rs; ri++) {
        if (!occupied[ri]) occupied[ri] = []
        for (let ci = c; ci < c + cs; ci++) occupied[ri][ci] = 1
      }
      c += cs
      cellOffset += cell.nodeSize
    }
    rowOffset += row.nodeSize
  }
  return true
}

// 解码当前边框编码为 [top,right,bottom,left] 布尔；未自定义时四边全有（默认线）。
function decodeSides(enc: string): boolean[] {
  if (enc && enc.length === 4) return enc.split('').map(ch => ch === '1')
  return [true, true, true, true]
}

// 边框预设（对齐 MS Word 下拉网格）：
// all 所有框线 | outer 外侧框线 | inner 内部框线 | none 无框线
// top 上框线 | bottom 下框线 | left 左框线 | right 右框线
// innerH 内部横线 | innerV 内部竖线
// opts.color / opts.width 提供时同时设置线色（hex）/线宽（pt，0=恢复默认 1px）。
//
// round68 修复（用户主诉"不管选左框线还是右框线，所有边框按钮都失效，
// 都会弄成全边框"）—— 两个根因：
// ① 旧实现对方位预设只做"加线"（sides[n]=true），而新表格单元格未自定义
//    边框时 decodeSides 默认四边全有 → 左/右/上/下/内部/外侧点了都还是
//    全边框，视觉上"全部失效"。MS Word 的预设是【切换】语义：参与边当前
//    全开 → 全部去掉；否则 → 全部加上（all/none 保持绝对设置）。
// ② 表格是 border-collapse:collapse（schema.ts table toDOM），折叠模式下
//    共享边由相邻两格中"较强"一侧绘制 —— 只关掉本格的边，邻居的反向边
//    仍把线画出来。因此去线必须【双侧同删】：关掉某格的边时同步关掉
//    相邻格的反向边（对齐 Word 的共享边模型）。
export function setCellBorders(state: any, dispatch: any, preset: string, opts?: { color?: string; width?: number }): boolean {
  if (!dispatch) return !!getTableInfo(state)
  const info = getTableInfo(state)
  if (!info) return false
  const { tableNode, tablePos, startRow, startCol, endRow, endCol } = info
  const tr = state.tr

  // 全表网格坐标图（rowspan/colspan 展开到格子坐标）：grid[r][c] = { pos, attrs }
  const grid: { pos: number; attrs: any }[][] = []
  let rowOffset = 0
  for (let r = 0; r < tableNode.childCount; r++) {
    const row = tableNode.child(r)
    let cellOffset = 0
    let c = 0
    if (!grid[r]) grid[r] = []
    for (let i = 0; i < row.childCount; i++) {
      const cell = row.child(i)
      const rs = cell.attrs.rowspan || 1
      const cs = cell.attrs.colspan || 1
      while (grid[r][c]) c++
      for (let ri = r; ri < r + rs; ri++) {
        if (!grid[ri]) grid[ri] = []
        for (let ci = c; ci < c + cs; ci++) grid[ri][ci] = { pos: tablePos + 1 + rowOffset + 1 + cellOffset, attrs: cell.attrs }
      }
      c += cs
      cellOffset += cell.nodeSize
    }
    rowOffset += row.nodeSize
  }

  // 预设"参与边"矩阵（true/false=该边由本预设管辖，undefined=不管辖）；
  // 边序 [top,right,bottom,left]。单格点内部框线/横线/竖线时全表均无参与边。
  const part = (r: number, c: number): (boolean | undefined)[] => {
    switch (preset) {
      case 'all': case 'none': return [true, true, true, true]
      case 'outer': return [r === startRow, c === endCol, r === endRow, c === startCol]
      case 'inner': return [r > startRow, c < endCol, r < endRow, c > startCol]
      case 'innerH': return [r > startRow, undefined, r < endRow, undefined]
      case 'innerV': return [undefined, c < endCol, undefined, c > startCol]
      case 'top': return [r === startRow, undefined, undefined, undefined]
      case 'bottom': return [undefined, undefined, r === endRow, undefined]
      case 'left': return [undefined, undefined, undefined, c === startCol]
      case 'right': return [undefined, c === endCol, undefined, undefined]
      default: return []
    }
  }

  // 选区矩形覆盖的格子（按节点去重，colspan 只处理一次）
  const sel = new Map<number, { sides: boolean[]; attrs: any; p: (boolean | undefined)[] }>()
  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      const g = grid[r] && grid[r][c]
      if (!g || sel.has(g.pos)) continue
      sel.set(g.pos, { sides: decodeSides(g.attrs.borders), attrs: g.attrs, p: part(r, c) })
    }
  }

  // 切换决策（MS Word 语义）：所有参与边当前全开 → 关；否则 → 开。
  const decision = preset === 'all' ? true
    : preset === 'none' ? false
    : (() => {
      let any = false, allOn = true
      for (const it of sel.values()) it.p.forEach((pj, i) => { if (pj) { any = true; if (!it.sides[i]) allOn = false } })
      return any ? !allOn : null // 无参与边（如单格点"内部框线"）：无事可做
    })()
  if (decision === null) return false

  let changed = false
  const mkAttrs = (attrs: any, sides: boolean[]): any => {
    const nxt: any = { ...attrs, borders: sides.map(b => (b ? '1' : '0')).join('') }
    if (opts && opts.color) nxt.borderColor = opts.color
    if (opts && opts.width !== undefined) nxt.borderW = opts.width
    return nxt
  }
  // 选区外邻居的待写状态（可能被多条传播请求命中，需累积）
  const out = new Map<number, { attrs: any; sides: boolean[] }>()
  const neighborOff = (r: number, c: number, side: number) => {
    const g = grid[r] && grid[r][c]
    if (!g || sel.has(g.pos)) return // 选区内邻居的边由决策统一处理
    const cur = out.get(g.pos) || { attrs: g.attrs, sides: decodeSides(g.attrs.borders) }
    if (!cur.sides[side]) return
    cur.sides[side] = false
    out.set(g.pos, cur)
  }
  // 按网格坐标遍历：写盘（按节点去重，colspan 一格一次）+ 去线传播（需要坐标定位邻居）
  const done = new Set<number>()
  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      const g = grid[r] && grid[r][c]
      if (!g) continue
      const it = sel.get(g.pos)!
      if (!done.has(g.pos)) {
        done.add(g.pos)
        const next = [...it.sides]
        it.p.forEach((pj, i) => { if (pj) next[i] = decision })
        // round69：颜色/线宽是独立维度 —— 边框编码未变时（已是目标预设）也要写入
        // borderColor/borderW（用户改色/改宽后点预设，旧逻辑因 sides 不变直接跳过 →
        // 颜色粗细永不生效 —— 两个 e2e 用例红色/3pt 失败的根因）。
        const encSame = next.map(b => (b ? '1' : '0')).join('') === it.sides.map(b => (b ? '1' : '0')).join('')
        const styled = mkAttrs(it.attrs, next)
        const colorChanged = opts && opts.color && opts.color !== it.attrs.borderColor
        const widthChanged = opts && opts.width !== undefined && opts.width !== it.attrs.borderW
        if (!encSame || colorChanged || widthChanged) {
          tr.setNodeMarkup(g.pos, undefined, styled, [])
          changed = true
        }
      }
      // 去线传播：本格被关掉的边，把选区外邻居的反向边一并关掉
      // （collapse 模式下共享边由较强一侧绘制，单侧关不掉）
      if (!decision) {
        if (it.p[0]) neighborOff(r - 1, c, 2)
        if (it.p[1]) neighborOff(r, c + 1, 3)
        if (it.p[2]) neighborOff(r + 1, c, 0)
        if (it.p[3]) neighborOff(r, c - 1, 1)
      }
    }
  }
  for (const [pos, cur] of out) {
    tr.setNodeMarkup(pos, undefined, mkAttrs(cur.attrs, cur.sides), [])
    changed = true
  }
  if (!changed) return false
  dispatch(tr)
  return true
}
