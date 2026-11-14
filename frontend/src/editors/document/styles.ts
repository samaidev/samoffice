// 样式系统：命名样式、批量调整、用于目录生成
// 每个样式是一组段落/字符格式，应用到块上后既设置块属性（align 等），
// 也把字符格式（字号/粗体/颜色等）落到块内文本上。

export interface StyleFormat {
  fontSize?: string      // 如 "24px"
  bold?: boolean
  italic?: boolean
  color?: string         // #hex
  fontFamily?: string
  align?: string         // left/center/right/justify
  lineHeight?: string
  outlineLevel?: number  // 标题样式对应的提纲级别（用于生成目录）
}

export interface AppStyle {
  name: string
  type: 'paragraph' | 'character'
  builtin: boolean
  format: StyleFormat
}

// 内置样式（与 MS Word 的“标题 1/2/3”“正文”“引用”等对应）
export const BUILTIN_STYLES: AppStyle[] = [
  { name: 'Normal', type: 'paragraph', builtin: true, format: { fontSize: '15px' } },
  { name: 'Title', type: 'paragraph', builtin: true, format: { fontSize: '32px', bold: true, align: 'center', color: '#111111' } },
  { name: 'Heading 1', type: 'paragraph', builtin: true, format: { fontSize: '24px', bold: true, outlineLevel: 1, color: '#1f2937' } },
  { name: 'Heading 2', type: 'paragraph', builtin: true, format: { fontSize: '20px', bold: true, outlineLevel: 2, color: '#1f2937' } },
  { name: 'Heading 3', type: 'paragraph', builtin: true, format: { fontSize: '17px', bold: true, outlineLevel: 3, color: '#1f2937' } },
  { name: 'Heading 4', type: 'paragraph', builtin: true, format: { fontSize: '15px', bold: true, outlineLevel: 4, color: '#1f2937' } },
  { name: 'Quote', type: 'paragraph', builtin: true, format: { italic: true, color: '#555555' } },
  { name: 'List Paragraph', type: 'paragraph', builtin: true, format: { fontSize: '15px' } },
  { name: 'Caption', type: 'paragraph', builtin: true, format: { fontSize: '12px', italic: true, color: '#666666' } },
]

export const BUILTIN_STYLE_MAP: Record<string, AppStyle> = Object.fromEntries(
  BUILTIN_STYLES.map((s) => [s.name, s])
)

// 从样式名推断提纲级别（如 "My Heading 2" -> 2）
export function outlineLevelFromName(name: string): number | undefined {
  const m = name.match(/(\d+)\s*$/)
  if (m) {
    const n = parseInt(m[1], 10)
    if (n >= 1 && n <= 9) return n
  }
  return undefined
}

// 把 UDM 中保存的样式定义（StyleDef）转换成本系统的 StyleFormat
export function styleDefToFormat(props: Record<string, unknown> | undefined): StyleFormat {
  const f: StyleFormat = {}
  if (!props) return f
  if (typeof props.fontSize === 'string') f.fontSize = props.fontSize
  if (typeof props.bold === 'boolean') f.bold = props.bold
  if (typeof props.italic === 'boolean') f.italic = props.italic
  if (typeof props.color === 'string') f.color = props.color
  if (typeof props.fontFamily === 'string') f.fontFamily = props.fontFamily
  if (typeof props.align === 'string') f.align = props.align
  if (typeof props.lineHeight === 'string') f.lineHeight = props.lineHeight
  if (typeof props.outlineLevel === 'number') f.outlineLevel = props.outlineLevel
  return f
}
