// 打开文件的纯路由逻辑：把 UDM 文档里的表格块转为表格编辑器数据，并按扩展名决定打开到哪个视图。
// 抽成无依赖的纯函数，便于在 Node 中做自动化测试（保证交付前真正验证过）。

export interface SheetData {
  name: string
  cells: Record<string, any>
}

export type OpenTab =
  | 'document'
  | 'spreadsheet'
  | 'slide'
  | 'markdown'
  | 'html'
  | 'pdf'
  | 'about'

export interface OpenDecision {
  tab: OpenTab
  sheets: SheetData[] | null
}

// 将 UDM 文档中的表格块（xlsx 每个 sheet 对应一个 Table，序列化后只有 rows/style，无 type）转换为表格编辑器所需的 sheet 数据
export function tablesToSheets(doc: any): SheetData[] | null {
  const blocks: any[] = (doc && doc.blocks) || []
  const tables = blocks.filter(
    (b) => b && (b.type === 'table' || (b.rows && Array.isArray(b.rows))),
  )
  if (!tables.length) return null
    return tables.map((tb: any, i: number) => {
      const cells: Record<string, any> = {}
      ;(tb.rows || []).forEach((row: any[], r: number) => {
        ;(row || []).forEach((cell: any, c: number) => {
          const inline: any[] = (cell && cell.inline) || []
          const text = inline
            .map((inl: any) => (inl ? inl.content ?? inl.text ?? '' : ''))
            .join('')
          // 取第一个带样式的行内文本的颜色/对齐/填充/斜体/字号
          const first: any = inline.find((inl: any) => inl && typeof inl === 'object') || {}
          const style: any = {
            value: text,
            bold: !!(cell && cell.isHeader) || !!first.bold,
          }
  if (first.italic) style.italic = true
  if (first.under) style.under = true
  if (first.strike) style.strike = true
  if (first.color) style.color = first.color
  if (first.align) style.align = first.align
  if (first.bg) style.bg = first.bg
  if (first.fontSize) style.fontSize = first.fontSize
  if (first.fontFamily) style.fontFamily = first.fontFamily
          if (text || (cell && cell.isHeader)) {
            cells[`${r}-${c}`] = style
          }
        })
      })
      return { name: (tb && tb.style) || `Sheet${i + 1}`, cells }
    })
}

// 判断路径是否应走表格（电子表格）视图
export function isSpreadsheetPath(path: string): boolean {
  return /\.(xlsx|xls|csv)$/i.test(path || '')
}

// 统一的打开决策：表格类文件（xlsx/csv/xls）→ 一律走 spreadsheet 视图
// （即便解析没有产出表格块，也显示空网格，绝不放回文档模板，保证选项卡切换）
export function decideOpen(path: string, document: any): OpenDecision {
  if (isSpreadsheetPath(path)) {
    const sheets = tablesToSheets(document)
    return { tab: 'spreadsheet', sheets: sheets || [{ name: 'Sheet1', cells: {} }] }
  }
  return { tab: 'document', sheets: null }
}
