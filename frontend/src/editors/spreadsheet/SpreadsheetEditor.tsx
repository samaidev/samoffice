import { useState, useEffect } from 'react'
import { useI18n } from '../../i18n'
import { PrintDialog } from '../../components/PrintDialog'

interface Cell {
  value: string; formula?: string
  bold?: boolean; color?: string; bg?: string
  align?: 'left' | 'center' | 'right'
  format?: 'percent' | 'decimal' | 'general'
  // 合并单元格：mergeRange = { rowSpan, colSpan } 表示此单元格是合并区域的左上角
  // 被合并覆盖的单元格用 hiddenBy = "r-c" 标记（指向左上角）
  mergeRange?: { rowSpan: number; colSpan: number }
  hiddenBy?: string
}
interface Props { initialRows?: number; initialCols?: number; title?: string }

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

export function SpreadsheetEditor({ initialRows = 30, initialCols = 12, title }: Props) {
  const { t } = useI18n()
  const [rows, setRows] = useState(initialRows)
  const [cols, setCols] = useState(initialCols)
  const [data, setData] = useState<Record<string, Cell>>({})
  const [active, setActive] = useState<{ r: number; c: number }>({ r: 0, c: 0 })
  const [sheets, setSheets] = useState([
    { id: 1, name: title || t('app.sheet1'), active: true },
    { id: 2, name: 'Sheet2', active: false },
  ])
  const [ribbonTab, setRibbonTab] = useState<RibbonTab>('home')
  const [zoom, setZoom] = useState(100)
  const [frozen, setFrozen] = useState(false)
  const [showChartPanel, setShowChartPanel] = useState(false)
  const [showShapePanel, setShowShapePanel] = useState(false)
  const [showFuncPanel, setShowFuncPanel] = useState(false)
  const [showCondPanel, setShowCondPanel] = useState(false)
  const [showValidPanel, setShowValidPanel] = useState(false)
  // 弹出面板互斥：同时只允许一个面板打开，避免多个弹出菜单重叠
  type PanelName = 'chart' | 'shape' | 'func' | 'cond' | 'valid'
  const openPanel = (which: PanelName) => {
    setShowChartPanel(which === 'chart' ? !showChartPanel : false)
    setShowShapePanel(which === 'shape' ? !showShapePanel : false)
    setShowFuncPanel(which === 'func' ? !showFuncPanel : false)
    setShowCondPanel(which === 'cond' ? !showCondPanel : false)
    setShowValidPanel(which === 'valid' ? !showValidPanel : false)
  }
  const closeAllPanels = () => {
    setShowChartPanel(false); setShowShapePanel(false); setShowFuncPanel(false)
    setShowCondPanel(false); setShowValidPanel(false)
  }
  const anyPanelOpen = showChartPanel || showShapePanel || showFuncPanel || showCondPanel || showValidPanel
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

  const colName = (c: number) => {
    if (c < 26) return String.fromCharCode(65 + c)
    return String.fromCharCode(65 + Math.floor(c / 26) - 1) + String.fromCharCode(65 + (c % 26))
  }
  const getCell = (r: number, c: number): Cell => data[`${r}-${c}`] || { value: '' }
  const setCell = (r: number, c: number, value: string) => setData(d => {
    const existing = d[`${r}-${c}`] || {}
    return { ...d, [`${r}-${c}`]: { ...existing, value } }
  })
  const setCellFmt = (r: number, c: number, fmt: Partial<Cell>) => setData(d => {
    const existing = d[`${r}-${c}`] || { value: '' }
    return { ...d, [`${r}-${c}`]: { ...existing, ...fmt } }
  })

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

  // === 图表 ===
  const [charts, setCharts] = useState<{ id: number; type: string; data: number[]; labels: string[]; title: string }[]>([])
  const addChart = (type: string) => {
    // 从当前列收集数据
    const values: number[] = []
    const labels: string[] = []
    for (let r = 0; r < rows; r++) {
      const v = parseFloat(getCell(r, active.c).value)
      if (!isNaN(v)) { values.push(v); labels.push(`${r + 1}`) }
    }
    if (values.length === 0) { alert(t('sheet.noData') || 'No numeric data in this column'); return }
    setCharts(cs => [...cs, { id: Date.now(), type, data: values, labels, title: `${colName(active.c)} - ${type}` }])
    setShowChartPanel(false)
  }
  const removeChart = (id: number) => setCharts(cs => cs.filter(c => c.id !== id))
  const addSheet = () => { const id = Math.max(...sheets.map(s => s.id)) + 1; setSheets(s => [...s.map(x => ({ ...x, active: false })), { id, name: `Sheet${id}`, active: true }]) }
  const switchSheet = (id: number) => setSheets(s => s.map(x => ({ ...x, active: x.id === id })))
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
    <div className="flex flex-col h-full" style={{ background: 'var(--color-bg-alt)' }}>
      {/* Ribbon Tab 栏 — 可横向滚动，右侧信息固定 */}
      <div className="flex items-center px-2 flex-shrink-0 border-b" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', position: 'relative', zIndex: 45 }}>
        <div className="ribbon-tab-scroll">
          {ribbonTabs.map(t => (
            <button key={t.id} onClick={() => setRibbonTab(t.id)} data-testid={`ribbon-tab-${t.id}`} className="px-2 sm:px-4 py-2 text-sm font-medium transition-colors"
              style={{ color: ribbonTab === t.id ? 'var(--color-primary)' : 'var(--color-text-secondary)', borderBottom: ribbonTab === t.id ? '2px solid var(--color-primary)' : '2px solid transparent', background: ribbonTab === t.id ? 'var(--color-primary-50)' : 'transparent' }}>{t.label}</button>
          ))}
        </div>
        <span className="text-xs flex-shrink-0 px-2" style={{ color: 'var(--color-text-muted)' }}>{rows} {t('sheet.rows')} × {cols} {t('sheet.cols')}</span>
      </div>

      {/* 点击外部关闭弹出面板的透明遮罩 */}
      {anyPanelOpen && (
        <div className="fixed inset-0" style={{ zIndex: 40 }} onClick={() => closeAllPanels()} />
      )}

      {/* Ribbon 内容区 */}
      <div className="flex items-stretch px-1 py-1 flex-shrink-0 border-b w-full ribbon-scroll" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', minHeight: '64px', position: 'relative', zIndex: 45 }}>
        {ribbonTab === 'home' && (<>
          <RibbonGroup label={t('sheet.cell')}>
            <RibbonButton icon="📋" label={t('sheet.copy')} onClick={() => navigator.clipboard.writeText(getCell(active.r, active.c).value)} />
            <RibbonButton icon="📥" label={t('sheet.paste')} onClick={() => { navigator.clipboard.readText().then(t => setCell(active.r, active.c, t)) }} />
          </RibbonGroup>
          <RibbonGroup label={t('sheet.font')}>
            <RibbonButton icon="B" label={t('sheet.bold')} onClick={() => setCellFmt(active.r, active.c, { bold: !getCell(active.r, active.c).bold })} active={getCell(active.r, active.c).bold} />
            <div className="relative group">
              <RibbonButton icon="🎨" label={t('doc.color')} onClick={() => {}} />
              <div className="absolute top-full ribbon-popup hidden group-hover:block ribbon-popup-right" style={{ right: 0, left: 'auto', padding: '0.5rem' }}>
                <div className="grid grid-cols-4 gap-1">
                  {['#000000','#ef4444','#f59e0b','#10b981','#3b82f6','#6366f1','#8b5cf6','#ec4899'].map(c => (
                    <button key={c} onClick={() => setCellFmt(active.r, active.c, { color: c })} className="w-5 h-5 rounded transition-transform hover:scale-110" style={{ background: c }} title={c} />
                  ))}
                </div>
              </div>
            </div>
          </RibbonGroup>
          <RibbonGroup label={t('sheet.alignment')}>
            <RibbonButton icon="⬅" label={t('sheet.alignLeft')} onClick={() => setCellFmt(active.r, active.c, { align: 'left' })} active={getCell(active.r, active.c).align === 'left'} />
            <RibbonButton icon="⬌" label={t('sheet.alignCenter')} onClick={() => setCellFmt(active.r, active.c, { align: 'center' })} active={getCell(active.r, active.c).align === 'center'} />
            <RibbonButton icon="➡" label={t('sheet.alignRight')} onClick={() => setCellFmt(active.r, active.c, { align: 'right' })} active={getCell(active.r, active.c).align === 'right'} />
          </RibbonGroup>
          <RibbonGroup label={t('sheet.merge') || '合并'}>
            <RibbonButton icon="⊟" label={t('sheet.mergeCenter') || '合并居中'} onClick={() => {
              const range = prompt(t('sheet.mergePrompt') || '输入合并范围 (如 A1:B2):', `${colName(active.c)}${active.r + 1}:${colName(active.c + 1)}${active.r + 2}`)
              if (!range) return
              const m = range.match(/([A-Z]+)(\d+):([A-Z]+)(\d+)/)
              if (m) {
                const c1 = m[1].length === 1 ? m[1].charCodeAt(0) - 65 : (m[1].charCodeAt(0) - 65) * 26 + (m[1].charCodeAt(1) - 65) - 26
                const r1 = parseInt(m[2]) - 1
                const c2 = m[3].length === 1 ? m[3].charCodeAt(0) - 65 : (m[3].charCodeAt(0) - 65) * 26 + (m[3].charCodeAt(1) - 65) - 26
                const r2 = parseInt(m[4]) - 1
                mergeCells(r1, c1, r2, c2)
              }
            }} title={t('sheet.mergeTitle') || '合并单元格'} />
            <RibbonButton icon="⊞" label={t('sheet.split') || '拆分'} onClick={() => splitCell(active.r, active.c)} active={isMerged(active.r, active.c)} title={t('sheet.splitTitle') || '拆分单元格'} />
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
                <div className="absolute top-full ribbon-popup ribbon-popup-right" style={{ right: 0, left: 'auto', zIndex: 50 }}>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { type: 'bar', icon: '📊', name: t('sheet.chart.bar') },
                      { type: 'line', icon: '📈', name: t('sheet.chart.line') },
                      { type: 'pie', icon: '🥧', name: t('sheet.chart.pie') },
                      { type: 'scatter', icon: '⚫', name: t('sheet.chart.scatter') },
                      { type: 'area', icon: '🔻', name: t('sheet.chart.area') },
                      { type: 'doughnut', icon: '🍩', name: t('sheet.chart.donut') },
                    ].map(c => (
                      <button key={c.type} onClick={() => addChart(c.type)}
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
                <div className="absolute top-full ribbon-popup ribbon-popup-right" style={{ right: 0, left: 'auto', zIndex: 50 }}>
                  <div className="grid grid-cols-4 gap-2">
                    {[{i:'▭',n:t('doc.shape.rect')},{i:'▢',n:t('doc.shape.rounded')},{i:'⬭',n:t('doc.shape.ellipse')},{i:'△',n:t('doc.shape.triangle')},
                     {i:'◇',n:t('doc.shape.diamond')},{i:'→',n:t('doc.shape.arrow')},{i:'★',n:t('doc.shape.star')},{i:'♥',n:t('doc.shape.heart')}].map(s => (
                      <button key={s.n} onClick={() => setShowShapePanel(false)} className="flex flex-col items-center gap-1 p-2 rounded-md transition-colors hover:bg-slate-100" style={{ minWidth: 56 }}>
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
                  <button onClick={() => { let sum = 0; for (let r = 0; r < rows; r++) { const v = parseFloat(getCell(r, active.c).value); if (!isNaN(v)) sum += v } setCell(active.r, active.c, String(sum)); setShowFuncPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2" style={{ color: 'var(--color-text)' }}>{t('sheet.sum')}</button>
                  <button onClick={() => { let sum = 0; let n = 0; for (let r = 0; r < rows; r++) { const v = parseFloat(getCell(r, active.c).value); if (!isNaN(v)) { sum += v; n++ } } setCell(active.r, active.c, n > 0 ? String(sum / n) : '0'); setShowFuncPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2" style={{ color: 'var(--color-text)' }}>{t('sheet.average')}</button>
                  <button onClick={() => { let n = 0; for (let r = 0; r < rows; r++) { if (getCell(r, active.c).value) n++ } setCell(active.r, active.c, String(n)); setShowFuncPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2" style={{ color: 'var(--color-text)' }}>{t('sheet.count')}</button>
                  <button onClick={() => { let max = -Infinity; for (let r = 0; r < rows; r++) { const v = parseFloat(getCell(r, active.c).value); if (!isNaN(v) && v > max) max = v } setCell(active.r, active.c, String(max)); setShowFuncPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2" style={{ color: 'var(--color-text)' }}>{t('sheet.max')}</button>
                  <button onClick={() => { let min = Infinity; for (let r = 0; r < rows; r++) { const v = parseFloat(getCell(r, active.c).value); if (!isNaN(v) && v < min) min = v } setCell(active.r, active.c, String(min)); setShowFuncPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2" style={{ color: 'var(--color-text)' }}>{t('sheet.min')}</button>
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
                <div className="absolute top-full ribbon-popup ribbon-popup-right" style={{ right: 0, left: 'auto', zIndex: 50 }}>
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
                  <button onClick={() => { const vals: number[] = []; for (let r = 0; r < rows; r++) { const v = parseFloat(getCell(r, active.c).value); if (!isNaN(v)) vals.push(v) } if (vals.length) { const avg = vals.reduce((a,b)=>a+b,0)/vals.length; const newData: Record<string, Cell> = {}; for (let r = 0; r < rows; r++) { const cell = getCell(r, active.c); const v = parseFloat(cell.value); newData[`${r}-${active.c}`] = (!isNaN(v) && v > avg) ? { ...cell, bg: '#dcfce7' } : cell } setData(newData) } setShowCondPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2" style={{ color: 'var(--color-text)' }}>{t('sheet.aboveAvg')}</button>
                  <button onClick={() => { const vals: number[] = []; for (let r = 0; r < rows; r++) { const v = parseFloat(getCell(r, active.c).value); if (!isNaN(v)) vals.push(v) } if (vals.length) { const avg = vals.reduce((a,b)=>a+b,0)/vals.length; const newData: Record<string, Cell> = {}; for (let r = 0; r < rows; r++) { const cell = getCell(r, active.c); const v = parseFloat(cell.value); newData[`${r}-${active.c}`] = (!isNaN(v) && v < avg) ? { ...cell, bg: '#fef3c7' } : cell } setData(newData) } setShowCondPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2" style={{ color: 'var(--color-text)' }}>{t('sheet.belowAvg')}</button>
                  <button onClick={() => { const vals: {r:number;v:number}[] = []; for (let r = 0; r < rows; r++) { const v = parseFloat(getCell(r, active.c).value); if (!isNaN(v)) vals.push({r,v}) } vals.sort((a,b)=>b.v-a.v).slice(0,10).forEach(x => setCellFmt(x.r, active.c, { bg: '#dbeafe' })); setShowCondPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2" style={{ color: 'var(--color-text)' }}>{t('sheet.top10')}</button>
                  <button onClick={() => { const vals: number[] = []; for (let r = 0; r < rows; r++) { const v = parseFloat(getCell(r, active.c).value); if (!isNaN(v)) vals.push(v) } const max = Math.max(...vals), min = Math.min(...vals); for (let r = 0; r < rows; r++) { const v = parseFloat(getCell(r, active.c).value); if (!isNaN(v)) { const pct = max > min ? (v - min) / (max - min) : 0.5; setCellFmt(r, active.c, { bg: `rgba(59,130,246,${pct * 0.6 + 0.1})` }) } } setShowCondPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2" style={{ color: 'var(--color-text)' }}>{t('sheet.dataBar')}</button>
                  <button onClick={() => { const vals: number[] = []; for (let r = 0; r < rows; r++) { const v = parseFloat(getCell(r, active.c).value); if (!isNaN(v)) vals.push(v) } const max = Math.max(...vals), min = Math.min(...vals); for (let r = 0; r < rows; r++) { const v = parseFloat(getCell(r, active.c).value); if (!isNaN(v)) { const pct = max > min ? (v - min) / (max - min) : 0.5; setCellFmt(r, active.c, { bg: pct < 0.5 ? `rgba(239,68,68,${1 - pct*2})` : `rgba(34,197,94,${pct*2-1})` }) } } setShowCondPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2" style={{ color: 'var(--color-text)' }}>{t('sheet.colorScale')}</button>
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
        <input value={getCell(active.r, active.c).value} onChange={e => setCell(active.r, active.c, e.target.value)} className="flex-1 border-transparent focus:border-indigo-500 px-2 py-1 rounded font-mono text-xs" style={{ background: 'transparent', color: getCell(active.r, active.c).color || 'var(--color-text)', fontWeight: getCell(active.r, active.c).bold ? 700 : 400 }} placeholder={t('sheet.formulaPlaceholder')} />
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
                <th key={c} className={`w-20 sm:w-24 h-8 text-xs font-medium sticky top-0 z-10 transition-colors ${active.c === c ? 'text-indigo-600' : ''}`}
                  style={{ background: active.c === c ? 'var(--color-primary-light)' : 'var(--color-bg-alt)', border: '1px solid var(--color-border)', color: active.c === c ? 'var(--color-primary)' : 'var(--color-text-secondary)', minWidth: '80px' }}>{colName(c)}</th>
              ))}
            </tr>
          </thead>
          )}
          <tbody>
            {Array.from({ length: rows }).map((_, r) => (
              <tr key={r}>
                {showHeadings && (
                <td className={`w-10 sm:w-12 h-7 text-center text-xs transition-colors ${active.r === r ? 'text-indigo-600 font-semibold' : ''}`}
                  style={{ background: active.r === r ? 'var(--color-primary-light)' : 'var(--color-bg-alt)', border: '1px solid var(--color-border)', color: active.r === r ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>{r + 1}</td>
                )}
                {Array.from({ length: cols }).map((_, c) => {
                  const cell = getCell(r, c)
                  // 跳过被合并覆盖的单元格
                  if (cell.hiddenBy) return null
                  const isActive = active.r === r && active.c === c
                  const mergeRange = cell.mergeRange
                  return (
                    <td key={c} className="border p-0 relative" rowSpan={mergeRange?.rowSpan} colSpan={mergeRange?.colSpan} style={{
                      background: isActive ? 'var(--color-primary-light)' : (cell.bg || 'var(--color-surface)'),
                      borderColor: 'var(--color-border)', minWidth: '80px',
                    }} onClick={() => setActive({ r, c })}>
                      {isActive && <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: 'inset 0 0 0 2px var(--color-primary)' }}></div>}
                      {(() => {
                        const v = cell.value
                        if (v && v.startsWith('[img]')) {
                          return <img src={v.slice(5)} alt="" className="w-full h-full object-contain pointer-events-none" />
                        }
                        return <input type="text" value={v} onChange={e => setCell(r, c, e.target.value)} onFocus={() => setActive({ r, c })} className="w-full h-7 px-2 outline-none bg-transparent text-sm" style={{ color: cell.color || 'var(--color-text)', fontWeight: cell.bold ? 700 : 400, textAlign: cell.align || (mergeRange ? 'center' : 'left') }} />
                      })()}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
