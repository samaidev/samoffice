import { Schema } from 'prosemirror-model'

// ProseMirror schema - 完整排版支持，对标 MS Word 核心功能
export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },

    // === 段落 ===
    paragraph: {
      content: 'inline*',
      group: 'block',
      attrs: {
        align: { default: '' },
        lineHeight: { default: '' },
        indent: { default: 0 },
        spaceBefore: { default: 0 },
        spaceAfter: { default: 0 },
        // P1: 段落边框/底纹
        border: { default: '' },        // "all" / "left" / "none"
        shading: { default: '' },        // hex color
        // P1: 分栏
        columnSpan: { default: 0 },      // 0=跟随, 1=单栏, 2=双栏
        // P1: 首字下沉
        dropCap: { default: false },
        // P2: 字间距
        letterSpacing: { default: '' },  // "0.5px" / "1px"
        // P2: 文字方向
        rtl: { default: false },
      },
      toDOM: (node) => {
        const s: string[] = []
        if (node.attrs.align) s.push(`text-align: ${node.attrs.align}`)
        if (node.attrs.lineHeight) s.push(`line-height: ${node.attrs.lineHeight}`)
        if (node.attrs.indent > 0) s.push(`margin-left: ${node.attrs.indent * 2}em`)
        if (node.attrs.spaceBefore > 0) s.push(`margin-top: ${node.attrs.spaceBefore}pt`)
        if (node.attrs.spaceAfter > 0) s.push(`margin-bottom: ${node.attrs.spaceAfter}pt`)
        if (node.attrs.shading) s.push(`background-color: ${node.attrs.shading}`)
        if (node.attrs.border === 'all') s.push('border: 1px solid #ccc; padding: 4px')
        if (node.attrs.border === 'left') s.push('border-left: 3px solid #4f46e5; padding-left: 8px')
        if (node.attrs.letterSpacing) s.push(`letter-spacing: ${node.attrs.letterSpacing}`)
        if (node.attrs.rtl) s.push('direction: rtl')
        return ['p', { style: s.join('; ') }, 0]
      },
      parseDOM: [{
        tag: 'p',
        getAttrs: (dom: HTMLElement) => ({
          align: dom.style.textAlign || '',
          lineHeight: dom.style.lineHeight || '',
          indent: parseInt(dom.style.marginLeft) > 0 ? Math.floor(parseInt(dom.style.marginLeft) / 32) : 0,
          spaceBefore: parseInt(dom.style.marginTop) || 0,
          spaceAfter: parseInt(dom.style.marginBottom) || 0,
          shading: dom.style.backgroundColor || '',
          border: dom.style.border ? 'all' : (dom.style.borderLeft ? 'left' : ''),
          letterSpacing: dom.style.letterSpacing || '',
          rtl: dom.style.direction === 'rtl',
          columnSpan: 0, dropCap: false,
        })
      }]
    },

    // === 标题 ===
    heading: {
      attrs: { level: { default: 1, validate: 'number' }, align: { default: '' } },
      content: 'inline*',
      group: 'block',
      toDOM: (node) => ['h' + node.attrs.level, { style: node.attrs.align ? `text-align: ${node.attrs.align}` : '' }, 0],
      parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } }))
    },

    // === 表格（P0 核心） ===
    table: {
      content: 'table_row+',
      group: 'block',
      tableRole: 'table',
      toDOM: () => ['table', { class: 'pm-table', style: 'border-collapse: collapse; width: 100%; margin: 8px 0' }, 0],
      parseDOM: [{ tag: 'table' }]
    },
    table_row: {
      content: 'table_cell+',
      tableRole: 'row',
      toDOM: () => ['tr', 0],
      parseDOM: [{ tag: 'tr' }]
    },
    table_cell: {
      content: 'block+',
      tableRole: 'cell',
      attrs: {
        colspan: { default: 1 },
        rowspan: { default: 1 },
        align: { default: '' },
        isHeader: { default: false },
      },
      toDOM: (node) => {
        const tag = node.attrs.isHeader ? 'th' : 'td'
        const s: string[] = ['border: 1px solid #cbd5e1', 'padding: 6px 10px', 'vertical-align: top']
        if (node.attrs.align) s.push(`text-align: ${node.attrs.align}`)
        const attrs: any = { style: s.join('; ') }
        if (node.attrs.colspan > 1) attrs.colspan = node.attrs.colspan
        if (node.attrs.rowspan > 1) attrs.rowspan = node.attrs.rowspan
        return [tag, attrs, 0]
      },
      parseDOM: [{
        tag: 'td, th',
        getAttrs: (dom: HTMLElement) => ({
          colspan: parseInt(dom.getAttribute('colspan') || '1'),
          rowspan: parseInt(dom.getAttribute('rowspan') || '1'),
          align: dom.style.textAlign || '',
          isHeader: dom.tagName === 'TH',
        })
      }]
    },

    // === 列表 ===
    bullet_list: {
      content: 'list_item+',
      group: 'block',
      toDOM: () => ['ul', 0],
      parseDOM: [{ tag: 'ul' }]
    },
    ordered_list: {
      content: 'list_item+',
      group: 'block',
      toDOM: () => ['ol', 0],
      parseDOM: [{ tag: 'ol' }]
    },
    list_item: {
      content: 'paragraph block*',
      toDOM: () => ['li', 0],
      parseDOM: [{ tag: 'li' }]
    },

    // === 引用 ===
    blockquote: {
      content: 'block+',
      group: 'block',
      toDOM: () => ['blockquote', 0],
      parseDOM: [{ tag: 'blockquote' }]
    },

    // === 代码块 ===
    code_block: {
      content: 'text*',
      marks: '',
      group: 'block',
      code: true,
      toDOM: () => ['pre', ['code', 0]],
      parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }]
    },

    // === 水平线 ===
    horizontal_rule: {
      group: 'block',
      parseDOM: [{ tag: 'hr' }],
      toDOM: () => ['hr', { style: 'border: none; border-top: 2px solid #e2e8f0; margin: 16px 0' }],
    },

    // === 分页符 ===
    page_break: {
      group: 'block',
      atom: true,
      toDOM: () => ['div', { style: 'page-break-after: always; border-top: 1px dashed #94a3b8; margin: 16px 0; text-align: center', 'data-page-break': 'true' }, '— 分页 —'],
      parseDOM: [{ tag: 'div[data-page-break]' }],
    },

    // === 图片 ===
    image: {
      inline: false,
      attrs: { src: { validate: 'string' }, alt: { default: '' }, title: { default: '' }, width: { default: 0 }, height: { default: 0 } },
      group: 'block',
      toDOM: (node) => {
        const attrs: any = { src: node.attrs.src, alt: node.attrs.alt, title: node.attrs.title }
        if (node.attrs.width) attrs.style = `width: ${node.attrs.width}px; max-width: 100%`
        return ['img', attrs]
      },
      parseDOM: [{
        tag: 'img[src]',
        getAttrs: (dom: HTMLElement) => ({
          src: dom.getAttribute('src') || '',
          alt: dom.getAttribute('alt') || '',
          title: dom.getAttribute('title') || '',
          width: parseInt(dom.style.width) || 0,
          height: parseInt(dom.style.height) || 0,
        })
      }]
    },

    // === 文本框（P2） ===
    text_box: {
      content: 'block+',
      group: 'block',
      atom: false,
      attrs: { bgColor: { default: '#fef3c7' }, borderColor: { default: '#f59e0b' } },
      toDOM: (node) => ['div', {
        class: 'text-box',
        style: `background: ${node.attrs.bgColor}; border: 2px solid ${node.attrs.borderColor}; border-radius: 8px; padding: 12px 16px; margin: 8px 0`
      }, 0],
      parseDOM: [{ tag: 'div.text-box' }],
    },

    // === 脚注引用（P1） ===
    footnote: {
      inline: true,
      group: 'inline',
      atom: true,
      attrs: { content: { default: '' } },
      toDOM: (node) => ['sup', { class: 'footnote-ref', title: node.attrs.content, style: 'color: #4f46e5; cursor: pointer' }, '[注]'],
      parseDOM: [{ tag: 'sup.footnote-ref' }],
    },

    // === 书签（P1） ===
    bookmark: {
      inline: true,
      group: 'inline',
      atom: true,
      attrs: { name: { default: '' } },
      toDOM: (node) => ['a', { name: node.attrs.name, class: 'bookmark', style: 'color: #94a3b8' }, '⚓'],
      parseDOM: [{ tag: 'a.bookmark' }],
    },

    // === 批注标记（P1） ===
    comment_mark: {
      inline: true,
      group: 'inline',
      atom: true,
      attrs: { id: { default: '' }, author: { default: '' }, text: { default: '' } },
      toDOM: (node) => ['span', { class: 'comment-mark', 'data-comment-id': node.attrs.id, 'data-author': node.attrs.author, 'data-text': node.attrs.text, style: 'background: #fef3c7; border-bottom: 1px dashed #f59e0b; cursor: pointer' }, 0],
      parseDOM: [{ tag: 'span.comment-mark' }],
    },

    hard_break: {
      inline: true, group: 'inline', selectable: false,
      toDOM: () => ['br'],
      parseDOM: [{ tag: 'br' }]
    },

    text: { group: 'inline' }
  },

  marks: {
    // === 基础 ===
    bold: { toDOM: () => ['strong', 0], parseDOM: [{ tag: 'strong' }, { tag: 'b' }] },
    italic: { toDOM: () => ['em', 0], parseDOM: [{ tag: 'em' }, { tag: 'i' }] },
    underline: { toDOM: () => ['u', 0], parseDOM: [{ tag: 'u' }] },
    strikethrough: { toDOM: () => ['s', 0], parseDOM: [{ tag: 's' }, { tag: 'strike' }, { style: 'text-decoration: line-through' }] },
    code: { toDOM: () => ['code', 0], parseDOM: [{ tag: 'code' }] },

    // === 上标/下标（P0） ===
    superscript: { toDOM: () => ['sup', 0], parseDOM: [{ tag: 'sup' }, { style: 'vertical-align: super' }] },
    subscript: { toDOM: () => ['sub', 0], parseDOM: [{ tag: 'sub' }, { style: 'vertical-align: sub' }] },

    // === 字体排版 ===
    fontSize: {
      attrs: { size: { validate: 'string' } },
      toDOM: (mark) => ['span', { style: `font-size: ${mark.attrs.size}` }, 0],
      parseDOM: [{ tag: 'span[style]', getAttrs: (d: HTMLElement) => d.style.fontSize ? { size: d.style.fontSize } : false }]
    },
    fontFamily: {
      attrs: { font: { validate: 'string' } },
      toDOM: (mark) => ['span', { style: `font-family: ${mark.attrs.font}` }, 0],
      parseDOM: [{ tag: 'span[style]', getAttrs: (d: HTMLElement) => d.style.fontFamily ? { font: d.style.fontFamily } : false }]
    },
    textColor: {
      attrs: { color: { validate: 'string' } },
      toDOM: (mark) => ['span', { style: `color: ${mark.attrs.color}` }, 0],
      parseDOM: [{ tag: 'span[style]', getAttrs: (d: HTMLElement) => d.style.color ? { color: d.style.color } : false }]
    },
    highlight: {
      attrs: { color: { default: 'yellow' } },
      toDOM: (mark) => ['span', { style: `background-color: ${mark.attrs.color}` }, 0],
      parseDOM: [{ tag: 'span[style]', getAttrs: (d: HTMLElement) => d.style.backgroundColor ? { color: d.style.backgroundColor } : false }]
    },

    // === 链接 ===
    link: {
      attrs: { href: { validate: 'string' } },
      inclusive: false,
      toDOM: (mark) => ['a', { href: mark.attrs.href, target: '_blank', rel: 'noopener' }, 0],
      parseDOM: [{ tag: 'a[href]', getAttrs: (d: HTMLElement) => ({ href: d.getAttribute('href') || '' }) }]
    },

    // === 修订追踪（P1） ===
    insert_track: {
      attrs: { author: { default: '' } },
      toDOM: (mark) => ['span', { class: 'track-insert', style: 'color: #10b981; text-decoration: underline' }, 0],
      parseDOM: [{ tag: 'span.track-insert' }],
    },
    delete_track: {
      attrs: { author: { default: '' } },
      toDOM: (mark) => ['span', { class: 'track-delete', style: 'color: #ef4444; text-decoration: line-through' }, 0],
      parseDOM: [{ tag: 'span.track-delete' }],
    },
  }
})
