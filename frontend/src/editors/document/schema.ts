import { Schema } from 'prosemirror-model'

// ProseMirror schema - 定义文档结构和标记
// 支持完整排版：字体/字号/颜色/行距/对齐/缩进
export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      content: 'inline*',
      group: 'block',
      attrs: {
        align: { default: '' },        // left/center/right/justify
        lineHeight: { default: '' },    // 1.0/1.5/2.0 等
        indent: { default: 0 },         // 缩进级别 0-8
        spaceBefore: { default: 0 },    // 段前间距 pt
        spaceAfter: { default: 0 },     // 段后间距 pt
      },
      toDOM: (node) => {
        const style: string[] = []
        if (node.attrs.align) style.push(`text-align: ${node.attrs.align}`)
        if (node.attrs.lineHeight) style.push(`line-height: ${node.attrs.lineHeight}`)
        if (node.attrs.indent > 0) style.push(`margin-left: ${node.attrs.indent * 2}em`)
        if (node.attrs.spaceBefore > 0) style.push(`margin-top: ${node.attrs.spaceBefore}pt`)
        if (node.attrs.spaceAfter > 0) style.push(`margin-bottom: ${node.attrs.spaceAfter}pt`)
        return ['p', { style: style.join('; ') }, 0]
      },
      parseDOM: [{
        tag: 'p',
        getAttrs: (dom: HTMLElement) => ({
          align: dom.style.textAlign || dom.getAttribute('align') || '',
          lineHeight: dom.style.lineHeight || '',
          indent: parseInt(dom.style.marginLeft) > 0 ? Math.floor(parseInt(dom.style.marginLeft) / 32) : 0,
          spaceBefore: parseInt(dom.style.marginTop) || 0,
          spaceAfter: parseInt(dom.style.marginBottom) || 0,
        })
      }]
    },
    heading: {
      attrs: {
        level: { default: 1, validate: 'number' },
        align: { default: '' },
      },
      content: 'inline*',
      group: 'block',
      toDOM: (node) => {
        const style = node.attrs.align ? `text-align: ${node.attrs.align}` : ''
        return [`h${node.attrs.level}`, { style }, 0]
      },
      parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } }))
    },
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
    blockquote: {
      content: 'block+',
      group: 'block',
      toDOM: () => ['blockquote', 0],
      parseDOM: [{ tag: 'blockquote' }]
    },
    code_block: {
      content: 'text*',
      marks: '',
      group: 'block',
      code: true,
      toDOM: () => ['pre', ['code', 0]],
      parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }]
    },
    image: {
      inline: false,
      attrs: {
        src: { validate: 'string' },
        alt: { default: '' },
        title: { default: '' }
      },
      group: 'block',
      toDOM: (node) => ['img', { src: node.attrs.src, alt: node.attrs.alt, title: node.attrs.title }],
      parseDOM: [{
        tag: 'img[src]',
        getAttrs: (dom: HTMLElement) => ({
          src: dom.getAttribute('src') || '',
          alt: dom.getAttribute('alt') || '',
          title: dom.getAttribute('title') || ''
        })
      }]
    },
    hard_break: {
      inline: true,
      group: 'inline',
      selectable: false,
      toDOM: () => ['br'],
      parseDOM: [{ tag: 'br' }]
    },
    text: { group: 'inline' }
  },
  marks: {
    bold: {
      toDOM: () => ['strong', 0],
      parseDOM: [{ tag: 'strong' }, { tag: 'b' }]
    },
    italic: {
      toDOM: () => ['em', 0],
      parseDOM: [{ tag: 'em' }, { tag: 'i' }]
    },
    underline: {
      toDOM: () => ['u', 0],
      parseDOM: [{ tag: 'u' }]
    },
    strikethrough: {
      toDOM: () => ['s', 0],
      parseDOM: [{ tag: 's' }, { tag: 'strike' }]
    },
    code: {
      toDOM: () => ['code', 0],
      parseDOM: [{ tag: 'code' }]
    },
    // 字号
    fontSize: {
      attrs: { size: { validate: 'string' } }, // "12px" / "16px" / "24px"
      toDOM: (mark) => ['span', { style: `font-size: ${mark.attrs.size}` }, 0],
      parseDOM: [{
        tag: 'span[style]',
        getAttrs: (dom: HTMLElement) => {
          const m = dom.style.fontSize
          return m ? { size: m } : false
        }
      }]
    },
    // 字体族
    fontFamily: {
      attrs: { font: { validate: 'string' } },
      toDOM: (mark) => ['span', { style: `font-family: ${mark.attrs.font}` }, 0],
      parseDOM: [{
        tag: 'span[style]',
        getAttrs: (dom: HTMLElement) => {
          const m = dom.style.fontFamily
          return m ? { font: m } : false
        }
      }]
    },
    // 文字颜色
    textColor: {
      attrs: { color: { validate: 'string' } },
      toDOM: (mark) => ['span', { style: `color: ${mark.attrs.color}` }, 0],
      parseDOM: [{
        tag: 'span[style]',
        getAttrs: (dom: HTMLElement) => {
          const m = dom.style.color
          return m ? { color: m } : false
        }
      }]
    },
    // 高亮
    highlight: {
      attrs: { color: { default: 'yellow' } },
      toDOM: (mark) => ['span', { style: `background-color: ${mark.attrs.color}` }, 0],
      parseDOM: [{
        tag: 'span[style]',
        getAttrs: (dom: HTMLElement) => {
          const m = dom.style.backgroundColor
          return m ? { color: m } : false
        }
      }]
    },
    link: {
      attrs: { href: { validate: 'string' } },
      inclusive: false,
      toDOM: (mark) => ['a', { href: mark.attrs.href, target: '_blank', rel: 'noopener' }, 0],
      parseDOM: [{
        tag: 'a[href]',
        getAttrs: (dom: HTMLElement) => ({ href: dom.getAttribute('href') || '' })
      }]
    }
  }
})
