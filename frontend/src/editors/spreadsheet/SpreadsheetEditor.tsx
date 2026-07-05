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
  const [sheetName, setSheetName] = useState(title)
  const colName = (c: number) => {
    if (c < 26) return String.fromCharCode(65 + c)
    return String.fromCharCode(65 + Math.floor(c / 26) - 1) + String.fromCharCode(65 + (c % 26))
  }

  const getCell = (r: number, c: number): Cell => data[`${r}-${c}`] || { value: '' }
  const setCell = (r: number, c: number, value: string) => {
    setData((d) => ({ ...d, [`${r}-${c}`]: { value } }))
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--color-bg)' }}>
      {/* 顶部工具栏 */}
      <div className="bg-white border-b border-slate-200 px-3 sm:px-4 py-2 flex items-center gap-3 flex-wrap flex-shrink-0">
        <input
          value={sheetName}
          onChange={(e) => setSheetName(e.target.value)}
          className="font-semibold text-slate-800 text-sm border-transparent hover:border-slate-200 focus:border-indigo-500 px-2 py-1 rounded transition-colors"
          style={{ minWidth: '120px' }}
        />
        <div className="h-4 w-px bg-slate-200" />
        <span className="text-xs text-slate-500">{rows} 行 × {cols} 列</span>
        <div className="flex-1" />
        <button
          onClick={() => setCols((c) => c + 1)}
          className="btn btn-outline btn-sm"
        >+ 列</button>
        <button
          onClick={() => setRows((r) => r + 1)}
          className="btn btn-outline btn-sm"
        >+ 行</button>
      </div>

      {/* 公式栏 */}
      <div className="bg-white border-b border-slate-200 px-3 sm:px-4 py-1.5 flex items-center gap-2 flex-shrink-0 text-xs">
        <div
          className="font-mono font-semibold text-slate-600 px-2 py-0.5 rounded"
          style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)', minWidth: '50px', textAlign: 'center' }}
        >
          {colName(active.c)}{active.r + 1}
        </div>
        <span className="text-slate-400">fx</span>
        <input
          value={getCell(active.r, active.c).value}
          onChange={(e) => setCell(active.r, active.c, e.target.value)}
          className="flex-1 border border-transparent hover:border-slate-200 focus:border-indigo-500 px-2 py-1 rounded font-mono text-xs"
          placeholder="输入值或公式..."
        />
      </div>

      {/* 表格主体 */}
      <div className="flex-1 overflow-auto p-2 sm:p-3" style={{ background: 'var(--color-bg)' }}>
        <table
          className="border-collapse bg-white text-sm"
          style={{ boxShadow: 'var(--shadow-sm)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}
        >
          <thead>
            <tr>
              <th
                className="w-10 sm:w-12 h-8 border border-slate-200 text-xs font-medium text-slate-500 sticky top-0 z-20"
                style={{ background: '#f8fafc' }}
              ></th>
              {Array.from({ length: cols }).map((_, c) => (
                <th
                  key={c}
                  className={`w-20 sm:w-24 h-8 border border-slate-200 text-xs font-medium sticky top-0 z-10 ${
                    active.c === c ? 'text-indigo-600' : 'text-slate-600'
                  }`}
                  style={{
                    background: active.c === c ? '#eef2ff' : '#f8fafc',
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
                  className={`w-10 sm:w-12 h-7 border border-slate-200 text-center text-xs ${
                    active.r === r ? 'text-indigo-600 font-semibold' : 'text-slate-500'
                  }`}
                  style={{ background: active.r === r ? '#eef2ff' : '#f8fafc' }}
                >
                  {r + 1}
                </td>
                {Array.from({ length: cols }).map((_, c) => {
                  const isActive = active.r === r && active.c === c
                  return (
                    <td
                      key={c}
                      className="border border-slate-200 p-0 relative"
                      style={{
                        background: isActive ? '#eef2ff' : 'white',
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

      {/* 底部状态栏 */}
      <div className="bg-white border-t border-slate-200 px-3 sm:px-4 py-1.5 text-xs text-slate-500 flex items-center gap-3 flex-shrink-0">
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
          就绪
        </span>
        <div className="flex-1" />
        <span className="font-mono">{colName(active.c)}{active.r + 1}</span>
        <span className="text-slate-400">|</span>
        <span className="truncate max-w-[120px]">{getCell(active.r, active.c).value || '空'}</span>
      </div>
    </div>
  )
}
