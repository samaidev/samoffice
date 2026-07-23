import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { schema } from './schema'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap, toggleMark, setBlockType, wrapIn } from 'prosemirror-commands'
import { history, undo, redo } from 'prosemirror-history'
import { inputRules, wrappingInputRule, textblockTypeInputRule } from 'prosemirror-inputrules'
import { udmToProseMirror, proseMirrorToUDM } from './convert'
import { BUILTIN_STYLES, BUILTIN_STYLE_MAP, AppStyle, StyleFormat, styleDefToFormat, outlineLevelFromName } from './styles'
import { spellCheckPlugin, setSpellErrors } from './spellPlugin'
import { searchPlugin, doSearch, doReplace, doReplaceAll, nextMatch, prevMatch, getSearchState } from './searchPlugin'
import { mergeCells, splitCell, addRowAfter, addColumnAfter, deleteRow, deleteColumn, setCellAlign } from './tableCommands'
import { columnResizing, tableEditing, CellSelection } from 'prosemirror-tables'
import { useI18n } from '../../i18n'
import { PrintDialog } from '../../components/PrintDialog'
import { Dropdown } from '../../components/Dropdown'
import { Ruler } from '../../components/Ruler'
import type { Document, SpellError, PageNumberConfig, Backend } from '../../types/udm'

interface Props {
  document: Document
  spellErrors?: SpellError[]
  onChange?: (doc: Document) => void
  onSpellCheck?: (text: string) => void
  zoom?: number
  onZoomChange?: (z: number) => void
  backend?: Backend
}

type RibbonTab = 'home' | 'insert' | 'layout' | 'review' | 'view'

const LINE_HEIGHTS = [{ name: '1.0', value: '1.0' }, { name: '1.5', value: '1.5' }, { name: '1.75', value: '1.75' }, { name: '2.0', value: '2.0' }, { name: '固定28pt (公文)', value: '28pt' }, { name: '固定30pt', value: '30pt' }]
const COLORS = ['#000000','#374151','#6B7280','#9CA3AF','#EF4444','#F59E0B','#10B981','#3B82F6','#6366F1','#8B5CF6','#EC4899','#6B7280']
const HL_COLORS = ['#fef08a','#bbf7d0','#bfdbfe','#fbcfe8','#fed7aa','#e9d5ff']

function readBool(key: string): boolean {
  try { return localStorage.getItem(key) === '1' } catch { return false }
}

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

function StyleEditor({ name, initial, onCancel, onSave }: { name: string; initial: StyleFormat; onCancel: () => void; onSave: (f: StyleFormat) => void }) {
  const { t } = useI18n()
  const [fontSize, setFontSize] = useState(initial.fontSize || '')
  const [bold, setBold] = useState(!!initial.bold)
  const [italic, setItalic] = useState(!!initial.italic)
  const [color, setColor] = useState(initial.color || '#000000')
  const [align, setAlign] = useState(initial.align || 'left')
  const save = () => {
    const f: StyleFormat = { bold, italic, color, align }
    if (fontSize) f.fontSize = fontSize
    onSave(f)
  }
  return (
    <div className="style-editor">
      <div className="style-editor-title">{name}</div>
      <label className="style-field"><span>{t('doc.fontSize')}</span><input value={fontSize} onChange={(e) => setFontSize(e.target.value)} placeholder="15px" /></label>
      <label className="style-field"><span>{t('doc.bold')}</span><input type="checkbox" checked={bold} onChange={(e) => setBold(e.target.checked)} /></label>
      <label className="style-field"><span>{t('doc.italic')}</span><input type="checkbox" checked={italic} onChange={(e) => setItalic(e.target.checked)} /></label>
      <label className="style-field"><span>{t('doc.color')}</span><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
      <label className="style-field"><span>{t('doc.align')}</span>
        <Dropdown
          className="ribbon-input"
          style={{ width: 140, height: 26 }}
          value={align}
          onChange={v => setAlign(v)}
          options={[
            { label: t('doc.alignLeft'), value: 'left' },
            { label: t('doc.alignCenter'), value: 'center' },
            { label: t('doc.alignRight'), value: 'right' },
            { label: t('doc.alignJustify'), value: 'justify' },
          ]}
        />
      </label>
      <div className="style-editor-actions">
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>{t('doc.cancel')}</button>
        <button className="btn btn-primary btn-sm" onClick={save}>{t('doc.save')}</button>
      </div>
    </div>
  )
}

const PAGE_NUM_FORMATS = [
  { label: '第 {n} 页', value: '第 {n} 页' },
  { label: '第 {n} / 共 {total} 页', value: '第 {n} / 共 {total} 页' },
  { label: '{n}', value: '{n}' },
  { label: 'Page {n} of {total}', value: 'Page {n} of {total}' },
  { label: '— {n} —', value: '— {n} —' },
]

function PageNumberDialog({ value, onClose, onSave }: {
  value: PageNumberConfig | null
  onClose: () => void
  onSave: (pn: PageNumberConfig) => void
}) {
  const { t } = useI18n()
  const [format, setFormat] = useState(value?.format || '第 {n} 页')
  const [align, setAlign] = useState<('left' | 'center' | 'right')>((value?.align as any) || 'center')
  const [fontSize, setFontSize] = useState(value?.fontSize ? String(value.fontSize / 2) : '9')
  const [color, setColor] = useState(value?.fontColor || '#000000')
  const [bold, setBold] = useState(!!value?.bold)
  const [italic, setItalic] = useState(!!value?.italic)
  const [firstDiff, setFirstDiff] = useState(!!value?.firstPageDifferent)
  const [enabled, setEnabled] = useState(!!value?.enabled)
  const save = () => {
    onSave({
      enabled, format, align,
      fontSize: Math.round(parseFloat(fontSize) * 2) || 18,
      fontColor: color, bold, italic, firstPageDifferent: firstDiff,
    })
  }
  const preview = (format || '第 {n} 页').replace('{n}', '1').replace('{total}', '3')
  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} style={{ width: 420 }}>
        <div className="modal-title">{t('doc.pageNumSettings')}</div>
        <div className="pn-form">
          <label className="pn-field"><span>{t('doc.enabled')}</span><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /></label>
          <label className="pn-field"><span>{t('doc.pnFormat')}</span>
            <Dropdown
              className="ribbon-input"
              style={{ width: 180, height: 26 }}
              value={format}
              onChange={v => setFormat(v)}
              options={PAGE_NUM_FORMATS.map(f => ({ label: f.label, value: f.value }))}
            />
          </label>
          <label className="pn-field"><span>{t('doc.align')}</span>
            <Dropdown
              className="ribbon-input"
              style={{ width: 140, height: 26 }}
              value={align}
              onChange={v => setAlign(v as any)}
              options={[
                { label: t('doc.alignLeft'), value: 'left' },
                { label: t('doc.alignCenter'), value: 'center' },
                { label: t('doc.alignRight'), value: 'right' },
              ]}
            />
          </label>
          <label className="pn-field"><span>{t('doc.fontSize')}</span><input value={fontSize} onChange={(e) => setFontSize(e.target.value)} placeholder="9" /></label>
          <label className="pn-field"><span>{t('doc.color')}</span><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
          <label className="pn-field"><span>{t('doc.bold')}</span><input type="checkbox" checked={bold} onChange={(e) => setBold(e.target.checked)} /></label>
          <label className="pn-field"><span>{t('doc.italic')}</span><input type="checkbox" checked={italic} onChange={(e) => setItalic(e.target.checked)} /></label>
          <label className="pn-field"><span>{t('doc.firstPageDifferent')}</span><input type="checkbox" checked={firstDiff} onChange={(e) => setFirstDiff(e.target.checked)} /></label>
          <div className="pn-preview" style={{
            textAlign: align, fontWeight: bold ? 700 : 400, fontStyle: italic ? 'italic' : 'normal',
            fontSize: `${fontSize}px`, color,
          }}>{preview}</div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>{t('doc.cancel')}</button>
          <button className="btn btn-primary btn-sm" onClick={save}>{t('doc.save')}</button>
        </div>
      </div>
    </div>
  )
}

function ParagraphDialog({ value, onClose, onSave }: {
  value: any
  onClose: () => void
  onSave: (d: any) => void
}) {
  const { t } = useI18n()
  const [d, setD] = useState<any>(value || {})
  const set = (k: string, v: any) => setD((prev: any) => ({ ...prev, [k]: v }))
  const lineNeedsValue = d.lineKind === 'multiple' || d.lineKind === 'exact' || d.lineKind === 'atLeast'
  const outlineOpts = [{ v: 0, l: t('doc.paraBody') }]
  for (let i = 1; i <= 9; i++) outlineOpts.push({ v: i, l: `${t('doc.outlineLevel')} ${i}` })
  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} style={{ width: 460 }}>
        <div className="modal-title">{t('doc.paraDialog')}</div>
        <div className="pn-form">
          <fieldset className="para-fieldset">
            <legend>{t('doc.paraIndent')}</legend>
            <label className="pn-field"><span>{t('doc.paraLeft')}</span><input type="number" value={d.indentLeft || 0} onChange={e => set('indentLeft', e.target.value)} style={{ width: 70 }} /><span className="pn-unit">{t('doc.paraPx')}</span></label>
            <label className="pn-field"><span>{t('doc.paraRight')}</span><input type="number" value={d.indentRight || 0} onChange={e => set('indentRight', e.target.value)} style={{ width: 70 }} /><span className="pn-unit">{t('doc.paraPx')}</span></label>
            <label className="pn-field"><span>{t('doc.paraSpecial')}</span>
              <Dropdown
                className="ribbon-input"
                style={{ width: 140, height: 26 }}
                value={d.special || 'none'}
                onChange={v => set('special', v)}
                options={[
                  { label: t('doc.paraNone'), value: 'none' },
                  { label: t('doc.paraFirstLine'), value: 'firstLine' },
                  { label: t('doc.paraHanging'), value: 'hanging' },
                ]}
              />
            </label>
            {d.special && d.special !== 'none' && (
              <label className="pn-field"><span>{t('doc.paraBy')}</span><input type="number" value={d.specialBy || 0} onChange={e => set('specialBy', e.target.value)} style={{ width: 70 }} /><span className="pn-unit">{t('doc.paraPx')}</span></label>
            )}
          </fieldset>
          <fieldset className="para-fieldset">
            <legend>{t('doc.paraSpacing')}</legend>
            <label className="pn-field"><span>{t('doc.paraBefore')}</span><input type="number" value={d.spaceBefore || 0} onChange={e => set('spaceBefore', e.target.value)} style={{ width: 70 }} /><span className="pn-unit">{t('doc.paraPt')}</span></label>
            <label className="pn-field"><span>{t('doc.paraAfter')}</span><input type="number" value={d.spaceAfter || 0} onChange={e => set('spaceAfter', e.target.value)} style={{ width: 70 }} /><span className="pn-unit">{t('doc.paraPt')}</span></label>
            <label className="pn-field"><span>{t('doc.paraLine')}</span>
              <Dropdown
                className="ribbon-input"
                style={{ width: 140, height: 26 }}
                value={d.lineKind || 'single'}
                onChange={v => set('lineKind', v)}
                options={[
                  { label: t('doc.paraLineSingle'), value: 'single' },
                  { label: t('doc.paraLine15'), value: '1.5' },
                  { label: t('doc.paraLineDouble'), value: 'double' },
                  { label: t('doc.paraLineMultiple'), value: 'multiple' },
                  { label: t('doc.paraLineExact'), value: 'exact' },
                  { label: t('doc.paraLineAtLeast'), value: 'atLeast' },
                ]}
              />
            </label>
            {lineNeedsValue && (
              <label className="pn-field"><span>{t('doc.paraLineValue')}</span><input type="number" step="0.5" value={d.lineValue || 1} onChange={e => set('lineValue', e.target.value)} style={{ width: 70 }} /><span className="pn-unit">{d.lineKind === 'multiple' ? '' : t('doc.paraPt')}</span></label>
            )}
          </fieldset>
          <fieldset className="para-fieldset">
            <legend>{t('doc.paraBreak')}</legend>
            <label className="pn-field"><span>{t('doc.paraKeepLines')}</span><input type="checkbox" checked={!!d.keepLines} onChange={e => set('keepLines', e.target.checked)} /></label>
            <label className="pn-field"><span>{t('doc.paraKeepWithNext')}</span><input type="checkbox" checked={!!d.keepWithNext} onChange={e => set('keepWithNext', e.target.checked)} /></label>
            <label className="pn-field"><span>{t('doc.paraPageBreakBefore')}</span><input type="checkbox" checked={!!d.pageBreakBefore} onChange={e => set('pageBreakBefore', e.target.checked)} /></label>
            <label className="pn-field"><span>{t('doc.paraOutline')}</span>
              <Dropdown
                className="ribbon-input"
                style={{ width: 160, height: 26 }}
                value={String(d.outlineLevel || 0)}
                onChange={v => set('outlineLevel', Number(v))}
                options={outlineOpts.map(o => ({ label: o.l, value: String(o.v) }))}
              />
            </label>
          </fieldset>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>{t('doc.paraCancel')}</button>
          <button className="btn btn-primary btn-sm" onClick={() => onSave(d)}>{t('doc.paraOk')}</button>
        </div>
      </div>
    </div>
  )
}

// 从 PM 文档中提取批注数据（对齐 MS Word 右侧批注栏：批注锚点在正文，批注卡片显示在右侧对应位置）
function extractComments(doc: any): { id: string; author: string; text: string; pos: number }[] {
  const out: { id: string; author: string; text: string; pos: number }[] = []
  doc.descendants((node: any, pos: number) => {
    if (node.type.name === 'comment_mark' && node.attrs && node.attrs.text) {
      out.push({ id: node.attrs.id, author: node.attrs.author || 'User', text: node.attrs.text, pos })
    }
  })
  return out
}

// 从 PM 文档中提取脚注数据（脚注区在编辑器内隐藏渲染，这里仅取数据用于页底脚注区展示/编辑）
function extractFootnotes(doc: any): { num: number; text: string; pos: number }[] {
  const out: { num: number; text: string; pos: number }[] = []
  doc.descendants((node: any, pos: number) => {
    if (node.type.name === 'footnote_section') {
      node.forEach((child: any, offset: number) => {
        if (child.type.name === 'footnote_item') {
          out.push({ num: child.attrs.num, text: child.textContent || '', pos: pos + 1 + offset })
        }
      })
    }
  })
  return out
}

export function DocumentEditor({ document, spellErrors = [], onChange, onSpellCheck, zoom: zoomProp, onZoomChange, backend }: Props) {
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
  // 页底脚注区数据（从 PM 文档提取，避免在正文中渲染脚注）
  const [footnotes, setFootnotes] = useState<{ num: number; text: string; pos: number }[]>([])
  // 右侧批注栏数据（对齐 MS Word：批注锚点在正文，卡片显示在右侧对应位置）
  const [comments, setComments] = useState<{ id: string; author: string; text: string; pos: number }[]>([])
  const [activeComment, setActiveComment] = useState<string | null>(null)

  const editFootnote = (f: { num: number; text: string; pos: number }) => {
    const v = viewRef.current
    if (!v) return
    const newText = prompt(t('doc.prompt.footnote') || '编辑脚注内容：', f.text)
    if (newText === null) return
    const node = v.state.doc.nodeAt(f.pos)
    if (!node || node.type.name !== 'footnote_item') return
    const item = schema.nodes.footnote_item.create({ num: f.num }, newText ? schema.text(newText) : null)
    v.dispatch(v.state.tr.replaceWith(f.pos, f.pos + node.nodeSize, item))
  }
  const deleteFootnote = (f: { num: number; text: string; pos: number }) => {
    const v = viewRef.current
    if (!v) return
    const node = v.state.doc.nodeAt(f.pos)
    if (!node || node.type.name !== 'footnote_item') return
    v.dispatch(v.state.tr.delete(f.pos, f.pos + node.nodeSize))
  }
  // 批注卡片编辑态：正在编辑的批注 id（null 表示只读查看）
  const [editingComment, setEditingComment] = useState<string | null>(null)
  const editComment = (id: string) => {
    const v = viewRef.current; if (!v) return
    const idx = comments.findIndex(c => c.id === id); if (idx < 0) return
    const cur = comments[idx]
    const newText = prompt(t('doc.prompt.comment') || '编辑批注：', cur.text)
    if (newText === null) return
    const node = v.state.doc.nodeAt(cur.pos)
    if (!node || node.type.name !== 'comment_mark') return
    const item = schema.nodes.comment_mark.create({ id: cur.id, author: cur.author, text: newText })
    const tr = v.state.tr.replaceWith(cur.pos, cur.pos + node.nodeSize, item)
    v.dispatch(tr); v.focus()
    try { setComments(extractComments(v.state.doc)) } catch (e) { /* ignore */ }
  }
  const deleteComment = (id: string) => {
    const v = viewRef.current; if (!v) return
    const cur = comments.find(c => c.id === id); if (!cur) return
    const node = v.state.doc.nodeAt(cur.pos)
    if (!node || node.type.name !== 'comment_mark') return
    v.dispatch(v.state.tr.delete(cur.pos, cur.pos + node.nodeSize))
    setActiveComment(null)
    try { setComments(extractComments(v.state.doc)) } catch (e) { /* ignore */ }
  }
  const goToComment = (id: string) => {
    const v = viewRef.current; if (!v) return
    const cur = comments.find(c => c.id === id); if (!cur) return
    const node = v.state.doc.nodeAt(cur.pos)
    if (!node || node.type.name !== 'comment_mark') return
    setActiveComment(id)
    const from = cur.pos
    const to = cur.pos + node.nodeSize
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, from, to)))
    v.focus()
  }
  const onChangeRef = useRef(onChange)
  const onSpellCheckRef = useRef(onSpellCheck)
  const trackChangesRef = useRef(false)
  // 记录本组件最近一次通过 onChange 向外发出的 UDM 引用，
  // 用于区分「外部加载了新文档」与「自身编辑回流」，避免把用户编辑覆盖回旧内容。
  const lastEmittedRef = useRef<any>(null)
  const [pageNumber, setPageNumber] = useState<PageNumberConfig | null>(() => {
    const pn = (document as any)?.pageNumber
    return pn ? { ...pn } : null
  })
  const pageNumberRef = useRef<PageNumberConfig | null>(pageNumber)
  pageNumberRef.current = pageNumber
  onChangeRef.current = onChange
  onSpellCheckRef.current = onSpellCheck

  const [styles, setStyles] = useState<Record<string, StyleFormat>>(() => {
    const init: Record<string, StyleFormat> = {}
    for (const s of (document.styles || [])) init[s.name] = styleDefToFormat(s.props)
    return init
  })
  const [showStyles, setShowStyles] = useState(false)
  const [styleSearch, setStyleSearch] = useState('')
  const [editingStyle, setEditingStyle] = useState<string | null>(null)
  const stylesRef = useRef(styles); stylesRef.current = styles


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
  const [zoomInternal, setZoomInternal] = useState<number>(() => {
    try { const z = parseInt(localStorage.getItem('samoffice_zoom') || '100', 10); return isNaN(z) ? 100 : Math.max(50, Math.min(300, z)) } catch { return 100 }
  })
  const zoom = zoomProp ?? zoomInternal
  const setZoom = (z: number) => {
    const v = Math.max(50, Math.min(300, z))
    setZoomInternal(v)
    try { localStorage.setItem('samoffice_zoom', String(v)) } catch { /* ignore */ }
    if (onZoomChange) onZoomChange(v)
  }
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
  const [bgColor, setBgColor] = useState<string>(() => {
    try { return localStorage.getItem('samoffice_bg_color') || '#ffffff' } catch { return '#ffffff' }
  })
  const setBgColorPersist = (c: string) => { try { localStorage.setItem('samoffice_bg_color', c) } catch { /* ignore */ }; setBgColor(c) }
  // View 标签页: 标尺 / 网格线 / 导航窗口 / 拆分窗口 / 护眼模式（均持久化到 localStorage）
  const [showRuler, setShowRuler] = useState<boolean>(() => readBool('samoffice_show_ruler'))
  const [showGridlines, setShowGridlines] = useState<boolean>(() => readBool('samoffice_show_gridlines'))
  const [showNavPane, setShowNavPane] = useState<boolean>(() => readBool('samoffice_show_nav'))
  const [splitWindow, setSplitWindow] = useState<boolean>(() => readBool('samoffice_split_win'))
  const persistBool = (key: string, v: boolean) => { try { localStorage.setItem(key, v ? '1' : '0') } catch { /* ignore */ } }
  const setShowRulerPersist = (v: boolean) => { persistBool('samoffice_show_ruler', v); setShowRuler(v) }
  const setShowGridlinesPersist = (v: boolean) => { persistBool('samoffice_show_gridlines', v); setShowGridlines(v) }
  const setShowNavPanePersist = (v: boolean) => { persistBool('samoffice_show_nav', v); setShowNavPane(v) }
  const setSplitWindowPersist = (v: boolean) => { persistBool('samoffice_split_win', v); setSplitWindow(v) }
  const [eyeCareMode, setEyeCareMode] = useState<boolean>(() => {
    try { return localStorage.getItem('samoffice_eye_care') === '1' } catch { return false }
  })
  const setEyeCarePersist = (ec: boolean) => { try { localStorage.setItem('samoffice_eye_care', ec ? '1' : '0') } catch { /* ignore */ }; setEyeCareMode(ec) }
  const [showPageNumDialog, setShowPageNumDialog] = useState(false)
  const [showParaDialog, setShowParaDialog] = useState(false)
  const [paraDraft, setParaDraft] = useState<any>({})
  const [compareOpen, setCompareOpen] = useState(false)
  const [compareDiff, setCompareDiff] = useState<{ type: 'add' | 'del' | 'eq'; text: string }[]>([])
  const [protectedMode, setProtectedMode] = useState(false)
  const protectPwdRef = useRef<string>('')
  // 显示编辑标记 (段落标记 ¶ / 分页符等)
  const [showMarks, setShowMarks] = useState<boolean>(() => readBool('samoffice_show_marks'))
  const setShowMarksPersist = (v: boolean) => { persistBool('samoffice_show_marks', v); setShowMarks(v) }
  // 文档级设置 (页眉/页脚/页边距/分栏/行号)
  const [docHeader, setDocHeader] = useState('')
  const [docMargins, setDocMargins] = useState({ top: 96, bottom: 96, left: 96, right: 96 })
  const [pageSize, setPageSize] = useState<'A4'|'A3'|'A5'|'B5'|'Letter'|'Legal'>('A4')
  const [orientation, setOrientation] = useState<'portrait'|'landscape'>('portrait')
  const [docColumns, setDocColumns] = useState(1)
  // 纸张物理尺寸（mm）→ 屏幕像素（96dpi: 1mm ≈ 3.7795px）
  const PAGE_SIZES_MM: Record<string, [number, number]> = {
    A4: [210, 297], A3: [297, 420], A5: [148, 210], B5: [176, 250],
    Letter: [215.9, 279.4], Legal: [215.9, 355.6],
  }
  const mmToPx = (mm: number) => Math.round(mm * 96 / 25.4)
  const [pwMm, phMm] = PAGE_SIZES_MM[pageSize] || PAGE_SIZES_MM.A4
  const pageWidthPx = mmToPx(orientation === 'landscape' ? phMm : pwMm)
  const pageHeightPx = mmToPx(orientation === 'landscape' ? pwMm : phMm)
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
        },
        math: (node) => {
          const dom = window.document.createElement(node.attrs.inline ? 'span' : 'div')
          dom.className = 'sam-math' + (node.attrs.inline ? ' sam-math-inline' : '')
          const render = () => {
            const latex = node.attrs.latex || ''
            if ((window as any).katex && latex) {
              try {
                ;(window as any).katex.render(latex, dom, { displayMode: !node.attrs.inline, throwOnError: false })
                dom.classList.remove('sam-math-error')
              } catch {
                dom.textContent = latex
                dom.classList.add('sam-math-error')
              }
            } else {
              dom.textContent = latex ? `⟨formula:${latex}⟩` : '公式'
            }
            dom.setAttribute('data-latex', latex)
            dom.title = '双击编辑公式'
            dom.style.cursor = 'pointer'
          }
          render()
          dom.addEventListener('dblclick', (e) => {
            e.preventDefault()
            const cur = node.attrs.latex || ''
            const input = prompt('编辑 LaTeX 公式：', cur)
            if (input === null) return
            const v = viewRef.current
            if (!v) return
            const pos = v.state.doc.resolve(v.state.selection.from)
            let mathPos = -1
            v.state.doc.descendants((n, p) => {
              if (n.type.name === 'math' && n.attrs.latex === cur && mathPos < 0) { mathPos = p; return false }
              return true
            })
            if (mathPos >= 0) {
              const newNode = schema.nodes.math.create({ latex: input, inline: node.attrs.inline })
              v.dispatch(v.state.tr.replaceWith(mathPos, mathPos + 1, newNode))
            }
          })
          return {
            dom,
            stopEvent: () => true,
            ignoreMutation: () => true,
          }
        },
        footnote_section: () => {
          // 脚注区在编辑器正文内隐藏渲染，实际显示在页面底部的脚注区
          const dom = window.document.createElement('div')
          dom.style.display = 'none'
          return { dom, contentDOM: dom }
        },
      },
      dispatchTransaction(tr) {
        const ns = view.state.apply(tr); view.updateState(ns)
        if (onChangeRef.current) {
          const udm = proseMirrorToUDM(ns.doc, { pageNumber: pageNumberRef.current ?? undefined })
          const overrides = stylesRef.current
          if (Object.keys(overrides).length) {
            ;(udm as any).styles = Object.keys(overrides).map((name) => ({ name, type: 'paragraph', props: overrides[name] }))
          }
          lastEmittedRef.current = udm
          onChangeRef.current(udm)
        }
        if (onSpellCheckRef.current) onSpellCheckRef.current(ns.doc.textContent)
        updateActiveState(ns)
        try { setFootnotes(extractFootnotes(ns.doc)) } catch (e) { /* ignore */ }
        try { setComments(extractComments(ns.doc)) } catch (e) { /* ignore */ }
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
        click: (_view: any, event: any) => {
          const el = event.target as HTMLElement
          const link = el?.closest?.('.sam-toc-link') as HTMLElement | null
          if (link) {
            const tid = link.getAttribute('data-target')
            if (tid) { jumpToHeading(tid); return true }
          }
          const cm = el?.closest?.('.comment-mark') as HTMLElement | null
          if (cm) {
            const cid = cm.getAttribute('data-comment-id')
            if (cid) {
              setActiveComment(cid)
              const card = window.document.getElementById(`comment-card-${cid}`)
              if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
            }
          }
          return false
        },
      },
      // === 修订追踪：输入时标记插入、删除时保留为删除线 ===
      handleTextInput(view, from, to, text) {
        if (!trackChangesRef.current) return false
        const { schema, tr } = view.state
        const insertMark = schema.marks.insert_track
        if (from !== to) {
          // 替换选区：原选区标记为删除，新文本标记为插入
          const hasDelete = view.state.doc.rangeHasMark(from, to, schema.marks.delete_track)
          if (!hasDelete) tr.addMark(from, to, schema.marks.delete_track.create({ author: 'User' }))
        }
        const insFrom = from !== to ? from : from
        tr.insertText(text, from, to)
        tr.addMark(insFrom, insFrom + text.length, insertMark.create({ author: 'User' }))
        tr.setSelection(TextSelection.create(tr.doc, insFrom + text.length))
        view.dispatch(tr)
        return true
      },
      handleKeyDown(view, event) {
        if (!trackChangesRef.current) return false
        if (event.key !== 'Backspace' && event.key !== 'Delete') return false
        const { state } = view
        const { schema } = state
        const delMark = schema.marks.delete_track
        const { from, to, empty } = state.selection
        let start = from, end = to
        if (empty) {
          if (event.key === 'Backspace') {
            if (from === 0) return false
            // 跳过块边界
            const $from = state.doc.resolve(from)
            if ($from.parentOffset === 0) return false
            start = from - 1; end = from
          } else {
            const $from = state.doc.resolve(from)
            if ($from.parentOffset === $from.parent.content.size) return false
            start = from; end = from + 1
          }
        }
        // 若该范围已是删除线，则真正删除（第二次退格生效）
        const already = state.doc.rangeHasMark(start, end, delMark)
        if (already) {
          const tr = state.tr.delete(start, end)
          tr.setSelection(TextSelection.create(tr.doc, event.key === 'Backspace' ? start : start))
          view.dispatch(tr)
          return true
        }
        const tr = state.tr.addMark(start, end, delMark.create({ author: 'User' }))
        const cursor = event.key === 'Backspace' ? start : end
        tr.setSelection(TextSelection.create(tr.doc, cursor))
        view.dispatch(tr)
        return true
      },
    })
    viewRef.current = view; ;(window as any).__pmView = view
    try { setFootnotes(extractFootnotes(doc)) } catch (e) { /* ignore */ }
    try { setComments(extractComments(doc)) } catch (e) { /* ignore */ }
    lastEmittedRef.current = document
    return () => { view.destroy(); viewRef.current = null }
  }, [])

  // 当外部（打开文件 / 新建文档）替换了 document prop 时，同步到编辑器视图。
  // 若该 document 正是本组件刚通过 onChange 发出的引用，则说明是自身编辑回流，跳过以避免光标重置与内容抖动。
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (document === lastEmittedRef.current) return
    lastEmittedRef.current = document
    const pn = (document as any)?.pageNumber
    setPageNumber(pn ? { ...pn } : null)
    const newDoc = udmToProseMirror(document, schema)
    const newState = EditorState.create({ doc: newDoc, plugins: view.state.plugins })
    view.updateState(newState)
    if (onSpellCheckRef.current) onSpellCheckRef.current(newDoc.textContent)
  }, [document])

  const updateActiveState = (state: EditorState) => {
    const marks = new Set<string>()
    const { from, $from, to, empty } = state.selection
    const attrs: any = {}
    if ($from.parent.type.name === 'paragraph' || $from.parent.type.name === 'heading') { Object.assign(attrs, { align: $from.parent.attrs.align, lineHeight: $from.parent.attrs.lineHeight, indent: $from.parent.attrs.indent, indentLeft: $from.parent.attrs.indentLeft, firstLine: $from.parent.attrs.firstLine, spaceBefore: $from.parent.attrs.spaceBefore, spaceAfter: $from.parent.attrs.spaceAfter, border: $from.parent.attrs.border, shading: $from.parent.attrs.shading, rtl: $from.parent.attrs.rtl, letterSpacing: $from.parent.attrs.letterSpacing, dropCap: $from.parent.attrs.dropCap }) }
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

  // ============ 样式系统 ============
  const resolveStyle = (name: string): StyleFormat => {
    if (styles[name]) return styles[name]
    const b = BUILTIN_STYLE_MAP[name]
    return b ? b.format : {}
  }

  const allStyles: AppStyle[] = useMemo(() => {
    const list: AppStyle[] = BUILTIN_STYLES.map((s) => ({ ...s, format: styles[s.name] ?? s.format }))
    const customNames = Object.keys(styles).filter((n) => !BUILTIN_STYLE_MAP[n])
    for (const n of customNames) list.push({ name: n, type: 'paragraph', builtin: false, format: styles[n] })
    return list
  }, [styles])

  const applyStyleMarks = (tr: any, from: number, to: number, fmt: StyleFormat) => {
    if (from >= to) return
    const m = schema.marks
    if (fmt.bold !== undefined) { if (fmt.bold) tr.addMark(from, to, m.bold.create()); else tr.removeMark(from, to, m.bold) }
    if (fmt.italic !== undefined) { if (fmt.italic) tr.addMark(from, to, m.italic.create()); else tr.removeMark(from, to, m.italic) }
    if (fmt.fontSize) { tr.removeMark(from, to, m.fontSize); tr.addMark(from, to, m.fontSize.create({ size: fmt.fontSize })) }
    if (fmt.color) { tr.removeMark(from, to, m.textColor); tr.addMark(from, to, m.textColor.create({ color: fmt.color })) }
    if (fmt.fontFamily) { tr.removeMark(from, to, m.fontFamily); tr.addMark(from, to, m.fontFamily.create({ font: fmt.fontFamily })) }
  }

  const applyStyle = (name: string, explicit?: StyleFormat) => {
    const v = viewRef.current
    if (!v) return
    const fmt = explicit ?? resolveStyle(name)
    const { state, dispatch } = v
    const tr = state.tr
    const { from, to } = state.selection
    const targets: { pos: number; node: any }[] = []
    state.doc.nodesBetween(from, to, (node: any, pos: number) => {
      if ((node.type.name === 'paragraph' || node.type.name === 'heading') && state.doc.resolve(pos).parent.type.name === 'doc') { targets.push({ pos, node }); return false }
      return true
    })
    for (const { pos, node } of targets) {
      const start = pos
      const end = pos + node.nodeSize
      if (fmt.outlineLevel && fmt.outlineLevel > 0) {
        tr.setBlockType(start, end, schema.nodes.heading, { level: fmt.outlineLevel, id: node.attrs.id || '', style: name, align: fmt.align ?? node.attrs.align })
      } else {
        tr.setBlockType(start, end, schema.nodes.paragraph, { style: name, align: fmt.align ?? node.attrs.align })
      }
      applyStyleMarks(tr, start + 1, end - 1, fmt)
    }
    if (targets.length) { dispatch(tr); v.focus() }
    setShowStyles(false)
  }

  const updateStyleEverywhere = (name: string, fmt: StyleFormat) => {
    const v = viewRef.current
    if (!v) return
    const { state, dispatch } = v
    const tr = state.tr
    const positions: number[] = []
    state.doc.descendants((node: any, pos: number) => {
      if ((node.type.name === 'paragraph' || node.type.name === 'heading') && node.attrs.style === name) positions.push(pos)
    })
    for (const pos of positions) {
      const node = tr.doc.nodeAt(pos)!
      const start = pos
      const end = pos + node.nodeSize
      const newAttrs: any = { ...node.attrs, align: fmt.align ?? node.attrs.align, style: name }
      tr.setNodeMarkup(pos, null, newAttrs)
      applyStyleMarks(tr, start + 1, end - 1, fmt)
    }
    if (positions.length) { dispatch(tr); v.focus() }
    setStyles((prev) => ({ ...prev, [name]: fmt }))
  }

  const createStyleFromSelection = () => {
    const v = viewRef.current
    if (!v) return
    const name = prompt(t('doc.newStyleName') || '样式名称')
    if (!name) return
    const { state } = v
    const { $from } = state.selection
    const block = $from.parent
    const text = block.firstChild
    const marks = text ? text.marks : []
    const bold = marks.find((m: any) => m.type.name === 'bold')
    const italic = marks.find((m: any) => m.type.name === 'italic')
    const size = marks.find((m: any) => m.type.name === 'fontSize')
    const color = marks.find((m: any) => m.type.name === 'textColor')
    const font = marks.find((m: any) => m.type.name === 'fontFamily')
    const fmt: StyleFormat = {}
    if (bold) fmt.bold = true
    if (italic) fmt.italic = true
    if (size) fmt.fontSize = size.attrs.size
    if (color) fmt.color = color.attrs.color
    if (font) fmt.fontFamily = font.attrs.font
    if (block.attrs.align) fmt.align = block.attrs.align
    const lvl = outlineLevelFromName(name)
    if (lvl) fmt.outlineLevel = lvl
    setStyles((prev) => ({ ...prev, [name]: fmt }))
    applyStyle(name, fmt)
  }

  const jumpToHeading = (tid: string) => {
    const v = viewRef.current
    if (!v || !tid) return
    const { state } = v
    let found = -1
    state.doc.descendants((node: any, pos: number) => {
      if (node.type.name === 'heading' && node.attrs.id === tid) { found = pos; return false }
    })
    if (found >= 0) {
      const tr = state.tr.setSelection(TextSelection.create(state.doc, found + 1))
      v.dispatch(tr)
      v.focus()
      const dom = v.nodeDOM(found) as HTMLElement | null
      dom?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  const generateTOC = () => {
    const v = viewRef.current
    if (!v) return
    const { state, dispatch } = v
    // 1) 为缺少 id 的标题分配稳定 id
    const tr0 = state.tr
    state.doc.descendants((node: any, pos: number) => {
      if (node.type.name === 'heading' && !node.attrs.id) {
        tr0.setNodeMarkup(pos, null, { ...node.attrs, id: 'h-' + Math.random().toString(36).slice(2, 9) })
      }
    })
    if (tr0.docChanged) dispatch(tr0)
    // 2) 收集标题（提纲级别），生成多级编号
    const headings: { level: number; text: string; id: string }[] = []
    v.state.doc.descendants((node: any) => {
      if (node.type.name === 'heading') headings.push({ level: node.attrs.level, text: node.textContent || `标题 ${node.attrs.level}`, id: node.attrs.id })
    })
    if (headings.length === 0) { alert(t('doc.noHeadingsForToc')); return }
    const counters: number[] = []
    const numbered = headings.map((h) => {
      const lvl = Math.max(1, h.level)
      counters[lvl] = (counters[lvl] || 0) + 1
      for (let i = lvl + 1; i < counters.length; i++) counters[i] = 0
      const num = counters.slice(1, lvl + 1).filter((x) => x).join('.')
      return { ...h, num }
    })
    // 3) 移除旧目录（标题块或含 tocLink 的段落）
    const tr = v.state.tr
    const toRemove: number[] = []
    tr.doc.descendants((node: any, pos: number) => {
      if (node.type.name !== 'paragraph') return
      let hasLink = false
      node.content.forEach((c: any) => { if (c.type.name === 'tocLink') hasLink = true })
      if (node.attrs.style === 'Table of Contents' || hasLink) toRemove.push(pos)
    })
    for (let i = toRemove.length - 1; i >= 0; i--) {
      const pos = toRemove[i]
      const node = tr.doc.nodeAt(pos)!
      tr.delete(pos, pos + node.nodeSize)
    }
    // 4) 插入新目录（标题 + 可点击条目）
    const title = schema.nodes.paragraph.create(
      { style: 'Table of Contents' },
      schema.text(t('doc.autoTocTitle'), [schema.marks.bold.create(), schema.marks.fontSize.create({ size: '18px' })])
    )
    const nodes: any[] = [title]
    numbered.forEach((h) => {
      const indent = ' '.repeat(Math.max(0, h.level - 1))
      const label = `${h.num}  ${h.text}`
      const link = schema.nodes.tocLink.create({ target: h.id, label: indent + label })
      nodes.push(schema.nodes.paragraph.create({ style: 'TOC Entry' }, link))
    })
    let pos = 0
    nodes.forEach((n) => { tr.insert(pos, n); pos += n.nodeSize })
    dispatch(tr)
    v.focus()
  }

  const insertManualToc = () => {
    const v = viewRef.current
    if (!v) return
    const text = prompt(t('doc.prompt.tocEntry'))
    if (!text) return
    const lines = text.split('\n').filter((l) => l.trim())
    const tr = v.state.tr
    const title = schema.nodes.paragraph.create(
      { style: 'Table of Contents' },
      schema.text(t('doc.manualTocTitle'), [schema.marks.bold.create(), schema.marks.fontSize.create({ size: '18px' })])
    )
    const nodes: any[] = [title]
    lines.forEach((line) => {
      const level = line.startsWith('  ') ? 2 : 1
      const indent = ' '.repeat(level - 1)
      nodes.push(schema.nodes.paragraph.create({ style: 'TOC Entry' }, schema.text(indent + line.trim())))
    })
    let pos = v.state.selection.from
    nodes.forEach((n) => { tr.insert(pos, n); pos += n.nodeSize })
    v.dispatch(tr); v.focus()
  }

  const styleDesc = (fmt: StyleFormat) => {
    const parts: string[] = []
    if (fmt.fontSize) parts.push(fmt.fontSize)
    if (fmt.bold) parts.push(t('doc.bold'))
    if (fmt.italic) parts.push(t('doc.italic'))
    if (fmt.color) parts.push(fmt.color)
    if (fmt.align) parts.push(fmt.align)
    return parts.join(' · ')
  }

  // 预览页码文本（将模板中的 {n}/{total} 替换为示例值）
  const previewPageNumber = (fmt?: string) => {
    const f = fmt || '第 {n} 页'
    return f.replace('{n}', '1').replace('{total}', '3')
  }

  // 主动向外 emit 当前文档（携带最新页码配置）。
  // 用于「仅修改页码设置、未编辑正文」时，确保 pageNumber 写回 doc 以免保存丢失。
  const emitDoc = (pn?: PageNumberConfig | null) => {
    const v = viewRef.current
    if (!v || !onChangeRef.current) return
    const cfg = pn === undefined ? pageNumberRef.current : pn
    if (pn !== undefined) pageNumberRef.current = pn
    const out = proseMirrorToUDM(v.state.doc, { pageNumber: cfg ?? undefined })
    lastEmittedRef.current = out // 标记为自身 emit，避免同步 effect 误触发重建
    onChangeRef.current(out)
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
      case 'pageBreak': v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.page_break.create({ restart: false, startNumber: 1 }))); break
      case 'pageBreakRestart': v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.page_break.create({ restart: true, startNumber: 1 }))); break
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
        const text = prompt(t('doc.prompt.footnote') || '输入脚注内容'); if (!text) break
        const { state, dispatch } = v
        let footnoteCount = 0
        state.doc.descendants(node => { if (node.type.name === 'footnote') footnoteCount++ })
        const num = footnoteCount + 1
        const tr = state.tr
        // 1) 在光标处插入脚注引用
        tr.replaceSelectionWith(schema.nodes.footnote.create({ content: text, num }))
        // 2) 追加到已有脚注区或新建脚注区（同一事务，避免反复 reconcile 卡死）
        const doc = tr.doc
        let target = -1
        doc.descendants((node: any, pos: number) => { if (node.type.name === 'footnote_section') target = pos })
        if (target >= 0) {
          const section = doc.nodeAt(target)!
          tr.insert(target + section.nodeSize - 1, schema.nodes.footnote_item.create({ num }, schema.text(text)))
        } else {
          const item = schema.nodes.footnote_item.create({ num }, schema.text(text))
          const section = schema.nodes.footnote_section.create(null, item)
          tr.insert(doc.content.size, section)
        }
        dispatch(tr)
        v.focus()
        break
      }
      case 'bookmark': { const name = prompt(t('doc.prompt.bookmark')); if (name) v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.bookmark.create({ name }))); break }
      case 'comment': {
        const text = prompt(t('doc.prompt.comment'))
        if (text && !sel.empty) {
          const id = Date.now().toString()
          const node = schema.nodes.comment_mark.create({ id, author: 'User', text })
          v.dispatch(v.state.tr.insert(sel.to, node))
          v.focus()
          // 新建批注后自动打开对应批注卡片编辑框（对齐 MS Word 审阅窗格）
          try { setComments(extractComments(v.state.doc)) } catch (e) { /* ignore */ }
          setActiveComment(id)
          setEditingComment(id)
        }
        break
      }
      case 'insertTable': { const rows = parseInt(prompt(t('doc.prompt.rows'), '3') || '3'); const cols = parseInt(prompt(t('doc.prompt.cols'), '3') || '3'); if (rows > 0 && cols > 0) { const tr = []; for (let r = 0; r < rows; r++) { const cells = []; for (let c = 0; c < cols; c++) { const headerText = r === 0 ? `列${c+1}` : ''; const content = headerText ? schema.text(headerText) : null; cells.push(schema.nodes.table_cell.create({ isHeader: r === 0 }, schema.nodes.paragraph.create(null, content))) } tr.push(schema.nodes.table_row.create(null, cells)) } v.dispatch(v.state.tr.replaceSelectionWith(schema.nodes.table.create(null, tr))) } break }
      case 'dropCap': setParaAttr('dropCap', !activeAttrs.dropCap); break
      case 'toggleRTL': setParaAttr('rtl', !activeAttrs.rtl); break
    }
    v.focus(); setShowMiniToolbar(false); setShowMiniColorPopup(false); setShowContextMenu(false)
  }

  // === 修订：收集所有 insert_track / delete_track 变更区间 ===
  const findChanges = (doc: any) => {
    const changes: { from: number; to: number; type: 'insert' | 'delete' }[] = []
    let cur: { from: number; to: number; type: 'insert' | 'delete' } | null = null
    doc.descendants((node: any, pos: number) => {
      if (!node.isText) return
      const ins = node.marks.find((m: any) => m.type.name === 'insert_track')
      const del = node.marks.find((m: any) => m.type.name === 'delete_track')
      const type = ins ? 'insert' : del ? 'delete' : null
      if (!type) { cur = null; return }
      const from = pos, to = pos + node.nodeSize
      if (cur && cur.type === type && cur.to === from) { cur.to = to }
      else { if (cur) changes.push(cur); cur = { from, to, type } }
    })
    if (cur) changes.push(cur)
    return changes
  }

  // 接受单条变更：插入→保留（去标记）；删除→真正删除文字
  const acceptChange = (change: { from: number; to: number; type: string }) => {
    const v = viewRef.current; if (!v) return
    const tr = v.state.tr
    if (change.type === 'insert') tr.removeMark(change.from, change.to, v.state.schema.marks.insert_track)
    else { tr.delete(change.from, change.to) }
    v.dispatch(tr); v.focus()
  }
  // 拒绝单条变更：插入→删除文字；删除→保留原字（去标记）
  const rejectChange = (change: { from: number; to: number; type: string }) => {
    const v = viewRef.current; if (!v) return
    const tr = v.state.tr
    if (change.type === 'insert') tr.delete(change.from, change.to)
    else tr.removeMark(change.from, change.to, v.state.schema.marks.delete_track)
    v.dispatch(tr); v.focus()
  }

  const acceptAll = () => {
    const v = viewRef.current; if (!v) return
    let tr = v.state.tr
    const changes = findChanges(v.state.doc)
    // 从后往前处理，避免位置偏移：删除类先删，插入类去标记
    changes.filter(c => c.type === 'delete').reverse().forEach(c => { tr = tr.delete(c.from, c.to) })
    changes.filter(c => c.type === 'insert').forEach(c => { tr = tr.removeMark(c.from, c.to, v.state.schema.marks.insert_track) })
    v.dispatch(tr); v.focus()
  }
  const rejectAll = () => {
    const v = viewRef.current; if (!v) return
    let tr = v.state.tr
    const changes = findChanges(v.state.doc)
    changes.filter(c => c.type === 'insert').reverse().forEach(c => { tr = tr.delete(c.from, c.to) })
    changes.filter(c => c.type === 'delete').forEach(c => { tr = tr.removeMark(c.from, c.to, v.state.schema.marks.delete_track) })
    v.dispatch(tr); v.focus()
  }

  // 跳转到上/下一条变更
  const gotoChange = (dir: 1 | -1) => {
    const v = viewRef.current; if (!v) return
    const changes = findChanges(v.state.doc)
    if (!changes.length) return
    const pos = v.state.selection.from
    let target: { from: number; to: number; type: string } | undefined
    if (dir === 1) target = changes.find(c => c.to > pos)
    else { for (let i = changes.length - 1; i >= 0; i--) { if (changes[i].from < pos) { target = changes[i]; break } } }
    if (!target) target = dir === 1 ? changes[0] : changes[changes.length - 1]
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, target.from, target.to)))
    v.focus()
  }
  // 对当前光标处的变更进行接受/拒绝
  const acceptCurrent = () => {
    const v = viewRef.current; if (!v) return
    const pos = v.state.selection.from
    const c = findChanges(v.state.doc).find(ch => ch.from <= pos && ch.to >= pos)
    if (c) acceptChange(c)
  }
  const rejectCurrent = () => {
    const v = viewRef.current; if (!v) return
    const pos = v.state.selection.from
    const c = findChanges(v.state.doc).find(ch => ch.from <= pos && ch.to >= pos)
    if (c) rejectChange(c)
  }

  const setParaAttr = (attr: string, value: any) => { const v = viewRef.current; if (!v) return; const { $from } = v.state.selection; const tn = $from.parent.type.name; if (tn !== 'paragraph' && tn !== 'heading') return; v.dispatch(v.state.tr.setNodeMarkup($from.before(), undefined, { ...$from.parent.attrs, [attr]: value })); v.focus() }
  // 缩进增减（按字符单位 em，贴近 Word 的“增加/减少缩进量”）
  // 段前/段后间距快捷调节（pt）
  const changeSpace = (which: 'before' | 'after', delta: number) => {
    const v = viewRef.current; if (!v) return; const { $from } = v.state.selection; const tn = $from.parent.type.name
    if (tn !== 'paragraph' && tn !== 'heading') return
    const key = which === 'before' ? 'spaceBefore' : 'spaceAfter'
    const cur = Number($from.parent.attrs[key]) || 0
    const next = Math.max(0, Math.min(120, cur + delta))
    v.dispatch(v.state.tr.setNodeMarkup($from.before(), undefined, { ...$from.parent.attrs, [key]: next })); v.focus()
  }
  // 打开"段落"对话框：读取当前段落/标题的格式属性作为初值
  const openParaDialog = () => {
    const v = viewRef.current; if (!v) return
    const { $from } = v.state.selection
    const a = $from.parent.attrs
    setParaDraft({
      indentLeft: Number(a.indentLeft) || 0,
      indentRight: Number(a.indentRight) || 0,
      special: a.firstLine ? 'firstLine' : (a.hanging ? 'hanging' : 'none'),
      specialBy: Number(a.firstLine) || Number(a.hanging) || 0,
      spaceBefore: Number(a.spaceBefore) || 0,
      spaceAfter: Number(a.spaceAfter) || 0,
      lineKind: a.lineSpacingKind || (a.lineHeight ? '' : 'single'),
      lineValue: a.lineSpacingValue || (a.lineHeight ? parseFloat(a.lineHeight) || 1 : 1),
      keepLines: !!a.keepLines, keepWithNext: !!a.keepWithNext, pageBreakBefore: !!a.pageBreakBefore,
      outlineLevel: Number(a.outlineLevel) || 0,
    })
    setShowParaDialog(true)
  }
  // 将对话框中的段落格式应用到选区覆盖的所有段落/标题
  const applyParagraphFormat = (d: any) => {
    const v = viewRef.current; if (!v) return
    const { $from, $to } = v.state.selection
    const tr = v.state.tr
    let changed = false
    v.state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
      if (node.type.name === 'paragraph' || node.type.name === 'heading') {
        const attrs = {
          ...node.attrs,
          indentLeft: Number(d.indentLeft) || 0,
          indentRight: Number(d.indentRight) || 0,
          firstLine: d.special === 'firstLine' ? (Number(d.specialBy) || 0) : 0,
          hanging: d.special === 'hanging' ? (Number(d.specialBy) || 0) : 0,
          spaceBefore: Number(d.spaceBefore) || 0,
          spaceAfter: Number(d.spaceAfter) || 0,
          lineSpacingKind: d.lineKind || '',
          lineSpacingValue: (d.lineKind === 'multiple' || d.lineKind === 'exact' || d.lineKind === 'atLeast') ? (Number(d.lineValue) || 1) : 0,
          keepLines: !!d.keepLines, keepWithNext: !!d.keepWithNext, pageBreakBefore: !!d.pageBreakBefore,
          outlineLevel: Number(d.outlineLevel) || 0,
        }
        tr.setNodeMarkup(pos, undefined, attrs)
        changed = true
      }
    })
    if (changed) { v.dispatch(tr); v.focus() }
  }
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
  const setFontSize = (size: string) => {
    const v = viewRef.current; if (!v) return
    const { state, dispatch } = v
    const { from, to, empty } = state.selection
    const mark = schema.marks.fontSize.create({ size })
    if (empty) {
      // 无选区：存入 storedMarks，待下次输入生效（不在每次按键时抢占焦点）
      const stored = state.storedMarks ? state.storedMarks.slice() : state.selection.$from.marks()
      const filtered = stored.filter(m => m.type !== schema.marks.fontSize)
      dispatch(state.tr.setStoredMarks([...filtered, mark]))
    } else {
      // 有选区：移除旧 fontSize 后再添加，避免使用 toggleMark 误删/不生效
      dispatch(state.tr.removeMark(from, to, schema.marks.fontSize).addMark(from, to, mark))
    }
    // 注意：输入过程中不调用 v.focus()，否则焦点会被抢回编辑器，
    // 导致后续输入的数字被当作正文内容写入（艺术字内容变成输入数值的现象）。
  }
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
    if (!latex) { setShowFormulaPanel(false); return }
    const mathNode = schema.nodes.math.create({ latex, inline: false })
    v.dispatch(v.state.tr.replaceSelectionWith(mathNode))
    v.focus()
    setShowFormulaPanel(false)
  }

  // 从文件 base64 中提取纯文本（txt/md/json 直接解码；docx 提取 <w:t> 文本）
  const extractFileText = (b64: string, fileName: string): string => {
    try {
      const bin = atob(b64)
      if (/\.docx$/i.test(fileName)) {
        const texts = [...bin.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g)].map((m) => m[1]).join(' ')
        return texts || bin
      }
      // 尝试 UTF-8 解码（处理多字节）
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff
      const dec = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
      return dec || bin
    } catch {
      return atob(b64)
    }
  }

  // 简单的行级差异
  const diffLines = (a: string, b: string) => {
    const al = a.split(/\r?\n/), bl = b.split(/\r?\n/)
    const res: { type: 'add' | 'del' | 'eq'; text: string }[] = []
    let i = 0, j = 0
    while (i < al.length && j < bl.length) {
      if (al[i] === bl[j]) { res.push({ type: 'eq', text: al[i] }); i++; j++ }
      else { res.push({ type: 'del', text: al[i] }); res.push({ type: 'add', text: bl[j] }); i++; j++ }
    }
    while (i < al.length) res.push({ type: 'del', text: al[i++] })
    while (j < bl.length) res.push({ type: 'add', text: bl[j++] })
    return res
  }

  const runCompare = async () => {
    try {
      const path = await backend?.openFileDialog?.()
      if (!path) return
      const b64 = await backend?.readFile(path)
      if (!b64) return
      const otherText = extractFileText(b64, path)
      const curText = viewRef.current ? viewRef.current.state.doc.textContent : ''
      setCompareDiff(diffLines(curText, otherText))
      setCompareOpen(true)
    } catch (e: any) {
      alert(t('doc.compareError') + ': ' + (e?.message || e))
    }
  }

  const toggleProtect = () => {
    const v = viewRef.current; if (!v) return
    if (!protectedMode) {
      const pwd = prompt(t('doc.protectSetPwd'))
      if (!pwd) return
      protectPwdRef.current = pwd
      setProtectedMode(true)
      v.setProps({ editable: () => false })
    } else {
      const pwd = prompt(t('doc.protectEnterPwd'))
      if (pwd === protectPwdRef.current) {
        setProtectedMode(false)
        protectPwdRef.current = ''
        v.setProps({ editable: () => true })
      } else {
        alert(t('doc.protectWrongPwd'))
      }
    }
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
      <div className="flex items-center px-2 flex-shrink-0 border-b" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', position: 'relative', zIndex: 45, '--wails-draggable': 'drag' as any } as any}>
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
      <div className="flex items-stretch px-1 py-1 flex-shrink-0 border-b w-full ribbon-scroll" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', minHeight: '72px', position: 'relative', zIndex: 45, '--wails-draggable': 'drag' as any } as any}>
        {ribbonTab === 'home' && (<>
          <RibbonGroup label={t('doc.clipboard')}>
            <RibbonButton icon="↶" label={t('doc.undo')} onClick={() => exec('undo')} title="Ctrl+Z" />
            <RibbonButton icon="↷" label={t('doc.redo')} onClick={() => exec('redo')} title="Ctrl+Y" />
          </RibbonGroup>
          <RibbonGroup label={t('doc.font')}>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <Dropdown
                className="text-xs rounded-md px-2 ribbon-input"
                style={{ width: 110, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', height: 26 }}
                value={activeFont}
                onChange={v => setFont(v)}
                options={FONTS.map(f => ({ label: f.name, value: f.value }))}
              />
                <Dropdown
                  className="text-xs rounded-md px-2 ribbon-input"
                  style={{ width: 76, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', height: 26 }}
                  editable
                  inputMode="numeric"
                  inputValue={activeFontSize.replace(/px$/, '')}
                  placeholder={t('doc.size.body').replace('px', '')}
                  onInputChange={(raw) => {
                    const v = raw.trim()
                    if (v === '') { setFontSize(''); return }
                    const num = parseFloat(v)
                    if (!isNaN(num) && num > 0) setFontSize(`${num}px`)
                  }}
                  onInputBlur={() => { const v = viewRef.current; if (v) v.focus() }}
                  value={activeFontSize}
                  onChange={(v) => setFontSize(v)}
                  options={FONT_SIZES.map(s => ({ label: s.name, value: s.value }))}
                  title={t('doc.fontSize')}
                />
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
              <div className="flex items-center gap-1">
                <RibbonButton icon="⚙" label={t('doc.paraDialog')} onClick={openParaDialog} title={t('doc.paraDialog')} active={showParaDialog} />
                <Dropdown
                  className="text-xs rounded-md px-2 py-1 ribbon-input"
                  style={{ width: 92, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', height: 26 }}
                  value={activeAttrs.lineHeight || ''}
                  onChange={v => setParaAttr('lineHeight', v)}
                  options={[{ label: t('doc.lineSpacing'), value: '' }, ...LINE_HEIGHTS.map(l => ({ label: l.name, value: l.value }))]}
                />
                <Dropdown
                  className="text-xs rounded-md px-2 py-1 ribbon-input"
                  style={{ width: 92, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', height: 26 }}
                  value={activeAttrs.letterSpacing || ''}
                  onChange={v => setParaAttr('letterSpacing', v)}
                  options={[
                    { label: t('doc.charSpacing'), value: '' },
                    { label: t('doc.spacing.loose'), value: '0.5px' },
                    { label: t('doc.spacing.looser'), value: '1px' },
                    { label: t('doc.spacing.tight'), value: '-0.5px' },
                  ]}
                />
                <button onClick={() => changeSpace('before', 6)} className="toolbar-btn" title={t('doc.spaceBefore')} type="button" style={{ width: 28, height: 26 }}>↥</button>
                <button onClick={() => changeSpace('after', 6)} className="toolbar-btn" title={t('doc.spaceAfter')} type="button" style={{ width: 28, height: 26 }}>↧</button>
              </div>
            </div>
          </RibbonGroup>
          <RibbonGroup label={t('doc.styles')}>
            <RibbonButton icon="🎨" label={t('doc.styleGallery')} onClick={() => setShowStyles(true)} title={t('doc.styleGallery')} />
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
            <RibbonButton icon="🔄" label={t('doc.pageBreakRestart')} onClick={() => exec('pageBreakRestart')} title={t('doc.pageBreakRestartTitle')} />
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
            <RibbonButton icon="📑" label={t('doc.autoToc')} onClick={() => generateTOC()} title={t('doc.autoTocTitle')} />
            <RibbonButton icon="🔄" label={t('doc.updateToc')} onClick={() => generateTOC()} title={t('doc.updateTocTitle')} />
            <RibbonButton icon="📋" label={t('doc.manualToc')} onClick={() => insertManualToc()} title={t('doc.manualTocTitle')} />
          </RibbonGroup>
          <RibbonGroup label={t('doc.annotation')}>
            <RibbonButton icon="📝" label={t('doc.footnote')} onClick={() => exec('footnote')} />
            <RibbonButton icon="💬" label={t('doc.annotation')} onClick={() => exec('comment')} />
          </RibbonGroup>
        </>)}

        {ribbonTab === 'layout' && (<>
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
              <Dropdown
                className="text-xs rounded-md px-2 py-1 ribbon-input"
                style={{ width: 90, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', height: 26 }}
                value={pageSize}
                onChange={v => setPageSize(v as any)}
                options={[
                  { label: 'A4', value: 'A4' },
                  { label: 'A3', value: 'A3' },
                  { label: 'A5', value: 'A5' },
                  { label: 'B5', value: 'B5' },
                  { label: 'Letter', value: 'Letter' },
                  { label: 'Legal', value: 'Legal' },
                ]}
              />
              <Dropdown
                className="text-xs rounded-md px-2 py-1 ribbon-input"
                style={{ width: 90, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', height: 26 }}
                value={orientation}
                onChange={v => setOrientation(v as any)}
                options={[
                  { label: t('doc.portrait'), value: 'portrait' },
                  { label: t('doc.landscape'), value: 'landscape' },
                ]}
              />
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
          {/* 页眉页脚 / 页码 */}
          <RibbonGroup label={t('doc.headerFooter')}>
            <RibbonButton icon="📄" label={t('doc.header')} onClick={() => {
              const h = prompt(t('doc.headerPrompt'), docHeader)
              if (h !== null) setDocHeader(h)
            }} title={t('doc.headerTitle')} />
            <RibbonButton icon="🔢" label={t('doc.pageNum')} onClick={() => setShowPageNumDialog(true)} active={!!pageNumber?.enabled} title={t('doc.pageNumTitle')} />
          </RibbonGroup>
          <RibbonGroup label="公文 GB/T 9704">
            <RibbonButton icon="📜" label="公文模板" onClick={() => {
              // 应用政府公文标准排版: 3号仿宋 + 固定28磅 + 首行缩进2字符
              setParaAttr('lineHeight', '28pt')
              setParaAttr('firstLine', 2)
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
          </RibbonGroup>
          <RibbonGroup label={t('doc.changesNav')}>
            <RibbonButton icon="◀" label={t('doc.prevChange')} onClick={() => gotoChange(-1)} title={t('doc.prevChangeTitle')} />
            <RibbonButton icon="▶" label={t('doc.nextChange')} onClick={() => gotoChange(1)} title={t('doc.nextChangeTitle')} />
            <RibbonButton icon="✓" label={t('doc.accept')} onClick={acceptCurrent} title={t('doc.acceptTitle')} />
            <RibbonButton icon="✗" label={t('doc.reject')} onClick={rejectCurrent} title={t('doc.rejectTitle')} />
          </RibbonGroup>
          <RibbonGroup label={t('doc.changesAll')}>
            <RibbonButton icon="📥" label={t('doc.acceptAll')} onClick={acceptAll} title={t('doc.acceptAllTitle')} />
            <RibbonButton icon="📤" label={t('doc.rejectAll')} onClick={rejectAll} title={t('doc.rejectAllTitle')} />
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
          <RibbonGroup label={t('doc.compareProtect')}>
            <RibbonButton icon="⚖️" label={t('doc.compare')} onClick={runCompare} active={compareOpen} title={t('doc.compareTitle')} />
            <RibbonButton icon="🔒" label={t('doc.protect')} onClick={toggleProtect} active={protectedMode} title={protectedMode ? t('doc.protectOn') : t('doc.protectTitle')} />
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
                      <button key={c} onClick={() => { setBgColorPersist(c as string); setEyeCarePersist(c === '#c7edcc'); closeAllPanels() }} className="flex flex-col items-center gap-0.5 p-1 rounded transition-colors hover:bg-slate-100" title={n as string}>
                        <span className="w-7 h-7 rounded border" style={{ background: c, border: '1px solid var(--color-border)' }} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <RibbonButton icon="👁" label={t('doc.eyeCare')} onClick={() => { const ec = !eyeCareMode; setEyeCarePersist(ec); setBgColorPersist(ec ? '#c7edcc' : '#ffffff') }} active={eyeCareMode} title={t('doc.eyeCareTitle')} />
          </RibbonGroup>
          {/* 显示编辑标记 (¶ 段落标记 / 分页符) */}
          <RibbonGroup label={t('doc.show')}>
            <RibbonButton icon="¶" label={t('doc.showMarks')} onClick={() => setShowMarksPersist(!showMarks)} active={showMarks} title={t('doc.showMarksTitle')} />
            <RibbonButton icon="📏" label={t('doc.ruler')} onClick={() => setShowRulerPersist(!showRuler)} active={showRuler} title={t('doc.rulerTitle')} />
            <RibbonButton icon="📐" label={t('doc.gridlines')} onClick={() => setShowGridlinesPersist(!showGridlines)} active={showGridlines} title={t('doc.gridlinesTitle')} />
            <RibbonButton icon="🗂" label={t('doc.navPane')} onClick={() => setShowNavPanePersist(!showNavPane)} active={showNavPane} title={t('doc.navPaneTitle')} />
          </RibbonGroup>
          {/* 窗口 */}
          <RibbonGroup label={t('doc.window')}>
            <RibbonButton icon="🪟" label={t('doc.newWindow')} onClick={() => { const v = viewRef.current; if (!v) return; const state2 = EditorState.create({ doc: v.state.doc, plugins: v.state.plugins }); const newView = new EditorView(window.window.document.createElement('div'), { state: state2 }); (window as any).__pmView2 = newView; alert(t('doc.newWindowMsg') || '已创建新编辑器视图（在同一窗口内拆分显示）') }} title={t('doc.newWindowTitle')} />
            <RibbonButton icon="↔️" label={t('doc.windowSplit')} onClick={() => setSplitWindowPersist(!splitWindow)} active={splitWindow} title={t('doc.windowSplitTitle')} />
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
        style={{ background: 'var(--color-bg-alt)', position: 'relative', zIndex: 1, display: 'flex' }}
      >
        <div
          className="max-w-4xl mx-auto animate-fade-in"
          style={{
            boxShadow: '0 0 32px rgba(15, 23, 42, 0.06)',
            marginTop: '24px',
            marginBottom: '24px',
            borderRadius: '8px',
            background: bgColor,
            width: pageWidthPx,
            minHeight: pageHeightPx,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* 水平标尺（Word 风格：厘米刻度 + 页边距 + 可拖拽缩进滑块） */}
          {showRuler && (
            <Ruler
              width={pageWidthPx}
              marginLeft={docMargins.left}
              marginRight={docMargins.right}
              indents={{
                indentLeft: Number(activeAttrs.indentLeft) || 0,
                indentRight: Number(activeAttrs.indentRight) || 0,
                firstLine: Number(activeAttrs.firstLine) || 0,
                hanging: Number(activeAttrs.hanging) || 0,
              }}
              onChange={(next: Partial<import('../../components/Ruler').RulerIndents>) => {
                if (next.indentLeft !== undefined) setParaAttr('indentLeft', next.indentLeft)
                if (next.indentRight !== undefined) setParaAttr('indentRight', next.indentRight)
                if (next.firstLine !== undefined) setParaAttr('firstLine', next.firstLine)
                if (next.hanging !== undefined) setParaAttr('hanging', next.hanging)
              }}
            />
          )}
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
          {/* 页底脚注区：脚注引用在正文，脚注文本统一显示在页底 */}
          {footnotes.length > 0 && (
            <div style={{
              borderTop: '1px solid var(--color-border)',
              padding: `${Math.round(docMargins.bottom * 0.3)}px ${docMargins.right}px ${Math.round(docMargins.bottom * 0.3)}px ${docMargins.left}px`,
              fontSize: '0.82em',
              color: 'var(--color-text-muted)',
              background: bgColor,
            }}>
              {footnotes.map((f) => (
                <div key={f.pos} style={{ display: 'flex', alignItems: 'flex-start', gap: '4px', margin: '2px 0' }}
                     onDoubleClick={() => editFootnote(f)} title={t('doc.prompt.footnote') || '双击编辑脚注'}>
                  <span style={{ flex: 1, wordBreak: 'break-word', lineHeight: 1.5 }}>
                    <span style={{ color: '#4f46e5', marginRight: '4px', fontSize: '0.92em' }}>{f.num}.</span>{f.text || ' '}
                  </span>
                  <button type="button" onClick={(e) => { e.stopPropagation(); deleteFootnote(f) }}
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '14px', lineHeight: 1, padding: '0 4px' }}
                          title="删除脚注">×</button>
                </div>
              ))}
            </div>
          )}
          {/* 页脚（页码预览，真实页码/分节在导出 docx 时生成） */}
          {pageNumber?.enabled && (
            <div style={{
              padding: `${Math.round(docMargins.bottom * 0.3)}px ${docMargins.right}px ${Math.round(docMargins.bottom * 0.3)}px ${docMargins.left}px`,
              borderTop: '1px solid var(--color-border)',
              fontSize: `${((pageNumber.fontSize || 18) / 2)}px`,
              color: pageNumber.fontColor || 'var(--color-text-muted)',
              fontFamily: pageNumber.fontFamily || undefined,
              fontWeight: pageNumber.bold ? 700 : 400,
              fontStyle: pageNumber.italic ? 'italic' : 'normal',
              textAlign: (pageNumber.align as any) || 'center',
            }}>
              {previewPageNumber(pageNumber.format)}
            </div>
          )}
        </div>

        {/* 右侧批注栏（对齐 MS Word 审阅窗格：批注卡片显示在正文右侧，与批注锚点对应） */}
        {comments.length > 0 && (
          <div
            className="comments-pane"
            style={{
              width: 240,
              flexShrink: 0,
              borderLeft: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              overflowY: 'auto',
              padding: '12px 10px',
              position: 'sticky',
              top: 0,
              alignSelf: 'flex-start',
              maxHeight: '100%',
            }}
          >
            <div className="comments-pane-header">{t('doc.comments') || '批注'} ({comments.length})</div>
            {comments.map(c => {
              const anchor = viewRef.current?.domAtPos(Math.min(c.pos + 1, viewRef.current.state.doc.content.size))
              let top = 0
              if (anchor) { const rect = (anchor.node as HTMLElement).getBoundingClientRect?.(); const scroll = (window.document.querySelector('.editor-scroll') as HTMLElement); if (rect) top = rect.top - (scroll ? scroll.getBoundingClientRect().top : 0) }
              const isActive = activeComment === c.id
              const isEditing = editingComment === c.id
              return (
                <div
                  key={c.id}
                  id={`comment-card-${c.id}`}
                  className={`comment-card ${isActive ? 'active' : ''}`}
                  style={{ position: 'relative', marginTop: top > 0 ? top : undefined, marginBottom: '10px', padding: '8px 10px', borderRadius: '6px', border: `1px solid ${isActive ? '#4f46e5' : 'var(--color-border)'}`, background: isActive ? 'var(--color-bg-alt)' : 'var(--color-surface)' }}
                  onClick={() => { setActiveComment(c.id); const v = viewRef.current; if (v) { const node = v.state.doc.nodeAt(c.pos); if (node && node.type.name === 'comment_mark') { const from = c.pos, to = c.pos + node.nodeSize; v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, from, to))); v.focus() } } }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-muted)' }}>{c.author}</span>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button type="button" className="comment-action" title={t('doc.editComment') || '编辑'} onClick={(e) => { e.stopPropagation(); setEditingComment(c.id) }}>✎</button>
                      <button type="button" className="comment-action" title={t('doc.deleteComment') || '删除'} onClick={(e) => { e.stopPropagation(); deleteComment(c.id) }}>×</button>
                    </div>
                  </div>
                  {isEditing ? (
                    <textarea
                      autoFocus
                      defaultValue={c.text}
                      className="comment-edit-input"
                      style={{ width: '100%', minHeight: '56px', fontSize: '12px', resize: 'vertical', borderRadius: '4px', border: '1px solid var(--color-border)', padding: '4px 6px', background: 'var(--color-bg)', color: 'var(--color-text)' }}
                      onBlur={(e) => { editComment(c.id); setEditingComment(null) }}
                      onKeyDown={(e) => { if (e.key === 'Escape') { setEditingComment(null) } }}
                    />
                  ) : (
                    <div style={{ fontSize: '12px', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--color-text)' }}>{c.text}</div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 页码设置对话框 */}
      {showPageNumDialog && (
        <PageNumberDialog
          value={pageNumber}
          onClose={() => setShowPageNumDialog(false)}
          onSave={(pn) => { setPageNumber(pn); setShowPageNumDialog(false); emitDoc(pn) }}
        />
      )}
      {showParaDialog && (
        <ParagraphDialog
          value={paraDraft}
          onClose={() => setShowParaDialog(false)}
          onSave={(d) => { applyParagraphFormat(d); setShowParaDialog(false) }}
        />
      )}

      {/* 文档对比面板 */}
      {compareOpen && (
        <div className="modal-overlay" onMouseDown={() => setCompareOpen(false)}>
          <div className="modal compare-panel" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-title">{t('doc.compareResult')}</div>
            <div className="compare-body">
              {compareDiff.length === 0 && <div className="compare-empty">{t('doc.compareEmpty')}</div>}
              {compareDiff.map((d, i) => (
                <div key={i} className={`compare-line compare-${d.type}`}>
                  <span className="compare-sign">{d.type === 'add' ? '+' : d.type === 'del' ? '−' : ' '}</span>
                  <span className="compare-text">{d.text || ' '}</span>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => setCompareOpen(false)}>{t('doc.close')}</button>
            </div>
          </div>
        </div>
      )}

      {/* 样式库面板 */}
      {showStyles && (
        <div className="modal-overlay" onMouseDown={() => { setShowStyles(false); setEditingStyle(null) }}>
          <div className="modal styles-panel" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span>{t('doc.styles')}</span>
              <button className="modal-close" onClick={() => { setShowStyles(false); setEditingStyle(null) }}>×</button>
            </div>
            <div className="styles-toolbar">
              <input className="styles-search" placeholder={t('doc.search') || ''} value={styleSearch} onChange={(e) => setStyleSearch(e.target.value)} />
              <button className="btn btn-outline btn-sm" onClick={createStyleFromSelection}>{t('doc.newStyle')}</button>
            </div>
            <div className="styles-list">
              {allStyles.filter(s => s.name.toLowerCase().includes(styleSearch.toLowerCase())).map((s) => (
                <div key={s.name} className="style-row" onClick={() => applyStyle(s.name)} title={t('doc.applyStyle')}>
                  <div className="style-preview" style={{ fontSize: s.format.fontSize, fontWeight: s.format.bold ? 700 : 400, fontStyle: s.format.italic ? 'italic' : 'normal', color: s.format.color || 'inherit', textAlign: (s.format.align as any) || 'left' }}>
                    {s.name}
                  </div>
                  <div className="style-meta">
                    <div className="style-name">{s.name}{!s.builtin ? ' *' : ''}</div>
                    <div className="style-desc">{styleDesc(s.format)}</div>
                  </div>
                  <button className="style-edit" title={t('doc.editStyle')} onClick={(e) => { e.stopPropagation(); setEditingStyle(s.name) }}>✎</button>
                </div>
              ))}
            </div>
            {editingStyle && (
              <StyleEditor
                name={editingStyle}
                initial={resolveStyle(editingStyle)}
                onCancel={() => setEditingStyle(null)}
                onSave={(fmt) => { updateStyleEverywhere(editingStyle, fmt); setEditingStyle(null) }}
              />
            )}
          </div>
        </div>
      )}

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
