import { Schema, Mark, Node } from 'prosemirror-model'
import type { Document, Block, Inline } from '../../types/udm'

// UDM → ProseMirror 转换
export function udmToProseMirror(udm: Document, schema: Schema): Node {
  const blocks: Node[] = (udm.blocks || []).map((b) => blockToPM(b, schema))
  return schema.node('doc', {}, blocks)
}

function blockToPM(b: Block, schema: Schema): Node {
  const t = blockType(b)
  switch (t) {
    case 'heading': {
      const h = b as any
      return schema.node('heading', { level: h.level }, inlineToPM(h.inline, schema))
    }
    case 'paragraph': {
      const p = b as any
      return schema.node('paragraph', {}, inlineToPM(p.inline, schema))
    }
    case 'codeBlock': {
      const c = b as any
      return schema.node('code_block', {}, c.code ? schema.text(c.code) : [])
    }
    case 'bulletList': {
      const l = b as any
      const items = (l.items || []).map((item: Block[]) =>
        schema.node('list_item', {}, item.map((ib) => blockToPM(ib, schema)))
      )
      return schema.node(l.ordered ? 'ordered_list' : 'bullet_list', {}, items)
    }
    case 'image': {
      const im = b as any
      return schema.node('image', { src: im.src, alt: im.alt || '' })
    }
    default:
      return schema.node('paragraph', {}, schema.text('[unsupported block]'))
  }
}

function blockType(b: Block): string {
  if ('level' in b) return 'heading'
  if ('code' in b) return 'codeBlock'
  if ('items' in b) return 'bulletList'
  if ('src' in b && 'caption' in b) return 'image'
  if ('rows' in b) return 'table'
  return 'paragraph'
}

function inlineToPM(inlines: Inline[] | undefined, schema: Schema): Node[] {
  if (!inlines || inlines.length === 0) return []
  const result: Node[] = []
  for (const inline of inlines) {
    if ('url' in inline) {
      const h = inline as any
      const mark = schema.marks.link.create({ href: h.url })
      const inner = inlineToPM(h.text, schema)
      inner.forEach((n) => {
        if (n.isText) result.push(schema.text(n.text!, [mark]))
        else result.push(n)
      })
    } else if ('content' in inline) {
      const t = inline as any
      const marks: Mark[] = []
      if (t.bold) marks.push(schema.marks.bold.create())
      if (t.italic) marks.push(schema.marks.italic.create())
      if (t.under) marks.push(schema.marks.underline.create())
      if (t.strike) marks.push(schema.marks.strikethrough.create())
      if (t.style === 'code') marks.push(schema.marks.code.create())
      if (t.superscript) marks.push(schema.marks.superscript.create())
      if (t.subscript) marks.push(schema.marks.subscript.create())
      if (t.font) marks.push(schema.marks.fontFamily.create({ font: t.font }))
      if (t.size) marks.push(schema.marks.fontSize.create({ size: t.size }))
      if (t.color) marks.push(schema.marks.textColor.create({ color: t.color }))
      if (t.highlight) marks.push(schema.marks.highlight.create({ color: t.highlight }))
      if (t.content) result.push(schema.text(t.content, marks))
    }
  }
  return result
}

// ProseMirror → UDM 转换
export function proseMirrorToUDM(doc: Node): Document {
  const blocks: Block[] = []
  doc.forEach((node) => {
    const b = pmToBlock(node)
    if (b) blocks.push(b)
  })
  return { meta: { title: 'Untitled' }, blocks }
}

function pmToBlock(node: Node): Block | null {
  switch (node.type.name) {
    case 'paragraph':
      return { inline: pmToInline(node), style: '', align: '' }
    case 'heading':
      return { level: node.attrs.level, inline: pmToInline(node), style: '' }
    case 'bullet_list':
    case 'ordered_list': {
      const items: Block[][] = []
      node.forEach((item) => {
        const itemBlocks: Block[] = []
        item.forEach((ib) => {
          const b = pmToBlock(ib)
          if (b) itemBlocks.push(b)
        })
        items.push(itemBlocks)
      })
      return { items, ordered: node.type.name === 'ordered_list' }
    }
    case 'code_block':
      return { code: node.textContent, language: '' }
    case 'blockquote': {
      const inner = node.firstChild
      if (inner) return { inline: pmToInline(inner), style: 'quote', align: '' }
      return { inline: [], style: 'quote', align: '' }
    }
    case 'image':
      return { src: node.attrs.src, alt: node.attrs.alt || '', width: 0, height: 0 }
    default:
      return null
  }
}

function pmToInline(node: Node): Inline[] {
  const result: Inline[] = []
  node.forEach((child) => {
    if (!child.isText) return
    const marks = child.marks
    const text = child.text || ''
    const bold = marks.some((m) => m.type.name === 'bold')
    const italic = marks.some((m) => m.type.name === 'italic')
    const under = marks.some((m) => m.type.name === 'underline')
    const strike = marks.some((m) => m.type.name === 'strikethrough')
    const code = marks.some((m) => m.type.name === 'code')
    const sup = marks.some((m) => m.type.name === 'superscript')
    const sub = marks.some((m) => m.type.name === 'subscript')
    const fontMark = marks.find((m) => m.type.name === 'fontFamily')
    const sizeMark = marks.find((m) => m.type.name === 'fontSize')
    const colorMark = marks.find((m) => m.type.name === 'textColor')
    const hlMark = marks.find((m) => m.type.name === 'highlight')
    const link = marks.find((m) => m.type.name === 'link')
    if (link) {
      result.push({
        url: link.attrs.href,
        text: [{ content: text, bold, italic, under, strike, style: code ? 'code' : '' }]
      })
    } else {
      result.push({
        content: text, bold, italic, under, strike,
        style: code ? 'code' : '',
        superscript: sup || undefined,
        subscript: sub || undefined,
        font: fontMark?.attrs.font,
        size: sizeMark?.attrs.size,
        color: colorMark?.attrs.color,
        highlight: hlMark?.attrs.color,
      } as any)
    }
  })
  return result
}
