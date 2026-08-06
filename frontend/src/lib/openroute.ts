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

export interface SlideShape {
  kind: string // text | rect | pic
  x: number; y: number; cx: number; cy: number // EMU
  fill?: string // #RRGGBB
  text?: string
  color?: string
  sizePt?: number
  bold?: boolean
  align?: string // l|c|r
  vanchor?: string // t|ctr|b
  img?: string // data URL
}

export interface SlideData {
  title: string
  content: string
  notes?: string
  bg?: string
  shapes?: SlideShape[]
  pageW?: number // 页面宽度 EMU
  pageH?: number // 页面高度 EMU
}

export interface OpenDecision {
  tab: OpenTab
  sheets: SheetData[] | null
  slides: SlideData[] | null
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

// Markdown 文件 → MD 标签页（分屏编辑 + 实时预览）
export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path || '')
}

// HTML 文件 → HTML 标签页
export function isHtmlPath(path: string): boolean {
  return /\.(html?|htm)$/i.test(path || '')
}

// PDF 文件 → PDF 标签页（用 blob URL 由 PdfViewer 加载）
export function isPdfPath(path: string): boolean {
  return /\.pdf$/i.test(path || '')
}

// 演示文稿文件 → slide 视图
export function isSlidePath(path: string): boolean {
  return /\.(pptx|ppt|ppsx|pps|potx|pot|pptm|ppsm)$/i.test(path || '')
}

// 从 UDM 文档的 RawBlock(kind==='slide') 中提取幻灯片数据。
// pptx 解析器会把每张幻灯片存为 RawBlock{Data:{title,bullets,notes}}。
export function rawBlocksToSlides(doc: any): SlideData[] | null {
  const blocks: any[] = (doc && doc.blocks) || []
  const slides: SlideData[] = []
  for (const b of blocks) {
    // RawBlock 序列化后只有 kind/data 字段（无 type 字段），故用 b.kind 判断
    if (b && b.kind === 'slide' && b.data) {
      const d = b.data
      const bullets: string[] = Array.isArray(d.bullets) ? d.bullets : []
      const shapes: SlideShape[] = Array.isArray(d.shapes)
        ? d.shapes.map((s: any) => ({
            kind: s.kind,
            x: Number(s.x) || 0,
            y: Number(s.y) || 0,
            cx: Number(s.cx) || 0,
            cy: Number(s.cy) || 0,
            fill: typeof s.fill === 'string' ? s.fill : undefined,
            text: typeof s.text === 'string' ? s.text : undefined,
            color: typeof s.color === 'string' ? s.color : undefined,
            sizePt: typeof s.sizePt === 'number' ? s.sizePt : undefined,
            bold: !!s.bold,
            align: typeof s.align === 'string' ? s.align : undefined,
            vanchor: typeof s.vanchor === 'string' ? s.vanchor : undefined,
            img: typeof s.img === 'string' ? s.img : undefined,
          }))
        : []
      slides.push({
        title: typeof d.title === 'string' ? d.title : '',
        content: bullets.join('\n'),
        notes: typeof d.notes === 'string' ? d.notes : '',
        bg: typeof d.bg === 'string' ? d.bg : undefined,
        shapes,
        pageW: typeof d.pageW === 'number' ? d.pageW : undefined,
        pageH: typeof d.pageH === 'number' ? d.pageH : undefined,
      })
    }
  }
  return slides.length ? slides : null
}

// 统一的打开决策：
//  - 表格类文件（xlsx/csv/xls）→ spreadsheet 视图
//  - 演示文稿（pptx/ppt 等）→ slide 视图
//  - Markdown（.md/.markdown/.mdx）→ markdown 视图
//  - HTML（.html/.htm）→ html 视图
//  - PDF → pdf 视图
//  - 其余（docx/doc/rtf 等）→ document 视图
export function decideOpen(path: string, document: any): OpenDecision {
  if (isSpreadsheetPath(path)) {
    const sheets = tablesToSheets(document)
    return { tab: 'spreadsheet', sheets: sheets || [{ name: 'Sheet1', cells: {} }], slides: null }
  }
  if (isSlidePath(path)) {
    const slides = rawBlocksToSlides(document)
    return { tab: 'slide', sheets: null, slides: slides || [] }
  }
  if (isMarkdownPath(path)) return { tab: 'markdown', sheets: null, slides: null }
  if (isHtmlPath(path)) return { tab: 'html', sheets: null, slides: null }
  if (isPdfPath(path)) return { tab: 'pdf', sheets: null, slides: null }
  return { tab: 'document', sheets: null, slides: null }
}
