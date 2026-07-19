import { useEffect, useRef, useState } from 'react'
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state'
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
import { columnResizing, tableEditing, CellSelection } from 'prosemirror-tables'
import { useI18n } from '../../i18n'
import { PrintDialog } from '../../components/PrintDialog'
import type { Document, SpellError } from '../../types/udm'

interface Props {
  document: Document
  spellErrors?: SpellError[]
  onChange?: (doc: Document) => void
  onSpellCheck?: (text: string) => void
  zoom?: number
  onZoomChange?: (z: number) => void
}

type RibbonTab = 'home' | 'insert' | 'layout' | 'review' | 'view'

const LINE_HEIGHTS = [{ name: '1.0', value: '1.0' }, { name: '1.5', value: '1.5' }, { name: '1.75', value: '1.75' }, { name: '2.0', value: '2.0' }, { name: '固定28pt (公文)', value: '28pt' }, { name: '固定30pt', value: '30pt' }]
const COLORS = ['#000000','#374151','#6B7280','#9CA3AF','#EF4444','#F59E0B','#10B981','#3B82F6','#6366F1','#8B5CF6','#EC4899','#6B7280']
const HL_COLORS = ['#fef08a','#bbf7d0','#bfdbfe','#fbcfe8','#fed7aa','#e9d5ff']

function RibbonButton({ icon, label, onClick, active, disabled, title, ...rest }: any) {
  return (
    <button onClick={onClick} disabled={disabled} title={title || label} {...rest}
      className="flex flex-col items-center justify-center gap-0.5 px-1.5 py-1 rounded-md transition-colors min-w-[44px] disabled:opacity-40"
      style={{ background: active ? 'var(--color-primary-light)' : 'transparent', color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}
      onMouseEnter={e => { if (!disabled && !active) e.currentTarget.style.background = 'var(--color-bg-alt)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}>
      <span style={{ fontSize: '15px', lineHeight: 1 }}>{icon}</span>
      <span style={{ fontSize: '10px', fontWeight: 500, whiteSpace: 'nowrap' }}>{label}</span>
    </button>
  )
}

function RibbonGroup({ label, children }: any) {
  return (
    <div className="flex flex-col items-center px-2 border-r ribbon-group" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex items-center gap-1 py-1 flex-1">{children}</div>
      <div className="text-[10px] font-medium pb-0.5 whitespace-nowrap" style={{ color: 'var(--color-text-muted)' }}>{label}</div>
    </div>
  )
}

export function DocumentEditor({ document, spellErrors = [], onChange, onSpellCheck, zoom: zoomProp, onZoomChange }: Props) {
  const { t } = useI18n()

  // 系统字体库 — 通过 queryLocalFonts() 加载 (Chrome/Edge 支持), 回退到常用字体列表
  const [systemFonts, setSystemFonts] = useState<string[]>([
    'SimSun', 'SimHei', 'KaiTi', 'FangSong', 'Microsoft YaHei', 'Microsoft JhengHei',
    'Arial', 'Times New Roman', 'Calibri', 'Cambria', 'Georgia', 'Verdana',
    'Tahoma', 'Trebuchet MS', 'Courier New', 'Consolas', 'Lucida Console',
  ])
  useEffect(() => {
    const w = window as any
    if (w.queryLocalFonts) {
      w.queryLocalFonts().then((fonts: any[]) => {
        if (fonts && fonts.length) {
          const names = Array.from(new Set(fonts.map((f: any) => f.family))).sort()
          setSystemFonts(names.length > 0 ? names : systemFonts)
        }
      }).catch(() => {})
    }
  }, [])

  const FONTS = [
    { name: t('doc.font.default'), value: '' },
    ...systemFonts.slice(0, 80).map(f => ({ name: f, value: `"${f}", sans-serif` })),
  ]
  const FONT_SIZES = [
    { name: t('doc.size.small'), value: '12px' }, { name: t('doc.size.body'), value: '15px' },
    { name: t('doc.size.medium'), value: '18px' }, { name: t('doc.size.large'), value: '24px' }, { name: t('doc.size.heading'), value: '32px' },
  ]

  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onSpellCheckRef = useRef(onSpellCheck)
  const trackChangesRef = useRef(false)
  onChangeRef.current = onChange
  onSpellCheckRef.current = onSpellCheck

  const [activeMarks, setActiveMarks] = useState<Set<string>>(new Set())
  const [activeAttrs, setActiveAttrs] = useState<any>({})
  const [activeFont, setActiveFont] = useState('')
  const [activeFontSize, setActiveFontSize] = useState('')
  const [activeColor, setActiveColor] = useState('')
  const [activeIsImage, setActiveIsImage] = useState(false)
  const [activeIsShape, setActiveIsShape] = useState(false)
  const [, setTick] = useState(0)
  const [focused, setFocused] = useState(false)
  const [ribbonTab, setRibbonTab] = useState<RibbonTab>('home')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [replaceQuery, setReplaceQuery] = useState('')
  const [matchCount, setMatchCount] = useState(0)
  const [activeMatch, setActiveMatch] = useState(-1)
  const [zoomInternal, setZoomInternal] = useState(100)
  const zoom = zoomProp ?? zoomInternal
  const setZoom = (z: number) => { const v = Math.max(50, Math.min(300, z)); setZoomInternal(v); if (onZoomChange) onZoomChange(v) }
  const [trackChanges, setTrackChanges] = useState(false)
  trackChangesRef.current = trackChanges
  const [printPreview, setPrintPreview] = useState(false)
  const [printDialogOpen, setPrintDialogOpen] = useState(false)
  const [inTable, setInTable] = useState(false)
  const [watermark, setWatermark] = useState('')
  const [showMiniToolbar, setShowMiniToolbar] = useState(false)
  const [miniToolbarPos, setMiniToolbarPos] = useState({ x: 0, y: 0 })
  const [showContextMenu, setShowContextMenu] = useState(false)
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 })
  const [showShapePanel, setShowShapePanel] = useState(false)
  const [showArtPanel, setShowArtPanel] = useState(false)
  const [showFormulaPanel, setShowFormulaPanel] = useState(false)
  const [showSymbolPanel, setShowSymbolPanel] = useState(false)
  const [symbolCategory, setSymbolCategory] = useState<'greek' | 'latin' | 'circled' | 'roman' | 'math' | 'arrows'>('greek')
  // 二级颜色/底纹/背景弹出菜单 — 统一改为 click 触发，避免 hover 残留导致重叠
  const [showColorPopup, setShowColorPopup] = useState(false)
  const [showHighlightPopup, setShowHighlightPopup] = useState(false)
  const [showShadingPopup, setShowShadingPopup] = useState(false)
  const [showBgColorPopup, setShowBgColorPopup] = useState(false)
  // 迷你工具栏颜色弹出菜单 (统一改为 click 触发，与主 ribbon 保持一致)
  const [showMiniColorPopup, setShowMiniColorPopup] = useState(false)
  // 弹出面板互斥：打开任一面板时关闭其他面板，避免多个弹出菜单重叠
  type PanelName = 'shape' | 'art' | 'color' | 'highlight' | 'shading' | 'bgColor'
  const openPanel = (which: PanelName) => {
    setShowShapePanel(which === 'shape' ? !showShapePanel : false)
    setShowArtPanel(which === 'art' ? !showArtPanel : false)
    setShowColorPopup(which === 'color' ? !showColorPopup : false)
    setShowHighlightPopup(which === 'highlight' ? !showHighlightPopup : false)
    setShowShadingPopup(which === 'shading' ? !showShadingPopup : false)
    setShowBgColorPopup(which === 'bgColor' ? !showBgColorPopup : false)
    setShowFormulaPanel(false)
    setShowSymbolPanel(false)
  }
  const openPanel2 = (which: 'formula' | 'symbol') => {
    setShowFormulaPanel(which === 'formula' ? !showFormulaPanel : false)
    setShowSymbolPanel(which === 'symbol' ? !showSymbolPanel : false)
    setShowShapePanel(false); setShowArtPanel(false)
    setShowColorPopup(false); setShowHighlightPopup(false)
    setShowShadingPopup(false); setShowBgColorPopup(false)
  }
  const closeAllPanels = () => {
    setShowShapePanel(false); setShowArtPanel(false)
    setShowColorPopup(false); setShowHighlightPopup(false)
    setShowShadingPopup(false); setShowBgColorPopup(false)
    setShowFormulaPanel(false); setShowSymbolPanel(false)
  }
  const anyPanelOpen = showShapePanel || showArtPanel || showColorPopup || showHighlightPopup || showShadingPopup || showBgColorPopup || showFormulaPanel || showSymbolPanel
  // 护眼/背景色: white / #c7edcc (护眼绿) / #f5f5dc (豆沙) / #faf3e0 (米黄)
  const [bgColor, setBgColor] = useState('#ffffff')
  // View 标签页: 标尺 / 网格线 / 导航窗口 / 拆分窗口 / 护眼模式
  const [showRuler, setShowRuler] = useState(false)
  const [showGridlines, setShowGridlines] = useState(false)
  const [showNavPane, setShowNavPane] = useState(false)
  const [splitWindow, setSplitWindow] = useState(false)
  const [eyeCareMode, setEyeCareMode] = useState(false)
  // 页码计数器（避免每次点击都追加）
  const [pageNumInserted, setPageNumInserted] = useState(false)
  // 显示编辑标记 (段落标记 ¶ / 分页符等)
  const [showMarks, setShowMarks] = useState(false)
  // 文档级设置 (页眉/页脚/页边距/分栏/行号)
  const [docHeader, setDocHeader] = useState('')
  const [docFooter, setDocFooter] = useState('')
  const [docMargins, setDocMargins] = useState({ top: 64, bottom: 64, left: 80, right: 80 })
  const [docColumns, setDocColumns] = useState(1)
  const [docLineNumbers, setDocLineNumbers] = useState(false)

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
        columnResizing(), tableEditing(), spellCheckPlugin(), searchPlugin(),
      ]
    })
    const view = new EditorView(editorRef.current, {
      state,
      nodeViews: {
        image: (node: any, view: any, getPos: any) => {
          const dom = window.document.createElement('div')
          dom.style.display = 'inline-block'
          dom.style.position = 'relative'
          dom.style.margin = '4px'
          dom.style.maxWidth = '100%'
          const img = window.document.createElement('img')
          img.src = node.attrs.src
          img.alt = node.attrs.alt || ''
          img.style.maxWidth = '100%'
          img.style.display = 'block'
          img.style.cursor = 'pointer'
          let w = node.attrs.width || 300
          img.style.width = w + 'px'
          dom.appendChild(img)
          // Resize handle
          const handle = window.document.createElement('div')
          handle.style.position = 'absolute'
          handle.style.bottom = '-4px'
          handle.style.right = '-4px'
          handle.style.width = '12px'
          handle.style.height = '12px'
          handle.style.background = '#4f46e5'
          handle.style.border = '2px solid white'
          handle.style.borderRadius = '2px'
          handle.style.cursor = 'nwse-resize'
          handle.style.zIndex = '100'
          handle.style.display = 'none'
          dom.appendChild(handle)
          // Show handle when selected
          const checkSelected = () => {
            const sel = view.state.selection
            if (sel instanceof NodeSelection && sel.from === getPos()) {
              handle.style.display = 'block'
              dom.style.outline = '2px solid #4f46e5'
              dom.style.outlineOffset = '2px'
            } else {
              handle.style.display = 'none'
              dom.style.outline = 'none'
            }
          }
          // Drag to resize
          let resizing = false, startX = 0, startW = 0
          handle.addEventListener('mousedown', (e: MouseEvent) => {
            e.preventDefault()
            e.stopPropagation()
            resizing = true
            startX = e.clientX
            startW = w
          })
          window.document.addEventListener('mousemove', (e: MouseEvent) => {
            if (!resizing) return
            const diff = e.clientX - startX
            const newW = Math.max(50, startW + diff)
            img.style.width = newW + 'px'
            w = newW
          })
          window.document.addEventListener('mouseup', () => {
            if (!resizing) return
            resizing = false
            // Commit the new width to the document
            const pos = getPos()
            if (pos != null) {
              const tr = view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, width: w })
              view.dispatch(tr)
            }
          })
          // Click to select
          dom.addEventListener('click', (e: MouseEvent) => {
            const pos = getPos()
            if (pos != null) {
              view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)))
              view.focus()
            }
          })
          // Listen for selection changes
          view.someProp('handleDOMEvents', () => {}) // ensure view is valid
          const origDispatch = view.dispatch.bind(view)
          const wrappedDispatch = (tr: any) => {
            origDispatch(tr)
            setTimeout(checkSelected, 0)
          }
          view.dispatch = wrappedDispatch
          return { dom }
        }
      },
      dispatchTransaction(tr) {
        // Track changes: if enabled and this is a text insertion/deletion, add track marks
        if (trackChangesRef.current && tr.docChanged) {
          tr.steps.forEach((step: any) => {
            if (step.from !== undefined && step.to !== undefined) {
              const inserted = (step as any).slice?.openStart !== undefined
              if (inserted) {
                tr.addMark(step.from, step.to || step.from, schema.marks.insert_track.create({ author: 'User' }))
              }
            }
          })
        }
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
    setInTable(isInTable); setActiveMarks(marks); setActiveAttrs(attrs); setActiveFont(f); setActiveFontSize(sz); setActiveColor(c)
    // Track if cursor is on an image or shape node (for float/wrap buttons)
    const sel = state.selection
    const selNode = sel instanceof NodeSelection ? sel.node : null
    setActiveIsImage(!!selNode && selNode.type.name === 'image')
    setActiveIsShape(!!selNode && selNode.type.name === 'text_box')
    setTick(t => t + 1)
  }

  const exec = (cmd: string) => {
    const v = viewRef.current; if (!v) return; const sel = v.state.selection
    const selNode = sel instanceof NodeSelection ? sel.node : null
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
      case 'shape:rect':
      case 'shape:roundRect':
      case 'shape:ellipse':
      case 'shape:triangle':
      case 'shape:diamond':
      case 'shape:rightArrow':
      case 'shape:star5':
      case 'shape:heart': {
        const shapeType = cmd.split(':')[1]
        const cell = schema.nodes.paragraph.create(null, schema.text(t('doc.textBoxDefault')))
        v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.text_box.create({ shape: shapeType }, cell)))
        break
      }
      case 'imgFloatLeft': { if (selNode && selNode.type.name === 'image') v.dispatch(v.state.tr.setNodeMarkup(sel.from, undefined, { ...selNode.attrs, float: 'left' })); break }
      case 'imgFloatRight': { if (selNode && selNode.type.name === 'image') v.dispatch(v.state.tr.setNodeMarkup(sel.from, undefined, { ...selNode.attrs, float: 'right' })); break }
      case 'imgFloatCenter': { if (selNode && selNode.type.name === 'image') v.dispatch(v.state.tr.setNodeMarkup(sel.from, undefined, { ...selNode.attrs, float: 'center' })); break }
      case 'imgFloatNone': { if (selNode && selNode.type.name === 'image') v.dispatch(v.state.tr.setNodeMarkup(sel.from, undefined, { ...selNode.attrs, float: '' })); break }
      case 'imgToggleWrap': { if (selNode && selNode.type.name === 'image') v.dispatch(v.state.tr.setNodeMarkup(sel.from, undefined, { ...selNode.attrs, wrap: !selNode.attrs.wrap })); break }
      case 'shapeFloatLeft': { if (selNode && selNode.type.name === 'text_box') v.dispatch(v.state.tr.setNodeMarkup(sel.from, undefined, { ...selNode.attrs, float: 'left' })); break }
      case 'shapeFloatRight': { if (selNode && selNode.type.name === 'text_box') v.dispatch(v.state.tr.setNodeMarkup(sel.from, undefined, { ...selNode.attrs, float: 'right' })); break }
      case 'tableAlignLeft': { alignTable(v, 'left'); break }
      case 'tableAlignCenter': { alignTable(v, 'center'); break }
      case 'tableAlignRight': { alignTable(v, 'right'); break }
      case 'footnote': {
        const text = prompt(t('doc.prompt.footnote')); if (!text) break
        // Count existing footnotes for numbering
        let footnoteCount = 0
        v.state.doc.descendants(node => { if (node.type.name === 'footnote') footnoteCount++ })
        const num = footnoteCount + 1
        // Insert footnote reference at cursor
        v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.footnote.create({ content: text, num })))
        // Add footnote item at end of document (or create footnote section if none exists)
        const docEnd = v.state.doc.content.size
        let tr2 = v.state.tr
        const lastNode = v.state.doc.lastChild
        if (lastNode && lastNode.type.name === 'footnote_section') {
          // Append to existing section
          const sectionEnd = docEnd - 1
          tr2 = tr2.insert(sectionEnd, schema.nodes.footnote_item.create({ num }, schema.text(text)))
        } else {
          // Create new section at end
          const item = schema.nodes.footnote_item.create({ num }, schema.text(text))
          const section = schema.nodes.footnote_section.create(null, item)
          tr2 = tr2.insert(docEnd, section)
        }
        v.dispatch(tr2)
        break
      }
      case 'bookmark': { const name = prompt(t('doc.prompt.bookmark')); if (name) v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.bookmark.create({ name }))); break }
      case 'comment': { const text = prompt(t('doc.prompt.comment')); if (text && !sel.empty) v.dispatch(v.state.tr.addMark(sel.from, sel.to, schema.marks.comment_mark.create({ id: Date.now().toString(), author: 'User', text }))); break }
      case 'insertTable': { const rows = parseInt(prompt(t('doc.prompt.rows'), '3') || '3'); const cols = parseInt(prompt(t('doc.prompt.cols'), '3') || '3'); if (rows > 0 && cols > 0) { const tr = []; for (let r = 0; r < rows; r++) { const cells = []; for (let c = 0; c < cols; c++) { const headerText = r === 0 ? `列${c+1}` : ''; const content = headerText ? schema.text(headerText) : null; cells.push(schema.nodes.table_cell.create({ isHeader: r === 0 }, schema.nodes.paragraph.create(null, content))) } tr.push(schema.nodes.table_row.create(null, cells)) } v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.table.create(null, tr))) } break }
      case 'dropCap': setParaAttr('dropCap', !activeAttrs.dropCap); break
      case 'toggleRTL': setParaAttr('rtl', !activeAttrs.rtl); break
    }
    v.focus(); setShowMiniToolbar(false); setShowMiniColorPopup(false); setShowContextMenu(false)
  }

  const setParaAttr = (attr: string, value: any) => { const v = viewRef.current; if (!v) return; const { $from } = v.state.selection; if ($from.parent.type.name !== 'paragraph') return; v.dispatch(v.state.tr.setNodeMarkup($from.before(), undefined, { ...$from.parent.attrs, [attr]: value })); v.focus() }
  // Align the entire table that contains the cursor
  const alignTable = (v: EditorView, align: 'left' | 'center' | 'right') => {
    const { $from } = v.state.selection
    let tablePos = -1, tableNode: any = null
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d)
      if (node.type.name === 'table') { tablePos = $from.before(d); tableNode = node; break }
    }
    if (tableNode) {
      // Wrap table in a paragraph with align, or set margin auto for center
      const tr = v.state.tr
      // Set table alignment via attribute on the table node
      v.dispatch(tr.setNodeMarkup(tablePos, undefined, { ...tableNode.attrs, align }))
      v.focus()
    }
  }
  const setFont = (font: string) => { const v = viewRef.current; if (!v) return; if (font) toggleMark(schema.marks.fontFamily, { font })(v.state, v.dispatch); else v.dispatch(v.state.tr.removeMark(v.state.selection.from, v.state.selection.to, schema.marks.fontFamily)); v.focus() }
  const setFontSize = (size: string) => { const v = viewRef.current; if (!v) return; toggleMark(schema.marks.fontSize, { size })(v.state, v.dispatch); v.focus() }
  const setTextColor = (color: string) => { const v = viewRef.current; if (!v) return; toggleMark(schema.marks.textColor, { color })(v.state, v.dispatch); v.focus() }
  const setHighlight = (color: string) => { const v = viewRef.current; if (!v) return; toggleMark(schema.marks.highlight, { color })(v.state, v.dispatch); v.focus() }
  const handleSearch = () => { const v = viewRef.current; if (!v || !searchQuery) return; doSearch(v, searchQuery, false) }
  const handleReplace = () => { const v = viewRef.current; if (!v) return; doReplace(v, searchQuery, replaceQuery, false) }
  const handleReplaceAll = () => { const v = viewRef.current; if (!v) return; doReplaceAll(v, searchQuery, replaceQuery, false) }
  const handlePrint = () => { setPrintPreview(false); setTimeout(() => window.print(), 100) }
  const insertFormula = () => { openPanel2('formula') }
  const insertSymbol = (sym: string) => {
    const v = viewRef.current; if (!v) return
    v.dispatch(v.state.tr.replaceSelectionWith(schema.text(sym)))
    v.focus()
  }
  const insertLatexFormula = (latex: string) => {
    const v = viewRef.current; if (!v) return
    v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.paragraph.create({ align: 'center' }, schema.text(`⟨formula:${latex}⟩`))))
    v.focus()
    setShowFormulaPanel(false)
  }
  const insertWordArt = () => { const text = prompt(t('doc.prompt.wordArt')); if (text) { const v = viewRef.current; if (!v) return; v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.paragraph.create({ align: 'center' }, schema.text(text, [schema.marks.bold.create(), schema.marks.fontSize.create({ size: '36px' }), schema.marks.textColor.create({ color: '#4f46e5' })])))); v.focus() } }
  const applyWatermark = () => { const wm = prompt(t('doc.prompt.watermark'), watermark); if (wm !== null) setWatermark(wm) }
  const insertImage = () => { const input = window.window.window.document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.onchange = () => { const f = input.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => { const v = viewRef.current; if (!v) return; v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.image.create({ src: r.result as string }))); v.focus() }; r.readAsDataURL(f) }; input.click() }
  const insertLink = () => { const url = prompt('URL:'); if (url) { const v = viewRef.current; if (!v) return; const sel = v.state.selection; if (!sel.empty) v.dispatch(v.state.tr.addMark(sel.from, sel.to, schema.marks.link.create({ href: url }))) } }

  useEffect(() => { if (viewRef.current) { const v = viewRef.current; v.dispatch(setSpellErrors(v.state.tr, spellErrors)); v.updateState(v.state); setTick(t => t + 1) } }, [spellErrors])

  // 键盘缩放: Ctrl+= 放大, Ctrl+- 缩小, Ctrl+0 重置 (仅当焦点不在输入框时, 或允许组合键)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key === '=' || e.key === '+') { e.preventDefault(); setZoom(zoom + 10) }
      else if (e.key === '-') { e.preventDefault(); setZoom(zoom - 10) }
      else if (e.key === '0') { e.preventDefault(); setZoom(100) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom])

  // Escape 关闭所有弹出层（右键菜单、mini工具栏、形状/艺术字/颜色/底纹/背景面板）
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (showContextMenu) { setShowContextMenu(false); e.preventDefault() }
      else if (showMiniColorPopup) { setShowMiniColorPopup(false); e.preventDefault() }
      else if (showMiniToolbar) { setShowMiniToolbar(false); e.preventDefault() }
      else if (anyPanelOpen) { closeAllPanels(); e.preventDefault() }
      else if (searchOpen) { setSearchOpen(false); e.preventDefault() }
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [showContextMenu, showMiniColorPopup, showMiniToolbar, anyPanelOpen, searchOpen])

  const ribbonTabs: { id: RibbonTab; label: string }[] = [
    { id: 'home', label: t('doc.ribbon.home') }, { id: 'insert', label: t('doc.ribbon.insert') }, { id: 'layout', label: t('doc.ribbon.layout') }, { id: 'review', label: t('doc.ribbon.review') }, { id: 'view', label: t('doc.ribbon.view') },
  ]

  return (
    <div className="flex flex-col h-full" style={{ position: 'relative' }}>
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

      {/* Ribbon Tab 栏 — 可横向滚动，右侧操作按钮固定 */}
      <div className="flex items-center px-2 flex-shrink-0 border-b" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', position: 'relative', zIndex: 45 }}>
        <div className="ribbon-tab-scroll">
          {ribbonTabs.map(tab => (
            <button key={tab.id} onClick={() => { closeAllPanels(); setRibbonTab(tab.id) }} data-testid={`ribbon-tab-${tab.id}`} className="ribbon-tab-btn px-2 sm:px-4 py-2 text-sm font-medium transition-colors"
              style={{ color: ribbonTab === tab.id ? 'var(--color-primary)' : 'var(--color-text-secondary)', borderBottom: ribbonTab === tab.id ? '2px solid var(--color-primary)' : '2px solid transparent', background: ribbonTab === tab.id ? 'var(--color-primary-50)' : 'transparent' }}>{tab.label}</button>
          ))}
        </div>
        <button onClick={() => setSearchOpen(!searchOpen)} data-testid="doc-search-toggle" className="toolbar-btn flex-shrink-0" title={t('doc.find') + ' (Ctrl+F)'} type="button">🔍</button>
        <button onClick={() => setTrackChanges(!trackChanges)} className={`toolbar-btn flex-shrink-0 ${trackChanges ? 'active' : ''}`} title={t('doc.trackChanges')} type="button">✏️</button>
      </div>

      {/* 点击外部关闭弹出面板的透明遮罩 — absolute 限制在编辑器根容器内，
          避免覆盖 header 的 tab 切换栏和 Files 菜单（fixed inset-0 会拦截 header 点击） */}
      {anyPanelOpen && (
        <div className="absolute inset-0" style={{ zIndex: 40 }} onClick={() => closeAllPanels()} />
      )}

      {/* Ribbon 内容区 */}
      <div className="flex items-stretch px-1 py-1 flex-shrink-0 border-b w-full ribbon-scroll" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', minHeight: '72px', position: 'relative', zIndex: 45 }}>
        {ribbonTab === 'home' && (<>
          <RibbonGroup label={t('doc.clipboard')}>
            <RibbonButton icon="↶" label={t('doc.undo')} onClick={() => exec('undo')} title="Ctrl+Z" />
            <RibbonButton icon="↷" label={t('doc.redo')} onClick={() => exec('redo')} title="Ctrl+Y" />
          </RibbonGroup>
          <RibbonGroup label={t('doc.font')}>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <select value={activeFont} onChange={e => setFont(e.target.value)} className="text-xs rounded-md px-2 ribbon-input" style={{ width: 110, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', height: 26 }}>{FONTS.map(f => <option key={f.value} value={f.value}>{f.name}</option>)}</select>
                <input
                  type="text"
                  value={activeFontSize.replace(/px$/, '')}
                  placeholder={t('doc.size.body').replace('px','')}
                  onChange={e => {
                    const raw = e.target.value.trim()
                    if (raw === '') { setFontSize(''); return }
                    const num = parseFloat(raw)
                    if (!isNaN(num) && num > 0) setFontSize(`${num}px`)
                  }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  list="font-size-list"
                  className="text-xs rounded-md px-2 ribbon-input"
                  style={{ width: 56, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', height: 26 }}
                  title={t('doc.fontSize')}
                />
                <datalist id="font-size-list">
                  {FONT_SIZES.map(s => <option key={s.value} value={s.value.replace('px','')} />)}
                </datalist>
              </div>
              <div className="flex items-center gap-0.5">
                <button onClick={() => exec('bold')} className={`toolbar-btn ${activeMarks.has('bold') ? 'active' : ''}`} title={t('doc.bold') + ' Ctrl+B'} type="button" style={{ width: 28, height: 26 }}><b>B</b></button>
                <button onClick={() => exec('italic')} className={`toolbar-btn ${activeMarks.has('italic') ? 'active' : ''}`} title={t('doc.italic') + ' Ctrl+I'} type="button" style={{ width: 28, height: 26 }}><i>I</i></button>
                <button onClick={() => exec('underline')} className={`toolbar-btn ${activeMarks.has('underline') ? 'active' : ''}`} title={t('doc.underline') + ' Ctrl+U'} type="button" style={{ width: 28, height: 26 }}><u>U</u></button>
                <button onClick={() => exec('strikethrough')} className={`toolbar-btn ${activeMarks.has('strikethrough') ? 'active' : ''}`} title={t('doc.strikethrough')} type="button" style={{ width: 28, height: 26 }}><s>S</s></button>
                <button onClick={() => exec('superscript')} className={`toolbar-btn ${activeMarks.has('superscript') ? 'active' : ''}`} title={t('doc.superscript')} type="button" style={{ width: 28, height: 26 }}>X²</button>
                <button onClick={() => exec('subscript')} className={`toolbar-btn ${activeMarks.has('subscript') ? 'active' : ''}`} title={t('doc.subscript')} type="button" style={{ width: 28, height: 26 }}>X₂</button>
                <div className="relative">
                  <button className="toolbar-btn" title={t('doc.textColor')} type="button" style={{ width: 28, height: 26, borderBottom: `3px solid ${activeColor || '#333'}` }} onClick={() => openPanel('color')} />
                  {showColorPopup && (
                    <div className="absolute top-full ribbon-popup" style={{ left: 0, right: 'auto', zIndex: 50 }}>
                      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(6, 28px)' }}>
                        {COLORS.map(c => <button key={c} onClick={() => { setTextColor(c); closeAllPanels() }} className="rounded-md transition-transform hover:scale-110" style={{ width: 28, height: 28, background: c, border: '1px solid var(--color-border)' }} type="button" />)}
                      </div>
                    </div>
                  )}
                </div>
                <div className="relative">
                  <button className="toolbar-btn" title={t('doc.highlight')} type="button" style={{ width: 28, height: 26, background: 'linear-gradient(180deg, transparent 60%, #fef08a 60%)' }} onClick={() => openPanel('highlight')} />
                  {showHighlightPopup && (
                    <div className="absolute top-full ribbon-popup" style={{ left: 0, right: 'auto', zIndex: 50 }}>
                      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(6, 28px)' }}>
                        {HL_COLORS.map(c => <button key={c} onClick={() => { setHighlight(c); closeAllPanels() }} className="rounded-md transition-transform hover:scale-110" style={{ width: 28, height: 28, background: c, border: '1px solid var(--color-border)' }} type="button" />)}
                      </div>
                    </div>
                  )}
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
            <RibbonButton icon="⬅" label={t('doc.imgFloatLeft')} onClick={() => exec('imgFloatLeft')} disabled={!activeIsImage} title={t('doc.imgFloatLeftTitle')} />
            <RibbonButton icon="➡" label={t('doc.imgFloatRight')} onClick={() => exec('imgFloatRight')} disabled={!activeIsImage} title={t('doc.imgFloatRightTitle')} />
            <RibbonButton icon="⏹" label={t('doc.imgFloatNone')} onClick={() => exec('imgFloatNone')} disabled={!activeIsImage} title={t('doc.imgFloatNoneTitle')} />
            <RibbonButton icon="—" label={t('doc.horizontalRule')} onClick={() => exec('horizontalRule')} />
            <RibbonButton icon="⏎" label={t('doc.pageBreak')} onClick={() => exec('pageBreak')} />
          </RibbonGroup>
          <RibbonGroup label={t('doc.shapes')}>
            <div className="relative">
              <RibbonButton icon="▭" label={t('doc.shapes')} onClick={() => openPanel('shape')} />
              {showShapePanel && (
                <div className="absolute top-full ribbon-popup" style={{ left: 0, right: 'auto', zIndex: 50 }}>
                  <div className="grid grid-cols-4 gap-2">
                    {[{t:'rect',i:'▭',n:t('doc.shape.rect')},{t:'roundRect',i:'▢',n:t('doc.shape.rounded')},{t:'ellipse',i:'⬭',n:t('doc.shape.ellipse')},{t:'triangle',i:'△',n:t('doc.shape.triangle')},
                     {t:'diamond',i:'◇',n:t('doc.shape.diamond')},{t:'rightArrow',i:'→',n:t('doc.shape.arrow')},{t:'star5',i:'★',n:t('doc.shape.star')},{t:'heart',i:'♥',n:t('doc.shape.heart')}].map(s => (
                      <button key={s.t} onClick={() => { exec('shape:' + s.t); setShowShapePanel(false) }} className="flex flex-col items-center gap-1 p-2 rounded-md transition-colors hover:bg-slate-100" style={{ minWidth: 56 }}>
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
              <RibbonButton icon="🎨" label={t('doc.wordArt')} onClick={() => openPanel('art')} />
              {showArtPanel && (
                <div className="absolute top-full ribbon-popup" style={{ left: 0, right: 'auto', zIndex: 50 }}>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { name: t('art.shadow') || '阴影', style: 'shadow', color: '#4f46e5', preview: 'text-shadow: 2px 2px 4px rgba(0,0,0,0.4)' },
                      { name: t('art.gradient') || '渐变', style: 'gradient', color: '#667eea', preview: 'background: linear-gradient(135deg,#667eea,#764ba2); -webkit-background-clip:text; -webkit-text-fill-color:transparent' },
                      { name: t('art.glow') || '发光', style: 'glow', color: '#10b981', preview: 'text-shadow: 0 0 10px rgba(16,185,129,0.6)' },
                      { name: t('art.outline') || '描边', style: 'outline', color: '#3b82f6', preview: '-webkit-text-stroke: 1px #3b82f6; -webkit-text-fill-color:transparent' },
                      { name: t('art.3d') || '3D', style: '3d', color: '#f59e0b', preview: 'text-shadow: 1px 1px 0 #ccc, 2px 2px 0 #bbb, 3px 3px 6px rgba(0,0,0,0.3)' },
                      { name: t('art.red') || '红字', style: 'shadow', color: '#ef4444', preview: 'color:#ef4444; text-shadow:2px 2px 4px rgba(0,0,0,0.3)' },
                    ].map(p => (
                      <button key={p.name} onClick={() => {
                        const text = prompt(t('doc.prompt.wordArt')); if (!text) return
                        const v = viewRef.current; if (!v) return
                        const marks: any[] = [schema.marks.bold.create(), schema.marks.fontSize.create({ size: '36px' }), schema.marks.wordArt.create({ style: p.style })]
                        if (p.style !== 'gradient' && p.style !== 'outline') marks.push(schema.marks.textColor.create({ color: p.color }))
                        v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.paragraph.create({ align: 'center' }, schema.text(text, marks))))
                        v.focus(); setShowArtPanel(false)
                      }} className="flex flex-col items-center gap-1 p-2 rounded-md transition-colors hover:bg-slate-100" style={{ minWidth: 72 }}>
                        <span style={{ fontSize: '18px', fontWeight: 700, color: p.color, textShadow: p.style === 'shadow' ? '2px 2px 4px rgba(0,0,0,0.4)' : p.style === 'glow' ? '0 0 10px ' + p.color : p.style === '3d' ? '1px 1px 0 #ccc, 2px 2px 0 #bbb, 3px 3px 6px rgba(0,0,0,0.3)' : 'none' }}>{p.name.charAt(0)}a</span>
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
            <div className="relative">
              <RibbonButton icon="Σ" label={t('doc.formula')} onClick={insertFormula} />
              {showFormulaPanel && (
                <div className="absolute top-full ribbon-popup" style={{ left: 0, right: 'auto', zIndex: 50, padding: '12px', minWidth: 320 }}>
                  <div className="text-xs font-medium mb-2">{t('doc.commonFormulas') || '常用公式'}</div>
                  <div className="grid grid-cols-4 gap-1 mb-3">
                    {[
                      { l: 'a²+b²=c²', v: 'a^2+b^2=c^2' },
                      { l: '½', v: '\\frac{1}{2}' },
                      { l: '√x', v: '\\sqrt{x}' },
                      { l: 'x²', v: 'x^2' },
                      { l: 'xₙ', v: 'x_n' },
                      { l: '∑', v: '\\sum_{i=1}^{n}' },
                      { l: '∫', v: '\\int_0^1' },
                      { l: '∞', v: '\\infty' },
                      { l: '≠', v: '\\neq' },
                      { l: '≤', v: '\\leq' },
                      { l: '≥', v: '\\geq' },
                      { l: '±', v: '\\pm' },
                    ].map(f => (
                      <button key={f.l} onClick={() => insertLatexFormula(f.v)} className="p-2 rounded hover:bg-slate-100 text-sm" style={{ minWidth: 48 }}>{f.l}</button>
                    ))}
                  </div>
                  <div className="text-xs font-medium mb-2">{t('doc.customFormula') || '自定义 LaTeX'}</div>
                  <div className="flex gap-2">
                    <input type="text" placeholder="x = (-b ± √(b²-4ac)) / 2a" id="formula-input" className="flex-1 text-xs rounded px-2 py-1" style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }} onKeyDown={e => { if (e.key === 'Enter') { const v = (e.target as HTMLInputElement).value; if (v) insertLatexFormula(v) } }} />
                    <button onClick={() => { const inp = window.document.getElementById('formula-input') as HTMLInputElement; if (inp && inp.value) insertLatexFormula(inp.value) }} className="btn btn-primary btn-sm">OK</button>
                  </div>
                </div>
              )}
            </div>
            <div className="relative">
              <RibbonButton icon="Ω" label={t('doc.symbols') || '符号'} onClick={() => openPanel2('symbol')} />
              {showSymbolPanel && (
                <div className="absolute top-full ribbon-popup" style={{ left: 0, right: 'auto', zIndex: 50, padding: '12px', minWidth: 360 }}>
                  <div className="flex gap-1 mb-2 flex-wrap">
                    {[
                      { k: 'greek', l: t('sym.greek') || '希腊' },
                      { k: 'latin', l: t('sym.latin') || '拉丁' },
                      { k: 'circled', l: t('sym.circled') || '圈号' },
                      { k: 'roman', l: t('sym.roman') || '罗马' },
                      { k: 'math', l: t('sym.math') || '数学' },
                      { k: 'arrows', l: t('sym.arrows') || '箭头' },
                    ].map(c => (
                      <button key={c.k} onClick={() => setSymbolCategory(c.k as any)} className="text-xs px-2 py-1 rounded" style={{ background: symbolCategory === c.k ? 'var(--color-primary)' : 'var(--color-bg-alt)', color: symbolCategory === c.k ? 'white' : 'var(--color-text)' }}>{c.l}</button>
                    ))}
                  </div>
                  <div className="grid grid-cols-8 gap-1" style={{ maxHeight: 200, overflowY: 'auto' }}>
                    {symbolCategory === 'greek' && 'αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ'.split('').map((s, i) => (
                      <button key={i} onClick={() => insertSymbol(s)} className="p-1.5 rounded hover:bg-slate-100 text-sm" style={{ minWidth: 32 }}>{s}</button>
                    ))}
                    {symbolCategory === 'latin' && 'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ'.split('').map((s, i) => (
                      <button key={i} onClick={() => insertSymbol(s)} className="p-1.5 rounded hover:bg-slate-100 text-sm" style={{ minWidth: 32 }}>{s}</button>
                    ))}
                    {symbolCategory === 'circled' && '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳⓪ⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙ'.split('').map((s, i) => (
                      <button key={i} onClick={() => insertSymbol(s)} className="p-1.5 rounded hover:bg-slate-100 text-sm" style={{ minWidth: 32 }}>{s}</button>
                    ))}
                    {symbolCategory === 'roman' && 'ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹⅺⅻ'.split('').map((s, i) => (
                      <button key={i} onClick={() => insertSymbol(s)} className="p-1.5 rounded hover:bg-slate-100 text-sm" style={{ minWidth: 32 }}>{s}</button>
                    ))}
                    {symbolCategory === 'math' && '±×÷·∗∘∝∞∠∡∇∂√∫∮∑∏⊕⊗⊥∥≡≅≈≠≤≥≪≫∈∉∩∪⊂⊃⊆⊇∅∀∃¬∧∨⇒⇔'.split('').map((s, i) => (
                      <button key={i} onClick={() => insertSymbol(s)} className="p-1.5 rounded hover:bg-slate-100 text-sm" style={{ minWidth: 32 }}>{s}</button>
                    ))}
                    {symbolCategory === 'arrows' && '←↑→↓↔↕↖↗↘↙⇄⇅⇒⇐⇔⇑⇓⇕⟶⟵⟷'.split('').map((s, i) => (
                      <button key={i} onClick={() => insertSymbol(s)} className="p-1.5 rounded hover:bg-slate-100 text-sm" style={{ minWidth: 32 }}>{s}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </RibbonGroup>
          <RibbonGroup label={t('doc.link')}>
            <RibbonButton icon="⚓" label={t('doc.bookmark')} onClick={() => exec('bookmark')} />
            <RibbonButton icon="🔗" label={t('doc.hyperlink')} onClick={insertLink} />
          </RibbonGroup>
          <RibbonGroup label={t('doc.toc') || '目录'}>
            <RibbonButton icon="📑" label={t('doc.autoToc') || '自动目录'} onClick={() => {
              const v = viewRef.current; if (!v) return
              // Scan document for headings and build a TOC
              const headings: { level: number; text: string; pos: number }[] = []
              v.state.doc.descendants((node, pos) => {
                if (node.type.name === 'heading') {
                  headings.push({ level: node.attrs.level, text: node.textContent, pos })
                }
              })
              if (headings.length === 0) { alert(t('doc.noHeadingsForToc') || '没有标题，无法生成目录'); return }
              // Build TOC paragraphs
              const tocNodes: any[] = []
              tocNodes.push(schema.nodes.paragraph.create({ align: 'center' }, schema.text(t('doc.tocTitle') || '目录', [schema.marks.bold.create(), schema.marks.fontSize.create({ size: '18px' })])))
              headings.forEach(h => {
                const indent = '  '.repeat(h.level - 1)
                const dotLeader = ' ' + '·'.repeat(Math.max(3, 40 - h.text.length - indent.length))
                tocNodes.push(schema.nodes.paragraph.create({ indent: h.level - 1 }, schema.text(indent + h.text + dotLeader)))
              })
              // Insert at cursor position
              const tr = v.state.tr
              let pos = v.state.selection.from
              tocNodes.forEach(node => {
                tr.insert(pos, node)
                pos += node.nodeSize
              })
              v.dispatch(tr)
              v.focus()
            }} title={t('doc.autoTocTitle') || '从标题自动生成目录'} />
            <RibbonButton icon="📋" label={t('doc.manualToc') || '手动目录'} onClick={() => {
              const v = viewRef.current; if (!v) return
              const text = prompt(t('doc.prompt.tocEntry') || '输入目录条目（每行一个）')
              if (!text) return
              const lines = text.split('\n').filter(l => l.trim())
              const tocNodes: any[] = [schema.nodes.paragraph.create({ align: 'center' }, schema.text(t('doc.tocTitle') || '目录', [schema.marks.bold.create(), schema.marks.fontSize.create({ size: '18px' })]))]
              lines.forEach(line => {
                const level = line.startsWith('  ') ? 2 : 1
                tocNodes.push(schema.nodes.paragraph.create({ indent: level - 1 }, schema.text(line.trim())))
              })
              const tr = v.state.tr
              let pos = v.state.selection.from
              tocNodes.forEach(node => { tr.insert(pos, node); pos += node.nodeSize })
              v.dispatch(tr)
              v.focus()
            }} title={t('doc.manualTocTitle') || '手动输入目录条目'} />
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
            <div className="relative">
              <button className="toolbar-btn" title={t('doc.shading')} type="button" style={{ width: 40, height: 32, background: activeAttrs.shading || 'transparent' }} onClick={() => openPanel('shading')} />
              {showShadingPopup && (
                <div className="absolute top-full ribbon-popup" style={{ left: 0, right: 'auto', padding: '0.625rem', zIndex: 50 }}>
                  <div className="grid grid-cols-6 gap-1.5">
                    {['','#f1f5f9','#fef3c7','#dbeafe','#dcfce7','#fce7f3'].map(c => <button key={c} onClick={() => { setParaAttr('shading', c); closeAllPanels() }} className="w-6 h-6 rounded-md transition-transform hover:scale-110" style={{ background: c || 'white', border: '1px solid var(--color-border)' }} type="button" />)}
                  </div>
                </div>
              )}
            </div>
          </RibbonGroup>
          <RibbonGroup label={t('doc.layout')}>
            <RibbonButton icon="🅰" label={t('doc.dropCap')} onClick={() => exec('dropCap')} active={activeAttrs.dropCap} />
            <RibbonButton icon="⇄" label="RTL" onClick={() => exec('toggleRTL')} active={activeAttrs.rtl} />
            <RibbonButton icon="💧" label={t('doc.watermark')} onClick={applyWatermark} />
          </RibbonGroup>
          {/* MS Office 风格页面设置 */}
          <RibbonGroup label={t('doc.pageSetup')}>
            <div className="flex flex-col gap-1">
              <select
                data-testid="page-size-select"
                value={activeAttrs.pageSize || 'A4'}
                onChange={e => setParaAttr('pageSize', e.target.value)}
                className="text-xs rounded-md px-2 py-1"
                style={{ width: 90, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                title={t('doc.pageSize')}
              >
                <option value="A4">A4</option>
                <option value="A3">A3</option>
                <option value="A5">A5</option>
                <option value="B5">B5</option>
                <option value="Letter">Letter</option>
                <option value="Legal">Legal</option>
              </select>
              <select
                data-testid="orientation-select"
                value={activeAttrs.orientation || 'portrait'}
                onChange={e => setParaAttr('orientation', e.target.value)}
                className="text-xs rounded-md px-2 py-1"
                style={{ width: 90, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                title={t('doc.orientation')}
              >
                <option value="portrait">{t('doc.portrait')}</option>
                <option value="landscape">{t('doc.landscape')}</option>
              </select>
            </div>
            <RibbonButton icon="📄" label={t('doc.margins')} onClick={() => {
              const preset = prompt(t('doc.marginsPrompt') + ' (top,bottom,left,right cm)', '2.54,2.54,2.54,2.54')
              if (preset) {
                const parts = preset.split(',').map(s => parseFloat(s.trim()))
                if (parts.length === 4 && parts.every(v => !isNaN(v) && v > 0)) {
                  // cm → px (1cm ≈ 37.8px)
                  setDocMargins({ top: Math.round(parts[0] * 37.8), bottom: Math.round(parts[1] * 37.8), left: Math.round(parts[2] * 37.8), right: Math.round(parts[3] * 37.8) })
                }
              }
            }} title={t('doc.marginsTitle')} />
            <RibbonButton icon="ǁ" label={t('doc.columns')} onClick={() => {
              const n = parseInt(prompt(t('doc.columnsPrompt'), '2') || '1')
              if (n > 0 && n <= 4) setDocColumns(n)
            }} title={t('doc.columnsTitle')} />
            <RibbonButton icon="🔢" label={t('doc.lineNumber')} onClick={() => setDocLineNumbers(!docLineNumbers)} active={docLineNumbers} title={t('doc.lineNumberTitle')} />
            <RibbonButton icon="📑" label={t('doc.pageBreakInsert')} onClick={() => exec('pageBreak')} title={t('doc.pageBreakInsertTitle')} />
          </RibbonGroup>
          {/* 页眉页脚 */}
          <RibbonGroup label={t('doc.headerFooter')}>
            <RibbonButton icon="📄" label={t('doc.header')} onClick={() => {
              const h = prompt(t('doc.headerPrompt'), docHeader)
              if (h !== null) setDocHeader(h)
            }} title={t('doc.headerTitle')} />
            <RibbonButton icon="📃" label={t('doc.footer')} onClick={() => {
              const f = prompt(t('doc.footerPrompt'), docFooter)
              if (f !== null) setDocFooter(f)
            }} title={t('doc.footerTitle')} />
            <RibbonButton icon="🔢" label={t('doc.pageNum')} onClick={() => {
              // Toggle page number in footer — only insert once, not append every click
              if (pageNumInserted) {
                // Remove page number from footer
                const cleaned = docFooter.replace(/\s*·\s*第 \d+ 页\s*$/, '').replace(/^第 \d+ 页\s*·\s*/, '')
                setDocFooter(cleaned)
                setPageNumInserted(false)
              } else {
                // Insert page number
                const pn = '第 1 页'
                setDocFooter(docFooter ? `${docFooter} · ${pn}` : pn)
                setPageNumInserted(true)
              }
            }} title={t('doc.pageNumTitle')} />
          </RibbonGroup>
          <RibbonGroup label="公文 GB/T 9704">
            <RibbonButton icon="📜" label="公文模板" onClick={() => {
              // 应用政府公文标准排版: 3号仿宋 + 固定28磅 + 首行缩进2字符
              setParaAttr('lineHeight', '28pt')
              setParaAttr('indent', 2)
              setParaAttr('align', 'justify')
            }} title="应用 GB/T 9704-2012 政府公文标准排版" />
            <RibbonButton icon="🇨" label="红头线" onClick={() => setParaAttr('border', activeAttrs.border === 'redBottom' ? '' : 'redBottom')} active={activeAttrs.border === 'redBottom'} title="红色分隔线" />
          </RibbonGroup>
        </>)}
        {ribbonTab === 'review' && (<>
          <RibbonGroup label={t('doc.proofing')}>
            <RibbonButton icon="🔍" label={t('doc.findReplace')} onClick={() => setSearchOpen(!searchOpen)} />
            <RibbonButton icon={spellErrors.length > 0 ? '❗' : '✓'} label={spellErrors.length > 0 ? `${t('doc.spell')}(${spellErrors.length})` : t('doc.spell')} onClick={() => {
              if (spellErrors.length > 0) {
                // Jump to first spell error
                const v = viewRef.current; if (!v) return
                const ss = getSearchState(v)
                if (ss && ss.matches.length > 0) { nextMatch(v) }
                else { alert(t('doc.spellNoErrors') || 'No spelling errors') }
              } else {
                // Trigger spell check
                const v = viewRef.current; if (!v) return
                if (onSpellCheckRef.current) onSpellCheckRef.current(v.state.doc.textContent)
              }
            }} title={spellErrors.length > 0 ? (t('doc.spellJumpTitle') || 'Jump to next spelling error') : (t('doc.spellRunTitle') || 'Run spell check')} />
            <RibbonButton icon="🌐" label={t('doc.translate')} onClick={() => {
              const text = viewRef.current?.state.doc.textContent || ''
              if (text) window.open(`https://translate.google.com/?text=${encodeURIComponent(text.slice(0, 500))}`, '_blank')
            }} title={t('doc.translateTitle')} />
            <RibbonButton icon="🔊" label={t('doc.readAloud')} onClick={() => {
              const text = viewRef.current?.state.doc.textContent || ''
              if (text && 'speechSynthesis' in window) {
                const u = new SpeechSynthesisUtterance(text.slice(0, 1000))
                u.lang = 'zh-CN'
                speechSynthesis.speak(u)
              }
            }} title={t('doc.readAloudTitle')} />
          </RibbonGroup>
          <RibbonGroup label={t('doc.revision')}>
            <RibbonButton icon="✏️" label={t('doc.revisionMode')} onClick={() => setTrackChanges(!trackChanges)} active={trackChanges} />
            <RibbonButton icon="💬" label={t('doc.annotation')} onClick={() => exec('comment')} />
            <RibbonButton icon="📥" label={t('doc.acceptAll')} onClick={() => setTrackChanges(false)} title={t('doc.acceptAllTitle')} />
            <RibbonButton icon="📤" label={t('doc.rejectAll')} onClick={() => setTrackChanges(false)} title={t('doc.rejectAllTitle')} />
          </RibbonGroup>
          {/* MS Office 风格字数统计 (详细) */}
          <RibbonGroup label={t('doc.wordCount')}>
            <div className="flex flex-col items-center justify-center px-3 py-1 text-xs rounded-md" style={{ color: 'var(--color-text-muted)', background: 'var(--color-bg-alt)' }}>
              <div className="flex gap-3 items-baseline">
                <div className="text-center">
                  <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--color-primary)' }}>{viewRef.current?.state.doc.textContent.length || 0}</div>
                  <div style={{ fontSize: '9px' }}>{t('doc.chars')}</div>
                </div>
                <div className="text-center">
                  <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text)' }}>{(viewRef.current?.state.doc.textContent || '').split(/\s+/).filter(Boolean).length}</div>
                  <div style={{ fontSize: '9px' }}>{t('doc.words')}</div>
                </div>
                <div className="text-center">
                  <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text)' }}>{(viewRef.current?.state.doc.textContent || '').split(/[。！？.!?]+/).filter(Boolean).length}</div>
                  <div style={{ fontSize: '9px' }}>{t('doc.sentences')}</div>
                </div>
                <div className="text-center">
                  <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text)' }}>{(viewRef.current?.state.doc.textContent || '').split(/\n+/).filter(Boolean).length}</div>
                  <div style={{ fontSize: '9px' }}>{t('doc.paragraphs')}</div>
                </div>
              </div>
            </div>
          </RibbonGroup>
          {/* 比较与保护 */}
          <RibbonGroup label={t('doc.compare')}>
            <RibbonButton icon="⚖️" label={t('doc.compare')} onClick={() => alert(t('doc.comparePlaceholder'))} title={t('doc.compareTitle')} />
            <RibbonButton icon="🔒" label={t('doc.protect')} onClick={() => setParaAttr('protected', !activeAttrs.protected)} active={activeAttrs.protected} title={t('doc.protectTitle')} />
          </RibbonGroup>
        </>)}

        {ribbonTab === 'view' && (<>
          <RibbonGroup label={t('doc.zoom')}>
            <RibbonButton icon="−" label={t('doc.zoomOut')} onClick={() => setZoom(Math.max(50, zoom - 10))} />
            <div className="flex flex-col items-center px-1">
              <input
                type="number"
                value={zoom}
                min={50}
                max={300}
                onChange={e => {
                  const v = parseInt(e.target.value) || 100
                  setZoom(Math.max(50, Math.min(300, v)))
                }}
                className="text-center text-xs rounded w-12 px-1 py-0.5"
                style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                title={t('doc.zoom')}
              />
              <span style={{ fontSize: '9px', color: 'var(--color-text-muted)' }}>%</span>
            </div>
            <RibbonButton icon="+" label={t('doc.zoomIn')} onClick={() => setZoom(Math.min(300, zoom + 10))} />
            <RibbonButton icon="▮" label="100%" onClick={() => setZoom(100)} />
          </RibbonGroup>
          {/* 背景色 / 护眼模式 */}
          <RibbonGroup label={t('doc.pageBg')}>
            <div className="relative">
              <button className="toolbar-btn" title={t('doc.pageBg')} type="button" style={{ width: 40, height: 32, background: bgColor }} onClick={() => openPanel('bgColor')} />
              {showBgColorPopup && (
                <div className="absolute top-full ribbon-popup" style={{ left: 0, right: 'auto', padding: '0.625rem', zIndex: 50 }}>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[['#ffffff', t('doc.bgWhite')], ['#c7edcc', t('doc.bgEyeGreen')], ['#f5f5dc', t('doc.bgBeige')], ['#faf3e0', t('doc.bgCream')], ['#e8e8e8', t('doc.bgGray')], ['#fff5e6', t('doc.bgWarm')]].map(([c, n]) => (
                      <button key={c} onClick={() => { setBgColor(c as string); setEyeCareMode(c === '#c7edcc'); closeAllPanels() }} className="flex flex-col items-center gap-0.5 p-1 rounded transition-colors hover:bg-slate-100" title={n as string}>
                        <span className="w-7 h-7 rounded border" style={{ background: c, border: '1px solid var(--color-border)' }} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <RibbonButton icon="👁" label={t('doc.eyeCare')} onClick={() => { const ec = !eyeCareMode; setEyeCareMode(ec); setBgColor(ec ? '#c7edcc' : '#ffffff') }} active={eyeCareMode} title={t('doc.eyeCareTitle')} />
          </RibbonGroup>
          {/* 显示编辑标记 (¶ 段落标记 / 分页符) */}
          <RibbonGroup label={t('doc.show')}>
            <RibbonButton icon="¶" label={t('doc.showMarks')} onClick={() => setShowMarks(!showMarks)} active={showMarks} title={t('doc.showMarksTitle')} />
            <RibbonButton icon="📏" label={t('doc.ruler')} onClick={() => setShowRuler(!showRuler)} active={showRuler} title={t('doc.rulerTitle')} />
            <RibbonButton icon="📐" label={t('doc.gridlines')} onClick={() => setShowGridlines(!showGridlines)} active={showGridlines} title={t('doc.gridlinesTitle')} />
            <RibbonButton icon="🗂" label={t('doc.navPane')} onClick={() => setShowNavPane(!showNavPane)} active={showNavPane} title={t('doc.navPaneTitle')} />
          </RibbonGroup>
          {/* 窗口 */}
          <RibbonGroup label={t('doc.window')}>
            <RibbonButton icon="🪟" label={t('doc.newWindow')} onClick={() => { const v = viewRef.current; if (!v) return; const state2 = EditorState.create({ doc: v.state.doc, plugins: v.state.plugins }); const newView = new EditorView(window.window.document.createElement('div'), { state: state2 }); (window as any).__pmView2 = newView; alert(t('doc.newWindowMsg') || '已创建新编辑器视图（在同一窗口内拆分显示）') }} title={t('doc.newWindowTitle')} />
            <RibbonButton icon="↔️" label={t('doc.windowSplit')} onClick={() => setSplitWindow(!splitWindow)} active={splitWindow} title={t('doc.windowSplitTitle')} />
          </RibbonGroup>
          <RibbonGroup label={t('doc.preview')}><RibbonButton icon="🖨" label={t('doc.printPreview')} onClick={() => setPrintDialogOpen(true)} data-testid="word-print-btn" /></RibbonGroup>
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
          <div className="toolbar-divider" />
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('doc.tableAlign') || '表格对齐'}:</span>
          <button onClick={() => exec('tableAlignLeft')} className="toolbar-btn" title={t('doc.tableAlignLeft') || '表格左对齐'} type="button">⟸</button>
          <button onClick={() => exec('tableAlignCenter')} className="toolbar-btn" title={t('doc.tableAlignCenter') || '表格居中'} type="button">⟺</button>
          <button onClick={() => exec('tableAlignRight')} className="toolbar-btn" title={t('doc.tableAlignRight') || '表格右对齐'} type="button">⟹</button>
        </div>
      )}

      {/* Mini 浮动工具栏 — 边界检测 + click 触发颜色弹出菜单（与主 ribbon 统一） */}
      {showMiniToolbar && (() => {
        const TOOLBAR_W = 300, TOOLBAR_H = 40
        const POPUP_W = 200, POPUP_H = 80
        const vw = window.innerWidth, vh = window.innerHeight
        let mx = miniToolbarPos.x, my = miniToolbarPos.y
        if (mx + TOOLBAR_W > vw - 8) mx = Math.max(8, vw - TOOLBAR_W - 8)
        if (my < 8) my = 8
        if (my + TOOLBAR_H + POPUP_H > vh - 8) my = Math.max(8, vh - TOOLBAR_H - POPUP_H - 8)
        return (
        <>
          {showMiniColorPopup && <div className="fixed inset-0 z-40" onClick={() => setShowMiniColorPopup(false)} />}
          <div className="fixed z-50 flex items-center gap-0.5 px-2 py-1 rounded-lg shadow-xl animate-fade-in" style={{ left: mx, top: my, background: 'var(--color-surface)', border: '1px solid var(--color-border)' }} onMouseDown={e => e.preventDefault()}>
            <button onClick={() => exec('bold')} className={`toolbar-btn ${activeMarks.has('bold') ? 'active' : ''}`} style={{ width: 28, height: 26 }}><b>B</b></button>
            <button onClick={() => exec('italic')} className={`toolbar-btn ${activeMarks.has('italic') ? 'active' : ''}`} style={{ width: 28, height: 26 }}><i>I</i></button>
            <button onClick={() => exec('underline')} className={`toolbar-btn ${activeMarks.has('underline') ? 'active' : ''}`} style={{ width: 28, height: 26 }}><u>U</u></button>
            <div className="toolbar-divider" />
            <div className="relative">
              <button className="toolbar-btn" title={t('doc.color')} type="button" style={{ width: 28, height: 26, borderBottom: `3px solid ${activeColor || '#333'}` }} onClick={() => setShowMiniColorPopup(!showMiniColorPopup)} />
              {showMiniColorPopup && (
                <div className="absolute ribbon-popup" style={{ bottom: '100%', left: 0, right: 'auto', top: 'auto', padding: '0.5rem', marginBottom: '4px', zIndex: 51 }}>
                  <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(6, 20px)' }}>
                    {COLORS.map(c => <button key={c} onClick={() => { setTextColor(c); setShowMiniColorPopup(false) }} className="rounded transition-transform hover:scale-110" style={{ width: 20, height: 20, background: c, border: '1px solid var(--color-border)' }} type="button" />)}
                  </div>
                </div>
              )}
            </div>
            <div className="toolbar-divider" />
            <button onClick={() => exec('h1')} className="toolbar-btn" title={t('doc.heading1')} style={{ width: 28, height: 26 }}>H1</button>
            <button onClick={() => exec('h2')} className="toolbar-btn" title={t('doc.heading2')} style={{ width: 28, height: 26 }}>H2</button>
          </div>
        </>
        )
      })()}

      {/* 右键菜单 — 边界检测防止越界 */}
      {showContextMenu && (() => {
        const MENU_W = 180, MENU_H = 230
        const vw = window.innerWidth, vh = window.innerHeight
        let cx = contextMenuPos.x, cy = contextMenuPos.y
        if (cx + MENU_W > vw - 8) cx = Math.max(8, vw - MENU_W - 8)
        if (cy + MENU_H > vh - 8) cy = Math.max(8, vh - MENU_H - 8)
        return (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowContextMenu(false)} />
          <div className="fixed z-50 py-1.5 rounded-lg shadow-xl animate-fade-in" style={{ left: cx, top: cy, background: 'var(--color-surface)', border: '1px solid var(--color-border)', minWidth: 180 }}>
            <button onClick={() => exec('bold')} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}><b>B</b> {t('doc.bold')}</button>
            <button onClick={() => exec('italic')} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}><i>I</i> {t('doc.italic')}</button>
            <button onClick={() => exec('underline')} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}><u>U</u> {t('doc.underline')}</button>
            <div className="my-1 mx-3 h-px" style={{ background: 'var(--color-border)' }} />
            <button onClick={() => { setSearchOpen(true); setShowContextMenu(false) }} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>🔍 {t('doc.findReplace')}</button>
            <button onClick={() => exec('comment')} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>💬 {t('doc.addComment')}</button>
            <button onClick={() => { setRibbonTab('insert'); setShowContextMenu(false) }} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>📊 {t('doc.insertTable')}</button>
          </div>
        </>
        )
      })()}

      {watermark && (<div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%) rotate(-30deg)', fontSize: '72px', color: 'rgba(0,0,0,0.08)', pointerEvents: 'none', zIndex: 5, whiteSpace: 'nowrap' }}>{watermark}</div>)}

      {/* 导航窗口 (Navigation Pane) */}
      {showNavPane && (
        <div className="flex-shrink-0 overflow-auto animate-fade-in" style={{ width: 200, background: 'var(--color-surface)', borderRight: '1px solid var(--color-border)', padding: '8px 12px' }}>
          <div className="text-xs font-medium mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('doc.navPane') || '导航'}</div>
          {viewRef.current?.state.doc.content.firstChild ? (() => {
            const headings: { level: number; text: string; pos: number }[] = []
            viewRef.current.state.doc.descendants((node, pos) => {
              if (node.type.name === 'heading') {
                headings.push({ level: node.attrs.level, text: node.textContent, pos })
              }
            })
            if (headings.length === 0) return <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('doc.noHeadings') || '无标题'}</div>
            return headings.map((h, i) => (
              <div key={i} className="text-xs cursor-pointer hover:bg-slate-100 rounded px-1 py-0.5" style={{ marginLeft: (h.level - 1) * 12, color: 'var(--color-text-secondary)' }}
                onClick={() => { const v = viewRef.current; if (v) { v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(h.pos)))); v.focus() } }}>
                {h.text || `(H${h.level})`}
              </div>
            ))
          })() : null}
        </div>
      )}

      <div
        className={`flex-1 overflow-auto ${showMarks ? 'show-edit-marks' : ''} ${splitWindow ? 'flex' : ''}`}
        style={{ background: 'var(--color-bg-alt)', position: 'relative', zIndex: 1 }}
      >
        <div
          className="max-w-4xl mx-auto animate-fade-in"
          style={{
            boxShadow: '0 0 32px rgba(15, 23, 42, 0.06)',
            marginTop: '24px',
            marginBottom: '24px',
            borderRadius: '8px',
            background: bgColor,
            minHeight: 'calc(100% - 48px)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* 页眉 */}
          {(docHeader || docLineNumbers) && (
            <div style={{
              padding: `${Math.round(docMargins.top * 0.3)}px ${docMargins.right}px ${docMargins.top * 0.3}px ${docMargins.left}px`,
              borderBottom: '1px solid var(--color-border)',
              fontSize: '12px',
              color: 'var(--color-text-muted)',
              textAlign: 'center',
              minHeight: docHeader ? 'auto' : '0',
              display: docHeader ? 'block' : 'none',
            }}>
              {docHeader}
            </div>
          )}
          {/* 编辑器主体 — 应用页边距 + 分栏 */}
          <div style={{ position: 'relative', display: 'flex', flex: 1 }}>
            {/* 行号 */}
            {docLineNumbers && (
              <div style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: '40px',
                borderRight: '1px solid var(--color-border)',
                padding: `${docMargins.top}px 4px`,
                fontSize: '11px',
                color: 'var(--color-text-muted)',
                textAlign: 'right',
                lineHeight: '1.8',
                userSelect: 'none',
                zIndex: 2,
              }}>
                {Array.from({ length: 30 }, (_, i) => (
                  <div key={i} style={{ minHeight: '1.8em' }}>{i + 1}</div>
                ))}
              </div>
            )}
            <div
              ref={editorRef as any}
              style={{
                transform: `scale(${zoom / 100})`,
                transformOrigin: 'top center',
                width: docLineNumbers ? `calc(${10000 / Math.max(zoom, 1)}% - 40px)` : `${10000 / Math.max(zoom, 1)}%`,
                maxWidth: `${100 * 100 / Math.max(zoom, 1)}%`,
                margin: '0 auto',
                padding: `${docMargins.top}px ${docMargins.right}px ${docMargins.bottom}px ${docMargins.left}px`,
                columnCount: docColumns > 1 ? docColumns : undefined,
                columnGap: docColumns > 1 ? '32px' : undefined,
                columnRule: docColumns > 1 ? '1px solid var(--color-border)' : undefined,
                background: bgColor,
                minHeight: '100%',
                position: 'relative',
              }}
              className={`${showRuler ? 'show-ruler' : ''} ${showGridlines ? 'show-gridlines' : ''} ${eyeCareMode ? 'eye-care-mode' : ''}`}
            />
          </div>
          {/* 页脚 */}
          {docFooter && (
            <div style={{
              padding: `${Math.round(docMargins.bottom * 0.3)}px ${docMargins.right}px ${Math.round(docMargins.bottom * 0.3)}px ${docMargins.left}px`,
              borderTop: '1px solid var(--color-border)',
              fontSize: '12px',
              color: 'var(--color-text-muted)',
              textAlign: 'center',
            }}>
              {docFooter}
            </div>
          )}
        </div>
      </div>

      {/* MS Office 风格打印对话框 */}
      <PrintDialog
        open={printDialogOpen}
        onClose={() => setPrintDialogOpen(false)}
        editorType="word"
        printSelector=".ProseMirror"
        renderPreview={(settings) => (
          <div className="text-xs leading-relaxed" style={{ color: '#000' }}>
            <h1 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>{document.meta?.title || t('app.untitled')}</h1>
            {(document.blocks || []).slice(0, 6).map((b: any, i: number) => (
              <p key={i} style={{ marginBottom: '4px', textIndent: b.inline?.[0]?.content ? '2em' : 0 }}>
                {(b.inline || []).map((r: any) => r.content).join('').slice(0, 80)}
              </p>
            ))}
            <div style={{ marginTop: '12px', fontSize: '10px', color: '#999' }}>- 1 -</div>
          </div>
        )}
      />
    </div>
  )
}
