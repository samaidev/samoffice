import { Schema, Mark, Node } from 'prosemirror-model'
import type { Document, Block, Inline, PageNumberConfig } from '../../types/udm'

// 段落/标题的格式化属性键（统一存于 UDM 的 props 中，确保 Go 往返与 docx 导出保留）
const PARA_PROP_KEYS = [
  'indent', 'indentLeft', 'indentRight', 'firstLine', 'hanging',
  'lineHeight', 'spaceBefore', 'spaceAfter',
  'lineSpacingKind', 'lineSpacingValue',
  'keepLines', 'keepWithNext', 'pageBreakBefore', 'outlineLevel',
  'border', 'shading', 'columnSpan', 'dropCap', 'letterSpacing', 'rtl',
]

function extractParaProps(attrs: any): any {
  const props: any = {}
  for (const k of PARA_PROP_KEYS) {
    if (attrs[k] !== undefined && attrs[k] !== '' && attrs[k] !== 0 && attrs[k] !== false) props[k] = attrs[k]
  }
  return props
}

function applyParaAttrsFromProps(b: any, base: any): any {
  const props = b.props || {}
  const a = { ...base }
  for (const k of PARA_PROP_KEYS) {
    if (props[k] !== undefined) a[k] = props[k]
    else if (b[k] !== undefined) a[k] = b[k] // 兼容旧版顶层字段
  }
  return a
}

// UDM → ProseMirror 转换
export function udmToProseMirror(udm: Document, schema: Schema): Node {
  const blocks: Node[] = (udm.blocks || []).map((b) => blockToPM(b, schema))
  const attrs: any = {}
  if (udm.pageNumber) {
    attrs.pageNumber = udm.pageNumber
  }
  return schema.node('doc', attrs, blocks)
}

function blockToPM(b: Block, schema: Schema): Node {
  const t = blockType(b)
  switch (t) {
    case 'heading': {
      const h = b as any
      return schema.node('heading', applyParaAttrsFromProps(h, { level: h.level, id: h.id || '', style: h.style || '', align: h.align || '' }), inlineToPM(h.inline, schema))
    }
    case 'paragraph': {
      const p = b as any
      return schema.node('paragraph', applyParaAttrsFromProps(p, { style: p.style || '', align: p.align || '', id: p.id || '' }), inlineToPM(p.inline, schema))
    }
    case 'codeBlock': {
      const c = b as any
      return schema.node('code_block', {}, c.code ? schema.text(c.code) : [])
    }
    case 'bulletList': {
      const l = b as any
      const items = (l.items || []).map((item: any) =>
        schema.node(
          'list_item',
          {},
          (Array.isArray(item) ? item : [item]).map((ib: any) => blockToPM(ib, schema)),
        )
      )
      return schema.node(
        l.ordered ? 'ordered_list' : 'bullet_list',
        l.ordered ? { style: l.style || '', start: Number(l.start) || 1 } : {},
        items,
      )
    }
    case 'image': {
      const im = b as any
      return schema.node('image', { src: im.src, alt: im.alt || '', width: im.width || 0, height: im.height || 0, float: im.float || '', align: im.align || '' })
    }
    case 'math': {
      const m = b as any
      return schema.node('math', { latex: m.formula || m.latex || '', inline: !!m.inline })
    }
    case 'textbox': {
      const tb = b as any
      // 内部块递归转为 PM 节点
      const inner = (Array.isArray(tb.inline) ? tb.inline : []).map((ib: Block) => blockToPM(ib, schema))
      return schema.node('text_box', {
        bgColor: tb.bgColor || '#fef3c7',
        borderColor: tb.borderColor || '#f59e0b',
        shape: tb.shape || 'rect',
        width: Number(tb.width) || 0,
        float: tb.float || '',
        borderW: Number(tb.borderW) || 1,
        lineStyle: tb.lineStyle || 'solid',
      }, inner)
    }
    case 'formula' in (b as any) && (b as any).formula: {
      const m = b as any
      return schema.node('math', { latex: m.formula || '', inline: !!m.inline })
    }
    case 'pageBreak': {
      const pb = b as any
      return schema.node('page_break', { restart: !!pb.restart, startNumber: Number(pb.startNumber) || 1 })
    }
    case 'footnote_section': {
      const fs = b as any
      const items = (fs.items || []).map((item: any) =>
        schema.node(
          'footnote_item',
          { num: Number(item.num) || 1 },
          inlineToPM(Array.isArray(item.inline) ? item.inline : (item.inline ? [item.inline] : []), schema),
        ),
      )
      return schema.node('footnote_section', {}, items)
    }
    case 'table': {
      const tb = b as any
      const cellToPM = (cell: any) => {
        let content: Node[]
        if (cell.blocks && cell.blocks.length) {
          content = cell.blocks.map((ib: Block) => blockToPM(ib, schema))
        } else if (cell.inline && cell.inline.length) {
          content = [schema.node('paragraph', {}, inlineToPM(cell.inline, schema))]
        } else {
          content = [schema.node('paragraph', {})]
        }
        return schema.node(
          'table_cell',
          {
            colspan: cell.colSpan || 1,
            rowspan: cell.rowSpan || 1,
            align: cell.align || '',
            isHeader: !!cell.isHeader,
            borderW: tb.border || 0,
          },
          content,
        )
      }
      const rows = (tb.rows || [])
        .filter((row: any[]) => row && row.length > 0)
        .map((row: any[]) =>
          schema.node('table_row', {}, row.map(cellToPM)),
        )
      return schema.node('table', { align: tb.align || '' }, rows)
    }
    default:
      return schema.node('paragraph', {}, schema.text('[unsupported block]'))
  }
}

function blockType(b: Block): string {
  // 显式 type 字段优先（脚注区等），且不影响无 type 的既有块
  if ((b as any).type) return (b as any).type
  if ('level' in b) return 'heading'
  if ('code' in b) return 'codeBlock'
  if ('items' in b) return 'bulletList'
  if ('formula' in b) return 'math'
  if ('src' in b && 'caption' in b) return 'image'
  if ('rows' in b) return 'table'
  // 分页符：core.PageBreak 序列化后为空对象 {}，或带 restart/startNumber 字段，
  // 没有其它块级字段，必须在此显式识别，否则会被 blockToPM 当成普通段落吞掉。
  if ('restart' in b || 'startNumber' in b) return 'pageBreak'
  if (Object.keys(b).length === 0) return 'pageBreak'
  return 'paragraph'
}

function inlineToPM(inlines: Inline[] | undefined, schema: Schema): Node[] {
  if (!inlines || inlines.length === 0) return []
  const result: Node[] = []
  for (const inline of inlines) {
    if ((inline as any).type === 'footnote') {
      const fn = inline as any
      result.push(schema.node('footnote', { num: Number(fn.num) || 1, content: fn.content || '' }))
    } else if ('src' in inline) {
      // 内联图片（如 OLE .doc 提取的 PICF 图片，base64 data URI）。
      // 必须用 inline 原子节点 inlineImage（schema.image 是 block 节点，
      // 塞进段落会触发 ProseMirror 内容校验崩溃）。块级图片仍由 blockToPM 处理。
      const im = inline as any
      const attrs: any = { src: im.src }
      if (im.width) attrs.width = im.width
      if (im.height) attrs.height = im.height
      result.push(schema.node('inlineImage', attrs))
    } else if ('url' in inline) {
      const h = inline as any
      const mark = schema.marks.link.create({ href: h.url })
      const inner = inlineToPM(Array.isArray(h.text) ? h.text : (h.text ? [h.text] : []), schema)
      inner.forEach((n) => {
        if (n.isText) result.push(schema.text(n.text!, [mark]))
        else result.push(n)
      })
    } else if ('content' in inline) {
      const t = inline as any
      const marks: Mark[] = []
      // 修订追踪：type==='track' 时还原 insert/delete 标记
      if (t.type === 'track' && (t.track === 'insert' || t.track === 'delete')) {
        const mk = t.track === 'insert' ? 'insert_track' : 'delete_track'
        marks.push((schema.marks as any)[mk].create({ author: t.author || '' }))
      }
      if (t.bold) marks.push(schema.marks.bold.create())
      if (t.italic) marks.push(schema.marks.italic.create())
      if (t.under) marks.push(schema.marks.underline.create())
      if (t.strike) marks.push(schema.marks.strikethrough.create())
      if (t.style === 'code') marks.push(schema.marks.code.create())
      if (t.superscript) marks.push(schema.marks.superscript.create())
      if (t.subscript) marks.push(schema.marks.subscript.create())
      if (t.font) marks.push(schema.marks.fontFamily.create({ font: t.font }))
      // 字号：优先后端 fontSize（单位：磅），统一转换为 px 存入 mark，避免与工具栏(pt/px 混用)不一致。
      // 1pt = 96/72 px。导出时再转回磅值写回后端。
      const fs = (t as any).fontSize
      if (fs != null) {
        const pt = typeof fs === 'number' ? fs : parseFloat(fs)
        if (!isNaN(pt)) {
          const px = Math.max(1, Math.round(pt * 96 / 72))
          marks.push(schema.marks.fontSize.create({ size: `${px}px` }))
        }
      } else if (t.size) marks.push(schema.marks.fontSize.create({ size: t.size }))
      if (t.color) marks.push(schema.marks.textColor.create({ color: t.color }))
      if (t.highlight) marks.push(schema.marks.highlight.create({ color: t.highlight }))
      if (t.content) result.push(schema.text(t.content, marks))
    }
  }
  return result
}

// ProseMirror → UDM 转换
export function proseMirrorToUDM(doc: Node, opts?: { pageNumber?: PageNumberConfig }): Document {
  const blocks: Block[] = []
  doc.forEach((node) => {
    const b = pmToBlock(node)
    if (b) blocks.push(b)
  })
  const out: Document = { meta: { title: 'Untitled' }, blocks }
  if (opts && opts.pageNumber) out.pageNumber = opts.pageNumber
  return out
}

function pmToBlock(node: Node): Block | null {
  switch (node.type.name) {
    case 'paragraph':
      return { inline: pmToInline(node), style: node.attrs.style || '', align: node.attrs.align || '', id: node.attrs.id || '', props: extractParaProps(node.attrs) }
    case 'heading':
      return { level: node.attrs.level, inline: pmToInline(node), style: node.attrs.style || '', id: node.attrs.id || '', align: node.attrs.align || '', props: extractParaProps(node.attrs) }
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
      return { items, ordered: node.type.name === 'ordered_list', style: node.attrs.style || '' }
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
    case 'page_break':
      return { restart: !!node.attrs.restart, startNumber: Number(node.attrs.startNumber) || 1 }
    case 'math':
      return { formula: node.attrs.latex || '', inline: !!node.attrs.inline }
    case 'text_box': {
      const tb = node as any
      const inner = tb.children.map((ib: Node) => pmToBlock(ib)).filter(Boolean)
      return {
        type: 'textbox',
        inline: inner,
        bgColor: tb.attrs.bgColor || '#fef3c7',
        borderColor: tb.attrs.borderColor || '#f59e0b',
        shape: tb.attrs.shape || 'rect',
        width: Number(tb.attrs.width) || 0,
        float: tb.attrs.float || '',
        borderW: Number(tb.attrs.borderW) || 1,
        lineStyle: tb.attrs.lineStyle || 'solid',
      } as any
    }
    case 'footnote':
      return { type: 'footnote', num: Number(node.attrs.num) || 1, content: node.attrs.content || '' } as any
    case 'footnote_section': {
      const items = node.children.map((item: any) => ({
        num: Number(item.attrs.num) || 1,
        inline: item.childCount > 0 ? pmToInline(item) : [],
      }))
      return { type: 'footnote_section', items } as any
    }
    case 'table': {
      const rows = node.children.map((row: any) =>
        row.children.map((cell: any) => ({
          inline: cell.childCount > 0 ? pmToInline(cell) : [],
          colSpan: (cell.attrs.colSpan as number) || 1,
          rowSpan: (cell.attrs.rowSpan as number) || 1,
          align: (cell.attrs.align as string) || '',
          isHeader: !!cell.attrs.isHeader,
        })),
      )
      return { rows }
    }
    default:
      return null
  }
}

function pmToInline(node: Node): Inline[] {
  const result: Inline[] = []
  node.forEach((child) => {
    if (!child.isText) {
      if (child.type.name === 'tocLink') {
        if (child.attrs.label) result.push({ content: child.attrs.label } as any)
      }
      return
    }
    const marks = child.marks
    const text = child.text || ''
    // 修订追踪：检测 insert/delete track mark，输出为 track 行内以持久化
    const insMark = marks.find((m) => m.type.name === 'insert_track')
    const delMark = marks.find((m) => m.type.name === 'delete_track')
    const trackMark = insMark || delMark
    if (trackMark) {
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
      result.push({
        type: 'track',
        track: insMark ? 'insert' : 'delete',
        author: trackMark.attrs.author || '',
        content: text, bold, italic, under, strike,
        style: code ? 'code' : '',
        superscript: sup || undefined,
        subscript: sub || undefined,
        font: fontMark?.attrs.font,
        fontSize: sizeMark ? Math.max(0.5, Math.round(parseFloat(sizeMark.attrs.size) * 72 / 96 * 2) / 2) : undefined,
        color: colorMark?.attrs.color,
        highlight: hlMark?.attrs.color,
      } as any)
      return
    }
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
        fontSize: sizeMark ? Math.max(0.5, Math.round(parseFloat(sizeMark.attrs.size) * 72 / 96 * 2) / 2) : undefined,
        color: colorMark?.attrs.color,
        highlight: hlMark?.attrs.color,
      } as any)
    }
  })
  return result
}
