import { useEffect, useMemo, useRef, useState, Fragment } from 'react'
import { EditorState, NodeSelection, TextSelection, Plugin } from 'prosemirror-state'
import { DOMSerializer, DOMParser as PMDOMParser } from 'prosemirror-model'
import { EditorView, Decoration, DecorationSet } from 'prosemirror-view'
import { schema } from './schema'
import { createPaginationPlugin } from './pagination'
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
import { MathEditorModal } from './MathEditorModal'
import { TextBoxStylePanel } from './TextBoxStylePanel'
import type { Document, SpellError, PageNumberConfig, Backend } from '../../types/udm'

interface Props {
  document: Document
  spellErrors?: SpellError[]
  onChange?: (doc: Document) => void
  onSpellCheck?: (text: string) => void
  zoom?: number
  onZoomChange?: (z: number) => void
  backend?: Backend
  onToast?: (msg: string) => void
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

// 从 PM 文档中提取脚注数据（脚注区在编辑器内隐藏渲染，这里仅取数据用于页底脚注区展示/编辑）。
// sectionPos：隐藏脚注区中 footnote_item 的位置（用于编辑/删除）；
// refPos：正文中 footnote 引用标记的位置（用于判断脚注应显示在哪一页）。
type FootnoteData = { num: number; text: string; sectionPos: number; refPos: number }
function extractFootnotes(doc: any): FootnoteData[] {
  const refs: Record<number, number> = {}
  doc.descendants((node: any, pos: number) => {
    if (node.type.name === 'footnote') {
      const num = Number(node.attrs.num) || 0
      if (num > 0) refs[num] = pos
    }
  })
  const out: FootnoteData[] = []
  doc.descendants((node: any, pos: number) => {
    if (node.type.name === 'footnote_section') {
      node.forEach((child: any, offset: number) => {
        if (child.type.name === 'footnote_item') {
          const num = Number(child.attrs.num) || 1
          out.push({ num, text: child.textContent || '', sectionPos: pos + 1 + offset, refPos: refs[num] ?? -1 })
        }
      })
    }
  })
  return out
}

export function DocumentEditor({ document, spellErrors = [], onChange, onSpellCheck, zoom: zoomProp, onZoomChange, backend, onToast }: Props) {
  const { t } = useI18n()

  // 系统字体库 — 通过 queryLocalFonts() 补充系统已安装字体。
  // 注意：queryLocalFonts 在 WebView2 下返回的 family 多为英文/音译名（如 SimSun），
  // 不会包含「宋体」这类中文显示名；所以不能整体覆盖，要与内置中文字体合并且去重。
  const BUILTIN_FONTS = [
    '宋体', '黑体', '楷体', '仿宋', '微软雅黑', '等线',
    'SimSun', 'SimHei', 'KaiTi', 'FangSong', 'Microsoft YaHei', 'Microsoft JhengHei',
    'Arial', 'Times New Roman', 'Calibri', 'Cambria', 'Georgia', 'Verdana',
    'Tahoma', 'Trebuchet MS', 'Courier New', 'Consolas', 'Lucida Console',
  ]
  const [systemFonts, setSystemFonts] = useState<string[]>([])
  useEffect(() => {
    const w = window as any
    if (w.queryLocalFonts) {
      w.queryLocalFonts().then((fonts: any[]) => {
        if (fonts && fonts.length) {
          const names = Array.from(new Set(fonts.map((f: any) => f.family)))
          setSystemFonts(names)
        }
      }).catch(() => {})
    }
  }, [])

  // 字体下拉列表：内置中文字体优先（保证「宋体/黑体」等一定出现且不被截断），
  // 系统枚举字体作为补充放在后面并限制数量。下拉菜单本身可滚动 (maxHeight 280)。
  // 注意：真实环境 queryLocalFonts 可能返回大量大小写变体（如 "arial"/"Arial"、"cambria"/"Cambria"），
  // 必须与内置字体一起按大小写不敏感去重，否则 FONTS 会出现重复 value → React 渲染菜单时 key 冲突 → removeChild 崩溃。
  const FONT_CAP = 400
  const allFontNames = [...BUILTIN_FONTS, ...systemFonts]
  const seenFont = new Set<string>()
  const dedupedFonts: string[] = []
  for (const f of allFontNames) {
    const key = String(f).toLowerCase()
    if (seenFont.has(key)) continue
    seenFont.add(key)
    dedupedFonts.push(f)
  }
  const FONTS = [
    { name: t('doc.font.default'), value: '' },
    ...dedupedFonts.sort().slice(0, FONT_CAP).map(f => ({ name: f, value: f })),
  ]
  const FONT_SIZES = [
    { name: t('doc.size.small'), value: '12px' }, { name: t('doc.size.body'), value: '15px' },
    { name: t('doc.size.medium'), value: '18px' }, { name: t('doc.size.large'), value: '24px' }, { name: t('doc.size.heading'), value: '32px' },
  ]

  const editorRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const sheetsLayerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  // 当前选区是否包含可选中文本（用于右键菜单复制/剪切的可用态）
  const hasSelection = () => {
    const v = viewRef.current
    if (!v) return false
    const sel = v.state.selection
    if (sel.empty) return false
    return !(sel instanceof NodeSelection)
  }
  // 读取选区/光标处生效的字符格式标记（供格式刷暂存）
  const getActiveMarks = (): Record<string, any> => {
    const v = viewRef.current; if (!v) return {}
    const { state } = v
    const { from, to, empty } = state.selection
    const marks: Record<string, any> = {}
    if (!empty) {
      // 遍历选区内所有文本节点，收集其字符格式标记
      state.doc.nodesBetween(from, to, (node: any) => {
        if (node.isText && node.marks) {
          node.marks.forEach((m: any) => { marks[m.type.name] = m.attrs })
        }
      })
    } else {
      // 仅光标（未选词/段落）：读取光标处生效的字符 marks（兼容“光标置于格式文本上即暂存”）
      const $pos = state.doc.resolve(from)
      $pos.marks().forEach((m: any) => { marks[m.type.name] = m.attrs })
    }
    return marks
  }
  // 格式刷：暂存源格式标记，等待应用到下一次选区。
  // lock=false → 单击模式（应用一次后自动解除，等同 MS Office 单击格式刷）
  // lock=true  → 双击锁定模式（可连续多次应用，等同 MS Office 双击格式刷）
  // 用 ref 持有最新值，避免 ProseMirror Plugin 闭包捕获到过期的 state。
  const [formatPainter, setFormatPainter] = useState<{ marks: Record<string, any>; lock: boolean } | null>(null)
  const formatPainterRef = useRef<{ marks: Record<string, any>; lock: boolean } | null>(null)
  const setPainter = (v: { marks: Record<string, any>; lock: boolean } | null) => {
    formatPainterRef.current = v
    setFormatPainter(v)
  }
  // 格式刷单击/双击的区分：浏览器双击会先触发两次 click 再触发 dblclick，
  // 若不处理会导致两次单击把 lock 态改乱、双击无法关闭。用短延时合并——单击延迟执行，
  // 若期间发生双击则取消单击，由 onDoubleClick 统一处理（进入/退出锁定）。
  const painterClickTimer = useRef<number | null>(null)
  const handlePainterClick = () => {
    if (painterClickTimer.current) return
    painterClickTimer.current = window.setTimeout(() => {
      painterClickTimer.current = null
      // 单击：未激活则开启（非锁定），已激活则关闭
      if (formatPainterRef.current) setPainter(null)
      else setPainter({ marks: getActiveMarks(), lock: false })
    }, 220)
  }
  const handlePainterDouble = () => {
    if (painterClickTimer.current) { clearTimeout(painterClickTimer.current); painterClickTimer.current = null }
    // 双击：已在锁定模式则关闭，否则进入锁定模式
    if (formatPainterRef.current?.lock) setPainter(null)
    else setPainter({ marks: getActiveMarks(), lock: true })
  }
  // 单击模式：套用后延迟清除格式刷。用防抖而非立即清除，
  // 否则拖选过程中 appendTransaction 每次 mousemove 都会触发并立即清空，导致只刷中前一小段。
  const painterClearTimer = useRef<number | null>(null)
  const schedulePainterClear = () => {
    if (painterClearTimer.current) clearTimeout(painterClearTimer.current)
    painterClearTimer.current = window.setTimeout(() => {
      painterClearTimer.current = null
      setPainter(null)
    }, 350)
  }
  // Esc 退出格式刷锁定模式
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && formatPainterRef.current?.lock) setPainter(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // 将当前选区序列化为 HTML 并写入系统剪贴板（HTML + 纯文本双格式）；cut=true 时同时删除选区
  const serializeSelectionToClipboard = (v: any, cut: boolean) => {
    const sel = v.state.selection
    if (sel.empty) return
    // 优先用原生 DOM Selection 克隆选中片段，避免 ProseMirror DOMSerializer
    // 在个别节点 toDOM 下触发 document.createElement 异常（见复制报错）。
    let html = ''
    let plain = ''
    try {
      const domSel = (window as any).getSelection()
      if (domSel && domSel.rangeCount > 0) {
        const range = domSel.getRangeAt(0)
        const clone = range.cloneContents()
        const div = (window as any).document.createElement('div')
        div.appendChild(clone)
        html = div.innerHTML
        plain = range.toString()
      }
    } catch { /* ignore */ }
    // 兜底：用 ProseMirror 文本区间取纯文本
    if (!plain) {
      plain = v.state.doc.textBetween(sel.from, sel.to, '\n\n')
    }
    try {
      (window as any).runtime.SetClipboardHtml(html, plain)
    } catch { /* ignore */ }
    if (cut) { v.dispatch(v.state.tr.delete(sel.from, sel.to).scrollIntoView()) }
  }
  // 实测编辑器内容高度，用于让“页面”随内容自动增高，避免多页文档被裁切
  const [pageContentH, setPageContentH] = useState(0)
  // 页底脚注区数据（从 PM 文档提取，避免在正文中渲染脚注）
  const [footnotes, setFootnotes] = useState<FootnoteData[]>([])
  // 每个顶级块所在的页码（由分页引擎回报），用于把脚注显示在引用所在页底部
  const [blockPages, setBlockPages] = useState<number[]>([])
  // 将脚注按“引用所在页”分组，使脚注显示在对应页底部而非文档末尾
  const footnotesByPage = useMemo(() => {
    const map: Record<number, FootnoteData[]> = {}
    const view = viewRef.current
    if (!view || blockPages.length === 0) return map
    const froms: number[] = []
    view.state.doc.forEach((_n: any, from: number) => froms.push(from))
    for (const f of footnotes) {
      if (f.refPos < 0) continue
      let k = 0
      for (let i = 0; i < froms.length; i++) {
        if (froms[i] <= f.refPos) k = i
        else break
      }
      const pg = blockPages[k] ?? 0
      ;(map[pg] ||= []).push(f)
    }
    return map
  }, [footnotes, blockPages])
  // 右侧批注栏数据（对齐 MS Word：批注锚点在正文，卡片显示在右侧对应位置）
  const [comments, setComments] = useState<{ id: string; author: string; text: string; pos: number }[]>([])
  const [activeComment, setActiveComment] = useState<string | null>(null)

  const editFootnote = (f: FootnoteData) => {
    const v = viewRef.current
    if (!v) return
    const newText = prompt(t('doc.prompt.footnote') || '编辑脚注内容：', f.text)
    if (newText === null) return
    const node = v.state.doc.nodeAt(f.sectionPos)
    if (!node || node.type.name !== 'footnote_item') return
    const item = schema.nodes.footnote_item.create({ num: f.num }, newText ? schema.text(newText) : null)
    v.dispatch(v.state.tr.replaceWith(f.sectionPos, f.sectionPos + node.nodeSize, item))
  }
  const deleteFootnote = (f: FootnoteData) => {
    const v = viewRef.current
    if (!v) return
    const node = v.state.doc.nodeAt(f.sectionPos)
    if (!node || node.type.name !== 'footnote_item') return
    v.dispatch(v.state.tr.delete(f.sectionPos, f.sectionPos + node.nodeSize))
  }
  // 复制脚注内容到剪贴板（优先 Clipboard API，回退 execCommand）
  const copyFootnote = (f: FootnoteData) => {
    const text = `${f.num}. ${f.text || ''}`
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => fallbackCopy(text))
      } else {
        fallbackCopy(text)
      }
    } catch {
      fallbackCopy(text)
    }
  }
  const fallbackCopy = (text: string) => {
    const docAny = document as any
    const ta = docAny.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    docAny.body.appendChild(ta)
    ta.select()
    try { docAny.execCommand('copy') } catch { /* ignore */ }
    docAny.body.removeChild(ta)
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
  // 用 ref 持有最新 document，供 ProseMirror 闭包（dispatchTransaction）读取，避免捕获到过期的 props。
  const documentRef = useRef<any>(document)
  documentRef.current = document
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
  const [activeCharSpacing, setActiveCharSpacing] = useState('')
  const [activeIsImage, setActiveIsImage] = useState(false)
  const [activeIsShape, setActiveIsShape] = useState(false)
  // 当前选中的 text_box 节点（用于浮动属性面板）
  const [activeTextBox, setActiveTextBox] = useState<{ node: any; pos: number } | null>(null)
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
  // 右键菜单触发时，光标/点击是否落在 text_box（文本框/形状）上
  const [contextMenuOnTextBox, setContextMenuOnTextBox] = useState(false)
  const contextMenuBoxRef = useRef<HTMLElement | null>(null)
  const [showShapePanel, setShowShapePanel] = useState(false)
  const [showArtPanel, setShowArtPanel] = useState(false)
  // 独立公式编辑器弹窗（全屏模态）
  const [showMathModal, setShowMathModal] = useState(false)
  const [mathEdit, setMathEdit] = useState<{ latex: string; inline: boolean; pos: number | null }>({ latex: '', inline: false, pos: null })
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
  }
  const closeAllPanels = () => {
    setShowShapePanel(false); setShowArtPanel(false)
    setShowColorPopup(false); setShowHighlightPopup(false)
    setShowShadingPopup(false); setShowBgColorPopup(false)
  }
  const anyPanelOpen = showShapePanel || showArtPanel || showColorPopup || showHighlightPopup || showShadingPopup || showBgColorPopup
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
  // 并排对比：右侧只读文档视图（含目标文档与名称）
  const [compareTarget, setCompareTarget] = useState<{ name: string; doc: Document } | null>(null)
  const compareRef = useRef<HTMLDivElement>(null)
  const compareViewRef = useRef<EditorView | null>(null)
  const leftScrollRef = useRef<HTMLDivElement>(null)
  const syncLockRef = useRef(false)
  // 差异高亮集合（按段落文本匹配）：右侧新增段落、左侧被删段落
  const diffAddRef = useRef<Set<string>>(new Set())
  const diffDelRef = useRef<Set<string>>(new Set())
  const [protectedMode, setProtectedMode] = useState(false)
  // 已解锁的文档保护哈希（空表示当前未处于受保护态，或已解锁）。
  // 打开带保护的文档时该值为空，需输入正确密码后填入对应哈希才能编辑。
  const unlockHashRef = useRef<string>('')
  // 解锁密码输入弹窗
  const [showUnlock, setShowUnlock] = useState(false)
  const [unlockInput, setUnlockInput] = useState('')
  const [unlockError, setUnlockError] = useState(false)
  // 简单稳定的字符串哈希（用于密码校验，盘上仅存哈希不存明文）
  const hashPwd = (s: string): string => {
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    return (h >>> 0).toString(16)
  }
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

  // ===== 页面视图（Word 式独立纸页 + 页间留白 + 内容自动顺次流到下一页）=====
  const [pageCount, setPageCount] = useState(1)
  const [bodyTop, setBodyTop] = useState(0)
  // 由分页引擎回报的每张纸页矩形（编辑器相对坐标），用于绘制背景纸页层，保证与内容严格对齐
  const [pageRects, setPageRects] = useState<{ top: number; height: number }[]>([])
  const pageContentPerPage = Math.max(50, pageHeightPx - docMargins.top - docMargins.bottom)
  const pageGap = Math.max(16, Math.round(pageHeightPx * 0.03))
  const metricsRef = useRef({ pageContentPerPage, gap: pageGap, marginTop: docMargins.top, marginBottom: docMargins.bottom, pageHeightPx })
  metricsRef.current = { pageContentPerPage, gap: pageGap, marginTop: docMargins.top, marginBottom: docMargins.bottom, pageHeightPx }
  // 容器高度随纸页与留白自动增高，避免多页文档被裁切
  const pageRefMinH = pageRects.length
    ? Math.max(...pageRects.map((r) => bodyTop + r.top + r.height)) + 24
    : pageHeightPx

  // 测量编辑器内容实际高度，使“页面”容器随内容增高（多页文档不再被裁切）。
  // 同时监听缩放变化后重新测量。
  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    const measure = () => {
      // scrollHeight 为内容布局高度（不受 CSS zoom 影响，浏览器以未缩放像素返回）
      const h = el.scrollHeight
      setPageContentH((prev) => (Math.abs(prev - h) > 1 ? h : prev))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [document, zoom, pageSize, orientation, pageContentH > 0])

  // 测量编辑器正文区域相对“页面”容器的顶部偏移，用于对齐背景纸页层
  useEffect(() => {
    const pr = pageRef.current
    const er = editorRef.current
    if (!pr || !er) return
    const measureTop = () => {
      const a = pr.getBoundingClientRect()
      const b = er.getBoundingClientRect()
      const t = b.top - a.top
      setBodyTop((prev) => (Math.abs(prev - t) > 0.5 ? t : prev))
    }
    const id = requestAnimationFrame(measureTop)
    return () => cancelAnimationFrame(id)
  }, [document, zoom, pageSize, orientation, pageWidthPx, pageHeightPx, docMargins, showRuler, docHeader, docColumns])

  // 边距 / 缩放 / 分栏等影响分页的布局变化后，强制重新计算分页
  useEffect(() => {
    const v = viewRef.current
    if (!v) return
    const id = requestAnimationFrame(() =>
      v.dispatch(v.state.tr.setMeta('forcePaginate', true).setMeta('addToHistory', false)),
    )
    return () => cancelAnimationFrame(id)
  }, [zoom, pageSize, orientation, docMargins, pageWidthPx, pageHeightPx, docColumns])


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
        createPaginationPlugin(() => metricsRef.current, setPageCount, setPageRects, setBlockPages),
        // 差异对比高亮（左侧：被删除段落标红），仅在并排对比时生效
        diffDecorationPlugin(diffDelRef),
        // 格式刷：暂存源格式后，下一次在目标选区上直接套用源 marks。
        // 单击模式（lock=false）套用一次即解除；锁定模式（lock=true）可连续套用。
        new Plugin({
          appendTransaction: (_transactions: any, _oldState: any, newState: any) => {
            const fp = formatPainterRef.current
            if (!fp) return null
            const names = Object.keys(fp.marks)
            if (names.length === 0) return null // 源格式为空，无意义，跳过
            const sel = newState.selection
            if (sel instanceof NodeSelection) return null
            // 目标范围：拖选则取选区；仅光标（单击）则套用到光标所在文本块（段落），符合 Office 单击格式刷行为
            let from: number, to: number
            if (sel.empty) {
              const pos = Math.min(sel.from, newState.doc.content.size)
              const $pos = newState.doc.resolve(pos)
              from = $pos.start()
              to = $pos.end()
            } else {
              from = sel.from
              to = sel.to
            }
            if (from >= to) return null
            let tr: any = newState.tr
            let added = 0
            for (const name of names) {
              const attrs = (fp.marks as any)[name]
              const m = (schema.marks as any)[name]; if (!m) continue
              tr = tr.addMark(from, to, m.create(attrs || {}))
              added++
            }
            // 注意：appendTransaction 运行在 ProseMirror 应用 transaction 的同步流程中（DOM 处于中间态）。
            // 此处绝不能同步调用 React setState（setPainter），否则 React 重渲染会与 ProseMirror 竞争同一 DOM 子树，
            // 导致 "Failed to execute 'removeChild'" 崩溃。必须用 queueMicrotask 推迟到 DOM 更新完成之后。
            if (added === 0) return null
            if (!fp.lock) schedulePainterClear()
            return tr
          },
        }),
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
        math: (node, _view, getPos) => {
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
            // 打开富公式编辑模态框，预填当前公式并定位到该节点，确认后替换原节点。
            // 注意：getPos 返回该 math 节点的绝对位置，比按 latex 全文搜索定位更可靠
            // （同文档存在多个相同 latex 的公式时旧逻辑会误改第一个）。
            const pos = typeof getPos === 'function' ? getPos() : null
            setMathEdit({
              latex: node.attrs.latex || '',
              inline: !!node.attrs.inline,
              pos: typeof pos === 'number' ? pos : null,
            })
            setShowMathModal(true)
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
        // 只有真正改动了文档内容才向外 emit。
        // 拼写检查装饰、选区变化等事务 docChanged=false，若也走 emit，
        // 会用 proseMirrorToUDM 的裸输出（只含 meta/blocks）覆盖 App 的 doc，
        // 把 protect / pageNumber 等文档级配置冲掉——这正是"设了密码保存后重开却没保护"的根因。
        if (onChangeRef.current && tr.docChanged) {
          const udm = proseMirrorToUDM(ns.doc, { pageNumber: pageNumberRef.current ?? undefined })
          const overrides = stylesRef.current
          if (Object.keys(overrides).length) {
            ;(udm as any).styles = Object.keys(overrides).map((name) => ({ name, type: 'paragraph', props: overrides[name] }))
          }
          // 透传文档保护信息，避免编辑时丢失密码锁定配置
          const curProtect = (documentRef.current as any)?.protect
          if (curProtect) (udm as any).protect = curProtect
          // proseMirrorToUDM 会把 meta 重置为 { title: 'Untitled' }（PM 文档里不含 meta），
          // 直接回流会把原文档标题冲掉——保存后文件标题变成 Untitled。透传原 meta。
          const curMeta = (documentRef.current as any)?.meta
          if (curMeta) (udm as any).meta = curMeta
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
        contextmenu: (view: any, e: any) => {
          e.preventDefault()
          const target = e.target as HTMLElement | null
          const box = (target && target.closest && target.closest('.text-box')) as HTMLElement | null
          contextMenuBoxRef.current = box
          setContextMenuOnTextBox(!!box)
          setShowContextMenu(true)
          setContextMenuPos({ x: e.clientX, y: e.clientY })
          return false
        },

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

  // 并排对比：当对比目标变化时，挂载/重建右侧只读视图，并计算差异高亮集合
  useEffect(() => {
    if (!compareTarget || !compareRef.current) {
      // 退出对比：清空差异集合并刷新左侧装饰
      diffAddRef.current = new Set()
      diffDelRef.current = new Set()
      refreshDiffDecorations()
      return
    }
    const leftTexts = collectParagraphTexts(viewRef.current)
    const pmDoc = udmToProseMirror(compareTarget.doc, schema)
    const state = EditorState.create({
      doc: pmDoc,
      plugins: [
        // 右侧只读视图：差异高亮（新增段落标绿）
        diffDecorationPlugin(diffAddRef),
      ],
    })
    const view = new EditorView(compareRef.current, {
      state,
      editable: () => false,
      // 只读视图不需要丰富的编辑插件；保持轻量
    })
    compareViewRef.current = view
    // 计算差异：右侧新增、左侧被删
    const rightTexts = collectParagraphTexts(view)
    const { add, del } = computeDiffSets(leftTexts, rightTexts)
    diffAddRef.current = add
    diffDelRef.current = del
    refreshDiffDecorations()
    return () => { view.destroy(); compareViewRef.current = null }
  }, [compareTarget])

  const updateActiveState = (state: EditorState) => {
    const marks = new Set<string>()
    const { from, $from, to, empty } = state.selection
    const attrs: any = {}
    if ($from.parent.type.name === 'paragraph' || $from.parent.type.name === 'heading') { Object.assign(attrs, { align: $from.parent.attrs.align, lineHeight: $from.parent.attrs.lineHeight, indent: $from.parent.attrs.indent, indentLeft: $from.parent.attrs.indentLeft, firstLine: $from.parent.attrs.firstLine, spaceBefore: $from.parent.attrs.spaceBefore, spaceAfter: $from.parent.attrs.spaceAfter, border: $from.parent.attrs.border, shading: $from.parent.attrs.shading, rtl: $from.parent.attrs.rtl, letterSpacing: $from.parent.attrs.letterSpacing, dropCap: $from.parent.attrs.dropCap }) }
    let f = '', sz = '', c = '', cs = ''
    const collect = (m: any) => { marks.add(m.type.name); if (m.type.name === 'fontFamily') f = m.attrs.font; if (m.type.name === 'fontSize') sz = m.attrs.size; if (m.type.name === 'textColor') c = m.attrs.color; if (m.type.name === 'charSpacing') cs = m.attrs.value }
    if (empty) { state.storedMarks?.forEach(collect); $from.marks().forEach(collect) } else { state.doc.nodesBetween(from, to, (n) => n.marks.forEach(collect)) }
    if ($from.parent.type.name === 'heading') marks.add(`heading-${$from.parent.attrs.level}`)
    let isInTable = false
    for (let d = $from.depth; d > 0; d--) { if ($from.node(d).type.name === 'table') { isInTable = true; break } }
    setInTable(isInTable); setActiveMarks(marks); setActiveAttrs(attrs); setActiveFont(f); setActiveFontSize(sz); setActiveColor(c); setActiveCharSpacing(cs)
    // Track if cursor is on an image or shape node (for float/wrap buttons)
    const sel = state.selection
    const selNode = sel instanceof NodeSelection ? sel.node : null
    setActiveIsImage(!!selNode && selNode.type.name === 'image')
    setActiveIsShape(!!selNode && selNode.type.name === 'text_box')
    setActiveTextBox(selNode && selNode.type.name === 'text_box' ? { node: selNode, pos: sel.from } : null)
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

  // 将页码模板中的占位符替换为真实页码：{n}/{N}→当前页，{total}/{NUMPAGES}/{TOTAL}→总页数
  const fillPageNumber = (fmt: string | undefined, n: number, total: number) => {
    const f = fmt || '第 {n} 页'
    return f
      .replace(/\{n\}/gi, String(n))
      .replace(/\{total\}/gi, String(total))
      .replace(/\{NUMPAGES\}/gi, String(total))
  }

  // 主动向外 emit 当前文档（携带最新页码配置）。
  // 用于「仅修改页码设置、未编辑正文」时，确保 pageNumber 写回 doc 以免保存丢失。
  const emitDoc = (pn?: PageNumberConfig | null) => {
    const v = viewRef.current
    if (!v || !onChangeRef.current) return
    const cfg = pn === undefined ? pageNumberRef.current : pn
    if (pn !== undefined) pageNumberRef.current = pn
    const out = proseMirrorToUDM(v.state.doc, { pageNumber: cfg ?? undefined })
    // proseMirrorToUDM 只还原正文，样式与保护配置不在 PM 文档里，
    // 必须与 dispatchTransaction 一样显式透传，否则会被这次 emit 抹掉
    // （典型后果：设过密码保护后改一次页码/页面设置，保存出去的文件就没有保护了）。
    const overrides = stylesRef.current
    if (Object.keys(overrides).length) {
      ;(out as any).styles = Object.keys(overrides).map((name) => ({ name, type: 'paragraph', props: overrides[name] }))
    }
    const curProtect = (documentRef.current as any)?.protect
    if (curProtect) (out as any).protect = curProtect
    const curMeta = (documentRef.current as any)?.meta
    if (curMeta) (out as any).meta = curMeta
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
      case 'copy': { v.focus(); serializeSelectionToClipboard(v, false); setShowContextMenu(false); break }
      case 'cut': { v.focus(); serializeSelectionToClipboard(v, true); setShowContextMenu(false); break }
      case 'paste': {
        v.focus()
        ;(async () => {
          try {
            const html = await (window as any).runtime.GetClipboardHtml()
            if (html && html.trim()) {
              const nativeDoc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html')
              const slice = PMDOMParser.fromSchema(schema).parseSlice(nativeDoc.body)
              v.dispatch(v.state.tr.replaceSelection(slice).scrollIntoView())
            } else {
              const t2 = await (window as any).runtime.ClipboardGetText()
              if (t2) v.dispatch(v.state.tr.insertText(t2).scrollIntoView())
            }
          } catch { /* ignore */ }
        })()
        setShowContextMenu(false); break
      }
      case 'formatPainter': {
        // 单击格式刷：未激活则开启（非锁定），已激活则关闭（toggle）
        if (formatPainterRef.current) setPainter(null)
        else setPainter({ marks: getActiveMarks(), lock: false })
        break
      }
      case 'clearFormat': {
        const { state, dispatch } = v
        const { from, to } = state.selection
        const tr = state.tr
        const markNames = ['bold', 'italic', 'underline', 'strikethrough', 'subscript', 'superscript', 'code', 'fontSize', 'fontFamily', 'fontColor', 'highlight', 'comment_mark', 'charSpacing']
        markNames.forEach((n) => { const m = (state.schema.marks as any)[n]; if (m) tr.removeMark(from, to, m) })
        dispatch(tr); v.focus(); break
      }
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

  const setParaAttr = (attr: string, value: any, focusAfter = true) => {
    const v = viewRef.current; if (!v) return
    const { $from, $to } = v.state.selection
    const tr = v.state.tr
    let changed = false
    v.state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
      if (node.type.name === 'paragraph' || node.type.name === 'heading') {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, [attr]: value })
        changed = true
      }
    })
    if (changed) { v.dispatch(tr); if (focusAfter) v.focus() }
  }
  // 段落边框辅助：border 为空格分隔的方向集合（'all' 为四边别名）
  const borderHas = (b: string, side: string) => {
    const s = (b || '').split(/\s+/).filter(Boolean)
    return s.includes('all') || s.includes(side)
  }
  const toggleBorderSide = (side: string) => {
    const cur = activeAttrs.border || ''
    const sides = cur === 'all' ? ['top', 'right', 'bottom', 'left'] : cur.split(/\s+/).filter(Boolean)
    const idx = sides.indexOf(side)
    if (idx >= 0) sides.splice(idx, 1); else sides.push(side)
    setParaAttr('border', sides.length ? sides.join(' ') : '')
  }
  const toggleBorderAll = () => setParaAttr('border', borderHas(activeAttrs.border, 'all') ? '' : 'all')
  // 缩进增减（按字符单位 em，贴近 Word 的“增加/减少缩进量”）
  // 段前/段后间距快捷调节（pt）
  const changeSpace = (which: 'before' | 'after', delta: number) => {
    const v = viewRef.current; if (!v) return
    const { $from, $to } = v.state.selection
    const key = which === 'before' ? 'spaceBefore' : 'spaceAfter'
    const tr = v.state.tr
    let changed = false
    v.state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
      if (node.type.name === 'paragraph' || node.type.name === 'heading') {
        const cur = Number(node.attrs[key]) || 0
        const next = Math.max(0, Math.min(120, cur + delta))
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, [key]: next })
        changed = true
      }
    })
    if (changed) { v.dispatch(tr); v.focus() }
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
  const setFont = (font: string) => {
    const v = viewRef.current; if (!v) return
    const { state, dispatch } = v
    const { from, to, empty } = state.selection
    const m = schema.marks.fontFamily
    if (!font) {
      // 清除字体
      if (empty) {
        const stored = state.storedMarks ? state.storedMarks.slice() : state.selection.$from.marks()
        dispatch(state.tr.setStoredMarks(stored.filter(mk => mk.type !== m)))
      } else {
        dispatch(state.tr.removeMark(from, to, m))
      }
      v.focus(); return
    }
    // 关键：始终设置为目标字体（先移除旧 fontFamily 再添加新），不能用 toggleMark——
    // 否则选区已有任意字体时 toggleMark 会误判为"已存在"而移除，导致第一次点击跳回默认、需点两次。
    const mark = m.create({ font })
    if (empty) {
      const stored = state.storedMarks ? state.storedMarks.slice() : state.selection.$from.marks()
      dispatch(state.tr.setStoredMarks([...stored.filter(mk => mk.type !== m), mark]))
    } else {
      dispatch(state.tr.removeMark(from, to, m).addMark(from, to, mark))
    }
    v.focus()
  }
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
  // 字号加减：直接读取编辑器当前选区/光标处的真实有效字号作为基准（不依赖可能滞后的 activeFontSize 状态）
  const bumpFontSize = (delta: number) => {
    const v = viewRef.current; if (!v) return
    const { state } = v
    const { empty, from, $from } = state.selection
    let cur = NaN
    const readSize = (s: string) => {
      const num = parseFloat(s)
      if (isNaN(num)) return NaN
      // 兼容旧文档可能残留的 pt 单位：pt 需换算成 px 再作基准
      return s.includes('pt') ? num * 96 / 72 : num
    }
    if (empty) {
      const ms = state.storedMarks ? state.storedMarks : $from.marks()
      const fm = ms.find(m => m.type.name === 'fontSize')
      if (fm) cur = readSize(fm.attrs.size)
    } else {
      const fm = state.doc.nodeAt(from)?.marks.find(m => m.type.name === 'fontSize')
      if (fm) cur = readSize(fm.attrs.size)
    }
    const base = isNaN(cur) ? 15 : cur
    const next = Math.max(1, Math.round(base + delta))
    setFontSize(`${next}px`)
    v.focus()
  }
  // 字符间距（字间距）：与字号一样是字符级标记，作用于选区/后续输入
  const setCharSpacing = (val: string) => {
    const v = viewRef.current; if (!v) return
    const { state, dispatch } = v
    const { from, to, empty } = state.selection
    const trimmed = (val || '').trim()
    if (!trimmed) { // 清空字间距
      if (!empty) dispatch(state.tr.removeMark(from, to, schema.marks.charSpacing))
      return
    }
    // 仅数字视为 px，否则按原 CSS 值（如 0.5pt / 2px）处理
    const value = /^-?\d+(\.\d+)?$/.test(trimmed) ? `${trimmed}px` : trimmed
    const mark = schema.marks.charSpacing.create({ value })
    if (empty) {
      const stored = state.storedMarks ? state.storedMarks.slice() : state.selection.$from.marks()
      const filtered = stored.filter(m => m.type !== schema.marks.charSpacing)
      dispatch(state.tr.setStoredMarks([...filtered, mark]))
    } else {
      dispatch(state.tr.removeMark(from, to, schema.marks.charSpacing).addMark(from, to, mark))
    }
  }
  const setTextColor = (color: string) => { const v = viewRef.current; if (!v) return; toggleMark(schema.marks.textColor, { color })(v.state, v.dispatch); v.focus() }
  const setHighlight = (color: string) => { const v = viewRef.current; if (!v) return; toggleMark(schema.marks.highlight, { color })(v.state, v.dispatch); v.focus() }
  const handleSearch = () => { const v = viewRef.current; if (!v || !searchQuery) return; doSearch(v, searchQuery, false) }
  const handleReplace = () => { const v = viewRef.current; if (!v) return; doReplace(v, searchQuery, replaceQuery, false) }
  const handleReplaceAll = () => {
    const v = viewRef.current
    if (!v) return
    const count = doReplaceAll(v, searchQuery, replaceQuery, false)
    if (count > 0) onToast?.(t('doc.replacedCount', { count }))
  }
  const handlePrint = () => { setPrintPreview(false); setTimeout(() => window.print(), 100) }
  const insertFormula = () => {
    // 打开独立公式编辑器弹窗（若有选中 math 节点则预填用于编辑）
    const v = viewRef.current
    let init = { latex: '', inline: false, pos: null as number | null }
    if (v) {
      const sel = v.state.selection
      const node = sel instanceof NodeSelection ? sel.node : null
      if (node && node.type.name === 'math') {
        init = { latex: node.attrs.latex || '', inline: !!node.attrs.inline, pos: sel.from }
      }
    }
    setMathEdit(init)
    setShowMathModal(true)
  }
  const insertSymbol = (sym: string) => {
    const v = viewRef.current; if (!v) return
    v.dispatch(v.state.tr.replaceSelectionWith(schema.text(sym)))
    v.focus()
  }
  // 更新选中 text_box 节点的样式属性（边框宽度/线型/颜色/填充/圆角/形状）
  const updateTextBox = (attrs: Record<string, any>) => {
    const v = viewRef.current; if (!v) return
    const cur = activeTextBox
    if (!cur) return
    const old = cur.node
    const newNode = schema.nodes.text_box.create({ ...old.attrs, ...attrs }, old.content)
    const tr = v.state.tr.replaceWith(cur.pos, cur.pos + old.nodeSize, newNode)
    v.dispatch(tr)
    v.focus()
    // 同步浮动面板状态
    setActiveTextBox({ node: newNode, pos: cur.pos })
  }
  // 右键菜单"编辑样式"：选中被右键的文本框/形状（NodeSelection），使浮动样式面板弹出
  const editTextBoxStyle = () => {
    const v = viewRef.current
    const box = contextMenuBoxRef.current
    setShowContextMenu(false)
    if (!v || !box) return
    // 用文本框中心坐标定位其内部 pos，再向上回溯到 text_box 节点的起始位置
    const rect = box.getBoundingClientRect()
    const at = v.posAtCoords({ left: rect.left + rect.width / 2, top: rect.top + rect.height / 2 })
    if (!at) return
    const $pos = v.state.doc.resolve(at.pos)
    for (let d = $pos.depth; d > 0; d--) {
      if ($pos.node(d).type.name === 'text_box') {
        const pos = $pos.before(d)
        v.dispatch(v.state.tr.setSelection(NodeSelection.create(v.state.doc, pos)))
        v.focus()
        return
      }
    }
  }
  // 公式弹窗插入/更新
  const handleMathInsert = (latex: string, inline: boolean) => {
    const v = viewRef.current; if (!v) { setShowMathModal(false); return }
    const mathNode = schema.nodes.math.create({ latex, inline })
    const tr = v.state.tr
    if (mathEdit.pos != null) {
      // 编辑已有公式：替换原节点
      const old = v.state.doc.nodeAt(mathEdit.pos)
      if (old) tr.replaceWith(mathEdit.pos, mathEdit.pos + old.nodeSize, mathNode)
    } else {
      tr.replaceSelectionWith(mathNode)
    }
    v.dispatch(tr)
    v.focus()
    setShowMathModal(false)
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

  // 收集文档所有顶级块（段落/标题/列表项等）的纯文本，用于差异对比
  const collectParagraphTexts = (v: EditorView | null): string[] => {
    const out: string[] = []
    if (!v) return out
    v.state.doc.descendants((node) => {
      if (node.isBlock && node.isTextblock) {
        const txt = node.textContent.trim()
        if (txt) out.push(txt)
        return false
      }
      return true
    })
    return out
  }

  // 计算差异集合：rightAdds（右侧有、左侧无）、leftDels（左侧有、右侧无）
  const computeDiffSets = (left: string[], right: string[]) => {
    const add = new Set<string>()
    const del = new Set<string>()
    const lset = new Set(left)
    const rset = new Set(right)
    right.forEach((t) => { if (!lset.has(t)) add.add(t) })
    left.forEach((t) => { if (!rset.has(t)) del.add(t) })
    return { add, del }
  }

  // 差异高亮插件：根据传入的段落文本集合，对匹配的文本块添加背景装饰
  const diffDecorationPlugin = (setRef: React.MutableRefObject<Set<string>>) => {
    return new Plugin({
      props: {
        decorations: (state: any) => {
          const set = setRef.current
          if (set.size === 0) return DecorationSet.empty
          const decos: any[] = []
          state.doc.descendants((node: any, pos: number) => {
            if (node.isBlock && node.isTextblock) {
              const txt = node.textContent.trim()
              if (txt && set.has(txt)) {
                decos.push(Decoration.node(pos, pos + node.nodeSize, { class: set === diffAddRef.current ? 'diff-add' : 'diff-del' }))
              }
              return false
            }
            return true
          })
          return DecorationSet.create(state.doc, decos)
        },
      },
    })
  }

  // 触发两侧视图重新计算差异装饰
  const refreshDiffDecorations = () => {
    const lv = viewRef.current, rv = compareViewRef.current
    if (lv) lv.dispatch(lv.state.tr.setMeta('diffUpdate', true).setMeta('addToHistory', false))
    if (rv) rv.dispatch(rv.state.tr.setMeta('diffUpdate', true).setMeta('addToHistory', false))
  }

  const runCompare = async () => {
    try {
      const path = await backend?.openFileDialog?.()
      if (!path) return
      // 复用后端解析能力，得到完整 UDM 文档（保留富文本结构）
      const result: any = backend?.openFile ? await backend.openFile(path) : null
      const doc: Document | undefined = result?.document
      if (!doc) { alert(t('doc.compareError') + ': ' + (t('doc.compareUnsupported') || 'unsupported file')); return }
      setCompareTarget({ name: path.split(/[\\/]/).pop() || path, doc })
    } catch (e: any) {
      alert(t('doc.compareError') + ': ' + (e?.message || e))
    }
  }

  // 同步滚动：按滚动百分比同步两侧
  const syncScroll = (from: 'left' | 'right') => {
    if (syncLockRef.current) return
    const left = leftScrollRef.current
    const right = compareRef.current
    if (!left || !right) return
    syncLockRef.current = true
    if (from === 'left') {
      const ratio = left.scrollTop / Math.max(1, left.scrollHeight - left.clientHeight)
      right.scrollTop = ratio * Math.max(0, right.scrollHeight - right.clientHeight)
    } else {
      const ratio = right.scrollTop / Math.max(1, right.scrollHeight - right.clientHeight)
      left.scrollTop = ratio * Math.max(0, left.scrollHeight - left.clientHeight)
    }
    requestAnimationFrame(() => { syncLockRef.current = false })
  }

  const toggleProtect = () => {
    const v = viewRef.current; if (!v) return
    if (!protectedMode) {
      // 设置保护：输入密码，将哈希写入 document.protect 并持久化
      const pwd = prompt(t('doc.protectSetPwd'))
      if (!pwd) return
      const hash = hashPwd(pwd)
      // 用 ref 取最新文档，避免闭包捕获到旧 props 而把刚编辑的正文回退
      const base: any = documentRef.current ?? document
      const updated: any = { ...base, protect: { enabled: true, hash } }
      // 立刻同步 ref：React 重渲染是异步的，期间若有事务 emit，
      // 读到旧 ref 就会把刚设置的保护冲掉。
      documentRef.current = updated
      lastEmittedRef.current = updated
      onChange?.(updated)
      unlockHashRef.current = hash
      setProtectedMode(true)
      v.setProps({ editable: () => false })
    } else {
      // 取消保护：需要先验证密码
      const pwd = prompt(t('doc.protectEnterPwd'))
      if (pwd == null) return
      if (hashPwd(pwd) === (document.protect?.hash ?? '')) {
        const base: any = documentRef.current ?? document
        const updated: any = { ...base, protect: { enabled: false, hash: document.protect?.hash ?? '' } }
        documentRef.current = updated
        lastEmittedRef.current = updated
        onChange?.(updated)
        unlockHashRef.current = ''
        setProtectedMode(false)
        setShowUnlock(false)
        v.setProps({ editable: () => true })
      } else {
        alert(t('doc.protectWrongPwd'))
      }
    }
  }

  // 打开受保护文档时，若尚未解锁则进入只读并弹出密码框
  useEffect(() => {
    if (document.protect?.enabled) {
      if (unlockHashRef.current !== document.protect.hash) {
        setProtectedMode(true)
        setShowUnlock(true)
        const v = viewRef.current
        if (v) v.setProps({ editable: () => false })
      }
    }
  }, [document])

  // 提交解锁密码
  const submitUnlock = () => {
    const v = viewRef.current; if (!v) return
    if (hashPwd(unlockInput) === (document.protect?.hash ?? '')) {
      unlockHashRef.current = document.protect!.hash
      setProtectedMode(false)
      setShowUnlock(false)
      setUnlockInput('')
      setUnlockError(false)
      v.setProps({ editable: () => true })
    } else {
      setUnlockError(true)
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
      <div
        className="flex items-stretch px-1 py-1 flex-shrink-0 border-b w-full ribbon-scroll"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', minHeight: '72px', position: 'relative', zIndex: 45, '--wails-draggable': 'drag' as any } as any}
        // 点击功能区按钮时不要抢走编辑器的焦点，否则选中的文本选区会被清空，
        // 导致无法对同一段选中文本连续执行多次操作（加粗后再改字号/颜色等）。
        onMouseDown={(e) => { const el = e.target as HTMLElement; if (el.closest('button')) e.preventDefault() }}
      >
        {ribbonTab === 'home' && (<>
          <RibbonGroup label={t('doc.clipboard')}>
            <RibbonButton icon="↶" label={t('doc.undo')} onClick={() => exec('undo')} title="Ctrl+Z" />
            <RibbonButton icon="↷" label={t('doc.redo')} onClick={() => exec('redo')} title="Ctrl+Y" />
            <RibbonButton icon="🖌" label={t('doc.formatPainter')} onClick={handlePainterClick} onDoubleClick={handlePainterDouble} active={!!formatPainter} title={t('doc.formatPainter') + (formatPainter?.lock ? '（锁定：连续刷，再次双击或 Esc 退出）' : '（单击开启/关闭，双击锁定连续刷）')} />
            <RibbonButton icon="⌫" label={t('doc.clearFormat')} onClick={() => exec('clearFormat')} title={t('doc.clearFormat')} />
          </RibbonGroup>
          <RibbonGroup label={t('doc.font')}>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <Dropdown
                className="text-xs rounded-md px-2 ribbon-input"
                style={{ width: 110, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', height: 26 }}
                value={activeFont}
                onChange={v => setFont(v)}
                options={(() => {
                  const opts = FONTS.map(f => ({ label: f.name, value: f.value }))
                  // 文档里实际使用的字体（可能不在预置列表，如解析进来的中文/旧格式值）也要能选中显示
                  if (activeFont && !opts.some(o => o.value === activeFont)) {
                    opts.push({ label: activeFont, value: activeFont })
                  }
                  return opts
                })()}
              />
                <button onClick={() => bumpFontSize(-1)} className="toolbar-btn" title={t('doc.fontSize') + ' -'} type="button" style={{ width: 24, height: 26, fontSize: '15px', fontWeight: 700, lineHeight: 1 }}>-</button>
                <button onClick={() => bumpFontSize(1)} className="toolbar-btn" title={t('doc.fontSize') + ' +'} type="button" style={{ width: 24, height: 26, fontSize: '15px', fontWeight: 700, lineHeight: 1 }}>+</button>
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
                {/* 字间距：与字号一样支持输入数字（数值视为 px），作用于选区/后续输入 */}
                <Dropdown
                  className="text-xs rounded-md px-2 ribbon-input"
                  style={{ width: 60, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', height: 26 }}
                  editable
                  inputMode="numeric"
                  inputValue={activeCharSpacing.replace(/px$/, '')}
                  placeholder="0"
                  onInputChange={(raw) => {
                    const v = raw.trim()
                    if (v === '') { setCharSpacing(''); return }
                    const num = parseFloat(v)
                    if (!isNaN(num)) setCharSpacing(`${num}px`)
                  }}
                  onInputBlur={() => { const v = viewRef.current; if (v) v.focus() }}
                  value={activeCharSpacing}
                  onChange={(v) => setCharSpacing(v)}
                  options={['0px', '0.5px', '1px', '1.5px', '2px', '3px', '-1px', '-0.5px'].map(s => ({ label: s, value: s }))}
                  title={t('doc.charSpacing')}
                  testId="charSpacing"
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
                  editable
                  inputValue={activeAttrs.lineHeight || ''}
                  title={t('doc.lineSpacing')}
                  placeholder="1.5"
                  inputMode="text"
                  onInputChange={(raw) => {
                    const v = raw.trim()
                    if (v === '') { setParaAttr('lineHeight', ''); return }
                    // 带单位（pt/px）：固定值行距，如 28pt
                    if (/^\d+(?:\.\d+)?\s*(pt|px)$/i.test(v)) {
                      setParaAttr('lineHeight', v.replace(/\s+/g, '').toLowerCase())
                      return
                    }
                    // 纯数字：倍数行距，如 1.5、2
                    const num = parseFloat(v)
                    if (!isNaN(num) && num > 0) setParaAttr('lineHeight', String(num))
                  }}
                  onInputBlur={() => { const v = viewRef.current; if (v) v.focus() }}
                  value={activeAttrs.lineHeight || ''}
                  onChange={v => setParaAttr('lineHeight', v)}
                  options={[{ label: t('doc.lineSpacing'), value: '' }, ...LINE_HEIGHTS.map(l => ({ label: l.name, value: l.value }))]}
                />
                <Dropdown
                  className="text-xs rounded-md px-2 py-1 ribbon-input"
                  style={{ width: 92, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', height: 26 }}
                  editable
                  testId="paraLetterSpacing"
                  inputMode="numeric"
                  inputValue={activeAttrs.letterSpacing ? activeAttrs.letterSpacing.replace(/px$/, '') : ''}
                  onInputChange={(raw) => {
                    const v = raw.trim()
                    if (v === '') { setParaAttr('letterSpacing', '', false); return }
                    const num = parseFloat(v)
                    if (!isNaN(num)) setParaAttr('letterSpacing', `${num}px`, false)
                  }}
                  onInputBlur={() => { const v = viewRef.current; if (v) v.focus() }}
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
            <RibbonButton icon="Σ" label={t('doc.formula')} onClick={insertFormula} data-testid="insert-formula" />
            <RibbonButton icon="Ω" label={t('doc.symbols')} onClick={() => { setMathEdit({ latex: '', inline: false, pos: null }); setShowMathModal(true) }} />
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
            <RibbonButton icon="▢" label={t('doc.borderAll')} onClick={toggleBorderAll} active={borderHas(activeAttrs.border, 'all')} />
            <RibbonButton icon="▔" label={t('doc.borderTop')} onClick={() => toggleBorderSide('top')} active={borderHas(activeAttrs.border, 'top')} />
            <RibbonButton icon="▕" label={t('doc.borderRight')} onClick={() => toggleBorderSide('right')} active={borderHas(activeAttrs.border, 'right')} />
            <RibbonButton icon="▁" label={t('doc.borderBottom')} onClick={() => toggleBorderSide('bottom')} active={borderHas(activeAttrs.border, 'bottom')} />
            <RibbonButton icon="▏" label={t('doc.borderLeft')} onClick={() => toggleBorderSide('left')} active={borderHas(activeAttrs.border, 'left')} />
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
            <RibbonButton icon="⚖️" label={t('doc.compare')} onClick={runCompare} active={!!compareTarget} title={t('doc.compareTitle')} />
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
            <RibbonButton icon="🪟" label={t('doc.newWindow')} onClick={() => { const go = (window as any).go?.main?.App; if (go?.NewWindow) go.NewWindow(); else if ((window as any).runtime?.WindowNew) (window as any).runtime.WindowNew() }} title={t('doc.newWindowTitle')} />
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
        const MENU_W = 180, MENU_H = 270
        const vw = window.innerWidth, vh = window.innerHeight
        let cx = contextMenuPos.x, cy = contextMenuPos.y
        if (cx + MENU_W > vw - 8) cx = Math.max(8, vw - MENU_W - 8)
        if (cy + MENU_H > vh - 8) cy = Math.max(8, vh - MENU_H - 8)
        return (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowContextMenu(false)} />
          <div className="fixed z-50 py-1.5 rounded-lg shadow-xl animate-fade-in" style={{ left: cx, top: cy, background: 'var(--color-surface)', border: '1px solid var(--color-border)', minWidth: 180 }}>
            <button onClick={() => exec('undo')} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>↶ {t('doc.undo')}</button>
            <button onClick={() => exec('redo')} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>↷ {t('doc.redo')}</button>
            <div className="my-1 mx-3 h-px" style={{ background: 'var(--color-border)' }} />
            <button onClick={() => exec('cut')} disabled={!hasSelection()} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors disabled:opacity-40 disabled:cursor-not-allowed" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>✂ {t('doc.cut')}</button>
            <button onClick={() => exec('copy')} disabled={!hasSelection()} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors disabled:opacity-40 disabled:cursor-not-allowed" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>⧉ {t('doc.copy')}</button>
            <button onClick={() => exec('paste')} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>📋 {t('doc.paste')}</button>
            <div className="my-1 mx-3 h-px" style={{ background: 'var(--color-border)' }} />
            <button onClick={() => exec('bold')} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}><b>B</b> {t('doc.bold')}</button>
            <button onClick={() => exec('italic')} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}><i>I</i> {t('doc.italic')}</button>
            <button onClick={() => exec('underline')} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}><u>U</u> {t('doc.underline')}</button>
            <div className="my-1 mx-3 h-px" style={{ background: 'var(--color-border)' }} />
            <button onClick={() => { setSearchOpen(true); setShowContextMenu(false) }} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>🔍 {t('doc.findReplace')}</button>
            <button onClick={() => exec('comment')} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>💬 {t('doc.addComment')}</button>
            <button onClick={() => { setRibbonTab('insert'); setShowContextMenu(false) }} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>📊 {t('doc.insertTable')}</button>
            {contextMenuOnTextBox && (
              <>
                <div className="my-1 mx-3 h-px" style={{ background: 'var(--color-border)' }} />
                <button onClick={editTextBoxStyle} className="flex w-full items-center px-3 py-1.5 text-xs gap-3 transition-colors" style={{ color: 'var(--color-text)' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>🎨 {t('doc.editStyle')}</button>
              </>
            )}
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

      <div style={{ flex: '1 1 auto', display: 'flex', minHeight: 0, flexDirection: compareTarget ? 'row' : 'column' }}>
      <div
        ref={leftScrollRef}
        onScroll={() => syncScroll('left')}
        className={`flex-1 overflow-auto ${showMarks ? 'show-edit-marks' : ''} ${(splitWindow || compareTarget) ? 'flex' : ''}`}
        style={{ background: 'var(--color-bg-alt)', position: 'relative', zIndex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', flex: compareTarget ? '1 1 50%' : '1 1 auto', minWidth: 0, borderRight: compareTarget ? '2px solid var(--color-border)' : 'none' }}
      >
      <div
        ref={pageRef}
        className="mx-auto animate-fade-in"
        style={{
          position: 'relative',
          marginTop: '24px',
          marginBottom: '24px',
          borderRadius: '8px',
          background: 'transparent',
          width: pageWidthPx,
          minHeight: pageRefMinH,
          overflow: 'visible',
        }}
      >
        {/* 纸页背景层：每张纸依据分页引擎算出的实际内容位置绘制，与内容严格对齐 */}
        <div ref={sheetsLayerRef} style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
          {pageRects.map((p, i) => (
            <Fragment key={i}>
              <div style={{ position: 'absolute', top: bodyTop + p.top, left: 0, width: pageWidthPx, height: p.height, background: bgColor, boxShadow: '0 0 32px rgba(15, 23, 42, 0.06)', borderRadius: '8px' }}>
                {/* 每页脚注区：脚注文本显示在引用所在页底部，而非文档末尾 */}
                {(footnotesByPage[i] || []).length > 0 && (
                  <div style={{
                    position: 'absolute',
                    left: docMargins.left,
                    right: docMargins.right,
                    bottom: Math.round(docMargins.bottom * 0.55) + 18,
                    borderTop: '1px solid var(--color-border)',
                    padding: '4px 0',
                    fontSize: '0.82em',
                    lineHeight: 1.5,
                    color: 'var(--color-text-muted)',
                    background: 'rgba(255,255,255,0.92)',
                    pointerEvents: 'auto',
                  }}>
                    {(footnotesByPage[i] || []).map((f) => (
                      <div key={f.sectionPos} style={{ display: 'flex', alignItems: 'flex-start', gap: '4px', margin: '2px 0' }}
                           onDoubleClick={() => editFootnote(f)} title={t('doc.prompt.footnote') || '双击编辑脚注'}>
                        <span style={{ flex: 1, wordBreak: 'break-word' }}>
                          <span style={{ color: '#4f46e5', marginRight: '4px', fontSize: '0.92em' }}>{f.num}.</span>{f.text || ' '}
                        </span>
                        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); copyFootnote(f) }}
                                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '12px', lineHeight: 1, padding: '0 4px' }}
                                title="复制脚注">复制</button>
                        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); deleteFootnote(f) }}
                                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '14px', lineHeight: 1, padding: '0 4px' }}
                                title="删除脚注">×</button>
                      </div>
                    ))}
                  </div>
                )}
                {/* 文本输入区四角直角标记：仅“显示标记”时显示，标记“可输入内容的起始位置空间”——
                    即页边距之内的正文区域（可编辑文本区）的四个角。角标紧贴文本区边界，
                    让用户一眼看清正文从哪里开始、到哪里结束。
                    该纸页背景 div 的尺寸=整张纸（pageWidthPx × p.height），文本区起点在
                    docMargins.top/left 处，终点在右侧 docMargins.right、底部 docMargins.bottom 处，
                    因此角标需以页边距为偏移定位到文本区四角（而非整张纸四角）。 */}
                {showMarks && (() => {
                  const size = 16
                  const cornerColor = '#5b9bd5' // Word 风格蓝灰，与页面边界一致
                  const mt = docMargins.top
                  const mb = docMargins.bottom
                  const ml = docMargins.left
                  const mr = docMargins.right
                  return (
                    <Fragment>
                      <span style={{ position: 'absolute', top: mt, left: ml, width: size, height: size, borderTop: `2px solid ${cornerColor}`, borderLeft: `2px solid ${cornerColor}`, pointerEvents: 'none' }} />
                      <span style={{ position: 'absolute', top: mt, right: mr, width: size, height: size, borderTop: `2px solid ${cornerColor}`, borderRight: `2px solid ${cornerColor}`, pointerEvents: 'none' }} />
                      <span style={{ position: 'absolute', bottom: mb, left: ml, width: size, height: size, borderBottom: `2px solid ${cornerColor}`, borderLeft: `2px solid ${cornerColor}`, pointerEvents: 'none' }} />
                      <span style={{ position: 'absolute', bottom: mb, right: mr, width: size, height: size, borderBottom: `2px solid ${cornerColor}`, borderRight: `2px solid ${cornerColor}`, pointerEvents: 'none' }} />
                    </Fragment>
                  )
                })()}
              </div>
              {/* 每页底部页码（预览）：按真实页码填充模板 */}
              {pageNumber?.enabled && (
                <div style={{
                  position: 'absolute',
                  top: bodyTop + p.top + p.height - Math.round(docMargins.bottom * 0.55) - 8,
                  left: 0,
                  width: pageWidthPx,
                  textAlign: (pageNumber.align as any) || 'center',
                  fontSize: `${((pageNumber.fontSize || 18) / 2)}px`,
                  color: pageNumber.fontColor || 'var(--color-text-muted)',
                  fontFamily: pageNumber.fontFamily || undefined,
                  fontWeight: pageNumber.bold ? 700 : 400,
                  fontStyle: pageNumber.italic ? 'italic' : 'normal',
                  pointerEvents: 'none',
                }}>
                  {fillPageNumber(pageNumber.format, i + 1, pageRects.length)}
                </div>
              )}
            </Fragment>
          ))}
        </div>
        <div style={{ position: 'relative', zIndex: 1 }}>
          {/* 水平标尺（Word 风格：厘米刻度 + 页边距 + 可拖拽缩进滑块）。
              加常量 key 固定身份：本节点同为 ProseMirror 宿主容器的前置兄弟，
              切换标尺时不得让后续兄弟发生跨位置 reconcile。 */}
          {showRuler && (
            <Ruler
              key="doc-ruler"
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
          {/* 页眉。
              必须常驻渲染（用 display 控制显隐）而非 `{cond && ...}`：本节点是下方 ProseMirror
              宿主容器的前置兄弟，一旦条件挂载/卸载就会改变宿主容器在 children 中的下标，
              触发 React 跨位置 reconcile，对 ProseMirror 自持的 DOM 调用 removeChild 导致崩溃。
              注意原实现的外层条件里含 docLineNumbers —— 切换「行号」会让本节点整体增删，
              正是 removeChild 崩溃的触发源之一。 */}
          <div
            key="doc-header"
            style={{
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
          {/* 编辑器主体 — 应用页边距 + 分栏 */}
          <div style={{ position: 'relative', display: 'flex', flex: 1 }}>
            {/* 行号层。
                该层是 ProseMirror 宿主容器的兄弟节点，且它是绝对定位的纯装饰层。
                此处必须用「常驻 + key + display 切换」而不是 `{cond && ...}` 条件渲染：
                条件渲染会让宿主容器在父节点 children 数组中的下标发生变化，触发 React 跨位置
                reconcile / commitDeletion，进而对 ProseMirror 已接管的 DOM 调用 removeChild 而崩溃。 */}
            <div
              key="line-numbers"
              style={{
                display: docLineNumbers ? 'block' : 'none',
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
              {docLineNumbers && Array.from({ length: 30 }, (_, i) => (
                <div key={i} style={{ minHeight: '1.8em' }}>{i + 1}</div>
              ))}
            </div>
            {/* ProseMirror 宿主容器。
                关键：该 div 内部的 DOM 完全由 ProseMirror 拥有（EditorView 会在其中注入并持续增删
                .ProseMirror 子树）。React 绝不能参与该子树的 reconcile，否则在兄弟节点条件渲染
                （如行号层 docLineNumbers、页底脚注兜底区）挂载/卸载引发的 commitDeletion 递归中，
                React 会按自己过时的 fiber 记录对已被 ProseMirror 替换的节点调用 removeChild，
                抛出 "Failed to execute 'removeChild' on 'Node'"。
                因此：
                1) key 固定为常量 'pm-host'，保证 React 永远把它识别为同一元素、不跨兄弟位置复用；
                2) 始终渲染 children={undefined} 且不放任何 JSX 子节点，React 视其为空宿主，
                   不会尝试卸载 ProseMirror 注入的子树。 */}
            <div
              key="pm-host"
              ref={editorRef as any}
              suppressHydrationWarning
              style={{
                width: '100%',
                margin: '0 auto',
                padding: `${docMargins.top}px ${docMargins.right}px 0px ${docMargins.left}px`,
                columnCount: docColumns > 1 ? docColumns : undefined,
                columnGap: docColumns > 1 ? '32px' : undefined,
                columnRule: docColumns > 1 ? '1px solid var(--color-border)' : undefined,
                background: 'transparent',
                minHeight: '100%',
                position: 'relative',
              }}
              className={`${showRuler ? 'show-ruler' : ''} ${showGridlines ? 'show-gridlines' : ''} ${eyeCareMode ? 'eye-care-mode' : ''} ${showMarks ? 'show-marks' : ''}`}
            />
          </div>
          {/* 页底脚注区兜底：分页引擎尚未回报页码时（首帧）仍统一显示在页底，避免闪烁丢失 */}
          {blockPages.length === 0 && footnotes.length > 0 && (
            <div style={{
              borderTop: '1px solid var(--color-border)',
              padding: `${Math.round(docMargins.bottom * 0.3)}px ${docMargins.right}px ${Math.round(docMargins.bottom * 0.3)}px ${docMargins.left}px`,
              fontSize: '0.82em',
              color: 'var(--color-text-muted)',
              background: bgColor,
            }}>
              {footnotes.map((f) => (
                <div key={f.sectionPos} style={{ display: 'flex', alignItems: 'flex-start', gap: '4px', margin: '2px 0' }}
                     onDoubleClick={() => editFootnote(f)} title={t('doc.prompt.footnote') || '双击编辑脚注'}>
                  <span style={{ flex: 1, wordBreak: 'break-word', lineHeight: 1.5 }}>
                    <span style={{ color: '#4f46e5', marginRight: '4px', fontSize: '0.92em' }}>{f.num}.</span>{f.text || ' '}
                  </span>
                  <button type="button" onClick={(e) => { e.stopPropagation(); copyFootnote(f) }}
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '12px', lineHeight: 1, padding: '0 4px' }}
                          title="复制脚注">复制</button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); deleteFootnote(f) }}
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '14px', lineHeight: 1, padding: '0 4px' }}
                          title="删除脚注">×</button>
                </div>
              ))}
            </div>
          )}
          {/* 页脚（每页真实页码由纸页层按页码渲染，见上方 sheetsLayerRef 层） */}
        </div>
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

      {/* 并排对比：右侧只读视图（独立滚动 + 同步滚动 + 差异高亮） */}
      {compareTarget && (
        <div style={{ flex: '1 1 50%', minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--color-bg-alt)' }}>
          <div className="flex items-center justify-between px-3 py-1.5 text-xs" style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', background: 'var(--color-surface)' }}>
            <span className="flex items-center gap-2">
              <span style={{ fontWeight: 600 }}>{t('doc.compareWith') || '对比:'}</span>
              <span className="truncate max-w-[200px]">{compareTarget.name}</span>
            </span>
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1"><span style={{ width: 10, height: 10, background: 'rgba(16,185,129,0.35)', border: '1px solid #10b981', display: 'inline-block', borderRadius: 2 }} /> {t('doc.diffAdd') || '新增'}</span>
              <span className="flex items-center gap-1"><span style={{ width: 10, height: 10, background: 'rgba(239,68,68,0.30)', border: '1px solid #ef4444', display: 'inline-block', borderRadius: 2 }} /> {t('doc.diffDel') || '删除'}</span>
              <button className="px-2 py-0.5 rounded hover:bg-slate-100" onClick={() => setCompareTarget(null)} title={t('doc.close')}>✕</button>
            </span>
          </div>
          <div
            ref={compareRef}
            onScroll={() => syncScroll('right')}
            className={`flex-1 overflow-auto ${showMarks ? 'show-edit-marks' : ''}`}
            style={{ position: 'relative', zIndex: 1 }}
          />
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
      {showMathModal && (
        <MathEditorModal
          initialLatex={mathEdit.latex}
          initialInline={mathEdit.inline}
          initialTab={mathEdit.pos != null ? 'formula' : 'formula'}
          onClose={() => setShowMathModal(false)}
          onInsert={handleMathInsert}
        />
      )}
      {activeTextBox && (
        <TextBoxStylePanel
          node={activeTextBox.node}
          onChange={updateTextBox}
          onClose={() => setActiveTextBox(null)}
        />
      )}

      {/* 文档保护：打开受保护文档时，强制要求输入密码才能编辑 */}
      {showUnlock && (
        <div
          className="modal-overlay"
          style={{ background: 'rgba(15,23,42,0.45)', zIndex: 200 }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div
            className="modal"
            style={{ maxWidth: 360 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <span>🔒 {t('doc.protectUnlockTitle') || '文档受保护'}</span>
            </div>
            <div style={{ padding: '16px' }}>
              <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', margin: '0 0 12px' }}>
                {t('doc.protectUnlockHint') || '该文档已设置密码保护，请输入密码以解除保护进行编辑。'}
              </p>
              <input
                type="password"
                autoFocus
                value={unlockInput}
                onChange={(e) => { setUnlockInput(e.target.value); setUnlockError(false) }}
                onKeyDown={(e) => { if (e.key === 'Enter') submitUnlock() }}
                placeholder={t('doc.protectEnterPwd') || '输入密码'}
                className="comment-edit-input"
                style={{ width: '100%', fontSize: '13px', borderRadius: '4px', border: `1px solid ${unlockError ? '#ef4444' : 'var(--color-border)'}`, padding: '6px 8px', background: 'var(--color-bg)', color: 'var(--color-text)' }}
              />
              {unlockError && (
                <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '6px' }}>{t('doc.protectWrongPwd') || '密码错误'}</div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
                <button className="btn btn-primary btn-sm" onClick={submitUnlock}>{t('doc.protectUnlock') || '解除保护'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
