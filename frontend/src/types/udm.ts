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

  spellCheck(text: string, lang: string): Promise<SpellError[]>
  suggest(word: string, lang: string, n?: number): Promise<Candidate[]>
  learnWord(word: string, lang: string, source?: string): Promise<void>
}
