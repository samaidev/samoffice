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

// 合并选中单元格
export function mergeCells(state: any, dispatch: any): boolean {
  const info = getTableInfo(state)
  if (!info) return false
  if (info.startRow === info.endRow && info.startCol === info.endCol) return false

  const { tablePos, tableNode, startRow, startCol, endRow, endCol } = info
  const rowSpan = endRow - startRow + 1
  const colSpan = endCol - startCol + 1

  // 收集所有要合并的单元格内容
  let cellContent: any[] = []
  let absCellIdx = 0
  const cellsToMerge = new Set<string>()
  const colCounts: number[][] = []

  for (let r = 0; r < tableNode.childCount; r++) {
    const row = tableNode.child(r)
    let c = 0
    while (colCounts[r] && colCounts[r][c]) c++

    for (let i = 0; i < row.childCount; i++) {
      const cell = row.child(i)
      const rs = cell.attrs.rowspan || 1
      const cs = cell.attrs.colspan || 1

      if (r >= startRow && r <= endRow && c >= startCol && c <= endCol) {
        cellsToMerge.add(`${r}-${c}-${i}`)
        // 收集内容
        cell.forEach((child: any) => {
          cellContent.push(child)
        })
      }

      for (let ri = r; ri < r + rs; ri++) {
        if (!colCounts[ri]) colCounts[ri] = []
        for (let ci = c; ci < c + cs; ci++) colCounts[ri][ci] = 1
      }
      c += cs
      absCellIdx++
    }
  }

  // 重建表格：第一个选中单元格变为合并单元格，其余删除
  let tr = state.tr
  let isFirst = true
  absCellIdx = 0
  const newColCounts: number[][] = []

  for (let r = 0; r < tableNode.childCount; r++) {
    const row = tableNode.child(r)
    const newRowChildren: any[] = []
    let c = 0
    while (newColCounts[r] && newColCounts[r][c]) c++

    for (let i = 0; i < row.childCount; i++) {
      const cell = row.child(i)
      const rs = cell.attrs.rowspan || 1
      const cs = cell.attrs.colspan || 1
      const inMerge = r >= startRow && r <= endRow && c >= startCol && c <= endCol

      if (inMerge && isFirst) {
        // 第一个合并单元格
        const newCell = cell.type.create({
          ...cell.attrs,
          rowspan: rowSpan,
          colspan: colSpan,
        }, cellContent.length > 0 ? cellContent : cell.content)
        newRowChildren.push(newCell)
        isFirst = false
      } else if (inMerge) {
        // 跳过（删除）
      } else {
        newRowChildren.push(cell)
      }

      for (let ri = r; ri < r + rs; ri++) {
        if (!newColCounts[ri]) newColCounts[ri] = []
        for (let ci = c; ci < c + cs; ci++) newColCounts[ri][ci] = 1
      }
      c += cs
    }

    if (newRowChildren.length > 0) {
      const newRow = row.type.create(null, newRowChildren)
      tr = tr.replaceWith(
        tablePos + 1 + r * (row.nodeSize),
        tablePos + 1 + r * (row.nodeSize) + row.nodeSize,
        newRow
      )
    }
  }

  dispatch(tr)
  return true
}

// 拆分单元格
export function splitCell(state: any, dispatch: any): boolean {
  const { $from } = state.selection
  let cellNode: any = null
  let cellPos = -1
  let rowNode: any = null
  let rowPos = -1
  let tableNode: any = null
  let tablePos = -1

  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type.name === 'table_cell' && !cellNode) {
      cellNode = node
      cellPos = $from.before(d)
    }
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

  if (!cellNode || cellNode.attrs.rowspan <= 1 && cellNode.attrs.colspan <= 1) return false

  const { rowspan, colspan, isHeader } = cellNode.attrs
  const tr = state.tr

  // 创建拆分后的单元格
  for (let r = 0; r < rowspan; r++) {
    for (let c = 0; c < colspan; c++) {
      if (r === 0 && c === 0) continue // 第一个保留位置
      const newCell = cellNode.type.create({
        rowspan: 1, colspan: 1, isHeader, align: '',
      }, cellNode.type.schema.nodes.paragraph.create())
      // 插入到原单元格后
      // 简化：直接替换原单元格为多个
    }
  }

  // 简化实现：替换原单元格为 rowspan x colspan 个单元格
  const newCells: any[] = []
  for (let r = 0; r < rowspan; r++) {
    for (let c = 0; c < colspan; c++) {
      const content = (r === 0 && c === 0) ? cellNode.content : cellNode.type.schema.nodes.paragraph.create()
      newCells.push(cellNode.type.create({ rowspan: 1, colspan: 1, isHeader, align: '' }, content))
    }
  }

  // 重建该行：可能需要新增行（如果有 rowspan > 1）
  // 简化：仅在 colspan > 1 时拆分（行内拆分）
  if (rowspan === 1 && colspan > 1) {
    tr.replaceWith(cellPos, cellPos + cellNode.nodeSize, newCells)
    dispatch(tr)
    return true
  }

  // rowspan > 1 的情况：需要在后续行添加单元格
  // 找到该单元格在行中的位置
  let cellIdxInRow = 0
  rowNode.forEach((child: any, _offset: number, idx: number) => {
    if (child === cellNode) cellIdxInRow = idx
  })

  // 替换当前行的单元格
  const newRowChildren: any[] = []
  rowNode.forEach((child: any, idx: number) => {
    if (idx === cellIdxInRow) {
      // 插入第一行的 colspan 个单元格
      for (let c = 0; c < colspan; c++) {
        newRowChildren.push(cellNode.type.create(
          { rowspan: 1, colspan: 1, isHeader, align: '' },
          c === 0 ? cellNode.content : cellNode.type.schema.nodes.paragraph.create()
        ))
      }
    } else {
      newRowChildren.push(child)
    }
  })

  tr.replaceWith(rowPos, rowPos + rowNode.nodeSize, rowNode.type.create(null, newRowChildren))

  // 在后续行添加单元格
  for (let r = 1; r < rowspan; r++) {
    const nextRow = tableNode.child(tableNode.childCount > r ? r : tableNode.childCount - 1)
    const insertCells: any[] = []
    for (let c = 0; c < colspan; c++) {
      insertCells.push(cellNode.type.create(
        { rowspan: 1, colspan: 1, isHeader, align: '' },
        cellNode.type.schema.nodes.paragraph.create()
      ))
    }
    // 在对应位置插入
    let nextRowPos = tablePos + 1
    for (let i = 0; i < r; i++) {
      nextRowPos += tableNode.child(i).nodeSize
    }
    const nextRowNode = tableNode.child(r)
    const newNextChildren: any[] = []
    let inserted = false
    nextRowNode.forEach((child: any, idx: number) => {
      if (idx === cellIdxInRow && !inserted) {
        newNextChildren.push(...insertCells)
        inserted = true
      }
      newNextChildren.push(child)
    })
    if (!inserted) newNextChildren.push(...insertCells)
    tr.replaceWith(nextRowPos, nextRowPos + nextRowNode.nodeSize, nextRowNode.type.create(null, newNextChildren))
  }

  dispatch(tr)
  return true
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

  const tr = state.tr.setNodeMarkup(cellPos, undefined, { ...cellNode.attrs, align })
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
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, vAlign })
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
        tr.setNodeMarkup($from.before(d), undefined, { ...node.attrs, vAlign })
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
export function setCellBorders(state: any, dispatch: any, preset: string, opts?: { color?: string; width?: number }): boolean {
  if (!dispatch) return !!getTableInfo(state)
  const info = getTableInfo(state)
  if (!info) return false
  const { startRow, startCol, endRow, endCol } = info
  const tr = state.tr
  let changed = false
  forEachCellInSelection(state, tr, (cell, r, c, pos, trRef) => {
    let sides = decodeSides(cell.attrs.borders)
    switch (preset) {
      case 'all': sides = [true, true, true, true]; break
      case 'none': sides = [false, false, false, false]; break
      case 'outer':
        // 外侧框线：仅选区外边缘有线，内部边缘保持原样（对齐 MS Word"外侧框线"）
        sides = [
          r === startRow ? true : sides[0],
          c === endCol ? true : sides[1],
          r === endRow ? true : sides[2],
          c === startCol ? true : sides[3],
        ]
        break
      case 'inner':
        // 内部框线：仅内部边缘有线，外边缘保持原样（对齐 MS Word"内部框线"）
        sides = [
          r > startRow ? true : sides[0],
          c < endCol ? true : sides[1],
          r < endRow ? true : sides[2],
          c > startCol ? true : sides[3],
        ]
        break
      case 'innerH': sides = [r > startRow ? true : sides[0], sides[1], r < endRow ? true : sides[2], sides[3]]; break
      case 'innerV': sides = [sides[0], c < endCol ? true : sides[1], sides[2], c > startCol ? true : sides[3]]; break
      case 'top': if (r === startRow) sides[0] = true; break
      case 'bottom': if (r === endRow) sides[2] = true; break
      case 'left': if (c === startCol) sides[3] = true; break
      case 'right': if (c === endCol) sides[1] = true; break
      default: return
    }
    const enc = sides.map(b => (b ? '1' : '0')).join('')
    const next: any = { ...cell.attrs, borders: enc }
    if (opts && opts.color) next.borderColor = opts.color
    if (opts && opts.width !== undefined) next.borderW = opts.width
    trRef.setNodeMarkup(pos, undefined, next)
    changed = true
  })
  if (!changed) return false
  dispatch(tr)
  return true
}
