import { Schema } from 'prosemirror-model'

// ProseMirror schema - 定义文档结构和标记
export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      content: 'inline*',
      group: 'block',
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }]
    },
    heading: {
      attrs: { level: { default: 1, validate: 'number' } },
      content: 'inline*',
      group: 'block',
      toDOM: (node) => [`h${node.attrs.level}`, 0],
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
    code: {
      toDOM: () => ['code', 0],
      parseDOM: [{ tag: 'code' }]
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
