import { useEffect, useRef, useState } from 'react'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { schema } from './schema'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap, toggleMark, setBlockType, wrapIn } from 'prosemirror-commands'
import { history, undo, redo } from 'prosemirror-history'
import { inputRules, wrappingInputRule, textblockTypeInputRule, InputRule } from 'prosemirror-inputrules'
import { udmToProseMirror, proseMirrorToUDM } from './convert'
import { spellCheckPlugin, setSpellErrors } from './spellPlugin'
import { searchPlugin, doSearch, doReplace, doReplaceAll, nextMatch, prevMatch, getSearchState } from './searchPlugin'
import { mergeCells, splitCell, addRowAfter, addColumnAfter, deleteRow, deleteColumn, setCellAlign } from './tableCommands'
import type { Document, SpellError } from '../../types/udm'

interface Props {
  document: Document
  spellErrors?: SpellError[]
  onChange?: (doc: Document) => void
  onSpellCheck?: (text: string) => void
}

const FONTS = [
  { name: '默认', value: '' },
  { name: '宋体', value: '"Noto Serif SC", "SimSun", serif' },
  { name: '黑体', value: '"Liberation Sans", "SimHei", sans-serif' },
  { name: '楷体', value: '"LXGW WenKai", "KaiTi", cursive' },
  { name: '等宽', value: '"Liberation Mono", "Consolas", monospace' },
]
const FONT_SIZES = [
  { name: '小', value: '12px' }, { name: '正文', value: '15px' },
  { name: '中', value: '18px' }, { name: '大', value: '24px' }, { name: '标题', value: '32px' },
]
const LINE_HEIGHTS = [{ name: '1.0', value: '1.0' }, { name: '1.5', value: '1.5' }, { name: '1.75', value: '1.75' }, { name: '2.0', value: '2.0' }]
const COLORS = ['#000000','#374151','#6B7280','#9CA3AF','#EF4444','#F59E0B','#10B981','#3B82F6','#6366F1','#8B5CF6','#EC4899','#6B7280']
const HL_COLORS = ['#fef08a','#bbf7d0','#bfdbfe','#fbcfe8','#fed7aa','#e9d5ff']

export function DocumentEditor({ document, spellErrors = [], onChange, onSpellCheck }: Props) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onSpellCheckRef = useRef(onSpellCheck)
  onChangeRef.current = onChange
  onSpellCheckRef.current = onSpellCheck

  const [activeMarks, setActiveMarks] = useState<Set<string>>(new Set())
  const [activeAttrs, setActiveAttrs] = useState<any>({})
  const [activeFont, setActiveFont] = useState('')
  const [activeFontSize, setActiveFontSize] = useState('')
  const [activeColor, setActiveColor] = useState('')
  const [, setTick] = useState(0)
  const [focused, setFocused] = useState(false)

  // 查找替换
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [replaceQuery, setReplaceQuery] = useState('')
  const [matchCount, setMatchCount] = useState(0)
  const [activeMatch, setActiveMatch] = useState(-1)

  // 缩放
  const [zoom, setZoom] = useState(100)

  // 修订追踪
  const [trackChanges, setTrackChanges] = useState(false)

  // 打印预览
  const [printPreview, setPrintPreview] = useState(false)

  // 插入面板
  const [showInsertMenu, setShowInsertMenu] = useState(false)

  // 是否在表格内
  const [inTable, setInTable] = useState(false)

  useEffect(() => {
    if (!editorRef.current) return
    const doc = udmToProseMirror(document, schema)
    const state = EditorState.create({
      doc,
      plugins: [
        keymap({
          'Mod-z': undo, 'Mod-y': redo, 'Mod-Shift-z': redo,
          'Mod-b': toggleMark(schema.marks.bold), 'Mod-i': toggleMark(schema.marks.italic), 'Mod-u': toggleMark(schema.marks.underline),
          'Mod-f': () => { setSearchOpen(true); return true },
        }),
        keymap(baseKeymap), history(),
        inputRules({ rules: [
          textblockTypeInputRule(/^#\s$/, schema.nodes.heading, () => ({ level: 1 })),
          textblockTypeInputRule(/^##\s$/, schema.nodes.heading, () => ({ level: 2 })),
          textblockTypeInputRule(/^###\s$/, schema.nodes.heading, () => ({ level: 3 })),
          wrappingInputRule(/^\s*-\s$/, schema.nodes.bullet_list),
          wrappingInputRule(/^\s*\d+\.\s$/, schema.nodes.ordered_list),
          wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote),
          textblockTypeInputRule(/^```\s$/, schema.nodes.code_block),
        ]}),
        spellCheckPlugin(), searchPlugin(),
      ]
    })
    const view = new EditorView(editorRef.current, {
      state,
      dispatchTransaction(tr) {
        const ns = view.state.apply(tr)
        view.updateState(ns)
        if (onChangeRef.current) onChangeRef.current(proseMirrorToUDM(ns.doc))
        if (onSpellCheckRef.current) onSpellCheckRef.current(ns.doc.textContent)
        updateActiveState(ns)
        const ss = getSearchState(view)
        if (ss) { setMatchCount(ss.matches.length); setActiveMatch(ss.activeIndex) }
        // 渲染公式
        setTimeout(() => {
          const el = editorRef.current
          if (el) {
            const w = window as any
            if (w.renderMathInElement) {
              try { w.renderMathInElement(el, { delimiters: [{left: '⟨formula:', right: '⟩', display: true}] }) } catch {}
            }
          }
        }, 50)
      },
      handleDOMEvents: { focus: () => { setFocused(true); return false }, blur: () => { setFocused(false); return false } }
    })
    viewRef.current = view
    // 暴露 view 到全局，方便 E2E 测试和外部调用
    ;(window as any).__pmView = view
    return () => { view.destroy(); viewRef.current = null }
  }, [])

  const updateActiveState = (state: EditorState) => {
    const marks = new Set<string>()
    const { from, $from, to, empty } = state.selection
    const attrs: any = {}
    if ($from.parent.type.name === 'paragraph') {
      Object.assign(attrs, { align: $from.parent.attrs.align, lineHeight: $from.parent.attrs.lineHeight, indent: $from.parent.attrs.indent, border: $from.parent.attrs.border, shading: $from.parent.attrs.shading, rtl: $from.parent.attrs.rtl, letterSpacing: $from.parent.attrs.letterSpacing })
    }
    let f = '', sz = '', c = ''
    const collect = (m: any) => { marks.add(m.type.name); if (m.type.name === 'fontFamily') f = m.attrs.font; if (m.type.name === 'fontSize') sz = m.attrs.size; if (m.type.name === 'textColor') c = m.attrs.color }
    if (empty) { state.storedMarks?.forEach(collect); $from.marks().forEach(collect) }
    else { state.doc.nodesBetween(from, to, (n) => n.marks.forEach(collect)) }
    if ($from.parent.type.name === 'heading') marks.add(`heading-${$from.parent.attrs.level}`)
    // 检测是否在表格内
    let isInTable = false
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === 'table') { isInTable = true; break }
    }
    setInTable(isInTable)
    setActiveMarks(marks); setActiveAttrs(attrs); setActiveFont(f); setActiveFontSize(sz); setActiveColor(c); setTick(t => t + 1)
  }

  const exec = (cmd: string) => {
    const v = viewRef.current; if (!v) return
    const dispatch = (tr: any) => { v.dispatch(tr); v.focus() }
    const sel = v.state.selection
    switch (cmd) {
      case 'bold': toggleMark(schema.marks.bold)(v.state, v.dispatch); break
      case 'italic': toggleMark(schema.marks.italic)(v.state, v.dispatch); break
      case 'underline': toggleMark(schema.marks.underline)(v.state, v.dispatch); break
      case 'strikethrough': toggleMark(schema.marks.strikethrough)(v.state, v.dispatch); break
      case 'superscript': toggleMark(schema.marks.superscript)(v.state, v.dispatch); break
      case 'subscript': toggleMark(schema.marks.subscript)(v.state, v.dispatch); break
      case 'code': toggleMark(schema.marks.code)(v.state, v.dispatch); break
      case 'h1': setBlockType(schema.nodes.heading, { level: 1 })(v.state, v.dispatch); break
      case 'h2': setBlockType(schema.nodes.heading, { level: 2 })(v.state, v.dispatch); break
      case 'h3': setBlockType(schema.nodes.heading, { level: 3 })(v.state, v.dispatch); break
      case 'paragraph': setBlockType(schema.nodes.paragraph)(v.state, v.dispatch); break
      case 'bulletList': wrapIn(schema.nodes.bullet_list)(v.state, v.dispatch); break
      case 'orderedList': wrapIn(schema.nodes.ordered_list)(v.state, v.dispatch); break
      case 'quote': wrapIn(schema.nodes.blockquote)(v.state, v.dispatch); break
      case 'codeBlock': setBlockType(schema.nodes.code_block)(v.state, v.dispatch); break
      case 'undo': undo(v.state, v.dispatch); break
      case 'redo': redo(v.state, v.dispatch); break
      // 插入节点
      case 'pageBreak': dispatch(v.state.tr.replaceSelectionWith(schema.nodes.page_break.create())); break
      case 'horizontalRule': dispatch(v.state.tr.replaceSelectionWith(schema.nodes.horizontal_rule.create())); break
      case 'textBox': {
        const cell = schema.nodes.paragraph.create(null, schema.text('文本框内容'))
        dispatch(v.state.tr.replaceSelectionWith(schema.nodes.text_box.create(null, cell)))
        break
      }
      case 'footnote': {
        const text = prompt('脚注内容：')
        if (text) dispatch(v.state.tr.replaceSelectionWith(schema.nodes.footnote.create({ content: text })))
        break
      }
      case 'bookmark': {
        const name = prompt('书签名称：')
        if (name) dispatch(v.state.tr.replaceSelectionWith(schema.nodes.bookmark.create({ name })))
        break
      }
      case 'comment': {
        const text = prompt('批注内容：')
        if (text && !sel.empty) {
          dispatch(v.state.tr.addMark(sel.from, sel.to, schema.marks.comment_mark.create({ id: Date.now().toString(), author: 'User', text })))
        }
        break
      }
      case 'insertTable': {
        const rows = parseInt(prompt('行数：', '3') || '3')
        const cols = parseInt(prompt('列数：', '3') || '3')
        if (rows > 0 && cols > 0) {
          const tableRows = []
          for (let r = 0; r < rows; r++) {
            const cells = []
            for (let c = 0; c < cols; c++) {
              const para = schema.nodes.paragraph.create(null, schema.text(r === 0 ? `列${c+1}` : ''))
              cells.push(schema.nodes.table_cell.create({ isHeader: r === 0 }, para))
            }
            tableRows.push(schema.nodes.table_row.create(null, cells))
          }
          const table = schema.nodes.table.create(null, tableRows)
          dispatch(v.state.tr.replaceSelectionWith(table))
        }
        break
      }
      // 段落属性
      case 'dropCap': setParaAttr('dropCap', !activeAttrs.dropCap); break
      case 'toggleRTL': setParaAttr('rtl', !activeAttrs.rtl); break
    }
    v.focus()
  }

  const setParaAttr = (attr: string, value: any) => {
    const v = viewRef.current; if (!v) return
    const { $from } = v.state.selection
    if ($from.parent.type.name !== 'paragraph') return
    const tr = v.state.tr.setNodeMarkup($from.before(), undefined, { ...$from.parent.attrs, [attr]: value })
    v.dispatch(tr); v.focus()
  }

  const setFont = (font: string) => { const v = viewRef.current; if (!v) return; if (font) toggleMark(schema.marks.fontFamily, { font })(v.state, v.dispatch); else { const tr = v.state.tr.removeMark(v.state.selection.from, v.state.selection.to, schema.marks.fontFamily); v.dispatch(tr) } v.focus() }
  const setFontSize = (size: string) => { const v = viewRef.current; if (!v) return; toggleMark(schema.marks.fontSize, { size })(v.state, v.dispatch); v.focus() }
  const setTextColor = (color: string) => { const v = viewRef.current; if (!v) return; toggleMark(schema.marks.textColor, { color })(v.state, v.dispatch); v.focus() }
  const setHighlight = (color: string) => { const v = viewRef.current; if (!v) return; toggleMark(schema.marks.highlight, { color })(v.state, v.dispatch); v.focus() }

  // 查找替换
  const handleSearch = () => { const v = viewRef.current; if (!v || !searchQuery) return; doSearch(v, searchQuery, false) }
  const handleReplace = () => { const v = viewRef.current; if (!v) return; doReplace(v, searchQuery, replaceQuery, false) }
  const handleReplaceAll = () => { const v = viewRef.current; if (!v) return; doReplaceAll(v, searchQuery, replaceQuery, false) }
  const handleNext = () => { const v = viewRef.current; if (!v) return; nextMatch(v) }
  const handlePrev = () => { const v = viewRef.current; if (!v) return; prevMatch(v) }

  // 打印
  const handlePrint = () => {
    setPrintPreview(false)
    setTimeout(() => window.print(), 100)
  }

  // 公式插入 - 用 KaTeX 渲染
  const insertFormula = () => {
    const formula = prompt('输入 LaTeX 公式（如：E=mc^2, \\frac{1}{2}, \\sum_{i=1}^{n}i）:')
    if (formula) {
      const v = viewRef.current; if (!v) return
      // 用 KaTeX 渲染为 HTML，作为特殊段落
      let html = ''
      try {
        const w = window as any
        if (w.katex) {
          html = w.katex.renderToString(formula, { displayMode: true, throwOnError: false })
        } else {
          html = `<span style="font-style:italic">${formula}</span>`
        }
      } catch {
        html = `<span style="font-style:italic">${formula}</span>`
      }
      // 创建包含公式 HTML 的段落
      const para = schema.nodes.paragraph.create({ align: 'center' }, schema.text(`⟨formula:${formula}⟩`))
      v.dispatch(v.state.tr.replaceSelectionWith(para))
      v.focus()
      // 后续渲染：用 KaTeX 渲染所有 ⟨formula:...⟩ 标记
      setTimeout(() => renderFormulas(), 100)
    }
  }

  // 渲染文档中的所有公式
  const renderFormulas = () => {
    const el = editorRef.current as any
    if (!el) return
    const w = window as any
    if (!w.katex) return
    // 查找所有包含 ⟨formula:...⟩ 的文本
    const doc = el.ownerDocument as any
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT, null)
    const nodes: Text[] = []
    let node
    while (node = walker.nextNode()) {
      if (node.textContent && node.textContent.includes('⟨formula:')) {
        nodes.push(node as Text)
      }
    }
    nodes.forEach(textNode => {
      const text = textNode.textContent || ''
      const match = text.match(/⟨formula:(.+?)⟩/)
      if (match) {
        const formula = match[1]
        const span = doc.createElement('span')
        span.className = 'formula-display'
        span.style.textAlign = 'center'
        span.style.margin = '12px 0'
        try {
          w.katex.render(formula, span, { displayMode: true, throwOnError: false })
        } catch {
          span.textContent = formula
        }
        textNode.parentNode?.replaceChild(span, textNode)
      }
    })
  }

  // 艺术字
  const insertWordArt = () => {
    const text = prompt('艺术字内容：')
    if (text) {
      const v = viewRef.current; if (!v) return
      const run = schema.text(text, [
        schema.marks.bold.create(),
        schema.marks.fontSize.create({ size: '36px' }),
        schema.marks.textColor.create({ color: '#4f46e5' }),
      ])
      const para = schema.nodes.paragraph.create({ align: 'center' }, run)
      v.dispatch(v.state.tr.replaceSelectionWith(para))
      v.focus()
    }
  }

  // 水印
  const [watermark, setWatermark] = useState('')
  const applyWatermark = () => {
    const wm = prompt('水印文字：', watermark)
    if (wm !== null) setWatermark(wm)
  }

  const Btn = ({ cmd, icon, title, active, group }: any) => (
    <>
      <button onClick={() => exec(cmd)} className={`toolbar-btn ${active ? 'active' : ''}`} title={title} type="button">{icon}</button>
      {group && <div className="toolbar-divider" />}
    </>
  )

  useEffect(() => {
    if (viewRef.current) {
      const v = viewRef.current
      v.dispatch(setSpellErrors(v.state.tr, spellErrors))
      v.updateState(v.state)
      setTick(t => t + 1)
    }
  }, [spellErrors])

  return (
    <div className="flex flex-col h-full">
      {/* 查找替换栏 */}
      {searchOpen && (
        <div className="px-3 py-2 flex items-center gap-2 flex-wrap" style={{ background: 'var(--color-bg-alt)', borderBottom: '1px solid var(--color-border)' }}>
          <input type="text" placeholder="查找..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} className="text-sm" style={{ width: 150 }} />
          <button onClick={handleSearch} className="btn btn-outline btn-sm">查找</button>
          <button onClick={handlePrev} className="btn btn-ghost btn-sm" disabled={matchCount === 0}>↑</button>
          <button onClick={handleNext} className="btn btn-ghost btn-sm" disabled={matchCount === 0}>↓</button>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{matchCount > 0 ? `${activeMatch + 1}/${matchCount}` : '无匹配'}</span>
          <div className="toolbar-divider" />
          <input type="text" placeholder="替换..." value={replaceQuery} onChange={e => setReplaceQuery(e.target.value)} className="text-sm" style={{ width: 150 }} />
          <button onClick={handleReplace} className="btn btn-outline btn-sm" disabled={matchCount === 0}>替换</button>
          <button onClick={handleReplaceAll} className="btn btn-primary btn-sm" disabled={matchCount === 0}>全部替换</button>
          <div className="flex-1" />
          <button onClick={() => { setSearchOpen(false); setSearchQuery(''); doSearch(viewRef.current!, '', false) }} className="btn btn-ghost btn-sm">✕</button>
        </div>
      )}

      {/* 工具栏第一行：字体/字号/颜色/排版 */}
      <div className="px-2 py-1 flex items-center gap-1 flex-wrap flex-shrink-0" style={{ background: focused ? 'var(--color-surface)' : 'var(--color-surface-alt)', borderBottom: '1px solid var(--color-border)' }}>
        <select value={activeFont} onChange={e => setFont(e.target.value)} className="text-xs rounded px-1 py-0.5" style={{ width: 90, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }} title="字体">
          {FONTS.map(f => <option key={f.value} value={f.value}>{f.name}</option>)}
        </select>
        <select value={activeFontSize} onChange={e => setFontSize(e.target.value)} className="text-xs rounded px-1 py-0.5" style={{ width: 60, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }} title="字号">
          <option value="">默认</option>
          {FONT_SIZES.map(s => <option key={s.value} value={s.value}>{s.name}</option>)}
        </select>
        {/* 文字颜色 */}
        <div className="relative group">
          <button className="toolbar-btn" title="文字颜色" type="button" style={{ borderBottom: `3px solid ${activeColor || '#333'}` }}>A</button>
          <div className="absolute top-full left-0 hidden group-hover:block z-20 p-2 rounded-lg shadow-lg" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="grid grid-cols-6 gap-1">{COLORS.map(c => <button key={c} onClick={() => setTextColor(c)} className="w-5 h-5 rounded border" style={{ background: c, border: '1px solid var(--color-border)' }} type="button" />)}</div>
          </div>
        </div>
        {/* 高亮 */}
        <div className="relative group">
          <button className="toolbar-btn" title="高亮" type="button" style={{ background: 'linear-gradient(180deg, transparent 60%, #fef08a 60%)' }}>H</button>
          <div className="absolute top-full left-0 hidden group-hover:block z-20 p-2 rounded-lg shadow-lg" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="grid grid-cols-6 gap-1">{HL_COLORS.map(c => <button key={c} onClick={() => setHighlight(c)} className="w-5 h-5 rounded border" style={{ background: c, border: '1px solid var(--color-border)' }} type="button" />)}</div>
          </div>
        </div>
        <div className="toolbar-divider" />
        {/* 对齐 */}
        <button onClick={() => setParaAttr('align', 'left')} className={`toolbar-btn ${activeAttrs.align === 'left' ? 'active' : ''}`} title="左对齐" type="button">⬅</button>
        <button onClick={() => setParaAttr('align', 'center')} className={`toolbar-btn ${activeAttrs.align === 'center' ? 'active' : ''}`} title="居中" type="button">⬌</button>
        <button onClick={() => setParaAttr('align', 'right')} className={`toolbar-btn ${activeAttrs.align === 'right' ? 'active' : ''}`} title="右对齐" type="button">➡</button>
        <button onClick={() => setParaAttr('align', 'justify')} className={`toolbar-btn ${activeAttrs.align === 'justify' ? 'active' : ''}`} title="两端对齐" type="button">☰</button>
        <div className="toolbar-divider" />
        {/* 行距 */}
        <select value={activeAttrs.lineHeight || ''} onChange={e => setParaAttr('lineHeight', e.target.value)} className="text-xs rounded px-1 py-0.5" style={{ width: 55, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }} title="行距">
          <option value="">行距</option>
          {LINE_HEIGHTS.map(l => <option key={l.value} value={l.value}>{l.name}</option>)}
        </select>
        {/* 缩进 */}
        <button onClick={() => setParaAttr('indent', Math.min(8, (activeAttrs.indent || 0) + 1))} className="toolbar-btn" title="增加缩进" type="button">→|</button>
        <button onClick={() => setParaAttr('indent', Math.max(0, (activeAttrs.indent || 0) - 1))} className="toolbar-btn" title="减少缩进" type="button">|←</button>
        <div className="toolbar-divider" />
        {/* 段落边框/底纹 */}
        <button onClick={() => setParaAttr('border', activeAttrs.border === 'all' ? '' : 'all')} className={`toolbar-btn ${activeAttrs.border === 'all' ? 'active' : ''}`} title="段落边框" type="button">▢</button>
        <button onClick={() => setParaAttr('border', activeAttrs.border === 'left' ? '' : 'left')} className={`toolbar-btn ${activeAttrs.border === 'left' ? 'active' : ''}`} title="左边框" type="button">▏</button>
        <div className="relative group">
          <button className="toolbar-btn" title="段落底纹" type="button" style={{ background: activeAttrs.shading || 'transparent' }}>▦</button>
          <div className="absolute top-full left-0 hidden group-hover:block z-20 p-2 rounded-lg shadow-lg" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="grid grid-cols-6 gap-1">
              {['','#f1f5f9','#fef3c7','#dbeafe','#dcfce7','#fce7f3'].map(c => <button key={c} onClick={() => setParaAttr('shading', c)} className="w-5 h-5 rounded border" style={{ background: c || 'white', border: '1px solid var(--color-border)' }} type="button" />)}
            </div>
          </div>
        </div>
        {/* 字间距 */}
        <select value={activeAttrs.letterSpacing || ''} onChange={e => setParaAttr('letterSpacing', e.target.value)} className="text-xs rounded px-1 py-0.5" style={{ width: 50, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }} title="字间距">
          <option value="">间距</option>
          <option value="0.5px">松</option>
          <option value="1px">更松</option>
          <option value="-0.5px">紧</option>
        </select>
        {/* RTL */}
        <button onClick={() => exec('toggleRTL')} className={`toolbar-btn ${activeAttrs.rtl ? 'active' : ''}`} title="RTL 文字方向" type="button">⇄</button>
      </div>

      {/* 工具栏第二行：段落/样式/列表/插入 */}
      <div className="px-2 py-1 flex items-center gap-0.5 flex-wrap flex-shrink-0" style={{ background: focused ? 'var(--color-surface)' : 'var(--color-surface-alt)', borderBottom: '1px solid var(--color-border)', boxShadow: focused ? 'var(--shadow-sm)' : 'none' }}>
        <Btn cmd="undo" icon="↶" title="撤销 (Ctrl+Z)" group />
        <Btn cmd="redo" icon="↷" title="重做 (Ctrl+Y)" group />
        <Btn cmd="paragraph" icon="¶" title="正文段落" active={activeMarks.size === 0 || (activeMarks.size === 1 && !Array.from(activeMarks).some(m => m.startsWith('heading')))} />
        <Btn cmd="h1" icon={<b style={{fontSize:12}}>H1</b>} title="一级标题" active={activeMarks.has('heading-1')} />
        <Btn cmd="h2" icon={<b style={{fontSize:11}}>H2</b>} title="二级标题" active={activeMarks.has('heading-2')} />
        <Btn cmd="h3" icon={<b style={{fontSize:10}}>H3</b>} title="三级标题" active={activeMarks.has('heading-3')} group />
        <Btn cmd="bold" icon={<b style={{fontSize:13}}>B</b>} title="加粗" active={activeMarks.has('bold')} />
        <Btn cmd="italic" icon={<i style={{fontSize:13}}>I</i>} title="斜体" active={activeMarks.has('italic')} />
        <Btn cmd="underline" icon={<u style={{fontSize:13}}>U</u>} title="下划线" active={activeMarks.has('underline')} />
        <Btn cmd="strikethrough" icon={<s style={{fontSize:13}}>S</s>} title="删除线" active={activeMarks.has('strikethrough')} />
        <Btn cmd="superscript" icon={<span style={{fontSize:10,verticalAlign:'super'}}>X²</span>} title="上标" active={activeMarks.has('superscript')} />
        <Btn cmd="subscript" icon={<span style={{fontSize:10,verticalAlign:'sub'}}>X₂</span>} title="下标" active={activeMarks.has('subscript')} />
        <Btn cmd="code" icon={<span style={{fontSize:10,fontFamily:'monospace'}}>{'</>'}</span>} title="行内代码" active={activeMarks.has('code')} group />
        <Btn cmd="bulletList" icon="•" title="无序列表" />
        <Btn cmd="orderedList" icon={<b style={{fontSize:11}}>1.</b>} title="有序列表" />
        <Btn cmd="quote" icon="❝" title="引用" />
        <Btn cmd="codeBlock" icon={<span style={{fontSize:10,fontFamily:'monospace'}}>{'{}'}</span>} title="代码块" />
        <Btn cmd="horizontalRule" icon="—" title="水平线" />
        <Btn cmd="pageBreak" icon="⏎" title="分页符" group />

        {/* 插入菜单 */}
        <div className="relative">
          <button onClick={() => setShowInsertMenu(!showInsertMenu)} className="toolbar-btn" title="插入" type="button">+</button>
          {showInsertMenu && (
            <div className="absolute top-full left-0 z-30 py-1 rounded-lg shadow-lg animate-fade-in" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', minWidth: 180 }}>
              <button onClick={() => { exec('insertTable'); setShowInsertMenu(false) }} className="block w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>📊 表格</button>
              <button onClick={() => { exec('textBox'); setShowInsertMenu(false) }} className="block w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>📦 文本框</button>
              <button onClick={() => { insertWordArt(); setShowInsertMenu(false) }} className="block w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>🎨 艺术字</button>
              <button onClick={() => { insertFormula(); setShowInsertMenu(false) }} className="block w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>Σ 公式</button>
              <button onClick={() => { exec('footnote'); setShowInsertMenu(false) }} className="block w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>📝 脚注</button>
              <button onClick={() => { exec('bookmark'); setShowInsertMenu(false) }} className="block w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>⚓ 书签</button>
              <button onClick={() => { exec('comment'); setShowInsertMenu(false) }} className="block w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>💬 批注</button>
              <button onClick={() => { exec('dropCap'); setShowInsertMenu(false) }} className="block w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>🅰 首字下沉</button>
              <button onClick={() => { applyWatermark(); setShowInsertMenu(false) }} className="block w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>💧 水印</button>
            </div>
          )}
        </div>

        <div className="flex-1" />

        {/* 查找 */}
        <button onClick={() => setSearchOpen(!searchOpen)} className="toolbar-btn" title="查找替换 (Ctrl+F)" type="button">🔍</button>
        {/* 修订追踪 */}
        <button onClick={() => setTrackChanges(!trackChanges)} className={`toolbar-btn ${trackChanges ? 'active' : ''}`} title="修订追踪" type="button">✏️</button>
        {/* 缩放 */}
        <select value={zoom} onChange={e => setZoom(parseInt(e.target.value))} className="text-xs rounded px-1 py-0.5" style={{ width: 60, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }} title="缩放">
          <option value={50}>50%</option>
          <option value={75}>75%</option>
          <option value={100}>100%</option>
          <option value={125}>125%</option>
          <option value={150}>150%</option>
        </select>
        {/* 打印 */}
        <button onClick={() => setPrintPreview(!printPreview)} className="toolbar-btn" title="打印预览" type="button">🖨</button>
      </div>

      {/* 水印层 */}
      {watermark && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%) rotate(-30deg)', fontSize: '72px', color: 'rgba(0,0,0,0.08)', pointerEvents: 'none', zIndex: 5, whiteSpace: 'nowrap' }}>
          {watermark}
        </div>
      )}

      {/* 表格操作栏（仅光标在表格内时显示） */}
      {inTable && (
        <div className="px-2 py-1 flex items-center gap-0.5 flex-wrap flex-shrink-0 animate-fade-in" style={{ background: 'var(--color-primary-light)', borderBottom: '1px solid var(--color-border)' }}>
          <span className="text-xs font-medium px-2" style={{ color: 'var(--color-primary)' }}>表格</span>
          <button onClick={() => mergeCells(viewRef.current!.state, viewRef.current!.dispatch)} className="toolbar-btn" title="合并单元格" type="button">⊟</button>
          <button onClick={() => splitCell(viewRef.current!.state, viewRef.current!.dispatch)} className="toolbar-btn" title="拆分单元格" type="button">⊞</button>
          <div className="toolbar-divider" />
          <button onClick={() => addRowAfter(viewRef.current!.state, viewRef.current!.dispatch)} className="toolbar-btn" title="下方添加行" type="button">↧+</button>
          <button onClick={() => addColumnAfter(viewRef.current!.state, viewRef.current!.dispatch)} className="toolbar-btn" title="右侧添加列" type="button">↦+</button>
          <button onClick={() => deleteRow(viewRef.current!.state, viewRef.current!.dispatch)} className="toolbar-btn" title="删除行" type="button">↧✕</button>
          <button onClick={() => deleteColumn(viewRef.current!.state, viewRef.current!.dispatch)} className="toolbar-btn" title="删除列" type="button">↦✕</button>
          <div className="toolbar-divider" />
          <button onClick={() => setCellAlign(viewRef.current!.state, viewRef.current!.dispatch, 'left')} className="toolbar-btn" title="单元格左对齐" type="button">⬅</button>
          <button onClick={() => setCellAlign(viewRef.current!.state, viewRef.current!.dispatch, 'center')} className="toolbar-btn" title="单元格居中" type="button">⬌</button>
          <button onClick={() => setCellAlign(viewRef.current!.state, viewRef.current!.dispatch, 'right')} className="toolbar-btn" title="单元格右对齐" type="button">➡</button>
        </div>
      )}

      {/* 编辑区（支持缩放） */}
      <div className="flex-1 overflow-auto" style={{ zoom: `${zoom}%` }} ref={editorRef as any} />

      {/* 打印预览 */}
      {printPreview && (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'rgba(15,23,42,0.9)' }}>
          <div className="flex items-center gap-2 px-4 py-2 text-white">
            <span className="font-semibold">打印预览</span>
            <div className="flex-1" />
            <button onClick={handlePrint} className="btn btn-primary btn-sm">🖨 打印</button>
            <button onClick={() => setPrintPreview(false)} className="btn btn-ghost btn-sm" style={{ color: 'white' }}>✕ 关闭</button>
          </div>
          <div className="flex-1 overflow-auto p-8 flex justify-center">
            <div className="bg-white shadow-2xl" style={{ width: '210mm', minHeight: '297mm', padding: '20mm' }}>
              <div ref={editorRef as any} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
