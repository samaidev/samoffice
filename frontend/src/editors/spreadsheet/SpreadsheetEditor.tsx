import { useState, useEffect } from 'react'
import { useI18n } from '../../i18n'
import { PrintDialog } from '../../components/PrintDialog'

interface Cell {
  value: string; formula?: string
  bold?: boolean; color?: string; bg?: string
  align?: 'left' | 'center' | 'right'
  italic?: boolean; under?: boolean; strike?: boolean
  fontSize?: number; fontFamily?: string
  format?: 'percent' | 'decimal' | 'general'
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
  const [frozen, setFrozen] = useState(false)
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
  const switchSheet = (id: number) => { setSheetData(sd => ({ ...sd, [activeId]: data })); setData(sheetData[id] || {}); setSheets(s => s.map(x => ({ ...x, active: x.id === id }))); setPast([]); setFuture([]) }
  const renameSheet = (id: number, name: string) => setSheets(s => s.map(x => x.id === id ? { ...x, name } : x))
  const activeSheet = sheets.find(s => s.active) || sheets[0]

  // 排序
  const sortByCol = (asc: boolean) => {
    const colData: { r: number; val: string }[] = []
    for (let r = 1; r < rows; r++) { colData.push({ r, val: getCell(r, active.c).value }) }
    colData.sort((a, b) => asc ? a.val.localeCompare(b.val) : b.val.localeCompare(a.val))
    const newData: Record<string, Cell> = {}
    colData.forEach((item, idx) => {
      for (let c = 0; c < cols; c++) { const v = getCell(item.r, c).value; if (v) newData[`${idx + 1}-${c}`] = { value: v } }
    })
    setData(newData)
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
            <RibbonButton icon="⬅" label={t('sheet.alignLeft')} onClick={() => setCellFmt(active.r, active.c, { align: 'left' })} active={getCell(active.r, active.c).align === 'left'} />
            <RibbonButton icon="⬌" label={t('sheet.alignCenter')} onClick={() => setCellFmt(active.r, active.c, { align: 'center' })} active={getCell(active.r, active.c).align === 'center'} />
            <RibbonButton icon="➡" label={t('sheet.alignRight')} onClick={() => setCellFmt(active.r, active.c, { align: 'right' })} active={getCell(active.r, active.c).align === 'right'} />
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
            <RibbonButton icon="%" label={t('sheet.percent')} onClick={() => { const v = getCell(active.r, active.c).value; if (v) setCellFmt(active.r, active.c, { value: `${parseFloat(v) * 100}%`, format: 'percent' }) }} />
            <RibbonButton icon="0.0" label={t('sheet.decimal')} onClick={() => { const v = getCell(active.r, active.c).value; const n = parseFloat(v); if (!isNaN(n)) setCellFmt(active.r, active.c, { value: n.toFixed(2), format: 'decimal' }) }} />
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
                      <button key={s.n} onClick={() => { setCell(active.r, active.c, s.i); setShowShapePanel(false) }} className="flex flex-col items-center gap-1 p-2 rounded-md transition-colors hover:bg-slate-100" style={{ minWidth: 56 }}>
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
            <RibbonButton icon="↑" label={t('sheet.sortAsc')} onClick={() => sortByCol(true)} />
            <RibbonButton icon="↓" label={t('sheet.sortDesc')} onClick={() => sortByCol(false)} />
            <RibbonButton icon="🔍" label={t('sheet.filter')} onClick={() => { const v = prompt(t('sheet.filter') + ':'); if (v !== null) { const newData: Record<string, Cell> = {}; for (let r = 0; r < rows; r++) { for (let c = 0; c < cols; c++) { const cell = getCell(r, c); if (cell.value && cell.value.includes(v)) { newData[`${r}-${c}`] = { ...cell, bg: '#fef3c7' } } else { newData[`${r}-${c}`] = cell } } } setData(newData) } }} />
            {/* MS Office 风格排序对话框 */}
            <RibbonButton icon="⇅" label={t('sheet.customSort')} onClick={() => {
              const col = prompt(t('sheet.customSortPrompt'), colName(active.c))
              if (col) sortByCol(true)
            }} title={t('sheet.customSortTitle')} />
            <RibbonButton icon="🖽" label={t('sheet.clearFilter')} onClick={() => { const newData: Record<string, Cell> = {}; for (const k of Object.keys(data)) { newData[k] = { ...data[k], bg: undefined } } setData(newData) }} title={t('sheet.clearFilterTitle')} />
            <RibbonButton icon="🔂" label={t('sheet.reapply')} onClick={() => alert(t('sheet.reapply'))} title={t('sheet.reapplyTitle')} />
          </RibbonGroup>
          {/* MS Office 风格数据工具 */}
          <RibbonGroup label={t('sheet.dataTools')}>
            <div className="relative">
              <RibbonButton icon="✓" label={t('sheet.dataValidation')} onClick={() => openPanel('valid')} />
              {showValidPanel && (
                <div className="absolute top-full ribbon-popup" style={{ left: 0, right: 'auto', zIndex: 50 }}>
                  <div className="text-[10px] font-bold mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('sheet.dropdownOptions')}</div>
                  <input type="text" placeholder={t('sheet.dropdownPlaceholder')} value={validList} onChange={e => setValidList(e.target.value)} className="text-xs mb-2" style={{ width: 200 }} />
                  <button onClick={() => { setShowValidPanel(false); alert(t('sheet.validationSet', { list: validList })) }} className="btn btn-primary btn-sm w-full">{t('sheet.apply')}</button>
                </div>
              )}
            </div>
            <RibbonButton icon="🔢" label={t('sheet.textToColumns')} onClick={() => { const v = getCell(active.r, active.c).value; if (v) { const parts = v.split(/[\s,;\t]+/); parts.forEach((p, i) => setCell(active.r, active.c + i, p)) } }} title={t('sheet.textToColumnsTitle')} />
            <RibbonButton icon="🔗" label={t('sheet.removeDup')} onClick={() => { const seen = new Set<string>(); const newData: Record<string, Cell> = {}; for (let r = 0; r < rows; r++) { const v = getCell(r, active.c).value; if (v) { if (seen.has(v)) continue; seen.add(v) } for (let c = 0; c < cols; c++) { const cell = getCell(r, c); if (cell.value) newData[`${r}-${c}`] = cell } } setData(newData) }} title={t('sheet.removeDupTitle')} />
            <RibbonButton icon="📉" label={t('sheet.whatIf')} onClick={() => { const v = prompt(t('sheet.whatIf') + ' (e.g. =100*2):'); if (v && v.startsWith('=')) { try { const expr = v.slice(1).replace(/([A-Z]+)(\d+)/g, (_, col, row) => { const c = col.charCodeAt(0) - 65; const r = parseInt(row) - 1; return String(parseFloat(getCell(r, c).value) || 0) }); setCell(active.r, active.c, String(Function('return ' + expr)())) } catch { alert('Error') } } }} title={t('sheet.whatIfTitle')} />
            <RibbonButton icon="🔮" label={t('sheet.forecast')} onClick={() => alert(t('sheet.forecast'))} title={t('sheet.forecastTitle')} />
            <RibbonButton icon="📊" label={t('sheet.group')} onClick={() => alert(t('sheet.group'))} title={t('sheet.groupTitle')} />
            <RibbonButton icon="⊟" label={t("sheet.ungroup")} onClick={() => alert(t('sheet.ungroup'))} title={t('sheet.ungroupTitle')} />
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
                  <button onClick={() => { const vals: number[] = []; for (let r = 0; r < rows; r++) { const v = parseFloat(getCell(r, active.c).value); if (!isNaN(v)) vals.push(v) } if (vals.length) { const avg = vals.reduce((a,b)=>a+b,0)/vals.length; const newData: Record<string, Cell> = {}; for (let r = 0; r < rows; r++) { const cell = getCell(r, active.c); const v = parseFloat(cell.value); newData[`${r}-${active.c}`] = (!isNaN(v) && v > avg) ? { ...cell, bg: '#dcfce7' } : cell } setData(newData) } setShowCondPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2 transition-colors hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>{t('sheet.aboveAvg')}</button>
                  <button onClick={() => { const vals: number[] = []; for (let r = 0; r < rows; r++) { const v = parseFloat(getCell(r, active.c).value); if (!isNaN(v)) vals.push(v) } if (vals.length) { const avg = vals.reduce((a,b)=>a+b,0)/vals.length; const newData: Record<string, Cell> = {}; for (let r = 0; r < rows; r++) { const cell = getCell(r, active.c); const v = parseFloat(cell.value); newData[`${r}-${active.c}`] = (!isNaN(v) && v < avg) ? { ...cell, bg: '#fef3c7' } : cell } setData(newData) } setShowCondPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2 transition-colors hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>{t('sheet.belowAvg')}</button>
                  <button onClick={() => { const vals: {r:number;v:number}[] = []; for (let r = 0; r < rows; r++) { const v = parseFloat(getCell(r, active.c).value); if (!isNaN(v)) vals.push({r,v}) } vals.sort((a,b)=>b.v-a.v).slice(0,10).forEach(x => setCellFmt(x.r, active.c, { bg: '#dbeafe' })); setShowCondPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2 transition-colors hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>{t('sheet.top10')}</button>
                  <button onClick={() => { const vals: number[] = []; for (let r = 0; r < rows; r++) { const v = parseFloat(getCell(r, active.c).value); if (!isNaN(v)) vals.push(v) } const max = Math.max(...vals), min = Math.min(...vals); for (let r = 0; r < rows; r++) { const v = parseFloat(getCell(r, active.c).value); if (!isNaN(v)) { const pct = max > min ? (v - min) / (max - min) : 0.5; setCellFmt(r, active.c, { bg: `rgba(59,130,246,${pct * 0.6 + 0.1})` }) } } setShowCondPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2 transition-colors hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>{t('sheet.dataBar')}</button>
                  <button onClick={() => { const vals: number[] = []; for (let r = 0; r < rows; r++) { const v = parseFloat(getCell(r, active.c).value); if (!isNaN(v)) vals.push(v) } const max = Math.max(...vals), min = Math.min(...vals); for (let r = 0; r < rows; r++) { const v = parseFloat(getCell(r, active.c).value); if (!isNaN(v)) { const pct = max > min ? (v - min) / (max - min) : 0.5; setCellFmt(r, active.c, { bg: pct < 0.5 ? `rgba(239,68,68,${1 - pct*2})` : `rgba(34,197,94,${pct*2-1})` }) } } setShowCondPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2 transition-colors hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>{t('sheet.colorScale')}</button>
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
            <RibbonButton icon="📌" label={frozen ? t('sheet.unfreeze') : t('sheet.freezePanes')} onClick={() => setFrozen(!frozen)} active={frozen} title={t('sheet.freezeTitle')} />
            <RibbonButton icon="↔️" label={t('sheet.split')} onClick={() => splitCell(active.r, active.c)} active={isMerged(active.r, active.c)} title={t('sheet.splitTitle')} />
            <RibbonButton icon="🪟" label={t('sheet.newWindow')} onClick={() => window.open(window.location.href, '_blank')} title={t('sheet.newWindowTitle')} />
            <RibbonButton icon="▦" label={t("sheet.arrange")} onClick={() => alert(t('sheet.arrange'))} title={t('sheet.arrangeTitle')} />
          </RibbonGroup>
          {/* MS Office 风格显示 */}
          <RibbonGroup label={t('sheet.show')}>
            <RibbonButton icon="📐" label={t('sheet.gridlines')} onClick={() => setShowGrid(!showGrid)} active={showGrid} title={t('sheet.gridlinesTitle')} />
            <RibbonButton icon="🔤" label={t('sheet.headings')} onClick={() => setShowHeadings(!showHeadings)} active={showHeadings} title={t('sheet.headingsTitle')} />
            <RibbonButton icon="📊" label={t('sheet.formulaBar')} onClick={() => setShowFormulaBar(!showFormulaBar)} active={showFormulaBar} title={t('sheet.formulaBarTitle')} />
          </RibbonGroup>
          {/* MS Office 风格工作簿视图 */}
          <RibbonGroup label={t('sheet.workbookViews')}>
            <RibbonButton icon="📄" label={t('sheet.normal')} onClick={() => {}} active={true} title={t('sheet.normalTitle')} />
            <RibbonButton icon="🖨" label={t('sheet.pageBreakPreview')} onClick={() => alert(t('sheet.pageBreakPreview'))} title={t('sheet.pageBreakTitle')} />
            <RibbonButton icon="📐" label={t('sheet.pageLayout')} onClick={() => alert(t('sheet.pageLayout'))} title={t('sheet.pageLayoutTitle')} />
            <RibbonButton icon="⚙️" label={t("sheet.customViews")} onClick={() => alert(t('sheet.customViews'))} title={t('sheet.customViewsTitle')} />
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

      {/* 表格主体 */}
      <div className="flex-1 overflow-auto p-2 sm:p-3" style={{ background: 'var(--color-bg-alt)', zoom: `${zoom}%` }}>
        <table className="border-collapse text-sm" style={{ background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
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
            {Array.from({ length: rows }).map((_, r) => (
              <tr key={r}>
                {showHeadings && (
                <td className={`w-10 sm:w-12 h-7 text-center text-xs transition-colors cursor-pointer select-none`}
                  style={{ background: selection.mode === 'row' && selection.r1 === r ? 'rgba(59,130,246,0.30)' : (active.r === r ? 'rgba(59,130,246,0.14)' : 'var(--color-bg-alt)'), border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}
                  onClick={() => selectRow(r)} title={tf('sheet.selectRow', '选择整行')}>{r + 1}</td>
                )}
                {Array.from({ length: cols }).map((_, c) => {
                  const cell = getCell(r, c)
                  // 跳过被合并覆盖的单元格
                  if (cell.hiddenBy) return null
                  const isActive = active.r === r && active.c === c
                  const mergeRange = cell.mergeRange
                  const sel = inSelection(r, c)
                  const bw = cell.border === 'thick' ? '3px' : cell.border === 'medium' ? '2px' : cell.border === 'thin' ? '1px' : undefined
                  return (
                    <td key={c} className="border p-0 relative" rowSpan={mergeRange?.rowSpan} colSpan={mergeRange?.colSpan} style={{
                      // 选中仅以淡蓝背景表示，绝不修改单元格自身的字体颜色
                      background: sel ? (isActive ? 'rgba(59,130,246,0.22)' : 'rgba(59,130,246,0.12)') : (cell.bg || 'var(--color-surface)'),
                      borderColor: cell.border && cell.border !== 'none' ? (cell.borderColor || '#000') : 'var(--color-border)',
                      borderWidth: bw,
                      minWidth: '80px',
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
                        return <input type="text" value={v} onChange={e => setCell(r, c, e.target.value)} onFocus={() => selectCell(r, c)} onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); selectCell(Math.min(rows - 1, r + 1), c) }
                          else if (e.key === 'Escape') { (e.target as HTMLInputElement).blur() }
                        }} className="w-full h-7 px-2 outline-none bg-transparent" style={{ color: cell.color || 'var(--color-text)', fontWeight: cell.bold ? 700 : 400, fontStyle: cell.italic ? 'italic' : undefined, textAlign: cell.align || (mergeRange ? 'center' : 'left'), textDecoration: decoration || undefined, fontSize: cell.fontSize ? `${cell.fontSize}px` : undefined, fontFamily: cell.fontFamily || undefined }} />
                      })()}
                    </td>
                  )
                })}
              </tr>
            ))}
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
