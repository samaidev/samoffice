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

// 轻量级表格编辑器 - 类似 Excel 的最小可用版本
export function SpreadsheetEditor({ initialRows = 20, initialCols = 10, title = '工作表 1' }: Props) {
  const [rows, setRows] = useState(initialRows)
  const [cols, setCols] = useState(initialCols)
  const [data, setData] = useState<Record<string, Cell>>({})
  const [active, setActive] = useState<{ r: number; c: number }>({ r: 0, c: 0 })
  const colName = (c: number) => String.fromCharCode(65 + c)

  const getCell = (r: number, c: number): Cell => data[`${r}-${c}`] || { value: '' }
  const setCell = (r: number, c: number, value: string) => {
    setData((d) => ({ ...d, [`${r}-${c}`]: { value } }))
  }

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-2 border-b bg-gray-50 flex-wrap">
        <span className="font-semibold text-gray-700 text-sm sm:text-base">{title}</span>
        <span className="text-xs text-gray-400 hidden sm:inline">{rows} 行 × {cols} 列</span>
        <div className="flex-1" />
        <button
          onClick={() => setCols((c) => c + 1)}
          className="px-2 sm:px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
        >+ 列</button>
        <button
          onClick={() => setRows((r) => r + 1)}
          className="px-2 sm:px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
        >+ 行</button>
      </div>

      <div className="overflow-auto flex-1 touch-auto">
        <table className="border-collapse text-sm sm:text-base">
          <thead className="sticky top-0 bg-gray-100 z-10">
            <tr>
              <th className="w-10 sm:w-12 h-7 border border-gray-300 bg-gray-200"></th>
              {Array.from({ length: cols }).map((_, c) => (
                <th key={c} className="w-20 sm:w-24 h-7 border border-gray-300 font-medium text-gray-600 text-xs sm:text-sm">
                  {colName(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, r) => (
              <tr key={r}>
                <td className="w-10 sm:w-12 h-7 border border-gray-300 bg-gray-100 text-center text-xs text-gray-500">
                  {r + 1}
                </td>
                {Array.from({ length: cols }).map((_, c) => {
                  const isActive = active.r === r && active.c === c
                  return (
                    <td
                      key={c}
                      className={`border border-gray-300 p-0 ${isActive ? 'ring-2 ring-blue-400' : ''}`}
                      onClick={() => setActive({ r, c })}
                    >
                      <input
                        type="text"
                        value={getCell(r, c).value}
                        onChange={(e) => setCell(r, c, e.target.value)}
                        onFocus={() => setActive({ r, c })}
                        className="w-full h-7 px-1 sm:px-2 outline-none bg-transparent focus:bg-blue-50 text-sm sm:text-base"
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-2 sm:px-4 py-1 border-t bg-gray-50 text-xs text-gray-500 truncate">
        <span className="hidden sm:inline">当前: </span>
        {colName(active.c)}{active.r + 1} = {getCell(active.r, active.c).value || '(空)'}
      </div>
    </div>
  )
}
