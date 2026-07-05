import { useEffect, useRef, useState } from 'react'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { schema } from './schema'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap, toggleMark, setBlockType, wrapIn } from 'prosemirror-commands'
import { history, undo, redo } from 'prosemirror-history'
import { inputRules, wrappingInputRule, textblockTypeInputRule } from 'prosemirror-inputrules'
import { udmToProseMirror, proseMirrorToUDM } from './convert'
import { spellCheckPlugin, setSpellErrors } from './spellPlugin'
import { searchPlugin, doSearch, doReplace, doReplaceAll, nextMatch, prevMatch, getSearchState } from './searchPlugin'
import { mergeCells, splitCell, addRowAfter, addColumnAfter, deleteRow, deleteColumn, setCellAlign } from './tableCommands'
import { useI18n } from '../../i18n'
import type { Document, SpellError } from '../../types/udm'

interface Props {
  document: Document
  spellErrors?: SpellError[]
  onChange?: (doc: Document) => void
  onSpellCheck?: (text: string) => void
}

type RibbonTab = 'home' | 'insert' | 'layout' | 'review' | 'view'

const LINE_HEIGHTS = [{ name: '1.0', value: '1.0' }, { name: '1.5', value: '1.5' }, { name: '1.75', value: '1.75' }, { name: '2.0', value: '2.0' }]
const COLORS = ['#000000','#374151','#6B7280','#9CA3AF','#EF4444','#F59E0B','#10B981','#3B82F6','#6366F1','#8B5CF6','#EC4899','#6B7280']
const HL_COLORS = ['#fef08a','#bbf7d0','#bfdbfe','#fbcfe8','#fed7aa','#e9d5ff']

function RibbonButton({ icon, label, onClick, active, disabled, title }: any) {
  return (
    <button onClick={onClick} disabled={disabled} title={title || label}
      className="flex flex-col items-center justify-center gap-0.5 px-2.5 py-1 rounded-md transition-colors min-w-[48px] disabled:opacity-40"
      style={{ background: active ? 'var(--color-primary-light)' : 'transparent', color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}
      onMouseEnter={e => { if (!disabled && !active) e.currentTarget.style.background = 'var(--color-bg-alt)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}>
      <span style={{ fontSize: '16px', lineHeight: 1 }}>{icon}</span>
      <span style={{ fontSize: '10px', fontWeight: 500 }}>{label}</span>
    </button>
  )
}

function RibbonGroup({ label, children }: any) {
  return (
    <div className="flex flex-col items-center px-2 border-r" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex items-center gap-0.5 py-1 flex-1">{children}</div>
      <div className="text-[10px] font-medium pb-0.5" style={{ color: 'var(--color-text-muted)' }}>{label}</div>
    </div>
  )
}

export function DocumentEditor({ document, spellErrors = [], onChange, onSpellCheck }: Props) {
  const { t } = useI18n()

  const FONTS = [
    { name: t('doc.font.default'), value: '' },
    { name: t('doc.font.songti'), value: '"Noto Serif SC", "SimSun", serif' },
    { name: t('doc.font.heiti'), value: '"Liberation Sans", "SimHei", sans-serif' },
    { name: t('doc.font.kaiti'), value: '"LXGW WenKai", "KaiTi", cursive' },
    { name: t('doc.font.mono'), value: '"Liberation Mono", "Consolas", monospace' },
  ]
  const FONT_SIZES = [
    { name: t('doc.size.small'), value: '12px' }, { name: t('doc.size.body'), value: '15px' },
    { name: t('doc.size.medium'), value: '18px' }, { name: t('doc.size.large'), value: '24px' }, { name: t('doc.size.heading'), value: '32px' },
  ]

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
  const [ribbonTab, setRibbonTab] = useState<RibbonTab>('home')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [replaceQuery, setReplaceQuery] = useState('')
  const [matchCount, setMatchCount] = useState(0)
  const [activeMatch, setActiveMatch] = useState(-1)
  const [zoom, setZoom] = useState(100)
  const [trackChanges, setTrackChanges] = useState(false)
  const [printPreview, setPrintPreview] = useState(false)
  const [inTable, setInTable] = useState(false)
  const [watermark, setWatermark] = useState('')
  const [showMiniToolbar, setShowMiniToolbar] = useState(false)
  const [miniToolbarPos, setMiniToolbarPos] = useState({ x: 0, y: 0 })
  const [showContextMenu, setShowContextMenu] = useState(false)
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 })
  const [showShapePanel, setShowShapePanel] = useState(false)
  const [showArtPanel, setShowArtPanel] = useState(false)

  useEffect(() => {
    if (!editorRef.current) return
    const doc = udmToProseMirror(document, schema)
    const state = EditorState.create({
      doc,
      plugins: [
        keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Mod-Shift-z': redo, 'Mod-b': toggleMark(schema.marks.bold), 'Mod-i': toggleMark(schema.marks.italic), 'Mod-u': toggleMark(schema.marks.underline), 'Mod-f': () => { setSearchOpen(true); return true } }),
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
        const ns = view.state.apply(tr); view.updateState(ns)
        if (onChangeRef.current) onChangeRef.current(proseMirrorToUDM(ns.doc))
        if (onSpellCheckRef.current) onSpellCheckRef.current(ns.doc.textContent)
        updateActiveState(ns)
        const ss = getSearchState(view); if (ss) { setMatchCount(ss.matches.length); setActiveMatch(ss.activeIndex) }
      },
      handleDOMEvents: {
        focus: () => { setFocused(true); return false },
        blur: () => { setFocused(false); return false },
        mouseup: (view: any, e: any) => {
          const v = viewRef.current
          if (v && !v.state.selection.empty) { setShowMiniToolbar(true); setMiniToolbarPos({ x: e.clientX, y: e.clientY - 50 }) }
          else { setShowMiniToolbar(false) }
          return false
        },
        contextmenu: (view: any, e: any) => { e.preventDefault(); setShowContextMenu(true); setContextMenuPos({ x: e.clientX, y: e.clientY }); return false },
      }
    })
    viewRef.current = view; ;(window as any).__pmView = view
    return () => { view.destroy(); viewRef.current = null }
  }, [])

  const updateActiveState = (state: EditorState) => {
    const marks = new Set<string>()
    const { from, $from, to, empty } = state.selection
    const attrs: any = {}
    if ($from.parent.type.name === 'paragraph') { Object.assign(attrs, { align: $from.parent.attrs.align, lineHeight: $from.parent.attrs.lineHeight, indent: $from.parent.attrs.indent, border: $from.parent.attrs.border, shading: $from.parent.attrs.shading, rtl: $from.parent.attrs.rtl, letterSpacing: $from.parent.attrs.letterSpacing, dropCap: $from.parent.attrs.dropCap }) }
    let f = '', sz = '', c = ''
    const collect = (m: any) => { marks.add(m.type.name); if (m.type.name === 'fontFamily') f = m.attrs.font; if (m.type.name === 'fontSize') sz = m.attrs.size; if (m.type.name === 'textColor') c = m.attrs.color }
    if (empty) { state.storedMarks?.forEach(collect); $from.marks().forEach(collect) } else { state.doc.nodesBetween(from, to, (n) => n.marks.forEach(collect)) }
    if ($from.parent.type.name === 'heading') marks.add(`heading-${$from.parent.attrs.level}`)
    let isInTable = false
    for (let d = $from.depth; d > 0; d--) { if ($from.node(d).type.name === 'table') { isInTable = true; break } }
    setInTable(isInTable); setActiveMarks(marks); setActiveAttrs(attrs); setActiveFont(f); setActiveFontSize(sz); setActiveColor(c); setTick(t => t + 1)
  }

  const exec = (cmd: string) => {
    const v = viewRef.current; if (!v) return; const sel = v.state.selection
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
      case 'pageBreak': v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.page_break.create())); break
      case 'horizontalRule': v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.horizontal_rule.create())); break
      case 'textBox': { const cell = schema.nodes.paragraph.create(null, schema.text(t('doc.textBoxDefault'))); v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.text_box.create(null, cell))); break }
      case 'footnote': { const text = prompt(t('doc.prompt.footnote')); if (text) v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.footnote.create({ content: text }))); break }
      case 'bookmark': { const name = prompt(t('doc.prompt.bookmark')); if (name) v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.bookmark.create({ name }))); break }
      case 'comment': { const text = prompt(t('doc.prompt.comment')); if (text && !sel.empty) v.dispatch(v.state.tr.addMark(sel.from, sel.to, schema.marks.comment_mark.create({ id: Date.now().toString(), author: 'User', text }))); break }
      case 'insertTable': { const rows = parseInt(prompt(t('doc.prompt.rows'), '3') || '3'); const cols = parseInt(prompt(t('doc.prompt.cols'), '3') || '3'); if (rows > 0 && cols > 0) { const tr = []; for (let r = 0; r < rows; r++) { const cells = []; for (let c = 0; c < cols; c++) { cells.push(schema.nodes.table_cell.create({ isHeader: r === 0 }, schema.nodes.paragraph.create(null, schema.text(r === 0 ? `列${c+1}` : '')))) } tr.push(schema.nodes.table_row.create(null, cells)) } v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.table.create(null, tr))) } break }
      case 'dropCap': setParaAttr('dropCap', !activeAttrs.dropCap); break
      case 'toggleRTL': setParaAttr('rtl', !activeAttrs.rtl); break
    }
    v.focus(); setShowMiniToolbar(false); setShowContextMenu(false)
  }

  const setParaAttr = (attr: string, value: any) => { const v = viewRef.current; if (!v) return; const { $from } = v.state.selection; if ($from.parent.type.name !== 'paragraph') return; v.dispatch(v.state.tr.setNodeMarkup($from.before(), undefined, { ...$from.parent.attrs, [attr]: value })); v.focus() }
  const setFont = (font: string) => { const v = viewRef.current; if (!v) return; if (font) toggleMark(schema.marks.fontFamily, { font })(v.state, v.dispatch); else v.dispatch(v.state.tr.removeMark(v.state.selection.from, v.state.selection.to, schema.marks.fontFamily)); v.focus() }
  const setFontSize = (size: string) => { const v = viewRef.current; if (!v) return; toggleMark(schema.marks.fontSize, { size })(v.state, v.dispatch); v.focus() }
  const setTextColor = (color: string) => { const v = viewRef.current; if (!v) return; toggleMark(schema.marks.textColor, { color })(v.state, v.dispatch); v.focus() }
  const setHighlight = (color: string) => { const v = viewRef.current; if (!v) return; toggleMark(schema.marks.highlight, { color })(v.state, v.dispatch); v.focus() }
  const handleSearch = () => { const v = viewRef.current; if (!v || !searchQuery) return; doSearch(v, searchQuery, false) }
  const handleReplace = () => { const v = viewRef.current; if (!v) return; doReplace(v, searchQuery, replaceQuery, false) }
  const handleReplaceAll = () => { const v = viewRef.current; if (!v) return; doReplaceAll(v, searchQuery, replaceQuery, false) }
  const handlePrint = () => { setPrintPreview(false); setTimeout(() => window.print(), 100) }
  const insertFormula = () => { const formula = prompt(t('doc.prompt.latex')); if (formula) { const v = viewRef.current; if (!v) return; v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.paragraph.create({ align: 'center' }, schema.text(`⟨formula:${formula}⟩`)))); v.focus() } }
  const insertWordArt = () => { const text = prompt(t('doc.prompt.wordArt')); if (text) { const v = viewRef.current; if (!v) return; v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.paragraph.create({ align: 'center' }, schema.text(text, [schema.marks.bold.create(), schema.marks.fontSize.create({ size: '36px' }), schema.marks.textColor.create({ color: '#4f46e5' })])))); v.focus() } }
  const applyWatermark = () => { const wm = prompt(t('doc.prompt.watermark'), watermark); if (wm !== null) setWatermark(wm) }
  const insertImage = () => { const input = (document as any).createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.onchange = () => { const f = input.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => { const v = viewRef.current; if (!v) return; v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.image.create({ src: r.result as string }))); v.focus() }; r.readAsDataURL(f) }; input.click() }
  const insertLink = () => { const url = prompt('URL:'); if (url) { const v = viewRef.current; if (!v) return; const sel = v.state.selection; if (!sel.empty) v.dispatch(v.state.tr.addMark(sel.from, sel.to, schema.marks.link.create({ href: url }))) } }

  useEffect(() => { if (viewRef.current) { const v = viewRef.current; v.dispatch(setSpellErrors(v.state.tr, spellErrors)); v.updateState(v.state); setTick(t => t + 1) } }, [spellErrors])

  const ribbonTabs: { id: RibbonTab; label: string }[] = [
    { id: 'home', label: t('doc.ribbon.home') }, { id: 'insert', label: t('doc.ribbon.insert') }, { id: 'layout', label: t('doc.ribbon.layout') }, { id: 'review', label: t('doc.ribbon.review') }, { id: 'view', label: t('doc.ribbon.view') },
  ]

  return (
    <div className="flex flex-col h-full">
      {searchOpen && (
        <div className="px-3 py-2 flex items-center gap-2 flex-wrap animate-fade-in" style={{ background: 'var(--color-bg-alt)', borderBottom: '1px solid var(--color-border)' }}>
          <input type="text" placeholder={t('doc.findPlaceholder')} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} className="text-sm" style={{ width: 160 }} />
          <button onClick={handleSearch} className="btn btn-outline btn-sm">{t('doc.find')}</button>
          <button onClick={prevMatch} className="btn btn-ghost btn-sm" disabled={matchCount === 0}>↑</button>
          <button onClick={nextMatch} className="btn btn-ghost btn-sm" disabled={matchCount === 0}>↓</button>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{matchCount > 0 ? `${activeMatch + 1}/${matchCount}` : t('doc.noMatch')}</span>
          <div className="toolbar-divider" />
          <input type="text" placeholder={t('doc.replacePlaceholder')} value={replaceQuery} onChange={e => setReplaceQuery(e.target.value)} className="text-sm" style={{ width: 160 }} />
          <button onClick={handleReplace} className="btn btn-outline btn-sm" disabled={matchCount === 0}>{t('doc.replace')}</button>
          <button onClick={handleReplaceAll} className="btn btn-primary btn-sm" disabled={matchCount === 0}>{t('doc.replaceAll')}</button>
          <div className="flex-1" />
          <button onClick={() => { setSearchOpen(false); setSearchQuery(''); doSearch(viewRef.current!, '', false) }} className="btn btn-ghost btn-sm">✕</button>
        </div>
      )}

      {/* Ribbon Tab 栏 */}
      <div className="flex items-center px-2 flex-shrink-0 border-b" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        {ribbonTabs.map(tab => (
          <button key={tab.id} onClick={() => setRibbonTab(tab.id)} className="px-4 py-2 text-sm font-medium transition-colors"
            style={{ color: ribbonTab === tab.id ? 'var(--color-primary)' : 'var(--color-text-secondary)', borderBottom: ribbonTab === tab.id ? '2px solid var(--color-primary)' : '2px solid transparent', background: ribbonTab === tab.id ? 'var(--color-primary-50)' : 'transparent' }}>{tab.label}</button>
        ))}
        <div className="flex-1" />
        <button onClick={() => setSearchOpen(!searchOpen)} className="toolbar-btn" title={t('doc.find') + ' (Ctrl+F)'} type="button">🔍</button>
        <button onClick={() => setTrackChanges(!trackChanges)} className={`toolbar-btn ${trackChanges ? 'active' : ''}`} title={t('doc.trackChanges')} type="button">✏️</button>
      </div>

      {/* Ribbon 内容区 */}
      <div className="flex items-stretch px-1 py-1 flex-shrink-0 border-b overflow-x-auto" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', minHeight: '72px' }}>
        {ribbonTab === 'home' && (<>
          <RibbonGroup label={t('doc.clipboard')}>
            <RibbonButton icon="↶" label={t('doc.undo')} onClick={() => exec('undo')} title="Ctrl+Z" />
            <RibbonButton icon="↷" label={t('doc.redo')} onClick={() => exec('redo')} title="Ctrl+Y" />
          </RibbonGroup>
          <RibbonGroup label={t('doc.font')}>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <select value={activeFont} onChange={e => setFont(e.target.value)} className="text-xs rounded-md px-2 py-1" style={{ width: 100, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>{FONTS.map(f => <option key={f.value} value={f.value}>{f.name}</option>)}</select>
                <select value={activeFontSize} onChange={e => setFontSize(e.target.value)} className="text-xs rounded-md px-2 py-1" style={{ width: 60, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}><option value="">{t('doc.font.default')}</option>{FONT_SIZES.map(s => <option key={s.value} value={s.value}>{s.name}</option>)}</select>
              </div>
              <div className="flex items-center gap-0.5">
                <button onClick={() => exec('bold')} className={`toolbar-btn ${activeMarks.has('bold') ? 'active' : ''}`} title={t('doc.bold') + ' Ctrl+B'} type="button" style={{ width: 28, height: 26 }}><b>B</b></button>
                <button onClick={() => exec('italic')} className={`toolbar-btn ${activeMarks.has('italic') ? 'active' : ''}`} title={t('doc.italic') + ' Ctrl+I'} type="button" style={{ width: 28, height: 26 }}><i>I</i></button>
                <button onClick={() => exec('underline')} className={`toolbar-btn ${activeMarks.has('underline') ? 'active' : ''}`} title={t('doc.underline') + ' Ctrl+U'} type="button" style={{ width: 28, height: 26 }}><u>U</u></button>
                <button onClick={() => exec('strikethrough')} className={`toolbar-btn ${activeMarks.has('strikethrough') ? 'active' : ''}`} title={t('doc.strikethrough')} type="button" style={{ width: 28, height: 26 }}><s>S</s></button>
                <button onClick={() => exec('superscript')} className={`toolbar-btn ${activeMarks.has('superscript') ? 'active' : ''}`} title={t('doc.superscript')} type="button" style={{ width: 28, height: 26 }}>X²</button>
                <button onClick={() => exec('subscript')} className={`toolbar-btn ${activeMarks.has('subscript') ? 'active' : ''}`} title={t('doc.subscript')} type="button" style={{ width: 28, height: 26 }}>X₂</button>
                <div className="relative group">
                  <button className="toolbar-btn" title={t('doc.textColor')} type="button" style={{ width: 28, height: 26, borderBottom: `3px solid ${activeColor || '#333'}` }}>A</button>
                  <div className="absolute top-full left-0 hidden group-hover:block z-20 p-2.5 rounded-lg shadow-lg" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}><div className="grid grid-cols-6 gap-1.5">{COLORS.map(c => <button key={c} onClick={() => setTextColor(c)} className="w-6 h-6 rounded-md transition-transform hover:scale-110" style={{ background: c, border: '1px solid var(--color-border)' }} type="button" />)}</div></div>
                </div>
                <div className="relative group">
                  <button className="toolbar-btn" title={t('doc.highlight')} type="button" style={{ width: 28, height: 26, background: 'linear-gradient(180deg, transparent 60%, #fef08a 60%)' }}>H</button>
                  <div className="absolute top-full left-0 hidden group-hover:block z-20 p-2.5 rounded-lg shadow-lg" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}><div className="grid grid-cols-6 gap-1.5">{HL_COLORS.map(c => <button key={c} onClick={() => setHighlight(c)} className="w-6 h-6 rounded-md transition-transform hover:scale-110" style={{ background: c, border: '1px solid var(--color-border)' }} type="button" />)}</div></div>
                </div>
              </div>
            </div>
          </RibbonGroup>
          <RibbonGroup label={t('doc.paragraph')}>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-0.5">
                <RibbonButton icon="¶" label={t('doc.body')} onClick={() => exec('paragraph')} active={activeMarks.size === 0 || (activeMarks.size === 1 && !Array.from(activeMarks).some(m => m.startsWith('heading')))} />
                <RibbonButton icon="H1" label={t('doc.heading1')} onClick={() => exec('h1')} active={activeMarks.has('heading-1')} />
                <RibbonButton icon="H2" label={t('doc.heading2')} onClick={() => exec('h2')} active={activeMarks.has('heading-2')} />
                <RibbonButton icon="H3" label={t('doc.heading3')} onClick={() => exec('h3')} active={activeMarks.has('heading-3')} />
              </div>
              <div className="flex items-center gap-0.5">
                <button onClick={() => setParaAttr('align', 'left')} className={`toolbar-btn ${activeAttrs.align === 'left' ? 'active' : ''}`} title={t('doc.alignLeft')} type="button" style={{ width: 28, height: 26 }}>⬅</button>
                <button onClick={() => setParaAttr('align', 'center')} className={`toolbar-btn ${activeAttrs.align === 'center' ? 'active' : ''}`} title={t('doc.alignCenter')} type="button" style={{ width: 28, height: 26 }}>⬌</button>
                <button onClick={() => setParaAttr('align', 'right')} className={`toolbar-btn ${activeAttrs.align === 'right' ? 'active' : ''}`} title={t('doc.alignRight')} type="button" style={{ width: 28, height: 26 }}>➡</button>
                <button onClick={() => setParaAttr('align', 'justify')} className={`toolbar-btn ${activeAttrs.align === 'justify' ? 'active' : ''}`} title={t('doc.alignJustify')} type="button" style={{ width: 28, height: 26 }}>☰</button>
                <div className="toolbar-divider" />
                <button onClick={() => exec('bulletList')} className="toolbar-btn" title={t('doc.bulletList')} type="button" style={{ width: 28, height: 26 }}>•</button>
                <button onClick={() => exec('orderedList')} className="toolbar-btn" title={t('doc.orderedList')} type="button" style={{ width: 28, height: 26 }}>1.</button>
                <button onClick={() => setParaAttr('indent', Math.min(8, (activeAttrs.indent || 0) + 1))} className="toolbar-btn" title={t('doc.indentMore')} type="button" style={{ width: 28, height: 26 }}>→|</button>
                <button onClick={() => setParaAttr('indent', Math.max(0, (activeAttrs.indent || 0) - 1))} className="toolbar-btn" title={t('doc.indentLess')} type="button" style={{ width: 28, height: 26 }}>|←</button>
              </div>
            </div>
          </RibbonGroup>
          <RibbonGroup label={t('doc.styles')}>
            <RibbonButton icon="❝" label={t('doc.quote')} onClick={() => exec('quote')} />
            <RibbonButton icon="</>" label={t('doc.code')} onClick={() => exec('code')} active={activeMarks.has('code')} />
            <RibbonButton icon="{}" label={t('doc.codeBlock')} onClick={() => exec('codeBlock')} />
          </RibbonGroup>
        </>)}

        {ribbonTab === 'insert' && (<>
          <RibbonGroup label={t('doc.table')}><RibbonButton icon="📊" label={t('doc.table')} onClick={() => exec('insertTable')} /></RibbonGroup>
          <RibbonGroup label={t('doc.image')}>
            <RibbonButton icon="🖼" label={t('doc.image')} onClick={insertImage} />
            <RibbonButton icon="—" label={t('doc.horizontalRule')} onClick={() => exec('horizontalRule')} />
            <RibbonButton icon="⏎" label={t('doc.pageBreak')} onClick={() => exec('pageBreak')} />
          </RibbonGroup>
          <RibbonGroup label={t('doc.shapes')}>
            <div className="relative">
              <RibbonButton icon="▭" label={t('doc.shapes')} onClick={() => setShowShapePanel(!showShapePanel)} />
              {showShapePanel && (
                <div className="absolute top-full left-0 z-30 p-3 rounded-lg shadow-xl animate-fade-in" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <div className="grid grid-cols-4 gap-2">
                    {[{t:'rect',i:'▭',n:t('doc.shape.rect')},{t:'roundRect',i:'▢',n:t('doc.shape.rounded')},{t:'ellipse',i:'⬭',n:t('doc.shape.ellipse')},{t:'triangle',i:'△',n:t('doc.shape.triangle')},
                     {t:'diamond',i:'◇',n:t('doc.shape.diamond')},{t:'rightArrow',i:'→',n:t('doc.shape.arrow')},{t:'star5',i:'★',n:t('doc.shape.star')},{t:'heart',i:'♥',n:t('doc.shape.heart')}].map(s => (
                      <button key={s.t} onClick={() => { exec('textBox'); setShowShapePanel(false) }} className="flex flex-col items-center gap-1 p-2 rounded-md transition-colors hover:bg-slate-100" style={{ minWidth: 56 }}>
                        <span style={{ fontSize: '20px' }}>{s.i}</span>
                        <span style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>{s.n}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </RibbonGroup>
          <RibbonGroup label={t('doc.wordArt')}>
            <div className="relative">
              <RibbonButton icon="🎨" label={t('doc.wordArt')} onClick={() => setShowArtPanel(!showArtPanel)} />
              {showArtPanel && (
                <div className="absolute top-full left-0 z-30 p-3 rounded-lg shadow-xl animate-fade-in" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { name: t('art.purple'), color: '#4f46e5', grad: '4f46e5,818cf8', shadow: true },
                      { name: t('art.blue'), color: '#3b82f6', outline: true },
                      { name: t('art.green'), color: '#10b981', grad: '10b981,34d399', glow: true },
                      { name: t('art.orange'), color: '#f59e0b', grad: 'f59e0b,fbbf24', shadow: true },
                      { name: t('art.red'), color: '#ef4444', shadow: true },
                      { name: t('art.black'), color: '#000000', shadow: true },
                    ].map(p => (
                      <button key={p.name} onClick={() => {
                        const text = prompt(t('doc.prompt.wordArt')); if (!text) return
                        const v = viewRef.current; if (!v) return
                        const marks: any[] = [schema.marks.bold.create(), schema.marks.fontSize.create({ size: '32px' })]
                        if (p.grad) marks.push(schema.marks.textColor.create({ color: p.color }))
                        else marks.push(schema.marks.textColor.create({ color: p.color }))
                        v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.paragraph.create({ align: 'center' }, schema.text(text, marks))))
                        v.focus(); setShowArtPanel(false)
                      }} className="flex flex-col items-center gap-1 p-2 rounded-md transition-colors hover:bg-slate-100" style={{ minWidth: 72 }}>
                        <span style={{ fontSize: '18px', fontWeight: 700, color: p.color, textShadow: p.shadow ? '2px 2px 4px rgba(0,0,0,0.3)' : 'none' }}>Aa</span>
                        <span style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>{p.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </RibbonGroup>
          <RibbonGroup label={t('doc.flowchart')}>
            <RibbonButton icon="🔀" label={t('doc.flowchart')} onClick={() => {
              const v = viewRef.current; if (!v) return
              const rows = [
                [t('flow.step'), t('flow.content')],
                [t('flow.start'), t('flow.userInput')],
                [t('flow.process'), t('flow.aiAnalysis')],
                [t('flow.decision'), t('flow.complete')],
                [t('flow.end'), t('flow.output')],
              ]
              const tableRows = rows.map((row, r) => schema.nodes.table_row.create(null,
                row.map(cell => schema.nodes.table_cell.create({ isHeader: r === 0 }, schema.nodes.paragraph.create(null, schema.text(cell))))
              ))
              v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.table.create(null, tableRows)))
              v.focus()
            }} />
          </RibbonGroup>
          <RibbonGroup label={t('doc.text')}>
            <RibbonButton icon="📦" label={t('doc.textBox')} onClick={() => exec('textBox')} />
            <RibbonButton icon="Σ" label={t('doc.formula')} onClick={insertFormula} />
          </RibbonGroup>
          <RibbonGroup label={t('doc.link')}>
            <RibbonButton icon="⚓" label={t('doc.bookmark')} onClick={() => exec('bookmark')} />
            <RibbonButton icon="🔗" label={t('doc.hyperlink')} onClick={insertLink} />
          </RibbonGroup>
          <RibbonGroup label={t('doc.annotation')}>
            <RibbonButton icon="📝" label={t('doc.footnote')} onClick={() => exec('footnote')} />
            <RibbonButton icon="💬" label={t('doc.annotation')} onClick={() => exec('comment')} />
          </RibbonGroup>
        </>)}

        {ribbonTab === 'layout' && (<>
          <RibbonGroup label={t('doc.paragraph')}>
            <div className="flex flex-col gap-1">
              <select value={activeAttrs.lineHeight || ''} onChange={e => setParaAttr('lineHeight', e.target.value)} className="text-xs rounded-md px-2 py-1" style={{ width: 80 }}><option value="">{t('doc.lineSpacing')}</option>{LINE_HEIGHTS.map(l => <option key={l.value} value={l.value}>{l.name}</option>)}</select>
              <select value={activeAttrs.letterSpacing || ''} onChange={e => setParaAttr('letterSpacing', e.target.value)} className="text-xs rounded-md px-2 py-1" style={{ width: 80 }}><option value="">{t('doc.charSpacing')}</option><option value="0.5px">{t('doc.spacing.loose')}</option><option value="1px">{t('doc.spacing.looser')}</option><option value="-0.5px">{t('doc.spacing.tight')}</option></select>
            </div>
          </RibbonGroup>
          <RibbonGroup label={t('doc.border')}>
            <RibbonButton icon="▢" label={t('doc.borderAll')} onClick={() => setParaAttr('border', activeAttrs.border === 'all' ? '' : 'all')} active={activeAttrs.border === 'all'} />
            <RibbonButton icon="▏" label={t('doc.borderLeft')} onClick={() => setParaAttr('border', activeAttrs.border === 'left' ? '' : 'left')} active={activeAttrs.border === 'left'} />
          </RibbonGroup>
          <RibbonGroup label={t('doc.shading')}>
            <div className="relative group">
              <button className="toolbar-btn" title={t('doc.shading')} type="button" style={{ width: 40, height: 32, background: activeAttrs.shading || 'transparent' }}>▦</button>
              <div className="absolute top-full left-0 hidden group-hover:block z-20 p-2.5 rounded-lg shadow-lg" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}><div className="grid grid-cols-6 gap-1.5">{['','#f1f5f9','#fef3c7','#dbeafe','#dcfce7','#fce7f3'].map(c => <button key={c} onClick={() => setParaAttr('shading', c)} className="w-6 h-6 rounded-md transition-transform hover:scale-110" style={{ background: c || 'white', border: '1px solid var(--color-border)' }} type="button" />)}</div></div>
            </div>
          </RibbonGroup>
          <RibbonGroup label={t('doc.layout')}>
            <RibbonButton icon="🅰" label={t('doc.dropCap')} onClick={() => exec('dropCap')} active={activeAttrs.dropCap} />
            <RibbonButton icon="⇄" label="RTL" onClick={() => exec('toggleRTL')} active={activeAttrs.rtl} />
            <RibbonButton icon="💧" label={t('doc.watermark')} onClick={applyWatermark} />
          </RibbonGroup>
        </>)}

        {ribbonTab === 'review' && (<>
          <RibbonGroup label={t('doc.proofing')}>
            <RibbonButton icon="🔍" label={t('doc.findReplace')} onClick={() => setSearchOpen(!searchOpen)} />
            <RibbonButton icon={spellErrors.length > 0 ? '❗' : '✓'} label={spellErrors.length > 0 ? `${t('doc.spell')}(${spellErrors.length})` : t('doc.spell')} onClick={() => {}} />
          </RibbonGroup>
          <RibbonGroup label={t('doc.revision')}>
            <RibbonButton icon="✏️" label={t('doc.revisionMode')} onClick={() => setTrackChanges(!trackChanges)} active={trackChanges} />
            <RibbonButton icon="💬" label={t('doc.annotation')} onClick={() => exec('comment')} />
          </RibbonGroup>
          <RibbonGroup label={t('doc.wordCount')}>
            <div className="flex flex-col items-center justify-center px-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              <span style={{ fontSize: '20px', fontWeight: 700, color: 'var(--color-text)' }}>{viewRef.current?.state.doc.textContent.length || 0}</span><span>{t('app.chars')}</span>
            </div>
          </RibbonGroup>
        </>)}

        {ribbonTab === 'view' && (<>
          <RibbonGroup label={t('doc.zoom')}>
            <RibbonButton icon="−" label={t('doc.zoomOut')} onClick={() => setZoom(Math.max(50, zoom - 25))} />
            <div className="flex flex-col items-center px-2"><span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-text)' }}>{zoom}%</span></div>
            <RibbonButton icon="+" label={t('doc.zoomIn')} onClick={() => setZoom(Math.min(150, zoom + 25))} />
            <RibbonButton icon="▮" label="100%" onClick={() => setZoom(100)} />
          </RibbonGroup>
          <RibbonGroup label={t('doc.preview')}><RibbonButton icon="🖨" label={t('doc.printPreview')} onClick={() => setPrintPreview(!printPreview)} /></RibbonGroup>
        </>)}
      </div>

      {/* 表格工具栏 */}
      {inTable && (
        <div className="px-3 py-1 flex items-center gap-1 flex-shrink-0 animate-fade-in" style={{ background: 'var(--color-primary-light)', borderBottom: '1px solid var(--color-border)' }}>
          <span className="text-xs font-medium px-2" style={{ color: 'var(--color-primary)' }}>{t('doc.tableTools')}</span>
          <button onClick={() => mergeCells(viewRef.current!.state, viewRef.current!.dispatch)} className="toolbar-btn" title={t('doc.merge')} type="button">⊟</button>
          <button onClick={() => splitCell(viewRef.current!.state, viewRef.current!.dispatch)} className="toolbar-btn" title={t('doc.split')} type="button">⊞</button>
          <div className="toolbar-divider" />
          <button onClick={() => addRowAfter(viewRef.current!.state, viewRef.current!.dispatch)} className="toolbar-btn" title={t('doc.addRow')} type="button">↧+</button>
          <button onClick={() => addColumnAfter(viewRef.current!.state, viewRef.current!.dispatch)} className="toolbar-btn" title={t('doc.addColumn')} type="button">↦+</button>
          <button onClick={() => deleteRow(viewRef.current!.state, viewRef.current!.dispatch)} className="toolbar-btn" title={t('doc.deleteRow')} type="button">↧✕</button>
          <button onClick={() => deleteColumn(viewRef.current!.state, viewRef.current!.dispatch)} className="toolbar-btn" title={t('doc.deleteColumn')} type="button">↦✕</button>
          <div className="toolbar-divider" />
          <button onClick={() => setCellAlign(viewRef.current!.state, viewRef.current!.dispatch, 'left')} className="toolbar-btn" title={t('doc.alignLeft')} type="button">⬅</button>
          <button onClick={() => setCellAlign(viewRef.current!.state, viewRef.current!.dispatch, 'center')} className="toolbar-btn" title={t('doc.alignCenter')} type="button">⬌</button>
          <button onClick={() => setCellAlign(viewRef.current!.state, viewRef.current!.dispatch, 'right')} className="toolbar-btn" title={t('doc.alignRight')} type="button">➡</button>
        </div>
      )}

      {/* Mini 浮动工具栏 */}
      {showMiniToolbar && (
        <div className="fixed z-50 flex items-center gap-0.5 px-2 py-1 rounded-lg shadow-xl animate-fade-in" style={{ left: miniToolbarPos.x, top: miniToolbarPos.y, background: 'var(--color-surface)', border: '1px solid var(--color-border)' }} onMouseDown={e => e.preventDefault()}>
          <button onClick={() => exec('bold')} className={`toolbar-btn ${activeMarks.has('bold') ? 'active' : ''}`} style={{ width: 28, height: 26 }}><b>B</b></button>
          <button onClick={() => exec('italic')} className={`toolbar-btn ${activeMarks.has('italic') ? 'active' : ''}`} style={{ width: 28, height: 26 }}><i>I</i></button>
          <button onClick={() => exec('underline')} className={`toolbar-btn ${activeMarks.has('underline') ? 'active' : ''}`} style={{ width: 28, height: 26 }}><u>U</u></button>
          <div className="toolbar-divider" />
          <div className="relative group">
            <button className="toolbar-btn" title={t('doc.color')} type="button" style={{ width: 28, height: 26, borderBottom: `3px solid ${activeColor || '#333'}` }}>A</button>
            <div className="absolute top-full left-0 hidden group-hover:block z-20 p-2 rounded-lg shadow-lg" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}><div className="grid grid-cols-6 gap-1">{COLORS.map(c => <button key={c} onClick={() => setTextColor(c)} className="w-5 h-5 rounded" style={{ background: c, border: '1px solid var(--color-border)' }} type="button" />)}</div></div>
          </div>
          <div className="toolbar-divider" />
          <button onClick={() => exec('h1')} className="toolbar-btn" title={t('doc.heading1')} style={{ width: 28, height: 26 }}>H1</button>
          <button onClick={() => exec('h2')} className="toolbar-btn" title={t('doc.heading2')} style={{ width: 28, height: 26 }}>H2</button>
        </div>
      )}

      {/* 右键菜单 */}
      {showContextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowContextMenu(false)} />
          <div className="fixed z-50 py-1.5 rounded-lg shadow-xl animate-fade-in" style={{ left: contextMenuPos.x, top: contextMenuPos.y, background: 'var(--color-surface)', border: '1px solid var(--color-border)', minWidth: 180 }}>
            <button onClick={() => exec('bold')} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}><b>B</b> {t('doc.bold')}</button>
            <button onClick={() => exec('italic')} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}><i>I</i> {t('doc.italic')}</button>
            <button onClick={() => exec('underline')} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}><u>U</u> {t('doc.underline')}</button>
            <div className="my-1 mx-3 h-px" style={{ background: 'var(--color-border)' }} />
            <button onClick={() => { setSearchOpen(true); setShowContextMenu(false) }} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>🔍 {t('doc.findReplace')}</button>
            <button onClick={() => exec('comment')} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>💬 {t('doc.addComment')}</button>
            <button onClick={() => { setRibbonTab('insert'); setShowContextMenu(false) }} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>📊 {t('doc.insertTable')}</button>
          </div>
        </>
      )}

      {watermark && (<div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%) rotate(-30deg)', fontSize: '72px', color: 'rgba(0,0,0,0.08)', pointerEvents: 'none', zIndex: 5, whiteSpace: 'nowrap' }}>{watermark}</div>)}

      <div className="flex-1 overflow-auto" style={{ zoom: `${zoom}%` }} ref={editorRef as any} />

      {printPreview && (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'rgba(15,23,42,0.9)' }}>
          <div className="flex items-center gap-2 px-4 py-2 text-white"><span className="font-semibold">{t('doc.printPreview')}</span><div className="flex-1" /><button onClick={handlePrint} className="btn btn-primary btn-sm">🖨 {t('doc.print')}</button><button onClick={() => setPrintPreview(false)} className="btn btn-ghost btn-sm" style={{ color: 'white' }}>✕ {t('doc.close')}</button></div>
          <div className="flex-1 overflow-auto p-8 flex justify-center"><div className="bg-white shadow-2xl" style={{ width: '210mm', minHeight: '297mm', padding: '20mm' }}><div ref={editorRef as any} /></div></div>
        </div>
      )}
    </div>
  )
}
