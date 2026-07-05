import { useState } from 'react'

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

export function SpreadsheetEditor({ initialRows = 30, initialCols = 12, title = '工作表 1' }: Props) {
  const [rows, setRows] = useState(initialRows)
  const [cols, setCols] = useState(initialCols)
  const [data, setData] = useState<Record<string, Cell>>({})
  const [active, setActive] = useState<{ r: number; c: number }>({ r: 0, c: 0 })
  const [sheets, setSheets] = useState([
    { id: 1, name: title, active: true },
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
    { id: 'home', label: '开始' }, { id: 'insert', label: '插入' }, { id: 'data', label: '数据' }, { id: 'view', label: '视图' },
  ]

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--color-bg-alt)' }}>
      {/* Ribbon Tab 栏 */}
      <div className="flex items-center px-2 flex-shrink-0 border-b" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        {ribbonTabs.map(t => (
          <button key={t.id} onClick={() => setRibbonTab(t.id)} className="px-4 py-2 text-sm font-medium transition-colors"
            style={{ color: ribbonTab === t.id ? 'var(--color-primary)' : 'var(--color-text-secondary)', borderBottom: ribbonTab === t.id ? '2px solid var(--color-primary)' : '2px solid transparent', background: ribbonTab === t.id ? 'var(--color-primary-50)' : 'transparent' }}>{t.label}</button>
        ))}
        <div className="flex-1" />
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{rows} 行 × {cols} 列</span>
      </div>

      {/* Ribbon 内容区 */}
      <div className="flex items-stretch px-1 py-1 flex-shrink-0 border-b overflow-x-auto" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', minHeight: '64px' }}>
        {ribbonTab === 'home' && (<>
          <RibbonGroup label="单元格">
            <RibbonButton icon="📋" label="复制" onClick={() => navigator.clipboard.writeText(getCell(active.r, active.c).value)} />
            <RibbonButton icon="📥" label="粘贴" onClick={() => { navigator.clipboard.readText().then(t => setCell(active.r, active.c, t)) }} />
          </RibbonGroup>
          <RibbonGroup label="字体">
            <RibbonButton icon="B" label="加粗" onClick={() => {}} />
            <RibbonButton icon="🎨" label="颜色" onClick={() => {}} />
          </RibbonGroup>
          <RibbonGroup label="对齐">
            <RibbonButton icon="⬅" label="左对齐" onClick={() => {}} />
            <RibbonButton icon="⬌" label="居中" onClick={() => {}} />
            <RibbonButton icon="➡" label="右对齐" onClick={() => {}} />
          </RibbonGroup>
          <RibbonGroup label="数字">
            <RibbonButton icon="%" label="百分比" onClick={() => { const v = getCell(active.r, active.c).value; if (v) setCell(active.r, active.c, `${parseFloat(v) * 100}%`) }} />
            <RibbonButton icon="0.0" label="小数" onClick={() => {}} />
          </RibbonGroup>
          <RibbonGroup label="单元格操作">
            <RibbonButton icon="↧+" label="添加行" onClick={() => setRows(r => r + 1)} />
            <RibbonButton icon="↦+" label="添加列" onClick={() => setCols(c => c + 1)} />
          </RibbonGroup>
        </>)}
        {ribbonTab === 'insert' && (<>
          <RibbonGroup label="图表">
            <div className="relative">
              <RibbonButton icon="📊" label="图表" onClick={() => setShowChartPanel(!showChartPanel)} />
              {showChartPanel && (
                <div className="absolute top-full left-0 z-30 p-3 rounded-lg shadow-xl animate-fade-in" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { type: 'bar', icon: '📊', name: '柱状图' },
                      { type: 'line', icon: '📈', name: '折线图' },
                      { type: 'pie', icon: '🥧', name: '饼图' },
                      { type: 'scatter', icon: '⚫', name: '散点图' },
                      { type: 'area', icon: '🔻', name: '面积图' },
                      { type: 'doughnut', icon: '🍩', name: '环形图' },
                    ].map(c => (
                      <button key={c.type} onClick={() => { alert(`图表类型: ${c.name}\\n数据范围: ${colName(active.c)}1:${colName(active.c)}${rows}`); setShowChartPanel(false) }}
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
          <RibbonGroup label="形状">
            <div className="relative">
              <RibbonButton icon="▭" label="形状" onClick={() => setShowShapePanel(!showShapePanel)} />
              {showShapePanel && (
                <div className="absolute top-full left-0 z-30 p-3 rounded-lg shadow-xl animate-fade-in" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <div className="grid grid-cols-4 gap-2">
                    {[{i:'▭',n:'矩形'},{i:'▢',n:'圆角'},{i:'⬭',n:'椭圆'},{i:'△',n:'三角'},
                     {i:'◇',n:'菱形'},{i:'→',n:'箭头'},{i:'★',n:'星形'},{i:'♥',n:'心形'}].map(s => (
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
          <RibbonGroup label="插图">
            <RibbonButton icon="🖼" label="图片" onClick={() => {}} />
          </RibbonGroup>
          <RibbonGroup label="函数">
            <div className="relative">
              <RibbonButton icon="ƒx" label="函数" onClick={() => setShowFuncPanel(!showFuncPanel)} />
              {showFuncPanel && (
                <div className="absolute top-full left-0 z-30 py-1.5 rounded-lg shadow-xl animate-fade-in" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', minWidth: 160 }}>
                  <button onClick={() => { let sum = 0; for (let r = 0; r < rows; r++) { const v = parseFloat(getCell(r, active.c).value); if (!isNaN(v)) sum += v } setCell(active.r, active.c, String(sum)); setShowFuncPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2" style={{ color: 'var(--color-text)' }}>Σ 求和</button>
                  <button onClick={() => { let sum = 0; let n = 0; for (let r = 0; r < rows; r++) { const v = parseFloat(getCell(r, active.c).value); if (!isNaN(v)) { sum += v; n++ } } setCell(active.r, active.c, n > 0 ? String(sum / n) : '0'); setShowFuncPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2" style={{ color: 'var(--color-text)' }}>x̄ 平均值</button>
                  <button onClick={() => { let n = 0; for (let r = 0; r < rows; r++) { if (getCell(r, active.c).value) n++ } setCell(active.r, active.c, String(n)); setShowFuncPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2" style={{ color: 'var(--color-text)' }}>n 计数</button>
                  <button onClick={() => { let max = -Infinity; for (let r = 0; r < rows; r++) { const v = parseFloat(getCell(r, active.c).value); if (!isNaN(v) && v > max) max = v } setCell(active.r, active.c, String(max)); setShowFuncPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2" style={{ color: 'var(--color-text)' }}>↑ 最大值</button>
                  <button onClick={() => { let min = Infinity; for (let r = 0; r < rows; r++) { const v = parseFloat(getCell(r, active.c).value); if (!isNaN(v) && v < min) min = v } setCell(active.r, active.c, String(min)); setShowFuncPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2" style={{ color: 'var(--color-text)' }}>↓ 最小值</button>
                </div>
              )}
            </div>
          </RibbonGroup>
        </>)}
        {ribbonTab === 'data' && (<>
          <RibbonGroup label="排序和筛选">
            <RibbonButton icon="↑" label="升序" onClick={() => sortByCol(true)} />
            <RibbonButton icon="↓" label="降序" onClick={() => sortByCol(false)} />
            <RibbonButton icon="🔍" label="筛选" onClick={() => {}} />
          </RibbonGroup>
          <RibbonGroup label="数据工具">
            <div className="relative">
              <RibbonButton icon="✓" label="数据验证" onClick={() => setShowValidPanel(!showValidPanel)} />
              {showValidPanel && (
                <div className="absolute top-full left-0 z-30 p-3 rounded-lg shadow-xl animate-fade-in" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <div className="text-[10px] font-bold mb-2" style={{ color: 'var(--color-text-muted)' }}>下拉列表选项</div>
                  <input type="text" placeholder="用逗号分隔：是,否,待定" value={validList} onChange={e => setValidList(e.target.value)} className="text-xs mb-2" style={{ width: 200 }} />
                  <button onClick={() => { setShowValidPanel(false); alert(`数据验证已设置：${validList}`) }} className="btn btn-primary btn-sm w-full">应用</button>
                </div>
              )}
            </div>
            <RibbonButton icon="🔢" label="分列" onClick={() => {}} />
          </RibbonGroup>
          <RibbonGroup label="条件格式">
            <div className="relative">
              <RibbonButton icon="🎨" label="条件格式" onClick={() => setShowCondPanel(!showCondPanel)} />
              {showCondPanel && (
                <div className="absolute top-full left-0 z-30 py-1.5 rounded-lg shadow-xl animate-fade-in" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', minWidth: 160 }}>
                  <button onClick={() => { setShowCondPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2" style={{ color: 'var(--color-text)' }}>🟢 高于平均值</button>
                  <button onClick={() => { setShowCondPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2" style={{ color: 'var(--color-text)' }}>🔴 低于平均值</button>
                  <button onClick={() => { setShowCondPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2" style={{ color: 'var(--color-text)' }}>⭐ 前10项</button>
                  <button onClick={() => { setShowCondPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2" style={{ color: 'var(--color-text)' }}>📊 数据条</button>
                  <button onClick={() => { setShowCondPanel(false) }} className="flex w-full text-left px-3 py-1.5 text-xs gap-2" style={{ color: 'var(--color-text)' }}>🌈 色阶</button>
                </div>
              )}
            </div>
          </RibbonGroup>
        </>)}
        {ribbonTab === 'view' && (<>
          <RibbonGroup label="缩放">
            <RibbonButton icon="−" label="缩小" onClick={() => setZoom(Math.max(50, zoom - 25))} />
            <div className="flex flex-col items-center px-2"><span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-text)' }}>{zoom}%</span></div>
            <RibbonButton icon="+" label="放大" onClick={() => setZoom(Math.min(150, zoom + 25))} />
            <RibbonButton icon="▮" label="100%" onClick={() => setZoom(100)} />
          </RibbonGroup>
          <RibbonGroup label="窗口">
            <RibbonButton icon="📌" label={frozen ? '取消冻结' : '冻结窗格'} onClick={() => setFrozen(!frozen)} active={frozen} />
          </RibbonGroup>
        </>)}
      </div>

      {/* 公式栏 */}
      <div className="px-3 py-1.5 flex items-center gap-2 flex-shrink-0 text-xs" style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
        <div className="font-mono font-semibold px-2 py-0.5 rounded" style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)', minWidth: '50px', textAlign: 'center' }}>{colName(active.c)}{active.r + 1}</div>
        <span style={{ color: 'var(--color-text-muted)' }}>fx</span>
        <input value={getCell(active.r, active.c).value} onChange={e => setCell(active.r, active.c, e.target.value)} className="flex-1 border-transparent focus:border-indigo-500 px-2 py-1 rounded font-mono text-xs" style={{ background: 'transparent', color: 'var(--color-text)' }} placeholder="输入值或公式..." />
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
        <button onClick={addSheet} className="px-2 py-1 text-xs rounded transition-colors hover:opacity-70" style={{ color: 'var(--color-text-muted)' }} title="新建工作表">+</button>
      </div>

      {/* 底部状态栏 */}
      <div className="px-3 py-1.5 text-xs flex items-center gap-3 flex-shrink-0" style={{ background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>就绪</span>
        <div className="flex-1" />
        <span className="font-mono">{colName(active.c)}{active.r + 1}</span>
        <span style={{ color: 'var(--color-border-strong)' }}>|</span>
        <span className="truncate max-w-[120px]">{getCell(active.r, active.c).value || '空'}</span>
      </div>
    </div>
  )
}
