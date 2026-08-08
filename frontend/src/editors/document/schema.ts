import { Schema } from 'prosemirror-model'

// ProseMirror schema - 完整排版支持，对标 MS Word 核心功能
export const schema = new Schema({
  nodes: {
    doc: {
      content: 'block+',
      attrs: {
        pageNumber: { default: null }, // 页脚页码配置（来自 UDM doc.pageNumber）
      },
    },

    // === 段落 ===
    paragraph: {
      content: 'inline*',
      group: 'block',
      attrs: {
        align: { default: '' },
        lineHeight: { default: '' },
        indent: { default: 0 },          // 工具栏缩进档位（*2em），与 indentLeft 并存
        // P2: 精确缩进（px）
        indentLeft: { default: 0 },
        indentRight: { default: 0 },
        firstLine: { default: 0 },       // 首行缩进 px
        hanging: { default: 0 },         // 悬挂缩进 px
        spaceBefore: { default: 0 },     // pt
        spaceAfter: { default: 0 },      // pt
        // P2: 行距种类
        lineSpacingKind: { default: '' },   // '' | single | 1.5 | double | multiple | exact | atLeast
        lineSpacingValue: { default: 0 },   // multiple 系数 或 exact/atLeast 的 pt 值
        // 换行与分页
        keepLines: { default: false },      // 段中不分页
        keepWithNext: { default: false },   // 与下段同页
        pageBreakBefore: { default: false },// 段前分页
        outlineLevel: { default: 0 },       // 0=正文, 1-9=提纲级别
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
        // 命名样式（如 "Heading 1" / "Normal"），用于样式库“当前样式”高亮
        style: { default: '' },
      },
      toDOM: (node) => {
        const a = node.attrs
        const s: string[] = []
        if (a.align) s.push(`text-align: ${a.align}`)
        // 行距：优先用对话框的 lineSpacingKind/Value（贴近 MS Word 语义），
        // 其次用工具栏直接设置的 lineHeight（如 '1.5' / '28pt'）。
        if (a.lineSpacingKind) {
          const k = a.lineSpacingKind
          if (k === 'single') s.push('line-height: 1')
          else if (k === '1.5') s.push('line-height: 1.5')
          else if (k === 'double') s.push('line-height: 2')
          else if (k === 'multiple') s.push(`line-height: ${a.lineSpacingValue || 1}`)
          else if (k === 'exact' || k === 'atLeast') s.push(`line-height: ${a.lineSpacingValue}pt`)
        } else if (a.lineHeight) {
          // 兼容倍数（'1.5'）与固定值（'28pt'）两种写法
          s.push(`line-height: ${a.lineHeight}`)
        }
        // 缩进：以「字符」为单位（em），与 MS Word 一致。
        // indentLeft/right 以 em 存储（Word 的“左侧/右侧”用字符），
        // indent 档位 * 2em；firstLine/hanging 用 em（首行/悬挂缩进按字符计）。
        if (a.indentLeft) s.push(`margin-left: ${a.indentLeft}em`)
        else if (a.indent > 0) s.push(`margin-left: ${a.indent * 2}em`)
        if (a.indentRight) s.push(`margin-right: ${a.indentRight}em`)
        if (a.firstLine) s.push(`text-indent: ${a.firstLine}em`)
        if (a.hanging) s.push(`text-indent: -${a.hanging}em; margin-left: ${a.hanging}em`)
        if (a.spaceBefore > 0) s.push(`margin-top: ${a.spaceBefore}pt`)
        if (a.spaceAfter > 0) s.push(`margin-bottom: ${a.spaceAfter}pt`)
        if (a.shading) s.push(`background-color: ${a.shading}`)
        // 段落边框：支持四方向组合，border 为空格分隔的方向集合（'all'/'left'/'top'/'right'/'bottom' 或组合）
        if (a.border) {
          if (a.border === 'redBottom') {
            s.push('border-bottom: 2px solid #d40000; padding-bottom: 2px')
          } else {
            const sides = a.border.split(/\s+/).filter(Boolean)
            const all = sides.includes('all')
            const has = (side: string) => all || sides.includes(side)
            let pad = false
            if (has('top')) { s.push('border-top: 1px solid #ccc'); pad = true }
            if (has('right')) { s.push('border-right: 1px solid #ccc'); pad = true }
            if (has('bottom')) { s.push('border-bottom: 1px solid #ccc'); pad = true }
            if (has('left')) { s.push('border-left: 3px solid #4f46e5'); pad = true }
            if (pad) s.push('padding: 4px')
          }
        }
        if (a.letterSpacing) s.push(`letter-spacing: ${a.letterSpacing}`)
        if (a.rtl) s.push('direction: rtl')
        if (a.keepWithNext) s.push('break-after: avoid')
        if (a.keepLines) s.push('break-inside: avoid')
        if (a.pageBreakBefore) s.push('break-before: page')
        const domAttrs: any = { style: s.join('; ') }
        if (a.pageBreakBefore) domAttrs.class = 'pm-break-before'
        if (a.outlineLevel) domAttrs['data-outline'] = a.outlineLevel
        return ['p', domAttrs, 0]
      },
      parseDOM: [{
        tag: 'p',
        getAttrs: (dom: HTMLElement) => ({
          align: dom.style.textAlign || '',
          lineHeight: dom.style.lineHeight || '',
          indent: parseInt(dom.style.marginLeft) > 0 && dom.style.marginLeft.endsWith('em') ? Math.max(1, Math.round(parseFloat(dom.style.marginLeft) / 2)) : 0,
          indentLeft: dom.style.marginLeft.endsWith('em') ? parseFloat(dom.style.marginLeft) : (dom.style.marginLeft.endsWith('px') ? Math.round(parseInt(dom.style.marginLeft) / 32) : 0),
          indentRight: dom.style.marginRight.endsWith('em') ? parseFloat(dom.style.marginRight) : (dom.style.marginRight.endsWith('px') ? Math.round(parseInt(dom.style.marginRight) / 32) : 0),
          firstLine: dom.style.textIndent.endsWith('em') && !dom.style.textIndent.startsWith('-') ? parseFloat(dom.style.textIndent) : (dom.style.textIndent.endsWith('px') && !dom.style.textIndent.startsWith('-') ? Math.round(parseInt(dom.style.textIndent) / 32) : 0),
          hanging: dom.style.textIndent.startsWith('-') ? (dom.style.textIndent.endsWith('em') ? parseFloat(dom.style.textIndent.replace('-', '')) : Math.round(parseInt(dom.style.textIndent.replace('-', '')) / 32)) : 0,
          spaceBefore: parseInt(dom.style.marginTop) || 0,
          spaceAfter: parseInt(dom.style.marginBottom) || 0,
          shading: dom.style.backgroundColor || '',
          border: (() => {
            if (dom.style.borderBottom && (dom.style.borderBottom as string).includes('d40000') && (dom.style.borderBottom as string).includes('2px')) return 'redBottom'
            const sides: string[] = []
            if (dom.style.borderTop) sides.push('top')
            if (dom.style.borderRight) sides.push('right')
            if (dom.style.borderBottom) sides.push('bottom')
            if (dom.style.borderLeft) sides.push('left')
            return sides.length ? sides.join(' ') : ''
          })(),
          letterSpacing: dom.style.letterSpacing || '',
          rtl: dom.style.direction === 'rtl',
          outlineLevel: parseInt(dom.getAttribute('data-outline') || '') || 0,
          columnSpan: 0, dropCap: false,
        })
      }]
    },

    // === 标题 ===
    heading: {
      attrs: {
        level: { default: 1, validate: 'number' },
        id: { default: '' },
        align: { default: '' },
        indentLeft: { default: 0 },
        indentRight: { default: 0 },
        firstLine: { default: 0 },
        hanging: { default: 0 },
        spaceBefore: { default: 0 },
        spaceAfter: { default: 0 },
        lineSpacingKind: { default: '' },
        lineSpacingValue: { default: 0 },
        keepLines: { default: false },
        keepWithNext: { default: false },
        pageBreakBefore: { default: false },
        outlineLevel: { default: 0 },
        border: { default: '' },
        shading: { default: '' },
        letterSpacing: { default: '' },
        rtl: { default: false },
        // 命名样式（如 "Heading 1" / "Normal"），用于样式库“当前样式”高亮
        style: { default: '' },
      },
      content: 'inline*',
      group: 'block',
      toDOM: (node) => {
        const a = node.attrs
        const s: string[] = []
        if (a.align) s.push(`text-align: ${a.align}`)
        if (a.lineSpacingKind) {
          const k = a.lineSpacingKind
          if (k === 'single') s.push('line-height: 1')
          else if (k === '1.5') s.push('line-height: 1.5')
          else if (k === 'double') s.push('line-height: 2')
          else if (k === 'multiple') s.push(`line-height: ${a.lineSpacingValue || 1}`)
          else if (k === 'exact' || k === 'atLeast') s.push(`line-height: ${a.lineSpacingValue}pt`)
        }
        if (a.indentLeft) s.push(`margin-left: ${a.indentLeft}px`)
        if (a.indentRight) s.push(`margin-right: ${a.indentRight}px`)
        if (a.firstLine) s.push(`text-indent: ${a.firstLine}px`)
        if (a.hanging) s.push(`text-indent: -${a.hanging}px; margin-left: ${a.hanging}px`)
        if (a.spaceBefore > 0) s.push(`margin-top: ${a.spaceBefore}pt`)
        if (a.spaceAfter > 0) s.push(`margin-bottom: ${a.spaceAfter}pt`)
        if (a.shading) s.push(`background-color: ${a.shading}`)
        if (a.letterSpacing) s.push(`letter-spacing: ${a.letterSpacing}`)
        if (a.rtl) s.push('direction: rtl')
        if (a.keepWithNext) s.push('break-after: avoid')
        if (a.keepLines) s.push('break-inside: avoid')
        if (a.pageBreakBefore) s.push('break-before: page')
        const domAttrs: any = { style: s.join('; ') }
        if (a.pageBreakBefore) domAttrs.class = 'pm-break-before'
        if (a.outlineLevel) domAttrs['data-outline'] = a.outlineLevel
        return ['h' + node.attrs.level, domAttrs, 0]
      },
      parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } }))
    },

    // === 表格（P0 核心） ===
    table: {
      content: 'table_row+',
      group: 'block',
      tableRole: 'table',
      attrs: {
        align: { default: '' },  // '' | 'left' | 'center' | 'right'
      },
      toDOM: (node) => {
        const align = node.attrs.align
        let style = 'border-collapse: collapse; margin: 8px 0'
        let className = 'pm-table'
        if (align === 'center') { style += '; margin-left: auto; margin-right: auto' }
        else if (align === 'right') { style += '; margin-left: auto' }
        else if (align === 'left') { style += '; margin-right: auto' }
        return ['table', { class: className, style, 'data-align': align || 'left' }, 0]
      },
      parseDOM: [{
        tag: 'table',
        getAttrs: (dom: HTMLElement) => ({
          align: dom.getAttribute('data-align') || (dom.style.marginLeft === 'auto' && dom.style.marginRight === 'auto' ? 'center' : ''),
        })
      }]
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
        borderW: { default: 0 },
      },
      toDOM: (node) => {
        const tag = node.attrs.isHeader ? 'th' : 'td'
        const bw = node.attrs.borderW
        const border = bw && bw > 0 ? `${bw}pt solid #cbd5e1` : '1px solid #cbd5e1'
        const s: string[] = [`border: ${border}`, 'padding: 6px 10px', 'vertical-align: top']
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
          borderW: 0,
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
      attrs: { style: { default: '' }, start: { default: 1 } },
      toDOM: (node) => {
        // 参考文献列表渲染为 [1] [2] ... 的序号样式
        if (node.attrs.style === 'references') return ['ol', { class: 'ref-list' }, 0]
        // 中文序号（一、二、三）使用自定义计数器，补上 Word 标准的“、”
        if (node.attrs.style === 'cjk-ideographic') {
          const s = Number(node.attrs.start) || 1
          return ['ol', { class: 'cn-list', style: 'counter-reset: cn ' + (s - 1) }, 0]
        }
        const attrs: any = {}
        if (node.attrs.start && node.attrs.start !== 1) attrs.start = String(node.attrs.start)
        if (node.attrs.style) attrs.style = 'list-style-type: ' + node.attrs.style
        return ['ol', attrs, 0]
      },
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
      attrs: {
        restart: { default: false },     // 从此处分节并重启页码编号
        startNumber: { default: 1 },     // 重启后的起始页码
      },
      toDOM: (node) => {
        const restart = node.attrs.restart ? 'true' : 'false'
        const start = String(node.attrs.startNumber || 1)
        // 标签仅在“显示编辑标记”时可见；默认只保留一条细虚线作为分页位置提示
        return ['div', { class: 'page-break', 'data-page-break': 'true', 'data-restart': restart, 'data-start': start },
          ['span', { class: 'page-break-label' }, node.attrs.restart ? `— 分页并重启页码 (从 ${start}) —` : '— 分页 —']]
      },
      parseDOM: [{
        tag: 'div[data-page-break]',
        getAttrs: (dom: any) => ({
          restart: dom.getAttribute('data-restart') === 'true',
          startNumber: parseInt(dom.getAttribute('data-start') || '1', 10) || 1,
        }),
      }],
    },

    // === 数学公式 ===
    math: {
      group: 'block',
      atom: true,
      isolating: true,
      attrs: {
        latex: { default: '' },
        inline: { default: false },
      },
      toDOM: (node) => {
        const latex = node.attrs.latex || ''
        const wrap = node.attrs.inline ? 'span' : 'div'
        return [wrap, { class: 'sam-math', 'data-latex': latex }, `⟨formula:${latex}⟩`]
      },
      parseDOM: [{
        tag: 'div.sam-math, span.sam-math',
        getAttrs: (dom: any) => ({
          latex: dom.getAttribute('data-latex') || (dom.textContent || '').replace(/^⟨formula:/, '').replace(/⟩$/, ''),
          inline: dom.tagName.toLowerCase() === 'span',
        }),
      }, {
        tag: 'p',
        getAttrs: (dom: any) => {
          const text = dom.textContent || ''
          if (!text.startsWith('⟨formula:')) return false
          return { latex: text.replace(/^⟨formula:/, '').replace(/⟩$/, '') }
        },
      }],
    },

    // === 图片 ===
    image: {
      attrs: {
        src: { validate: 'string' },
        alt: { default: '' },
        title: { default: '' },
        width: { default: 0 },
        height: { default: 0 },
        float: { default: '' },        // '' | 'left' | 'right' | 'center'
        wrap: { default: true },       // text wrap around image
      },
      group: 'block',
      toDOM: (node) => {
        const attrs: any = { src: node.attrs.src, alt: node.attrs.alt, title: node.attrs.title }
        const styles: string[] = []
        styles.push('display: block', 'margin: 0 auto') // 默认居中（学术文档图片通常居中）
        if (node.attrs.width) styles.push(`width: ${node.attrs.width}px`, 'max-width: 100%')
        if (node.attrs.height) styles.push(`height: ${node.attrs.height}px`)
        if (node.attrs.float === 'left') { styles.length = 0; styles.push('float: left', 'margin: 0 16px 8px 0') }
        else if (node.attrs.float === 'right') { styles.length = 0; styles.push('float: right', 'margin: 0 0 8px 16px') }
        attrs.style = styles.join('; ')
        attrs['data-float'] = node.attrs.float || 'none'
        attrs['data-wrap'] = node.attrs.wrap ? 'true' : 'false'
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
          float: dom.getAttribute('data-float') === 'none' ? '' : (dom.getAttribute('data-float') || (dom.style.float as string) || ''),
          wrap: dom.getAttribute('data-wrap') !== 'false',
        })
      }]
    },

    // === 行内图片（OLE .doc 提取的 PICF 内联图片） ===
    // 与 block 的 image 不同：这是 inline 原子节点，可放入段落/标题等
    // inline 上下文，避免把 block 节点塞进段落导致 ProseMirror 校验崩溃。
    inlineImage: {
      group: 'inline',
      inline: true,
      atom: true,
      attrs: {
        src: { default: '' },
        width: { default: 0 },
        height: { default: 0 },
      },
      toDOM: (node) => {
        const attrs: any = { src: node.attrs.src, class: 'sam-inline-image' }
        const styles: string[] = ['display: block', 'margin: 0 auto', 'max-width: 100%']
        if (node.attrs.width) styles.push(`width: ${node.attrs.width}px`)
        if (node.attrs.height) styles.push(`height: ${node.attrs.height}px`)
        attrs.style = styles.join('; ')
        return ['img', attrs]
      },
      parseDOM: [{
        tag: 'img.sam-inline-image',
        getAttrs: (dom: HTMLElement) => ({
          src: dom.getAttribute('src') || '',
          width: parseInt(dom.style.width) || 0,
          height: parseInt(dom.style.height) || 0,
        }),
      }],
    },

    // === 文本框 / 形状（P2） ===
    text_box: {
      content: 'block+',
      group: 'block',
      atom: false,
      attrs: {
        bgColor: { default: '#fef3c7' },
        borderColor: { default: '#f59e0b' },
        shape: { default: 'rect' },     // rect | roundRect | ellipse | triangle | diamond | rightArrow | star5 | heart
        width: { default: 0 },          // 0 = auto
        float: { default: '' },         // '' | 'left' | 'right'
        borderW: { default: 1 },        // 边框线宽 pt
        lineStyle: { default: 'solid' },// solid | dash | dot | dashDot
      },
      toDOM: (node) => {
        const shape = node.attrs.shape || 'rect'
        const bw = node.attrs.borderW || 0
        const ls = node.attrs.lineStyle || 'solid'
        // 线型映射：dash->dashed, dot->dotted, dashDot 无原生值，用 dashed 近似
        const cssLS = ls === 'dot' ? 'dotted' : ls === 'dash' || ls === 'dashDot' ? 'dashed' : 'solid'
        const borderStyle = `${bw}px ${cssLS} ${node.attrs.borderColor}`
        const baseStyle = `background: ${node.attrs.bgColor}; border: ${borderStyle}; padding: 12px 16px; margin: 8px 0; min-width: 120px; min-height: 80px;`
        const shapeStyles: Record<string, string> = {
          rect: 'border-radius: 0;',
          roundRect: 'border-radius: 12px;',
          ellipse: 'border-radius: 50%;',
          triangle: 'border-radius: 0; clip-path: polygon(50% 0, 100% 100%, 0 100%);',
          diamond: 'border-radius: 0; clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);',
          rightArrow: 'border-radius: 0; clip-path: polygon(0 40%, 60% 40%, 60% 15%, 100% 50%, 60% 85%, 60% 60%, 0 60%);',
          star5: 'border-radius: 0; clip-path: polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);',
          heart: 'border-radius: 0; clip-path: path("M50,90 C35,70 0,50 0,25 C0,10 10,0 25,0 C35,0 45,5 50,15 C55,5 65,0 75,0 C90,0 100,10 100,25 C100,50 65,70 50,90 Z");',
        }
        const widthStyle = node.attrs.width > 0 ? ` width: ${node.attrs.width}px;` : ''
        const floatStyle = node.attrs.float === 'left' ? ' float: left; margin-right: 16px;' :
                           node.attrs.float === 'right' ? ' float: right; margin-left: 16px;' : ''
        return ['div', {
          class: 'text-box',
          'data-shape': shape,
          style: baseStyle + ' ' + (shapeStyles[shape] || '') + widthStyle + floatStyle,
        }, 0]
      },
      parseDOM: [{
        tag: 'div.text-box',
        getAttrs: (dom: HTMLElement) => {
          const border = dom.style.border || ''
          const bwMatch = border.match(/^(\d+(?:\.\d+)?)px/)
          const borderW = bwMatch ? parseFloat(bwMatch[1]) : 1
          const bs = dom.style.borderStyle
          const lineStyle = bs === 'dotted' ? 'dot' : (bs === 'dashed' || !bs) ? 'dash' : 'solid'
          return {
            bgColor: dom.style.backgroundColor || '#fef3c7',
            borderColor: dom.style.borderColor || '#f59e0b',
            shape: dom.getAttribute('data-shape') || 'rect',
            width: parseInt(dom.style.width) || 0,
            float: dom.style.float === 'left' ? 'left' : dom.style.float === 'right' ? 'right' : '',
            borderW,
            lineStyle,
          }
        },
      }],
    },

    // === 脚注引用（P1） ===
    footnote: {
      inline: true,
      group: 'inline',
      atom: true,
      attrs: { content: { default: '' }, num: { default: 1 } },
      toDOM: (node) => ['sup', { class: 'footnote-ref', title: node.attrs.content, 'data-footnote-num': node.attrs.num, style: 'color: #4f46e5; cursor: pointer; font-size: 0.7em; vertical-align: super' }, `[${node.attrs.num}]`],
      parseDOM: [{ tag: 'sup.footnote-ref', getAttrs: (dom: HTMLElement) => ({ content: dom.getAttribute('title') || '', num: parseInt(dom.getAttribute('data-footnote-num') || '1') }) }],
    },

    // === 脚注区域（文档底部） ===
    footnote_section: {
      content: 'footnote_item+',
      group: 'block',
      defining: true,
      toDOM: () => ['div', { class: 'footnote-section', style: 'border-top: 1px solid #ccc; margin-top: 32px; padding-top: 8px; font-size: 0.8em; color: #666' }, 0],
      parseDOM: [{ tag: 'div.footnote-section' }],
    },
    footnote_item: {
      content: 'inline*',
      atom: false,
      toDOM: (node) => ['div', { class: 'footnote-item', style: 'margin: 2px 0' },
        ['sup', { class: 'footnote-num', style: 'color: #4f46e5; margin-right: 4px', contenteditable: 'false' }, `${node.attrs.num}.`],
        ['span', { class: 'footnote-body' }, 0]],
      parseDOM: [{ tag: 'div.footnote-item' }],
      attrs: { num: { default: 1 } },
    },

    // === 目录条目（可点击跳转） ===
    tocLink: {
      inline: true, group: 'inline', atom: true,
      attrs: { target: { default: '' }, label: { default: '' } },
      toDOM: (node) => ['span', { class: 'sam-toc-link', 'data-target': node.attrs.target, style: 'color:#1d4ed8;cursor:pointer' }, node.attrs.label],
      parseDOM: [{ tag: 'span.sam-toc-link', getAttrs: (dom: any) => ({ target: dom.getAttribute('data-target') || '', label: dom.textContent || '' }) }],
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
    // 字符间距（字间距）：与字号一样是字符级标记，作用于选区/后续输入
    charSpacing: {
      attrs: { value: { validate: 'string' } }, // 如 "1px" / "0.5pt" / "2px"
      toDOM: (mark) => ['span', { style: `letter-spacing: ${mark.attrs.value}` }, 0],
      parseDOM: [{ tag: 'span[style]', getAttrs: (d: HTMLElement) => d.style.letterSpacing ? { value: d.style.letterSpacing } : false }]
    },
    fontFamily: {
      attrs: { font: { validate: 'string' } },
      // 渲染时追加系统兜底字体链：商业字体（如方正系列）在大多数机器上
      // 未安装，WebView2 会直接 fallback 到默认西文字体导致中文显示异常。
      // 追加 SimSun / Microsoft YaHei / sans-serif 保证中文始终正确渲染。
      toDOM: (mark) => ['span', { style: `font-family: "${mark.attrs.font}", SimSun, "Microsoft YaHei", sans-serif` }, 0],
      parseDOM: [{ tag: 'span[style]', getAttrs: (d: HTMLElement) => d.style.fontFamily ? { font: d.style.fontFamily.split(',')[0].replace(/["']/g, '').trim() } : false }]
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

    // === 艺术字效果（P2） ===
    wordArt: {
      attrs: { style: { default: 'shadow' } }, // shadow | gradient | glow | outline | 3d
      toDOM: (mark) => {
        const s = mark.attrs.style
        const styles: Record<string, string> = {
          shadow: 'text-shadow: 2px 2px 4px rgba(0,0,0,0.4)',
          gradient: 'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text',
          glow: 'text-shadow: 0 0 10px rgba(79,70,229,0.6), 0 0 20px rgba(79,70,229,0.4)',
          outline: '-webkit-text-stroke: 2px #4f46e5; -webkit-text-fill-color: transparent',
          '3d': 'text-shadow: 1px 1px 0 #ccc, 2px 2px 0 #bbb, 3px 3px 0 #aaa, 4px 4px 6px rgba(0,0,0,0.3)',
        }
        return ['span', { class: 'word-art', style: styles[s] || styles.shadow }, 0]
      },
      parseDOM: [{ tag: 'span.word-art', getAttrs: (d: HTMLElement) => ({ style: d.className.split(' ').find(c => c.startsWith('art-'))?.replace('art-','') || 'shadow' }) }]
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
