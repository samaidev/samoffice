import { useState } from 'react'
import { useI18n } from '../../i18n'

interface Cell { value: string; formula?: string }
interface Props { initialRows?: number; initialCols?: number; title?: string }

type RibbonTab = 'home' | 'insert' | 'data' | 'view'

function RibbonButton({ icon, label, onClick, active, disabled, title }: any) {
  return (
    <button onClick={onClick} disabled={disabled} title={title || label}
      className="flex flex-col items-center justify-center gap-0.5 px-2.5 py-1 rounded-md transition-colors min-w-[48px] disabled:opacity-40"
      style={{ background: active ? 'var(--color-primary-light)' : 'transparent', color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}
      onMouseEnter={e => { if (!disabled && !active) e.currentTarget.style.background = 'var(--color-bg-alt)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}>
      <span style={{ fontSize: '16px', lineHeight: 1 }}>{icon}</span>
      <span style={{ fontSize: '10px', fontWeight: 500 }}>{label}</span>
    </button>
  )
}
function RibbonGroup({ label, children }: any) {
  return (
    <div className="flex flex-col items-center px-2 border-r" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex items-center gap-0.5 py-1 flex-1">{children}</div>
      <div className="text-[10px] font-medium pb-0.5" style={{ color: 'var(--color-text-muted)' }}>{label}</div>
    </div>
  )
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
  const [validList, setValidList] = useState('')
  const colName = (c: number) => {
    if (c < 26) return String.fromCharCode(65 + c)
    return String.fromCharCode(65 + Math.floor(c / 26) - 1) + String.fromCharCode(65 + (c % 26))
  }
  const getCell = (r: number, c: number): Cell => data[`${r}-${c}`] || { value: '' }
  const setCell = (r: number, c: number, value: string) => setData(d => ({ ...d, [`${r}-${c}`]: { value } }))
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
      {/* Ribbon Tab 栏 */}
      <div className="flex items-center px-2 flex-shrink-0 border-b" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        {ribbonTabs.map(t => (
          <button key={t.id} onClick={() => setRibbonTab(t.id)} data-testid={`ribbon-tab-${t.id}`} className="px-4 py-2 text-sm font-medium transition-colors"
            style={{ color: ribbonTab === t.id ? 'var(--color-primary)' : 'var(--color-text-secondary)', borderBottom: ribbonTab === t.id ? '2px solid var(--color-primary)' : '2px solid transparent', background: ribbonTab === t.id ? 'var(--color-primary-50)' : 'transparent' }}>{t.label}</button>
        ))}
        <div className="flex-1" />
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{rows} {t('sheet.rows')} × {cols} {t('sheet.cols')}</span>
      </div>

      {/* Ribbon 内容区 */}
      <div className="flex items-stretch px-1 py-1 flex-shrink-0 border-b overflow-x-auto" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', minHeight: '64px' }}>
        {ribbonTab === 'home' && (<>
          <RibbonGroup label={t('sheet.cell')}>
            <RibbonButton icon="📋" label={t('sheet.copy')} onClick={() => navigator.clipboard.writeText(getCell(active.r, active.c).value)} />
            <RibbonButton icon="📥" label={t('sheet.paste')} onClick={() => { navigator.clipboard.readText().then(t => setCell(active.r, active.c, t)) }} />
          </RibbonGroup>
          <RibbonGroup label={t('sheet.font')}>
            <RibbonButton icon="B" label={t('sheet.bold')} onClick={() => {}} />
            <RibbonButton icon="🎨" label={t('doc.color')} onClick={() => {}} />
          </RibbonGroup>
          <RibbonGroup label={t('sheet.alignment')}>
            <RibbonButton icon="⬅" label={t('sheet.alignLeft')} onClick={() => {}} />
            <RibbonButton icon="⬌" label={t('sheet.alignCenter')} onClick={() => {}} />
            <RibbonButton icon="➡" label={t('sheet.alignRight')} onClick={() => {}} />
          </RibbonGroup>
          <RibbonGroup label={t('sheet.number')}>
            <RibbonButton icon="%" label={t('sheet.percent')} onClick={() => { const v = getCell(active.r, active.c).value; if (v) setCell(active.r, active.c, `${parseFloat(v) * 100}%`) }} />
            <RibbonButton icon="0.0" label={t('sheet.decimal')} onClick={() => {}} />
          </RibbonGroup>
          <RibbonGroup label={t('sheet.cellOps')}>
            <RibbonButton icon="↧+" label={t('sheet.addRow')} onClick={() => setRows(r => r + 1)} />
            <RibbonButton icon="↦+" label={t('sheet.addColumn')} onClick={() => setCols(c => c + 1)} />
          </RibbonGroup>
        </>)}
        {ribbonTab === 'insert' && (<>
          <RibbonGroup label={t('sheet.chart')}>
            <div className="relative">
              <RibbonButton icon="📊" label={t('sheet.chart')} onClick={() => setShowChartPanel(!showChartPanel)} />
              {showChartPanel && (
                <div className="absolute top-full left-0 z-30 p-3 rounded-lg shadow-xl animate-fade-in" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { type: 'bar', icon: '📊', name: t('sheet.chart.bar') },
                      { type: 'line', icon: '📈', name: t('sheet.chart.line') },
                      { type: 'pie', icon: '🥧', name: t('sheet.chart.pie') },
                      { type: 'scatter', icon: '⚫', name: t('sheet.chart.scatter') },
                      { type: 'area', icon: '🔻', name: t('sheet.chart.area') },
                      { type: 'doughnut', icon: '🍩', name: t('sheet.chart.donut') },
                    ].map(c => (
                      <button key={c.type} onClick={() => { alert(t('sheet.chartType') + c.name + '\\n' + t('sheet.dataRange') + colName(active.c) + '1:' + colName(active.c) + rows); setShowChartPanel(false) }}
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
              <RibbonButton icon="▭" label={t('sheet.shapes')} onClick={() => setShowShapePanel(!showShapePanel)} />
              {showShapePanel && (
                <div className="absolute top-full left-0 z-30 p-3 rounded-lg shadow-xl animate-fade-in" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
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
            <RibbonButton icon="🖼" label={t('sheet.image')} onClick={() => {}} />
          </RibbonGroup>
          <RibbonGroup label={t('sheet.function')}>
            <div className="relative">
              <RibbonButton icon="ƒx" label={t('sheet.function')} onClick={() => setShowFuncPanel(!showFuncPanel)} />
              {showFuncPanel && (
                <div className="absolute top-full left-0 z-30 py-1.5 rounded-lg shadow-xl animate-fade-in" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', minWidth: 160 }}>
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
            <RibbonButton icon="🔍" label={t('sheet.filter')} onClick={() => {}} />
            {/* MS Office 风格排序对话框 */}
            <RibbonButton icon="⇅" label={t('sheet.customSort')} onClick={() => {
              const col = prompt(t('sheet.customSortPrompt'), colName(active.c))
              if (col) sortByCol(true)
            }} title={t('sheet.customSortTitle')} />
            <RibbonButton icon="🖽" label={t('sheet.clearFilter')} onClick={() => {}} title={t('sheet.clearFilterTitle')} />
            <RibbonButton icon="🔂" label={t('sheet.reapply')} onClick={() => {}} title={t('sheet.reapplyTitle')} />
          </RibbonGroup>
          {/* MS Office 风格数据工具 */}
          <RibbonGroup label={t('sheet.dataTools')}>
            <div className="relative">
              <RibbonButton icon="✓" label={t('sheet.dataValidation')} onClick={() => setShowValidPanel(!showValidPanel)} />
              {showValidPanel && (
                <div className="absolute top-full left-0 z-30 p-3 rounded-lg shadow-xl animate-fade-in" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <div className="text-[10px] font-bold mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('sheet.dropdownOptions')}</div>
                  <input type="text" placeholder={t('sheet.dropdownPlaceholder')} value={validList} onChange={e => setValidList(e.target.value)} className="text-xs mb-2" style={{ width: 200 }} />
                  <button onClick={() => { setShowValidPanel(false); alert(t('sheet.validationSet', { list: validList })) }} className="btn btn-primary btn-sm w-full">{t('sheet.apply')}</button>
                </div>
              )}
            </div>
            <RibbonButton icon="🔢" label={t('sheet.textToColumns')} onClick={() => {}} title={t('sheet.textToColumnsTitle')} />
            <RibbonButton icon="🔗" label={t('sheet.removeDup')} onClick={() => {}} title={t('sheet.removeDupTitle')} />
            <RibbonButton icon="📉" label={t('sheet.whatIf')} onClick={() => {}} title={t('sheet.whatIfTitle')} />
            <RibbonButton icon="🔮" label={t('sheet.forecast')} onClick={() => {}} title={t('sheet.forecastTitle')} />
            <RibbonButton icon="📊" label={t('sheet.group')} onClick={() => {}} title={t('sheet.groupTitle')} />
            <RibbonButton icon="⊟" label={t("sheet.ungroup")} onClick={() => {}} title={t('sheet.ungroupTitle')} />
          </RibbonGroup>
          {/* MS Office 风格获取和转换数据 */}
          <RibbonGroup label={t('sheet.getTransform')}>
            <RibbonButton icon="📥" label={t('sheet.fromWeb')} onClick={() => {}} title={t('sheet.fromWebTitle')} />
            <RibbonButton icon="📄" label={t('sheet.fromText')} onClick={() => {}} title={t('sheet.fromTextTitle')} />
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
            <RibbonButton icon="🔄" label={t('sheet.refresh')} onClick={() => {}} title={t('sheet.refreshTitle')} />
          </RibbonGroup>
          <RibbonGroup label={t('sheet.conditionalFormat')}>
            <div className="relative">
              <RibbonButton icon="🎨" label={t('sheet.conditionalFormat')} onClick={() => setShowCondPanel(!showCondPanel)} />
              {showCondPanel && (
                <div className="absolute top-full left-0 z-30 py-1.5 rounded-lg shadow-xl animate-fade-in" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', minWidth: 160 }}>
                  <button onClick={() => { setShowCondPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2" style={{ color: 'var(--color-text)' }}>{t('sheet.aboveAvg')}</button>
                  <button onClick={() => { setShowCondPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2" style={{ color: 'var(--color-text)' }}>{t('sheet.belowAvg')}</button>
                  <button onClick={() => { setShowCondPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2" style={{ color: 'var(--color-text)' }}>{t('sheet.top10')}</button>
                  <button onClick={() => { setShowCondPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2" style={{ color: 'var(--color-text)' }}>{t('sheet.dataBar')}</button>
                  <button onClick={() => { setShowCondPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2" style={{ color: 'var(--color-text)' }}>{t('sheet.colorScale')}</button>
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
            <RibbonButton icon="↔️" label={t('sheet.split')} onClick={() => {}} title={t('sheet.splitTitle')} />
            <RibbonButton icon="🪟" label={t('sheet.newWindow')} onClick={() => window.open(window.location.href, '_blank')} title={t('sheet.newWindowTitle')} />
            <RibbonButton icon="▦" label={t("sheet.arrange")} onClick={() => {}} title={t('sheet.arrangeTitle')} />
          </RibbonGroup>
          {/* MS Office 风格显示 */}
          <RibbonGroup label={t('sheet.show')}>
            <RibbonButton icon="📐" label={t('sheet.gridlines')} onClick={() => {}} active={true} title={t('sheet.gridlinesTitle')} />
            <RibbonButton icon="🔤" label={t('sheet.headings')} onClick={() => {}} active={true} title={t('sheet.headingsTitle')} />
            <RibbonButton icon="📊" label={t('sheet.formulaBar')} onClick={() => {}} active={true} title={t('sheet.formulaBarTitle')} />
          </RibbonGroup>
          {/* MS Office 风格工作簿视图 */}
          <RibbonGroup label={t('sheet.workbookViews')}>
            <RibbonButton icon="📄" label={t('sheet.normal')} onClick={() => {}} active={true} title={t('sheet.normalTitle')} />
            <RibbonButton icon="🖨" label={t('sheet.pageBreakPreview')} onClick={() => {}} title={t('sheet.pageBreakTitle')} />
            <RibbonButton icon="📐" label={t('sheet.pageLayout')} onClick={() => {}} title={t('sheet.pageLayoutTitle')} />
            <RibbonButton icon="⚙️" label={t("sheet.customViews")} onClick={() => {}} title={t('sheet.customViewsTitle')} />
          </RibbonGroup>
        </>)}
      </div>

      {/* 公式栏 */}
      <div className="px-3 py-1.5 flex items-center gap-2 flex-shrink-0 text-xs" style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
        <div className="font-mono font-semibold px-2 py-0.5 rounded" style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)', minWidth: '50px', textAlign: 'center' }}>{colName(active.c)}{active.r + 1}</div>
        <span style={{ color: 'var(--color-text-muted)' }}>fx</span>
        <input value={getCell(active.r, active.c).value} onChange={e => setCell(active.r, active.c, e.target.value)} className="flex-1 border-transparent focus:border-indigo-500 px-2 py-1 rounded font-mono text-xs" style={{ background: 'transparent', color: 'var(--color-text)' }} placeholder={t('sheet.formulaPlaceholder')} />
      </div>

      {/* 表格主体 */}
      <div className="flex-1 overflow-auto p-2 sm:p-3" style={{ background: 'var(--color-bg-alt)', zoom: `${zoom}%` }}>
        <table className="border-collapse text-sm" style={{ background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          <thead>
            <tr>
              <th className="w-10 sm:w-12 h-8 text-xs font-medium sticky top-0 z-20" style={{ background: 'var(--color-bg-alt)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}></th>
              {Array.from({ length: cols }).map((_, c) => (
                <th key={c} className={`w-20 sm:w-24 h-8 text-xs font-medium sticky top-0 z-10 transition-colors ${active.c === c ? 'text-indigo-600' : ''}`}
                  style={{ background: active.c === c ? 'var(--color-primary-light)' : 'var(--color-bg-alt)', border: '1px solid var(--color-border)', color: active.c === c ? 'var(--color-primary)' : 'var(--color-text-secondary)', minWidth: '80px' }}>{colName(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, r) => (
              <tr key={r}>
                <td className={`w-10 sm:w-12 h-7 text-center text-xs transition-colors ${active.r === r ? 'text-indigo-600 font-semibold' : ''}`}
                  style={{ background: active.r === r ? 'var(--color-primary-light)' : 'var(--color-bg-alt)', border: '1px solid var(--color-border)', color: active.r === r ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>{r + 1}</td>
                {Array.from({ length: cols }).map((_, c) => {
                  const isActive = active.r === r && active.c === c
                  return (
                    <td key={c} className="border p-0 relative" style={{ background: isActive ? 'var(--color-primary-light)' : 'var(--color-surface)', borderColor: 'var(--color-border)', minWidth: '80px' }} onClick={() => setActive({ r, c })}>
                      {isActive && <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: 'inset 0 0 0 2px var(--color-primary)' }}></div>}
                      <input type="text" value={getCell(r, c).value} onChange={e => setCell(r, c, e.target.value)} onFocus={() => setActive({ r, c })} className="w-full h-7 px-2 outline-none bg-transparent text-sm" style={{ color: 'var(--color-text)' }} />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
