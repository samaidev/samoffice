// UDM (Unified Document Model) - 与 Go 端 core.Document 对应的类型定义

export interface Meta {
  title: string
  author?: string
  subject?: string
  description?: string
  createdAt?: string
  modifiedAt?: string
  language?: string
}

export interface Warning {
  level: 'info' | 'warn' | 'error'
  stage: 'unzip' | 'xml' | 'schema' | 'map'
  message: string
  path?: string
}

export type Block =
  | Paragraph
  | Heading
  | BulletList
  | Table
  | Image
  | CodeBlock
  | RawBlock
  | PageBreak
  | Math

// 分页符：restart 为 true 时，从此处开始重新计算页码（生成分节 + 重启编号）
export interface PageBreak {
  restart?: boolean
  startNumber?: number
}

// 公式块：formula 为 LaTeX 源码，inline 表示行内公式
export interface Math {
  formula: string
  inline?: boolean
}

// 页码配置（页脚中的页码字段样式/格式）
export interface PageNumberConfig {
  enabled: boolean
  format: string          // 模板：支持 {n}（当前页）与 {total}（总页数），如 "第 {n} 页"、"第 {n} / 共 {total} 页"、"Page {n} of {total}"
  align?: 'left' | 'center' | 'right'
  fontFamily?: string
  fontSize?: number       // 半磅，如 9 = 4.5pt
  fontColor?: string
  bold?: boolean
  italic?: boolean
  firstPageDifferent?: boolean  // 首页不显示页码
}

export interface Paragraph {
  inline: Inline[]
  style?: string
  align?: string
  props?: Record<string, unknown>
}

export interface Heading {
  level: number
  inline: Inline[]
  style?: string
  id?: string
}

export interface BulletList {
  items: Block[][]
  ordered: boolean
}

export interface Table {
  rows: TableCell[][]
  width?: number[]
  style?: string
}

export interface TableCell {
  inline?: Inline[]
  blocks?: Block[]
  rowSpan?: number
  colSpan?: number
  isHeader?: boolean
}

export interface Image {
  src: string
  width?: number
  height?: number
  caption?: Inline[]
  alt?: string
  float?: string
  align?: string
}

export interface CodeBlock {
  language?: string
  code: string
}

export interface RawBlock {
  kind: string
  data: Record<string, unknown>
}

export type Inline = Text | Hyperlink | InlineImage | RawInline

export interface Text {
  content: string
  bold?: boolean
  italic?: boolean
  under?: boolean
  strike?: boolean
  style?: string
  // P0: 上标/下标
  superscript?: boolean
  subscript?: boolean
  // 字体排版
  font?: string
  size?: string
  color?: string
  highlight?: string
}

export interface Hyperlink {
  url: string
  text: Inline[]
}

export interface InlineImage {
  src: string
  width?: number
  height?: number
}

export interface RawInline {
  kind: string
  data: Record<string, unknown>
}

export interface Document {
  meta: Meta
  blocks: Block[]
  comments?: Comment[]
  styles?: StyleDef[]
  pageNumber?: PageNumberConfig
  warnings?: Warning[]
  raw?: Record<string, unknown>
}

export interface Comment {
  id: string
  author: string
  content: string
  anchor?: string
}

export interface StyleDef {
  name: string
  type: 'paragraph' | 'character' | 'table'
  parent?: string
  props?: Record<string, unknown>
}

// === 词库相关类型 ===

export interface SpellError {
  word: string
  lang: string
  start: number
  end: number
  suggest: string[]
}

export interface Candidate {
  word: string
  distance: number
  frequency: number
}

// === Backend 接口 ===

export interface Backend {
  mode: 'local' | 'remote'

  openFile(path: string): Promise<{ document: Document; warnings: Warning[]; path: string }>
  uploadFile(file: File): Promise<{ document: Document; warnings: Warning[] }>

  // 本地模式专用：原生文件对话框与写盘
  openFileDialog(): Promise<string>      // 返回选中路径，取消返回 ''
  readFile(path: string): Promise<string> // 返回文件 base64
  saveFileDialog(defaultName: string, format: string): Promise<string> // 返回选中路径，取消返回 ''
  writeDocument(path: string, format: string, document: Document): Promise<void>

  spellCheck(text: string, lang: string): Promise<SpellError[]>
  suggest(word: string, lang: string, n?: number): Promise<Candidate[]>
  learnWord(word: string, lang: string, source?: string): Promise<void>
  getStartupArgs(): Promise<string[]>
}
