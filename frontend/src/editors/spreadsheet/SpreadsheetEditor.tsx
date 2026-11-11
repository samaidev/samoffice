import { useState, useEffect, useRef } from 'react'
import { useI18n } from '../../i18n'
import { PrintDialog } from '../../components/PrintDialog'

interface Cell {
  value: string; formula?: string
  bold?: boolean; color?: string; bg?: string
  align?: 'left' | 'center' | 'right'
  italic?: boolean; under?: boolean; strike?: boolean
  fontSize?: number; fontFamily?: string
  format?: 'percent' | 'decimal' | 'general'
  // fmt：数字格式 token（与后端 io.go 约定）：percent/percent2/0.00/thousands/thousands2/int/date
  fmt?: string
  // valid：数据验证下拉列表（逗号分隔），打开 xlsx 时由后端读入，保存时写回
  valid?: string
  border?: 'thin' | 'medium' | 'thick' | 'none'
  borderColor?: string
  // 合并单元格：mergeRange = { rowSpan, colSpan } 表示此单元格是合并区域的左上角
  // 被合并覆盖的单元格用 hiddenBy = "r-c" 标记（指向左上角）
  mergeRange?: { rowSpan: number; colSpan: number }
  hiddenBy?: string
}
interface Selection {
  r1: number; c1: number; r2: number; c2: number
  mode: 'cell' | 'row' | 'col'
}
interface Props {
  initialRows?: number
  initialCols?: number
  title?: string
  // 外部传入的工作簿数据（如打开 xlsx 时），每个元素对应一个 sheet
  initialSheets?: { name: string; rows?: number; cols?: number; cells: Record<string, Cell> }[]
  // 编辑或切换 sheet 时把完整工作簿快照回传（供保存为 xlsx 使用）
  onSheetsChange?: (snapshot: { name: string; rows: number; cols: number; cells: Record<string, Cell> }[]) => void
}

type RibbonTab = 'home' | 'insert' | 'data' | 'view'

function RibbonButton({ icon, label, onClick, active, disabled, title, ...rest }: any) {
  return (
    <button onClick={onClick} disabled={disabled} title={title || label} {...rest}
      className="flex flex-col items-center justify-center gap-0.5 px-1.5 py-1 rounded-md transition-colors min-w-[44px] disabled:opacity-40"
      style={{ background: active ? 'var(--color-primary-light)' : 'transparent', color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}
      onMouseEnter={e => { if (!disabled && !active) e.currentTarget.style.background = 'var(--color-bg-alt)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}>
      <span style={{ fontSize: '15px', lineHeight: 1 }}>{icon}</span>
      <span style={{ fontSize: '10px', fontWeight: 500, whiteSpace: 'nowrap' }}>{label}</span>
    </button>
  )
}
function RibbonGroup({ label, children }: any) {
  return (
    <div className="flex flex-col items-center px-2 border-r ribbon-group" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex items-center gap-1 py-1 flex-1">{children}</div>
      <div className="text-[10px] font-medium pb-0.5 whitespace-nowrap" style={{ color: 'var(--color-text-muted)' }}>{label}</div>
    </div>
  )
}

// === SVG 图表渲染组件 ===
const CHART_COLORS = ['#4f46e5', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#6366f1']
function ChartSVG({ type, data, labels }: { type: string; data: number[]; labels: string[] }) {
  const W = 280, H = 160, pad = 24
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const n = data.length

  if (type === 'bar') {
    const bw = (W - pad * 2) / n * 0.7
    const gap = (W - pad * 2) / n * 0.3
    return (
      <svg width={W} height={H} style={{ display: 'block' }}>
        {data.map((v, i) => {
          const bh = ((v - min) / range) * (H - pad * 2)
          const x = pad + i * (bw + gap) + gap / 2
          const y = H - pad - bh
          return <g key={i}>
            <rect x={x} y={y} width={bw} height={Math.max(bh, 1)} fill={CHART_COLORS[i % CHART_COLORS.length]} rx={2} />
            <text x={x + bw / 2} y={H - pad + 12} fontSize={9} fill="var(--color-text-muted)" textAnchor="middle">{labels[i]}</text>
          </g>
        })}
        <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="var(--color-border)" />
      </svg>
    )
  }
  if (type === 'line' || type === 'area') {
    const points = data.map((v, i) => {
      const x = pad + (i / (n - 1 || 1)) * (W - pad * 2)
      const y = H - pad - ((v - min) / range) * (H - pad * 2)
      return `${x},${y}`
    }).join(' ')
    return (
      <svg width={W} height={H} style={{ display: 'block' }}>
        {type === 'area' && <polygon points={`${pad},${H - pad} ${points} ${W - pad},${H - pad}`} fill={CHART_COLORS[0]} opacity={0.2} />}
        <polyline points={points} fill="none" stroke={CHART_COLORS[0]} strokeWidth={2} />
        {data.map((v, i) => {
          const x = pad + (i / (n - 1 || 1)) * (W - pad * 2)
          const y = H - pad - ((v - min) / range) * (H - pad * 2)
          return <circle key={i} cx={x} cy={y} r={3} fill={CHART_COLORS[0]} />
        })}
        <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="var(--color-border)" />
      </svg>
    )
  }
  if (type === 'pie' || type === 'doughnut') {
    const total = data.reduce((a, b) => a + b, 0) || 1
    const cx = W / 2, cy = H / 2, r = 60, innerR = type === 'doughnut' ? 30 : 0
    let angle = -Math.PI / 2
    const slices = data.map((v, i) => {
      const slice = (v / total) * Math.PI * 2
      const x1 = cx + Math.cos(angle) * r, y1 = cy + Math.sin(angle) * r
      const x2 = cx + Math.cos(angle + slice) * r, y2 = cy + Math.sin(angle + slice) * r
      const ix1 = cx + Math.cos(angle) * innerR, iy1 = cy + Math.sin(angle) * innerR
      const ix2 = cx + Math.cos(angle + slice) * innerR, iy2 = cy + Math.sin(angle + slice) * innerR
      const large = slice > Math.PI ? 1 : 0
      const d = innerR > 0
        ? `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${innerR} ${innerR} 0 ${large} 0 ${ix1} ${iy1} Z`
        : `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`
      angle += slice
      return <path key={i} d={d} fill={CHART_COLORS[i % CHART_COLORS.length]} stroke="white" strokeWidth={1} />
    })
    return <svg width={W} height={H} style={{ display: 'block' }}>{slices}</svg>
  }
  if (type === 'scatter') {
    return (
      <svg width={W} height={H} style={{ display: 'block' }}>
        {data.map((v, i) => {
          const x = pad + (i / (n - 1 || 1)) * (W - pad * 2)
          const y = H - pad - ((v - min) / range) * (H - pad * 2)
          return <circle key={i} cx={x} cy={y} r={4} fill={CHART_COLORS[i % CHART_COLORS.length]} />
        })}
        <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="var(--color-border)" />
        <line x1={pad} y1={pad} x2={pad} y2={H - pad} stroke="var(--color-border)" />
      </svg>
    )
  }
  return null
}

// === 轻量公式引擎：支持数字、单元格引用(A1/$A$1)、范围(A1:B3)、四则运算、
//     括号、函数 SUM/AVERAGE/AVG/MIN/MAX/COUNT/ROUND/ABS ===
function colToNum(name: string): number {
  let n = 0
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}
function cellValue(data: Record<string, Cell>, ref: string): number | string {
  const m = ref.match(/^\$?([A-Za-z]+)\$?(\d+)$/)
  if (!m) return 0
  const c = colToNum(m[1]) - 1
  const r = parseInt(m[2], 10) - 1
  const cell = data[`${r}-${c}`]
  if (!cell) return 0
  const v = (cell.value ?? '').trim()
  if (v === '') return 0
  const n = Number(v)
  return isNaN(n) ? v : n
}
function rangeValues(a: string, b: string, data: Record<string, Cell>): number[] {
  const ma = a.match(/^\$?([A-Za-z]+)\$?(\d+)$/)
  const mb = b.match(/^\$?([A-Za-z]+)\$?(\d+)$/)
  if (!ma || !mb) return []
  const c1 = colToNum(ma[1]) - 1, r1 = parseInt(ma[2], 10) - 1
  const c2 = colToNum(mb[1]) - 1, r2 = parseInt(mb[2], 10) - 1
  const out: number[] = []
  for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
    for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
      const cell = data[`${r}-${c}`]
      const v = cell?.value ?? ''
      const n = Number(v)
      out.push(isNaN(n) ? 0 : n)
    }
  }
  return out
}
function applyFunc(name: string, args: any[]): number | string {
  const flat: number[] = []
  const collect = (a: any) => {
    if (Array.isArray(a)) a.forEach(collect)
    else {
      const n = typeof a === 'number' ? a : Number(a)
      flat.push(isNaN(n) ? 0 : n)
    }
  }
  switch (name.toUpperCase()) {
    case 'SUM': args.forEach(collect); return flat.reduce((s, x) => s + x, 0)
    case 'AVERAGE': case 'AVG': args.forEach(collect); return flat.length ? flat.reduce((s, x) => s + x, 0) / flat.length : 0
    case 'MIN': args.forEach(collect); return flat.length ? Math.min(...flat) : 0
    case 'MAX': args.forEach(collect); return flat.length ? Math.max(...flat) : 0
    case 'COUNT': args.forEach(collect); return flat.length
    case 'ROUND': return Math.round(Number(args[0]) * Math.pow(10, Number(args[1] ?? 0))) / Math.pow(10, Number(args[1] ?? 0))
    case 'ABS': return Math.abs(Number(args[0]))
    default: return '#NAME?'
  }
}
interface Tok { t: string; v: string }
function tokenize(s: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (/\s/.test(ch)) { i++; continue }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(s[i + 1] || ''))) {
      let j = i, str = ''
      while (j < s.length && /[0-9.]/.test(s[j])) { str += s[j]; j++ }
      toks.push({ t: 'NUM', v: str }); i = j; continue
    }
    if (/[A-Za-z]/.test(ch)) {
      let j = i, str = ''
      while (j < s.length && /[A-Za-z]/.test(s[j])) { str += s[j]; j++ }
      if (s[j] === '(') { toks.push({ t: 'FUNC', v: str }); i = j; continue }
      let k = j, nums = ''
      while (k < s.length && /[0-9]/.test(s[k])) { nums += s[k]; k++ }
      toks.push({ t: 'REF', v: str + nums }); i = nums ? k : j; continue
    }
    if (ch === '$') { i++; continue }
    if ('()+,:+-*/^'.includes(ch)) toks.push({ t: ch === '(' ? 'LPAREN' : ch === ')' ? 'RPAREN' : ch === ',' ? 'COMMA' : ch === ':' ? 'COLON' : 'OP', v: ch })
    i++
  }
  return toks
}
function evalFormula(expr: string, data: Record<string, Cell>): number | string {
  expr = expr.trim()
  if (expr.startsWith('=')) expr = expr.slice(1)
  if (expr === '') return ''
  const tokens = tokenize(expr)
  let i = 0
  const peek = () => tokens[i]
  const next = () => tokens[i++]

  function parseRangeRef(): { kind: 'ref' | 'range'; a: string; b?: string } {
    const a = next()
    if (a.t !== 'REF') throw new Error('expected ref')
    if (peek()?.t === 'COLON') { next(); const b = next(); return { kind: 'range', a: a.v, b: b.v } }
    return { kind: 'ref', a: a.v }
  }
  function parseArg(): any {
    if (peek()?.t === 'REF') {
      const r = parseRangeRef()
      return r.kind === 'range' ? rangeValues(r.a, r.b!, data) : cellValue(data, r.a)
    }
    return parseAddSub()
  }
  function parseAtom(): any {
    const tk = peek()
    if (!tk) throw new Error('unexpected end')
    if (tk.t === 'NUM') { next(); return parseFloat(tk.v) }
    if (tk.t === 'REF') {
      const r = parseRangeRef()
      return r.kind === 'range' ? rangeValues(r.a, r.b!, data) : cellValue(data, r.a)
    }
    if (tk.t === 'FUNC') {
      next()
      if (next()?.t !== 'LPAREN') throw new Error('expected (')
      const args: any[] = []
      if (peek() && peek()!.t !== 'RPAREN') {
        args.push(parseArg())
        while (peek()?.t === 'COMMA') { next(); args.push(parseArg()) }
      }
      if (next()?.t !== 'RPAREN') throw new Error('expected )')
      return applyFunc(tk.v, args)
    }
    if (tk.t === 'LPAREN') {
      next(); const v = parseAddSub()
      if (next()?.t !== 'RPAREN') throw new Error('expected )')
      return v
    }
    if (tk.t === 'OP' && tk.v === '-') { next(); return -parseAtom() as number }
    if (tk.t === 'OP' && tk.v === '+') { next(); return parseAtom() }
    throw new Error('unexpected token')
  }
  function parsePow(): any {
    let left = parseAtom()
    while (peek()?.t === 'OP' && peek()!.v === '^') { next(); left = Math.pow(Number(left), Number(parseAtom())) }
    return left
  }
  function parseMulDiv(): any {
    let left = parsePow()
    while (peek()?.t === 'OP' && (peek()!.v === '*' || peek()!.v === '/')) {
      const op = next()!.v; const right = parsePow()
      left = op === '*' ? Number(left) * Number(right) : Number(left) / Number(right)
    }
    return left
  }
  function parseAddSub(): any {
    let left = parseMulDiv()
    while (peek()?.t === 'OP' && (peek()!.v === '+' || peek()!.v === '-')) {
      const op = next()!.v; const right = parseMulDiv()
      left = op === '+' ? Number(left) + Number(right) : Number(left) - Number(right)
    }
    return left
  }
  try {
    const res = parseAddSub()
    return typeof res === 'number' && !isFinite(res) ? '#ERROR' : res
  } catch {
    return '#ERROR'
  }
}

export function SpreadsheetEditor({ initialRows = 30, initialCols = 12, title, initialSheets, onSheetsChange }: Props) {
  const { t, tf } = useI18n()

  // 初始 sheet 标签：有外部数据时按传入的 sheet 名，否则给默认两个空 sheet
  const initialSheetList = initialSheets && initialSheets.length
    ? initialSheets.map((s, i) => ({ id: i + 1, name: s.name, active: i === 0 }))
    : [
        { id: 1, name: title || t('app.sheet1'), active: true },
        { id: 2, name: 'Sheet2', active: false },
      ]

  // 根据所有 sheet 的数据估算初始行列数，避免切换大 sheet 时被裁切
  const initialDims = (() => {
    if (!initialSheets || !initialSheets.length) return { r: initialRows, c: initialCols }
    let maxR = 0, maxC = 0
    for (const sh of initialSheets) {
      for (const key of Object.keys(sh.cells || {})) {
        const [r, c] = key.split('-').map(Number)
        if (r > maxR) maxR = r
        if (c > maxC) maxC = c
      }
    }
    return { r: Math.max(initialRows, maxR + 3), c: Math.max(initialCols, maxC + 3) }
  })()

  const [rows, setRows] = useState(initialDims.r)
  const [cols, setCols] = useState(initialDims.c)
  const [data, setData] = useState<Record<string, Cell>>(initialSheets && initialSheets[0]?.cells ? initialSheets[0].cells : {})
  // 每个 sheet 独立保存单元格数据，切换不丢
  const [sheetData, setSheetData] = useState<Record<number, Record<string, Cell>>>(() => {
    const init: Record<number, Record<string, Cell>> = {}
    if (initialSheets) initialSheets.forEach((s, i) => { init[i + 1] = s.cells || {} })
    return init
  })
  const [active, setActive] = useState<{ r: number; c: number }>({ r: 0, c: 0 })
  const [selection, setSelection] = useState<Selection>({ r1: 0, c1: 0, r2: 0, c2: 0, mode: 'cell' })
  const [lastSelection, setLastSelection] = useState<Selection>({ r1: 0, c1: 0, r2: 0, c2: 0, mode: 'cell' })
  // 撤销 / 重做历史栈（针对当前工作表单元格数据）
  const [past, setPast] = useState<Record<string, Cell>[]>([])
  const [future, setFuture] = useState<Record<string, Cell>[]>([])
  const HISTORY_LIMIT = 100
  const [dragging, setDragging] = useState(false)
  const [colorMode, setColorMode] = useState<'font' | 'fill' | 'border'>('font')
  const [menu, setMenu] = useState<{ x: number; y: number; r: number; c: number } | null>(null)
  const [clipboard, setClipboard] = useState<{ r1: number; c1: number; r2: number; c2: number; cells: Record<string, Cell>; isCut: boolean } | null>(null)
  const [sheets, setSheets] = useState(initialSheetList)
  const activeId = sheets.find(s => s.active)?.id ?? 1
  // 编辑后把当前 sheet 内容同步回 sheetData，保证切换 sheet 不丢数据
  useEffect(() => {
    setSheetData(sd => ({ ...sd, [activeId]: data }))
  }, [data, activeId])
  // 把完整工作簿快照回传父组件（用于保存为 xlsx，含边框/合并/填充）
  useEffect(() => {
    if (!onSheetsChange) return
    const snapshot = sheets.map(s => ({
      name: s.name,
      rows,
      cols,
      cells: sheetData[s.id] || {},
    }))
    onSheetsChange(snapshot)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetData, sheets, rows, cols])
  const [ribbonTab, setRibbonTab] = useState<RibbonTab>('home')
  const [zoom, setZoom] = useState(100)
  const [showChartPanel, setShowChartPanel] = useState(false)
  const [showShapePanel, setShowShapePanel] = useState(false)
  const [showFuncPanel, setShowFuncPanel] = useState(false)
  const [showCondPanel, setShowCondPanel] = useState(false)
  const [showValidPanel, setShowValidPanel] = useState(false)
  // 二级颜色弹出菜单 — 统一 click 触发，避免 hover 残留导致重叠
  const [showColorPopup, setShowColorPopup] = useState(false)
  // 弹出面板互斥：同时只允许一个面板打开，避免多个弹出菜单重叠
  type PanelName = 'chart' | 'shape' | 'func' | 'cond' | 'valid' | 'color'
  const openPanel = (which: PanelName) => {
    setShowChartPanel(which === 'chart' ? !showChartPanel : false)
    setShowShapePanel(which === 'shape' ? !showShapePanel : false)
    setShowFuncPanel(which === 'func' ? !showFuncPanel : false)
    setShowCondPanel(which === 'cond' ? !showCondPanel : false)
    setShowValidPanel(which === 'valid' ? !showValidPanel : false)
    setShowColorPopup(which === 'color' ? !showColorPopup : false)
  }
  const closeAllPanels = () => {
    setShowChartPanel(false); setShowShapePanel(false); setShowFuncPanel(false)
    setShowCondPanel(false); setShowValidPanel(false); setShowColorPopup(false)
  }
  const anyPanelOpen = showChartPanel || showShapePanel || showFuncPanel || showCondPanel || showValidPanel || showColorPopup
  const [validList, setValidList] = useState('')
  const [printDialogOpen, setPrintDialogOpen] = useState(false)
  const [showGrid, setShowGrid] = useState(true)
  const [showHeadings, setShowHeadings] = useState(true)
  const [showFormulaBar, setShowFormulaBar] = useState(true)
  // 冻结窗格：冻结到当前活动单元格上方/左侧（真实 sticky 实现）
  const [freezeAt, setFreezeAt] = useState<{ r: number; c: number } | null>(null)
  const frozen = freezeAt !== null
  // 行分组（组/取消组）：折叠区间行
  const [rowGroups, setRowGroups] = useState<{ start: number; end: number; collapsed: boolean }[]>([])
  // 筛选：仅隐藏不匹配的行（非破坏性）
  const [filterRows, setFilterRows] = useState<Set<number> | null>(null)
  // 自定义视图（localStorage 命名视图：缩放/网格线/标题/公式栏/冻结）
  const [customViewNames, setCustomViewNames] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('sam-xlsx-views') || '[]') } catch { return [] }
  })
  // 工作簿视图：normal / pageBreak / pageLayout（真实叠加页分隔参考线）
  const [viewMode, setViewMode] = useState<'normal' | 'pageBreak' | 'pageLayout'>('normal')
  // 最近一次条件格式 / 导入动作，供“重新应用 / 刷新”重放
  const lastCondRef = useRef<null | (() => void)>(null)
  const lastImportRef = useRef<null | (() => void)>(null)

  // Escape 关闭所有弹出面板
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (anyPanelOpen) { closeAllPanels(); e.preventDefault() }
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [anyPanelOpen])

  // === 全局快捷键：撤销/重做、复制/剪切/粘贴、字体、清除、创建表、导航 ===
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toUpperCase()
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA'
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()

      // 撤销 / 重做（始终拦截，对标 Excel）
      if (mod && key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
      if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return }

      // 复制 / 剪切 / 粘贴
      if (mod && key === 'c') { e.preventDefault(); copyCells(false); return }
      if (mod && key === 'x') { e.preventDefault(); copyCells(true); return }
      if (mod && key === 'v') { e.preventDefault(); pasteCells(); return }

      // 字体格式 加粗 / 斜体 / 下划线
      if (mod && key === 'b') { e.preventDefault(); setCellFmtRange({ bold: !getCell(active.r, active.c).bold }); return }
      if (mod && key === 'i') { e.preventDefault(); setCellFmtRange({ italic: !getCell(active.r, active.c).italic }); return }
      if (mod && key === 'u') { e.preventDefault(); setCellFmtRange({ under: !getCell(active.r, active.c).under }); return }

      // 创建表（Excel 的 Ctrl+L）
      if (mod && key === 'l') { e.preventDefault(); createTable(); return }

      // 清除内容（Delete / Backspace，仅在非输入框时）
      if (!mod && (key === 'delete' || key === 'backspace') && !inInput) { e.preventDefault(); clearCellsContent(); return }

      // 单元格导航（方向键 / Tab / Enter），仅在非输入框时拦截
      if (!mod && !inInput) {
        const move = (dr: number, dc: number) => {
          const nr = Math.max(0, Math.min(rows - 1, active.r + dr))
          const nc = Math.max(0, Math.min(cols - 1, active.c + dc))
          selectCell(nr, nc)
        }
        if (e.key === 'ArrowUp') { e.preventDefault(); move(-1, 0); return }
        if (e.key === 'ArrowDown') { e.preventDefault(); move(1, 0); return }
        if (e.key === 'ArrowLeft') { e.preventDefault(); move(0, -1); return }
        if (e.key === 'ArrowRight') { e.preventDefault(); move(0, 1); return }
        if (e.key === 'Tab') { e.preventDefault(); move(0, e.shiftKey ? -1 : 1); return }
        if (e.key === 'Enter') { e.preventDefault(); move(1, 0); return }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, selection, clipboard, rows, cols, data, sheets, past, future])

  // 鼠标在表格外松开时也结束选区拖拽
  useEffect(() => {
    const onUp = () => { if (dragging) setDragging(false) }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [dragging])

  // 点击空白处关闭右键菜单
  useEffect(() => {
    if (!menu) return
    const onDown = () => setMenu(null)
    const onScroll = () => setMenu(null)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [menu])

  const colName = (c: number) => {
    if (c < 26) return String.fromCharCode(65 + c)
    return String.fromCharCode(65 + Math.floor(c / 26) - 1) + String.fromCharCode(65 + (c % 26))
  }
  const getCell = (r: number, c: number): Cell => data[`${r}-${c}`] || { value: '' }
  // 数字格式化显示（只影响显示，不改存储值；与后端 xlsx fmt token 对应）
  const fmtDisplay = (cell: Cell): string => {
    const v = cell.value ?? ''
    if (!cell.fmt || v === '' || isNaN(Number(v))) return v
    const n = Number(v)
    switch (cell.fmt) {
      case 'percent': return (n * 100).toFixed(0) + '%'
      case 'percent2': return (n * 100).toFixed(2) + '%'
      case '0.00': return n.toFixed(2)
      case 'thousands': return n.toLocaleString('en-US')
      case 'thousands2': return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      case 'int': return String(Math.round(n))
      default: return v
    }
  }
  const setCell = (r: number, c: number, value: string) => {
    pushHistory()
    setData(d => {
      const existing = d[`${r}-${c}`] || {}
      return { ...d, [`${r}-${c}`]: { ...existing, value } }
    })
  }
  const setCellFmt = (r: number, c: number, fmt: Partial<Cell>) => {
    pushHistory()
    setData(d => {
      const existing = d[`${r}-${c}`] || { value: '' }
      return { ...d, [`${r}-${c}`]: { ...existing, ...fmt } }
    })
  }
  // 数据变化时重算所有公式单元格的显示值（不改字体色，仅更新 value）
  useEffect(() => {
    let changed = false
    const next: Record<string, Cell> = {}
    for (const key of Object.keys(data)) {
      const cell = data[key]
      if (cell.formula) {
        const res = evalFormula(cell.formula, data)
        const sres = res === '' ? '' : (typeof res === 'number' ? String(res) : res)
        if (sres !== cell.value) {
          next[key] = { ...cell, value: sres }
          changed = true
        } else {
          next[key] = cell
        }
      } else {
        next[key] = cell
      }
    }
    if (changed) setData(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])
  // 对当前选区内所有单元格批量应用格式（字体色 / 填充 / 边框 / 加粗等）
  const setCellFmtRange = (fmt: Partial<Cell>) => {
    pushHistory()
    setData(d => {
    const nd = { ...d }
    const apply = (r: number, c: number) => {
      const existing = nd[`${r}-${c}`] || { value: '' }
      nd[`${r}-${c}`] = { ...existing, ...fmt }
    }
    if (selection.mode === 'row') {
      const r = selection.r1
      for (let c = 0; c < cols; c++) apply(r, c)
    } else if (selection.mode === 'col') {
      const c = selection.c1
      for (let r = 0; r < rows; r++) apply(r, c)
    } else {
      const r1 = Math.min(selection.r1, selection.r2)
      const r2 = Math.max(selection.r1, selection.r2)
      const c1 = Math.min(selection.c1, selection.c2)
      const c2 = Math.max(selection.c1, selection.c2)
      for (let r = r1; r <= r2; r++)
        for (let c = c1; c <= c2; c++) apply(r, c)
    }
    return nd
  })
  }
  const inSelection = (r: number, c: number) => {
    if (selection.mode === 'row') return selection.r1 === r
    if (selection.mode === 'col') return selection.c1 === c
    const r1 = Math.min(selection.r1, selection.r2)
    const r2 = Math.max(selection.r1, selection.r2)
    const c1 = Math.min(selection.c1, selection.c2)
    const c2 = Math.max(selection.c1, selection.c2)
    return r >= r1 && r <= r2 && c >= c1 && c <= c2
  }
  // 统一更新选区并记录上一次选区（供公式自动填充引用使用）
  const commitSelection = (s: Selection) => {
    setLastSelection(selection)
    setSelection(s)
  }
  // 将选区转换为 A1 表示法（如 S2:S43）；单格返回 S2
  const selToRef = (s: Selection): string => {
    const r1 = Math.min(s.r1, s.r2), r2 = Math.max(s.r1, s.r2)
    const c1 = Math.min(s.c1, s.c2), c2 = Math.max(s.c1, s.c2)
    if (isNaN(r1) || isNaN(c1)) return ''
    const a = colName(c1) + (r1 + 1)
    if (r1 === r2 && c1 === c2) return a
    return a + ':' + colName(c2) + (r2 + 1)
  }
  const selectCell = (r: number, c: number) => {
    setActive({ r, c })
    // 若点击位置已经在当前单元格选区范围内，则保持选区不变（便于整体复制/格式刷），
    // 仅点击选区外部时才重置为单个单元格
    const s = selection
    if (s.mode === 'cell') {
      const r1 = Math.min(s.r1, s.r2), r2 = Math.max(s.r1, s.r2)
      const c1 = Math.min(s.c1, s.c2), c2 = Math.max(s.c1, s.c2)
      if (r >= r1 && r <= r2 && c >= c1 && c <= c2) return
    }
    commitSelection({ r1: r, c1: c, r2: r, c2: c, mode: 'cell' })
  }
  const selectRange = (r1: number, c1: number, r2: number, c2: number) =>
    commitSelection({ r1, c1, r2, c2, mode: 'cell' })
  const selectRow = (r: number) => {
    setActive({ r, c: selection.c1 })
    commitSelection({ r1: r, c1: selection.c1, r2: r, c2: selection.c1, mode: 'row' })
  }
  const selectCol = (c: number) => {
    setActive({ r: selection.r1, c })
    commitSelection({ r1: selection.r1, c1: c, r2: selection.r1, c2: c, mode: 'col' })
  }

  // === 撤销 / 重做 ===
  // 在用户编辑动作前调用：记录当前数据快照
  const pushHistory = () => {
    setPast(p => {
      const np = [...p, JSON.parse(JSON.stringify(data))]
      if (np.length > HISTORY_LIMIT) np.shift()
      return np
    })
    setFuture([])
  }
  const undo = () => {
    if (past.length === 0) return
    const prev = past[past.length - 1]
    setFuture(f => [...f, JSON.parse(JSON.stringify(data))])
    setPast(past.slice(0, -1))
    setData(prev)
  }
  const redo = () => {
    if (future.length === 0) return
    const next = future[future.length - 1]
    setPast(p => [...p, JSON.parse(JSON.stringify(data))])
    setFuture(future.slice(0, -1))
    setData(next)
  }
  // 清除选区内容（保留格式）：Delete / Backspace 快捷键
  const clearCellsContent = () => {
    pushHistory()
    setData(d => {
      const nd = { ...d }
      const r1 = Math.min(selection.r1, selection.r2), r2 = Math.max(selection.r1, selection.r2)
      const c1 = Math.min(selection.c1, selection.c2), c2 = Math.max(selection.c1, selection.c2)
      for (let r = r1; r <= r2; r++)
        for (let c = c1; c <= c2; c++) {
          const k = `${r}-${c}`
          nd[k] = { ...(nd[k] || { value: '' }), value: '', formula: '' }
        }
      return nd
    })
  }
  // 创建表（Ctrl+L）：为选区添加表头加粗 + 细边框 + 隔行底色
  const createTable = () => {
    pushHistory()
    setData(d => {
      const nd = { ...d }
      const r1 = Math.min(selection.r1, selection.r2), r2 = Math.max(selection.r1, selection.r2)
      const c1 = Math.min(selection.c1, selection.c2), c2 = Math.max(selection.c1, selection.c2)
      for (let r = r1; r <= r2; r++)
        for (let c = c1; c <= c2; c++) {
          const k = `${r}-${c}`
          const existing = nd[k] || { value: '' }
          const isHeader = r === r1
          const zebra = !isHeader && (r - r1) % 2 === 0
          nd[k] = {
            ...existing,
            bold: isHeader ? true : existing.bold,
            border: 'thin',
            borderColor: '#9ca3af',
            bg: zebra ? '#eef2ff' : (existing.bg || 'var(--color-surface)'),
          }
        }
      return nd
    })
  }

  // === 合并单元格 ===
  // 合并从 (r1,c1) 到 (r2,c2) 的区域
  const mergeCells = (r1: number, c1: number, r2: number, c2: number) => {
    const rowSpan = Math.abs(r2 - r1) + 1
    const colSpan = Math.abs(c2 - c1) + 1
    const topR = Math.min(r1, r2), topC = Math.min(c1, c2)
    if (rowSpan === 1 && colSpan === 1) return  // 单个单元格无需合并
    pushHistory()
    setData(d => {
      const newData = { ...d }
      // 设置左上角单元格的 mergeRange
      const topLeft = newData[`${topR}-${topC}`] || { value: '' }
      newData[`${topR}-${topC}`] = { ...topLeft, mergeRange: { rowSpan, colSpan } }
      // 标记被覆盖的单元格
      for (let r = topR; r < topR + rowSpan; r++) {
        for (let c = topC; c < topC + colSpan; c++) {
          if (r === topR && c === topC) continue
          const cell = newData[`${r}-${c}`] || { value: '' }
          newData[`${r}-${c}`] = { ...cell, hiddenBy: `${topR}-${topC}` }
        }
      }
      return newData
    })
  }
  // 拆分当前合并单元格
  const splitCell = (r: number, c: number) => {
    pushHistory()
    setData(d => {
      const newData = { ...d }
      const cell = newData[`${r}-${c}`]
      if (!cell || !cell.mergeRange) return d
      const { rowSpan, colSpan } = cell.mergeRange
      // 清除左上角的 mergeRange
      newData[`${r}-${c}`] = { ...cell, mergeRange: undefined }
      // 清除被覆盖单元格的 hiddenBy
      for (let rr = r; rr < r + rowSpan; rr++) {
        for (let cc = c; cc < c + colSpan; cc++) {
          if (rr === r && cc === c) continue
          const hiddenCell = newData[`${rr}-${cc}`]
          if (hiddenCell) newData[`${rr}-${cc}`] = { ...hiddenCell, hiddenBy: undefined }
        }
      }
      return newData
    })
  }
  // 检查当前单元格是否在合并区域内
  const isMerged = (r: number, c: number): boolean => {
    const cell = getCell(r, c)
    return !!cell.mergeRange
  }
  const isHidden = (r: number, c: number): boolean => {
    const cell = getCell(r, c)
    return !!cell.hiddenBy
  }

  // === 复制 / 剪切 / 粘贴 ===
  const selRect = () => {
    if (selection.mode === 'row') return { r1: selection.r1, c1: 0, r2: selection.r1, c2: cols - 1 }
    if (selection.mode === 'col') return { r1: 0, c1: selection.c1, r2: rows - 1, c2: selection.c1 }
    return {
      r1: Math.min(selection.r1, selection.r2),
      c1: Math.min(selection.c1, selection.c2),
      r2: Math.max(selection.r1, selection.r2),
      c2: Math.max(selection.c1, selection.c2),
    }
  }
  const copyCells = (cut: boolean) => {
    const { r1, c1, r2, c2 } = selRect()
    const cells: Record<string, Cell> = {}
    let txt = ''
    for (let r = r1; r <= r2; r++) {
      let rowTxt = ''
      for (let c = c1; c <= c2; c++) {
        const cc = getCell(r, c)
        rowTxt += (cc.value ?? '') + (c === c2 ? '' : '\t')
        if (cc.value || cc.bold || cc.color || cc.bg || cc.border) cells[`${r - r1}-${c - c1}`] = cc
      }
      txt += rowTxt + (r === r2 ? '' : '\n')
    }
    navigator.clipboard?.writeText(txt).catch(() => {})
    setClipboard({ r1, c1, r2, c2, cells, isCut: cut })
  }
  const pasteCells = () => {
    if (!clipboard) return
    pushHistory()
    const baseR = active.r, baseC = active.c
    const { r1, c1, r2, c2, cells, isCut } = clipboard
    const h = r2 - r1 + 1, w = c2 - c1 + 1
    const srcRect = isCut ? { r1, c1, r2, c2 } : null
    setData(d => {
      const nd = { ...d }
      // 写入目标
      for (let r = 0; r < h; r++)
        for (let c = 0; c < w; c++) {
          const key = `${r}-${c}`
          if (cells[key]) nd[`${baseR + r}-${baseC + c}`] = { ...cells[key] }
        }
      // 剪切：清除源区域
      if (isCut && srcRect) {
        for (let r = srcRect.r1; r <= srcRect.r2; r++)
          for (let c = srcRect.c1; c <= srcRect.c2; c++)
            delete nd[`${r}-${c}`]
      }
      return nd
    })
    if (isCut) setClipboard(null)
  }

  // === 插入 / 删除 行列（重排所有单元格坐标） ===
  const rebuildRows = (d: Record<string, Cell>, fromRow: number, count: number): Record<string, Cell> => {
    // count>0 插入；count<0 删除，删除以 fromRow 起始的 |count| 行
    const nd: Record<string, Cell> = {}
    const removeCount = count < 0 ? -count : 0
    for (const key in d) {
      const [r, c] = key.split('-').map(Number)
      let nr = r
      if (count > 0) { if (r >= fromRow) nr = r + count }
      else { if (r >= fromRow + removeCount) nr = r - removeCount; else if (r >= fromRow) continue }
      nd[`${nr}-${c}`] = d[key]
    }
    return nd
  }
  const rebuildCols = (d: Record<string, Cell>, fromCol: number, count: number): Record<string, Cell> => {
    const nd: Record<string, Cell> = {}
    const removeCount = count < 0 ? -count : 0
    for (const key in d) {
      const [r, c] = key.split('-').map(Number)
      let nc = c
      if (count > 0) { if (c >= fromCol) nc = c + count }
      else { if (c >= fromCol + removeCount) nc = c - removeCount; else if (c >= fromCol) continue }
      nd[`${r}-${nc}`] = d[key]
    }
    return nd
  }
  const insertRows = (at: number, count: number) => {
    pushHistory()
    setData(d => rebuildRows(d, at, count))
    setRows(r => r + count)
    commitSelection({ r1: at, c1: selection.c1, r2: at, c2: selection.c1, mode: 'cell' })
    setActive({ r: at, c: active.c })
  }
  const deleteRows = (at: number, count: number) => {
    pushHistory()
    setData(d => rebuildRows(d, at, -count))
    setRows(r => Math.max(1, r - count))
    commitSelection({ r1: at, c1: selection.c1, r2: at, c2: selection.c1, mode: 'cell' })
    setActive({ r: at, c: active.c })
  }
  const insertCols = (at: number, count: number) => {
    pushHistory()
    setData(d => rebuildCols(d, at, count))
    setCols(c => c + count)
    commitSelection({ r1: selection.r1, c1: at, r2: selection.r1, c2: at, mode: 'cell' })
    setActive({ r: active.r, c: at })
  }
  const deleteCols = (at: number, count: number) => {
    pushHistory()
    setData(d => rebuildCols(d, at, -count))
    setCols(c => Math.max(1, c - count))
    commitSelection({ r1: selection.r1, c1: at, r2: selection.r1, c2: at, mode: 'cell' })
    setActive({ r: active.r, c: at })
  }

  // === 图表 ===
  const addChart = (type: string) => {
    // 从当前列收集数据
    const values: number[] = []
    const labels: string[] = []
    for (let r = 0; r < rows; r++) {
      const v = parseFloat(getCell(r, active.c).value)
      if (!isNaN(v)) { values.push(v); labels.push(`${r + 1}`) }
    }
    if (values.length === 0) { alert(tf('sheet.noData', 'No numeric data in this column')); return }
    setCharts(cs => [...cs, { id: Date.now(), type, data: values, labels, title: `${colName(active.c)} - ${type}` }])
    setShowChartPanel(false)
  }
  const removeChart = (id: number) => setCharts(cs => cs.filter(c => c.id !== id))
  const [charts, setCharts] = useState<{ id: number; type: string; data: number[]; labels: string[]; title: string }[]>([])
  const addSheet = () => { const id = Math.max(...sheets.map(s => s.id)) + 1; setSheetData(sd => ({ ...sd, [activeId]: data, [id]: {} })); setData({}); setSheets(s => [...s.map(x => ({ ...x, active: false })), { id, name: `Sheet${id}`, active: true }]) }

  // === 数据验证：选中区域应用下拉列表；带验证的单元格渲染下拉框，保存时写回 xlsx ===
  const applyValidation = () => {
    const list = validList.trim()
    if (!list) { alert(tf('sheet.validationNeed', '请输入逗号分隔的选项')); return }
    pushHistory()
    setData(d => {
      const nd = { ...d }
      const r1 = Math.min(selection.r1, selection.r2), r2 = Math.max(selection.r1, selection.r2)
      const c1 = Math.min(selection.c1, selection.c2), c2 = Math.max(selection.c1, selection.c2)
      for (let r = r1; r <= r2; r++)
        for (let c = c1; c <= c2; c++) {
          const k = `${r}-${c}`
          nd[k] = { ...(nd[k] || { value: '' }), valid: list }
        }
      return nd
    })
    setShowValidPanel(false)
  }
  const clearValidation = () => {
    pushHistory()
    setData(d => {
      const nd = { ...d }
      const r1 = Math.min(selection.r1, selection.r2), r2 = Math.max(selection.r1, selection.r2)
      const c1 = Math.min(selection.c1, selection.c2), c2 = Math.max(selection.c1, selection.c2)
      for (let r = r1; r <= r2; r++)
        for (let c = c1; c <= c2; c++) {
          const k = `${r}-${c}`
          if (nd[k]?.valid) nd[k] = { ...nd[k], valid: undefined }
        }
      return nd
    })
    setShowValidPanel(false)
  }

  // === 行分组：把选中的行折叠/展开（左侧行号带 -/+ 切换） ===
  const groupRows = () => {
    const r1 = Math.min(selection.r1, selection.r2), r2 = Math.max(selection.r1, selection.r2)
    if (r1 === r2) { alert(tf('sheet.groupNeedRange', '请先选中多行')); return }
    setRowGroups(g => [...g.filter(gr => gr.end < r1 || gr.start > r2), { start: r1, end: r2, collapsed: false }])
  }
  const ungroupRows = () => {
    const r1 = Math.min(selection.r1, selection.r2), r2 = Math.max(selection.r1, selection.r2)
    setRowGroups(g => g.filter(gr => gr.end < r1 || gr.start > r2))
  }
  const collapsedRows = new Set<number>()
  for (const gr of rowGroups) if (gr.collapsed) for (let r = gr.start + 1; r <= gr.end; r++) collapsedRows.add(r)
  const groupStartOf = (r: number) => rowGroups.find(gr => gr.start === r)

  // === 预测：对活动列做线性回归（最小二乘），向后续写 5 行趋势值 ===
  const forecastTrend = () => {
    const pts: { x: number; y: number }[] = []
    for (let r = 0; r < rows; r++) {
      const v = parseFloat(getCell(r, active.c).value)
      if (!isNaN(v) && isFinite(v)) pts.push({ x: r, y: v })
    }
    if (pts.length < 2) { alert(tf('sheet.forecastNeed', '该列至少需要两个数值')); return }
    const n = pts.length
    let sx = 0, sy = 0, sxy = 0, sxx = 0
    pts.forEach(p => { sx += p.x; sy += p.y; sxy += p.x * p.y; sxx += p.x * p.x })
    const denom = n * sxx - sx * sx
    if (denom === 0) { alert(tf('sheet.forecastNeed', '该列至少需要两个数值')); return }
    const slope = (n * sxy - sx * sy) / denom
    const intercept = (sy - slope * sx) / n
    pushHistory()
    const nd = { ...data }
    const lastX = Math.max(...pts.map(p => p.x))
    let added = 0
    for (let r = lastX + 1; r < rows && added < 5; r++, added++) {
      const k = `${r}-${active.c}`
      const cell = nd[k] || { value: '' }
      nd[k] = { ...cell, value: String(Math.round((intercept + slope * r) * 100) / 100) }
    }
    if (added === 0) {
      // 表格到底了：扩充行数后再写
      const extra = 5
      for (let i = 1; i <= extra; i++) {
        const r = lastX + i
        const k = `${r}-${active.c}`
        nd[k] = { value: String(Math.round((intercept + slope * r) * 100) / 100) }
      }
      setRows(rows + extra)
    }
    setData(nd)
  }
  const switchSheet = (id: number) => { setSheetData(sd => ({ ...sd, [activeId]: data })); setData(sheetData[id] || {}); setSheets(s => s.map(x => ({ ...x, active: x.id === id }))); setPast([]); setFuture([]) }
  const renameSheet = (id: number, name: string) => setSheets(s => s.map(x => x.id === id ? { ...x, name } : x))
  const activeSheet = sheets.find(s => s.active) || sheets[0]

  // 排序：保留整行单元格对象（样式/公式/格式），数值感知，一次历史记录
  const sortRangeByCol = (asc: boolean, col: number, headerRow: boolean) => {
    pushHistory()
    setData(d => {
      const start = headerRow ? 1 : 0
      const idx: number[] = []
      for (let r = start; r < rows; r++) idx.push(r)
      const numeric = idx.every(r => { const v = (d[`${r}-${col}`]?.value ?? '').trim(); return v === '' || !isNaN(Number(v)) })
      idx.sort((a, b) => {
        const va = (d[`${a}-${col}`]?.value ?? '').trim()
        const vb = (d[`${b}-${col}`]?.value ?? '').trim()
        let cmp: number
        if (numeric) cmp = (parseFloat(va) || 0) - (parseFloat(vb) || 0)
        else cmp = va.localeCompare(vb, 'zh-Hans-CN')
        return asc ? cmp : -cmp
      })
      const nd: Record<string, Cell> = { ...d }
      idx.forEach((srcRow, i) => {
        const dstRow = start + i
        if (srcRow === dstRow) return
        for (let c = 0; c < cols; c++) {
          const k = `${srcRow}-${c}`
          if (d[k]) nd[`${dstRow}-${c}`] = d[k]
          else delete nd[`${dstRow}-${c}`]
        }
      })
      return nd
    })
  }
  // 兼容旧调用（升序，跳过首行）
  const sortByCol = (asc: boolean) => sortRangeByCol(asc, active.c, true)

  // === 条件格式：对活动列应用，一次历史记录；记录最近一次操作供“重新应用” ===
  const applyCond = (kind: 'aboveAvg' | 'belowAvg' | 'top10' | 'dataBar' | 'colorScale') => {
    const vals: { r: number; v: number }[] = []
    for (let r = 0; r < rows; r++) {
      const v = parseFloat(getCell(r, active.c).value)
      if (!isNaN(v) && isFinite(v)) vals.push({ r, v })
    }
    if (!vals.length) { alert(tf('sheet.noData', '该列没有数值')); return }
    lastCondRef.current = () => applyCond(kind)
    pushHistory()
    setData(d => {
      const nd = { ...d }
      const mark = (r: number, bg: string) => { const k = `${r}-${active.c}`; nd[k] = { ...(nd[k] || { value: '' }), bg } }
      if (kind === 'aboveAvg' || kind === 'belowAvg') {
        const avg = vals.reduce((a, b) => a + b.v, 0) / vals.length
        vals.forEach(({ r, v }) => { if (kind === 'aboveAvg' ? v > avg : v < avg) mark(r, kind === 'aboveAvg' ? '#dcfce7' : '#fef3c7') })
      } else if (kind === 'top10') {
        [...vals].sort((a, b) => b.v - a.v).slice(0, 10).forEach(({ r }) => mark(r, '#dbeafe'))
      } else {
        const max = Math.max(...vals.map(x => x.v)), min = Math.min(...vals.map(x => x.v))
        vals.forEach(({ r, v }) => {
          const pct = max > min ? (v - min) / (max - min) : 0.5
          mark(r, kind === 'dataBar' ? `rgba(59,130,246,${pct * 0.6 + 0.1})` : (pct < 0.5 ? `rgba(239,68,68,${1 - pct * 2})` : `rgba(34,197,94,${pct * 2 - 1})`))
        })
      }
      return nd
    })
    setShowCondPanel(false)
  }

  const ribbonTabs: { id: RibbonTab; label: string }[] = [
    { id: 'home', label: t('sheet.ribbon.home') }, { id: 'insert', label: t('sheet.ribbon.insert') }, { id: 'data', label: t('sheet.ribbon.data') }, { id: 'view', label: t('sheet.ribbon.view') },
  ]

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--color-bg-alt)', position: 'relative' }}>
      {/* Ribbon Tab 栏 — 可横向滚动，右侧信息固定 */}
      <div className="flex items-center px-2 flex-shrink-0 border-b" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', position: 'relative', zIndex: 45 }}>
        <div className="ribbon-tab-scroll">
          {ribbonTabs.map(t => (
            <button key={t.id} onClick={() => { closeAllPanels(); setRibbonTab(t.id) }} data-testid={`ribbon-tab-${t.id}`} className="ribbon-tab-btn px-2 sm:px-4 py-2 text-sm font-medium transition-colors"
              style={{ color: ribbonTab === t.id ? 'var(--color-primary)' : 'var(--color-text-secondary)', borderBottom: ribbonTab === t.id ? '2px solid var(--color-primary)' : '2px solid transparent', background: ribbonTab === t.id ? 'var(--color-primary-50)' : 'transparent' }}>{t.label}</button>
          ))}
        </div>
        <span className="text-xs flex-shrink-0 px-2" style={{ color: 'var(--color-text-muted)' }}>{rows} {t('sheet.rows')} × {cols} {t('sheet.cols')}</span>
      </div>

      {/* 点击外部关闭弹出面板的透明遮罩 — absolute 限制在编辑器根容器内，
          避免覆盖 header 的 tab 切换栏和 Files 菜单 */}
      {anyPanelOpen && (
        <div className="absolute inset-0" style={{ zIndex: 40 }} onClick={() => closeAllPanels()} />
      )}

      {/* Ribbon 内容区 */}
      <div className="flex items-stretch px-1 py-1 flex-shrink-0 border-b w-full ribbon-scroll" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', minHeight: '64px', position: 'relative', zIndex: 45 }}>
        {ribbonTab === 'home' && (<>
          <RibbonGroup label={t('sheet.cell')}>
            <RibbonButton icon="⧉" label={t('sheet.copy')} onClick={() => copyCells(false)} onMouseDown={(e: any) => e.preventDefault()} />
            <RibbonButton icon="📋" label={t('sheet.paste')} onClick={() => pasteCells()} disabled={!clipboard} onMouseDown={(e: any) => e.preventDefault()} />
          </RibbonGroup>
          <RibbonGroup label={t('sheet.font')}>
            <RibbonButton icon="B" label={t('sheet.bold')} onClick={() => setCellFmtRange({ bold: !getCell(active.r, active.c).bold })} active={getCell(active.r, active.c).bold} />
            <RibbonButton icon="I" label={t('sheet.italic')} onClick={() => setCellFmtRange({ italic: !getCell(active.r, active.c).italic })} active={getCell(active.r, active.c).italic} />
            <RibbonButton icon="U" label={t('sheet.underline')} onClick={() => setCellFmtRange({ under: !getCell(active.r, active.c).under })} active={getCell(active.r, active.c).under} />
            <div className="relative">
              <RibbonButton icon="🎨" label={t('doc.color')} onClick={() => openPanel('color')} />
              {showColorPopup && (
                <div className="absolute top-full ribbon-popup" style={{ left: 0, right: 'auto', padding: '0.5rem', zIndex: 50, width: '180px' }}>
                  <div className="flex gap-1 mb-2">
                    <button onClick={() => setColorMode('font')} className="flex-1 text-xs py-1 rounded" style={{ background: colorMode === 'font' ? 'var(--color-primary)' : 'var(--color-bg-alt)', color: colorMode === 'font' ? '#fff' : 'var(--color-text)' }}>{tf('sheet.fontColor', '字体色')}</button>
                    <button onClick={() => setColorMode('fill')} className="flex-1 text-xs py-1 rounded" style={{ background: colorMode === 'fill' ? 'var(--color-primary)' : 'var(--color-bg-alt)', color: colorMode === 'fill' ? '#fff' : 'var(--color-text)' }}>{tf('sheet.fillColor', '填充色')}</button>
                    <button onClick={() => setColorMode('border')} className="flex-1 text-xs py-1 rounded" style={{ background: colorMode === 'border' ? 'var(--color-primary)' : 'var(--color-bg-alt)', color: colorMode === 'border' ? '#fff' : 'var(--color-text)' }}>{tf('sheet.borderColor', '边框色')}</button>
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {['#000000','#ef4444','#f59e0b','#10b981','#3b82f6','#6366f1','#8b5cf6','#ec4899','#ffffff','#fde68a','#bbf7d0','#bfdbfe','#ddd6fe','#fbcfe8','#fca5a5','#9ca3af'].map(c => (
                      <button key={c} onClick={() => {
                        if (colorMode === 'font') setCellFmtRange({ color: c })
                        else if (colorMode === 'fill') setCellFmtRange({ bg: c })
                        else setCellFmtRange({ border: 'thin', borderColor: c })
                        closeAllPanels()
                      }} className="w-6 h-6 rounded border transition-transform hover:scale-110" style={{ background: c, borderColor: c === '#ffffff' ? 'var(--color-border)' : c }} title={c} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </RibbonGroup>
          <RibbonGroup label={tf('sheet.border', '边框')}>
            <RibbonButton icon="▫" label={tf('sheet.borderThin', '细线')} onClick={() => setCellFmtRange({ border: 'thin', borderColor: '#000000' })} title={tf('sheet.borderThin', '细线边框')} />
            <RibbonButton icon="▣" label={tf('sheet.borderMedium', '中线')} onClick={() => setCellFmtRange({ border: 'medium', borderColor: '#000000' })} title={tf('sheet.borderMedium', '中线边框')} />
            <RibbonButton icon="▪" label={tf('sheet.borderThick', '粗线')} onClick={() => setCellFmtRange({ border: 'thick', borderColor: '#000000' })} title={tf('sheet.borderThick', '粗线边框')} />
            <RibbonButton icon="✕" label={tf('sheet.borderNone', '无')} onClick={() => setCellFmtRange({ border: 'none' })} title={tf('sheet.borderNone', '清除边框')} />
            <div className="relative">
              <RibbonButton icon="🖌" label={tf('sheet.borderColor', '边框色')} onClick={() => { closeAllPanels(); setColorMode('border'); setShowColorPopup(true) }} />
            </div>
          </RibbonGroup>
          <RibbonGroup label={t('sheet.alignment')}>
            {/* 对齐作用于整个选区（修复只对单个活动单元格生效的问题） */}
            <RibbonButton icon="⬅" label={t('sheet.alignLeft')} onClick={() => setCellFmtRange({ align: 'left' })} active={getCell(active.r, active.c).align === 'left'} />
            <RibbonButton icon="⬌" label={t('sheet.alignCenter')} onClick={() => setCellFmtRange({ align: 'center' })} active={getCell(active.r, active.c).align === 'center'} />
            <RibbonButton icon="➡" label={t('sheet.alignRight')} onClick={() => setCellFmtRange({ align: 'right' })} active={getCell(active.r, active.c).align === 'right'} />
          </RibbonGroup>
          <RibbonGroup label={tf('sheet.merge', '合并')}>
            <RibbonButton icon="⊟" label={tf('sheet.mergeCenter', '合并居中')} onClick={() => {
              const range = prompt(tf('sheet.mergePrompt', '输入合并范围 (如 A1:B2):'), `${colName(active.c)}${active.r + 1}:${colName(active.c + 1)}${active.r + 2}`)
              if (!range) return
              const m = range.match(/([A-Z]+)(\d+):([A-Z]+)(\d+)/)
              if (m) {
                const c1 = m[1].length === 1 ? m[1].charCodeAt(0) - 65 : (m[1].charCodeAt(0) - 65) * 26 + (m[1].charCodeAt(1) - 65) - 26
                const r1 = parseInt(m[2]) - 1
                const c2 = m[3].length === 1 ? m[3].charCodeAt(0) - 65 : (m[3].charCodeAt(0) - 65) * 26 + (m[3].charCodeAt(1) - 65) - 26
                const r2 = parseInt(m[4]) - 1
                mergeCells(r1, c1, r2, c2)
              }
            }} title={tf('sheet.mergeTitle', '合并单元格')} />
            <RibbonButton icon="⊞" label={tf('sheet.split', '拆分')} onClick={() => splitCell(active.r, active.c)} active={isMerged(active.r, active.c)} title={tf('sheet.splitTitle', '拆分单元格')} />
          </RibbonGroup>
          <RibbonGroup label={t('sheet.number')}>
            {/* 数字格式：只改格式不改值（修复旧的破坏性改值：值×100 加 % / 丢精度） */}
            <RibbonButton icon="%" label={t('sheet.percent')} onClick={() => setCellFmtRange({ fmt: getCell(active.r, active.c).fmt === 'percent' ? undefined : 'percent' })} active={getCell(active.r, active.c).fmt === 'percent'} title="0%" />
            <RibbonButton icon="0.0" label={t('sheet.decimal')} onClick={() => setCellFmtRange({ fmt: getCell(active.r, active.c).fmt === '0.00' ? undefined : '0.00' })} active={getCell(active.r, active.c).fmt === '0.00'} title="0.00" />
          </RibbonGroup>
          <RibbonGroup label={t('sheet.cellOps')}>
            <RibbonButton icon="↧+" label={t('sheet.addRow')} onClick={() => setRows(r => r + 1)} />
            <RibbonButton icon="↦+" label={t('sheet.addColumn')} onClick={() => setCols(c => c + 1)} />
          </RibbonGroup>
        </>)}
        {ribbonTab === 'insert' && (<>
          <RibbonGroup label={t('sheet.chart')}>
            <div className="relative">
              <RibbonButton icon="📊" label={t('sheet.chart')} onClick={() => openPanel('chart')} />
              {showChartPanel && (
                <div className="absolute top-full ribbon-popup" style={{ left: 0, right: 'auto', zIndex: 50 }}>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { type: 'bar', icon: '📊', name: t('sheet.chart.bar') },
                      { type: 'line', icon: '📈', name: t('sheet.chart.line') },
                      { type: 'pie', icon: '🥧', name: t('sheet.chart.pie') },
                      { type: 'scatter', icon: '⚫', name: t('sheet.chart.scatter') },
                      { type: 'area', icon: '🔻', name: t('sheet.chart.area') },
                      { type: 'doughnut', icon: '🍩', name: t('sheet.chart.donut') },
                    ].map(c => (
                      <button key={c.type} onClick={() => { addChart(c.type); setShowChartPanel(false) }}
                        className="flex flex-col items-center gap-1 p-2 rounded-md transition-colors hover:bg-slate-100" style={{ minWidth: 64 }}>
                        <span style={{ fontSize: '20px' }}>{c.icon}</span>
                        <span style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>{c.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </RibbonGroup>
          <RibbonGroup label={t('sheet.shapes')}>
            <div className="relative">
              <RibbonButton icon="▭" label={t('sheet.shapes')} onClick={() => openPanel('shape')} />
              {showShapePanel && (
                <div className="absolute top-full ribbon-popup" style={{ left: 0, right: 'auto', zIndex: 50 }}>
                  <div className="grid grid-cols-4 gap-2">
                    {[{i:'▭',n:t('doc.shape.rect')},{i:'▢',n:t('doc.shape.rounded')},{i:'⬭',n:t('doc.shape.ellipse')},{i:'△',n:t('doc.shape.triangle')},
                     {i:'◇',n:t('doc.shape.diamond')},{i:'→',n:t('doc.shape.arrow')},{i:'★',n:t('doc.shape.star')},{i:'♥',n:t('doc.shape.heart')}].map(s => (
                      <button key={s.n} onClick={() => { const cur = getCell(active.r, active.c).value; if (cur) { alert(tf('sheet.cellNotEmpty', '当前单元格已有数据，请先选中空单元格')); return } setCell(active.r, active.c, s.i); setShowShapePanel(false) }} className="flex flex-col items-center gap-1 p-2 rounded-md transition-colors hover:bg-slate-100" style={{ minWidth: 56 }}>
                        <span style={{ fontSize: '20px' }}>{s.i}</span>
                        <span style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>{s.n}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </RibbonGroup>
          <RibbonGroup label={t('sheet.illustration')}>
            <RibbonButton icon="🖼" label={t('sheet.image')} onClick={() => {
              const input = document.createElement('input')
              input.type = 'file'
              input.accept = 'image/*'
              input.onchange = () => {
                const file = input.files?.[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = () => { setCell(active.r, active.c, `[img]${reader.result}`) }
                reader.readAsDataURL(file)
              }
              input.click()
            }} />
          </RibbonGroup>
          <RibbonGroup label={t('sheet.function')}>
            <div className="relative">
              <RibbonButton icon="ƒx" label={t('sheet.function')} onClick={() => openPanel('func')} />
              {showFuncPanel && (
                <div className="absolute top-full right-0 ribbon-popup ribbon-popup_compact" style={{ minWidth: 160, zIndex: 50 }}>
                  <button onClick={() => { let sum = 0; for (let r = 0; r < rows; r++) { const v = parseFloat(getCell(r, active.c).value); if (!isNaN(v)) sum += v } setCell(active.r, active.c, String(sum)); setShowFuncPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2 transition-colors hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>{t('sheet.sum')}</button>
                  <button onClick={() => { let sum = 0; let n = 0; for (let r = 0; r < rows; r++) { const v = parseFloat(getCell(r, active.c).value); if (!isNaN(v)) { sum += v; n++ } } setCell(active.r, active.c, n > 0 ? String(sum / n) : '0'); setShowFuncPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2 transition-colors hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>{t('sheet.average')}</button>
                  <button onClick={() => { let n = 0; for (let r = 0; r < rows; r++) { if (getCell(r, active.c).value) n++ } setCell(active.r, active.c, String(n)); setShowFuncPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2 transition-colors hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>{t('sheet.count')}</button>
                  <button onClick={() => { let max = -Infinity; for (let r = 0; r < rows; r++) { const v = parseFloat(getCell(r, active.c).value); if (!isNaN(v) && v > max) max = v } setCell(active.r, active.c, String(max)); setShowFuncPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2 transition-colors hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>{t('sheet.max')}</button>
                  <button onClick={() => { let min = Infinity; for (let r = 0; r < rows; r++) { const v = parseFloat(getCell(r, active.c).value); if (!isNaN(v) && v < min) min = v } setCell(active.r, active.c, String(min)); setShowFuncPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2 transition-colors hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>{t('sheet.min')}</button>
                </div>
              )}
            </div>
          </RibbonGroup>
        </>)}
        {ribbonTab === 'data' && (<>
          <RibbonGroup label={t('sheet.sortFilter')}>
            <RibbonButton icon="↑" label={t('sheet.sortAsc')} onClick={() => sortRangeByCol(true, active.c, true)} title={tf('sheet.sortAscTitle', '按当前列升序（保留样式）')} />
            <RibbonButton icon="↓" label={t('sheet.sortDesc')} onClick={() => sortRangeByCol(false, active.c, true)} title={tf('sheet.sortDescTitle', '按当前列降序（保留样式）')} />
            <RibbonButton icon="🔍" label={t('sheet.filter')} onClick={() => {
              // 非破坏性筛选：只隐藏不匹配的行，不改任何单元格内容/颜色，可一键清除
              const v = prompt(tf('sheet.filterPrompt', '输入筛选关键词：'))
              if (v === null) return
              if (v === '') { setFilterRows(null); return }
              const hit = new Set<number>()
              for (let r = 0; r < rows; r++) if ((getCell(r, active.c).value || '').includes(v)) hit.add(r)
              if (!hit.size) { alert(tf('sheet.filterNoMatch', '无匹配行')); return }
              setFilterRows(hit)
            }} active={!!filterRows} title={t('sheet.filterTitle')} />
            {/* MS Office 风格排序对话框 */}
            <RibbonButton icon="⇅" label={t('sheet.customSort')} onClick={() => {
              const col = prompt(tf('sheet.customSortPrompt2', '输入排序列（如 A）：'), colName(active.c))
              if (!col) return
              const m = col.trim().toUpperCase().match(/^([A-Z]+)$/)
              if (!m) { alert(tf('sheet.customSortBad', '请输入列字母，如 A 或 AB')); return }
              let ci = 0
              for (const ch of m[1]) ci = ci * 26 + (ch.charCodeAt(0) - 64)
              ci -= 1
              if (ci < 0 || ci >= cols) { alert(tf('sheet.customSortBad', '列超出范围')); return }
              const dir = prompt(tf('sheet.customSortDir', '输入排序方向：1=升序，0=降序'), '1')
              if (dir === null) return
              sortRangeByCol(dir.trim() !== '0', ci, true)
            }} title={t('sheet.customSortTitle')} />
            <RibbonButton icon="🖽" label={t('sheet.clearFilter')} onClick={() => setFilterRows(null)} disabled={!filterRows} title={t('sheet.clearFilterTitle')} />
            <RibbonButton icon="🔂" label={t('sheet.reapply')} onClick={() => { if (lastCondRef.current) lastCondRef.current(); else alert(tf('sheet.reapplyNone', '还没有可重放的条件格式')) }} title={t('sheet.reapplyTitle')} />
          </RibbonGroup>
          {/* MS Office 风格数据工具 */}
          <RibbonGroup label={t('sheet.dataTools')}>
            <div className="relative">
              <RibbonButton icon="✓" label={t('sheet.dataValidation')} onClick={() => openPanel('valid')} />
              {showValidPanel && (
                <div className="absolute top-full ribbon-popup" style={{ left: 0, right: 'auto', zIndex: 50 }}>
                  <div className="text-[10px] font-bold mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('sheet.dropdownOptions')}</div>
                  <input type="text" placeholder={t('sheet.dropdownPlaceholder')} value={validList} onChange={e => setValidList(e.target.value)} className="text-xs mb-2" style={{ width: 200 }} />
                  <button onClick={applyValidation} className="btn btn-primary btn-sm w-full">{t('sheet.apply')}</button>
                  <button onClick={clearValidation} className="btn btn-sm w-full mt-1" style={{ background: 'var(--color-bg-alt)', color: 'var(--color-text)' }}>{tf('sheet.validClear', '清除选区验证')}</button>
                </div>
              )}
            </div>
            <RibbonButton icon="🔢" label={t('sheet.textToColumns')} onClick={() => { const v = getCell(active.r, active.c).value; if (v) { pushHistory(); const parts = v.split(/[\s,;\t]+/); const nd = { ...data }; parts.forEach((p, i) => { const k = `${active.r}-${active.c + i}`; nd[k] = { ...(nd[k] || { value: '' }), value: p } }); setData(nd) } }} title={t('sheet.textToColumnsTitle')} />
            <RibbonButton icon="🔗" label={t('sheet.removeDup')} onClick={() => { pushHistory(); const seen = new Set<string>(); const newData: Record<string, Cell> = {}; for (let r = 0; r < rows; r++) { const v = getCell(r, active.c).value; if (v) { if (seen.has(v)) continue; seen.add(v) } for (let c = 0; c < cols; c++) { const cell = getCell(r, c); if (cell.value) newData[`${r}-${c}`] = cell } } setData(newData) }} title={t('sheet.removeDupTitle')} />
            <RibbonButton icon="📉" label={t('sheet.whatIf')} onClick={() => { const v = prompt(tf('sheet.whatIfPrompt', '输入公式（如 =SUM(A1:A5)*2）：'), '='); if (v && v.startsWith('=')) { setCell(active.r, active.c, String(evalFormula(v, data))) } }} title={t('sheet.whatIfTitle')} />
            <RibbonButton icon="🔮" label={t('sheet.forecast')} onClick={forecastTrend} title={tf('sheet.forecastTitle2', '按活动列线性趋势续写 5 行')} />
            <RibbonButton icon="📊" label={t('sheet.group')} onClick={groupRows} active={rowGroups.length > 0} title={tf('sheet.groupTitle2', '将选中行创建为可折叠分组')} />
            <RibbonButton icon="⊟" label={t("sheet.ungroup")} onClick={ungroupRows} disabled={!rowGroups.length} title={t('sheet.ungroupTitle')} />
          </RibbonGroup>
          {/* MS Office 风格获取和转换数据 */}
          <RibbonGroup label={t('sheet.getTransform')}>
            <RibbonButton icon="📥" label={t('sheet.fromWeb')} onClick={() => { const url = prompt('URL:'); if (url) { fetch(url).then(r => r.text()).then(text => { text.split('\n').slice(0, rows).forEach((line, r) => { line.split(/\t|,/).slice(0, cols).forEach((v, c) => setCell(r, c, v.trim())) }) }).catch(e => alert(e.message)) } }} title={t('sheet.fromWebTitle')} />
            <RibbonButton icon="📄" label={t('sheet.fromText')} onClick={() => { const input = document.createElement('input'); input.type='file'; input.accept='.txt'; input.onchange = async () => { const f = input.files?.[0]; if (!f) return; const text = await f.text(); text.split('\n').slice(0, rows).forEach((line, r) => { line.split(/\t|,|\s+/).slice(0, cols).forEach((v, c) => setCell(r, c, v.trim())) }) }; input.click() }} title={t('sheet.fromTextTitle')} />
            <RibbonButton icon="🗂" label={t('sheet.fromCsv')} onClick={() => {
              const input = document.createElement('input')
              input.type = 'file'
              input.accept = '.csv'
              input.onchange = async () => {
                const file = input.files?.[0]
                if (!file) return
                const text = await file.text()
                const lines = text.split('\n').filter(Boolean)
                lines.forEach((line, r) => {
                  const cells = line.split(',')
                  cells.forEach((val, c) => setCell(r, c, val.trim()))
                })
              }
              input.click()
            }} title={t('sheet.fromCsvTitle')} />
            <RibbonButton icon="🔄" label={t('sheet.refresh')} onClick={() => alert(t('sheet.refresh'))} title={t('sheet.refreshTitle')} />
          </RibbonGroup>
          <RibbonGroup label={t('sheet.conditionalFormat')}>
            <div className="relative">
              <RibbonButton icon="🎨" label={t('sheet.conditionalFormat')} onClick={() => openPanel('cond')} />
              {showCondPanel && (
                <div className="absolute top-full right-0 ribbon-popup ribbon-popup_compact" style={{ minWidth: 160, zIndex: 50 }}>
                  <button onClick={() => applyCond('aboveAvg')} className="flex w-full text-left px-3 py-1.5 text-xs gap-2 transition-colors hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>{t('sheet.aboveAvg')}</button>
                  <button onClick={() => applyCond('belowAvg')} className="flex w-full text-left px-3 py-1.5 text-xs gap-2 transition-colors hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>{t('sheet.belowAvg')}</button>
                  <button onClick={() => applyCond('top10')} className="flex w-full text-left px-3 py-1.5 text-xs gap-2 transition-colors hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>{t('sheet.top10')}</button>
                  <button onClick={() => applyCond('dataBar')} className="flex w-full text-left px-3 py-1.5 text-xs gap-2 transition-colors hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>{t('sheet.dataBar')}</button>
                  <button onClick={() => applyCond('colorScale')} className="flex w-full text-left px-3 py-1.5 text-xs gap-2 transition-colors hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>{t('sheet.colorScale')}</button>
                </div>
              )}
            </div>
          </RibbonGroup>
        </>)}
        {ribbonTab === 'view' && (<>
          <RibbonGroup label={t('sheet.zoom')}>
            <RibbonButton icon="−" label={t('sheet.zoomOut')} onClick={() => setZoom(Math.max(50, zoom - 25))} />
            <div className="flex flex-col items-center px-2"><span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-text)' }}>{zoom}%</span></div>
            <RibbonButton icon="+" label={t('sheet.zoomIn')} onClick={() => setZoom(Math.min(150, zoom + 25))} />
            <RibbonButton icon="▮" label="100%" onClick={() => setZoom(100)} />
          </RibbonGroup>
          {/* MS Office 风格窗口 */}
          <RibbonGroup label={t('sheet.window')}>
            {/* 冻结窗格：以当前活动单元格为界，上方行 + 左侧列真实冻结（sticky） */}
            <RibbonButton icon="📌" label={frozen ? t('sheet.unfreeze') : t('sheet.freezePanes')} onClick={() => { setFreezeAt(frozen ? null : { r: active.r, c: active.c }); }} active={frozen} title={tf('sheet.freezeTitle2', '冻结到当前单元格上方/左侧')} />
            <RibbonButton icon="🪟" label={t('sheet.newWindow')} onClick={() => { const go = (window as any).go?.main?.App; if (go?.NewWindow) go.NewWindow(); else if ((window as any).runtime?.WindowNew) (window as any).runtime.WindowNew() }} title={t('sheet.newWindowTitle')} />
          </RibbonGroup>
          {/* MS Office 风格显示 */}
          <RibbonGroup label={t('sheet.show')}>
            <RibbonButton icon="📐" label={t('sheet.gridlines')} onClick={() => setShowGrid(!showGrid)} active={showGrid} title={t('sheet.gridlinesTitle')} />
            <RibbonButton icon="🔤" label={t('sheet.headings')} onClick={() => setShowHeadings(!showHeadings)} active={showHeadings} title={t('sheet.headingsTitle')} />
            <RibbonButton icon="📊" label={t('sheet.formulaBar')} onClick={() => setShowFormulaBar(!showFormulaBar)} active={showFormulaBar} title={t('sheet.formulaBarTitle')} />
          </RibbonGroup>
          {/* MS Office 风格工作簿视图 */}
          <RibbonGroup label={t('sheet.workbookViews')}>
            <RibbonButton icon="📄" label={t('sheet.normal')} onClick={() => { setViewMode('normal'); setZoom(100) }} active={viewMode === 'normal'} title={t('sheet.normalTitle')} />
            <RibbonButton icon="🖨" label={t('sheet.pageBreakPreview')} onClick={() => setViewMode(viewMode === 'pageBreak' ? 'normal' : 'pageBreak')} active={viewMode === 'pageBreak'} title={tf('sheet.pageBreakTitle2', '显示分页参考线（虚线为打印分页位置）')} />
            <RibbonButton icon="📐" label={t('sheet.pageLayout')} onClick={() => setViewMode(viewMode === 'pageLayout' ? 'normal' : 'pageLayout')} active={viewMode === 'pageLayout'} title={tf('sheet.pageLayoutTitle2', '页面布局视图（页边距参考线）')} />
            <RibbonButton icon="⚙️" label={t("sheet.customViews")} onClick={() => {
              // 自定义视图：把当前视图状态存为命名视图，可随时恢复
              const name = prompt(tf('sheet.viewSavePrompt', '输入视图名称保存当前视图（已有：' + (customViewNames.join(', ') || '无') + '）：'))
              if (!name) return
              const views = JSON.parse(localStorage.getItem('sam-xlsx-views') || '{}')
              views[name] = { zoom, showGrid, showHeadings, showFormulaBar, freezeAt, viewMode }
              localStorage.setItem('sam-xlsx-views', JSON.stringify(views))
              const names = Object.keys(views)
              setCustomViewNames(names)
              const load = prompt(tf('sheet.viewLoadPrompt', '输入要恢复的视图名称（留空取消）：'), name)
              if (load && views[load]) {
                const v = views[load]
                setZoom(v.zoom); setShowGrid(v.showGrid); setShowHeadings(v.showHeadings); setShowFormulaBar(v.showFormulaBar)
                setFreezeAt(v.freezeAt || null); setViewMode(v.viewMode || 'normal')
              }
            }} active={customViewNames.length > 0} title={t('sheet.customViewsTitle')} />
          </RibbonGroup>
          {/* MS Office 风格打印 */}
          <RibbonGroup label={t('print.title')}>
            <RibbonButton icon="🖨" label={t('doc.printPreview')} onClick={() => setPrintDialogOpen(true)} data-testid="excel-print-btn" title={t('print.title')} />
          </RibbonGroup>
        </>)}
      </div>

      {/* 打印对话框 */}
      <PrintDialog
        open={printDialogOpen}
        onClose={() => setPrintDialogOpen(false)}
        editorType="excel"
        printSelector="table"
        renderPreview={(settings) => (
          <div className="w-full h-full" style={{ color: '#000' }}>
            <table className="w-full text-[8px] border-collapse" style={{ border: '1px solid #ccc' }}>
              <thead>
                <tr>
                  <th className="border p-0.5 bg-gray-100"></th>
                  {Array.from({ length: Math.min(cols, 8) }).map((_, c) => (
                    <th key={c} className="border p-0.5 bg-gray-100">{colName(c)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: Math.min(rows, 12) }).map((_, r) => (
                  <tr key={r}>
                    <td className="border p-0.5 bg-gray-100 text-center">{r + 1}</td>
                    {Array.from({ length: Math.min(cols, 8) }).map((_, c) => (
                      <td key={c} className="border p-0.5" style={{ fontFamily: settings.printGridlines ? 'monospace' : 'inherit' }}>
                        {getCell(r, c).value.slice(0, 10)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {settings.printGridlines && <div className="text-[8px] text-gray-500 mt-1">{t('print.excelGridlines')} ✓</div>}
          </div>
        )}
      />

      {/* 公式栏 */}
      {showFormulaBar && (
      <div className="px-3 py-1.5 flex items-center gap-2 flex-shrink-0 text-xs" style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
        <div className="font-mono font-semibold px-2 py-0.5 rounded" style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)', minWidth: '50px', textAlign: 'center' }}>{colName(active.c)}{active.r + 1}</div>
        <span style={{ color: 'var(--color-text-muted)' }}>fx</span>
        {(() => {
          const ac = active ? getCell(active.r, active.c) : ({ value: '' } as Cell)
          const display = ac.formula || ac.value
          return (
            <input
              value={display}
              onChange={e => {
                const v = e.target.value
                if (!active) return
                // 输入形如 "=函数名(" 且括号内为空时，自动用当前/上一次选区填充引用范围
                const m = v.match(/^=\s*[A-Za-z]+\(\s*$/)
                if (m) {
                  const singleActive = selection.mode === 'cell' && selection.r1 === selection.r2 && selection.c1 === selection.c2 && selection.r1 === active.r && selection.c1 === active.c
                  const src = singleActive ? lastSelection : selection
                  const ref = selToRef(src)
                  if (ref) {
                    setCellFmt(active.r, active.c, { formula: v + ref + ')', value: '' })
                    return
                  }
                }
                if (v.startsWith('=')) {
                  setCellFmt(active.r, active.c, { formula: v, value: '' })
                } else {
                  setCellFmt(active.r, active.c, { formula: '', value: v })
                }
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const v = (e.target as HTMLInputElement).value
                  if (!active) return
                  if (v.startsWith('=')) {
                    setCellFmt(active.r, active.c, { formula: v, value: '' })
                  } else {
                    setCellFmt(active.r, active.c, { formula: '', value: v })
                  }
                }
              }}
              className="flex-1 border-transparent focus:border-indigo-500 px-2 py-1 rounded font-mono text-xs"
              style={{ background: 'transparent', color: ac.color || 'var(--color-text)', fontWeight: ac.bold ? 700 : 400 }}
              placeholder={t('sheet.formulaPlaceholder')}
            />
          )
        })()}
      </div>
      )}

      {/* 表格主体（工作簿视图：分页参考线 / 页边距参考线叠加显示） */}
      <div className="flex-1 overflow-auto p-2 sm:p-3 relative" style={{ background: 'var(--color-bg-alt)', zoom: `${zoom}%`,
        ...(viewMode === 'pageBreak' ? {
          backgroundImage: 'repeating-linear-gradient(to right, transparent 0, transparent calc(7 * 80px - 1px), #f59e0b calc(7 * 80px - 1px), #f59e0b calc(7 * 80px), transparent calc(7 * 80px)), repeating-linear-gradient(to bottom, transparent 0, transparent calc(46 * 28px - 1px), #f59e0b calc(46 * 28px - 1px), #f59e0b calc(46 * 28px), transparent calc(46 * 28px))',
          backgroundRepeat: 'no-repeat',
        } : viewMode === 'pageLayout' ? {
          backgroundImage: 'linear-gradient(to right, transparent 48px, rgba(99,102,241,0.25) 48px, rgba(99,102,241,0.25) calc(100% - 48px), transparent calc(100% - 48px))',
        } : {}) }}>
        {viewMode !== 'normal' && (
          <div className="sticky top-0 left-0 z-40 inline-block px-2 py-0.5 text-[10px] rounded" style={{ background: 'rgba(245,158,11,0.9)', color: '#fff' }}>
            {viewMode === 'pageBreak' ? t('sheet.pageBreakPreview') : t('sheet.pageLayout')}
          </div>
        )}
        <table className="border-collapse text-sm" style={{ background: '#ffffff', boxShadow: 'var(--shadow-sm)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          {showHeadings && (
          <thead>
            <tr>
              <th className="w-10 sm:w-12 h-8 text-xs font-medium sticky top-0 z-20" style={{ background: 'var(--color-bg-alt)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}></th>
              {Array.from({ length: cols }).map((_, c) => (
                <th key={c}
                  className={`w-20 sm:w-24 h-8 text-xs font-medium sticky top-0 z-10 transition-colors cursor-pointer select-none`}
                  style={{ background: selection.mode === 'col' && selection.c1 === c ? 'rgba(59,130,246,0.30)' : (active.c === c ? 'rgba(59,130,246,0.14)' : 'var(--color-bg-alt)'), border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', minWidth: '80px' }}
                  onClick={() => selectCol(c)} title={tf('sheet.selectCol', '选择整列')}>{colName(c)}</th>
              ))}
            </tr>
          </thead>
          )}
          <tbody>
            {Array.from({ length: rows }).map((_, r) => {
              // 分组折叠的行 / 筛选掉的行不渲染（非破坏性）
              if (collapsedRows.has(r)) return null
              if (filterRows && !filterRows.has(r)) return null
              const gr = groupStartOf(r)
              const isFrozenRow = frozen && r < freezeAt!.r
              const frozenTop = 32 + r * 28 // 表头 h-8(32px) + 每行 h-7(28px)
              return (
              <tr key={r}>
                {showHeadings && (
                <td className={`w-10 sm:w-12 h-7 text-center text-xs transition-colors cursor-pointer select-none ${isFrozenRow ? 'sticky z-30' : ''}`}
                  style={{ background: selection.mode === 'row' && selection.r1 === r ? 'rgba(59,130,246,0.30)' : (active.r === r ? 'rgba(59,130,246,0.14)' : 'var(--color-bg-alt)'), border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', top: isFrozenRow ? frozenTop : undefined, left: frozen && freezeAt!.c > 0 ? 0 : undefined }}
                  onClick={() => selectRow(r)} title={tf('sheet.selectRow', '选择整行')}>
                  {gr && (
                    <button onClick={e => { e.stopPropagation(); setRowGroups(g => g.map(x => x === gr ? { ...x, collapsed: !x.collapsed } : x)) }}
                      className="w-4 h-4 mr-0.5 rounded-sm text-[9px] leading-none inline-flex items-center justify-center"
                      style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)' }}
                      title={gr.collapsed ? tf('sheet.expandGroup', '展开分组') : tf('sheet.collapseGroup', '折叠分组')}>{gr.collapsed ? '+' : '−'}</button>
                  )}
                  {r + 1}{gr && <span className="ml-0.5 text-[8px] opacity-60">▎</span>}
                </td>
                )}
                {Array.from({ length: cols }).map((_, c) => {
                  const cell = getCell(r, c)
                  // 跳过被合并覆盖的单元格
                  if (cell.hiddenBy) return null
                  const isActive = active.r === r && active.c === c
                  const mergeRange = cell.mergeRange
                  const sel = inSelection(r, c)
                  const bw = cell.border === 'thick' ? '3px' : cell.border === 'medium' ? '2px' : cell.border === 'thin' ? '1px' : undefined
                  const isFrozenCell = frozen && (c < freezeAt!.c)
                  const gridOff = !showGrid
                  return (
                    <td key={c} className={`border p-0 relative ${isFrozenCell ? 'sticky z-30' : ''}`} rowSpan={mergeRange?.rowSpan} colSpan={mergeRange?.colSpan} style={{
                      // 电子表格是“白纸”：无填充单元格固定白底、深色字，与应用主题无关
                      // （否则暗色主题下会渲染成大片黑背景，且与 Excel 显示不一致）
                      background: sel ? (isActive ? 'rgba(59,130,246,0.22)' : 'rgba(59,130,246,0.12)') : (cell.bg || '#ffffff'),
                      borderColor: cell.border && cell.border !== 'none' ? (cell.borderColor || (gridOff ? 'transparent' : '#000')) : (gridOff ? 'transparent' : 'var(--color-border)'),
                      borderWidth: bw,
                      minWidth: '80px',
                      left: isFrozenCell ? (c === 0 ? 48 : 48 + c * 80) : undefined,
                    }}
                      onMouseDown={() => { selectCell(r, c); setDragging(true) }}
                      onMouseEnter={() => { if (dragging) selectRange(Math.min(active.r, r), Math.min(active.c, c), Math.max(active.r, r), Math.max(active.c, c)) }}
                      onMouseUp={() => setDragging(false)}
                      onClick={() => selectCell(r, c)}
                      onContextMenu={e => {
                        e.preventDefault()
                        if (!inSelection(r, c)) selectCell(r, c)
                        setMenu({ x: e.clientX, y: e.clientY, r, c })
                      }}>
                      {isActive && <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: 'inset 0 0 0 2px var(--color-primary)' }}></div>}
                      {(() => {
                        const v = cell.value
                        if (v && v.startsWith('[img]')) {
                          return <img src={v.slice(5)} alt="" className="w-full h-full object-contain pointer-events-none" />
                        }
                        const decoration = [cell.under ? 'underline' : '', cell.strike ? 'line-through' : ''].filter(Boolean).join(' ')
                        const common = { color: cell.color || '#1f2937', fontWeight: cell.bold ? 700 : 400, fontStyle: cell.italic ? 'italic' as const : undefined, textAlign: cell.align || (mergeRange ? 'center' : 'left'), textDecoration: decoration || undefined, fontSize: cell.fontSize ? `${cell.fontSize}px` : undefined, fontFamily: cell.fontFamily || undefined }
                        if (cell.valid) {
                          // 数据验证下拉：打开文件时读入 / 面板设置，保存时写回 xlsx
                          const opts = cell.valid.split(',').map(x => x.trim()).filter(Boolean)
                          return <select value={v} onChange={e => setCell(r, c, e.target.value)} onFocus={() => selectCell(r, c)} className="w-full h-7 px-1 outline-none bg-transparent" style={common as any}>
                            {!opts.includes(v) && <option value={v}>{v || ' '}</option>}
                            {opts.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        }
                        return <input type="text" value={isActive ? v : fmtDisplay(cell)} onChange={e => setCell(r, c, e.target.value)} onFocus={() => selectCell(r, c)} onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); selectCell(Math.min(rows - 1, r + 1), c) }
                          else if (e.key === 'Escape') { (e.target as HTMLInputElement).blur() }
                        }} className="w-full h-7 px-2 outline-none bg-transparent" style={common as any} />
                      })()}
                    </td>
                  )
                })}
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* 右键上下文菜单 */}
      {menu && (() => {
        const sr = selRect()
        const selIsMerged = selection.mode === 'cell' && (getCell(Math.min(selection.r1, selection.r2), Math.min(selection.c1, selection.c2)).mergeRange || false)
        const ctxItem = (label: string, icon: string, fn: () => void, disabled = false) => (
          <button key={label} onClick={() => { fn(); setMenu(null) }}
            disabled={disabled}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs rounded whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--color-primary-light)]"
            style={{ color: 'var(--color-text)' }}>
            <span style={{ width: '16px', textAlign: 'center' }}>{icon}</span>{label}
          </button>
        )
        const sep = <div key={'sep' + Math.random()} className="my-1 h-px" style={{ background: 'var(--color-border)' }} />
        return (
          <div className="fixed z-[100] py-1 rounded-lg shadow-xl border" style={{ left: menu.x, top: menu.y, background: 'var(--color-surface)', borderColor: 'var(--color-border)' }} onContextMenu={e => e.preventDefault()} onMouseDown={e => e.stopPropagation()}>
            {ctxItem(tf('sheet.cut', '剪切'), '✂', () => copyCells(true))}
            {ctxItem(tf('sheet.copy', '复制'), '⧉', () => copyCells(false))}
            {ctxItem(tf('sheet.paste', '粘贴'), '📋', () => pasteCells(), !clipboard)}
            {sep}
            {ctxItem(tf('sheet.insertRowAbove', '在上方插入行'), '↥', () => insertRows(sr.r1, 1))}
            {ctxItem(tf('sheet.insertRowBelow', '在下方插入行'), '↧', () => insertRows(sr.r2 + 1, 1))}
            {ctxItem(tf('sheet.insertColLeft', '在左侧插入列'), '↤', () => insertCols(sr.c1, 1))}
            {ctxItem(tf('sheet.insertColRight', '在右侧插入列'), '↦', () => insertCols(sr.c2 + 1, 1))}
            {sep}
            {ctxItem(tf('sheet.deleteRows', '删除行'), '🗑', () => deleteRows(sr.r1, sr.r2 - sr.r1 + 1))}
            {ctxItem(tf('sheet.deleteCols', '删除列'), '🗑', () => deleteCols(sr.c1, sr.c2 - sr.c1 + 1))}
            {sep}
            {!selIsMerged && ctxItem(tf('sheet.merge', '合并单元格'), '▦', () => mergeCells(sr.r1, sr.c1, sr.r2, sr.c2))}
            {selIsMerged && ctxItem(tf('sheet.unmerge', '拆分单元格'), '▫', () => splitCell(Math.min(selection.r1, selection.r2), Math.min(selection.c1, selection.c2)))}
          </div>
        )
      })()}

      {/* 图表渲染区 */}
      {charts.length > 0 && (
        <div className="flex gap-3 p-3 overflow-x-auto flex-shrink-0" style={{ background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)', maxHeight: '240px' }}>
          {charts.map(chart => (
            <div key={chart.id} className="relative flex-shrink-0 rounded-lg p-3" style={{ background: 'var(--color-bg-alt)', border: '1px solid var(--color-border)', width: '320px' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{chart.title}</span>
                <button onClick={() => removeChart(chart.id)} className="text-xs opacity-50 hover:opacity-100" style={{ color: 'var(--color-text)' }}>✕</button>
              </div>
              <ChartSVG type={chart.type} data={chart.data} labels={chart.labels} />
            </div>
          ))}
        </div>
      )}

      {/* Sheet 标签栏 */}
      <div className="px-2 py-1 flex items-center gap-1 overflow-x-auto flex-shrink-0" style={{ background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)' }}>
        {sheets.map(s => (
          <button key={s.id} onClick={() => switchSheet(s.id)} className={`px-3 py-1 text-xs rounded-t-md transition-all whitespace-nowrap ${s.active ? 'font-semibold' : 'opacity-60 hover:opacity-100'}`}
            style={{ background: s.active ? 'var(--color-primary-light)' : 'transparent', color: s.active ? 'var(--color-primary)' : 'var(--color-text-secondary)', borderBottom: s.active ? '2px solid var(--color-primary)' : '2px solid transparent' }}>{s.name}</button>
        ))}
        <button onClick={addSheet} className="px-2 py-1 text-xs rounded transition-colors hover:opacity-70" style={{ color: 'var(--color-text-muted)' }} title={t('sheet.newSheet')}>+</button>
      </div>

      {/* 底部状态栏 */}
      <div className="px-3 py-1.5 text-xs flex items-center gap-3 flex-shrink-0" style={{ background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>{t('sheet.ready')}</span>
        <div className="flex-1" />
        <span className="font-mono">{colName(active.c)}{active.r + 1}</span>
        <span style={{ color: 'var(--color-border-strong)' }}>|</span>
        <span className="truncate max-w-[120px]">{getCell(active.r, active.c).value || t('sheet.empty')}</span>
      </div>
    </div>
  )
}
