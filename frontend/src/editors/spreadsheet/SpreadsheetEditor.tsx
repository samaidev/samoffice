import { useState, useEffect, useRef } from 'react'
import { useI18n } from '../../i18n'
import { CN_FONT_SIZES } from '../../lib/cnFontSizes'
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
  // valign 垂直对齐 / wrap 自动换行（与后端 io.go cellJSON 对应，excelize Alignment）
  valign?: 'top' | 'middle' | 'bottom'
  wrap?: boolean
}
interface Selection {
  r1: number; c1: number; r2: number; c2: number
  mode: 'cell' | 'row' | 'col'
}
// 筛选/排序对话框里的一个排序级别
interface SortLevel { col: number; asc: boolean }
// 自动筛选：headerRow 表头行；filters[列号] = 该列允许值集合（空对象=无列被筛选）
interface AutoFilterState { headerRow: number; filters: Record<number, string[]> }
// 空白值在筛选集合里的特殊键
const BLANK_KEY = '\u0000blank'
// 浮动图片（前端态）：src 为 dataURL；快照回传时转为 base64/ext（与 io.go imageJSON 对应）
interface SheetImage { row: number; col: number; src: string; width: number; height: number }
// 单个 sheet 快照（与后端 io.go sheetJSON 对应：列宽 / 冻结 / 浮动图片）
interface SheetSnapshot {
  name: string; rows?: number; cols?: number; cells: Record<string, Cell>
  // colWidths：0 基列号 → 像素宽（默认 80px 不写入）
  colWidths?: Record<number, number>
  // freeze：冻结窗格锚点单元格名（如 "C3"），空表示未冻结
  freeze?: string
  // images：浮动图片（base64 不含 data: 前缀）
  images?: { row: number; col: number; base64: string; ext: string; width: number; height: number }[]
}
// 快照回传类型（rows/cols 必填，另带 sheet 级元数据）
interface SheetSnapshotOut extends SheetSnapshot { rows: number; cols: number }
interface Props {
  initialRows?: number
  initialCols?: number
  title?: string
  // 外部传入的工作簿数据（如打开 xlsx 时），每个元素对应一个 sheet
  initialSheets?: SheetSnapshot[]
  // 编辑或切换 sheet 时把完整工作簿快照回传（供保存为 xlsx 使用）
  onSheetsChange?: (snapshot: SheetSnapshotOut[]) => void
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

// 解析冻结窗格锚点字符串（如 "C3"）为 0 基行列；非法或 A1（无冻结）返回 null
function parseFreeze(s?: string | null): { r: number; c: number } | null {
  if (!s) return null
  const m = s.trim().toUpperCase().match(/^([A-Z]+)(\d+)$/)
  if (!m) return null
  const c = colToNum(m[1]) - 1
  const r = parseInt(m[2], 10) - 1
  if (isNaN(r) || isNaN(c) || r < 0 || c < 0 || (r === 0 && c === 0)) return null
  return { r, c }
}
// dataURL → { base64, ext }（快照回传后端用；base64 不含 data: 前缀）
function dataURLToBase64(src: string): { base64: string; ext: string } {
  const m = src.match(/^data:image\/([a-z0-9.+-]+);base64,([\s\S]*)$/)
  if (!m) return { base64: '', ext: 'png' }
  const ext = m[1] === 'jpg' ? 'jpeg' : m[1]
  return { base64: m[2], ext }
}

// === 筛选下拉面板（对齐 MS Excel 列头筛选）===
// 排序按钮 + 搜索框 + 全选 + 值多选列表；确定后按值集合筛选（非破坏性）
function FilterDropdown({ values, initial, labels, onSort, onApply, onCancel }: {
  values: string[]
  initial: string[]
  labels: { asc: string; desc: string; blank: string; all: string; search: string; ok: string; cancel: string }
  onSort: (asc: boolean) => void
  onApply: (checked: string[]) => void
  onCancel: () => void
}) {
  const [q, setQ] = useState('')
  const [checked, setChecked] = useState<Set<string>>(() => new Set(initial))
  const shown = values.filter(v => v === BLANK_KEY || !q || v.toLowerCase().includes(q.toLowerCase()))
  const allShownChecked = shown.length > 0 && shown.every(v => checked.has(v))
  const toggle = (v: string) => setChecked(prev => { const n = new Set(prev); if (n.has(v)) n.delete(v); else n.add(v); return n })
  const toggleAll = () => setChecked(prev => {
    const n = new Set(prev)
    if (allShownChecked) shown.forEach(v => n.delete(v))
    else shown.forEach(v => n.add(v))
    return n
  })
  return (
    <div className="absolute top-full right-0 ribbon-popup" style={{ zIndex: 70, width: 208, cursor: 'default' }} onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
      <div className="flex gap-1 mb-2">
        <button className="btn btn-sm flex-1" style={{ background: 'var(--color-bg-alt)', color: 'var(--color-text)' }} onClick={() => onSort(true)}>↑ {labels.asc}</button>
        <button className="btn btn-sm flex-1" style={{ background: 'var(--color-bg-alt)', color: 'var(--color-text)' }} onClick={() => onSort(false)}>↓ {labels.desc}</button>
      </div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder={labels.search} autoFocus
        className="text-xs mb-2 border rounded px-2 py-1" style={{ width: '100%', background: 'var(--color-bg-alt)', color: 'var(--color-text)', borderColor: 'var(--color-border)' }} />
      <label className="flex items-center gap-1.5 text-xs mb-1 cursor-pointer" style={{ color: 'var(--color-text)', fontWeight: 600 }}>
        <input type="checkbox" checked={allShownChecked} onChange={toggleAll} />
        {labels.all}
      </label>
      <div className="max-h-44 overflow-y-auto mb-2 border rounded" style={{ borderColor: 'var(--color-border)' }}>
        {shown.map(v => (
          <label key={v} className="flex items-center gap-1.5 text-xs py-0.5 px-1 cursor-pointer hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>
            <input type="checkbox" checked={checked.has(v)} onChange={() => toggle(v)} />
            <span className="truncate" title={v === BLANK_KEY ? labels.blank : v}>{v === BLANK_KEY ? labels.blank : v}</span>
          </label>
        ))}
        {!shown.length && <div className="text-xs py-2 text-center" style={{ color: 'var(--color-text-muted)' }}>—</div>}
      </div>
      <div className="flex gap-1">
        <button className="btn btn-primary btn-sm flex-1" onClick={() => onApply([...checked])}>{labels.ok}</button>
        <button className="btn btn-sm flex-1" style={{ background: 'var(--color-bg-alt)', color: 'var(--color-text)' }} onClick={onCancel}>{labels.cancel}</button>
      </div>
    </div>
  )
}

// === 排序对话框（对齐 MS Excel 多级排序）===
function SortDialog({ cols, colName, headerText, initLevels, initHasHeader, labels, onClose, onApply }: {
  cols: number
  colName: (c: number) => string
  headerText: (c: number) => string
  initLevels: { col: number; asc: boolean }[]
  initHasHeader: boolean
  labels: { title: string; major: string; add: string; del: string; header: string; ok: string; cancel: string; asc: string; desc: string }
  onClose: () => void
  onApply: (levels: { col: number; asc: boolean }[], hasHeader: boolean) => void
}) {
  const [lv, setLv] = useState(initLevels)
  const [hdr, setHdr] = useState(initHasHeader)
  const colOpts = Array.from({ length: cols }, (_, c) => ({ v: c, label: `${colName(c)}${hdr && headerText(c) ? ' - ' + headerText(c).slice(0, 12) : ''}` }))
  const selStyle = { background: 'var(--color-bg-alt)', color: 'var(--color-text)', borderColor: 'var(--color-border)' } as const
  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 95, background: 'rgba(0,0,0,0.35)' }} onMouseDown={onClose}>
      <div className="rounded-lg shadow-xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', width: 440, maxWidth: '92vw' }} onMouseDown={e => e.stopPropagation()}>
        <div className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>{labels.title}</div>
        {lv.map((l, i) => (
          <div key={i} className="flex items-center gap-1.5 mb-2">
            <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-text-muted)', width: 64 }}>{i === 0 ? labels.major : `${labels.major} ${i + 1}`}</span>
            <select value={l.col} onChange={e => setLv(p => p.map((x, j) => j === i ? { ...x, col: Number(e.target.value) } : x))}
              className="text-xs px-1 py-1 rounded border flex-1 min-w-0" style={selStyle}>
              {colOpts.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
            <select value={l.asc ? '1' : '0'} onChange={e => setLv(p => p.map((x, j) => j === i ? { ...x, asc: e.target.value === '1' } : x))}
              className="text-xs px-1 py-1 rounded border flex-shrink-0" style={{ ...selStyle, width: 76 }}>
              <option value="1">{labels.asc}</option>
              <option value="0">{labels.desc}</option>
            </select>
            {lv.length > 1 && (
              <button className="toolbar-btn flex-shrink-0" title={labels.del} style={{ width: 26, height: 26 }}
                onClick={() => setLv(p => p.filter((_, j) => j !== i))}>✕</button>
            )}
          </div>
        ))}
        <button className="btn btn-sm mb-3" style={{ background: 'var(--color-bg-alt)', color: 'var(--color-text)' }}
          onClick={() => setLv(p => [...p, { col: 0, asc: true }])}>{labels.add}</button>
        <label className="flex items-center gap-1.5 text-xs mb-3 cursor-pointer" style={{ color: 'var(--color-text)' }}>
          <input type="checkbox" checked={hdr} onChange={e => setHdr(e.target.checked)} />
          {labels.header}
        </label>
        <div className="flex justify-end gap-2">
          <button className="btn btn-primary btn-sm" onClick={() => onApply(lv, hdr)}>{labels.ok}</button>
          <button className="btn btn-sm" style={{ background: 'var(--color-bg-alt)', color: 'var(--color-text)' }} onClick={onClose}>{labels.cancel}</button>
        </div>
      </div>
    </div>
  )
}

// === 数字格式引擎（对齐 MS Excel 设置单元格格式）===
// token 支持两类：
// 1) 内置简写（历史兼容）：int / 0.00 / thousands / thousands2 / percent / percent2 / currency / date
// 2) 原生 Excel 数字格式串（新）：'0.00' '#,##0' '#,##0.00' '0.0%' '¥#,##0.00' '$#,##0.00'
//    'yyyy-mm-dd' 'yyyy/m/d' 'yyyy-mm-dd hh:mm' 'hh:mm:ss' 等（与后端 io.go numFmtFromToken 对应）

// Excel 日期序列号 → Date（Excel 纪元 1899-12-30）
function excelSerialToDate(serial: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400 * 1000))
}
// 尝试把字符串解析为 Date（ISO 日期 / 日期时间 / 斜杠日期），失败返回 null
function parseDateLike(v: string): Date | null {
  const s = v.trim()
  if (!s) return null
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s)
  if (m) {
    const [, y, mo, d, h = '0', mi = '0', se = '0'] = m
    return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se))
  }
  return null
}
// 按日期格式串渲染 Date。
// m 的歧义（月/分）按位置判定：出现在时间起始（hh/ss 段）之后是分钟，否则是月份。
function formatDateByPattern(d: Date, pattern: string): string {
  const p2 = (n: number) => String(n).padStart(2, '0')
  const tm = /(?:hh|h)\s*[:：]/i.exec(pattern)
  const timeStart = tm ? tm.index : pattern.length
  let out = pattern
    .replace(/dddd/gi, ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()])
    .replace(/mmm/gi, ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()])
    .replace(/yyyy/gi, String(d.getFullYear()))
    .replace(/yy/gi, p2(d.getFullYear() % 100))
    .replace(/dd/gi, p2(d.getDate()))
    .replace(/\bd\b/gi, String(d.getDate()))
  out = out.replace(/mm/gi, (s, off) => off < timeStart ? p2(d.getMonth() + 1) : p2(d.getMinutes()))
  out = out.replace(/\bm\b/gi, (s, off) => off < timeStart ? String(d.getMonth() + 1) : String(d.getMinutes()))
  out = out
    .replace(/hh/gi, p2(d.getHours()))
    .replace(/\bh\b/gi, String(d.getHours()))
    .replace(/ss/gi, p2(d.getSeconds()))
    .replace(/\bs\b/gi, String(d.getSeconds()))
  return out
}
// 从 "¥#,##0.00" / '"¥"#,##0' 等格式串提取货币符号（无则返回 ''）
function currencySymbolOf(pattern: string): string {
  const q = /^"([^"]+)"/.exec(pattern.trim())
  if (q) return q[1]
  const m = /^(¥|￥|\$|€|£)/.exec(pattern.trim())
  return m ? m[1] : ''
}
// 按数字格式串渲染数值（支持 #,##0.00 / 0.000 / 0% 形式），返回 null 表示不是纯数字格式
function formatNumberByPattern(n: number, pattern: string): string | null {
  const m = /^([#,0]*)(?:\.([0#]+))?(%?)$/.exec(pattern.trim())
  if (!m) return null
  const [, , decPart, pct] = m
  const decimals = decPart ? decPart.length : 0
  const useThou = m[1].includes(',')
  let v = pct ? n * 100 : n
  let s = v.toFixed(decimals)
  if (useThou) {
    const [int, dec] = s.split('.')
    s = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (dec ? '.' + dec : '')
  }
  return s + (pct ? '%' : '')
}
// 统一入口：按 token 渲染单元格显示值；无法识别时原样返回
function applyNumFmt(v: string, token?: string): string {
  if (!token || v === '' || v == null) return v ?? ''
  // 1) 历史内置 token
  switch (token) {
    case 'int': return isNaN(Number(v)) ? v : String(Math.round(Number(v)))
    case '0.00': return isNaN(Number(v)) ? v : Number(v).toFixed(2)
    case 'thousands': return isNaN(Number(v)) ? v : Number(v).toLocaleString('en-US')
    case 'thousands2': return isNaN(Number(v)) ? v : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    case 'percent': return isNaN(Number(v)) ? v : (Number(v) * 100).toFixed(0) + '%'
    case 'percent2': return isNaN(Number(v)) ? v : (Number(v) * 100).toFixed(2) + '%'
    case 'currency': return isNaN(Number(v)) ? v : '¥' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    case 'date': return v
  }
  // 2) 原生格式串
  const isDatePat = /[ymdhs]/i.test(token) && /[-\/ :]/.test(token)
  if (isDatePat) {
    if (!isNaN(Number(v)) && v.trim() !== '') {
      // 数值序列号 → 日期
      const serial = Number(v)
      if (serial > 0 && serial < 60000) return formatDateByPattern(excelSerialToDate(serial), token)
      return v
    }
    const d = parseDateLike(v)
    if (d) return formatDateByPattern(d, token)
    return v
  }
  if (!isNaN(Number(v)) && v.trim() !== '') {
    const n = Number(v)
    const sym = currencySymbolOf(token)
    const body = token.replace(/^"[^"]+"/, '').replace(/^(¥|￥|\$|€|£)/, '').trim()
    const num = formatNumberByPattern(n, body)
    if (num !== null) return sym + num
    if (/%$/.test(body)) {
      const m2 = /^([#,0]*)(?:\.([0#]+))?%$/.exec(body)
      if (m2) return (n * 100).toFixed(m2[2] ? m2[2].length : 0) + '%'
    }
  }
  return v
}

// === 设置单元格格式对话框（对齐 MS Excel「数字」选项卡）===
function FormatCellsDialog({ sample, initToken, labels, onClose, onApply }: {
  sample: string
  initToken?: string
  labels: Record<string, string>
  onClose: () => void
  onApply: (token?: string) => void
}) {
  // category: general / number / currency / percent / date / text
  const [cat, setCat] = useState<string>(() => {
    if (!initToken) return 'general'
    if (initToken === 'int' || initToken === '0.00' || initToken === 'thousands' || initToken === 'thousands2' || /^([#,0]*)(\.[0#]+)?$/.test(initToken)) return 'number'
    if (initToken === 'currency' || /^(¥|￥|\$|€|£)/.test(initToken) || /^"/.test(initToken)) return 'currency'
    if (initToken === 'percent' || initToken === 'percent2' || /%$/.test(initToken)) return 'percent'
    if (initToken === 'date' || /[ymdhs]/i.test(initToken)) return 'date'
    return 'number'
  })
  const [decimals, setDecimals] = useState<number>(() => {
    if (initToken === 'int' || initToken === 'thousands' || initToken === 'percent' || initToken === 'currency') return 0
    if (initToken === '0.00' || initToken === 'thousands2' || initToken === 'percent2' || initToken === 'currency2') return 2
    const m = /\.([0#]+)/.exec(initToken || '')
    return m ? m[1].length : 2
  })
  const [useThou, setUseThou] = useState<boolean>(() => initToken === 'thousands' || initToken === 'thousands2' || /#,##/.test(initToken || ''))
  const [symbol, setSymbol] = useState<string>(() => {
    const s = currencySymbolOf(initToken || '')
    return s || '¥'
  })
  const dateFormats = ['yyyy-mm-dd', 'yyyy/m/d', 'yyyy年m月d日', 'yyyy-mm-dd hh:mm', 'hh:mm:ss', 'mmm d, yyyy']
  const [dateFmt, setDateFmt] = useState<string>(() => (initToken && dateFormats.includes(initToken) ? initToken : 'yyyy-mm-dd'))
  const num = parseFloat(sample)
  const preview = (() => {
    if (cat === 'general' || cat === 'text') return sample || '—'
    if (isNaN(num)) return labels.notNum || '不是数值'
    if (cat === 'number') return applyNumFmt(String(num), useThou ? (decimals > 0 ? `#,##0.${'0'.repeat(decimals)}` : '#,##0') : (decimals > 0 ? `0.${'0'.repeat(decimals)}` : '0'))
    if (cat === 'currency') return applyNumFmt(String(num), `${symbol === '"' ? '"¥"' : symbol}${useThou ? '#,##0' : '0'}${decimals > 0 ? '.' + '0'.repeat(decimals) : ''}`)
    if (cat === 'percent') return applyNumFmt(String(num), `0${decimals > 0 ? '.' + '0'.repeat(decimals) : ''}%`)
    if (cat === 'date') {
      const d = parseDateLike(sample) || (!isNaN(num) && num > 0 && num < 60000 ? excelSerialToDate(num) : null)
      return d ? formatDateByPattern(d, dateFmt) : (sample || '—')
    }
    return sample
  })()
  // 生成的实际 token（写回单元格 fmt）
  const tokenFor = (): string | undefined => {
    if (cat === 'general') return undefined
    if (cat === 'text') return '@'
    if (cat === 'date') return dateFmt
    if (cat === 'number') return useThou ? (decimals > 0 ? `#,##0.${'0'.repeat(decimals)}` : '#,##0') : (decimals > 0 ? `0.${'0'.repeat(decimals)}` : '0')
    if (cat === 'currency') return `${symbol}${useThou ? '#,##0' : '0'}${decimals > 0 ? '.' + '0'.repeat(decimals) : ''}`
    if (cat === 'percent') return `0${decimals > 0 ? '.' + '0'.repeat(decimals) : ''}%`
    return undefined
  }
  const selStyle = { background: 'var(--color-bg-alt)', color: 'var(--color-text)', borderColor: 'var(--color-border)' } as const
  const categories = [
    { v: 'general', label: labels.general }, { v: 'number', label: labels.number },
    { v: 'currency', label: labels.currency }, { v: 'percent', label: labels.percent },
    { v: 'date', label: labels.date }, { v: 'text', label: labels.text },
  ]
  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 95, background: 'rgba(0,0,0,0.35)' }} onMouseDown={onClose}>
      <div className="rounded-lg shadow-xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', width: 430, maxWidth: '92vw' }} onMouseDown={e => e.stopPropagation()}>
        <div className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>{labels.title}</div>
        <div className="flex gap-3">
          <div className="flex flex-col gap-0.5 flex-shrink-0">
            {categories.map(c => (
              <button key={c.v} onClick={() => setCat(c.v)}
                className="text-xs text-left px-2 py-1 rounded transition-colors"
                style={cat === c.v ? { background: 'var(--color-primary-light)', color: 'var(--color-primary)', fontWeight: 600 } : { color: 'var(--color-text)' }}>
                {c.label}
              </button>
            ))}
          </div>
          <div className="flex-1 min-w-0">
            {(cat === 'number' || cat === 'currency' || cat === 'percent') && (
              <>
                <label className="flex items-center gap-2 text-xs mb-2" style={{ color: 'var(--color-text)' }}>
                  <span style={{ width: 72 }}>{labels.decimals}</span>
                  <input type="number" min={0} max={10} value={decimals} onChange={e => setDecimals(Math.max(0, Math.min(10, Number(e.target.value) || 0)))}
                    className="text-xs px-1 py-0.5 rounded border" style={{ ...selStyle, width: 60 }} />
                </label>
                {(cat === 'number' || cat === 'currency') && (
                  <label className="flex items-center gap-2 text-xs mb-2 cursor-pointer" style={{ color: 'var(--color-text)' }}>
                    <input type="checkbox" checked={useThou} onChange={e => setUseThou(e.target.checked)} />
                    {labels.thousands}
                  </label>
                )}
                {cat === 'currency' && (
                  <label className="flex items-center gap-2 text-xs mb-2" style={{ color: 'var(--color-text)' }}>
                    <span style={{ width: 72 }}>{labels.symbol}</span>
                    <select value={symbol} onChange={e => setSymbol(e.target.value)} className="text-xs px-1 py-0.5 rounded border" style={{ ...selStyle, width: 90 }}>
                      <option value="¥">¥ CNY</option>
                      <option value="$">$ USD</option>
                      <option value="€">€ EUR</option>
                      <option value="£">£ GBP</option>
                    </select>
                  </label>
                )}
              </>
            )}
            {cat === 'date' && (
              <label className="flex items-center gap-2 text-xs mb-2" style={{ color: 'var(--color-text)' }}>
                <span style={{ width: 72 }}>{labels.type}</span>
                <select value={dateFmt} onChange={e => setDateFmt(e.target.value)} className="text-xs px-1 py-0.5 rounded border" style={{ ...selStyle, width: 170 }}>
                  {dateFormats.map(f => <option key={f} value={f}>{applyNumFmt(sample, f) || f}</option>)}
                </select>
              </label>
            )}
            {cat === 'text' && <div className="text-xs mb-2" style={{ color: 'var(--color-text-muted)' }}>{labels.textHint}</div>}
            <div className="text-xs mt-3 rounded border px-2 py-1.5" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-alt)', color: 'var(--color-text)' }}>
              <span style={{ color: 'var(--color-text-muted)' }}>{labels.sample}：</span>
              <span className="font-mono">{preview}</span>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn btn-primary btn-sm" onClick={() => onApply(tokenFor())}>{labels.ok}</button>
          <button className="btn btn-sm" style={{ background: 'var(--color-bg-alt)', color: 'var(--color-text)' }} onClick={onClose}>{labels.cancel}</button>
        </div>
      </div>
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
  const { t, tf, lang } = useI18n()

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
  // 多区域选择（对齐 MS Excel Ctrl+点选/Ctrl+拖拽）：主选区 + 附加区域
  const [extraAreas, setExtraAreas] = useState<Selection[]>([])
  const [lastSelection, setLastSelection] = useState<Selection>({ r1: 0, c1: 0, r2: 0, c2: 0, mode: 'cell' })
  // 撤销 / 重做历史栈（针对当前工作表单元格数据）
  const [past, setPast] = useState<Record<string, Cell>[]>([])
  const [future, setFuture] = useState<Record<string, Cell>[]>([])
  const HISTORY_LIMIT = 100
  const [dragging, setDragging] = useState(false)
  // Ctrl+拖拽追加区域 / 行列头拖拽多选的拖拽状态
  const ctrlDragRef = useRef<{ r: number; c: number } | null>(null)
  const rowDragRef = useRef<{ anchor: number; additive: boolean } | null>(null)
  const colDragRef = useRef<{ anchor: number; additive: boolean } | null>(null)
  const rowAnchorRef = useRef(0)
  const colAnchorRef = useRef(0)
  const [colorMode, setColorMode] = useState<'font' | 'fill' | 'border'>('font')
  const [menu, setMenu] = useState<{ x: number; y: number; r: number; c: number } | null>(null)
  const [clipboard, setClipboard] = useState<{ r1: number; c1: number; r2: number; c2: number; cells: Record<string, Cell>; isCut: boolean } | null>(null)
  const [sheets, setSheets] = useState(initialSheetList)
  const activeId = sheets.find(s => s.active)?.id ?? 1
  // 每个 sheet 的列宽（0 基列号 → px）、行高（仅当前会话生效，不持久化）、浮动图片与冻结锚点
  const [colWidths, setColWidths] = useState<Record<number, Record<number, number>>>(() => {
    const init: Record<number, Record<number, number>> = {}
    if (initialSheets) initialSheets.forEach((s, i) => { if (s.colWidths && Object.keys(s.colWidths).length) init[i + 1] = { ...s.colWidths } })
    return init
  })
  const [rowHeights, setRowHeights] = useState<Record<number, Record<number, number>>>({})
  const [sheetImages, setSheetImages] = useState<Record<number, SheetImage[]>>(() => {
    const init: Record<number, SheetImage[]> = {}
    if (initialSheets) initialSheets.forEach((s, i) => {
      const imgs = (s.images || []).filter(im => im && im.base64).map(im => ({ row: im.row, col: im.col, src: `data:image/${im.ext || 'png'};base64,${im.base64}`, width: im.width, height: im.height }))
      if (imgs.length) init[i + 1] = imgs
    })
    return init
  })
  const [sheetFreeze, setSheetFreeze] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {}
    if (initialSheets) initialSheets.forEach((s, i) => { if (s.freeze) init[i + 1] = s.freeze })
    return init
  })
  // 当前选中的浮动图片索引（Delete 键删除）
  const [selImage, setSelImage] = useState<number | null>(null)
  // === Excel 标准交互：单元格编辑态 / 公式引用选择 / 网格键盘焦点 ===
  // editCell 非空表示正在编辑该单元格（Excel 模型：单击只选中，输入/F2/双击才进入编辑）
  const [editCell, setEditCell] = useState<{ r: number; c: number; buf: string } | null>(null)
  const [formulaBarFocused, setFormulaBarFocused] = useState(false)
  const gridRef = useRef<HTMLDivElement>(null)
  const editInputRef = useRef<HTMLElement | null>(null)
  const fbInputRef = useRef<HTMLInputElement | null>(null)
  // Shift+方向键/Shift+点击 扩展选区时的固定锚点（Excel 行为）
  const navAnchorRef = useRef<{ r: number; c: number }>({ r: 0, c: 0 })
  // 公式引用选择拖拽：mousedown 插入 A1，拖到 B2 时扩展为 A1:B2
  const refDragRef = useRef<{ r: number; c: number; pos: number; len: number } | null>(null)
  // 公式编辑焦点载体：'cell'=单元格内输入框，'bar'=公式栏（决定点选引用时光标位置取自哪个输入框）
  const editViaRef = useRef<'cell' | 'bar'>('cell')
  // 底部查找替换条（Ctrl+F 呼出）
  const [findBar, setFindBar] = useState<{ find: string; replace: string } | null>(null)
  const curColWidths = colWidths[activeId] || {}
  const curRowHeights = rowHeights[activeId] || {}
  const curImages = sheetImages[activeId] || []
  // 列左缘 x（行标题列显示时含 48px 列宽）与行顶 y（px），用于冻结定位与浮动图片定位
  const colLeft = (c: number) => { let x = showHeadings ? 48 : 0; for (let i = 0; i < c; i++) x += curColWidths[i] || 80; return x }
  const rowH = (r: number) => curRowHeights[r] || 28
  const rowTop = (r: number) => { let y = 0; for (let i = 0; i < r; i++) y += rowH(i); return y }
  // 编辑后把当前 sheet 内容同步回 sheetData，保证切换 sheet 不丢数据
  useEffect(() => {
    setSheetData(sd => ({ ...sd, [activeId]: data }))
  }, [data, activeId])
  // 把完整工作簿快照回传父组件（用于保存为 xlsx，含边框/合并/填充/列宽/冻结/图片）
  useEffect(() => {
    if (!onSheetsChange) return
    const snapshot = sheets.map(s => ({
      name: s.name,
      rows,
      cols,
      cells: sheetData[s.id] || {},
      // 列宽只回传与默认 80px 不同的列，空表不携带该字段
      colWidths: Object.fromEntries(Object.entries(colWidths[s.id] || {}).filter(([, w]) => w !== 80)),
      freeze: sheetFreeze[s.id] || undefined,
      images: (sheetImages[s.id] || []).map(im => {
        const { base64, ext } = dataURLToBase64(im.src)
        return { row: im.row, col: im.col, base64, ext, width: im.width, height: im.height }
      }).filter(im => im.base64),
    }))
    onSheetsChange(snapshot)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetData, sheets, rows, cols, colWidths, sheetImages, sheetFreeze])
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
  // 冻结窗格：冻结到当前活动单元格上方/左侧（真实 sticky 实现）；初始值从打开的 xlsx 读取
  const [freezeAt, setFreezeAt] = useState<{ r: number; c: number } | null>(() => parseFreeze(initialSheets?.[0]?.freeze))
  const frozen = freezeAt !== null
  // 行分组（组/取消组）：折叠区间行
  const [rowGroups, setRowGroups] = useState<{ start: number; end: number; collapsed: boolean }[]>([])
  // 自动筛选（对齐 MS Excel）：列头下拉 → 按值集合筛选（非破坏性，仅隐藏不匹配行）
  const [autoFilter, setAutoFilter] = useState<AutoFilterState | null>(null)
  const [filterMenuCol, setFilterMenuCol] = useState<number | null>(null)
  // 排序对话框（MS Excel 多级排序）
  const [sortDialog, setSortDialog] = useState<null | { levels: SortLevel[]; hasHeader: boolean }>(null)
  // Ribbon 折叠（对齐 MS Office：仅保留选项卡栏；三编辑器共享同一持久化键）
  const [ribbonCollapsed, setRibbonCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('sam-ribbon-collapsed') === '1' } catch { return false }
  })
  const setRibbonCollapsedPersist = (v: boolean) => { try { localStorage.setItem('sam-ribbon-collapsed', v ? '1' : '0') } catch { /* ignore */ }; setRibbonCollapsed(v) }
  // 列头排序三角指示（col → asc），由 applySortLevels 写入；点击三角可反向重排
  const [sortMarks, setSortMarks] = useState<Record<number, boolean>>({})
  // 设置单元格格式对话框（对齐 MS Excel 数字选项卡）
  const [fmtDialog, setFmtDialog] = useState<null | { token?: string; sample: string }>(null)
  // 自定义视图（localStorage 命名视图：缩放/网格线/标题/公式栏/冻结）
  const [customViewNames, setCustomViewNames] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('sam-xlsx-views') || '[]') } catch { return [] }
  })
  // 工作簿视图：normal / pageBreak / pageLayout（真实叠加页分隔参考线）
  const [viewMode, setViewMode] = useState<'normal' | 'pageBreak' | 'pageLayout'>('normal')
  // 最近一次条件格式 / 导入动作，供“重新应用 / 刷新”重放
  const lastCondRef = useRef<null | (() => void)>(null)
  const lastImportRef = useRef<null | (() => void)>(null)

  // Escape 关闭查找条与所有弹出面板
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (findBar) { setFindBar(null); e.preventDefault(); return }
      if (anyPanelOpen) { closeAllPanels(); e.preventDefault() }
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [anyPanelOpen, findBar])

  // === 全局快捷键：撤销/重做、复制/剪切/粘贴、字体、清除、创建表、导航 ===
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toUpperCase()
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA'
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()

      // 撤销 / 重做（对标 Excel；输入框内交给原生撤销，避免破坏输入法/输入框自身状态）
      if (!inInput && mod && key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
      if (!inInput && mod && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return }

      // 查找替换（Ctrl+F / Ctrl+H 呼出底部查找条）
      if (mod && key === 'f') { e.preventDefault(); setFindBar({ find: '', replace: '' }); return }
      if (mod && key === 'h') { e.preventDefault(); setFindBar({ find: '', replace: '' }); return }

      // 复制 / 剪切 / 粘贴（输入框内使用原生复制，便于复制单元格内文本与公式）
      if (!inInput && mod && key === 'c') { e.preventDefault(); copyCells(false); return }
      if (!inInput && mod && key === 'x') { e.preventDefault(); copyCells(true); return }
      if (!inInput && mod && key === 'v') {
        e.preventDefault()
        // 对齐 Excel：优先粘贴系统剪贴板的 TSV 文本（可从外部 Excel/记事本粘贴），
        // 失败（无权限/非文本）时回退到内部剪贴板（保留样式与公式）
        ;(async () => {
          try {
            const txt = await navigator.clipboard?.readText?.()
            if (txt && txt.length && pasteText(txt)) return
          } catch { /* 无系统剪贴板读取权限，走内部剪贴板 */ }
          pasteCells()
        })()
        return
      }

      // 字体格式 加粗 / 斜体 / 下划线
      if (!inInput && mod && key === 'b') { e.preventDefault(); setCellFmtRange({ bold: !getCell(active.r, active.c).bold }); return }
      if (!inInput && mod && key === 'i') { e.preventDefault(); setCellFmtRange({ italic: !getCell(active.r, active.c).italic }); return }
      if (!inInput && mod && key === 'u') { e.preventDefault(); setCellFmtRange({ under: !getCell(active.r, active.c).under }); return }

      // 创建表（Excel 的 Ctrl+L）
      if (!inInput && mod && key === 'l') { e.preventDefault(); createTable(); return }

      // 清除内容（Delete / Backspace，仅在非输入框时）；选中浮动图片时优先删图
      if (!mod && (key === 'delete' || key === 'backspace') && !inInput) {
        e.preventDefault()
        if (selImage !== null) { removeImage(selImage); return }
        clearCellsContent(); return
      }

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
        // 兜底（网格焦点因 React 卸载编辑输入框短暂落在 body 时仍可继续键入）：
        // 可打印字符进入单元格编辑、F2 编辑，与 Excel 行为一致
        if (e.key === 'F2') { e.preventDefault(); startEdit(active.r, active.c); return }
        if (e.key.length === 1 && !e.altKey) { e.preventDefault(); startEdit(active.r, active.c, e.key); return }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, selection, clipboard, rows, cols, data, sheets, past, future, selImage])

  // 鼠标在表格外松开时也结束选区拖拽（并结束公式引用/多区域/行列头拖拽）
  useEffect(() => {
    const onUp = () => {
      if (dragging) setDragging(false)
      refDragRef.current = null
      ctrlDragRef.current = null
      rowDragRef.current = null
      colDragRef.current = null
    }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [dragging])

  // 挂载后把焦点交给网格容器，方向键/输入即编辑立即可用（Excel 行为）
  useEffect(() => { gridRef.current?.focus() }, [])

  // 点击任意处关闭筛选下拉（面板内部已 stopPropagation；Escape 也关闭）
  useEffect(() => {
    if (filterMenuCol === null) return
    const onDown = () => setFilterMenuCol(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFilterMenuCol(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [filterMenuCol])

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
    // 统一走数字格式引擎：兼容历史 token（percent/currency/…）与新原生格式串（#,##0.00/0%/日期…）
    return applyNumFmt(cell.value ?? '', cell.fmt)
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
        // 重算保护：求值结果为 #NAME?/#ERROR 等错误值且单元格已有缓存显示值时，
        // 不改写 value（保留原显示值，避免覆盖后端算好的结果）
        if (typeof sres === 'string' && sres.startsWith('#') && cell.value !== '') {
          next[key] = cell
        } else if (sres !== cell.value) {
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
  // === 多区域选择（对齐 MS Excel）：主选区 selection + 附加区域 extraAreas ===
  const normArea = (a: Selection): Selection => ({
    r1: Math.min(a.r1, a.r2), r2: Math.max(a.r1, a.r2),
    c1: Math.min(a.c1, a.c2), c2: Math.max(a.c1, a.c2), mode: a.mode,
  })
  const areaHas = (a: Selection, r: number, c: number): boolean => {
    const n = normArea(a)
    if (a.mode === 'row') return r >= n.r1 && r <= n.r2
    if (a.mode === 'col') return c >= n.c1 && c <= n.c2
    return r >= n.r1 && r <= n.r2 && c >= n.c1 && c <= n.c2
  }
  const allAreas = (): Selection[] => (extraAreas.length ? [selection, ...extraAreas] : [selection])
  const inSelection = (r: number, c: number) => allAreas().some(a => areaHas(a, r, c))
  // 行/列头高亮：任意 行/列 模式区域覆盖即高亮
  const rowInAnyArea = (r: number) => allAreas().some(a => a.mode === 'row' && r >= Math.min(a.r1, a.r2) && r <= Math.max(a.r1, a.r2))
  const colInAnyArea = (c: number) => allAreas().some(a => a.mode === 'col' && c >= Math.min(a.c1, a.c2) && c <= Math.max(a.c1, a.c2))
  // 对所有选中区域的每个单元格执行 fn（格式/清除等批量操作用）
  const forEachSelCell = (fn: (r: number, c: number) => void) => {
    for (const a of allAreas()) {
      const n = normArea(a)
      if (a.mode === 'row') { for (let r = n.r1; r <= n.r2; r++) for (let c = 0; c < cols; c++) fn(r, c) }
      else if (a.mode === 'col') { for (let c = n.c1; c <= n.c2; c++) for (let r = 0; r < rows; r++) fn(r, c) }
      else { for (let r = n.r1; r <= n.r2; r++) for (let c = n.c1; c <= n.c2; c++) fn(r, c) }
    }
  }
  // 拖拽中更新最后一个附加区域（Ctrl+拖拽新区域的临时区域固定在末尾）
  const updateLastExtraArea = (a: Selection) => setExtraAreas(prev => {
    if (!prev.length) return [a]
    const cp = prev.slice(0, -1)
    cp.push(a)
    return cp
  })
  // 统一更新选区并记录上一次选区（供公式自动填充引用使用）
  // additive=true（Ctrl+点选/拖拽）时把区域并入附加区域；重复追加同一单格/整行/整列则取消选中
  const commitSelection = (s: Selection, additive = false) => {
    if (additive) {
      const n = normArea(s)
      const same = (a: Selection) => { const m = normArea(a); return m.mode === n.mode && m.r1 === n.r1 && m.r2 === n.r2 && m.c1 === n.c1 && m.c2 === n.c2 }
      // 与主选区完全一致 → 收拢为单格（Excel 取消语义）
      if (same(selection) && !extraAreas.length) { setSelection({ r1: n.r1, c1: n.c1, r2: n.r1, c2: n.c1, mode: 'cell' }); setExtraAreas([]); return }
      setExtraAreas(prev => {
        const idx = prev.findIndex(same)
        if (idx >= 0) { const cp = [...prev]; cp.splice(idx, 1); return cp }
        return [...prev, n]
      })
      return
    }
    setLastSelection(selection)
    setSelection(s)
    setExtraAreas([])
  }
  // 对当前选区内（含全部附加区域）所有单元格批量应用格式（字体色/填充/边框/加粗等）
  const setCellFmtRange = (fmt: Partial<Cell>) => {
    pushHistory()
    setData(d => {
      const nd = { ...d }
      forEachSelCell((r, c) => {
        const existing = nd[`${r}-${c}`] || { value: '' }
        nd[`${r}-${c}`] = { ...existing, ...fmt }
      })
      return nd
    })
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
    // 对齐 MS Excel：普通单击收拢为单格选区并清空附加区域；
    // Ctrl+点选/拖拽 追加区域，Shift+方向键/点击 扩展主选区。
    navAnchorRef.current = { r, c }
    commitSelection({ r1: r, c1: c, r2: r, c2: c, mode: 'cell' })
  }

  // === 单元格编辑态（Excel 模型）===
  const startEdit = (r: number, c: number, initial?: string) => {
    const cell = getCell(r, c)
    const raw = cell.formula || cell.value || ''
    setActive({ r, c })
    editViaRef.current = 'cell'
    setEditCell({ r, c, buf: initial !== undefined ? initial : raw })
    setTimeout(() => {
      const el = editInputRef.current as HTMLInputElement | null
      if (el) {
        el.focus()
        const n = (initial ?? raw).length
        try { el.setSelectionRange(n, n) } catch { /* select/textarea */ }
      }
    }, 0)
  }
  const commitEdit = (move?: { dr: number; dc: number }) => {
    if (!editCell) return
    const { r, c, buf } = editCell
    if (buf.startsWith('=')) setCellFmt(r, c, { formula: buf, value: '' })
    else setCellFmt(r, c, { formula: '', value: buf })
    setEditCell(null)
    if (move) {
      const nr = Math.max(0, Math.min(rows - 1, r + move.dr))
      const nc = Math.max(0, Math.min(cols - 1, c + move.dc))
      selectCell(nr, nc)
    }
    setTimeout(() => gridRef.current?.focus(), 0)
  }
  const cancelEdit = () => { setEditCell(null); setTimeout(() => gridRef.current?.focus(), 0) }
  // 单元格编辑态按键：Enter/Tab 提交并移动（Shift 反向），Escape 取消还原旧值；
  // 自动换行单元格内 Alt+Enter 手动换行。所有已处理按键 stopPropagation，防止冒泡到网格/全局快捷键。
  const onEditKeyDown = (e: React.KeyboardEvent, isArea: boolean) => {
    const key = e.key
    if (key === 'Enter') {
      if (isArea && e.altKey) { e.stopPropagation(); return } // textarea 内 Alt+Enter 手动换行（默认行为）
      e.preventDefault(); e.stopPropagation()
      commitEdit({ dr: e.shiftKey ? -1 : 1, dc: 0 })
      return
    }
    if (key === 'Tab') { e.preventDefault(); e.stopPropagation(); commitEdit({ dr: 0, dc: e.shiftKey ? -1 : 1 }); return }
    if (key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit(); return }
    // 方向键在编辑态内移动光标（Excel F2 编辑模式），不拦截
  }
  // 公式引用选择模式：编辑中的内容以 = 开头（单元格内或公式栏）时，点击单元格插入其引用
  const refModeActive = !!(
    (editCell && editCell.buf.trim().startsWith('=')) ||
    (formulaBarFocused && (getCell(active.r, active.c).formula || getCell(active.r, active.c).value || '').trim().startsWith('='))
  )
  // 在编辑焦点（单元格输入框或公式栏）的光标处插入单元格引用；拖拽时把上一次引用扩展为矩形区域
  const insertCellRef = (r: number, c: number, extend: boolean) => {
    const st = refDragRef.current
    let pos: number, oldLen: number, text: string
    if (extend && st) {
      pos = st.pos; oldLen = st.len
      text = selToRef({ r1: st.r, c1: st.c, r2: r, c2: c, mode: 'cell' })
    } else {
      text = colName(c) + (r + 1)
      // 光标位置取自当前编辑载体（单元格输入框或公式栏）
      pos = editViaRef.current === 'bar' && fbInputRef.current
        ? (fbInputRef.current.selectionStart ?? 0)
        : editCell ? ((editInputRef.current as HTMLInputElement | null)?.selectionStart ?? editCell.buf.length)
        : (fbInputRef.current?.selectionStart ?? 0)
      oldLen = 0
    }
    refDragRef.current = { r: extend && st ? st.r : r, c: extend && st ? st.c : c, pos, len: text.length }
    const caretTo = pos + text.length
    if (editCell) {
      const buf = editCell.buf.slice(0, pos) + text + editCell.buf.slice(pos + oldLen)
      setEditCell({ ...editCell, buf })
      setTimeout(() => { const el = (editViaRef.current === 'bar' ? fbInputRef.current : (editInputRef.current as HTMLInputElement | null)); if (el) { try { (el as HTMLInputElement).setSelectionRange(caretTo, caretTo) } catch { /* ignore */ } } }, 0)
    } else if (active) {
      const ac = getCell(active.r, active.c)
      const cur = ac.formula || ac.value || ''
      const v = cur.slice(0, pos) + text + cur.slice(pos + oldLen)
      setCellFmt(active.r, active.c, { formula: v.startsWith('=') ? v : '=' + v, value: '' })
      setTimeout(() => { const el = fbInputRef.current; if (el) { try { el.setSelectionRange(caretTo, caretTo) } catch { /* ignore */ } } }, 0)
    }
  }
  // Ctrl+方向键：跳到数据区边缘（相邻有数据→连续数据末端；无→下一个非空或表边界）
  const edgeOf = (r: number, c: number, dr: number, dc: number) => {
    const occupied = (rr: number, cc: number) => { const v = getCell(rr, cc); return !!(v.value || v.formula) }
    let nr = r, nc = c
    const inb = () => nr >= 0 && nr < rows && nc >= 0 && nc < cols
    if (inb() && occupied(nr + dr, nc + dc)) {
      nr += dr; nc += dc
      while (inb() && occupied(nr + dr, nc + dc)) { nr += dr; nc += dc }
      return { r: nr, c: nc }
    }
    nr += dr; nc += dc
    while (inb() && !occupied(nr, nc)) { nr += dr; nc += dc }
    if (!inb()) return { r: Math.max(0, Math.min(rows - 1, nr)), c: Math.max(0, Math.min(cols - 1, nc)) }
    return { r: nr, c: nc }
  }
  const usedBounds = () => {
    let maxR = 0, maxC = 0
    for (const key in data) {
      const cell = data[key]
      if (!cell.value && !cell.formula) continue
      const [rr, cc] = key.split('-').map(Number)
      if (rr > maxR) maxR = rr
      if (cc > maxC) maxC = cc
    }
    return { r: maxR, c: maxC }
  }
  // Shift+方向键 / Shift+点击：从锚点扩展选区（锚点不随扩展移动，Excel 行为）
  const extendTo = (r: number, c: number) => {
    const a = navAnchorRef.current
    setActive({ r, c })
    commitSelection({ r1: a.r, c1: a.c, r2: r, c2: c, mode: 'cell' })
  }
  // Ctrl+D / Ctrl+R：向下/向右填充（复制选区首行/首列的完整单元格对象，含样式与公式）
  const fillDown = () => {
    pushHistory()
    setData(d => {
      const nd = { ...d }
      const r1 = Math.min(selection.r1, selection.r2), r2 = Math.max(selection.r1, selection.r2)
      const c1 = Math.min(selection.c1, selection.c2), c2 = Math.max(selection.c1, selection.c2)
      for (let c = c1; c <= c2; c++) {
        const src = d[`${r1}-${c}`]
        if (!src) continue
        for (let r = r1 + 1; r <= r2; r++) nd[`${r}-${c}`] = { ...src }
      }
      return nd
    })
  }
  const fillRight = () => {
    pushHistory()
    setData(d => {
      const nd = { ...d }
      const r1 = Math.min(selection.r1, selection.r2), r2 = Math.max(selection.r1, selection.r2)
      const c1 = Math.min(selection.c1, selection.c2), c2 = Math.max(selection.c1, selection.c2)
      for (let r = r1; r <= r2; r++) {
        const src = d[`${r}-${c1}`]
        if (!src) continue
        for (let c = c1 + 1; c <= c2; c++) nd[`${r}-${c}`] = { ...src }
      }
      return nd
    })
  }
  // Ctrl+PageUp/PageDown：切换工作表
  const switchSheetById = (id: number) => {
    if (id === activeId || !sheets.some(s => s.id === id)) return
    setSheetData(sd => ({ ...sd, [activeId]: data }))
    setData(sheetData[id] || {})
    setFreezeAt(parseFreeze(sheetFreeze[id]))
    setSheets(s => s.map(x => ({ ...x, active: x.id === id })))
    setExtraAreas([])
  }
  // === 网格键盘处理（容器持有焦点时；对齐 MS Excel 快捷键）===
  const onGridKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey
    const tgt = e.target as HTMLElement
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT')) return
    const key = e.key
    // === 编辑态竞态保护 ===
    // startEdit 通过 setTimeout 把焦点切到单元格输入框；在焦点切换生效前的窗口期里，
    // 按键会到达网格容器。Excel 行为：Enter/Tab 提交并移动，Escape 取消，可打印字符追加，方向键提交并移动。
    if (editCell) {
      if (key === 'Enter' || key === 'Tab') {
        e.preventDefault(); e.stopPropagation()
        commitEdit(key === 'Enter' ? { dr: e.shiftKey ? -1 : 1, dc: 0 } : { dr: 0, dc: e.shiftKey ? -1 : 1 })
        return
      }
      if (key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit(); return }
      const edDR = key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0
      const edDC = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0
      if (edDR || edDC) { e.preventDefault(); e.stopPropagation(); commitEdit({ dr: edDR, dc: edDC }); return }
      if (key.length === 1 && !e.altKey && !e.ctrlKey) { e.preventDefault(); e.stopPropagation(); setEditCell({ ...editCell, buf: editCell.buf + key }); return }
      return
    }
    const move = (dr: number, dc: number) => {
      const nr = Math.max(0, Math.min(rows - 1, active.r + dr))
      const nc = Math.max(0, Math.min(cols - 1, active.c + dc))
      selectCell(nr, nc)
    }
    const arrowDR = key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0
    const arrowDC = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0
    const isArrow = key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight'
    if (mod && isArrow) {
      e.preventDefault(); e.stopPropagation()
      if (e.shiftKey) { const p = edgeOf(active.r, active.c, arrowDR, arrowDC); extendTo(p.r, p.c) }
      else { const p = edgeOf(active.r, active.c, arrowDR, arrowDC); selectCell(p.r, p.c) }
      return
    }
    if (mod && key === 'a') { e.preventDefault(); e.stopPropagation(); navAnchorRef.current = { r: 0, c: 0 }; setActive({ r: 0, c: 0 }); commitSelection({ r1: 0, c1: 0, r2: rows - 1, c2: cols - 1, mode: 'cell' }); return }
    if (mod && key === 'd') { e.preventDefault(); e.stopPropagation(); fillDown(); return }
    if (mod && key === 'r') { e.preventDefault(); e.stopPropagation(); fillRight(); return }
    if (mod && key === ' ') { e.preventDefault(); e.stopPropagation(); selectCol(active.c); return }
    if (!mod && e.shiftKey && key === ' ') { e.preventDefault(); e.stopPropagation(); selectRow(active.r); return }
    if (mod && (key === 'PageDown' || key === 'PageUp')) {
      e.preventDefault(); e.stopPropagation()
      const sorted = [...sheets].sort((x, y) => x.id - y.id)
      const idx = Math.max(0, sorted.findIndex(s => s.id === activeId))
      const next = sorted[key === 'PageDown' ? Math.min(sorted.length - 1, idx + 1) : Math.max(0, idx - 1)]
      if (next) switchSheetById(next.id)
      return
    }
    if (mod && key === ';') {
      e.preventDefault(); e.stopPropagation()
      const now = new Date()
      pushHistory()
      setCellFmt(active.r, active.c, { formula: '', value: e.shiftKey ? now.toTimeString().slice(0, 5) : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` })
      return
    }
    // Alt+= 自动求和（Excel 快捷键）
    if (e.altKey && key === '=') { e.preventDefault(); e.stopPropagation(); insertAutoSum(); return }
    // Home / End（含 Ctrl 组合跳 A1 / 数据区末尾）——必须在 `if (mod) return` 之前处理
    if (key === 'Home') { e.preventDefault(); e.stopPropagation(); if (mod || e.ctrlKey) selectCell(0, 0); else selectCell(active.r, 0); return }
    if (key === 'End') {
      e.preventDefault(); e.stopPropagation()
      if (mod || e.ctrlKey) { const ub = usedBounds(); selectCell(ub.r, ub.c) }
      else { let nc = active.c; for (let c = cols - 1; c > active.c; c--) { const cell = getCell(active.r, c); if (cell.value || cell.formula) { nc = c; break } } selectCell(active.r, nc) }
      return
    }
    if (mod) return // 其余 Ctrl 组合（C/V/X/Z/Y/F/B/I/U/L…）交给 window 全局处理器
    if (e.shiftKey && isArrow) { e.preventDefault(); e.stopPropagation(); extendTo(Math.max(0, Math.min(rows - 1, active.r + arrowDR)), Math.max(0, Math.min(cols - 1, active.c + arrowDC))); return }
    if (isArrow) { e.preventDefault(); e.stopPropagation(); move(arrowDR, arrowDC); return }
    if (key === 'Tab') { e.preventDefault(); e.stopPropagation(); move(0, e.shiftKey ? -1 : 1); return }
    if (key === 'Enter') { e.preventDefault(); e.stopPropagation(); move(e.shiftKey ? -1 : 1, 0); return }
    if (key === 'PageDown' || key === 'PageUp') { e.preventDefault(); e.stopPropagation(); const d = key === 'PageDown' ? 20 : -20; if (e.shiftKey) extendTo(Math.max(0, Math.min(rows - 1, active.r + d)), active.c); else move(d, 0); return }
    if (key === 'F2') { e.preventDefault(); e.stopPropagation(); startEdit(active.r, active.c); return }
    if (key === 'Escape') {
      // Excel 行为：Esc 先收拢多格/多区域选区为活动格单格选区；其余（关查找条/面板）交给 window Esc 处理器
      const multi = selection.mode !== 'cell' || selection.r1 !== selection.r2 || selection.c1 !== selection.c2 || extraAreas.length > 0
      if (multi && !findBar) { e.preventDefault(); e.stopPropagation(); selectCell(active.r, active.c); return }
      return
    }
    if (key.length === 1 && !e.altKey && !e.ctrlKey) { e.preventDefault(); e.stopPropagation(); startEdit(active.r, active.c, key); return }
  }
  const selectRange = (r1: number, c1: number, r2: number, c2: number) =>
    commitSelection({ r1, c1, r2, c2, mode: 'cell' })
  // 选中整行（支持区间：拖拽/Shift 扩展时 r1≠r2）；additive=true 时 Ctrl 多选
  const selectRowSpan = (r1: number, r2: number, additive = false) => {
    setActive({ r: additive ? active.r : r1, c: active.c })
    commitSelection({ r1, r2, c1: 0, c2: cols - 1, mode: 'row' }, additive)
  }
  const selectRow = (r: number) => selectRowSpan(r, r)
  const selectColSpan = (c1: number, c2: number, additive = false) => {
    setActive({ r: active.r, c: additive ? active.c : c1 })
    commitSelection({ r1: 0, r2: rows - 1, c1, c2, mode: 'col' }, additive)
  }
  const selectCol = (c: number) => selectColSpan(c, c)

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
  // 清除选区内容（保留格式）：Delete / Backspace 快捷键；作用于全部选中区域
  const clearCellsContent = () => {
    pushHistory()
    setData(d => {
      const nd = { ...d }
      forEachSelCell((r, c) => {
        const k = `${r}-${c}`
        nd[k] = { ...(nd[k] || { value: '' }), value: '', formula: '' }
      })
      return nd
    })
  }
  // 清除选区格式（保留 value/formula/valid/合并信息）；作用于全部选中区域
  const clearSelectionFormat = () => {
    pushHistory()
    setData(d => {
      const nd = { ...d }
      forEachSelCell((r, c) => {
        const k = `${r}-${c}`
        const cell = nd[k]
        if (!cell) return
        nd[k] = {
          ...cell,
          bold: undefined, italic: undefined, under: undefined, strike: undefined,
          color: undefined, bg: undefined, border: undefined, borderColor: undefined,
          align: undefined, fmt: undefined, fontSize: undefined, fontFamily: undefined,
          valign: undefined, wrap: undefined,
        }
      })
      return nd
    })
  }
  // 手动重算全部公式（「刷新」按钮）：与自动重算同一套错误值保护
  const recalcAll = () => {
    setData(d => {
      const nd = { ...d }
      let changed = false
      for (const key of Object.keys(nd)) {
        const cell = nd[key]
        if (!cell.formula) continue
        const res = evalFormula(cell.formula, d)
        const sres = res === '' ? '' : (typeof res === 'number' ? String(res) : res)
        if (typeof sres === 'string' && sres.startsWith('#') && cell.value !== '') continue
        if (sres !== cell.value) { nd[key] = { ...cell, value: sres }; changed = true }
      }
      return changed ? nd : d
    })
  }
  // 推断函数/自动求和的目标引用：多格选区直接用选区；单格时取活动列上方连续数字区
  const inferFuncRange = (): string => {
    const r1 = Math.min(selection.r1, selection.r2), r2 = Math.max(selection.r1, selection.r2)
    const c1 = Math.min(selection.c1, selection.c2), c2 = Math.max(selection.c1, selection.c2)
    if (r1 !== r2 || c1 !== c2) {
      if (c1 === c2) return `${colName(c1)}${r1 + 1}:${colName(c1)}${r2 + 1}`
      if (r1 === r2) return `${colName(c1)}${r1 + 1}:${colName(c2)}${r1 + 1}`
      return selToRef(selection)
    }
    // 单格：活动列上方连续数字区域（不含活动格自身）
    let top = active.r
    while (top - 1 >= 0) {
      const v = (getCell(top - 1, active.c).value ?? '').trim()
      if (v === '' || isNaN(Number(v))) break
      top--
    }
    if (top >= active.r) return `${colName(active.c)}${active.r + 1}`
    return `${colName(active.c)}${top + 1}:${colName(active.c)}${active.r}`
  }
  // 自动求和 Σ：在活动单元格写入真公式 =SUM(...)（不写静态值）
  const insertAutoSum = () => {
    const ref = inferFuncRange()
    if (!ref) return
    setCellFmt(active.r, active.c, { formula: `=SUM(${ref})`, value: '' })
  }
  // ƒx 函数面板：写对应公式（=AVERAGE(...) 等）而非静态值
  const applySheetFunc = (fn: string) => {
    const ref = inferFuncRange()
    if (!ref) return
    setCellFmt(active.r, active.c, { formula: `=${fn}(${ref})`, value: '' })
    setShowFuncPanel(false)
  }
  // 全部替换：仅替换字面值单元格（公式单元格不直接改文本），一次历史记录可整体撤销
  const replaceAllMatches = () => {
    if (!findBar || !findBar.find) return
    pushHistory()
    const q = findBar.find, rep = findBar.replace
    setData(d => {
      const nd = { ...d }
      for (const key in nd) {
        const cell = nd[key]
        if (cell.formula) continue
        const v = cell.value ?? ''
        if (v.includes(q)) nd[key] = { ...cell, value: v.split(q).join(rep) }
      }
      return nd
    })
  }
  // 删除浮动图片（选中后 Delete 或点 ×）
  const removeImage = (idx: number) => {
    setSheetImages(m => ({ ...m, [activeId]: (m[activeId] || []).filter((_, i) => i !== idx) }))
    setSelImage(null)
  }
  // 表头右缘拖拽调整列宽（mousemove 实时更新，40~600px）
  const colResizeRef = useRef<{ c: number; startX: number; startW: number } | null>(null)
  const startColResize = (e: React.MouseEvent, c: number) => {
    e.preventDefault()
    e.stopPropagation()
    colResizeRef.current = { c, startX: e.clientX, startW: curColWidths[c] || 80 }
    const onMove = (ev: MouseEvent) => {
      const st = colResizeRef.current
      if (!st) return
      const w = Math.max(40, Math.min(600, st.startW + ev.clientX - st.startX))
      setColWidths(m => ({ ...m, [activeId]: { ...(m[activeId] || {}), [st.c]: w } }))
    }
    const onUp = () => {
      colResizeRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
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
    if (selection.mode === 'row') return { r1: Math.min(selection.r1, selection.r2), c1: 0, r2: Math.max(selection.r1, selection.r2), c2: cols - 1 }
    if (selection.mode === 'col') return { r1: 0, c1: Math.min(selection.c1, selection.c2), r2: rows - 1, c2: Math.max(selection.c1, selection.c2) }
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
  // 把外部 TSV 文本按活动格为起点粘贴（支持从 Excel/记事本/微信等复制的内容），返回是否成功
  const pasteText = (txt: string): boolean => {
    if (!txt) return false
    pushHistory()
    const baseR = active.r, baseC = active.c
    const lines = txt.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n')
    setData(d => {
      const nd = { ...d }
      lines.forEach((line, ri) => {
        line.split('\t').forEach((val, ci) => {
          const r = baseR + ri, c = baseC + ci
          if (r >= rows || c >= cols) return
          const existing = d[`${r}-${c}`] || { value: '' }
          if (val.startsWith('=')) nd[`${r}-${c}`] = { ...existing, formula: val, value: '' }
          else nd[`${r}-${c}`] = { ...existing, formula: '', value: val }
        })
      })
      return nd
    })
    return true
  }

  // === 插入 / 删除 行列（重排所有单元格坐标） ===
  // 行列增删后迁移合并信息：按旧 key → 新 key 映射重建 mergeRange 与 hiddenBy。
  // 左上角或右下角被删除的合并区域整体拆分，避免错位损坏。
  const migrateMerges = (oldD: Record<string, Cell>, nd: Record<string, Cell>, keyMap: Record<string, string>) => {
    // 1) 收集旧合并区域（左上角 key + 跨度）
    const merges: { tl: string; rowSpan: number; colSpan: number }[] = []
    for (const key in oldD) {
      const mr = oldD[key].mergeRange
      if (mr) merges.push({ tl: key, rowSpan: mr.rowSpan, colSpan: mr.colSpan })
    }
    if (!merges.length) return
    // 2) 清掉新数据里残留的旧标记（对象沿用旧引用，需重建这些单元格）
    for (const key in nd) {
      const cell = nd[key]
      if (cell.mergeRange || cell.hiddenBy) nd[key] = { ...cell, mergeRange: undefined, hiddenBy: undefined }
    }
    // 3) 重建：两端都能映射到新 key 才保留，跨度按新端点重算
    for (const mg of merges) {
      const parts = mg.tl.split('-').map(Number)
      const endKey = `${parts[0] + mg.rowSpan - 1}-${parts[1] + mg.colSpan - 1}`
      const ntl = keyMap[mg.tl]
      const nend = keyMap[endKey]
      if (!ntl || !nend) continue
      const [nr1, nc1] = ntl.split('-').map(Number)
      const [nr2, nc2] = nend.split('-').map(Number)
      if (nr2 < nr1 || nc2 < nc1) continue
      nd[ntl] = { ...(nd[ntl] || { value: '' }), mergeRange: { rowSpan: nr2 - nr1 + 1, colSpan: nc2 - nc1 + 1 } }
      for (let r = nr1; r <= nr2; r++)
        for (let c = nc1; c <= nc2; c++) {
          if (r === nr1 && c === nc1) continue
          const k = `${r}-${c}`
          nd[k] = { ...(nd[k] || { value: '' }), hiddenBy: ntl }
        }
    }
  }
  const rebuildRows = (d: Record<string, Cell>, fromRow: number, count: number): Record<string, Cell> => {
    // count>0 插入；count<0 删除，删除以 fromRow 起始的 |count| 行
    const nd: Record<string, Cell> = {}
    const keyMap: Record<string, string> = {}
    const removeCount = count < 0 ? -count : 0
    for (const key in d) {
      const [r, c] = key.split('-').map(Number)
      let nr = r
      if (count > 0) { if (r >= fromRow) nr = r + count }
      else { if (r >= fromRow + removeCount) nr = r - removeCount; else if (r >= fromRow) continue }
      const nk = `${nr}-${c}`
      keyMap[key] = nk
      nd[nk] = d[key]
    }
    // 迁移合并区域与 hiddenBy 引用（按位移映射 key），避免合并信息错位
    migrateMerges(d, nd, keyMap)
    return nd
  }
  const rebuildCols = (d: Record<string, Cell>, fromCol: number, count: number): Record<string, Cell> => {
    const nd: Record<string, Cell> = {}
    const keyMap: Record<string, string> = {}
    const removeCount = count < 0 ? -count : 0
    for (const key in d) {
      const [r, c] = key.split('-').map(Number)
      let nc = c
      if (count > 0) { if (c >= fromCol) nc = c + count }
      else { if (c >= fromCol + removeCount) nc = c - removeCount; else if (c >= fromCol) continue }
      const nk = `${r}-${nc}`
      keyMap[key] = nk
      nd[nk] = d[key]
    }
    migrateMerges(d, nd, keyMap)
    return nd
  }
  // 行/列增删后按位移调整尺寸表（列宽或行高）
  const shiftSizes = (m: Record<number, number>, from: number, count: number): Record<number, number> => {
    if (!count) return m
    const out: Record<number, number> = {}
    const rc = count < 0 ? -count : 0
    for (const k in m) {
      const i = Number(k)
      let ni = i
      if (count > 0) { if (i >= from) ni = i + count }
      else { if (i >= from + rc) ni = i - rc; else if (i >= from) continue }
      out[ni] = m[k]
    }
    return out
  }
  const insertRows = (at: number, count: number) => {
    pushHistory()
    setData(d => rebuildRows(d, at, count))
    setRows(r => r + count)
    setRowHeights(m => ({ ...m, [activeId]: shiftSizes(m[activeId] || {}, at, count) }))
    commitSelection({ r1: at, c1: selection.c1, r2: at, c2: selection.c1, mode: 'cell' })
    setActive({ r: at, c: active.c })
  }
  const deleteRows = (at: number, count: number) => {
    pushHistory()
    setData(d => rebuildRows(d, at, -count))
    setRows(r => Math.max(1, r - count))
    setRowHeights(m => ({ ...m, [activeId]: shiftSizes(m[activeId] || {}, at, -count) }))
    commitSelection({ r1: at, c1: selection.c1, r2: at, c2: selection.c1, mode: 'cell' })
    setActive({ r: at, c: active.c })
  }
  const insertCols = (at: number, count: number) => {
    pushHistory()
    setData(d => rebuildCols(d, at, count))
    setCols(c => c + count)
    setColWidths(m => ({ ...m, [activeId]: shiftSizes(m[activeId] || {}, at, count) }))
    commitSelection({ r1: selection.r1, c1: at, r2: selection.r1, c2: at, mode: 'cell' })
    setActive({ r: active.r, c: at })
  }
  const deleteCols = (at: number, count: number) => {
    pushHistory()
    setData(d => rebuildCols(d, at, -count))
    setCols(c => Math.max(1, c - count))
    setColWidths(m => ({ ...m, [activeId]: shiftSizes(m[activeId] || {}, at, -count) }))
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
  const switchSheet = (id: number) => {
    setSheetData(sd => ({ ...sd, [activeId]: data }))
    // 保存当前 sheet 冻结锚点并恢复目标 sheet 的
    setSheetFreeze(m => ({ ...m, [activeId]: freezeAt ? `${colName(freezeAt.c)}${freezeAt.r + 1}` : '' }))
    setData(sheetData[id] || {})
    setSheets(s => s.map(x => ({ ...x, active: x.id === id })))
    setPast([]); setFuture([])
    setFreezeAt(parseFreeze(sheetFreeze[id]))
    setSelImage(null)
    // 筛选/排序对话框/多区域是工作表级状态，切换时重置
    setAutoFilter(null); setFilterMenuCol(null); setSortDialog(null); setExtraAreas([])
  }
  const renameSheet = (id: number, name: string) => setSheets(s => s.map(x => x.id === id ? { ...x, name } : x))
  // 删除工作表（至少保留 1 个；删除当前表时活动标签回退到相邻表）
  const deleteSheet = (id: number) => {
    if (sheets.length <= 1) { alert(tf('sheet.lastSheetWarn', '至少需要保留一个工作表')); return }
    const target = sheets.find(s => s.id === id)
    if (!target) return
    if (!window.confirm(tf('sheet.deleteSheetConfirm', `确定删除工作表「${target.name}」吗？`, { name: target.name }))) return
    const remaining = sheets.filter(s => s.id !== id)
    setSheets(remaining)
    setSheetData(m => { const nm = { ...m }; delete nm[id]; return nm })
    setColWidths(m => { const nm = { ...m }; delete nm[id]; return nm })
    setRowHeights(m => { const nm = { ...m }; delete nm[id]; return nm })
    setSheetImages(m => { const nm = { ...m }; delete nm[id]; return nm })
    setSheetFreeze(m => { const nm = { ...m }; delete nm[id]; return nm })
    if (id === activeId) {
      const next = remaining[0]
      setData(sheetData[next.id] || {})
      setFreezeAt(parseFreeze(sheetFreeze[next.id]))
    }
    setPast([]); setFuture([]); setSelImage(null)
  }
  const activeSheet = sheets.find(s => s.active) || sheets[0]

  // === 排序 / 筛选（对齐 MS Excel）===
  // 从活动单元格向上找“当前连续数据区”的首行（作为表头行候选）
  const detectHeaderRow = () => {
    const rowHasData = (rr: number) => { for (let c = 0; c < cols; c++) { const cell = data[`${rr}-${c}`]; if (cell && (cell.value || cell.formula)) return true } return false }
    if (active.r < 0) return 0
    let r = active.r
    // 活动行无数据（如停在数据区下方的空行）：向上找最近的数据行再找区域顶部
    if (!rowHasData(r)) {
      let rr = r
      while (rr > 0 && !rowHasData(rr)) rr--
      if (!rowHasData(rr)) return 0
      r = rr
    }
    while (r > 0 && rowHasData(r - 1)) r--
    return r
  }
  // 值比较：数值感知（供筛选列表排序）
  const compareValues = (va: string, vb: string, numeric: boolean): number => {
    if (numeric) {
      const na = parseFloat(va), nb = parseFloat(vb)
      if (!isNaN(na) && !isNaN(nb)) return na - nb
    }
    return va.localeCompare(vb, 'zh-Hans-CN')
  }
  // 多级排序：levels 依次比较；整行搬运（样式/公式跟随），区域内合并先拆分
  const applySortLevels = (levels: SortLevel[], startRow: number, endRow: number) => {
    if (!levels.length || endRow < startRow) return
    // 写入列头排序三角指示（新排序替换旧指示）
    setSortMarks(Object.fromEntries(levels.map(l => [l.col, l.asc])))
    let hasMerge = false
    for (const key in data) {
      if (data[key].mergeRange || data[key].hiddenBy) {
        const r = Number(key.split('-')[0])
        if (r >= startRow && r <= endRow) { hasMerge = true; break }
      }
    }
    if (hasMerge && !window.confirm(tf('sheet.sortMergeWarn', '排序区域内含合并单元格，将先拆分合并再排序，是否继续？'))) return
    pushHistory()
    setData(d => {
      const stripped: Record<string, Cell> = { ...d }
      for (const key in stripped) {
        const cell = stripped[key]
        if ((cell.mergeRange || cell.hiddenBy) && Number(key.split('-')[0]) >= startRow && Number(key.split('-')[0]) <= endRow)
          stripped[key] = { ...cell, mergeRange: undefined, hiddenBy: undefined }
      }
      const idx: number[] = []
      for (let r = startRow; r <= endRow; r++) idx.push(r)
      // 数值感知：某列全为数字/空才按数值比较
      const numericOf = (col: number) => idx.every(r => { const v = (stripped[`${r}-${col}`]?.value ?? '').trim(); return v === '' || !isNaN(Number(v)) })
      // MS Excel 规则：空白始终沉底（不随升降序翻转）；多级依次比较，同级稳定
      idx.sort((a, b) => {
        for (let i = 0; i < levels.length; i++) {
          const lv = levels[i]
          const va = (stripped[`${a}-${lv.col}`]?.value ?? '').trim()
          const vb = (stripped[`${b}-${lv.col}`]?.value ?? '').trim()
          if (va === '' && vb === '') continue
          if (va === '') return 1
          if (vb === '') return -1
          const numeric = numericOf(lv.col)
          let cmp: number
          if (numeric) { const na = parseFloat(va), nb = parseFloat(vb); cmp = isNaN(na) || isNaN(nb) ? va.localeCompare(vb, 'zh-Hans-CN') : na - nb }
          else cmp = va.localeCompare(vb, 'zh-Hans-CN')
          if (cmp !== 0) return lv.asc ? cmp : -cmp
        }
        return a - b // 稳定排序：保持原相对顺序
      })
      const nd: Record<string, Cell> = { ...stripped }
      idx.forEach((srcRow, i) => {
        const dstRow = startRow + i
        if (srcRow === dstRow) return
        for (let c = 0; c < cols; c++) {
          const k = `${srcRow}-${c}`
          if (stripped[k]) nd[`${dstRow}-${c}`] = stripped[k]
          else delete nd[`${dstRow}-${c}`]
        }
      })
      return nd
    })
  }
  // 快速排序（A→Z / Z→A / 筛选下拉内排序）：
  // 选区跨多行时只排序选区行；否则排序当前数据区（表头行之下）
  const quickSort = (asc: boolean, colArg?: number) => {
    const col = colArg !== undefined ? colArg : (selection.mode === 'col' ? Math.min(selection.c1, selection.c2) : active.c)
    const multiRowSel = selection.mode === 'cell' && selection.r1 !== selection.r2
    if (multiRowSel) {
      const top = Math.min(selection.r1, selection.r2), bot = Math.max(selection.r1, selection.r2)
      const hr = detectHeaderRow()
      const start = top === hr && bot > top ? top + 1 : top
      applySortLevels([{ col, asc }], start, bot)
    } else {
      applySortLevels([{ col, asc }], detectHeaderRow() + 1, rows - 1)
    }
  }
  // 兼容旧调用（升序，跳过表头）
  const sortByCol = (asc: boolean) => quickSort(asc)

  // === 自动筛选（对齐 MS Excel 列头下拉）===
  const toggleAutoFilter = () => {
    if (autoFilter) { setAutoFilter(null); setFilterMenuCol(null); return }
    setAutoFilter({ headerRow: detectHeaderRow(), filters: {} })
  }
  const clearAllFilters = () => setAutoFilter(af => (af ? { ...af, filters: {} } : af))
  const anyFilterActive = !!autoFilter && Object.keys(autoFilter.filters).length > 0
  // 某列的候选值（含空白占位），数值感知排序（数字→文本→空白）
  const filterValues = (col: number): string[] => {
    const hr = autoFilter?.headerRow ?? 0
    const set = new Set<string>()
    for (let r = hr + 1; r < rows; r++) {
      const v = (data[`${r}-${col}`]?.value ?? '').trim()
      set.add(v === '' ? BLANK_KEY : v)
    }
    const allNumeric = [...set].every(v => v === BLANK_KEY || !isNaN(Number(v)))
    return [...set].sort((a, b) => {
      if (a === BLANK_KEY) return 1
      if (b === BLANK_KEY) return -1
      if (allNumeric) { const na = parseFloat(a), nb = parseFloat(b); if (!isNaN(na) && !isNaN(nb)) return na - nb }
      return a.localeCompare(b, 'zh-Hans-CN')
    })
  }
  // 应用某列筛选：全选=清除该列筛选
  const applyColumnFilter = (col: number, checked: string[]) => {
    setAutoFilter(af => {
      if (!af) return af
      const filters = { ...af.filters }
      if (checked.length >= filterValues(col).length) delete filters[col]
      else filters[col] = checked
      return { ...af, filters }
    })
    setFilterMenuCol(null)
  }
  // 被筛选隐藏的行（任一被筛列的值不在允许集合内即隐藏；表头行始终显示）
  const filterHiddenRows = (() => {
    const s = new Set<number>()
    if (!autoFilter) return s
    const fcols = Object.keys(autoFilter.filters).map(Number)
    if (!fcols.length) return s
    for (let r = autoFilter.headerRow + 1; r < rows; r++) {
      for (const c of fcols) {
        const v = (data[`${r}-${c}`]?.value ?? '').trim()
        const key = v === '' ? BLANK_KEY : v
        if (!autoFilter.filters[c].includes(key)) { s.add(r); break }
      }
    }
    return s
  })()

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

  // 查找匹配集合（查找条打开且有关键词时高亮所有匹配单元格）
  const findKeys = (() => {
    const s = new Set<string>()
    if (!findBar || !findBar.find) return s
    const q = findBar.find.toLowerCase()
    for (const key in data) {
      const cell = data[key]
      if ((cell.value || '').toLowerCase().includes(q) || (cell.formula || '').toLowerCase().includes(q)) s.add(key)
    }
    return s
  })()

  // 状态栏统计（对齐 MS Excel）：全部选中区域的 非空计数/数值计数/求和/平均值（被筛选隐藏的行不计入）
  const selStats = (() => {
    let count = 0, numCount = 0, sum = 0
    for (const key in data) {
      const cell = data[key]
      const v = (cell.value ?? '').trim()
      if (v === '') continue
      const [r, c] = key.split('-').map(Number)
      if (!inSelection(r, c) || filterHiddenRows.has(r) || collapsedRows.has(r)) continue
      count++
      const n = Number(v)
      if (!isNaN(n) && isFinite(n)) { numCount++; sum += n }
    }
    const fmtNum = (x: number) => { const r = Math.round(x * 100) / 100; return String(r) }
    return { count, numCount, sum: fmtNum(sum), avg: numCount ? fmtNum(sum / numCount) : '' }
  })()

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
        {/* Ribbon 整体折叠/展开（对齐 MS Office） */}
        <button onClick={() => setRibbonCollapsedPersist(!ribbonCollapsed)} data-testid="ribbon-collapse" type="button"
          className="toolbar-btn flex-shrink-0"
          title={ribbonCollapsed ? (t('ribbon.expand') || '展开功能区') : (t('ribbon.collapse') || '折叠功能区')}>{ribbonCollapsed ? '⌄' : '⌃'}</button>
      </div>

      {/* 点击外部关闭弹出面板的透明遮罩 — absolute 限制在编辑器根容器内，
          避免覆盖 header 的 tab 切换栏和 Files 菜单 */}
      {anyPanelOpen && (
        <div className="absolute inset-0" style={{ zIndex: 40 }} onClick={() => closeAllPanels()} />
      )}

      {/* Ribbon 内容区（整体折叠时不渲染，仅保留选项卡栏） */}
      {!ribbonCollapsed && (
      <div className="flex items-stretch px-1 py-1 flex-shrink-0 border-b w-full ribbon-scroll" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', minHeight: '64px', position: 'relative', zIndex: 45 }}>
        {ribbonTab === 'home' && (<>
          <RibbonGroup label={t('sheet.cell')}>
            <RibbonButton icon="⧉" label={t('sheet.copy')} onClick={() => copyCells(false)} onMouseDown={(e: any) => e.preventDefault()} />
            <RibbonButton icon="📋" label={t('sheet.paste')} onClick={() => pasteCells()} disabled={!clipboard} onMouseDown={(e: any) => e.preventDefault()} />
          </RibbonGroup>
          {/* 撤销 / 重做（对接既有历史栈） */}
          <RibbonGroup label={tf('sheet.history', '历史')}>
            <RibbonButton icon="↩" label={tf('sheet.undo', '撤销')} onClick={() => undo()} disabled={!past.length} data-testid="excel-undo-btn" title={tf('sheet.undoTitle', '撤销上一步 (Ctrl+Z)')} />
            <RibbonButton icon="↪" label={tf('sheet.redo', '重做')} onClick={() => redo()} disabled={!future.length} data-testid="excel-redo-btn" title={tf('sheet.redoTitle', '重做 (Ctrl+Y)')} />
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
            {/* 字体族 / 字号下拉（写 cell.fontFamily / cell.fontSize，作用于选区） */}
            <select value={getCell(active.r, active.c).fontFamily || ''} onChange={e => setCellFmtRange({ fontFamily: e.target.value || undefined })}
              className="text-xs px-1 py-1 rounded border max-w-[92px]" title={tf('sheet.fontFamily', '字体')}
              style={{ background: 'var(--color-bg-alt)', color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>
              <option value="">{tf('sheet.fontDefault', '默认字体')}</option>
              {['微软雅黑', '宋体', '黑体', '楷体', 'Arial', 'Times New Roman', 'Consolas'].map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            {/* 字号下拉：中文语言显示 MS Excel 中文字号（初号～八号，值为 px），英文显示数值 */}
            <select value={getCell(active.r, active.c).fontSize ? String(getCell(active.r, active.c).fontSize) : ''} onChange={e => setCellFmtRange({ fontSize: e.target.value ? Number(e.target.value) : undefined })}
              className="text-xs px-1 py-1 rounded border w-[74px]" title={tf('sheet.fontSize', '字号')}
              style={{ background: 'var(--color-bg-alt)', color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>
              <option value="">{tf('sheet.sizeDefault', '字号')}</option>
              {(lang === 'zh'
                ? CN_FONT_SIZES.map(s => ({ v: s.px, label: `${s.name} ${s.px}` }))
                : [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48].map(s => ({ v: s, label: String(s) }))
              ).map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
              {/* 当前字号不在预置列表时补一项，保证回显 */}
              {(() => { const cur = getCell(active.r, active.c).fontSize; if (!cur) return null; const inList = lang === 'zh' ? CN_FONT_SIZES.some(s => s.px === cur) : [8,9,10,11,12,14,16,18,20,24,28,36,48].includes(cur); return inList ? null : <option value={cur}>{cur}</option> })()}
            </select>
            <RibbonButton icon="🧹" label={tf('sheet.clearFormat', '清除格式')} onClick={() => clearSelectionFormat()} title={tf('sheet.clearFormatTitle', '清除选区格式（保留内容）')} />
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
            {/* 垂直对齐（顶/中/底）与自动换行（写 cell.valign / cell.wrap） */}
            <RibbonButton icon="⤒" label={tf('sheet.valignTop', '顶对齐')} onClick={() => setCellFmtRange({ valign: 'top' })} active={getCell(active.r, active.c).valign === 'top'} />
            <RibbonButton icon="⇕" label={tf('sheet.valignMiddle', '垂直居中')} onClick={() => setCellFmtRange({ valign: 'middle' })} active={getCell(active.r, active.c).valign === 'middle'} />
            <RibbonButton icon="⤓" label={tf('sheet.valignBottom', '底对齐')} onClick={() => setCellFmtRange({ valign: 'bottom' })} active={getCell(active.r, active.c).valign === 'bottom'} />
            <RibbonButton icon="⏎" label={tf('sheet.wrapText', '换行')} onClick={() => setCellFmtRange({ wrap: !getCell(active.r, active.c).wrap })} active={!!getCell(active.r, active.c).wrap} title={tf('sheet.wrapTextTitle', '自动换行')} />
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
            {/* 数字格式下拉：只改格式不改值；token 与后端 io.go fmtToken/numFmtFromToken 对应 */}
            <select value={getCell(active.r, active.c).fmt || ''} onChange={e => setCellFmtRange({ fmt: e.target.value || undefined })}
              className="text-xs px-1 py-1 rounded border w-[98px]" title={tf('sheet.numFmt', '数字格式')}
              style={{ background: 'var(--color-bg-alt)', color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>
              <option value="">{tf('sheet.fmtGeneral', '常规')}</option>
              <option value="int">{tf('sheet.fmtInt', '整数')}</option>
              <option value="thousands">{tf('sheet.fmtThousands', '千分位')}</option>
              <option value="thousands2">{tf('sheet.fmtThousands2', '千分位2')}</option>
              <option value="0.00">0.00</option>
              <option value="percent">{t('sheet.percent')}</option>
              <option value="percent2">{tf('sheet.fmtPercent2', '百分比2')}</option>
              <option value="currency">{tf('sheet.fmtCurrency', '货币')}</option>
              <option value="date">{tf('sheet.fmtDate', '日期')}</option>
            </select>
            {/* 设置单元格格式对话框入口（对齐 MS Excel 数字组右下角启动器） */}
            <RibbonButton icon="⌸" label={tf('sheet.formatCells', '设置单元格格式')} onClick={() => {
              const cell = getCell(active.r, active.c)
              setFmtDialog({ token: cell.fmt, sample: cell.value ?? '' })
            }} title={tf('sheet.formatCellsTitle', '设置单元格数字格式（数值/货币/百分比/日期，含小数位与千位分隔符）')} />
            {/* 自动求和 Σ：对选区或活动列上方连续数字区域写真公式 =SUM(...) */}
            <RibbonButton icon="Σ" label={tf('sheet.autoSum', '求和')} onClick={() => insertAutoSum()} title={tf('sheet.autoSumTitle', '对上方连续数字区域或选区写入 =SUM 公式')} />
          </RibbonGroup>
          <RibbonGroup label={t('sheet.cellOps')}>
            <RibbonButton icon="↧+" label={t('sheet.addRow')} onClick={() => setRows(r => r + 1)} />
            <RibbonButton icon="↦+" label={t('sheet.addColumn')} onClick={() => setCols(c => c + 1)} />
            {/* 在活动位置插入/删除行列（复用既有 insert/delete 逻辑，含合并/样式迁移） */}
            <RibbonButton icon="⤵" label={tf('sheet.insertRow', '插入行')} onClick={() => insertRows(active.r, 1)} title={tf('sheet.insertRowAt', '在当前行上方插入')} />
            <RibbonButton icon="⤴" label={tf('sheet.deleteRow', '删除行')} onClick={() => deleteRows(active.r, 1)} title={tf('sheet.deleteRowAt', '删除当前行')} />
            <RibbonButton icon="⇥" label={tf('sheet.insertCol', '插入列')} onClick={() => insertCols(active.c, 1)} title={tf('sheet.insertColAt', '在当前列左侧插入')} />
            <RibbonButton icon="⇤" label={tf('sheet.deleteCol', '删除列')} onClick={() => deleteCols(active.c, 1)} title={tf('sheet.deleteColAt', '删除当前列')} />
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
            {/* 真实浮动图片：选中文件后锚定当前活动格，网格上绝对定位渲染，可选中删除，保存时写回 xlsx */}
            <RibbonButton icon="🖼" label={t('sheet.image')} onClick={() => {
              const input = document.createElement('input')
              input.type = 'file'
              input.accept = 'image/*'
              input.onchange = () => {
                const file = input.files?.[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = () => {
                  const src = String(reader.result)
                  const img = new Image()
                  img.onload = () => {
                    // 显示尺寸上限 320px（最长边），保持比例
                    let w = img.width || 200, h = img.height || 150
                    const scale = Math.min(1, 320 / Math.max(w, h))
                    w = Math.round(w * scale); h = Math.round(h * scale)
                    setSheetImages(m => ({ ...m, [activeId]: [...(m[activeId] || []), { row: active.r, col: active.c, src, width: w, height: h }] }))
                  }
                  img.src = src
                }
                reader.readAsDataURL(file)
              }
              input.click()
            }} title={tf('sheet.imageTitle', '插入浮动图片（锚定当前单元格）')} />
          </RibbonGroup>
          <RibbonGroup label={t('sheet.function')}>
            <div className="relative">
              <RibbonButton icon="ƒx" label={t('sheet.function')} onClick={() => openPanel('func')} />
              {showFuncPanel && (
                <div className="absolute top-full right-0 ribbon-popup ribbon-popup_compact" style={{ minWidth: 160, zIndex: 50 }}>
                  {/* 写真公式（=SUM/…），由公式引擎求值，不再写静态值 */}
                  <button onClick={() => applySheetFunc('SUM')} className="flex w-full text-left px-3 py-1.5 text-xs gap-2 transition-colors hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>{t('sheet.sum')}</button>
                  <button onClick={() => applySheetFunc('AVERAGE')} className="flex w-full text-left px-3 py-1.5 text-xs gap-2 transition-colors hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>{t('sheet.average')}</button>
                  <button onClick={() => applySheetFunc('COUNT')} className="flex w-full text-left px-3 py-1.5 text-xs gap-2 transition-colors hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>{t('sheet.count')}</button>
                  <button onClick={() => applySheetFunc('MAX')} className="flex w-full text-left px-3 py-1.5 text-xs gap-2 transition-colors hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>{t('sheet.max')}</button>
                  <button onClick={() => applySheetFunc('MIN')} className="flex w-full text-left px-3 py-1.5 text-xs gap-2 transition-colors hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>{t('sheet.min')}</button>
                </div>
              )}
            </div>
          </RibbonGroup>
        </>)}
        {ribbonTab === 'data' && (<>
          <RibbonGroup label={t('sheet.sortFilter')}>
            <RibbonButton icon="↑" label={t('sheet.sortAsc')} onClick={() => quickSort(true)} title={tf('sheet.sortAscTitle', '按当前列升序（保留样式）')} />
            <RibbonButton icon="↓" label={t('sheet.sortDesc')} onClick={() => quickSort(false)} title={tf('sheet.sortDescTitle', '按当前列降序（保留样式）')} />
            {/* 自动筛选：开启后列头出现筛选下拉（值列表多选，对齐 MS Excel） */}
            <RibbonButton icon="🔍" label={t('sheet.filter')} onClick={() => toggleAutoFilter()} active={!!autoFilter} title={tf('sheet.filterToggleTitle', '切换自动筛选（列头出现下拉箭头）')} />
            {/* MS Office 风格多级排序对话框 */}
            <RibbonButton icon="⇅" label={t('sheet.customSort')} onClick={() => {
              setSortDialog({ levels: [{ col: active.c, asc: true }], hasHeader: true })
            }} title={t('sheet.customSortTitle')} />
            <RibbonButton icon="🖽" label={t('sheet.clearFilter')} onClick={() => { clearAllFilters(); setFilterMenuCol(null) }} disabled={!anyFilterActive} title={t('sheet.clearFilterTitle')} />
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
            <RibbonButton icon="🔄" label={t('sheet.refresh')} onClick={() => recalcAll()} title={tf('sheet.refreshRecalc', '重新计算全部公式')} />
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
            <RibbonButton icon="📌" label={frozen ? t('sheet.unfreeze') : t('sheet.freezePanes')} onClick={() => {
              const next = frozen ? null : { r: active.r, c: active.c }
              setFreezeAt(next)
              // 同步写入 sheet 级冻结锚点（保存 xlsx 时持久化）
              setSheetFreeze(m => ({ ...m, [activeId]: next ? `${colName(next.c)}${next.r + 1}` : '' }))
            }} active={frozen} title={tf('sheet.freezeTitle2', '冻结到当前单元格上方/左侧')} />
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
      )}

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
        <div className="font-mono font-semibold px-2 py-0.5 rounded" style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)', minWidth: '50px', textAlign: 'center' }}>{selToRef(selection)}{extraAreas.length ? ` +${extraAreas.length}` : ''}</div>
        <span style={{ color: 'var(--color-text-muted)' }}>fx</span>
        {(() => {
          const ac = active ? getCell(active.r, active.c) : ({ value: '' } as Cell)
          const editingHere = !!(editCell && active && editCell.r === active.r && editCell.c === active.c)
          const display = editingHere ? editCell!.buf : (ac.formula || ac.value)
          return (
            <input
              ref={fbInputRef}
              value={display}
              onFocus={() => { setFormulaBarFocused(true); if (editCell) editViaRef.current = 'bar' }}
              onBlur={() => setFormulaBarFocused(false)}
              onChange={e => {
                const v = e.target.value
                if (!active) return
                if (editingHere && editCell) { setEditCell({ ...editCell, buf: v }); return }
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
                  e.preventDefault()
                  if (editingHere) { commitEdit({ dr: 1, dc: 0 }); return }
                  const v = (e.target as HTMLInputElement).value
                  if (!active) return
                  if (v.startsWith('=')) {
                    setCellFmt(active.r, active.c, { formula: v, value: '' })
                  } else {
                    setCellFmt(active.r, active.c, { formula: '', value: v })
                  }
                  ;(e.target as HTMLInputElement).blur()
                  gridRef.current?.focus()
                } else if (e.key === 'Escape' && editingHere) {
                  e.preventDefault(); cancelEdit()
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

      {/* 查找替换条（Ctrl+F 呼出；高亮匹配单元格 + 全部替换） */}
      {findBar && (
        <div className="px-3 py-1.5 flex items-center gap-2 flex-shrink-0 text-xs flex-wrap" style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
          <span style={{ color: 'var(--color-text-muted)' }}>🔍</span>
          <input autoFocus value={findBar.find} onChange={e => setFindBar({ ...findBar, find: e.target.value })}
            placeholder={tf('sheet.findPlaceholder', '查找内容')} className="border rounded px-2 py-1"
            style={{ width: 150, background: 'var(--color-bg-alt)', color: 'var(--color-text)', borderColor: 'var(--color-border)' }} />
          <span style={{ color: 'var(--color-text-muted)' }}>{findKeys.size} {tf('sheet.findMatches', '个匹配')}</span>
          <input value={findBar.replace} onChange={e => setFindBar({ ...findBar, replace: e.target.value })}
            placeholder={tf('sheet.replacePlaceholder', '替换为')} className="border rounded px-2 py-1"
            style={{ width: 150, background: 'var(--color-bg-alt)', color: 'var(--color-text)', borderColor: 'var(--color-border)' }} />
          <button onClick={replaceAllMatches} className="btn btn-primary btn-sm">{tf('sheet.replaceAll', '全部替换')}</button>
          <button onClick={() => setFindBar(null)} className="btn btn-sm" style={{ background: 'var(--color-bg-alt)', color: 'var(--color-text)' }}>{tf('sheet.findClose', '关闭')}</button>
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
        {/* 网格容器持有键盘焦点（Excel 模型）：方向键/回车/输入即编辑等由 onGridKeyDown 统一处理 */}
        <div className="relative" ref={gridRef} tabIndex={0} onKeyDown={onGridKeyDown} style={{ outline: 'none' }}>
        <table className="border-collapse text-sm" style={{ background: '#ffffff', boxShadow: 'var(--shadow-sm)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          {showHeadings && (
          <thead>
            <tr>
              <th className="w-10 sm:w-12 h-8 text-xs font-medium sticky top-0 z-20" style={{ background: 'var(--color-bg-alt)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}></th>
              {Array.from({ length: cols }).map((_, c) => {
                const w = curColWidths[c] || 80
                const colSel = colInAnyArea(c)
                const hasColFilter = !!autoFilter && autoFilter.filters[c] !== undefined
                return (
                <th key={c}
                  className={`w-20 sm:w-24 h-8 text-xs font-medium sticky top-0 transition-colors cursor-pointer select-none`}
                  style={{ zIndex: filterMenuCol === c ? 45 : 10, background: colSel ? 'rgba(59,130,246,0.30)' : (active.c === c ? 'rgba(59,130,246,0.14)' : 'var(--color-bg-alt)'), border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', width: `${w}px`, minWidth: `${w}px` }}
                  onMouseDown={e => {
                    // 对齐 MS Excel：Ctrl+点击 追加/取消列选区（可拖拽扩展）；Shift+点击 从锚点扩展
                    if (e.ctrlKey || e.metaKey) {
                      e.preventDefault()
                      const exIdx = extraAreas.findIndex(a => a.mode === 'col' && Math.min(a.c1, a.c2) === Math.max(a.c1, a.c2) && a.c1 === c)
                      if (exIdx >= 0) setExtraAreas(arr => arr.filter((_, i) => i !== exIdx))
                      else setExtraAreas(arr => [...arr, { r1: 0, r2: rows - 1, c1: c, c2: c, mode: 'col' }])
                      colDragRef.current = { anchor: c, additive: true }
                      return
                    }
                    if (e.shiftKey) { e.preventDefault(); selectColSpan(Math.min(colAnchorRef.current, c), Math.max(colAnchorRef.current, c)); return }
                    e.preventDefault()
                    colAnchorRef.current = c
                    selectColSpan(c, c)
                    colDragRef.current = { anchor: c, additive: false }
                  }}
                  onMouseEnter={() => {
                    const d = colDragRef.current
                    if (!d) return
                    if (d.additive) updateLastExtraArea({ r1: 0, r2: rows - 1, c1: Math.min(d.anchor, c), c2: Math.max(d.anchor, c), mode: 'col' })
                    else selectColSpan(Math.min(d.anchor, c), Math.max(d.anchor, c))
                  }}
                  title={tf('sheet.selectCol', '选择整列')}>
                  {colName(c)}
                  {/* 排序方向三角（对齐 MS Excel：排序后列头显示 ▲/▼，点击可反向重排） */}
                  {sortMarks[c] !== undefined && (
                    <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[10px] leading-none"
                      style={{ color: 'var(--color-primary)', fontWeight: 700, cursor: 'pointer' }}
                      title={sortMarks[c] ? tf('sheet.sortedAsc', '已升序排序，点击改为降序') : tf('sheet.sortedDesc', '已降序排序，点击改为升序')}
                      onMouseDown={e => e.stopPropagation()}
                      onClick={e => { e.stopPropagation(); quickSort(!sortMarks[c], c) }}
                    >{sortMarks[c] ? '▲' : '▼'}</span>
                  )}
                  {/* 右缘拖拽调整列宽 */}
                  <span className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize" title={tf('sheet.resizeCol', '拖拽调整列宽')}
                    onMouseDown={e => startColResize(e, c)} />
                  {/* 自动筛选下拉按钮（对齐 MS Excel 列头漏斗/箭头） */}
                  {autoFilter && (
                    <span
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-sm text-[9px] leading-none"
                      style={{ background: hasColFilter ? 'var(--color-primary)' : 'var(--color-surface)', color: hasColFilter ? '#fff' : 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}
                      title={tf('sheet.filterMenuTitle', '筛选')}
                      onMouseDown={e => { e.stopPropagation(); e.preventDefault() }}
                      onClick={e => { e.stopPropagation(); setFilterMenuCol(filterMenuCol === c ? null : c) }}
                    >▼</span>
                  )}
                  {filterMenuCol === c && (
                    <FilterDropdown
                      values={filterValues(c)}
                      initial={hasColFilter ? autoFilter!.filters[c] : filterValues(c)}
                      labels={{
                        asc: t('sheet.sortAsc'), desc: t('sheet.sortDesc'),
                        blank: tf('sheet.filterBlank', '(空白)'), all: tf('sheet.filterSelectAll', '全选'),
                        search: tf('sheet.filterSearch', '搜索'), ok: tf('sheet.filterOk', '确定'), cancel: tf('sheet.filterCancel', '取消'),
                      }}
                      onSort={asc => { setFilterMenuCol(null); quickSort(asc, c) }}
                      onApply={keys => applyColumnFilter(c, keys)}
                      onCancel={() => setFilterMenuCol(null)}
                    />
                  )}
                </th>
                )
              })}
            </tr>
          </thead>
          )}
          <tbody>
            {Array.from({ length: rows }).map((_, r) => {
              // 分组折叠的行 / 筛选掉的行不渲染（非破坏性）
              if (collapsedRows.has(r)) return null
              if (filterHiddenRows.has(r)) return null
              const gr = groupStartOf(r)
              const isFrozenRow = frozen && r < freezeAt!.r
              const frozenTop = 32 + rowTop(r) // 表头 h-8(32px) + 上方各行实际高度
              const rowHpx = rowH(r)
              return (
              <tr key={r} style={rowHpx !== 28 ? { height: rowHpx } : undefined}>
                {showHeadings && (
                <td className={`w-10 sm:w-12 h-7 text-center text-xs transition-colors cursor-pointer select-none ${isFrozenRow ? 'sticky z-30' : ''}`}
                  style={{ background: rowInAnyArea(r) ? 'rgba(59,130,246,0.30)' : (active.r === r ? 'rgba(59,130,246,0.14)' : 'var(--color-bg-alt)'), border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', top: isFrozenRow ? frozenTop : undefined, left: frozen && freezeAt!.c > 0 ? 0 : undefined, height: rowHpx }}
                  onMouseDown={e => {
                    // 对齐 MS Excel：Ctrl+点击 追加/取消行选区；Shift+点击 从锚点扩展；按下拖动连续多选
                    if (e.ctrlKey || e.metaKey) {
                      e.preventDefault()
                      const exIdx = extraAreas.findIndex(a => a.mode === 'row' && Math.min(a.r1, a.r2) === Math.max(a.r1, a.r2) && a.r1 === r)
                      if (exIdx >= 0) setExtraAreas(arr => arr.filter((_, i) => i !== exIdx))
                      else setExtraAreas(arr => [...arr, { r1: r, c1: 0, r2: r, c2: cols - 1, mode: 'row' }])
                      rowDragRef.current = { anchor: r, additive: true }
                      return
                    }
                    if (e.shiftKey) { e.preventDefault(); selectRowSpan(Math.min(rowAnchorRef.current, r), Math.max(rowAnchorRef.current, r)); return }
                    e.preventDefault()
                    rowAnchorRef.current = r
                    selectRowSpan(r, r)
                    rowDragRef.current = { anchor: r, additive: false }
                  }}
                  onMouseEnter={() => {
                    const d = rowDragRef.current
                    if (!d) return
                    if (d.additive) updateLastExtraArea({ r1: Math.min(d.anchor, r), c1: 0, r2: Math.max(d.anchor, r), c2: cols - 1, mode: 'row' })
                    else selectRowSpan(Math.min(d.anchor, r), Math.max(d.anchor, r))
                  }}
                  title={tf('sheet.selectRow', '选择整行')}>
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
                  const isEditing = editCell?.r === r && editCell?.c === c
                  const mergeRange = cell.mergeRange
                  const sel = inSelection(r, c)
                  const bw = cell.border === 'thick' ? '3px' : cell.border === 'medium' ? '2px' : cell.border === 'thin' ? '1px' : undefined
                  const isFrozenCell = frozen && (c < freezeAt!.c)
                  const gridOff = !showGrid
                  const cw = curColWidths[c] || 80
                  // 查找高亮：无填充色时用琥珀色底标记匹配（关闭查找条即消失）
                  const findHit = findKeys.has(`${r}-${c}`)
                  const valignMap: Record<string, string> = { top: 'top', middle: 'middle', bottom: 'bottom' }
                  // === Excel 式选区渲染（支持多区域）===
                  // 每个选中区域独立外框（2px 主色 inset shadow 拼边）；区域内浅蓝叠加；
                  // 活动格保持原底色（白/自身填充色）+ 1px 细框。
                  // 对齐 MS Excel 的两个关键修复：
                  // 1) 选区底色用「半透明蓝叠加在原填充色之上」（linear-gradient 双层背景），
                  //    不再整体替换原填充色 —— 否则带填充色的格子被选中后像被灰蓝"糊住"，
                  //    用户看起来就像"周围格子被覆盖了样式"。
                  // 2) 合并单元格的边缘判断用合并区的真实边界（锚点 + rowSpan/colSpan-1），
                  //    否则跨行/列合并格的选区外框会出现缺口（如合并格底部无边框线）。
                  const singleSel = selection.mode === 'cell' && selection.r1 === selection.r2 && selection.c1 === selection.c2 && extraAreas.length === 0
                  const mr = mergeRange
                  const effR1 = r
                  const effR2 = r + (mr?.rowSpan || 1) - 1
                  const effC1 = c
                  const effC2 = c + (mr?.colSpan || 1) - 1
                  const shadowParts: string[] = []
                  for (const a of allAreas()) {
                    const n = normArea(a)
                    let hit = false
                    let eT = false, eB = false, eL = false, eR = false
                    if (a.mode === 'row') {
                      if (r < n.r1 || r > n.r2) continue
                      hit = true; eT = effR1 === n.r1; eB = effR2 === n.r2; eL = c === 0; eR = c === cols - 1
                    } else if (a.mode === 'col') {
                      if (c < n.c1 || c > n.c2) continue
                      hit = true; eT = r === 0; eB = effR2 === rows - 1; eL = effC1 === n.c1; eR = effC2 === n.c2
                    } else {
                      if (r < n.r1 || r > n.r2 || c < n.c1 || c > n.c2) continue
                      hit = true; eT = effR1 === n.r1; eB = effR2 === n.r2; eL = effC1 === n.c1; eR = effC2 === n.c2
                    }
                    if (!hit) continue
                    if (eT) shadowParts.push('inset 0 2px 0 0 var(--color-primary)')
                    if (eB) shadowParts.push('inset 0 -2px 0 0 var(--color-primary)')
                    if (eL) shadowParts.push('inset 2px 0 0 0 var(--color-primary)')
                    if (eR) shadowParts.push('inset -2px 0 0 0 var(--color-primary)')
                  }
                  if (isActive && sel && !singleSel) shadowParts.push('inset 0 0 0 1px var(--color-primary)')
                  // 选区叠加层：半透明蓝叠在原填充色上（MS Excel 行为——填充色仍隐约可见）
                  const selOverlay = `linear-gradient(rgba(59,130,246,0.22), rgba(59,130,246,0.22)), ${cell.bg || '#ffffff'}`
                  return (
                    <td key={c} className={`border p-0 relative ${isFrozenCell ? 'sticky z-30' : ''}`} rowSpan={mergeRange?.rowSpan} colSpan={mergeRange?.colSpan} style={{
                      // 电子表格是“白纸”：无填充单元格固定白底、深色字，与应用主题无关
                      // （否则暗色主题下会渲染成大片黑背景，且与 Excel 显示不一致）
                      background: sel ? (isActive ? (cell.bg || '#ffffff') : selOverlay) : (findHit && !cell.bg ? 'rgba(253,230,138,0.55)' : (cell.bg || '#ffffff')),
                      borderColor: cell.border && cell.border !== 'none' ? (cell.borderColor || (gridOff ? 'transparent' : '#000')) : (gridOff ? 'transparent' : 'var(--color-border)'),
                      borderWidth: bw,
                      width: `${cw}px`,
                      minWidth: `${cw}px`,
                      verticalAlign: cell.valign ? valignMap[cell.valign] : undefined,
                      left: isFrozenCell ? colLeft(c) : undefined,
                      boxShadow: shadowParts.length ? shadowParts.join(', ') : undefined,
                    }}
                      onMouseDown={e => {
                        // 公式引用点选：编辑以 = 开头的内容时，点击单元格插入其引用（Excel 行为）
                        if (refModeActive) { e.preventDefault(); insertCellRef(r, c, e.shiftKey || !!refDragRef.current); return }
                        // 对齐 MS Excel：Ctrl+点击 追加/取消选区，Ctrl+拖拽 框选新区域
                        if (e.ctrlKey || e.metaKey) {
                          e.preventDefault()
                          const exIdx = extraAreas.findIndex(a => a.mode === 'cell' && a.r1 === a.r2 && a.c1 === a.c2 && a.r1 === r && a.c1 === c)
                          const isPrimarySingle = selection.mode === 'cell' && selection.r1 === selection.r2 && selection.c1 === selection.c2 && selection.r1 === r && selection.c1 === c
                          if (exIdx >= 0) setExtraAreas(arr => arr.filter((_, i) => i !== exIdx))
                          else if (!isPrimarySingle || extraAreas.length) setExtraAreas(arr => [...arr, { r1: r, c1: c, r2: r, c2: c, mode: 'cell' }])
                          ctrlDragRef.current = { r, c }
                          setDragging(true)
                          gridRef.current?.focus()
                          return
                        }
                        if (e.shiftKey) { e.preventDefault(); extendTo(r, c); gridRef.current?.focus(); return }
                        selectCell(r, c); setSelImage(null); setDragging(true); gridRef.current?.focus()
                      }}
                      onMouseEnter={() => {
                        if (refModeActive && refDragRef.current) { insertCellRef(r, c, true); return }
                        // Ctrl+拖拽：更新最后一个附加区域（新框选区域）
                        if (dragging && ctrlDragRef.current) {
                          const a = ctrlDragRef.current
                          updateLastExtraArea({ r1: Math.min(a.r, r), c1: Math.min(a.c, c), r2: Math.max(a.r, r), c2: Math.max(a.c, c), mode: 'cell' })
                          return
                        }
                        if (dragging) selectRange(Math.min(active.r, r), Math.min(active.c, c), Math.max(active.r, r), Math.max(active.c, c))
                      }}
                      onMouseUp={() => { setDragging(false); refDragRef.current = null }}
                      onDoubleClick={e => { if (refModeActive) return; e.preventDefault(); startEdit(r, c) }}
                      onContextMenu={e => {
                        e.preventDefault()
                        if (!inSelection(r, c)) selectCell(r, c)
                        setMenu({ x: e.clientX, y: e.clientY, r, c })
                      }}>
                      {(() => {
                        const v = cell.value
                        const decoration = [cell.under ? 'underline' : '', cell.strike ? 'line-through' : ''].filter(Boolean).join(' ')
                        const common = { color: cell.color || '#1f2937', fontWeight: cell.bold ? 700 : 400, fontStyle: cell.italic ? 'italic' as const : undefined, textAlign: cell.align || (mergeRange ? 'center' : 'left'), textDecoration: decoration || undefined, fontSize: cell.fontSize ? `${cell.fontSize}px` : undefined, fontFamily: cell.fontFamily || undefined }
                        // === 编辑态：仅正在编辑的单元格渲染输入控件（Excel 模型）===
                        if (isEditing && editCell) {
                          if (cell.wrap) {
                            return <textarea ref={editInputRef as any} value={editCell.buf} onChange={e => setEditCell({ ...editCell, buf: e.target.value })} onKeyDown={e => onEditKeyDown(e, true)} rows={1} className="w-full px-2 outline-none bg-transparent resize-none" style={{ ...common as any, whiteSpace: 'pre-wrap', overflow: 'hidden' }} />
                          }
                          if (cell.valid) {
                            const opts = cell.valid.split(',').map(x => x.trim()).filter(Boolean)
                            return <select ref={editInputRef as any} value={editCell.buf} onChange={e => setEditCell({ ...editCell, buf: e.target.value })} onKeyDown={e => onEditKeyDown(e, false)} className="w-full h-7 px-1 outline-none bg-transparent" style={common as any}>
                              {!opts.includes(editCell.buf) && <option value={editCell.buf}>{editCell.buf || ' '}</option>}
                              {opts.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          }
                          return <input ref={editInputRef as any} type="text" value={editCell.buf} onChange={e => setEditCell({ ...editCell, buf: e.target.value })} onKeyDown={e => onEditKeyDown(e, false)} className="w-full h-7 px-2 outline-none bg-transparent" style={common as any} />
                        }
                        // === 显示态：纯 span 展示（不抢占键盘焦点，方向键/回车/输入由网格统一处理）===
                        const display = fmtDisplay(cell)
                        return (
                          <>
                            <span className="block w-full px-2 outline-none bg-transparent" style={{ ...common as any, lineHeight: `${rowH(r)}px`, minHeight: rowH(r), whiteSpace: cell.wrap ? 'pre-wrap' : 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{display}</span>
                            {isActive && cell.valid && (
                              <span title={tf('sheet.editCell', '双击或输入编辑')} onMouseDown={e => { e.preventDefault(); e.stopPropagation(); startEdit(r, c) }}
                                className="absolute right-0 top-0 h-full w-4 flex items-center justify-center text-[9px] cursor-pointer"
                                style={{ color: 'var(--color-text-muted)' }}>▾</span>
                            )}
                          </>
                        )
                      })()}
                    </td>
                  )
                })}
              </tr>
              )
            })}
          </tbody>
        </table>
        {/* 浮动图片层：锚定单元格，随列宽/行高定位；点击选中，Delete 删除 */}
        {curImages.map((im, idx) => (
          <img key={idx} src={im.src} alt="" draggable={false}
            style={{
              position: 'absolute',
              left: colLeft(im.col) + 2,
              top: rowTop(im.row) + 2,
              width: im.width || 'auto',
              height: im.height || 'auto',
              maxWidth: 'none',
              outline: selImage === idx ? '2px solid var(--color-primary)' : 'none',
              cursor: 'pointer',
              zIndex: 35,
            }}
            onMouseDown={e => { e.stopPropagation(); setSelImage(idx) }}
            title={tf('sheet.imageSelectedHint', '点击选中，Delete 删除')} />
        ))}
        </div>
      </div>

      {/* 多级排序对话框（MS Excel 风格） */}
      {sortDialog && (
        <SortDialog
          cols={cols}
          colName={colName}
          headerText={c => (autoFilter ? (data[`${autoFilter.headerRow}-${c}`]?.value ?? '') : (data[`${detectHeaderRow()}-${c}`]?.value ?? ''))}
          initLevels={sortDialog.levels}
          initHasHeader={sortDialog.hasHeader}
          labels={{
            title: tf('sheet.sortDialogTitle', '排序'),
            major: tf('sheet.sortMajor', '主要关键字'),
            add: tf('sheet.sortAddLevel', '添加条件'),
            del: tf('sheet.sortDelLevel', '删除条件'),
            header: tf('sheet.sortHasHeader', '数据包含标题'),
            ok: tf('sheet.sortOk', '确定'), cancel: tf('sheet.sortCancel', '取消'),
            asc: t('sheet.sortAsc'), desc: t('sheet.sortDesc'),
          }}
          onClose={() => setSortDialog(null)}
          onApply={(levels, hasHeader) => {
            const hr = detectHeaderRow()
            const multiRowSel = selection.mode === 'cell' && selection.r1 !== selection.r2
            let start = hasHeader ? hr + 1 : hr
            let end = rows - 1
            if (multiRowSel) {
              const top = Math.min(selection.r1, selection.r2), bot = Math.max(selection.r1, selection.r2)
              start = hasHeader && top === hr ? top + 1 : top
              end = bot
            }
            applySortLevels(levels, start, end)
            setSortDialog(null)
          }}
        />
      )}

      {/* 设置单元格格式对话框（对齐 MS Excel：分类/小数位/千位分隔/货币符号/日期类型，作用于整个选区） */}
      {fmtDialog && (
        <FormatCellsDialog
          sample={fmtDialog.sample}
          initToken={fmtDialog.token}
          labels={{
            title: tf('sheet.fmtDialogTitle', '设置单元格格式'),
            general: tf('sheet.fmtGeneral', '常规'), number: tf('sheet.fmtNumber', '数值'),
            currency: tf('sheet.fmtCurrency', '货币'), percent: t('sheet.percent'),
            date: tf('sheet.fmtDate', '日期'), text: tf('sheet.fmtText', '文本'),
            decimals: tf('sheet.fmtDecimals', '小数位数'), thousands: tf('sheet.fmtUseThou', '使用千位分隔符'),
            symbol: tf('sheet.fmtSymbol', '货币符号'), type: tf('sheet.fmtType', '类型'),
            sample: tf('sheet.fmtSample', '示例'), notNum: tf('sheet.fmtNotNum', '（不是数值）'),
            textHint: tf('sheet.fmtTextHint', '文本格式：输入什么就显示什么（不改数值计算）'),
            ok: tf('sheet.sortOk', '确定'), cancel: tf('sheet.sortCancel', '取消'),
          }}
          onClose={() => setFmtDialog(null)}
          onApply={token => { setCellFmtRange({ fmt: token }); setFmtDialog(null) }}
        />
      )}

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
            {ctxItem(tf('sheet.clearContent', '清除内容'), '⌫', () => clearCellsContent())}
            {ctxItem(tf('sheet.insertRowAbove', '在上方插入行'), '↥', () => insertRows(sr.r1, 1))}
            {ctxItem(tf('sheet.insertRowBelow', '在下方插入行'), '↧', () => insertRows(sr.r2 + 1, 1))}
            {ctxItem(tf('sheet.insertColLeft', '在左侧插入列'), '↤', () => insertCols(sr.c1, 1))}
            {ctxItem(tf('sheet.insertColRight', '在右侧插入列'), '↦', () => insertCols(sr.c2 + 1, 1))}
            {sep}
            {ctxItem(tf('sheet.deleteRows', '删除行'), '🗑', () => deleteRows(sr.r1, sr.r2 - sr.r1 + 1))}
            {ctxItem(tf('sheet.deleteCols', '删除列'), '🗑', () => deleteCols(sr.c1, sr.c2 - sr.c1 + 1))}
            {sep}
            {/* 行高 / 列宽（prompt 输入 px；行高仅当前会话生效，列宽保存时写回 xlsx） */}
            {ctxItem(tf('sheet.rowHeight', '行高'), '↕', () => {
              const v = prompt(tf('sheet.rowHeightPrompt', '输入行高(px，28 为默认)：'), String(rowH(menu.r)))
              if (v === null) return
              const h = Math.max(20, Math.min(400, Number(v) || 28))
              setRowHeights(m => ({ ...m, [activeId]: { ...(m[activeId] || {}), [menu.r]: h } }))
            })}
            {ctxItem(tf('sheet.colWidth', '列宽'), '↔', () => {
              const v = prompt(tf('sheet.colWidthPrompt', '输入列宽(px，80 为默认)：'), String(curColWidths[menu.c] || 80))
              if (v === null) return
              const w = Math.max(40, Math.min(600, Number(v) || 80))
              setColWidths(m => ({ ...m, [activeId]: { ...(m[activeId] || {}), [menu.c]: w } }))
            })}
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

      {/* Sheet 标签栏（双击重命名；右侧 + 新建 / 🗑 删除当前表） */}
      <div className="px-2 py-1 flex items-center gap-1 overflow-x-auto flex-shrink-0" style={{ background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)' }}>
        {sheets.map(s => (
          <button key={s.id} onClick={() => switchSheet(s.id)}
            onDoubleClick={() => { const name = prompt(tf('sheet.renamePrompt', '重命名工作表：'), s.name); if (name && name.trim()) renameSheet(s.id, name.trim()) }}
            title={tf('sheet.renameHint', '双击重命名')}
            className={`px-3 py-1 text-xs rounded-t-md transition-all whitespace-nowrap ${s.active ? 'font-semibold' : 'opacity-60 hover:opacity-100'}`}
            style={{ background: s.active ? 'var(--color-primary-light)' : 'transparent', color: s.active ? 'var(--color-primary)' : 'var(--color-text-secondary)', borderBottom: s.active ? '2px solid var(--color-primary)' : '2px solid transparent' }}>{s.name}</button>
        ))}
        <button onClick={addSheet} className="px-2 py-1 text-xs rounded transition-colors hover:opacity-70" style={{ color: 'var(--color-text-muted)' }} title={t('sheet.newSheet')}>+</button>
        <button onClick={() => deleteSheet(activeId)} className="px-2 py-1 text-xs rounded transition-colors hover:opacity-70" style={{ color: 'var(--color-text-muted)' }} title={tf('sheet.deleteSheet', '删除当前工作表')}>🗑</button>
      </div>

      {/* 底部状态栏 */}
      <div className="px-3 py-1.5 text-xs flex items-center gap-3 flex-shrink-0" style={{ background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>{t('sheet.ready')}</span>
        {selStats.count > 0 && (
          <span className="flex items-center gap-3">
            <span>{tf('sheet.statusCount', '计数')}: {selStats.count}</span>
            {selStats.numCount > 0 && (
              <>
                <span>{tf('sheet.statusNumCount', '数值计数')}: {selStats.numCount}</span>
                <span>{tf('sheet.statusSum', '求和')}: {selStats.sum}</span>
                <span>{tf('sheet.statusAvg', '平均值')}: {selStats.avg}</span>
              </>
            )}
          </span>
        )}
        <div className="flex-1" />
        <span className="font-mono">{colName(active.c)}{active.r + 1}</span>
        <span style={{ color: 'var(--color-border-strong)' }}>|</span>
        <span className="truncate max-w-[120px]">{getCell(active.r, active.c).value || t('sheet.empty')}</span>
      </div>
    </div>
  )
}
