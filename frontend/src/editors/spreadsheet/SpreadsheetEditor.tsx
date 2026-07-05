import { useState } from 'react'

interface Cell {
  value: string
  formula?: string
}

interface Props {
  initialRows?: number
  initialCols?: number
  title?: string
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
  const colName = (c: number) => {
    if (c < 26) return String.fromCharCode(65 + c)
    return String.fromCharCode(65 + Math.floor(c / 26) - 1) + String.fromCharCode(65 + (c % 26))
  }

  const getCell = (r: number, c: number): Cell => data[`${r}-${c}`] || { value: '' }
  const setCell = (r: number, c: number, value: string) => {
    setData((d) => ({ ...d, [`${r}-${c}`]: { value } }))
  }

  const addSheet = () => {
    const newId = Math.max(...sheets.map(s => s.id)) + 1
    setSheets(s => [
      ...s.map(x => ({ ...x, active: false })),
      { id: newId, name: `Sheet${newId}`, active: true }
    ])
  }

  const switchSheet = (id: number) => {
    setSheets(s => s.map(x => ({ ...x, active: x.id === id })))
  }

  const renameSheet = (id: number, name: string) => {
    setSheets(s => s.map(x => x.id === id ? { ...x, name } : x))
  }

  const activeSheet = sheets.find(s => s.active) || sheets[0]

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--color-bg-alt)' }}>
      {/* 顶部工具栏 */}
      <div
        className="px-3 sm:px-4 py-2 flex items-center gap-3 flex-wrap flex-shrink-0"
        style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}
      >
        <input
          value={activeSheet.name}
          onChange={(e) => renameSheet(activeSheet.id, e.target.value)}
          className="font-semibold text-sm border-transparent hover:border-slate-200 focus:border-indigo-500 px-2 py-1 rounded transition-colors"
          style={{ minWidth: '120px', background: 'transparent', color: 'var(--color-text)' }}
        />
        <div className="h-4 w-px" style={{ background: 'var(--color-border)' }} />
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{rows} 行 × {cols} 列</span>
        <div className="flex-1" />
        <button onClick={() => setCols((c) => c + 1)} className="btn btn-outline btn-sm">+ 列</button>
        <button onClick={() => setRows((r) => r + 1)} className="btn btn-outline btn-sm">+ 行</button>
      </div>

      {/* 公式栏 */}
      <div
        className="px-3 sm:px-4 py-1.5 flex items-center gap-2 flex-shrink-0 text-xs"
        style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}
      >
        <div
          className="font-mono font-semibold px-2 py-0.5 rounded"
          style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)', minWidth: '50px', textAlign: 'center' }}
        >
          {colName(active.c)}{active.r + 1}
        </div>
        <span style={{ color: 'var(--color-text-muted)' }}>fx</span>
        <input
          value={getCell(active.r, active.c).value}
          onChange={(e) => setCell(active.r, active.c, e.target.value)}
          className="flex-1 border-transparent hover:border-slate-200 focus:border-indigo-500 px-2 py-1 rounded font-mono text-xs"
          style={{ background: 'transparent', color: 'var(--color-text)' }}
          placeholder="输入值或公式..."
        />
      </div>

      {/* 表格主体 */}
      <div className="flex-1 overflow-auto p-2 sm:p-3" style={{ background: 'var(--color-bg-alt)' }}>
        <table
          className="border-collapse text-sm"
          style={{
            background: 'var(--color-surface)',
            boxShadow: 'var(--shadow-sm)',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden'
          }}
        >
          <thead>
            <tr>
              <th
                className="w-10 sm:w-12 h-8 text-xs font-medium sticky top-0 z-20"
                style={{
                  background: 'var(--color-bg-alt)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-muted)'
                }}
              ></th>
              {Array.from({ length: cols }).map((_, c) => (
                <th
                  key={c}
                  className={`w-20 sm:w-24 h-8 text-xs font-medium sticky top-0 z-10 transition-colors ${active.c === c ? 'text-indigo-600' : ''}`}
                  style={{
                    background: active.c === c ? 'var(--color-primary-light)' : 'var(--color-bg-alt)',
                    border: '1px solid var(--color-border)',
                    color: active.c === c ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                    minWidth: '80px'
                  }}
                >
                  {colName(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, r) => (
              <tr key={r}>
                <td
                  className={`w-10 sm:w-12 h-7 text-center text-xs transition-colors ${active.r === r ? 'text-indigo-600 font-semibold' : ''}`}
                  style={{
                    background: active.r === r ? 'var(--color-primary-light)' : 'var(--color-bg-alt)',
                    border: '1px solid var(--color-border)',
                    color: active.r === r ? 'var(--color-primary)' : 'var(--color-text-muted)'
                  }}
                >
                  {r + 1}
                </td>
                {Array.from({ length: cols }).map((_, c) => {
                  const isActive = active.r === r && active.c === c
                  return (
                    <td
                      key={c}
                      className="border p-0 relative"
                      style={{
                        background: isActive ? 'var(--color-primary-light)' : 'var(--color-surface)',
                        borderColor: 'var(--color-border)',
                        minWidth: '80px'
                      }}
                      onClick={() => setActive({ r, c })}
                    >
                      {isActive && (
                        <div
                          className="absolute inset-0 pointer-events-none"
                          style={{ boxShadow: 'inset 0 0 0 2px var(--color-primary)' }}
                        ></div>
                      )}
                      <input
                        type="text"
                        value={getCell(r, c).value}
                        onChange={(e) => setCell(r, c, e.target.value)}
                        onFocus={() => setActive({ r, c })}
                        className="w-full h-7 px-2 outline-none bg-transparent text-sm"
                        style={{ color: 'var(--color-text)' }}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Sheet 标签栏 */}
      <div
        className="px-2 py-1 flex items-center gap-1 overflow-x-auto flex-shrink-0"
        style={{ background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)' }}
      >
        {sheets.map(s => (
          <button
            key={s.id}
            onClick={() => switchSheet(s.id)}
            className={`px-3 py-1 text-xs rounded-t-md transition-all whitespace-nowrap ${
              s.active ? 'font-semibold' : 'opacity-60 hover:opacity-100'
            }`}
            style={{
              background: s.active ? 'var(--color-primary-light)' : 'transparent',
              color: s.active ? 'var(--color-primary)' : 'var(--color-text-secondary)',
              borderBottom: s.active ? '2px solid var(--color-primary)' : '2px solid transparent'
            }}
          >
            {s.name}
          </button>
        ))}
        <button
          onClick={addSheet}
          className="px-2 py-1 text-xs rounded transition-colors hover:bg-slate-100"
          style={{ color: 'var(--color-text-muted)' }}
          title="新建工作表"
        >+</button>
      </div>

      {/* 底部状态栏 */}
      <div
        className="px-3 sm:px-4 py-1.5 text-xs flex items-center gap-3 flex-shrink-0"
        style={{ background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}
      >
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
          就绪
        </span>
        <div className="flex-1" />
        <span className="font-mono">{colName(active.c)}{active.r + 1}</span>
        <span style={{ color: 'var(--color-border-strong)' }}>|</span>
        <span className="truncate max-w-[120px]">{getCell(active.r, active.c).value || '空'}</span>
      </div>
    </div>
  )
}
